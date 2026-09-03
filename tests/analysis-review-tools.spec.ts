import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnalysisDatasetV1Schema,
  ReviewDatasetV1Schema,
  type AnalysisCommitCommandV1,
  type AnalysisNextCommandV1,
  type ApplyReviewCommandV1,
  type RevertReviewCommandV1,
} from '../src/contracts/analysis-review.ts'
import type { TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
import { CommandReceiptCoordinator } from '../src/host/artifacts/command-receipts.ts'
import { readArtifactManifest, readManifestArtifact, sessionArtifactRoot } from '../src/host/artifacts/store.ts'
import {
  createTenderWorkbenchAnalysisCommitTool,
  createTenderWorkbenchAnalysisNextTool,
  createTenderWorkbenchApplyReviewTool,
  createTenderWorkbenchRevertReviewTool,
  type AnalysisNextResultV1,
  type AnalysisReviewMutationResultV1,
} from '../src/host/tools/analysis-review-tools.ts'
import { createTenderWorkbenchQueryTool, type QueryToolResultV1 } from '../src/host/tools/query-tool.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function success(payload: JsonValue): ToolExecutionResult {
  return { isError: false, value: { content: [], structuredContent: payload }, content: [{ type: 'text', text: 'ok' }] }
}

function qccPayload(): JsonValue {
  return {
    查询摘要: { 命中总数: 4, 结果说明: 'S4 测试数据', 生效筛选: { keywords: ['数据'] } },
    标讯列表: [
      { 标讯ID: 't-1', 标题: '数据治理平台项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-1', 企业名称: '某银行' }], 发布时间: '2026-08-29', 投标截止时间: '2026-09-20', 预算金额: '860万元' },
      { 标讯ID: 't-2', 标题: '数据仓库升级项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-2', 企业名称: '某银行' }], 发布时间: '2026-08-30' },
      { 标讯ID: 't-3', 标题: '云平台采购项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-3', 企业名称: '某集团' }], 发布时间: '2026-08-31' },
      { 标讯ID: 't-4', 标题: '普通采购项目', 信息类型: '招标公告', 招采单位: [], 发布时间: 'bad-date' },
    ],
  }
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tender-s4-'))
  temporaryRoots.push(root)
  const transcript = join(root, 'session.jsonl')
  await writeFile(transcript, 'transcript-sentinel\n', 'utf8')
  const sessionId = 'session-s4-test' as SessionId
  const session = { id: sessionId, header: { version: 0, id: sessionId, createdAt: 1 } }
  let projection: TenderWorkflowProjectionV1 | null = null
  const persistence = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const receipts = new CommandReceiptCoordinator()
  const sessionProjections = { stateOf: () => projection }
  const query = createTenderWorkbenchQueryTool({
    tools: { execute: vi.fn(async () => success(qccPayload())) } as never,
    sessionProjections: sessionProjections as never,
    sessionPersistence: persistence,
    receipts,
  })
  const dependencies = { sessionProjections: sessionProjections as never, sessionPersistence: persistence, receipts }
  const next = createTenderWorkbenchAnalysisNextTool(dependencies)
  const commit = createTenderWorkbenchAnalysisCommitTool(dependencies)
  const apply = createTenderWorkbenchApplyReviewTool(dependencies)
  const revert = createTenderWorkbenchRevertReviewTool(dependencies)
  const context = (commandId: string): ToolRunContext => ({
    callId: `call-${commandId}`, rootCallId: `call-${commandId}`, token: Symbol(commandId),
    signal: new AbortController().signal, agent: { id: sessionId, session },
  } as unknown as ToolRunContext)
  const queryResult = await query.execute({
    schemaVersion: 1, commandId: 'query-1', kind: 'query.start', scope: 'tender',
    target: '寻找数据项目', tender: { keywords: ['数据'] },
  }, context('query-1')) as QueryToolResultV1
  projection = queryResult.state
  const recordIds = queryResult.screeningContext?.samples.map(sample => sample.recordId).sort() ?? []
  return {
    session, persistence, next, commit, apply, revert, context,
    recordIds,
    projection: () => projection,
    adopt: (state: TenderWorkflowProjectionV1) => { projection = state },
  }
}

function nextArgs(test: Awaited<ReturnType<typeof harness>>, recordRefs: readonly string[], commandId = 'analysis-1'): AnalysisNextCommandV1 {
  const state = test.projection()
  const active = state?.query?.normalizedData
  if (active === undefined) throw new Error('missing active dataset')
  return {
    schemaVersion: 1,
    kind: 'analysis.next',
    commandId,
    activeDatasetRef: active.id,
    projectionRevision: state?.revision ?? 0,
    scope: { kind: 'records', recordRefs: [...recordRefs] },
    batchSize: 12,
  }
}

describe('S4 bounded Agent analysis and independent human review', () => {
  it('returns a stable bounded batch, validates evidence refs, and never creates a user decision', async () => {
    const test = await harness()
    const ids = test.recordIds.slice(0, 2)
    const input = nextArgs(test, ids)
    const first = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    const repeated = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    expect(repeated.batch).toEqual(first.batch)
    expect(first.batch.records.map(row => row.recordRef)).toEqual(ids)
    expect(first.batch.records).toHaveLength(2)
    const rendered = test.next.output.render(input, first)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toMatchObject({ type: 'text' })
    if (rendered[0]?.type !== 'text') throw new Error('analysis batch must render as text')
    expect(rendered[0].text).toContain(first.batch.batchId)
    expect(rendered[0].text).toContain(first.batch.records[0]?.recordRef)
    expect(rendered[0].text).toContain(first.batch.records[0]?.evidence[0]?.ref)
    expect(rendered[0].text).toContain('recordRef、recommendation、evidenceRefs、reason、verificationItems、limitations')
    expect(rendered[0].text).toContain('不要使用 decision、verification')
    const commitDefinition = test.commit as unknown as { readonly parameters: Readonly<Record<string, unknown>> }
    expect(commitDefinition.parameters['recommendations']).toMatchObject({
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recommendation: { type: 'string', enum: ['priority-review', 'watch', 'not-recommended'], required: true },
          evidenceRefs: { type: 'array', items: { type: 'string' }, required: true },
          verificationItems: { type: 'array', items: { type: 'string' }, required: true },
          limitations: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
    })

    const recommendations = first.batch.records.map((row, index) => ({
      recordRef: row.recordRef,
      recommendation: index === 0 ? 'priority-review' as const : 'watch' as const,
      evidenceRefs: [row.evidence[0]!.ref, row.evidence.at(-1)!.ref],
      reason: '本次查询方向相关，需由用户继续核验。',
      verificationItems: ['核验资格要求和交付范围'],
      limitations: ['没有企业能力画像，不能判断资格符合或中标概率'],
    }))
    const commitInput: AnalysisCommitCommandV1 = {
      schemaVersion: 1, kind: 'analysis.commit', commandId: input.commandId,
      activeDatasetRef: input.activeDatasetRef, projectionRevision: input.projectionRevision,
      scope: input.scope, batchSize: input.batchSize, batchId: first.batch.batchId,
      recommendations,
    }
    await expect(test.commit.execute({
      ...commitInput,
      commandId: 'bad-evidence',
      recommendations: recommendations.map((value, index) => index === 0 ? { ...value, evidenceRefs: ['ev:unknown:value'] } : value),
    }, test.context('bad-evidence'))).rejects.toThrow('evidenceRef')
    const committed = await test.commit.execute(commitInput, test.context(commitInput.commandId)) as AnalysisReviewMutationResultV1
    expect(committed.state.analysis).toMatchObject({ total: 4, completed: 2, priorityReview: 1, watch: 1, notRecommended: 0 })
    expect(committed.state.review).toMatchObject({ pending: 4, confirmedCandidate: 0, watch: 0, exclude: 0, canRevert: false })
    expect(committed.state.stages.review.status).toBe('not-started')

    const root = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(root)
    const analysisEntry = manifest.artifacts[committed.state.analysis?.data?.id ?? '']
    const reviewEntry = manifest.artifacts[committed.state.review?.data.id ?? '']
    if (analysisEntry === undefined || reviewEntry === undefined) throw new Error('missing S4 artifacts')
    const analysis = AnalysisDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, analysisEntry)).toString('utf8')) as unknown)
    const review = ReviewDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, reviewEntry)).toString('utf8')) as unknown)
    expect(analysis.rows.filter(row => row.recommendation !== undefined)).toHaveLength(2)
    expect(review.rows.every(row => row.review.decision === 'pending')).toBe(true)
    expect(review.rows.find(row => row.project.recordId === ids[0])?.recommendation?.recommendation).toBe('priority-review')
  })

  it('supports unanalyzed single/batch decisions, notes, pending restore, and replayable latest-operation revert', async () => {
    const test = await harness()
    const state = test.projection()
    const active = state?.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    const apply = async (commandId: string, recordRefs: readonly string[], decision: ApplyReviewCommandV1['decision'], note: string) => {
      const current = test.projection()
      const input: ApplyReviewCommandV1 = {
        schemaVersion: 1, kind: 'review.apply', commandId,
        activeDatasetRef: active.id, projectionRevision: current?.revision ?? 0,
        recordRefs: [...recordRefs], decision, note,
      }
      const result = await test.apply.execute(input, test.context(commandId)) as AnalysisReviewMutationResultV1
      test.adopt(result.state)
      return result
    }
    const [firstId, secondId, thirdId] = test.recordIds
    if (firstId === undefined || secondId === undefined || thirdId === undefined) throw new Error('missing record ids')
    const first = await apply('review-1', [firstId], 'confirmed-candidate', '纳入候选，但仍需核验资格。')
    expect(first.state.review).toMatchObject({ confirmedCandidate: 1, pending: 3, canRevert: true })
    const second = await apply('review-2', [secondId, thirdId], 'watch', '批量观察。')
    expect(second.state.review).toMatchObject({ confirmedCandidate: 1, watch: 2, pending: 1 })
    const restored = await apply('review-3', [firstId], 'pending', '暂不决定。')
    expect(restored.state.review).toMatchObject({ confirmedCandidate: 0, watch: 2, pending: 2 })

    const current = test.projection()
    const revertInput: RevertReviewCommandV1 = {
      schemaVersion: 1, kind: 'review.revert', commandId: 'review-revert-1',
      activeDatasetRef: active.id, projectionRevision: current?.revision ?? 0,
    }
    const reverted = await test.revert.execute(revertInput, test.context(revertInput.commandId)) as AnalysisReviewMutationResultV1
    test.adopt(reverted.state)
    expect(reverted.state.review).toMatchObject({ confirmedCandidate: 1, watch: 2, pending: 1, canRevert: true })

    const replay = await test.revert.execute(revertInput, test.context(revertInput.commandId)) as AnalysisReviewMutationResultV1
    expect(replay).toEqual(reverted)
    const root = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(root)
    const entry = manifest.artifacts[reverted.state.review?.data.id ?? '']
    if (entry === undefined) throw new Error('missing review artifact')
    const dataset = ReviewDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, entry)).toString('utf8')) as unknown)
    expect(dataset.rows.find(row => row.project.recordId === firstId)?.review).toEqual({ decision: 'confirmed-candidate', note: '纳入候选，但仍需核验资格。' })
    expect(dataset.revertedOperationCount).toBe(1)
  })

  it('rejects stale revisions, unknown records, mismatched batches, and classification scope without classification', async () => {
    const test = await harness()
    const firstId = test.recordIds[0]
    if (firstId === undefined) throw new Error('missing record id')
    const input = nextArgs(test, [firstId])
    await expect(test.next.execute({
      ...input,
      scope: { kind: 'classifications', classifications: ['include'] },
    }, test.context('classification-without-rules'))).rejects.toThrow('classification')
    await expect(test.next.execute({
      ...input,
      scope: { kind: 'records', recordRefs: ['missing-record'] },
    }, test.context('unknown-record'))).rejects.toThrow('未知 recordRef')
    await expect(test.next.execute({ ...input, projectionRevision: input.projectionRevision + 1 }, test.context('stale')))
      .rejects.toThrow('revision')

    const batch = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    await expect(test.commit.execute({
      schemaVersion: 1, kind: 'analysis.commit', commandId: 'wrong-batch',
      activeDatasetRef: input.activeDatasetRef, projectionRevision: input.projectionRevision,
      scope: input.scope, batchSize: input.batchSize, batchId: 'anb_wrong',
      recommendations: [{
        recordRef: firstId, recommendation: 'watch',
        evidenceRefs: [batch.batch.records[0]!.evidence[0]!.ref],
        reason: '相关但需要继续核验。', verificationItems: ['核验范围'], limitations: ['无企业画像'],
      }],
    }, test.context('wrong-batch'))).rejects.toThrow('batchId')
  })
})
