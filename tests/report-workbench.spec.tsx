// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportDeliveryViewV1 } from '../src/contracts/reporting.ts'
import { createEmptyTenderWorkflowProjection, type TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
import { zh, type TenderKey } from '../src/client/locales.ts'
import { TenderReportView, type ReportArtifactDownloader, type ReportDeliveryViewLoader } from '../src/client/workbench/TenderReportView.tsx'
import type { SessionWriteFlight } from '../src/client/workbench/session-write-flight.ts'

const t = ((key: TenderKey, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  Object.entries(params ?? {}).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)) })
  return value
}) as TranslateNS<'tenderFilter'>

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function artifact(kind: 'query-spec' | 'normalized-data' | 'review-data' | 'final-snapshot' | 'excel' | 'pdf', id: string) {
  return {
    id, kind, fileName: `${id}.${kind === 'excel' ? 'xlsx' : kind === 'pdf' ? 'pdf' : 'json'}`,
    mediaType: kind === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : kind === 'pdf' ? 'application/pdf' : 'application/json',
    createdAt: '2026-09-02T00:00:00.000Z', accessToken: `token-${id}`,
  }
}

function reportState(overrides: Partial<NonNullable<TenderWorkflowProjectionV1['report']>> = {}): NonNullable<TenderWorkflowProjectionV1['report']> {
  return {
    finalSnapshot: artifact('final-snapshot', 'snapshot-artifact'), finalSnapshotId: 'fs-current',
    completeness: 'partial', createdAt: '2026-09-02T00:00:00.000Z',
    rawRecords: 4, normalizedProjects: 4, reviewed: 3, confirmedTender: 1, priorityProposed: 0,
    watch: 1, pending: 1, exclude: 1, analysisCompleted: 1, analysisTotal: 4,
    excel: { status: 'succeeded', artifact: artifact('excel', 'excel') },
    pdf: { status: 'succeeded', artifact: artifact('pdf', 'pdf') },
    ...overrides,
  }
}

function workflow(report?: TenderWorkflowProjectionV1['report']): TenderWorkflowProjectionV1 {
  const base = createEmptyTenderWorkflowProjection()
  return {
    ...base,
    revision: report === undefined ? 4 : 5,
    currentStage: report === undefined ? 'review' : 'report',
    stages: {
      ...base.stages,
      query: { status: 'succeeded' }, overview: { status: 'succeeded' }, review: { status: 'succeeded' },
      report: report === undefined ? { status: 'not-started' } : { status: 'succeeded' },
    },
    query: {
      scope: 'combined', targetSummary: '数据项目', querySpec: artifact('query-spec', 'query'),
      sources: { tender: { status: 'succeeded', loaded: 3 }, proposed: { status: 'succeeded', loaded: 1 } },
      normalizedData: artifact('normalized-data', 'normalized'), total: 4, sourceRecordCount: 5, duplicateCount: 1, invalidCount: 0,
    },
    review: {
      revision: 2, data: artifact('review-data', 'review'), pending: 1, confirmedCandidate: 1,
      confirmedTender: 1, priorityProposed: 0, watch: 1, exclude: 1, canRevert: true,
    },
    ...(report === undefined ? {} : { report }),
  }
}

function amount(source: 'tender' | 'proposed'): ReportDeliveryViewV1['amountDistributions'][number] {
  return {
    source, amountType: source === 'tender' ? 'budget' : 'total-investment', eligibleCount: source === 'tender' ? 1 : 0,
    singleValueCount: source === 'tender' ? 1 : 0, bandedRangeCount: 0, indeterminateCount: 0, missingCount: 0, unparseableCount: 0,
    medianCny: source === 'tender' ? 8_600_000 : undefined,
    ...(source === 'tender' ? { axis: { unit: 'ten-thousand-yuan' as const, unitLabel: '万元' as const, minCny: 7_000_000, maxCny: 10_000_000, ticksCny: [7_000_000, 8_000_000, 9_000_000, 10_000_000] as [number, number, number, number] } } : {}),
    bands: [{ id: 'low', label: '700 至 800 万元', count: 0 }, { id: 'middle', label: '800 至 900 万元', count: source === 'tender' ? 1 : 0 }, { id: 'high', label: '900 至 1,000 万元', count: 0 }],
    limitation: source === 'tender' ? '未披露预算不按零处理。' : '总投资不等同于采购金额。',
  }
}

function deliveryView(raw = 5, snapshotId = 'fs-current'): ReportDeliveryViewV1 {
  const priority = {
    recordRef: 'tender-1', source: 'tender' as const, title: '数据治理平台升级', counterparty: '某金融机构', region: '江苏', amountDisplay: '预算 860 万',
    deadlineOrUpdatedAt: '2026-09-06', deadlineWindow: 'within-7-days', recommendationSummary: '重点复核', userNote: '核验资质', verificationItems: ['资质'],
  }
  return {
    schemaVersion: 1, finalSnapshotId: snapshotId, createdAt: '2026-09-02T00:00:00.000Z', timeZone: 'Asia/Shanghai', completeness: 'partial',
    query: { scope: 'combined', targetSummary: '华东数据治理项目', sources: { tender: { status: 'succeeded', loaded: 3 }, proposed: { status: 'succeeded', loaded: 1 } } },
    rulesIncluded: true, analysisIncluded: true, analysisCoverage: { completed: 1, total: 4 },
    metricDefinitions: [{ id: 'raw-records', label: '原始记录', description: '已加载的原始记录。', unit: 'record', scopeDescription: '本次交付范围。' }],
    metricValues: [
      { metricId: 'raw-records', value: raw }, { metricId: 'normalized-projects', value: 4 },
      { metricId: 'screening-candidates', value: 3 }, { metricId: 'reviewed-projects', value: 3 },
      { metricId: 'confirmed-total', value: 1 }, { metricId: 'confirmed-tender', value: 1 },
      { metricId: 'priority-proposed', value: 0 }, { metricId: 'near-term-tender', value: 1 },
      { metricId: 'confirmed-rate-reviewed', value: 1 / 3, numerator: 1, denominator: 3 },
    ],
    distributions: [{
      id: 'tender-deadline-window', label: '确认候选截止分布', scopeDescription: '仅确认的正式招投标。',
      buckets: [{ id: 'within-7-days', label: '7 天内', count: 1 }, { id: 'later', label: '30 天以后', count: 0 }], missingCount: 0,
    }, {
      id: 'confirmed-regions', label: '确认候选地区分布', scopeDescription: '按来源分组。',
      buckets: [{ id: 'jiangsu', label: '江苏', count: 1 }], missingCount: 0,
    }],
    amountDistributions: [amount('tender'), amount('proposed')],
    homepageRecords: [priority], priorityRecords: [priority],
    limitations: ['未建立企业能力画像。', '金额不表示合同收入。', '仅覆盖本轮授权数据源。'],
  }
}

function writeFlight(start: SessionWriteFlight['start']): SessionWriteFlight {
  return { state: { sessionId: 'session-1' as never, phase: 'idle' }, busy: false, start, retry: () => false }
}

function footerTarget(): HTMLElement {
  const footer = document.createElement('footer')
  document.body.append(footer)
  return footer
}

function renderReport(options: {
  sessionId?: string
  workflow: TenderWorkflowProjectionV1
  loadView?: ReportDeliveryViewLoader
  download?: ReportArtifactDownloader
  start?: SessionWriteFlight['start']
  write?: SessionWriteFlight
}) {
  const loadView = options.loadView ?? vi.fn(async () => deliveryView())
  const download: ReportArtifactDownloader = options.download ?? vi.fn<ReportArtifactDownloader>(async () => undefined)
  const start = options.start ?? vi.fn(() => true)
  const footer = footerTarget()
  const props = {
    sessionId: (options.sessionId ?? 'session-1') as never,
    workflow: options.workflow,
    write: options.write ?? writeFlight(start),
    loadView,
    download,
    footerTarget: footer,
    t,
  }
  return { ...render(<TenderReportView {...props} />), props, footer }
}

describe('S5.4 delivery workbench', () => {
  it('requires explicit pending confirmation and sends the exact partial-report intent', () => {
    const sent: unknown[] = []
    const start = vi.fn<SessionWriteFlight['start']>((_action, build) => {
      sent.push(build('report-command'))
      return true
    })
    const { footer } = renderReport({ workflow: workflow(), start })
    const generate = screen.getByRole('button', { name: zh['workbench.report.generatePartial'] })
    expect(footer.contains(generate)).toBe(true)
    expect(generate.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(zh['workbench.report.includeNarrativeTitle']) }))
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(zh['workbench.report.partialConfirmTitle']) }))
    expect(generate.hasAttribute('disabled')).toBe(false)
    fireEvent.click(generate)
    expect(start).toHaveBeenCalledWith('report.create', expect.any(Function))
    expect(sent[0]).toMatchObject({
      kind: 'report.create', commandId: 'report-command', activeDatasetRef: 'normalized',
      reviewArtifactRef: 'review', reviewRevision: 2, projectionRevision: 4,
      confirmPending: true, includeNarrative: false,
    })
  })

  it('offers the complete-report action without partial confirmation and keeps sending state in place', () => {
    const sent: unknown[] = []
    const start = vi.fn<SessionWriteFlight['start']>((_action, build) => { sent.push(build('complete-command')); return true })
    const state = workflow()
    const complete = { ...state, review: { ...state.review!, pending: 0, confirmedCandidate: 2, confirmedTender: 1, priorityProposed: 1, watch: 1, exclude: 1 } }
    const initial = renderReport({ workflow: complete, start })
    const generate = screen.getByRole('button', { name: zh['workbench.report.generateComplete'] })
    expect(generate.hasAttribute('disabled')).toBe(false)
    fireEvent.click(generate)
    expect(sent[0]).toMatchObject({ kind: 'report.create', confirmPending: false, includeNarrative: true })
    initial.unmount()
    const busy: SessionWriteFlight = {
      state: { sessionId: 'session-1' as never, phase: 'sending', action: 'report.create', commandId: 'in-flight' },
      busy: true, start: vi.fn(() => false), retry: vi.fn(() => false),
    }
    renderReport({ workflow: complete, write: busy })
    const sending = screen.getByRole('button', { name: new RegExp(zh['workbench.write.report.sending']) })
    expect(sending.hasAttribute('disabled')).toBe(true)
    expect(sending.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-write-action="report.create"]')?.textContent).toContain(zh['workbench.write.report.sending'])
  })

  it('renders the five prototype tabs in order and supports roving keyboard focus', async () => {
    renderReport({ workflow: workflow(reportState()) })
    await screen.findByText(zh['workbench.report.kpi.raw'])
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual([
      zh['workbench.report.tab.summary'], zh['workbench.report.tab.charts'], zh['workbench.report.tab.opportunities'],
      zh['workbench.report.tab.files'], zh['workbench.report.tab.provenance'],
    ])
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(5)
    expect(panels.map(panel => panel.id)).toEqual(tabs.map(tab => tab.getAttribute('aria-controls')))
    expect(panels.map(panel => panel.hasAttribute('hidden'))).toEqual([false, true, true, true, true])
    const lead = screen.getByRole('heading', { name: zh['workbench.report.deliveredTitle'] })
    const snapshot = screen.getByRole('heading', { name: zh['workbench.report.snapshotTitle'] })
    expect(lead.compareDocumentPosition(snapshot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(snapshot.compareDocumentPosition(tabs[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[1]!, { key: 'End' })
    expect(document.activeElement).toBe(tabs[4])
    fireEvent.keyDown(tabs[4]!, { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    expect(document.body.textContent).not.toMatch(/在线预览|版本对比|用户排除原因 Top 5/u)
  })

  it('does not offer report generation before a real manual-review dataset exists', () => {
    const state = workflow()
    renderReport({ workflow: { ...state, review: undefined } })
    expect(screen.getByText(zh['workbench.report.dependencyTitle'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: /生成(?:完整|阶段性)报告/u })).toBeNull()
  })

  it('uses the Host five-window distribution for the 7-day KPI and renders file outlines as grouped items', async () => {
    const view = deliveryView()
    view.metricValues.find(item => item.metricId === 'near-term-tender')!.value = 3
    renderReport({ workflow: workflow(reportState()), loadView: vi.fn(async () => view) })
    const kpiLabel = await screen.findByText(zh['workbench.report.kpi.nearTerm'])
    expect(kpiLabel.closest('article')?.textContent).toContain('1')
    expect(kpiLabel.closest('article')?.textContent).not.toContain('3')
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.report.tab.files'] }))
    expect(screen.getByText(zh['workbench.report.file.excelOverview']).tagName).toBe('SPAN')
    expect(screen.getByText(zh['workbench.report.file.pdfConclusion']).tagName).toBe('SPAN')
  })

  it('renders the Host-provided dynamic amount axis and omits zero-value color segments', async () => {
    renderReport({ workflow: workflow(reportState()) })
    await screen.findByText(zh['workbench.report.kpi.raw'])
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.report.tab.charts'] }))
    const chart = screen.getByRole('heading', { name: zh['workbench.report.chart.tenderAmount'] }).closest('article')
    expect(chart?.textContent).toContain('金额区间 700 至 1,000 万元')
    expect(chart?.textContent).toContain('860 万元')
    expect(chart?.querySelectorAll('[role="img"] i')).toHaveLength(1)
    expect(chart?.querySelector('[data-segment="1"]')?.textContent).toBe('1')
  })

  it('shows an amount empty state instead of three colored slivers when nothing is drawable', async () => {
    const view = deliveryView()
    const { axis: _axis, medianCny: _medianCny, ...unavailable } = view.amountDistributions[0]!
    view.amountDistributions[0] = {
      ...unavailable, singleValueCount: 0, missingCount: 1,
      bands: unavailable.bands.map(band => ({ ...band, count: 0 })),
    }
    renderReport({ workflow: workflow(reportState()), loadView: vi.fn(async () => view) })
    await screen.findByText(zh['workbench.report.kpi.raw'])
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.report.tab.charts'] }))
    const chart = screen.getByRole('heading', { name: zh['workbench.report.chart.tenderAmount'] }).closest('article')
    expect(chart?.textContent).toContain(zh['workbench.report.amount.emptyTitle'])
    expect(chart?.querySelector('[role="img"]')).toBeNull()
    expect(chart?.querySelector('[class*="stackedBar"]')).toBeNull()
  })

  it('keeps report files available when the bounded delivery view fails and retries only the failed format', async () => {
    const pdf = artifact('pdf', 'pdf')
    const report = reportState({
      excel: { status: 'failed', errorMessage: 'Excel renderer failed' },
      pdf: { status: 'succeeded', artifact: pdf },
    })
    const sent: unknown[] = []
    const start = vi.fn<SessionWriteFlight['start']>((_action, build) => { sent.push(build('retry-command')); return true })
    const download = vi.fn(async () => undefined)
    renderReport({ workflow: workflow(report), loadView: vi.fn(async () => { throw new Error('unavailable') }), download, start })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.report.tab.files'] }))
    expect(screen.getByText('Excel renderer failed')).toBeTruthy()
    expect(screen.getByText(zh['workbench.report.fileStatus.succeeded'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.report.retry'].replace('{format}', 'Excel') }))
    expect(sent[0]).toEqual({
      schemaVersion: 1, kind: 'report.retry', commandId: 'retry-command', projectionRevision: 5,
      finalSnapshotId: 'fs-current', formats: ['excel'],
    })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.report.download'].replace('{format}', 'PDF') }))
    expect(download).toHaveBeenCalledWith('session-1', pdf)
  })

  it('reloads a failed bounded view without changing the immutable snapshot binding', async () => {
    const loadView = vi.fn<ReportDeliveryViewLoader>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(deliveryView(9))
    renderReport({ workflow: workflow(reportState()), loadView })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.report.viewRetry'] }))
    await screen.findByText('9')
    expect(loadView).toHaveBeenCalledTimes(2)
    expect(loadView.mock.calls.every(call => call[1].id === 'snapshot-artifact')).toBe(true)
  })

  it('aborts and ignores a stale response after switching Session and snapshot', async () => {
    let resolveFirst: ((value: ReportDeliveryViewV1) => void) | undefined
    let firstSignal: AbortSignal | undefined
    const first = new Promise<ReportDeliveryViewV1>(resolve => { resolveFirst = resolve })
    const loadView = vi.fn<ReportDeliveryViewLoader>((sessionId, _artifact, signal) => {
      if (sessionId === ('session-1' as never)) {
        firstSignal = signal
        return first
      }
      return Promise.resolve(deliveryView(17, 'fs-next'))
    })
    const initial = renderReport({ workflow: workflow(reportState()), loadView })
    const nextReport = reportState({
      finalSnapshot: artifact('final-snapshot', 'snapshot-next'), finalSnapshotId: 'fs-next', rawRecords: 17,
    })
    initial.rerender(<TenderReportView {...initial.props} sessionId={'session-2' as never} workflow={workflow(nextReport)} />)
    await screen.findByText('17')
    expect(firstSignal?.aborted).toBe(true)
    resolveFirst?.(deliveryView(99))
    await Promise.resolve()
    expect(screen.queryByText('99')).toBeNull()
    expect(screen.getByText('17')).toBeTruthy()
  })

  it('uses fixed footer actions to open provenance and report files', async () => {
    const { footer } = renderReport({ workflow: workflow(reportState()) })
    await screen.findByText(zh['workbench.report.kpi.raw'])
    const provenance = screen.getByRole('button', { name: zh['workbench.report.openProvenance'] })
    const files = screen.getByRole('button', { name: zh['workbench.report.openFiles'] })
    expect(footer.contains(provenance)).toBe(true)
    expect(footer.contains(files)).toBe(true)
    fireEvent.click(provenance)
    expect(screen.getByRole('tab', { name: zh['workbench.report.tab.provenance'] }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('tab', { name: zh['workbench.report.tab.provenance'] })) })
    fireEvent.click(files)
    expect(screen.getByRole('tab', { name: zh['workbench.report.tab.files'] }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps zero-candidate, no-narrative, and partial source coverage explicit', async () => {
    const view = deliveryView()
    view.query.sources = { tender: { status: 'failed', loaded: 0, errorMessage: '上游失败' } }
    view.analysisIncluded = false
    view.analysisCoverage = { completed: 0, total: 4 }
    view.metricValues = view.metricValues.map(item => ['confirmed-total', 'confirmed-tender', 'near-term-tender'].includes(item.metricId) ? { ...item, value: 0 } : item)
    view.homepageRecords = []
    view.priorityRecords = []
    renderReport({ workflow: workflow(reportState({ confirmedTender: 0, priorityProposed: 0 })), loadView: vi.fn(async () => view) })
    await screen.findByText(zh['workbench.report.insight.confirmedZero'])
    expect(screen.queryByText(zh['workbench.report.narrativeTitle'])).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.report.tab.opportunities'] }))
    expect(screen.getByText(zh['workbench.report.opportunitiesEmpty'])).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.report.tab.provenance'] }))
    expect(screen.getByText(new RegExp(zh['workbench.report.provenance.sourceFailed']))).toBeTruthy()
    expect(screen.getByText(new RegExp(zh['workbench.report.provenance.notRequested']))).toBeTruthy()
  })
})
