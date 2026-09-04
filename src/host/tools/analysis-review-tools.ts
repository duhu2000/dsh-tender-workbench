import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import {
  AGENT_RECOMMENDATIONS,
  AnalysisBatchV1Schema,
  AnalysisDatasetV1Schema,
  ReviewDatasetV1Schema,
  ReviewOperationV1Schema,
  ReviewValueV1Schema,
  reviewCounts,
} from '../../contracts/analysis-review.ts'
import { NormalizedDatasetV1Schema } from '../../contracts/dataset.ts'
import { ClassifiedDatasetV1Schema } from '../../contracts/screening.ts'
import {
  ApplyReviewToolInputV2Schema,
  CommitAnalysisBatchInputV2Schema,
  GetAnalysisRecordContextInputV2Schema,
  PrepareAnalysisBatchInputV2Schema,
  RevertReviewToolInputV2Schema,
  type ApplyReviewToolInputV2,
  type GetAnalysisRecordContextInputV2,
  type RevertReviewToolInputV2,
} from '../../contracts/tool-inputs.ts'
import { renderTenderToolResult } from '../../contracts/tool-results.ts'
import {
  ArtifactRefV1Schema,
  TenderWorkflowProjectionV2Schema,
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV2,
} from '../../contracts/workflow.ts'
import {
  IntentReceiptCoordinator,
  deriveReceiptId,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/intent-receipts.ts'
import {
  createArtifactTransaction,
  type ArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import {
  allowedAnalysisEvidence,
  analysisBaseRows,
  analysisEligibleRows,
  analysisVersion,
  commitAnalysisBatch,
  createAnalysisBatch,
  syncReviewDataset,
} from '../pipeline/analysis-review.ts'
import { resolveToolInvocation, toolOriginParameter } from '../tool-contract.ts'

const AnalysisProgressV2Schema = z.object({
  eligibleTotal: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  recommendationCounts: z.object({
    priorityReview: z.number().int().nonnegative(),
    watch: z.number().int().nonnegative(),
    notRecommended: z.number().int().nonnegative(),
  }).strict(),
  projectionRevision: z.number().int().nonnegative(),
}).strict()

const PrepareAnalysisResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_prepare_analysis_batch'),
  intentId: z.string().min(1).max(128),
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  batch: AnalysisBatchV1Schema,
  progress: AnalysisProgressV2Schema,
  state: TenderWorkflowProjectionV2Schema,
  control: z.union([
    z.object({ status: z.literal('complete') }).strict(),
    z.object({ status: z.literal('continue'), nextTool: z.literal('tender_workbench_commit_analysis_batch') }).strict(),
  ]),
}).strict()

const CommitAnalysisResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_commit_analysis_batch'),
  intentId: z.string().min(1).max(128),
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  result: z.object({ analysisArtifactRef: z.string().min(1).max(128) }).strict(),
  progress: AnalysisProgressV2Schema,
  state: TenderWorkflowProjectionV2Schema,
  control: z.union([
    z.object({ status: z.literal('complete') }).strict(),
    z.object({ status: z.literal('continue'), nextTool: z.literal('tender_workbench_prepare_analysis_batch') }).strict(),
  ]),
}).strict()

const AnalysisRecordContextV2Schema = z.object({
  schemaVersion: z.literal(2),
  activeDatasetRef: z.string().min(1).max(128),
  classificationArtifactRef: z.string().min(1).max(128),
  ruleSetVersion: z.string().min(1).max(128),
  analysisVersion: z.string().min(1).max(128).optional(),
  projectionRevision: z.number().int().nonnegative(),
  record: AnalysisBatchV1Schema.shape.records.element,
  recommendation: AnalysisDatasetV1Schema.shape.rows.element.shape.recommendation.optional(),
}).strict()

const AnalysisRecordContextResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_get_analysis_record_context'),
  intentId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(512),
  context: AnalysisRecordContextV2Schema,
  control: z.object({ status: z.literal('complete') }).strict(),
}).strict()

const ReviewProgressV2Schema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  projectionRevision: z.number().int().nonnegative(),
}).strict()

const ReviewMutationResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.enum(['tender_workbench_apply_review', 'tender_workbench_revert_review']),
  intentId: z.string().min(1).max(128),
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  result: z.object({
    reviewArtifactRef: z.string().min(1).max(128),
    operationRef: z.string().min(1).max(128),
    affected: z.number().int().positive(),
  }).strict(),
  progress: ReviewProgressV2Schema,
  state: TenderWorkflowProjectionV2Schema,
  control: z.object({ status: z.literal('complete') }).strict(),
}).strict()

const ApplyReviewResultV2Schema = ReviewMutationResultV2Schema.extend({
  tool: z.literal('tender_workbench_apply_review'),
}).strict()

const RevertReviewResultV2Schema = ReviewMutationResultV2Schema.extend({
  tool: z.literal('tender_workbench_revert_review'),
}).strict()

export type PrepareAnalysisResultV2 = z.infer<typeof PrepareAnalysisResultV2Schema>
export type CommitAnalysisResultV2 = z.infer<typeof CommitAnalysisResultV2Schema>
export type AnalysisRecordContextResultV2 = z.infer<typeof AnalysisRecordContextResultV2Schema>
export type ReviewMutationResultV2 = z.infer<typeof ReviewMutationResultV2Schema>

export interface AnalysisReviewToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: IntentReceiptCoordinator
}

type AnalysisRow = z.infer<typeof AnalysisDatasetV1Schema>['rows'][number]
type ReviewDataset = z.infer<typeof ReviewDatasetV1Schema>

const ANALYSIS_BATCH_SIZE = 12
const FORBIDDEN_ANALYSIS_CLAIMS = /中标概率|中标可能性|成交概率|投标建议|企业适配|资格符合|利润|毛利|转化率|bid\s*\/\s*no[- ]?bid/iu

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

function requireAgent(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return exec.agent
}

function currentProjection(
  dependencies: AnalysisReviewToolDependencies,
  exec: ToolRunContext,
): TenderWorkflowProjectionV2 {
  const agent = requireAgent(exec)
  return dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

function assertClassificationBinding(
  state: TenderWorkflowProjectionV2,
  input: {
    readonly activeDatasetRef: string
    readonly classificationArtifactRef: string
    readonly ruleSetVersion: string
    readonly projectionRevision: number
  },
): void {
  if (state.query?.normalizedData?.id !== input.activeDatasetRef) {
    throw new Error('活动数据快照已变化；旧分析请求已失效。')
  }
  if (state.revision !== input.projectionRevision) {
    throw new Error('Projection revision 已变化；请基于当前状态重新提交。')
  }
  if (state.classification?.data.id !== input.classificationArtifactRef
    || state.classification.ruleSetVersion !== input.ruleSetVersion) {
    throw new Error('当前分类版本与请求绑定不一致；旧分析请求已失效。')
  }
}

async function loadBoundRows(transaction: ArtifactTransaction, state: TenderWorkflowProjectionV2) {
  const normalizedRef = state.query?.normalizedData
  if (normalizedRef === undefined) throw new Error('当前 Session 尚无可用的规范化数据。')
  const normalized = NormalizedDatasetV1Schema.parse(
    await transaction.readJsonArtifact(normalizedRef.id, 'normalized-data'),
  )
  const classification = state.classification === undefined
    ? undefined
    : ClassifiedDatasetV1Schema.parse(
      await transaction.readJsonArtifact(state.classification.data.id, 'classified-data'),
    )
  if (classification !== undefined
    && (classification.activeDatasetId !== normalizedRef.id
      || classification.ruleSetVersion !== state.classification?.ruleSetVersion)) {
    throw new Error('分类 Artifact 与当前活动数据不一致。')
  }
  return analysisBaseRows(normalized, classification)
}

async function loadPreviousAnalysis(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV2,
) {
  if (state.analysis?.data === undefined) return undefined
  const value = AnalysisDatasetV1Schema.parse(
    await transaction.readJsonArtifact(state.analysis.data.id, 'analysis-data'),
  )
  if (value.activeDatasetId !== state.query?.normalizedData?.id
    || value.classificationArtifactId !== state.classification?.data.id
    || value.ruleSetVersion !== state.classification?.ruleSetVersion
    || value.analysisVersion !== state.analysis.version) {
    throw new Error('分析 Artifact 与当前活动数据或分类版本不一致。')
  }
  return value
}

async function loadPreviousReview(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV2,
) {
  if (state.review === undefined) return undefined
  const value = ReviewDatasetV1Schema.parse(
    await transaction.readJsonArtifact(state.review.data.id, 'review-data'),
  )
  if (value.activeDatasetId !== state.query?.normalizedData?.id
    || value.classificationArtifactId !== state.classification?.data.id
    || value.ruleSetVersion !== state.classification?.ruleSetVersion
    || value.analysisVersion !== state.analysis?.version
    || value.revision !== state.review.revision) {
    throw new Error('复核 Artifact 与当前活动状态不一致。')
  }
  return value
}

function analysisBinding(state: TenderWorkflowProjectionV2) {
  const activeDatasetId = state.query?.normalizedData?.id
  const classification = state.classification
  if (activeDatasetId === undefined) throw new Error('当前 Session 尚无可分析的数据。')
  if (classification === undefined) throw new Error('请先确认初筛口径并完成确定性分类。')
  return {
    activeDatasetId,
    classificationArtifactId: classification.data.id,
    ruleSetVersion: classification.ruleSetVersion,
  }
}

function countRecommendations(rows: readonly AnalysisRow[]) {
  const counts = { priorityReview: 0, watch: 0, notRecommended: 0 }
  analysisEligibleRows(rows).forEach((row) => {
    if (row.recommendation?.recommendation === 'priority-review') counts.priorityReview += 1
    else if (row.recommendation?.recommendation === 'watch') counts.watch += 1
    else if (row.recommendation?.recommendation === 'not-recommended') counts.notRecommended += 1
  })
  return counts
}

function urgentCandidateCount(rows: readonly AnalysisRow[], now: string): number {
  const current = Date.parse(now)
  return analysisEligibleRows(rows).filter((row) => {
    if (row.project.source !== 'tender' || row.project.deadline?.value === undefined) return false
    const deadline = Date.parse(row.project.deadline.value)
    return Number.isFinite(deadline) && deadline >= current && deadline - current <= 7 * 24 * 60 * 60 * 1_000
  }).length
}

function reviewProjectionCounts(rows: ReviewDataset['rows']) {
  return {
    ...reviewCounts(rows),
    confirmedTender: rows.filter(row => row.project.source === 'tender' && row.review.decision === 'confirmed-candidate').length,
    priorityProposed: rows.filter(row => row.project.source === 'proposed' && row.review.decision === 'confirmed-candidate').length,
  }
}

function analysisProjectionState(input: {
  readonly previous: TenderWorkflowProjectionV2
  readonly nextRevision: number
  readonly version: string
  readonly binding: ReturnType<typeof analysisBinding>
  readonly rows: readonly AnalysisRow[]
  readonly analysisData: z.infer<typeof ArtifactRefV1Schema>
  readonly reviewData: z.infer<typeof ArtifactRefV1Schema>
  readonly review: ReviewDataset
  readonly now: string
}): TenderWorkflowProjectionV2 {
  const counts = countRecommendations(input.rows)
  const eligibleTotal = analysisEligibleRows(input.rows).length
  const completed = counts.priorityReview + counts.watch + counts.notRecommended
  const reviewCountsValue = reviewProjectionCounts(input.review.rows)
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, report: _report, ...base } = input.previous
  return TenderWorkflowProjectionV2Schema.parse({
    ...base,
    revision: input.nextRevision,
    currentStage: 'analysis',
    stages: {
      ...base.stages,
      analysis: { status: completed === eligibleTotal ? 'succeeded' : 'running', updatedAt: input.now },
      report: { status: 'not-started' },
    },
    analysis: {
      version: input.version,
      activeDatasetId: input.binding.activeDatasetId,
      ruleSetVersion: input.binding.ruleSetVersion,
      data: input.analysisData,
      eligibleTotal,
      completed,
      ...counts,
      urgent: urgentCandidateCount(input.rows, input.now),
    },
    review: {
      revision: input.review.revision,
      data: input.reviewData,
      ...reviewCountsValue,
      canRevert: input.review.operations.length > 0,
      ...(input.review.operations.at(-1) === undefined
        ? {}
        : { latestOperationRef: input.review.operations.at(-1)?.operationId }),
    },
  })
}

function progress(rows: readonly AnalysisRow[], projectionRevision: number) {
  const eligibleTotal = analysisEligibleRows(rows).length
  const recommendationCounts = countRecommendations(rows)
  const completed = recommendationCounts.priorityReview
    + recommendationCounts.watch
    + recommendationCounts.notRecommended
  return AnalysisProgressV2Schema.parse({
    eligibleTotal,
    completed,
    remaining: eligibleTotal - completed,
    recommendationCounts,
    projectionRevision,
  })
}

function analysisBindingParameters() {
  return {
    schemaVersion: { type: 'integer' as const, const: 2, required: true as const },
    origin: { ...toolOriginParameter({ autonomous: false }), required: true as const },
    activeDatasetRef: { type: 'string' as const, required: true as const },
    classificationArtifactRef: { type: 'string' as const, required: true as const },
    ruleSetVersion: { type: 'string' as const, required: true as const },
    projectionRevision: { type: 'integer' as const, required: true as const },
  }
}

function scopeParameter() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      kind: { type: 'string' as const, const: 'all-eligible' as const, required: true as const },
    },
    required: true as const,
  }
}

function recommendationParameter() {
  const boundedText = { type: 'string' as const, description: 'Required non-empty text, at most 2048 characters.' }
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      recordRef: { type: 'string' as const, description: 'Exact recordRef from the current batch.', required: true as const },
      recommendation: { type: 'string' as const, enum: [...AGENT_RECOMMENDATIONS], required: true as const },
      evidenceRefs: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '1-32 unique evidenceRefs belonging to this record; this array must never be empty.',
        required: true as const,
      },
      reason: { ...boundedText, required: true as const },
      verificationItems: { type: 'array' as const, items: boundedText, description: '1-12 non-empty items.', required: true as const },
      limitations: { type: 'array' as const, items: boundedText, description: '1-12 non-empty items.', required: true as const },
    },
  }
}

function assertRecommendationPolicy(recommendations: z.infer<typeof CommitAnalysisBatchInputV2Schema>['recommendations']): void {
  for (const recommendation of recommendations) {
    const fields = [
      ['reason', recommendation.reason],
      ['verificationItems', recommendation.verificationItems.join('\n')],
      ['limitations', recommendation.limitations.join('\n')],
    ] as const
    for (const [field, text] of fields) {
      const match = FORBIDDEN_ANALYSIS_CLAIMS.exec(text)
      if (match === null) continue
      throw new Error(
        `recordRef ${recommendation.recordRef} 的 ${field} 命中禁用术语“${match[0]}”；请改用来源事实表达并通过新 Intent 重试。`,
      )
    }
  }
}

function mutationMeta(input: {
  readonly tool: 'tender_workbench_prepare_analysis_batch' | 'tender_workbench_commit_analysis_batch' | 'tender_workbench_apply_review' | 'tender_workbench_revert_review'
  readonly origin: 'workbench-intent' | 'conversation'
  readonly intentId: string
  readonly previousRevision: number
  readonly state: TenderWorkflowProjectionV2
  readonly control: { readonly status: 'complete' } | { readonly status: 'continue'; readonly nextTool: 'tender_workbench_prepare_analysis_batch' | 'tender_workbench_commit_analysis_batch' }
}): JsonValue {
  return jsonValue({
    domain: 'dsh-tender-workbench', schemaVersion: 2,
    tool: input.tool, intentId: input.intentId, origin: input.origin,
    effect: 'mutation', previousRevision: input.previousRevision,
    state: input.state, control: input.control,
  })
}

export function createTenderWorkbenchPrepareAnalysisBatchTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_prepare_analysis_batch',
    description: 'Initialize or resume the full include + observe + manual-review analysis and return the next stable Host-selected batch.',
    parameters: { ...analysisBindingParameters(), scope: scopeParameter() },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_prepare_analysis_batch', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', const: 'succeeded', required: true },
          message: { type: 'string', required: true },
          batch: { type: 'json', required: true },
          progress: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(PrepareAnalysisResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = PrepareAnalysisBatchInputV2Schema.parse(args)
        const parsed = PrepareAnalysisResultV2Schema.parse(value)
        return mutationMeta({
          tool: 'tender_workbench_prepare_analysis_batch', origin: input.origin.kind,
          intentId: parsed.intentId, previousRevision: input.projectionRevision,
          state: parsed.state, control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = PrepareAnalysisBatchInputV2Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      assertClassificationBinding(previousState, args)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previousState,
        tool: 'tender_workbench_prepare_analysis_batch', intentKind: 'analysis.run', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('分析动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      await transaction.load()
      const baseRows = await loadBoundRows(transaction, previousState)
      const previousAnalysis = await loadPreviousAnalysis(transaction, previousState)
      const binding = analysisBinding(previousState)
      const version = analysisVersion(binding)
      if (previousAnalysis !== undefined && previousAnalysis.analysisVersion !== version) {
        throw new Error('当前分析版本已失效。')
      }
      const rows = previousAnalysis?.rows ?? baseRows
      const batch = createAnalysisBatch({
        analysisVersion: version,
        activeDatasetRef: binding.activeDatasetId,
        classificationArtifactRef: binding.classificationArtifactId,
        ruleSetVersion: binding.ruleSetVersion,
        basedOnRevision: previousState.revision,
        scope: args.scope,
        batchSize: ANALYSIS_BATCH_SIZE,
        rows,
      })
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_prepare_analysis_batch',
        batchId: batch.batchId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => PrepareAnalysisResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          const now = new Date().toISOString()
          const dataset = previousAnalysis ?? AnalysisDatasetV1Schema.parse({
            schemaVersion: 1,
            analysisVersion: version,
            activeDatasetId: binding.activeDatasetId,
            classificationArtifactId: binding.classificationArtifactId,
            ruleSetVersion: binding.ruleSetVersion,
            eligibleTotal: analysisEligibleRows(rows).length,
            updatedAt: now,
            rows,
          })
          const analysisData = previousState.analysis?.data ?? await transaction.stageJson(
            'analysis-data', `analysis-${version}-start.json`, jsonValue(dataset), dataset.rows.length,
          )
          const previousReview = await loadPreviousReview(transaction, previousState)
          const review = syncReviewDataset({
            previous: previousReview,
            rows: dataset.rows,
            activeDatasetId: dataset.activeDatasetId,
            classificationArtifactId: binding.classificationArtifactId,
            ruleSetVersion: binding.ruleSetVersion,
            analysisVersion: version,
            now,
          })
          const reviewData = previousState.review?.data ?? await transaction.stageJson(
            'review-data', `review-analysis-${intentId}.json`, jsonValue(review), review.rows.length,
          )
          const state = analysisProjectionState({
            previous: previousState, nextRevision, version, binding,
            rows: dataset.rows, analysisData, reviewData, review, now,
          })
          const currentProgress = progress(dataset.rows, nextRevision)
          const control = batch.records.length === 0
            ? { status: 'complete' as const }
            : { status: 'continue' as const, nextTool: 'tender_workbench_commit_analysis_batch' as const }
          exec.signal.throwIfAborted()
          return jsonValue(PrepareAnalysisResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_prepare_analysis_batch', intentId, outcome: 'succeeded',
            message: batch.records.length === 0
              ? `全部可分析候选已完成：${currentProgress.completed}/${currentProgress.eligibleTotal}。规则排除和未匹配未进入分析。`
              : `已准备稳定分析批次 ${batch.batchId}，包含 ${batch.records.length} 条记录。`,
            batch,
            progress: currentProgress,
            state,
            control,
          })) as ReceiptJsonValue
        },
      })
      return PrepareAnalysisResultV2Schema.parse(receipt.result)
    },
  })
}

export function createTenderWorkbenchCommitAnalysisBatchTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_commit_analysis_batch',
    description: 'Validate and atomically commit recommendations for every record in exactly one prepared analysis batch.',
    parameters: {
      ...analysisBindingParameters(),
      scope: scopeParameter(),
      batchId: { type: 'string', required: true },
      recommendations: {
        type: 'array', items: recommendationParameter(),
        description: '1-20 entries covering every record in the current batch exactly once.',
        required: true,
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_commit_analysis_batch', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', const: 'succeeded', required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          progress: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(CommitAnalysisResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = CommitAnalysisBatchInputV2Schema.parse(args)
        const parsed = CommitAnalysisResultV2Schema.parse(value)
        return mutationMeta({
          tool: 'tender_workbench_commit_analysis_batch', origin: input.origin.kind,
          intentId: parsed.intentId, previousRevision: input.projectionRevision,
          state: parsed.state, control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = CommitAnalysisBatchInputV2Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previousState,
        tool: 'tender_workbench_commit_analysis_batch', intentKind: 'analysis.run', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('分析批次提交缺少 intentId。')
      const intentId = invocation.intentId
      assertRecommendationPolicy(args.recommendations)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_commit_analysis_batch',
        batchId: args.batchId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => CommitAnalysisResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          assertClassificationBinding(previousState, args)
          const baseRows = await loadBoundRows(transaction, previousState)
          const previousAnalysis = await loadPreviousAnalysis(transaction, previousState)
          const binding = analysisBinding(previousState)
          const version = analysisVersion(binding)
          const currentRows = previousAnalysis?.rows ?? baseRows
          const batch = createAnalysisBatch({
            analysisVersion: version,
            activeDatasetRef: binding.activeDatasetId,
            classificationArtifactRef: binding.classificationArtifactId,
            ruleSetVersion: binding.ruleSetVersion,
            basedOnRevision: previousState.revision,
            scope: args.scope,
            batchSize: ANALYSIS_BATCH_SIZE,
            rows: currentRows,
          })
          if (batch.batchId !== args.batchId) throw new Error('batchId 已失效或不属于当前稳定批次。')
          const now = new Date().toISOString()
          const dataset = commitAnalysisBatch({
            previous: previousAnalysis,
            baseRows,
            batch,
            recommendations: args.recommendations,
            now,
          })
          exec.signal.throwIfAborted()
          const analysisData = await transaction.stageJson(
            'analysis-data', `analysis-${version}-${args.batchId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const previousReview = await loadPreviousReview(transaction, previousState)
          const review = syncReviewDataset({
            previous: previousReview,
            rows: dataset.rows,
            activeDatasetId: dataset.activeDatasetId,
            classificationArtifactId: binding.classificationArtifactId,
            ruleSetVersion: binding.ruleSetVersion,
            analysisVersion: dataset.analysisVersion,
            now,
          })
          const reviewData = await transaction.stageJson(
            'review-data', `review-analysis-${intentId}-${args.batchId}.json`, jsonValue(review), review.rows.length,
          )
          const state = analysisProjectionState({
            previous: previousState, nextRevision, version, binding,
            rows: dataset.rows, analysisData, reviewData, review, now,
          })
          const currentProgress = progress(dataset.rows, nextRevision)
          const control = currentProgress.remaining === 0
            ? { status: 'complete' as const }
            : { status: 'continue' as const, nextTool: 'tender_workbench_prepare_analysis_batch' as const }
          return jsonValue(CommitAnalysisResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_commit_analysis_batch', intentId, outcome: 'succeeded',
            message: currentProgress.remaining === 0
              ? `全部可分析候选已完成：${currentProgress.completed}/${currentProgress.eligibleTotal}。`
              : `已保存 ${args.recommendations.length} 条建议；剩余 ${currentProgress.remaining} 条。`,
            result: { analysisArtifactRef: analysisData.id },
            progress: currentProgress,
            state,
            control,
          })) as ReceiptJsonValue
        },
      })
      return CommitAnalysisResultV2Schema.parse(receipt.result)
    },
  })
}

export function createTenderWorkbenchAnalysisRecordContextTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_get_analysis_record_context',
    description: 'Read one current record with bounded source facts, classification, recommendation, evidence, verification items, and limitations.',
    parameters: {
      schemaVersion: { type: 'integer', const: 2, required: true },
      origin: { ...toolOriginParameter({ autonomous: true }), required: true },
      activeDatasetRef: { type: 'string', required: true },
      classificationArtifactRef: { type: 'string', required: true },
      ruleSetVersion: { type: 'string', required: true },
      analysisVersion: { type: 'string' },
      projectionRevision: { type: 'integer', required: true },
      recordRef: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_get_analysis_record_context', required: true },
          intentId: { type: 'string' },
          message: { type: 'string', required: true },
          context: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(AnalysisRecordContextResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = GetAnalysisRecordContextInputV2Schema.parse(args)
        const parsed = AnalysisRecordContextResultV2Schema.parse(value)
        return jsonValue({
          domain: 'dsh-tender-workbench', schemaVersion: 2,
          tool: 'tender_workbench_get_analysis_record_context',
          ...(parsed.intentId === undefined ? {} : { intentId: parsed.intentId }),
          origin: input.origin.kind,
          effect: 'read-only', observedRevision: input.projectionRevision,
          control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = GetAnalysisRecordContextInputV2Schema.parse(rawArgs)
      const state = currentProjection(dependencies, exec)
      assertClassificationBinding(state, args)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state,
        tool: 'tender_workbench_get_analysis_record_context', intentKind: 'analysis.follow-up', mutation: false,
      })
      if (args.analysisVersion !== undefined && state.analysis?.version !== args.analysisVersion) {
        throw new Error('当前 Agent 分析版本与记录上下文请求不一致。')
      }
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      await transaction.load()
      const baseRows = await loadBoundRows(transaction, state)
      const analysis = await loadPreviousAnalysis(transaction, state)
      const rows = analysis?.rows ?? baseRows
      const row = rows.find(candidate => candidate.project.recordId === args.recordRef)
      if (row === undefined || row.classification === undefined) {
        throw new Error('recordRef 不属于当前分类链路。')
      }
      const context = AnalysisRecordContextV2Schema.parse({
        schemaVersion: 2,
        activeDatasetRef: args.activeDatasetRef,
        classificationArtifactRef: args.classificationArtifactRef,
        ruleSetVersion: args.ruleSetVersion,
        ...(analysis === undefined ? {} : { analysisVersion: analysis.analysisVersion }),
        projectionRevision: state.revision,
        record: {
          recordRef: row.project.recordId,
          source: row.project.source,
          title: row.project.title,
          classification: row.classification,
          evidence: allowedAnalysisEvidence(row),
        },
        ...(row.recommendation === undefined ? {} : { recommendation: row.recommendation }),
      })
      exec.signal.throwIfAborted()
      return AnalysisRecordContextResultV2Schema.parse({
        domain: 'dsh-tender-workbench', schemaVersion: 2,
        tool: 'tender_workbench_get_analysis_record_context',
        ...(invocation.intentId === undefined ? {} : { intentId: invocation.intentId }),
        message: `已返回当前记录 ${args.recordRef} 的有界分析上下文。`,
        context,
        control: { status: 'complete' },
      })
    },
  })
}

function reviewBasisParameter() {
  return {
    oneOf: [
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: { kind: { type: 'string' as const, const: 'dataset-only' as const, required: true as const } },
      },
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, const: 'classified' as const, required: true as const },
          classificationArtifactRef: { type: 'string' as const, required: true as const },
          ruleSetVersion: { type: 'string' as const, required: true as const },
          analysisVersion: { type: 'string' as const },
        },
      },
    ],
  } as const
}

function reviewBindingParameters() {
  return {
    schemaVersion: { type: 'integer' as const, const: 2, required: true as const },
    origin: { ...toolOriginParameter({ autonomous: false }), required: true as const },
    activeDatasetRef: { type: 'string' as const, required: true as const },
    projectionRevision: { type: 'integer' as const, required: true as const },
    basis: { ...reviewBasisParameter(), required: true as const },
    reviewArtifactRef: {
      type: 'string' as const,
      description: 'Current review Artifact id. Omit this field when reviewRevision is 0; never pass an empty string.',
    },
    reviewRevision: { type: 'integer' as const, required: true as const },
  }
}

function assertReviewBinding(
  state: TenderWorkflowProjectionV2,
  args: Pick<ApplyReviewToolInputV2 | RevertReviewToolInputV2,
    'activeDatasetRef' | 'projectionRevision' | 'basis' | 'reviewArtifactRef' | 'reviewRevision'>,
): void {
  if (state.query?.normalizedData?.id !== args.activeDatasetRef) {
    throw new Error('活动数据快照已变化；旧复核请求已失效。')
  }
  if (state.revision !== args.projectionRevision) {
    throw new Error('Projection revision 已变化；请基于当前状态重新提交复核。')
  }
  if (args.basis.kind === 'dataset-only') {
    if (state.classification !== undefined || state.analysis !== undefined) {
      throw new Error('当前复核必须绑定现有分类与分析链路。')
    }
  } else if (state.classification?.data.id !== args.basis.classificationArtifactRef
    || state.classification.ruleSetVersion !== args.basis.ruleSetVersion
    || state.analysis?.version !== args.basis.analysisVersion) {
    throw new Error('复核 basis 与当前分类或分析版本不一致。')
  }
  if (state.review === undefined) {
    if (args.reviewArtifactRef !== undefined || args.reviewRevision !== 0) {
      throw new Error('当前尚无复核 Artifact；请求绑定无效。')
    }
  } else if (state.review.data.id !== args.reviewArtifactRef || state.review.revision !== args.reviewRevision) {
    throw new Error('当前复核 Artifact 或 revision 已变化。')
  }
}

async function currentReviewDataset(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV2,
  now: string,
) {
  const baseRows = await loadBoundRows(transaction, state)
  const analysis = await loadPreviousAnalysis(transaction, state)
  const previous = await loadPreviousReview(transaction, state)
  return syncReviewDataset({
    previous,
    rows: analysis?.rows ?? baseRows,
    activeDatasetId: state.query?.normalizedData?.id ?? '',
    ...(state.classification === undefined ? {} : {
      classificationArtifactId: state.classification.data.id,
      ruleSetVersion: state.classification.ruleSetVersion,
    }),
    ...(analysis === undefined ? {} : { analysisVersion: analysis.analysisVersion }),
    now,
  })
}

function reviewState(
  previousState: TenderWorkflowProjectionV2,
  nextRevision: number,
  now: string,
  dataset: ReviewDataset,
  artifact: z.infer<typeof ArtifactRefV1Schema>,
): TenderWorkflowProjectionV2 {
  const counts = reviewProjectionCounts(dataset.rows)
  const latestOperationRef = dataset.operations.at(-1)?.operationId
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, report: _report, ...base } = previousState
  return TenderWorkflowProjectionV2Schema.parse({
    ...base,
    revision: nextRevision,
    currentStage: 'review',
    stages: {
      ...base.stages,
      review: { status: 'succeeded', updatedAt: now },
      report: { status: 'not-started' },
    },
    review: {
      revision: dataset.revision,
      data: artifact,
      ...counts,
      canRevert: latestOperationRef !== undefined,
      ...(latestOperationRef === undefined ? {} : { latestOperationRef }),
    },
  })
}

function reviewProgress(dataset: ReviewDataset, projectionRevision: number) {
  const counts = reviewCounts(dataset.rows)
  return ReviewProgressV2Schema.parse({
    total: dataset.rows.length,
    pending: counts.pending,
    reviewed: dataset.rows.length - counts.pending,
    projectionRevision,
  })
}

function reviewDecisionParameter() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      recordRef: { type: 'string' as const, required: true as const },
      decision: { type: 'string' as const, enum: ['confirmed-candidate', 'watch', 'exclude', 'pending'] as const, required: true as const },
      note: { type: 'string' as const, required: true as const },
    },
  }
}

export function createTenderWorkbenchApplyReviewTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_apply_review',
    description: 'Apply explicit per-record user decisions and notes to exactly the bound review records.',
    parameters: {
      ...reviewBindingParameters(),
      decisions: { type: 'array', items: reviewDecisionParameter(), required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_apply_review', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', const: 'succeeded', required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          progress: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(ApplyReviewResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = ApplyReviewToolInputV2Schema.parse(args)
        const parsed = ApplyReviewResultV2Schema.parse(value)
        return mutationMeta({
          tool: 'tender_workbench_apply_review', origin: input.origin.kind,
          intentId: parsed.intentId, previousRevision: input.projectionRevision,
          state: parsed.state, control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = ApplyReviewToolInputV2Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previousState,
        tool: 'tender_workbench_apply_review', intentKind: 'review.apply', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('复核动作缺少 intentId。')
      const intentId = invocation.intentId
      const operationRef = deriveReceiptId('tender_workbench_apply_review', intentId)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_apply_review',
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => ApplyReviewResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          assertReviewBinding(previousState, args)
          const now = new Date().toISOString()
          const current = await currentReviewDataset(transaction, previousState, now)
          const existing = new Set(current.rows.map(row => row.project.recordId))
          const unknown = args.decisions.find(decision => !existing.has(decision.recordRef))
          if (unknown !== undefined) throw new Error(`复核范围包含未知 recordRef：${unknown.recordRef}`)
          const decisions = new Map(args.decisions.map(decision => [
            decision.recordRef,
            ReviewValueV1Schema.parse({ decision: decision.decision, note: decision.note }),
          ]))
          const previous = current.rows
            .filter(row => decisions.has(row.project.recordId))
            .map(row => ({ recordRef: row.project.recordId, value: row.review }))
          const operation = ReviewOperationV1Schema.parse({
            operationId: operationRef,
            intentId,
            appliedAt: now,
            changes: [...decisions].map(([recordRef, value]) => ({ recordRef, value })),
            previous,
          })
          const dataset = ReviewDatasetV1Schema.parse({
            ...current,
            revision: current.revision + 1,
            updatedAt: now,
            operations: [...current.operations, operation],
            rows: current.rows.map(row => ({
              ...row,
              review: decisions.get(row.project.recordId) ?? row.review,
            })),
          })
          exec.signal.throwIfAborted()
          const artifact = await transaction.stageJson(
            'review-data', `review-${dataset.revision}-${intentId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const state = reviewState(previousState, nextRevision, now, dataset, artifact)
          return jsonValue(ApplyReviewResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_apply_review', intentId, outcome: 'succeeded',
            message: `已保存 ${args.decisions.length} 条明确的用户复核决定。`,
            result: { reviewArtifactRef: artifact.id, operationRef, affected: args.decisions.length },
            progress: reviewProgress(dataset, nextRevision),
            state,
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return ApplyReviewResultV2Schema.parse(receipt.result)
    },
  })
}

export function createTenderWorkbenchRevertReviewTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_revert_review',
    description: 'Revert exactly the current review chain latest operation and restore its previous user decisions and notes.',
    parameters: {
      ...reviewBindingParameters(),
      latestOperationRef: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_revert_review', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', const: 'succeeded', required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          progress: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(RevertReviewResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = RevertReviewToolInputV2Schema.parse(args)
        const parsed = RevertReviewResultV2Schema.parse(value)
        return mutationMeta({
          tool: 'tender_workbench_revert_review', origin: input.origin.kind,
          intentId: parsed.intentId, previousRevision: input.projectionRevision,
          state: parsed.state, control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = RevertReviewToolInputV2Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previousState,
        tool: 'tender_workbench_revert_review', intentKind: 'review.revert', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('复核撤销动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_revert_review',
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => RevertReviewResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          assertReviewBinding(previousState, args)
          const now = new Date().toISOString()
          const current = await currentReviewDataset(transaction, previousState, now)
          const operation = current.operations.at(-1)
          if (operation === undefined
            || operation.operationId !== args.latestOperationRef
            || previousState.review?.latestOperationRef !== args.latestOperationRef) {
            throw new Error('只能撤销当前复核链路最近一次操作。')
          }
          const restore = new Map(operation.previous.map(item => [item.recordRef, item.value]))
          const dataset = ReviewDatasetV1Schema.parse({
            ...current,
            revision: current.revision + 1,
            updatedAt: now,
            revertedOperationCount: current.revertedOperationCount + 1,
            operations: current.operations.slice(0, -1),
            rows: current.rows.map(row => ({
              ...row,
              review: restore.get(row.project.recordId) ?? row.review,
            })),
          })
          exec.signal.throwIfAborted()
          const artifact = await transaction.stageJson(
            'review-data', `review-${dataset.revision}-${intentId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const state = reviewState(previousState, nextRevision, now, dataset, artifact)
          return jsonValue(RevertReviewResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_revert_review', intentId, outcome: 'succeeded',
            message: `已撤销最近一次复核操作，恢复 ${operation.previous.length} 条记录。`,
            result: {
              reviewArtifactRef: artifact.id,
              operationRef: args.latestOperationRef,
              affected: operation.previous.length,
            },
            progress: reviewProgress(dataset, nextRevision),
            state,
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return RevertReviewResultV2Schema.parse(receipt.result)
    },
  })
}
