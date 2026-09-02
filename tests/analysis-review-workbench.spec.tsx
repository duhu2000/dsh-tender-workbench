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
import type { ReviewRowsLoader } from '../src/client/workbench/TenderAnalysisReviewViews.tsx'
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

function projection(): TenderWorkflowProjectionV1 {
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
      analysis: { status: 'succeeded', updatedAt: createdAt },
    },
    query: {
      scope: 'combined', targetSummary: '查找数据项目',
      querySpec: { id: 'query-spec', kind: 'query-spec', fileName: 'query.json', mediaType: 'application/json', createdAt, accessToken: 'query-token' },
      sources: { tender: { status: 'succeeded', loaded: 1 }, proposed: { status: 'succeeded', loaded: 1 } },
      normalizedData: normalized, sourceRecordCount: 2, total: 2, duplicateCount: 0, invalidCount: 0,
    },
    rules: { ruleSetVersion: 'rules-v1', ruleCount: 1, rawMatches: 2, covered: 2, conflicts: 0 },
    classification: { data: classified, include: 1, observe: 1, manualReview: 0, exclude: 0, unmatched: 0, covered: 2, conflicts: 0, ruleSetVersion: 'rules-v1', activeDatasetId: normalized.id },
    analysis: { version: 'analysis-v1', activeDatasetId: normalized.id, ruleSetVersion: 'rules-v1', data: analysis, total: 2, completed: 1, priorityReview: 1, watch: 0, notRecommended: 0 },
    review: { revision: 0, data: review, pending: 2, confirmedCandidate: 0, watch: 0, exclude: 0, canRevert: false },
  }
}

function renderS4(sendIntent = vi.fn(async (_intent: unknown) => {})) {
  const data = rows()
  const loadReviewRows = vi.fn<ReviewRowsLoader>(async (_sessionId, artifact, filter) => ({
    schemaVersion: 1,
    artifactId: artifact.id,
    page: filter.page,
    pageSize: filter.pageSize,
    total: data.length,
    rows: data,
  }))
  const result = render(<TenderWorkbenchView
    sessionId={'session-s4' as never}
    projection={{ status: 'ready', projection: projection() }}
    navigation={createTenderWorkbenchNavigationController()}
    sendIntent={sendIntent}
    createCommandId={() => 'command-s4'}
    loadReviewRows={loadReviewRows}
    t={t}
  />)
  return { ...result, sendIntent, loadReviewRows }
}

describe('S4 analysis and review workbench', () => {
  it('keeps evidence, Agent recommendation, and pending user decision separate while analyzing an explicit selection', async () => {
    const sendIntent = vi.fn((_intent: unknown) => new Promise<void>(() => {}))
    renderS4(sendIntent)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.analysis.shortTitle'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.analysis.title'] })).toBeTruthy()
    const tenderRow = screen.getAllByText('数据治理平台项目')[0]?.closest('tr') ?? null
    if (tenderRow === null) throw new Error('missing tender row')
    expect(within(tenderRow).getByText(zh['workbench.analysis.recommendation.priority-review'])).toBeTruthy()
    expect(within(tenderRow).getByText(zh['workbench.review.decision.pending'])).toBeTruthy()
    expect(within(tenderRow).getByText('1 项引用证据')).toBeTruthy()
    fireEvent.click(within(tenderRow).getByRole('checkbox'))
    const analyze = screen.getByRole('button', { name: '分析选中 1 条' })
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
      scope: { kind: 'records', recordRefs: ['row-tender'] },
    })
  })

  it('allows an unanalyzed proposed project to receive an explicit source-aware user decision and note', async () => {
    const { sendIntent } = renderS4()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.review.title'] })).toBeTruthy()
    const proposedRow = screen.getByText('智算中心拟建项目').closest('tr')
    if (proposedRow === null) throw new Error('missing proposed row')
    expect(within(proposedRow).getByText(zh['workbench.analysis.unanalyzed'])).toBeTruthy()
    expect(within(proposedRow).getByText(zh['workbench.review.decision.pending'])).toBeTruthy()
    fireEvent.click(within(proposedRow).getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(zh['workbench.review.batchDecision']), { target: { value: 'confirmed-candidate' } })
    fireEvent.change(screen.getByLabelText(zh['workbench.review.note']), { target: { value: '作为重点前期线索，等待采购计划。' } })
    fireEvent.click(screen.getByRole('button', { name: '应用到选中 1 条' }))
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({
      kind: 'review.apply',
      recordRefs: ['row-proposed'],
      decision: 'confirmed-candidate',
      note: '作为重点前期线索，等待采购计划。',
      analysisVersion: 'analysis-v1',
    })
  })
})
