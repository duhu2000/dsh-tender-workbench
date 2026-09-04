import { z } from 'zod'
import {
  TENDER_TOOLS,
  TENDER_INTENT_KINDS,
  TENDER_ACTION_SKILLS,
} from './orchestration.ts'
import { TenderToolControlV2Schema } from './tool-results.ts'

export const WORKFLOW_STAGES = [
  'query', 'overview', 'rules', 'classification', 'analysis', 'review', 'report',
] as const
export const STAGE_STATUSES = [
  'not-started', 'waiting-agent', 'running', 'succeeded', 'failed', 'blocked',
] as const

export const TENDER_TOOL_CONTRACTS = {
  tender_workbench_run_query: { stage: 'query', effect: 'mutation' },
  tender_workbench_preview_rules: { stage: 'rules', effect: 'mutation' },
  tender_workbench_confirm_rules: { stage: 'classification', effect: 'mutation' },
  tender_workbench_prepare_analysis_batch: { stage: 'analysis', effect: 'read-only' },
  tender_workbench_commit_analysis_batch: { stage: 'analysis', effect: 'mutation' },
  tender_workbench_apply_review: { stage: 'review', effect: 'mutation' },
  tender_workbench_revert_review: { stage: 'review', effect: 'mutation' },
  tender_workbench_create_report: { stage: 'report', effect: 'mutation' },
  tender_workbench_retry_report: { stage: 'report', effect: 'mutation' },
  tender_workbench_get_workflow_state: { stage: 'overview', effect: 'read-only' },
  tender_workbench_get_rule_drafting_context: { stage: 'rules', effect: 'read-only' },
  tender_workbench_get_analysis_record_context: { stage: 'analysis', effect: 'read-only' },
  tender_workbench_get_report_narrative_context: { stage: 'report', effect: 'read-only' },
} as const

export type WorkflowStage = typeof WORKFLOW_STAGES[number]
export type StageStatus = typeof STAGE_STATUSES[number]
export type TenderToolName = keyof typeof TENDER_TOOL_CONTRACTS
export type TenderToolNameV2 = TenderToolName
export type RuleAction = 'include' | 'observe' | 'exclude' | 'manual-review'
/** S3 can execute only against fields retained by NormalizedProjectV1. */
export type RuleScope = 'title' | 'purchaser' | 'all'
export type AgentRecommendation = 'priority-review' | 'watch' | 'not-recommended'
export type UserDecision = 'confirmed-candidate' | 'watch' | 'exclude' | 'pending'

const idText = z.string().min(1).max(128)
const errorText = z.string().min(1).max(512)
const timestamp = z.string().datetime({ offset: true })

export const ArtifactRefV1Schema = z.object({
  id: idText,
  kind: z.enum([
    'query-spec', 'source-data', 'normalized-data', 'rule-draft', 'rule-preview',
    'rule-set', 'classified-data', 'analysis-data', 'review-data', 'final-snapshot',
    'excel', 'pdf',
  ]),
  fileName: z.string().min(1).max(256),
  mediaType: z.string().min(1).max(128),
  rowCount: z.number().int().nonnegative().optional(),
  createdAt: timestamp,
  accessToken: idText,
}).strict()

export type ArtifactRefV1 = z.infer<typeof ArtifactRefV1Schema>

const stageStateSchema = z.object({
  status: z.enum(STAGE_STATUSES),
  updatedAt: timestamp.optional(),
  errorCode: idText.optional(),
  errorMessage: errorText.optional(),
}).strict()

const reportFormatStateSchema = z.object({
  status: z.enum(['not-started', 'running', 'succeeded', 'failed']),
  artifact: ArtifactRefV1Schema.optional(),
  errorMessage: errorText.optional(),
}).strict()

const stagesSchema = z.object(Object.fromEntries(
  WORKFLOW_STAGES.map(stage => [stage, stageStateSchema]),
) as Record<WorkflowStage, typeof stageStateSchema>).strict()

export const TenderWorkflowProjectionV2Schema = z.object({
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  currentStage: z.enum(WORKFLOW_STAGES),
  observedTurn: z.number().int().positive().optional(),
  pendingIntent: z.object({
    intentId: idText,
    kind: z.enum(TENDER_INTENT_KINDS),
    skill: z.enum(TENDER_ACTION_SKILLS),
    origin: z.enum(['workbench-intent', 'conversation']),
    status: z.enum(['waiting-agent', 'running']),
    turn: z.number().int().positive(),
    expectedTool: z.enum(TENDER_TOOLS),
    terminalTools: z.array(z.enum(TENDER_TOOLS)).min(1).max(TENDER_TOOLS.length),
    intentFingerprint: idText,
    bindingFingerprint: idText,
    awaitingTurnEnd: z.boolean().optional(),
  }).strict().optional(),
  activeOperation: z.object({
    callId: idText,
    intentId: idText.optional(),
    tool: z.enum(TENDER_TOOLS),
    origin: z.enum(['workbench-intent', 'conversation', 'autonomous']),
    stage: z.enum(WORKFLOW_STAGES),
    previousCurrentStage: z.enum(WORKFLOW_STAGES).optional(),
    previousStageState: stageStateSchema.optional(),
  }).strict().optional(),
  stages: stagesSchema,
  query: z.object({
    scope: z.enum(['tender', 'proposed', 'combined']),
    targetSummary: z.string().max(2_048),
    querySpec: ArtifactRefV1Schema,
    sources: z.object({
      tender: z.object({
        status: z.enum(['succeeded', 'failed']), loaded: z.number().int().nonnegative(),
        errorMessage: errorText.optional(), sourceData: ArtifactRefV1Schema.optional(),
      }).strict().optional(),
      proposed: z.object({
        status: z.enum(['succeeded', 'failed']), loaded: z.number().int().nonnegative(),
        errorMessage: errorText.optional(), sourceData: ArtifactRefV1Schema.optional(),
      }).strict().optional(),
    }).strict(),
    normalizedData: ArtifactRefV1Schema.optional(),
    sourceRecordCount: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    invalidCount: z.number().int().nonnegative(),
    missingFieldCount: z.number().int().nonnegative().optional(),
    unparseableFieldCount: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  rules: z.object({
    draft: ArtifactRefV1Schema.optional(),
    draftOrigin: z.enum(['agent', 'user']).optional(),
    draftFingerprint: idText.optional(),
    preview: ArtifactRefV1Schema.optional(),
    previewRevision: z.number().int().nonnegative().optional(),
    activeDatasetId: idText.optional(),
    confirmed: ArtifactRefV1Schema.optional(),
    ruleSetVersion: idText.optional(),
    ruleCount: z.number().int().nonnegative(),
    rawMatches: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative().optional(),
    conflicts: z.number().int().nonnegative(),
  }).strict().optional(),
  classification: z.object({
    data: ArtifactRefV1Schema,
    include: z.number().int().nonnegative(),
    observe: z.number().int().nonnegative(),
    exclude: z.number().int().nonnegative(),
    manualReview: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    ruleSetVersion: idText,
    activeDatasetId: idText,
  }).strict().optional(),
  analysis: z.object({
    version: idText,
    activeDatasetId: idText,
    ruleSetVersion: idText.optional(),
    data: ArtifactRefV1Schema.optional(),
    eligibleTotal: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    priorityReview: z.number().int().nonnegative(),
    watch: z.number().int().nonnegative(),
    notRecommended: z.number().int().nonnegative(),
    urgent: z.number().int().nonnegative(),
  }).strict().optional(),
  review: z.object({
    revision: z.number().int().nonnegative(),
    data: ArtifactRefV1Schema,
    pending: z.number().int().nonnegative(),
    confirmedCandidate: z.number().int().nonnegative(),
    confirmedTender: z.number().int().nonnegative().optional(),
    priorityProposed: z.number().int().nonnegative().optional(),
    watch: z.number().int().nonnegative(),
    exclude: z.number().int().nonnegative(),
    canRevert: z.boolean(),
    latestOperationRef: idText.optional(),
  }).strict().optional(),
  report: z.object({
    finalSnapshot: ArtifactRefV1Schema.optional(),
    finalSnapshotId: idText.optional(),
    completeness: z.enum(['partial', 'complete']).optional(),
    createdAt: timestamp.optional(),
    rawRecords: z.number().int().nonnegative().optional(),
    normalizedProjects: z.number().int().nonnegative().optional(),
    reviewed: z.number().int().nonnegative().optional(),
    confirmedTender: z.number().int().nonnegative().optional(),
    priorityProposed: z.number().int().nonnegative().optional(),
    watch: z.number().int().nonnegative().optional(),
    pending: z.number().int().nonnegative().optional(),
    exclude: z.number().int().nonnegative().optional(),
    analysisCompleted: z.number().int().nonnegative().optional(),
    analysisTotal: z.number().int().nonnegative().optional(),
    narrativeIncluded: z.boolean().optional(),
    excel: reportFormatStateSchema,
    pdf: reportFormatStateSchema,
  }).strict().optional(),
  lastFailure: z.object({
    intentId: idText.optional(),
    tool: z.enum(TENDER_TOOLS),
    code: idText,
    message: errorText,
  }).strict().optional(),
}).strict()

export type TenderWorkflowProjectionV2 = z.infer<typeof TenderWorkflowProjectionV2Schema>

const toolMetaBase = {
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.enum(TENDER_TOOLS),
  intentId: idText.optional(),
  origin: z.enum(['workbench-intent', 'conversation', 'autonomous']),
}

export const TenderToolMetaV2Schema = z.union([
  z.object({
    ...toolMetaBase,
    effect: z.literal('read-only'),
    observedRevision: z.number().int().nonnegative(),
    control: z.union([
      z.object({ status: z.literal('complete') }).strict(),
      z.object({ status: z.literal('continue'), nextTool: z.enum(TENDER_TOOLS) }).strict(),
    ]),
  }).strict(),
  z.object({
    ...toolMetaBase,
    effect: z.literal('mutation'),
    previousRevision: z.number().int().nonnegative(),
    state: TenderWorkflowProjectionV2Schema,
    control: TenderToolControlV2Schema,
  }).strict(),
  z.object({
    ...toolMetaBase,
    effect: z.literal('failed'),
    observedRevision: z.number().int().nonnegative(),
    control: z.object({
      status: z.literal('failed'),
      reasonCode: idText,
      retryable: z.boolean(),
    }).strict(),
  }).strict(),
])

export type TenderToolMetaV2 = z.infer<typeof TenderToolMetaV2Schema>

export const TenderRuleV1Schema = z.object({
  id: idText,
  name: z.string().trim().min(1).max(128),
  enabled: z.boolean(),
  action: z.enum(['include', 'observe', 'exclude', 'manual-review']),
  sources: z.array(z.enum(['tender', 'proposed'])).min(1).max(2)
    .refine(values => new Set(values).size === values.length, 'rule sources must be unique'),
  scope: z.enum(['title', 'purchaser', 'all']),
  keywords: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
  priority: z.number().int().min(-1_000).max(1_000),
  exceptions: z.array(z.string().trim().min(1).max(128)).max(50),
  reason: z.string().trim().min(1).max(512),
}).strict()

export type TenderRuleV1 = z.infer<typeof TenderRuleV1Schema>

export const TenderRuleSetV1Schema = z.array(TenderRuleV1Schema).min(1).max(100)
  .superRefine((rules, context) => {
    const ids = new Set<string>()
    rules.forEach((rule, index) => {
      if (ids.has(rule.id)) {
        context.addIssue({ code: 'custom', path: [index, 'id'], message: 'rule ids must be unique' })
      }
      ids.add(rule.id)
    })
  })

export const MAX_PROJECTION_BYTES = 64 * 1_024

export function projectionSizeBytes(value: TenderWorkflowProjectionV2): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function parseTenderWorkflowProjectionV2(value: unknown): TenderWorkflowProjectionV2 {
  const parsed = TenderWorkflowProjectionV2Schema.parse(value)
  const size = projectionSizeBytes(parsed)
  if (size > MAX_PROJECTION_BYTES) throw new RangeError(`tender workflow projection exceeds ${MAX_PROJECTION_BYTES} bytes`)
  return parsed
}

export function parseTenderToolMetaV2(value: unknown): TenderToolMetaV2 {
  const parsed = TenderToolMetaV2Schema.parse(value)
  if (parsed.effect === 'mutation') parseTenderWorkflowProjectionV2(parsed.state)
  return parsed
}

export function createEmptyTenderWorkflowProjection(): TenderWorkflowProjectionV2 {
  const stages = Object.fromEntries(WORKFLOW_STAGES.map(stage => [stage, { status: 'not-started' }]))
  return TenderWorkflowProjectionV2Schema.parse({
    schemaVersion: 2,
    revision: 0,
    currentStage: 'query',
    stages,
  })
}
