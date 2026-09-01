import { z } from 'zod'

export const WORKFLOW_STAGES = [
  'query', 'overview', 'rules', 'classification', 'analysis', 'review', 'report',
] as const
export const STAGE_STATUSES = [
  'not-started', 'waiting-agent', 'running', 'succeeded', 'failed', 'blocked',
] as const

export const TENDER_TOOL_CONTRACTS = {
  tender_workbench_query: { command: 'tender_workbench_query', stage: 'query' },
  tender_workbench_preview_rules: { command: 'tender_workbench_preview_rules', stage: 'rules' },
  tender_workbench_confirm_rules: { command: 'tender_workbench_confirm_rules', stage: 'classification' },
  tender_workbench_analysis_next: { command: 'tender_workbench_analysis_next', stage: 'analysis' },
  tender_workbench_analysis_commit: { command: 'tender_workbench_analysis_commit', stage: 'analysis' },
  tender_workbench_apply_review: { command: 'tender_workbench_apply_review', stage: 'review' },
  tender_workbench_revert_review: { command: 'tender_workbench_revert_review', stage: 'review' },
  tender_workbench_generate_report: { command: 'tender_workbench_generate_report', stage: 'report' },
} as const

export type WorkflowStage = typeof WORKFLOW_STAGES[number]
export type StageStatus = typeof STAGE_STATUSES[number]
export type TenderToolName = keyof typeof TENDER_TOOL_CONTRACTS
export type TenderCommandKind = typeof TENDER_TOOL_CONTRACTS[TenderToolName]['command']
export type RuleAction = 'include' | 'observe' | 'exclude' | 'manual-review'
export type RuleScope = 'title' | 'purchaser' | 'summary' | 'body' | 'all'
export type AgentRecommendation = 'priority-review' | 'watch' | 'not-recommended'
export type UserDecision = 'final' | 'observe' | 'exclude' | 'pending'

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

export const TenderWorkflowProjectionV1Schema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  currentStage: z.enum(WORKFLOW_STAGES),
  activeOperation: z.object({
    callId: idText,
    commandId: idText,
    command: z.enum(Object.keys(TENDER_TOOL_CONTRACTS) as [TenderCommandKind, ...TenderCommandKind[]]),
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
    preview: ArtifactRefV1Schema.optional(),
    confirmed: ArtifactRefV1Schema.optional(),
    ruleSetVersion: idText.optional(),
    ruleCount: z.number().int().nonnegative(),
    rawMatches: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }).strict().optional(),
  classification: z.object({
    data: ArtifactRefV1Schema,
    include: z.number().int().nonnegative(),
    observe: z.number().int().nonnegative(),
    exclude: z.number().int().nonnegative(),
    manualReview: z.number().int().nonnegative(),
  }).strict().optional(),
  analysis: z.object({
    version: idText,
    data: ArtifactRefV1Schema.optional(),
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    priorityReview: z.number().int().nonnegative(),
    watch: z.number().int().nonnegative(),
    notRecommended: z.number().int().nonnegative(),
  }).strict().optional(),
  review: z.object({
    revision: z.number().int().nonnegative(),
    data: ArtifactRefV1Schema,
    pending: z.number().int().nonnegative(),
    final: z.number().int().nonnegative(),
    observe: z.number().int().nonnegative(),
    exclude: z.number().int().nonnegative(),
    canRevert: z.boolean(),
  }).strict().optional(),
  report: z.object({
    finalSnapshot: ArtifactRefV1Schema.optional(),
    excel: reportFormatStateSchema,
    pdf: reportFormatStateSchema,
  }).strict().optional(),
  lastFailure: z.object({
    command: z.enum(Object.keys(TENDER_TOOL_CONTRACTS) as [TenderCommandKind, ...TenderCommandKind[]]),
    code: idText,
    message: errorText,
  }).strict().optional(),
}).strict()

export type TenderWorkflowProjectionV1 = z.infer<typeof TenderWorkflowProjectionV1Schema>

export const TenderToolMetaV1Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(1),
  commandId: idText,
  command: z.enum(Object.keys(TENDER_TOOL_CONTRACTS) as [TenderCommandKind, ...TenderCommandKind[]]),
  state: TenderWorkflowProjectionV1Schema,
}).strict()

export type TenderToolMetaV1 = z.infer<typeof TenderToolMetaV1Schema>

export const TenderRuleV1Schema = z.object({
  id: idText,
  name: z.string().trim().min(1).max(128),
  enabled: z.boolean(),
  action: z.enum(['include', 'observe', 'exclude', 'manual-review']),
  scope: z.enum(['title', 'purchaser', 'summary', 'body', 'all']),
  keywords: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
  priority: z.number().int().min(-1_000).max(1_000),
  exceptions: z.array(z.string().trim().min(1).max(128)).max(50),
  reason: z.string().trim().min(1).max(512),
}).strict()

export type TenderRuleV1 = z.infer<typeof TenderRuleV1Schema>

export const MAX_PROJECTION_BYTES = 64 * 1_024

export function projectionSizeBytes(value: TenderWorkflowProjectionV1): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function parseTenderWorkflowProjectionV1(value: unknown): TenderWorkflowProjectionV1 {
  const parsed = TenderWorkflowProjectionV1Schema.parse(value)
  const size = projectionSizeBytes(parsed)
  if (size > MAX_PROJECTION_BYTES) throw new RangeError(`tender workflow projection exceeds ${MAX_PROJECTION_BYTES} bytes`)
  return parsed
}

export function parseTenderToolMetaV1(value: unknown): TenderToolMetaV1 {
  const parsed = TenderToolMetaV1Schema.parse(value)
  parseTenderWorkflowProjectionV1(parsed.state)
  return parsed
}

export function createEmptyTenderWorkflowProjection(): TenderWorkflowProjectionV1 {
  const stages = Object.fromEntries(WORKFLOW_STAGES.map(stage => [stage, { status: 'not-started' }]))
  return TenderWorkflowProjectionV1Schema.parse({
    schemaVersion: 1,
    revision: 0,
    currentStage: 'query',
    stages,
  })
}
