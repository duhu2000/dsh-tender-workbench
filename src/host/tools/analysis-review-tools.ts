import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import {
  AGENT_RECOMMENDATIONS,
  AnalysisBatchV1Schema,
  AnalysisCommitCommandV1Schema,
  AnalysisDatasetV1Schema,
  AnalysisNextCommandV1Schema,
  ApplyReviewCommandV1Schema,
  RevertReviewCommandV1Schema,
  ReviewDatasetV1Schema,
  ReviewOperationV1Schema,
  reviewCounts,
} from '../../contracts/analysis-review.ts'
import { NormalizedDatasetV1Schema } from '../../contracts/dataset.ts'
import { ClassifiedDatasetV1Schema } from '../../contracts/screening.ts'
import {
  TenderWorkflowProjectionV1Schema,
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV1,
} from '../../contracts/workflow.ts'
import {
  CommandReceiptCoordinator,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/command-receipts.ts'
import {
  createArtifactTransaction,
  type ArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import {
  analysisBaseRows,
  analysisVersion,
  commitAnalysisBatch,
  createAnalysisBatch,
  syncReviewDataset,
} from '../pipeline/analysis-review.ts'

const AnalysisNextResultV1Schema = z.object({
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  batch: AnalysisBatchV1Schema,
  state: TenderWorkflowProjectionV1Schema,
}).strict()

const MutationResultV1Schema = z.object({
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  state: TenderWorkflowProjectionV1Schema,
}).strict()

export type AnalysisNextResultV1 = z.infer<typeof AnalysisNextResultV1Schema>
export type AnalysisReviewMutationResultV1 = z.infer<typeof MutationResultV1Schema>

export interface AnalysisReviewToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: CommandReceiptCoordinator
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

function requireAgent(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return exec.agent
}

function currentProjection(dependencies: AnalysisReviewToolDependencies, exec: ToolRunContext): TenderWorkflowProjectionV1 {
  const agent = requireAgent(exec)
  return dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

function assertBinding(
  state: TenderWorkflowProjectionV1,
  input: {
    readonly activeDatasetRef: string
    readonly classificationArtifactRef?: string
    readonly ruleSetVersion?: string
    readonly projectionRevision: number
  },
): void {
  if (state.query?.normalizedData?.id !== input.activeDatasetRef) {
    throw new Error('活动数据快照已变化；旧分析或复核请求已失效。')
  }
  if (state.revision !== input.projectionRevision) {
    throw new Error('Projection revision 已变化；请基于当前数据和状态重新提交。')
  }
  const currentClassification = state.classification
  if (currentClassification?.data.id !== input.classificationArtifactRef
    || currentClassification?.ruleSetVersion !== input.ruleSetVersion) {
    throw new Error('当前分类版本与请求绑定不一致；旧分析或复核请求已失效。')
  }
}

async function loadBoundRows(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV1,
) {
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
  state: TenderWorkflowProjectionV1,
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
  state: TenderWorkflowProjectionV1,
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

function analysisBinding(state: TenderWorkflowProjectionV1) {
  const activeDatasetId = state.query?.normalizedData?.id
  if (activeDatasetId === undefined) throw new Error('当前 Session 尚无可分析的数据。')
  return {
    activeDatasetId,
    ...(state.classification === undefined ? {} : {
      classificationArtifactId: state.classification.data.id,
      ruleSetVersion: state.classification.ruleSetVersion,
    }),
  }
}

function commonParameters() {
  return {
    schemaVersion: { type: 'integer' as const, const: 1, required: true as const },
    commandId: { type: 'string' as const, required: true as const },
    activeDatasetRef: { type: 'string' as const, required: true as const },
    classificationArtifactRef: { type: 'string' as const },
    ruleSetVersion: { type: 'string' as const },
    projectionRevision: { type: 'integer' as const, required: true as const },
  }
}

function scopeParameter() {
  return { type: 'json' as const, required: true as const }
}

function outputSchema(includeBatch = false) {
  return {
    schema: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        outcome: { type: 'string' as const, const: 'succeeded' as const, required: true as const },
        message: { type: 'string' as const, required: true as const },
        ...(includeBatch ? { batch: { type: 'json' as const, required: true as const } } : {}),
        state: { type: 'json' as const, required: true as const },
      },
    },
  }
}

function presentationMeta(
  command: 'tender_workbench_analysis_next' | 'tender_workbench_analysis_commit' | 'tender_workbench_apply_review' | 'tender_workbench_revert_review',
  args: { readonly commandId: string },
  value: unknown,
): JsonValue {
  const parsed = command === 'tender_workbench_analysis_next'
    ? AnalysisNextResultV1Schema.parse(value)
    : MutationResultV1Schema.parse(value)
  return jsonValue({
    domain: 'dsh-tender-workbench', schemaVersion: 1,
    commandId: args.commandId, command, state: parsed.state,
  })
}

function analysisRecommendationParameter() {
  const textArray = { type: 'array' as const, items: { type: 'string' as const }, required: true as const }
  return {
    type: 'object' as const,
    additionalProperties: false,
    description: 'Exact AgentRecommendationInputV1. Use only these six fields; do not rename recommendation to decision or verificationItems to verification.',
    properties: {
      recordRef: { type: 'string' as const, required: true as const },
      recommendation: { type: 'string' as const, enum: [...AGENT_RECOMMENDATIONS], required: true as const },
      evidenceRefs: textArray,
      reason: { type: 'string' as const, required: true as const },
      verificationItems: textArray,
      limitations: textArray,
    },
  }
}

export function createTenderWorkbenchAnalysisNextTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_analysis_next',
    description: 'Read exactly one deterministic, bounded evidence batch from the user-selected current scope. This is read-only and has no cursor. Repeating it before commit returns the same batchId. Never expand the scope, re-query sources, or infer enterprise fit, win probability, profit, qualification compliance, or Bid/No-Bid.',
    parameters: {
      ...commonParameters(),
      kind: { type: 'string', const: 'analysis.next', required: true },
      scope: scopeParameter(),
      batchSize: { type: 'integer', required: true },
    },
    output: {
      ...outputSchema(true),
      render(_args, value) {
        const parsed = AnalysisNextResultV1Schema.parse(value)
        return [{
          type: 'text',
          text: `${parsed.message}\n\nAnalysisBatchV1（必须逐字使用其中的 batchId、recordRef 与 evidenceRef）：\n${JSON.stringify(parsed.batch, null, 2)}\n\n提交 recommendations 时，每个对象只能包含 recordRef、recommendation、evidenceRefs、reason、verificationItems、limitations。recommendation 只能是 priority-review、watch 或 not-recommended；evidenceRefs、verificationItems、limitations 都必须是字符串数组。不要使用 decision、verification 等近义字段。`,
        }]
      },
      presentationMeta(args, value) {
        return presentationMeta('tender_workbench_analysis_next', args, value)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = AnalysisNextCommandV1Schema.parse(rawArgs)
      const state = currentProjection(dependencies, exec)
      assertBinding(state, args)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      await transaction.load()
      const baseRows = await loadBoundRows(transaction, state)
      const previous = await loadPreviousAnalysis(transaction, state)
      const binding = analysisBinding(state)
      const version = analysisVersion(binding)
      if (previous !== undefined && previous.analysisVersion !== version) {
        throw new Error('当前分析版本已失效。')
      }
      const batch = createAnalysisBatch({
        analysisVersion: version,
        activeDatasetRef: binding.activeDatasetId,
        ...(binding.classificationArtifactId === undefined ? {} : { classificationArtifactRef: binding.classificationArtifactId }),
        ...(binding.ruleSetVersion === undefined ? {} : { ruleSetVersion: binding.ruleSetVersion }),
        basedOnRevision: state.revision,
        scope: args.scope,
        batchSize: args.batchSize,
        rows: previous?.rows ?? baseRows,
      })
      const result = AnalysisNextResultV1Schema.parse({
        outcome: 'succeeded',
        message: batch.records.length === 0
          ? '当前明确分析范围内没有尚未提交建议的记录。'
          : `已提供稳定分析批次 ${batch.batchId}，包含 ${batch.records.length} 条记录；只能引用批次内 evidenceRef。`,
        batch,
        state,
      })
      exec.signal.throwIfAborted()
      return result
    },
  })
}

export function createTenderWorkbenchAnalysisCommitTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_analysis_commit',
    description: 'Commit exactly one previously returned analysis batch. Every recommendations item must use the exact AgentRecommendationInputV1 fields: recordRef, recommendation, evidenceRefs, reason, verificationItems, limitations. verificationItems and limitations are string arrays. Do not use decision or verification aliases. Agent recommendations remain optional and never create user decisions.',
    parameters: {
      ...commonParameters(),
      kind: { type: 'string', const: 'analysis.commit', required: true },
      scope: scopeParameter(),
      batchSize: { type: 'integer', required: true },
      batchId: { type: 'string', required: true },
      recommendations: { type: 'array', items: analysisRecommendationParameter(), required: true },
    },
    output: {
      ...outputSchema(),
      render(_args, value) {
        const parsed = MutationResultV1Schema.parse(value)
        return [{ type: 'text', text: parsed.message }]
      },
      presentationMeta(args, value) {
        return presentationMeta('tender_workbench_analysis_commit', args, value)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = AnalysisCommitCommandV1Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const command = await dependencies.receipts.run(String(agent.session.id), {
        commandId: args.commandId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: previousState.revision,
        store: transaction,
        revisionOf: result => MutationResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          assertBinding(previousState, args)
          const baseRows = await loadBoundRows(transaction, previousState)
          const previousAnalysis = await loadPreviousAnalysis(transaction, previousState)
          const binding = analysisBinding(previousState)
          const version = analysisVersion(binding)
          const currentRows = previousAnalysis?.rows ?? baseRows
          const batch = createAnalysisBatch({
            analysisVersion: version,
            activeDatasetRef: binding.activeDatasetId,
            ...(binding.classificationArtifactId === undefined ? {} : { classificationArtifactRef: binding.classificationArtifactId }),
            ...(binding.ruleSetVersion === undefined ? {} : { ruleSetVersion: binding.ruleSetVersion }),
            basedOnRevision: previousState.revision,
            scope: args.scope,
            batchSize: args.batchSize,
            rows: currentRows,
          })
          if (batch.batchId !== args.batchId) throw new Error('batchId 已失效或不属于当前稳定批次。')
          exec.signal.throwIfAborted()
          const now = new Date().toISOString()
          const dataset = commitAnalysisBatch({
            previous: previousAnalysis,
            baseRows,
            batch,
            recommendations: args.recommendations,
            now,
          })
          const analysisData = await transaction.stageJson(
            'analysis-data', `analysis-${version}-${args.commandId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const previousReview = await loadPreviousReview(transaction, previousState)
          const reviewDataset = syncReviewDataset({
            previous: previousReview,
            rows: dataset.rows,
            activeDatasetId: dataset.activeDatasetId,
            ...(dataset.classificationArtifactId === undefined ? {} : { classificationArtifactId: dataset.classificationArtifactId }),
            ...(dataset.ruleSetVersion === undefined ? {} : { ruleSetVersion: dataset.ruleSetVersion }),
            analysisVersion: dataset.analysisVersion,
            now,
          })
          const reviewData = await transaction.stageJson(
            'review-data', `review-sync-${args.commandId}.json`, jsonValue(reviewDataset), reviewDataset.rows.length,
          )
          const counts = reviewCounts(reviewDataset.rows)
          const recommendationCounts = { priorityReview: 0, watch: 0, notRecommended: 0 }
          dataset.rows.forEach((row) => {
            if (row.recommendation?.recommendation === 'priority-review') recommendationCounts.priorityReview += 1
            else if (row.recommendation?.recommendation === 'watch') recommendationCounts.watch += 1
            else if (row.recommendation?.recommendation === 'not-recommended') recommendationCounts.notRecommended += 1
          })
          const completed = recommendationCounts.priorityReview + recommendationCounts.watch + recommendationCounts.notRecommended
          const {
            activeOperation: _activeOperation, lastFailure: _lastFailure, report: _report,
            ...base
          } = previousState
          const state = TenderWorkflowProjectionV1Schema.parse({
            ...base,
            revision: nextRevision,
            currentStage: 'analysis',
            stages: {
              ...base.stages,
              analysis: { status: 'succeeded', updatedAt: now },
              report: { status: 'not-started' },
            },
            analysis: {
              version,
              activeDatasetId: binding.activeDatasetId,
              ...(binding.ruleSetVersion === undefined ? {} : { ruleSetVersion: binding.ruleSetVersion }),
              data: analysisData,
              total: dataset.rows.length,
              completed,
              ...recommendationCounts,
            },
            review: {
              revision: reviewDataset.revision,
              data: reviewData,
              ...counts,
              canRevert: reviewDataset.operations.length > 0,
            },
          })
          return jsonValue(MutationResultV1Schema.parse({
            outcome: 'succeeded',
            message: `已保存 ${args.recommendations.length} 条 Agent 建议；当前覆盖 ${completed}/${dataset.rows.length}，未分析记录仍可直接复核。`,
            state,
          })) as ReceiptJsonValue
        },
      })
      return MutationResultV1Schema.parse(command.result)
    },
  })
}

function assertReviewBinding(
  state: TenderWorkflowProjectionV1,
  args: {
    readonly activeDatasetRef: string
    readonly classificationArtifactRef?: string
    readonly ruleSetVersion?: string
    readonly analysisVersion?: string
    readonly projectionRevision: number
  },
): void {
  assertBinding(state, args)
  if (state.analysis?.version !== args.analysisVersion) {
    throw new Error('当前 Agent 分析版本与复核请求绑定不一致。')
  }
}

async function currentReviewDataset(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV1,
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
  previousState: TenderWorkflowProjectionV1,
  nextRevision: number,
  now: string,
  dataset: z.infer<typeof ReviewDatasetV1Schema>,
  artifact: Awaited<ReturnType<ArtifactTransaction['stageJson']>>,
): TenderWorkflowProjectionV1 {
  const counts = reviewCounts(dataset.rows)
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, report: _report, ...base } = previousState
  return TenderWorkflowProjectionV1Schema.parse({
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
      canRevert: dataset.operations.length > 0,
    },
  })
}

export function createTenderWorkbenchApplyReviewTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_apply_review',
    description: 'Apply one explicit user decision and optional note to exactly the selected current recordRefs. Supports single or bounded batch review. Never derives a user decision from screening classification, Agent recommendation, or linked announcements.',
    parameters: {
      ...commonParameters(),
      analysisVersion: { type: 'string' },
      kind: { type: 'string', const: 'review.apply', required: true },
      recordRefs: { type: 'array', items: { type: 'string' }, required: true },
      decision: { type: 'string', enum: ['confirmed-candidate', 'watch', 'exclude', 'pending'], required: true },
      note: { type: 'string', required: true },
    },
    output: {
      ...outputSchema(),
      render(_args, value) { return [{ type: 'text', text: MutationResultV1Schema.parse(value).message }] },
      presentationMeta(args, value) { return presentationMeta('tender_workbench_apply_review', args, value) },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = ApplyReviewCommandV1Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const command = await dependencies.receipts.run(String(agent.session.id), {
        commandId: args.commandId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: previousState.revision,
        store: transaction,
        revisionOf: result => MutationResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          assertReviewBinding(previousState, args)
          const now = new Date().toISOString()
          const current = await currentReviewDataset(transaction, previousState, now)
          const selected = new Set(args.recordRefs)
          const existing = new Set(current.rows.map(row => row.project.recordId))
          const unknown = args.recordRefs.find(recordRef => !existing.has(recordRef))
          if (unknown !== undefined) throw new Error(`复核范围包含未知 recordRef：${unknown}`)
          const previous = current.rows
            .filter(row => selected.has(row.project.recordId))
            .map(row => ({ recordRef: row.project.recordId, value: row.review }))
          const operation = ReviewOperationV1Schema.parse({
            operationId: args.commandId,
            commandId: args.commandId,
            appliedAt: now,
            decision: args.decision,
            note: args.note,
            recordRefs: args.recordRefs,
            previous,
          })
          const dataset = ReviewDatasetV1Schema.parse({
            ...current,
            revision: current.revision + 1,
            updatedAt: now,
            operations: [...current.operations, operation],
            rows: current.rows.map(row => selected.has(row.project.recordId)
              ? { ...row, review: { decision: args.decision, note: args.note } }
              : row),
          })
          exec.signal.throwIfAborted()
          const artifact = await transaction.stageJson(
            'review-data', `review-${dataset.revision}-${args.commandId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const state = reviewState(previousState, nextRevision, now, dataset, artifact)
          return jsonValue(MutationResultV1Schema.parse({
            outcome: 'succeeded',
            message: `已将 ${args.recordRefs.length} 条记录设置为 ${args.decision}；Agent 建议和初筛分类保持独立。`,
            state,
          })) as ReceiptJsonValue
        },
      })
      return MutationResultV1Schema.parse(command.result)
    },
  })
}

export function createTenderWorkbenchRevertReviewTool(dependencies: AnalysisReviewToolDependencies) {
  return defineTool({
    name: 'tender_workbench_revert_review',
    description: 'Revert only the latest user review operation in the current bound review state. Restore the previous user decisions and notes; never fill values from Agent recommendations.',
    parameters: {
      ...commonParameters(),
      analysisVersion: { type: 'string' },
      kind: { type: 'string', const: 'review.revert', required: true },
    },
    output: {
      ...outputSchema(),
      render(_args, value) { return [{ type: 'text', text: MutationResultV1Schema.parse(value).message }] },
      presentationMeta(args, value) { return presentationMeta('tender_workbench_revert_review', args, value) },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = RevertReviewCommandV1Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const command = await dependencies.receipts.run(String(agent.session.id), {
        commandId: args.commandId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: previousState.revision,
        store: transaction,
        revisionOf: result => MutationResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          assertReviewBinding(previousState, args)
          const now = new Date().toISOString()
          const current = await currentReviewDataset(transaction, previousState, now)
          const operation = current.operations.at(-1)
          if (operation === undefined) throw new Error('当前没有可撤销的复核操作。')
          const restore = new Map(operation.previous.map(item => [item.recordRef, item.value]))
          const dataset = ReviewDatasetV1Schema.parse({
            ...current,
            revision: current.revision + 1,
            updatedAt: now,
            revertedOperationCount: current.revertedOperationCount + 1,
            operations: current.operations.slice(0, -1),
            rows: current.rows.map(row => ({ ...row, review: restore.get(row.project.recordId) ?? row.review })),
          })
          exec.signal.throwIfAborted()
          const artifact = await transaction.stageJson(
            'review-data', `review-${dataset.revision}-${args.commandId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const state = reviewState(previousState, nextRevision, now, dataset, artifact)
          return jsonValue(MutationResultV1Schema.parse({
            outcome: 'succeeded',
            message: `已撤销最近一次复核操作，恢复 ${operation.recordRefs.length} 条记录的上一用户决定和备注。`,
            state,
          })) as ReceiptJsonValue
        },
      })
      return MutationResultV1Schema.parse(command.result)
    },
  })
}
