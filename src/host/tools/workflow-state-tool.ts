import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { TENDER_ACTION_SKILLS, TENDER_INTENT_KINDS, TENDER_TOOLS } from '../../contracts/orchestration.ts'
import { renderTenderToolResult } from '../../contracts/tool-results.ts'
import { GetWorkflowStateInputV2Schema } from '../../contracts/tool-inputs.ts'
import {
  STAGE_STATUSES,
  WORKFLOW_STAGES,
  createEmptyTenderWorkflowProjection,
} from '../../contracts/workflow.ts'

const AvailableActionV2Schema = z.object({
  kind: z.enum(TENDER_INTENT_KINDS),
  skill: z.enum(TENDER_ACTION_SKILLS),
  enabled: z.boolean(),
  reason: z.string().min(1).max(256).optional(),
}).strict()

const WorkflowStateContextV2Schema = z.object({
  schemaVersion: z.literal(2),
  projectionRevision: z.number().int().nonnegative(),
  currentStage: z.enum(WORKFLOW_STAGES),
  stages: z.record(z.enum(WORKFLOW_STAGES), z.enum(STAGE_STATUSES)),
  pending: z.object({
    intentId: z.string().min(1).max(128),
    kind: z.enum(TENDER_INTENT_KINDS),
    status: z.enum(['waiting-agent', 'running']),
    expectedTool: z.enum(TENDER_TOOLS),
  }).strict().optional(),
  query: z.object({ total: z.number().int().nonnegative(), sourceRecordCount: z.number().int().nonnegative() }).strict().optional(),
  rules: z.object({ ruleCount: z.number().int().nonnegative(), previewReady: z.boolean(), ruleSetVersion: z.string().min(1).max(128).optional() }).strict().optional(),
  classification: z.object({
    include: z.number().int().nonnegative(),
    observe: z.number().int().nonnegative(),
    manualReview: z.number().int().nonnegative(),
    exclude: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }).strict().optional(),
  analysis: z.object({ completed: z.number().int().nonnegative(), eligibleTotal: z.number().int().nonnegative() }).strict().optional(),
  review: z.object({ reviewed: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), canRevert: z.boolean() }).strict().optional(),
  report: z.object({
    finalSnapshotId: z.string().min(1).max(128).optional(),
    completeness: z.enum(['partial', 'complete']).optional(),
    excel: z.enum(['not-started', 'running', 'succeeded', 'failed']),
    pdf: z.enum(['not-started', 'running', 'succeeded', 'failed']),
  }).strict().optional(),
  lastFailure: z.object({
    tool: z.string().min(1).max(128),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(512),
  }).strict().optional(),
  availableActions: z.array(AvailableActionV2Schema).length(TENDER_INTENT_KINDS.length),
}).strict()

const WorkflowStateResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_get_workflow_state'),
  message: z.string().min(1).max(512),
  context: WorkflowStateContextV2Schema,
  control: z.object({ status: z.literal('complete') }).strict(),
}).strict()

export type WorkflowStateResultV2 = z.infer<typeof WorkflowStateResultV2Schema>

export interface WorkflowStateToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

export function createTenderWorkbenchWorkflowStateTool(dependencies: WorkflowStateToolDependencies) {
  return defineTool({
    name: 'tender_workbench_get_workflow_state',
    description: 'Read the current bounded workflow stage, progress, result summaries, failure, and available action Skills without modifying any business fact.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_get_workflow_state', required: true },
          message: { type: 'string', required: true },
          context: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(WorkflowStateResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        GetWorkflowStateInputV2Schema.parse(args)
        const parsed = WorkflowStateResultV2Schema.parse(value)
        return jsonValue({
          domain: 'dsh-tender-workbench', schemaVersion: 2,
          tool: 'tender_workbench_get_workflow_state', origin: 'autonomous',
          effect: 'read-only', observedRevision: parsed.context.projectionRevision,
          control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec: ToolRunContext) {
      GetWorkflowStateInputV2Schema.parse(rawArgs)
      if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
      const state = dependencies.sessionProjections.stateOf(exec.agent.session, 'dshTenderWorkflow')
        ?? createEmptyTenderWorkflowProjection()
      const hasData = state.query?.normalizedData !== undefined
      const hasDraft = state.rules?.draft !== undefined
      const previewReady = state.rules?.preview !== undefined && state.rules.previewRevision === state.revision
      const hasClassification = state.classification !== undefined
      const hasLatestReview = state.review?.latestOperationRef !== undefined
      const hasFailedFormat = state.report?.excel.status === 'failed' || state.report?.pdf.status === 'failed'
      const pendingKind = state.pendingIntent?.kind
      const action = (
        kind: typeof TENDER_INTENT_KINDS[number],
        skill: typeof TENDER_ACTION_SKILLS[number],
        prerequisite: boolean,
        prerequisiteReason?: string,
      ) => {
        const enabled = pendingKind === undefined && prerequisite
        const reason = pendingKind === undefined
          ? prerequisiteReason
          : `当前动作 ${pendingKind} 尚未完成。`
        return { kind, skill, enabled, ...(enabled || reason === undefined ? {} : { reason }) }
      }
      const availableActions = [
        action('query.run', 'tender-workbench-query', true),
        action('rules.propose', 'tender-workbench-screening', hasData, '需要先完成查询。'),
        action('rules.adjust', 'tender-workbench-screening', hasDraft, '当前没有可调整的规则草案。'),
        action('rules.preview', 'tender-workbench-screening', hasDraft, '当前没有可预览的规则草案。'),
        action('rules.confirm', 'tender-workbench-screening', previewReady, '当前没有与最新状态一致的 Dry Run。'),
        action('analysis.run', 'tender-workbench-analysis', hasClassification, '需要先确认规则并完成分类。'),
        action('analysis.follow-up', 'tender-workbench-analysis', hasClassification, '当前没有可追问的分类记录。'),
        action('review.apply', 'tender-workbench-review', hasData, '需要先完成查询。'),
        action('review.revert', 'tender-workbench-review', hasLatestReview, '当前没有可撤销的复核操作。'),
        action('report.create', 'tender-workbench-report', state.review !== undefined, '需要先进入人工复核并形成当前复核范围。'),
        action('report.retry', 'tender-workbench-report', hasFailedFormat, '当前交付快照没有失败格式。'),
      ]
      const context = WorkflowStateContextV2Schema.parse({
        schemaVersion: 2,
        projectionRevision: state.revision,
        currentStage: state.currentStage,
        stages: Object.fromEntries(WORKFLOW_STAGES.map(stage => [stage, state.stages[stage].status])),
        ...(state.pendingIntent === undefined ? {} : { pending: {
          intentId: state.pendingIntent.intentId,
          kind: state.pendingIntent.kind,
          status: state.pendingIntent.status,
          expectedTool: state.pendingIntent.expectedTool,
        } }),
        ...(state.query === undefined ? {} : { query: {
          total: state.query.total,
          sourceRecordCount: state.query.sourceRecordCount ?? state.query.total,
        } }),
        ...(state.rules === undefined ? {} : { rules: {
          ruleCount: state.rules.ruleCount,
          previewReady,
          ...(state.rules.ruleSetVersion === undefined ? {} : { ruleSetVersion: state.rules.ruleSetVersion }),
        } }),
        ...(state.classification === undefined ? {} : { classification: {
          include: state.classification.include,
          observe: state.classification.observe,
          manualReview: state.classification.manualReview,
          exclude: state.classification.exclude,
          unmatched: state.classification.unmatched,
        } }),
        ...(state.analysis === undefined ? {} : { analysis: {
          completed: state.analysis.completed,
          eligibleTotal: state.analysis.eligibleTotal,
        } }),
        ...(state.review === undefined ? {} : { review: {
          reviewed: state.review.confirmedCandidate + state.review.watch + state.review.exclude,
          pending: state.review.pending,
          canRevert: state.review.canRevert,
        } }),
        ...(state.report === undefined ? {} : { report: {
          ...(state.report.finalSnapshotId === undefined ? {} : { finalSnapshotId: state.report.finalSnapshotId }),
          ...(state.report.completeness === undefined ? {} : { completeness: state.report.completeness }),
          excel: state.report.excel.status,
          pdf: state.report.pdf.status,
        } }),
        ...(state.lastFailure === undefined ? {} : { lastFailure: {
          tool: state.lastFailure.tool,
          code: state.lastFailure.code,
          message: state.lastFailure.message,
        } }),
        availableActions,
      })
      exec.signal.throwIfAborted()
      return WorkflowStateResultV2Schema.parse({
        domain: 'dsh-tender-workbench', schemaVersion: 2,
        tool: 'tender_workbench_get_workflow_state',
        message: `当前工作流阶段为 ${state.currentStage}，业务修订为 ${state.revision}。`,
        context,
        control: { status: 'complete' },
      })
    },
  })
}
