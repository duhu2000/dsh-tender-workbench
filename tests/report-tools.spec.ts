import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewDatasetV1Schema, ReviewRecordV1Schema } from '../src/contracts/analysis-review.ts'
import { ReportDatasetSchema } from '../src/contracts/reporting.ts'
import type { TenderWorkflowProjectionV2 } from '../src/contracts/workflow.ts'
import { TenderWorkflowProjectionV2Schema, createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import { IntentReceiptCoordinator, emptyIntentReceiptManifest } from '../src/host/artifacts/intent-receipts.ts'
import { createArtifactTransaction, type SessionPersistenceLocator } from '../src/host/artifacts/store.ts'
import { analysisBaseRows } from '../src/host/pipeline/analysis-review.ts'
import { adaptQccProposedPayload, adaptQccTenderPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { normalizeQccSources } from '../src/host/pipeline/normalize.ts'
import {
  createTenderWorkbenchCreateReportTool,
  createTenderWorkbenchReportNarrativeContextTool,
  createTenderWorkbenchRetryReportTool,
  type CreateReportResultV2,
  type ReportNarrativeContextResultV2,
  type RetryReportResultV2,
} from '../src/host/tools/report-tools.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function harness(options: { readonly pending?: boolean; readonly failExcel?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tender-report-'))
  temporaryRoots.push(root)
  const transcript = join(root, 'session.jsonl')
  await writeFile(transcript, 'transcript\n', 'utf8')
  const sessionId = 'session-report-test' as SessionId
  const events: unknown[] = []
  const session = { id: sessionId, header: { version: 0, id: sessionId, createdAt: 1 }, events }
  const persistence: SessionPersistenceLocator = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const transaction = createArtifactTransaction(persistence, session.header)
  await transaction.load()
  const tender = adaptQccTenderPayload({
    查询摘要: { 命中总数: 2, 结果说明: '测试', 生效筛选: {} },
    标讯列表: [
      { 标讯ID: 't-1', 标题: '数据平台采购', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-1', 企业名称: '某银行' }], 发布时间: '2026-09-01', 投标截止时间: '2026-09-08', '预算金额（元）': '860万元' },
      { 标讯ID: 't-2', 标题: '云服务采购', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-2', 企业名称: '某集团' }], 发布时间: '2026-08-30', 投标截止时间: '2026-10-08', '预算金额（元）': '500万元' },
    ],
  })
  const proposed = adaptQccProposedPayload({
    查询摘要: { 命中总数: 1, 结果说明: '测试', 生效筛选: {} },
    拟建项目列表: [{
      拟建项目ID: 'p-1', 项目名称: '智算中心建设', 项目阶段: '备案', 审批进度: '审批中',
      发布时间: '2026-08-31', '项目总投资（元）': '2亿元', 建设单位: [{ 企业ID: 'e-3', 企业名称: '某科技公司' }],
    }],
  })
  const normalized = normalizeQccSources({
    tender, proposed,
    sources: { tender: { status: 'succeeded', loaded: 2 }, proposed: { status: 'succeeded', loaded: 1 } },
    createdAt: '2026-09-01T08:00:00.000+08:00',
  })
  const querySpec = await transaction.stageJson('query-spec', 'query.json', {
    schemaVersion: 2, origin: { kind: 'conversation' }, projectionRevision: 0,
    scope: 'combined', target: '数据与云项目', tender: { keywords: ['数据'] }, proposed: { keywords: ['数据'] },
  })
  const normalizedRef = await transaction.stageJson('normalized-data', 'normalized.json', normalized, normalized.rows.length)
  const baseRows = analysisBaseRows(normalized)
  const reviewRows = baseRows.map((row, index) => ReviewRecordV1Schema.parse({
    ...row,
    review: index === 0 && options.pending ? { decision: 'pending', note: '' }
      : index === 2 ? { decision: 'watch', note: '持续观察' }
        : { decision: 'confirmed-candidate', note: '' },
  }))
  const review = ReviewDatasetV1Schema.parse({
    schemaVersion: 1,
    activeDatasetId: normalizedRef.id,
    revision: 1,
    updatedAt: '2026-09-01T08:20:00.000+08:00',
    revertedOperationCount: 0,
    operations: [],
    rows: reviewRows,
  })
  const reviewRef = await transaction.stageJson('review-data', 'review.json', review, review.rows.length)
  await transaction.save(emptyIntentReceiptManifest())
  let projection: TenderWorkflowProjectionV2 = TenderWorkflowProjectionV2Schema.parse({
    ...createEmptyTenderWorkflowProjection(),
    revision: 3,
    currentStage: 'review',
    stages: {
      ...createEmptyTenderWorkflowProjection().stages,
      query: { status: 'succeeded', updatedAt: normalized.createdAt },
      overview: { status: 'succeeded', updatedAt: normalized.createdAt },
      review: { status: 'succeeded', updatedAt: review.updatedAt },
    },
    query: {
      scope: 'combined', targetSummary: '数据与云项目', querySpec,
      sources: { tender: { status: 'succeeded', loaded: 2 }, proposed: { status: 'succeeded', loaded: 1 } },
      normalizedData: normalizedRef, sourceRecordCount: 3, total: 3, duplicateCount: 0, invalidCount: 0,
    },
    review: {
      revision: review.revision, data: reviewRef,
      pending: reviewRows.filter(row => row.review.decision === 'pending').length,
      confirmedCandidate: reviewRows.filter(row => row.review.decision === 'confirmed-candidate').length,
      watch: reviewRows.filter(row => row.review.decision === 'watch').length,
      exclude: 0, canRevert: false,
    },
  })
  let failExcel = options.failExcel ?? false
  const renderers = {
    excel: vi.fn(async () => {
      if (failExcel) throw new Error('excel failed')
      return { fileName: 'report.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: Buffer.from([1]) }
    }),
    pdf: vi.fn(async () => ({ fileName: 'report.pdf', mediaType: 'application/pdf', bytes: Buffer.from([2]) })),
  }
  const dependencies = {
    sessionProjections: { stateOf: () => projection } as never,
    sessionPersistence: persistence,
    receipts: new IntentReceiptCoordinator(),
    renderers,
  }
  const contextTool = createTenderWorkbenchReportNarrativeContextTool(dependencies)
  const createTool = createTenderWorkbenchCreateReportTool(dependencies)
  const retryTool = createTenderWorkbenchRetryReportTool(dependencies)
  const setUser = (seq: number, text: string) => {
    events.splice(0, events.length, {
      type: 'user/message', seq, time: seq,
      data: { turn: seq, source: { kind: 'user' }, content: [{ type: 'text', text }] },
    })
  }
  const runContext = (label: string): ToolRunContext => ({
    callId: `call-${label}`, rootCallId: `call-${label}`, token: Symbol(label),
    signal: new AbortController().signal, agent: { id: sessionId, session },
  } as unknown as ToolRunContext)
  const binding = () => ({
    schemaVersion: 2 as const,
    origin: { kind: 'conversation' as const },
    activeDatasetRef: projection.query!.normalizedData!.id,
    projectionRevision: projection.revision,
    basis: { kind: 'dataset-only' as const },
    reviewArtifactRef: projection.review!.data.id,
    reviewRevision: projection.review!.revision,
  })
  return {
    contextTool, createTool, retryTool, runContext, setUser, binding, renderers,
    projection: () => projection,
    adopt: (state: TenderWorkflowProjectionV2) => { projection = state },
    allowExcel: () => { failExcel = false },
  }
}

function narrativeFor(context: ReportNarrativeContextResultV2['context']) {
  return {
    executiveSummary: {
      title: '当前范围观察', statement: '已确认范围包含需要近期核验的记录。',
      metricRefs: [context.metrics[0]!.metricId],
      recordRefs: context.priorityRecords.slice(0, 1).map(record => record.recordRef),
      limitations: ['一个项目可以包含多个来源事实。'],
    },
    keyFindings: [], priorityVerification: [], risksAndLimitations: [],
  }
}

describe('S5.6 report context, create, and retry Tools', () => {
  it('returns bounded context and creates a bound-narrative partial report', async () => {
    const test = await harness({ pending: true })
    test.setUser(1, '按当前进度生成带补充观察的报告')
    const context = await test.contextTool.execute(test.binding(), test.runContext('context')) as ReportNarrativeContextResultV2
    expect(context).toMatchObject({
      tool: 'tender_workbench_get_report_narrative_context',
      context: { contextFingerprint: expect.stringMatching(/^rc_[a-f0-9]{64}$/u) },
      control: { status: 'continue', nextTool: 'tender_workbench_create_report' },
    })
    expect(context.context.priorityRecords.length).toBeLessThanOrEqual(10)
    const created = await test.createTool.execute({
      ...test.binding(), scope: 'current-progress', confirmPending: true,
      narrative: {
        kind: 'bound', contextFingerprint: context.context.contextFingerprint,
        contextAsOf: context.context.createdAt, value: narrativeFor(context.context),
      },
    }, test.runContext('create')) as CreateReportResultV2
    expect(created).toMatchObject({
      tool: 'tender_workbench_create_report', outcome: 'succeeded',
      result: { completeness: 'partial' },
      progress: { succeeded: 2, failed: 0 },
      control: { status: 'complete' },
    })
    expect(created.state.report?.narrativeIncluded).toBe(true)
  })

  it('creates a deterministic report without requiring narrative context', async () => {
    const test = await harness()
    test.setUser(1, '生成完整报告，不需要补充叙述')
    const created = await test.createTool.execute({
      ...test.binding(), scope: 'complete', confirmPending: false, narrative: { kind: 'none' },
    }, test.runContext('create')) as CreateReportResultV2
    expect(created.state.report).toMatchObject({ completeness: 'complete', narrativeIncluded: false })
    expect(test.renderers.excel).toHaveBeenCalledOnce()
    expect(test.renderers.pdf).toHaveBeenCalledOnce()
  })

  it('rejects stale narrative fingerprints and an unconfirmed partial range', async () => {
    const test = await harness({ pending: true })
    test.setUser(1, '生成报告')
    const context = await test.contextTool.execute(test.binding(), test.runContext('context')) as ReportNarrativeContextResultV2
    await expect(test.createTool.execute({
      ...test.binding(), scope: 'current-progress', confirmPending: true,
      narrative: {
        kind: 'bound', contextFingerprint: `rc_${'0'.repeat(64)}`,
        contextAsOf: context.context.createdAt, value: narrativeFor(context.context),
      },
    }, test.runContext('stale'))).rejects.toThrow('指纹')
    await expect(test.createTool.execute({
      ...test.binding(), scope: 'complete', confirmPending: false, narrative: { kind: 'none' },
    }, test.runContext('unconfirmed'))).rejects.toThrow('明确确认')
  })

  it('identifies the exact narrative field and numeric token that must be corrected', async () => {
    const test = await harness()
    test.setUser(1, '生成带补充观察的完整报告')
    const context = await test.contextTool.execute(test.binding(), test.runContext('context')) as ReportNarrativeContextResultV2
    const narrative = narrativeFor(context.context)
    await expect(test.createTool.execute({
      ...test.binding(), scope: 'complete', confirmPending: false,
      narrative: {
        kind: 'bound', contextFingerprint: context.context.contextFingerprint,
        contextAsOf: context.context.createdAt,
        value: {
          ...narrative,
          executiveSummary: { ...narrative.executiveSummary, statement: '当前范围包含 3 个待核验项目。' },
        },
      },
    }, test.runContext('numeric-narrative'))).rejects.toThrow('observation[0].statement 命中数值“3”')
  })

  it('retries only a failed format from the same immutable snapshot', async () => {
    const test = await harness({ failExcel: true })
    test.setUser(1, '生成完整报告')
    const created = await test.createTool.execute({
      ...test.binding(), scope: 'complete', confirmPending: false, narrative: { kind: 'none' },
    }, test.runContext('create')) as CreateReportResultV2
    expect(created).toMatchObject({ outcome: 'partial', progress: { succeeded: 1, failed: 1 } })
    test.adopt(created.state)
    test.allowExcel()
    test.setUser(2, '重试失败的 Excel')
    const retried = await test.retryTool.execute({
      schemaVersion: 2,
      origin: { kind: 'conversation' },
      projectionRevision: created.state.revision,
      finalSnapshotId: created.result.finalSnapshotId,
      formats: ['excel'],
    }, test.runContext('retry')) as RetryReportResultV2
    expect(retried).toMatchObject({
      tool: 'tender_workbench_retry_report', outcome: 'succeeded',
      result: { finalSnapshotId: created.result.finalSnapshotId },
      progress: { succeeded: 2, failed: 0 },
    })
    expect(retried.result.finalSnapshotArtifactRef).toBe(created.result.finalSnapshotArtifactRef)
    test.adopt(retried.state)
    test.setUser(3, '重试已经成功的 PDF')
    await expect(test.retryTool.execute({
      schemaVersion: 2, origin: { kind: 'conversation' }, projectionRevision: retried.state.revision,
      finalSnapshotId: created.result.finalSnapshotId, formats: ['pdf'],
    }, test.runContext('bad-retry'))).rejects.toThrow('只能重试失败格式')
  })

  it('stores only the immutable V2 report snapshot contract', async () => {
    const test = await harness()
    test.setUser(1, '生成报告')
    const created = await test.createTool.execute({
      ...test.binding(), scope: 'complete', confirmPending: false, narrative: { kind: 'none' },
    }, test.runContext('create')) as CreateReportResultV2
    const report = created.state.report
    if (report?.finalSnapshot === undefined) throw new Error('missing final snapshot')
    const transaction = createArtifactTransaction(
      { locate: () => ({ kind: 'jsonl', path: join(temporaryRoots.at(-1)!, 'session.jsonl') }) },
      { version: 0, id: 'session-report-test' as SessionId, createdAt: 1 },
    )
    await transaction.load()
    const snapshot = ReportDatasetSchema.parse(
      await transaction.readJsonArtifact(report.finalSnapshot.id, 'final-snapshot'),
    )
    expect(snapshot).toMatchObject({ schemaVersion: 2, finalSnapshotId: created.result.finalSnapshotId })
  })
})
