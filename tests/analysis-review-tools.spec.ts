import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { ruleDraftFingerprint } from '../src/contracts/screening.ts'
import type { TenderRuleV1, TenderWorkflowProjectionV2 } from '../src/contracts/workflow.ts'
import { TenderWorkflowProjectionV2Schema, createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import { IntentReceiptCoordinator, emptyIntentReceiptManifest } from '../src/host/artifacts/intent-receipts.ts'
import { createArtifactTransaction, type SessionPersistenceLocator } from '../src/host/artifacts/store.ts'
import { adaptQccTenderPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { normalizeQccSources } from '../src/host/pipeline/normalize.ts'
import { classifyTenderProjects, createClassifiedDataset } from '../src/host/pipeline/classify.ts'
import {
  createTenderWorkbenchAnalysisRecordContextTool,
  createTenderWorkbenchApplyReviewTool,
  createTenderWorkbenchCommitAnalysisBatchTool,
  createTenderWorkbenchPrepareAnalysisBatchTool,
  createTenderWorkbenchRevertReviewTool,
  type CommitAnalysisResultV2,
  type PrepareAnalysisResultV2,
  type ReviewMutationResultV2,
} from '../src/host/tools/analysis-review-tools.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function rules(action: TenderRuleV1['action'] = 'include'): readonly TenderRuleV1[] {
  return [{
    id: 'all-data', name: '数据项目', enabled: true, action,
    sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 100,
    exceptions: [], reason: '测试规则',
  }]
}

async function harness(count = 13, action: TenderRuleV1['action'] = 'include') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tender-analysis-'))
  temporaryRoots.push(root)
  const transcript = join(root, 'session.jsonl')
  await writeFile(transcript, 'transcript\n', 'utf8')
  const sessionId = 'session-analysis-test' as SessionId
  const events: unknown[] = []
  const session = { id: sessionId, header: { version: 0, id: sessionId, createdAt: 1 }, events }
  const persistence: SessionPersistenceLocator = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const transaction = createArtifactTransaction(persistence, session.header)
  await transaction.load()
  const tender = adaptQccTenderPayload({
    查询摘要: { 命中总数: count, 结果说明: '测试', 生效筛选: {} },
    标讯列表: Array.from({ length: count }, (_, index) => ({
      标讯ID: `t-${index + 1}`, 标题: `数据项目 ${index + 1}`, 信息类型: '招标公告',
      招采单位: [{ 企业ID: `e-${index + 1}`, 企业名称: `采购单位 ${index + 1}` }],
      发布时间: '2026-09-01', 投标截止时间: '2026-09-10',
    })),
  })
  const normalized = normalizeQccSources({
    tender,
    sources: { tender: { status: 'succeeded', loaded: count } },
    createdAt: '2026-09-01T00:00:00.000Z',
  })
  const selectedRules = rules(action)
  const run = classifyTenderProjects(normalized.rows, selectedRules)
  const ruleSetVersion = `rsv-${ruleDraftFingerprint(selectedRules)}`
  const classified = createClassifiedDataset({
    activeDatasetId: 'pending', ruleSetVersion, classifiedAt: '2026-09-01T00:00:00.000Z', run,
  })
  const querySpec = await transaction.stageJson('query-spec', 'query.json', {
    schemaVersion: 2, origin: { kind: 'conversation' }, projectionRevision: 0,
    scope: 'tender', target: '数据项目', tender: { keywords: ['数据'] },
  })
  const normalizedRef = await transaction.stageJson('normalized-data', 'normalized.json', normalized, normalized.rows.length)
  const classifiedValue = { ...classified, activeDatasetId: normalizedRef.id }
  const classifiedRef = await transaction.stageJson('classified-data', 'classified.json', classifiedValue, classified.rows.length)
  await transaction.save(emptyIntentReceiptManifest())
  let projection: TenderWorkflowProjectionV2 = TenderWorkflowProjectionV2Schema.parse({
    ...createEmptyTenderWorkflowProjection(),
    revision: 2,
    currentStage: 'classification',
    stages: {
      ...createEmptyTenderWorkflowProjection().stages,
      query: { status: 'succeeded', updatedAt: '2026-09-01T00:00:00.000Z' },
      overview: { status: 'succeeded', updatedAt: '2026-09-01T00:00:00.000Z' },
      rules: { status: 'succeeded', updatedAt: '2026-09-01T00:00:00.000Z' },
      classification: { status: 'succeeded', updatedAt: '2026-09-01T00:00:00.000Z' },
    },
    query: {
      scope: 'tender', targetSummary: '数据项目', querySpec,
      sources: { tender: { status: 'succeeded', loaded: count } },
      normalizedData: normalizedRef, sourceRecordCount: count, total: count,
      duplicateCount: 0, invalidCount: 0,
    },
    rules: {
      ruleSetVersion, ruleCount: selectedRules.length, rawMatches: run.rawMatches,
      covered: run.covered, conflicts: run.conflicts,
    },
    classification: {
      data: classifiedRef,
      include: run.counts.include, observe: run.counts.observe,
      manualReview: run.counts.manualReview, exclude: run.counts.exclude,
      unmatched: run.counts.unmatched, covered: run.covered, conflicts: run.conflicts,
      ruleSetVersion, activeDatasetId: normalizedRef.id,
    },
  })
  const receipts = new IntentReceiptCoordinator()
  const dependencies = {
    sessionProjections: { stateOf: () => projection } as never,
    sessionPersistence: persistence,
    receipts,
  }
  const tools = {
    prepare: createTenderWorkbenchPrepareAnalysisBatchTool(dependencies),
    commit: createTenderWorkbenchCommitAnalysisBatchTool(dependencies),
    recordContext: createTenderWorkbenchAnalysisRecordContextTool(dependencies),
    apply: createTenderWorkbenchApplyReviewTool(dependencies),
    revert: createTenderWorkbenchRevertReviewTool(dependencies),
  }
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
  return {
    ...tools, runContext, setUser,
    projection: () => projection,
    adopt: (state: TenderWorkflowProjectionV2) => { projection = state },
  }
}

function analysisInput(test: Awaited<ReturnType<typeof harness>>) {
  const state = test.projection()
  const classification = state.classification
  const active = state.query?.normalizedData
  if (classification === undefined || active === undefined) throw new Error('missing analysis binding')
  return {
    schemaVersion: 2 as const,
    origin: { kind: 'conversation' as const },
    activeDatasetRef: active.id,
    classificationArtifactRef: classification.data.id,
    ruleSetVersion: classification.ruleSetVersion,
    projectionRevision: state.revision,
    scope: { kind: 'all-eligible' as const },
  }
}

function recommendations(batch: PrepareAnalysisResultV2['batch']) {
  return batch.records.map(record => ({
    recordRef: record.recordRef,
    recommendation: 'priority-review' as const,
    evidenceRefs: [record.evidence[0]!.ref],
    reason: '来源事实支持优先人工核验。',
    verificationItems: ['核验公告当前状态。'],
    limitations: ['仅使用本批次有界证据。'],
  }))
}

describe('S5.6 analysis and review Tools', () => {
  it('runs every eligible record through stable prepare/commit batches until complete', async () => {
    const test = await harness(13)
    test.setUser(10, '分析全部候选')
    const first = await test.prepare.execute(analysisInput(test), test.runContext('prepare-1')) as PrepareAnalysisResultV2
    expect(first.batch.records).toHaveLength(12)
    expect(first.progress).toMatchObject({
      completed: 0, eligibleTotal: 13, remaining: 13,
      recommendationCounts: { priorityReview: 0, watch: 0, notRecommended: 0 },
    })
    expect(first.control).toEqual({ status: 'continue', nextTool: 'tender_workbench_commit_analysis_batch' })
    test.adopt(first.state)

    const committed = await test.commit.execute({
      ...analysisInput(test), batchId: first.batch.batchId, recommendations: recommendations(first.batch),
    }, test.runContext('commit-1')) as CommitAnalysisResultV2
    expect(committed.progress).toMatchObject({
      completed: 12, eligibleTotal: 13, remaining: 1,
      recommendationCounts: { priorityReview: 12, watch: 0, notRecommended: 0 },
    })
    expect(committed.control).toEqual({ status: 'continue', nextTool: 'tender_workbench_prepare_analysis_batch' })
    test.adopt(committed.state)

    const second = await test.prepare.execute(analysisInput(test), test.runContext('prepare-2')) as PrepareAnalysisResultV2
    expect(second.batch.records).toHaveLength(1)
    test.adopt(second.state)
    const completed = await test.commit.execute({
      ...analysisInput(test), batchId: second.batch.batchId, recommendations: recommendations(second.batch),
    }, test.runContext('commit-2')) as CommitAnalysisResultV2
    expect(completed.progress).toMatchObject({
      completed: 13, eligibleTotal: 13, remaining: 0,
      recommendationCounts: { priorityReview: 13, watch: 0, notRecommended: 0 },
    })
    expect(completed.control).toEqual({ status: 'complete' })
    expect(completed.state.stages.analysis.status).toBe('succeeded')
  })

  it('materializes a true 0/0 terminal state without calling commit', async () => {
    const test = await harness(3, 'exclude')
    test.setUser(10, '分析全部可分析候选')
    const result = await test.prepare.execute(analysisInput(test), test.runContext('prepare-zero')) as PrepareAnalysisResultV2
    expect(result.batch.records).toEqual([])
    expect(result.progress).toMatchObject({
      completed: 0, eligibleTotal: 0, remaining: 0,
      recommendationCounts: { priorityReview: 0, watch: 0, notRecommended: 0 },
    })
    expect(result.control).toEqual({ status: 'complete' })
    expect(result.state).toMatchObject({
      stages: { analysis: { status: 'succeeded' } },
      analysis: { completed: 0, eligibleTotal: 0 },
    })
  })

  it('rejects unknown evidence and prohibited business predictions', async () => {
    const test = await harness(1)
    test.setUser(10, '分析候选')
    const prepared = await test.prepare.execute(analysisInput(test), test.runContext('prepare')) as PrepareAnalysisResultV2
    test.adopt(prepared.state)
    const valid = recommendations(prepared.batch)
    await expect(test.commit.execute({
      ...analysisInput(test), batchId: prepared.batch.batchId,
      recommendations: [{ ...valid[0]!, evidenceRefs: ['unknown-evidence'] }],
    }, test.runContext('bad-evidence'))).rejects.toThrow('evidenceRef')
    await expect(test.commit.execute({
      ...analysisInput(test), batchId: prepared.batch.batchId,
      recommendations: [{ ...valid[0]!, reason: '预计中标概率很高。' }],
    }, test.runContext('bad-claim'))).rejects.toThrow(/reason 命中禁用术语“中标概率”.*新 Intent/u)
    await expect(test.commit.execute({
      ...analysisInput(test), batchId: prepared.batch.batchId,
      recommendations: [{ ...valid[0]!, limitations: ['公告预算不等于利润。'] }],
    }, test.runContext('bad-disclaimer'))).rejects.toThrow(/limitations 命中禁用术语“利润”.*新 Intent/u)
  })

  it('returns current record context and applies heterogeneous decisions with exact latest-operation revert', async () => {
    const test = await harness(2)
    test.setUser(10, '分析候选')
    const prepared = await test.prepare.execute(analysisInput(test), test.runContext('prepare')) as PrepareAnalysisResultV2
    test.adopt(prepared.state)
    const committed = await test.commit.execute({
      ...analysisInput(test), batchId: prepared.batch.batchId, recommendations: recommendations(prepared.batch),
    }, test.runContext('commit')) as CommitAnalysisResultV2
    test.adopt(committed.state)
    const firstRef = prepared.batch.records[0]!.recordRef
    const secondRef = prepared.batch.records[1]!.recordRef
    const { scope: _scope, ...recordBinding } = analysisInput(test)
    const recordContext = await test.recordContext.execute({
      ...recordBinding,
      origin: { kind: 'autonomous' },
      analysisVersion: committed.state.analysis?.version,
      recordRef: firstRef,
    }, test.runContext('record'))
    expect(recordContext).toMatchObject({
      tool: 'tender_workbench_get_analysis_record_context',
      context: { record: { recordRef: firstRef }, recommendation: { recommendation: 'priority-review' } },
      control: { status: 'complete' },
    })

    test.setUser(11, '保存两条人工决定')
    const review = committed.state.review
    if (review === undefined) throw new Error('missing review state')
    const reviewBinding = {
      schemaVersion: 2 as const,
      origin: { kind: 'conversation' as const },
      activeDatasetRef: committed.state.query!.normalizedData!.id,
      projectionRevision: committed.state.revision,
      basis: {
        kind: 'classified' as const,
        classificationArtifactRef: committed.state.classification!.data.id,
        ruleSetVersion: committed.state.classification!.ruleSetVersion,
        analysisVersion: committed.state.analysis!.version,
      },
      reviewArtifactRef: review.data.id,
      reviewRevision: review.revision,
    }
    const applied = await test.apply.execute({
      ...reviewBinding,
      decisions: [
        { recordRef: firstRef, decision: 'confirmed-candidate', note: '正式候选' },
        { recordRef: secondRef, decision: 'watch', note: '继续观察' },
      ],
    }, test.runContext('review')) as ReviewMutationResultV2
    expect(applied.state.review).toMatchObject({
      pending: 0, confirmedCandidate: 1, watch: 1,
      latestOperationRef: applied.result.operationRef,
    })
    test.adopt(applied.state)

    test.setUser(12, '撤销最近复核')
    await expect(test.revert.execute({
      ...reviewBinding,
      projectionRevision: applied.state.revision,
      reviewArtifactRef: applied.state.review!.data.id,
      reviewRevision: applied.state.review!.revision,
      latestOperationRef: 'not-latest',
    }, test.runContext('bad-revert'))).rejects.toThrow('最近一次')
    const reverted = await test.revert.execute({
      ...reviewBinding,
      projectionRevision: applied.state.revision,
      reviewArtifactRef: applied.state.review!.data.id,
      reviewRevision: applied.state.review!.revision,
      latestOperationRef: applied.result.operationRef,
    }, test.runContext('revert')) as ReviewMutationResultV2
    expect(reverted.state.review).toMatchObject({ pending: 2, canRevert: false })
    expect(reverted.state.review?.latestOperationRef).toBeUndefined()
  })
})
