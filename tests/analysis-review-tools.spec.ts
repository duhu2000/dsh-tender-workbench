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
import {
  ClassifiedDatasetV1Schema,
  ruleDraftFingerprint,
  type ConfirmRulesCommandV1,
  type PreviewRulesCommandV1,
} from '../src/contracts/screening.ts'
import type { TenderRuleV1, TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
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
import {
  createTenderWorkbenchConfirmRulesTool,
  createTenderWorkbenchPreviewRulesTool,
  type RuleToolResultV1,
} from '../src/host/tools/rule-tools.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function success(payload: JsonValue): ToolExecutionResult {
  return { isError: false, value: { content: [], structuredContent: payload }, content: [{ type: 'text', text: 'ok' }] }
}

function qccPayload(eligibleCount: number): JsonValue {
  return {
    查询摘要: { 命中总数: eligibleCount + 2, 结果说明: 'S4 测试数据', 生效筛选: { keywords: ['数据'] } },
    标讯列表: [
      ...Array.from({ length: eligibleCount }, (_, index) => ({
        标讯ID: `t-data-${String(index + 1).padStart(2, '0')}`,
        标题: `数据治理平台项目 ${index + 1}`,
        信息类型: '招标公告',
        招采单位: [{ 企业ID: `e-${index + 1}`, 企业名称: '某银行' }],
        发布时间: '2026-08-29',
        ...(index === 0 ? { 投标截止时间: '2026-09-06', 预算金额: '860万元' } : {}),
      })),
      { 标讯ID: 't-excluded', 标题: '普通采购项目', 信息类型: '招标公告', 招采单位: [], 发布时间: 'bad-date' },
      { 标讯ID: 't-unmatched', 标题: '园区绿化项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-last', 企业名称: '某集团' }], 发布时间: '2026-08-31' },
    ],
  }
}

function rules(zeroEligible: boolean): readonly TenderRuleV1[] {
  return zeroEligible
    ? [
        { id: 'exclude-data', name: '排除数据方向', enabled: true, action: 'exclude', sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 100, exceptions: [], reason: '零可分析记录测试' },
        { id: 'exclude-normal', name: '排除普通采购', enabled: true, action: 'exclude', sources: ['tender'], scope: 'title', keywords: ['普通'], priority: 90, exceptions: [], reason: '零可分析记录测试' },
      ]
    : [
        { id: 'include-data', name: '数据方向', enabled: true, action: 'include', sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 100, exceptions: [], reason: '用户目标关注数据项目' },
        { id: 'exclude-normal', name: '排除普通采购', enabled: true, action: 'exclude', sources: ['tender'], scope: 'title', keywords: ['普通'], priority: 90, exceptions: [], reason: '用户明确排除普通采购' },
      ]
}

async function harness(options: { readonly eligibleCount?: number; readonly zeroEligible?: boolean } = {}) {
  const eligibleCount = options.eligibleCount ?? 15
  const zeroEligible = options.zeroEligible ?? false
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
    tools: { execute: vi.fn(async () => success(qccPayload(eligibleCount))) } as never,
    sessionProjections: sessionProjections as never,
    sessionPersistence: persistence,
    receipts,
  })
  const dependencies = { sessionProjections: sessionProjections as never, sessionPersistence: persistence, receipts }
  const preview = createTenderWorkbenchPreviewRulesTool(dependencies)
  const confirm = createTenderWorkbenchConfirmRulesTool(dependencies)
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
  const active = projection.query?.normalizedData
  if (active === undefined) throw new Error('missing active dataset')
  const draft = rules(zeroEligible)
  const previewInput: PreviewRulesCommandV1 = {
    schemaVersion: 1, commandId: 'preview-1', kind: 'rules.preview', origin: 'user',
    activeDatasetRef: active.id, projectionRevision: projection.revision,
    draftFingerprint: ruleDraftFingerprint(draft), rules: [...draft],
  }
  const previewResult = await preview.execute(previewInput, context(previewInput.commandId)) as RuleToolResultV1
  projection = previewResult.state
  const confirmInput: ConfirmRulesCommandV1 = {
    schemaVersion: 1, commandId: 'confirm-1', kind: 'rules.confirm',
    activeDatasetRef: active.id, projectionRevision: projection.revision,
    draftFingerprint: ruleDraftFingerprint(draft),
    previewArtifactId: projection.rules?.preview?.id ?? '', rules: [...draft],
  }
  const confirmResult = await confirm.execute(confirmInput, context(confirmInput.commandId)) as RuleToolResultV1
  projection = confirmResult.state
  const artifactRoot = sessionArtifactRoot(persistence, session.header)
  const manifest = await readArtifactManifest(artifactRoot)
  const classifiedEntry = manifest.artifacts[projection.classification?.data.id ?? '']
  if (classifiedEntry === undefined) throw new Error('missing classified artifact')
  const classified = ClassifiedDatasetV1Schema.parse(
    JSON.parse((await readManifestArtifact(artifactRoot, classifiedEntry)).toString('utf8')) as unknown,
  )
  const recordIds = classified.rows.map(row => row.project.recordId)
  const eligibleRecordIds = classified.rows
    .filter(row => row.classification === 'include' || row.classification === 'observe' || row.classification === 'manual-review')
    .map(row => row.project.recordId)
    .sort()
  const ineligibleRecordIds = classified.rows
    .filter(row => row.classification === 'exclude' || row.classification === 'unmatched')
    .map(row => row.project.recordId)
  return {
    session, persistence, next, commit, apply, revert, context,
    recordIds, eligibleRecordIds, ineligibleRecordIds,
    projection: () => projection,
    adopt: (state: TenderWorkflowProjectionV1) => { projection = state },
  }
}

function nextArgs(test: Awaited<ReturnType<typeof harness>>, commandId = 'analysis-1'): AnalysisNextCommandV1 {
  const state = test.projection()
  const active = state?.query?.normalizedData
  const classification = state?.classification
  if (active === undefined || classification === undefined) throw new Error('missing analysis binding')
  return {
    schemaVersion: 1,
    kind: 'analysis.next',
    commandId,
    activeDatasetRef: active.id,
    classificationArtifactRef: classification.data.id,
    ruleSetVersion: classification.ruleSetVersion,
    projectionRevision: state?.revision ?? 0,
    scope: { kind: 'all-eligible' },
  }
}

function recommendations(batch: AnalysisNextResultV1['batch']) {
  return batch.records.map((row, index) => ({
    recordRef: row.recordRef,
    recommendation: index === 0 ? 'priority-review' as const : 'watch' as const,
    evidenceRefs: [row.evidence[0]!.ref, row.evidence.at(-1)!.ref],
    reason: '本次查询方向相关，需由用户继续核验。',
    verificationItems: ['核验资格要求和交付范围'],
    limitations: ['没有企业能力画像，不能判断资格符合或中标概率'],
  }))
}

describe('S4 bounded Agent analysis and independent human review', () => {
  it('returns a stable bounded batch, validates evidence refs, and never creates a user decision', async () => {
    const test = await harness()
    const input = nextArgs(test)
    const first = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    const repeated = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    expect(repeated.batch).toEqual(first.batch)
    expect(first.batch.records.map(row => row.recordRef)).toEqual(test.eligibleRecordIds.slice(0, 12))
    expect(first.batch.records).toHaveLength(12)
    expect(first.batch).toMatchObject({ eligibleTotal: 15, completed: 0, remaining: 15 })
    expect(first.batch.records.every(row => row.classification === 'include')).toBe(true)
    expect(first.batch.records.every(row => !test.ineligibleRecordIds.includes(row.recordRef))).toBe(true)
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

    const firstRecommendations = recommendations(first.batch)
    const commitInput: AnalysisCommitCommandV1 = {
      schemaVersion: 1, kind: 'analysis.commit', commandId: input.commandId,
      activeDatasetRef: input.activeDatasetRef,
      classificationArtifactRef: input.classificationArtifactRef,
      ruleSetVersion: input.ruleSetVersion,
      projectionRevision: input.projectionRevision,
      scope: input.scope, batchId: first.batch.batchId,
      recommendations: firstRecommendations,
    }
    await expect(test.commit.execute({
      ...commitInput,
      commandId: 'bad-evidence',
      recommendations: firstRecommendations.map((value, index) => index === 0 ? { ...value, evidenceRefs: ['ev:unknown:value'] } : value),
    }, test.context('bad-evidence'))).rejects.toThrow('evidenceRef')
    const committed = await test.commit.execute(commitInput, test.context(commitInput.commandId)) as AnalysisReviewMutationResultV1
    const replayedCommit = await test.commit.execute(commitInput, test.context(commitInput.commandId)) as AnalysisReviewMutationResultV1
    expect(replayedCommit).toEqual(committed)
    expect(committed.progress).toEqual({ eligibleTotal: 15, completed: 12, remaining: 3, complete: false, projectionRevision: committed.state.revision })
    expect(committed.state.analysis).toMatchObject({ eligibleTotal: 15, completed: 12, priorityReview: 1, watch: 11, notRecommended: 0 })
    expect(committed.state.review).toMatchObject({ pending: 17, confirmedCandidate: 0, watch: 0, exclude: 0, canRevert: false })
    expect(committed.state.stages.review.status).toBe('not-started')

    test.adopt(committed.state)
    const resumeInput = nextArgs(test, input.commandId)
    const second = await test.next.execute(resumeInput, test.context(resumeInput.commandId)) as AnalysisNextResultV1
    expect(second.batch.records.map(row => row.recordRef)).toEqual(test.eligibleRecordIds.slice(12))
    expect(second.batch).toMatchObject({ eligibleTotal: 15, completed: 12, remaining: 3 })
    const finalInput: AnalysisCommitCommandV1 = {
      schemaVersion: 1, kind: 'analysis.commit', commandId: input.commandId,
      activeDatasetRef: resumeInput.activeDatasetRef,
      classificationArtifactRef: resumeInput.classificationArtifactRef,
      ruleSetVersion: resumeInput.ruleSetVersion,
      projectionRevision: resumeInput.projectionRevision,
      scope: resumeInput.scope, batchId: second.batch.batchId,
      recommendations: recommendations(second.batch),
    }
    const completed = await test.commit.execute(finalInput, test.context(finalInput.commandId)) as AnalysisReviewMutationResultV1
    expect(completed.progress).toEqual({ eligibleTotal: 15, completed: 15, remaining: 0, complete: true, projectionRevision: completed.state.revision })
    expect(completed.state.stages.analysis.status).toBe('succeeded')
    expect(completed.state.analysis).toMatchObject({ eligibleTotal: 15, completed: 15, priorityReview: 2, watch: 13 })

    const root = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(root)
    const analysisEntry = manifest.artifacts[completed.state.analysis?.data?.id ?? '']
    const reviewEntry = manifest.artifacts[completed.state.review?.data.id ?? '']
    if (analysisEntry === undefined || reviewEntry === undefined) throw new Error('missing S4 artifacts')
    const analysis = AnalysisDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, analysisEntry)).toString('utf8')) as unknown)
    const review = ReviewDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, reviewEntry)).toString('utf8')) as unknown)
    expect(analysis.eligibleTotal).toBe(15)
    expect(analysis.rows.filter(row => row.recommendation !== undefined)).toHaveLength(15)
    expect(analysis.rows.filter(row => row.classification === 'exclude' || row.classification === 'unmatched').every(row => row.recommendation === undefined)).toBe(true)
    expect(review.rows.every(row => row.review.decision === 'pending')).toBe(true)
    expect(review.rows.find(row => row.project.recordId === test.eligibleRecordIds[0])?.recommendation?.recommendation).toBe('priority-review')
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
        classificationArtifactRef: current?.classification?.data.id,
        ruleSetVersion: current?.classification?.ruleSetVersion,
        analysisVersion: current?.analysis?.version,
        recordRefs: [...recordRefs], decision, note,
      }
      const result = await test.apply.execute(input, test.context(commandId)) as AnalysisReviewMutationResultV1
      test.adopt(result.state)
      return result
    }
    const [firstId, secondId, thirdId] = test.recordIds
    if (firstId === undefined || secondId === undefined || thirdId === undefined) throw new Error('missing record ids')
    const first = await apply('review-1', [firstId], 'confirmed-candidate', '纳入候选，但仍需核验资格。')
    expect(first.state.review).toMatchObject({ confirmedCandidate: 1, pending: 16, canRevert: true })
    const second = await apply('review-2', [secondId, thirdId], 'watch', '批量观察。')
    expect(second.state.review).toMatchObject({ confirmedCandidate: 1, watch: 2, pending: 14 })
    const restored = await apply('review-3', [firstId], 'pending', '暂不决定。')
    expect(restored.state.review).toMatchObject({ confirmedCandidate: 0, watch: 2, pending: 15 })

    const current = test.projection()
    const revertInput: RevertReviewCommandV1 = {
      schemaVersion: 1, kind: 'review.revert', commandId: 'review-revert-1',
      activeDatasetRef: active.id, projectionRevision: current?.revision ?? 0,
      classificationArtifactRef: current?.classification?.data.id,
      ruleSetVersion: current?.classification?.ruleSetVersion,
      analysisVersion: current?.analysis?.version,
    }
    const reverted = await test.revert.execute(revertInput, test.context(revertInput.commandId)) as AnalysisReviewMutationResultV1
    test.adopt(reverted.state)
    expect(reverted.state.review).toMatchObject({ confirmedCandidate: 1, watch: 2, pending: 14, canRevert: true })

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

  it('rejects stale revisions, legacy partial scopes, and mismatched batches', async () => {
    const test = await harness()
    const input = nextArgs(test)
    await expect(test.next.execute({
      ...input,
      scope: { kind: 'records', recordRefs: [test.recordIds[0]] },
    }, test.context('legacy-scope'))).rejects.toThrow()
    await expect(test.next.execute({ ...input, projectionRevision: input.projectionRevision + 1 }, test.context('stale')))
      .rejects.toThrow('revision')

    const batch = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    await expect(test.commit.execute({
      schemaVersion: 1, kind: 'analysis.commit', commandId: 'wrong-batch',
      activeDatasetRef: input.activeDatasetRef,
      classificationArtifactRef: input.classificationArtifactRef,
      ruleSetVersion: input.ruleSetVersion,
      projectionRevision: input.projectionRevision,
      scope: input.scope, batchId: 'anb_wrong',
      recommendations: [{
        recordRef: batch.batch.records[0]!.recordRef, recommendation: 'watch',
        evidenceRefs: [batch.batch.records[0]!.evidence[0]!.ref],
        reason: '相关但需要继续核验。', verificationItems: ['核验范围'], limitations: ['无企业画像'],
      }],
    }, test.context('wrong-batch'))).rejects.toThrow('batchId')
  })

  it('completes immediately when classification contains only exclude and unmatched rows', async () => {
    const test = await harness({ eligibleCount: 3, zeroEligible: true })
    const input = nextArgs(test)
    const result = await test.next.execute(input, test.context(input.commandId)) as AnalysisNextResultV1
    expect(result.batch.records).toEqual([])
    expect(result.batch).toMatchObject({ eligibleTotal: 0, completed: 0, remaining: 0 })
    expect(result.state.analysis).toMatchObject({ eligibleTotal: 0, completed: 0 })
    expect(result.state.stages.analysis.status).toBe('succeeded')
    expect(result.message).toContain('规则排除和未匹配未进入分析')
  })
})
