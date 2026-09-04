// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewRecordV1 } from '../src/contracts/analysis-review.ts'
import {
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV1,
} from '../src/contracts/workflow.ts'
import { zh, type TenderKey } from '../src/client/locales.ts'
import {
  TenderWorkbenchView,
} from '../src/client/workbench/TenderWorkbench.tsx'
import { reviewTimingLabel, type ReviewRowsLoader } from '../src/client/workbench/TenderAnalysisReviewViews.tsx'
import { createTenderWorkbenchNavigationController } from '../src/client/workbench/navigation-controller.ts'

const t = ((key: TenderKey, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as TranslateNS<'tenderFilter'>

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const createdAt = '2026-09-02T00:00:00.000Z'

function project(recordId: string, source: 'tender' | 'proposed', title: string) {
  return {
    schemaVersion: 1 as const,
    recordId,
    source,
    sourceId: `${source}-${recordId}`,
    title,
    lifecycle: source === 'tender' ? 'active-procurement' as const : 'early-signal' as const,
    dataDisposition: 'normalized' as const,
    stage: { original: source === 'tender' ? '招标公告' : '项目备案', value: source === 'tender' ? '招标公告' : '项目备案', status: 'normalized' as const },
    projectNumber: { original: `NO-${recordId}`, value: `NO-${recordId}`, status: 'normalized' as const },
    region: { original: '江苏省', value: '江苏省', parts: ['江苏省'], status: 'normalized' as const },
    counterparty: { original: '某单位', value: '某单位', status: 'normalized' as const },
    amount: { original: source === 'tender' ? '860万元' : '4.6亿元', type: source === 'tender' ? 'budget' as const : 'total-investment' as const, minCny: source === 'tender' ? 8_600_000 : 460_000_000, maxCny: source === 'tender' ? 8_600_000 : 460_000_000, parseStatus: 'exact' as const, display: source === 'tender' ? '860万元' : '4.6亿元' },
    publishedAt: { original: '2026-08-29', value: '2026-08-29', precision: 'date' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'normalized' as const },
    ...(source === 'tender' ? { deadline: { original: '2099-09-20', value: '2099-09-20', precision: 'date' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'normalized' as const } } : {}),
    announcements: [{
      sourceRecordId: `${source}-${recordId}`,
      title,
      lifecycle: source === 'tender' ? 'active-procurement' as const : 'early-signal' as const,
      stage: { original: source === 'tender' ? '招标公告' : '项目备案', value: source === 'tender' ? '招标公告' : '项目备案', status: 'normalized' as const },
      projectNumber: { original: `NO-${recordId}`, value: `NO-${recordId}`, status: 'normalized' as const },
      region: { original: '江苏省', value: '江苏省', parts: ['江苏省'], status: 'normalized' as const },
      amount: { original: source === 'tender' ? '860万元' : '4.6亿元', type: source === 'tender' ? 'budget' as const : 'total-investment' as const, minCny: source === 'tender' ? 8_600_000 : 460_000_000, maxCny: source === 'tender' ? 8_600_000 : 460_000_000, parseStatus: 'exact' as const, display: source === 'tender' ? '860万元' : '4.6亿元' },
      publishedAt: { original: '2026-08-29', value: '2026-08-29', precision: 'date' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'normalized' as const },
      parties: [{ id: 'party-1', name: '某单位' }],
    }],
    disclosure: { missingFields: source === 'proposed' ? ['deadline'] : [], unparseableFields: [] },
  }
}

function rows(): ReviewRecordV1[] {
  const tender = project('row-tender', 'tender', '数据治理平台项目')
  const proposed = project('row-proposed', 'proposed', '智算中心拟建项目')
  return [
    {
      schemaVersion: 1,
      project: tender,
      classification: 'include',
      finalRuleId: 'rule-1',
      recommendation: {
        recordRef: tender.recordId,
        recommendation: 'priority-review',
        reason: '方向相关且截止时间有效，建议优先核验。',
        verificationItems: ['核验资格要求'],
        limitations: ['没有企业能力画像'],
        batchId: 'batch-1',
        committedAt: createdAt,
        evidence: [{ ref: 'ev:row-tender:title', kind: 'source-field', label: '项目名称', value: tender.title }],
      },
      review: { decision: 'pending', note: '' },
    },
    {
      schemaVersion: 1,
      project: proposed,
      classification: 'observe',
      review: { decision: 'pending', note: '' },
    },
  ]
}

function projection(analysisComplete = false): TenderWorkflowProjectionV1 {
  const base = createEmptyTenderWorkflowProjection()
  const normalized = { id: 'normalized-data', kind: 'normalized-data' as const, fileName: 'normalized.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'normalized-token' }
  const classified = { id: 'classified-data', kind: 'classified-data' as const, fileName: 'classified.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'classified-token' }
  const analysis = { id: 'analysis-data', kind: 'analysis-data' as const, fileName: 'analysis.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'analysis-token' }
  const review = { id: 'review-data', kind: 'review-data' as const, fileName: 'review.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'review-token' }
  return {
    ...base,
    revision: 4,
    currentStage: 'analysis',
    stages: {
      ...base.stages,
      query: { status: 'succeeded', updatedAt: createdAt },
      overview: { status: 'succeeded', updatedAt: createdAt },
      rules: { status: 'succeeded', updatedAt: createdAt },
      classification: { status: 'succeeded', updatedAt: createdAt },
      analysis: analysisComplete
        ? { status: 'succeeded', updatedAt: createdAt }
        : { status: 'failed', updatedAt: createdAt, errorCode: 'analysis-incomplete', errorMessage: 'Agent 分析在 1/2 时中断；可继续处理剩余记录。' },
    },
    query: {
      scope: 'combined', targetSummary: '查找数据项目',
      querySpec: { id: 'query-spec', kind: 'query-spec', fileName: 'query.json', mediaType: 'application/json', createdAt, accessToken: 'query-token' },
      sources: { tender: { status: 'succeeded', loaded: 1 }, proposed: { status: 'succeeded', loaded: 1 } },
      normalizedData: normalized, sourceRecordCount: 2, total: 2, duplicateCount: 0, invalidCount: 0,
    },
    rules: { ruleSetVersion: 'rules-v1', ruleCount: 1, rawMatches: 2, covered: 2, conflicts: 0 },
    classification: { data: classified, include: 1, observe: 1, manualReview: 0, exclude: 0, unmatched: 0, covered: 2, conflicts: 0, ruleSetVersion: 'rules-v1', activeDatasetId: normalized.id },
    analysis: { version: 'analysis-v1', activeDatasetId: normalized.id, ruleSetVersion: 'rules-v1', data: analysis, eligibleTotal: 2, completed: analysisComplete ? 2 : 1, priorityReview: 1, watch: analysisComplete ? 1 : 0, notRecommended: 0, urgent: 0 },
    review: { revision: 0, data: review, pending: 2, confirmedCandidate: 0, watch: 0, exclude: 0, canRevert: false },
  }
}

function renderS4(sendIntent = vi.fn(async (_intent: unknown) => {}), analysisComplete = false) {
  const data = rows()
  const loadReviewRows = vi.fn<ReviewRowsLoader>(async (_sessionId, artifact, filter) => ({
    schemaVersion: 1,
    artifactId: artifact.id,
    page: filter.page,
    pageSize: filter.pageSize,
    total: data.length,
    pending: data.filter(row => row.review.decision === 'pending').length,
    reviewed: data.filter(row => row.review.decision !== 'pending').length,
    facets: { regions: ['江苏省'], stages: ['招标公告', '项目备案'], procurementMethods: [], procurementTypes: [], ruleIds: ['rule-1'] },
    audit: [],
    rows: data,
  }))
  const result = render(<TenderWorkbenchView
    sessionId={'session-s4' as never}
    projection={{ status: 'ready', projection: projection(analysisComplete) }}
    navigation={createTenderWorkbenchNavigationController()}
    sendIntent={sendIntent}
    createCommandId={() => 'command-s4'}
    loadReviewRows={loadReviewRows}
    t={t}
  />)
  return { ...result, sendIntent, loadReviewRows }
}

describe('S4 analysis and review workbench', () => {
  it('formats tender deadlines as business timing and proposed records as project stages', () => {
    const [tender, proposed] = rows()
    if (tender === undefined || proposed === undefined) throw new Error('missing timing fixtures')
    const now = Date.parse('2099-09-04T10:00:00+08:00')
    expect(reviewTimingLabel(tender, t, now)).toBe('剩余 16 天')
    expect(reviewTimingLabel({ ...tender, project: { ...tender.project, deadline: { ...tender.project.deadline!, value: '2099-09-04', precision: 'date' } } }, t, now)).toBe('今日截止')
    expect(reviewTimingLabel({ ...tender, project: { ...tender.project, deadline: { ...tender.project.deadline!, value: '2099-09-03T09:00:00+08:00', precision: 'date-time' } } }, t, now)).toBe('已截止')
    expect(reviewTimingLabel({ ...tender, project: { ...tender.project, deadline: undefined } }, t, now)).toBe(zh['workbench.data.value.missing'])
    expect(reviewTimingLabel(proposed, t, now)).toBe('项目备案')
  })

  it('uses the completed Agent analysis footer action to enter human review', async () => {
    const sendIntent = vi.fn(async (_intent: unknown) => {})
    renderS4(sendIntent, true)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.analysis.title'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.analysis.openReview'] }))
    expect(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('heading', { name: zh['workbench.review.title'] })).toBeTruthy()
    expect(screen.getByText(t('workbench.review.progress', { reviewed: 0, total: 2 }))).toBeTruthy()
    const report = screen.getByRole('button', { name: zh['workbench.review.generateCurrent'] })
    fireEvent.click(report)
    fireEvent.click(report)
    expect(screen.getByRole('tab', { name: zh['workbench.phase.delivery'] }).getAttribute('aria-selected')).toBe('true')
    expect(sendIntent).not.toHaveBeenCalled()
  })

  it('keeps pending and reviewed as real queues with explicit filters and keyboard navigation', async () => {
    const { loadReviewRows } = renderS4()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.review.title'] })).toBeTruthy()
    await waitFor(() => { expect(loadReviewRows).toHaveBeenLastCalledWith('session-s4', expect.anything(), expect.objectContaining({ queue: 'pending', sort: 'recommendation' }), expect.any(AbortSignal)) })
    const queueTabs = within(screen.getByRole('tablist', { name: zh['workbench.review.queueTabs'] }))
    const pendingTab = queueTabs.getByRole('tab', { name: t('workbench.review.queue.pending', { count: 2 }) })
    const reviewedTab = queueTabs.getByRole('tab', { name: t('workbench.review.queue.reviewed', { count: 0 }) })
    pendingTab.focus()
    fireEvent.keyDown(pendingTab, { key: 'ArrowRight' })
    expect(reviewedTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(reviewedTab)
    await waitFor(() => { expect(loadReviewRows).toHaveBeenLastCalledWith('session-s4', expect.anything(), expect.objectContaining({ queue: 'reviewed', sort: 'recommendation' }), expect.any(AbortSignal)) })

    fireEvent.click(pendingTab)
    const advanced = screen.getByRole('button', { name: zh['workbench.review.advanced'] })
    expect(advanced.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(advanced)
    expect(advanced.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText(zh['workbench.review.filterStage'])).toBeTruthy()
    fireEvent.change(screen.getByLabelText(zh['workbench.analysis.filterRecommendation']), { target: { value: 'priority-review' } })
    await waitFor(() => { expect(loadReviewRows).toHaveBeenLastCalledWith('session-s4', expect.anything(), expect.objectContaining({ recommendation: 'priority-review' }), expect.any(AbortSignal)) })
    const activeFilters = screen.getByLabelText(zh['workbench.review.activeFilters'])
    expect(within(activeFilters).getByText(/Agent 建议：重点复核/u)).toBeTruthy()
    fireEvent.click(within(activeFilters).getByRole('button', { name: /移除Agent 建议/u }))
    await waitFor(() => { expect(loadReviewRows).toHaveBeenLastCalledWith('session-s4', expect.anything(), expect.not.objectContaining({ recommendation: 'priority-review' }), expect.any(AbortSignal)) })
  })

  it('keeps evidence and recommendation separate while resuming every remaining eligible record', async () => {
    const sendIntent = vi.fn((_intent: unknown) => new Promise<void>(() => {}))
    renderS4(sendIntent)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.analysis.shortTitle'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.analysis.title'] })).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    const tenderRow = screen.getByRole('button', { name: /01 数据治理平台项目/u })
    if (tenderRow === null) throw new Error('missing tender row')
    expect(within(tenderRow).getByText(zh['workbench.analysis.recommendation.priority-review'])).toBeTruthy()
    expect(screen.getByText('项目名称')).toBeTruthy()
    expect(screen.getAllByText(zh['workbench.analysis.factRule']).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh['workbench.analysis.factTiming'])).toBeTruthy()
    expect(document.querySelector('[data-analysis-layout]')).toBeTruthy()
    expect(document.querySelector('[data-analysis-risk]')).toBeTruthy()
    expect(document.querySelector('[data-analysis-verification]')).toBeTruthy()
    expect(screen.getByLabelText(zh['workbench.analysis.sort'])).toBeTruthy()
    const proposedButton = screen.getByText('智算中心拟建项目').closest('button')
    if (proposedButton === null) throw new Error('missing proposed analysis row')
    fireEvent.click(proposedButton)
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByLabelText(zh['workbench.analysis.detailTitle'])) })
    expect(within(screen.getByLabelText(zh['workbench.analysis.detailTitle'])).getByText(zh['workbench.analysis.unanalyzedDescription'])).toBeTruthy()
    const analyze = screen.getAllByRole('button', { name: zh['workbench.analysis.resume'] }).at(-1)
    if (analyze === undefined) throw new Error('missing resume-all analysis action')
    fireEvent.click(analyze)
    fireEvent.click(analyze)
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(analyze).toHaveProperty('disabled', true)
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({
      kind: 'analysis.request',
      activeDatasetRef: 'normalized-data',
      classificationArtifactRef: 'classified-data',
      ruleSetVersion: 'rules-v1',
      projectionRevision: 4,
      scope: { kind: 'all-eligible' },
    })
  })

  it('allows an unanalyzed proposed project to receive an explicit source-aware user decision and note', async () => {
    const { sendIntent } = renderS4()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.review.title'] })).toBeTruthy()
    const proposedRow = screen.getByText('智算中心拟建项目').closest('tr')
    if (proposedRow === null) throw new Error('missing proposed row')
    expect(within(proposedRow).getAllByText(zh['workbench.analysis.unanalyzed']).length).toBeGreaterThanOrEqual(1)
    expect(within(proposedRow).getByText(zh['workbench.review.decision.pending'])).toBeTruthy()
    const batchConfirmed = screen.getByRole('button', { name: zh['workbench.review.batchSetConfirmed'] }) as HTMLButtonElement
    expect(batchConfirmed.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: zh['workbench.review.selectPage'] }))
    expect(screen.getByText('2 条已选')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.review.clearSelection'] }))
    expect(screen.getByText('0 条已选')).toBeTruthy()
    fireEvent.click(within(proposedRow).getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(zh['workbench.review.batchNote']), { target: { value: '作为重点前期线索，等待采购计划。' } })
    fireEvent.click(batchConfirmed)
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({
      kind: 'review.apply',
      recordRefs: ['row-proposed'],
      decision: 'confirmed-candidate',
      note: '作为重点前期线索，等待采购计划。',
      analysisVersion: 'analysis-v1',
    })
  })

  it('keeps batch inputs separate from the focused record editor', async () => {
    const { sendIntent } = renderS4()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.review.title'] })).toBeTruthy()
    const proposedRow = screen.getByText('智算中心拟建项目').closest('tr')
    if (proposedRow === null) throw new Error('missing proposed row')
    fireEvent.click(proposedRow)
    fireEvent.click(within(proposedRow).getByRole('checkbox'))
    const detail = screen.getByLabelText(zh['workbench.review.detailTitle'])
    expect(within(detail).getByRole('heading', { name: '智算中心拟建项目' })).toBeTruthy()
    expect(within(detail).getByText('NO-row-proposed')).toBeTruthy()
    expect(within(detail).queryByText('proposed-row-proposed')).toBeNull()

    const currentDecision = screen.getByRole('group', { name: zh['workbench.review.currentDecision'] })
    const currentNote = screen.getByLabelText(zh['workbench.review.currentNote'])
    const batchNote = screen.getByLabelText(zh['workbench.review.batchNote'])
    fireEvent.click(within(currentDecision).getByRole('button', { name: zh['workbench.review.confirmedProposed'] }))
    fireEvent.change(currentNote, { target: { value: '逐条决定，不应污染批量输入。' } })
    expect((batchNote as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: zh['workbench.review.saveCurrent'] }))
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({
      kind: 'review.apply',
      recordRefs: ['row-proposed'],
      decision: 'confirmed-candidate',
      note: '逐条决定，不应污染批量输入。',
    })
  })

  it('preserves an unaffected selection and focused record across review Artifact updates', async () => {
    const initial = projection()
    const data = rows()
    const loadReviewRows = vi.fn<ReviewRowsLoader>(async (_sessionId, artifact, filter) => ({
      schemaVersion: 1,
      artifactId: artifact.id,
      page: filter.page,
      pageSize: filter.pageSize,
      total: data.length,
      pending: 2,
      reviewed: 0,
      facets: { regions: ['江苏省'], stages: ['招标公告', '项目备案'], procurementMethods: [], procurementTypes: [], ruleIds: ['rule-1'] },
      audit: [],
      rows: data,
    }))
    const navigation = createTenderWorkbenchNavigationController()
    const sendIntent = vi.fn(async (_intent: unknown) => {})
    const renderView = (workflow: TenderWorkflowProjectionV1) => <TenderWorkbenchView
      sessionId={'session-s4' as never}
      projection={{ status: 'ready', projection: workflow }}
      navigation={navigation}
      sendIntent={sendIntent}
      createCommandId={() => 'command-s4'}
      loadReviewRows={loadReviewRows}
      t={t}
    />
    const view = render(renderView(initial))
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }))
    const proposedRow = (await screen.findByText('智算中心拟建项目')).closest('tr')
    if (proposedRow === null) throw new Error('missing proposed row')
    fireEvent.click(proposedRow)
    fireEvent.click(within(proposedRow).getByRole('checkbox'))
    expect((within(proposedRow).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(within(screen.getByLabelText(zh['workbench.review.detailTitle'])).getByRole('heading', { name: '智算中心拟建项目' })).toBeTruthy()

    const replacement = { id: 'review-data-next', kind: 'review-data' as const, fileName: 'review-next.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'review-token-next' }
    view.rerender(renderView({ ...initial, revision: initial.revision + 1, review: { ...initial.review!, revision: 1, data: replacement } }))
    await waitFor(() => { expect(loadReviewRows).toHaveBeenLastCalledWith('session-s4', replacement, expect.objectContaining({ queue: 'pending' }), expect.any(AbortSignal)) })
    const refreshedRow = screen.getAllByText('智算中心拟建项目').map(element => element.closest('tr')).find((element): element is HTMLTableRowElement => element !== null)
    if (refreshedRow === undefined) throw new Error('missing refreshed proposed row')
    expect((within(refreshedRow).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(within(screen.getByLabelText(zh['workbench.review.detailTitle'])).getByRole('heading', { name: '智算中心拟建项目' })).toBeTruthy()
  })
})
