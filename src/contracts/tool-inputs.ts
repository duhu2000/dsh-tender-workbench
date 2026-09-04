import { z } from 'zod'
import {
  QccProposedSearchArgsSchema,
  QccTenderSearchArgsSchema,
  hasSupportedQueryFilter,
} from './query-schema.ts'
import {
  AgentRecommendationInputV1Schema,
  AnalysisScopeV1Schema,
  USER_DECISIONS,
} from './analysis-review.ts'
import { REPORT_FORMATS, ReportNarrativeV1Schema } from './reporting.ts'
import { TenderRuleSetV1Schema } from './workflow.ts'
import { TenderToolOriginV2Schema } from './tool-results.ts'
import type { TenderToolNameV2 } from './orchestration.ts'

const idText = z.string().min(1).max(128)
const revision = z.number().int().nonnegative()

export const TenderActionOriginV2Schema = z.union([
  z.object({ kind: z.literal('workbench-intent'), intentId: idText }).strict(),
  z.object({ kind: z.literal('conversation') }).strict(),
])

export const GetWorkflowStateInputV2Schema = z.object({}).strict()

const datasetBinding = {
  activeDatasetRef: idText,
  projectionRevision: revision,
}

const classificationBinding = {
  ...datasetBinding,
  classificationArtifactRef: idText,
  ruleSetVersion: idText,
}

export const RunQueryToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  projectionRevision: revision,
  scope: z.enum(['tender', 'proposed', 'combined']),
  target: z.string().trim().min(1).max(2_048),
  tender: QccTenderSearchArgsSchema.optional(),
  proposed: QccProposedSearchArgsSchema.optional(),
}).strict().superRefine((value, context) => {
  const valid = value.scope === 'tender'
    ? value.tender !== undefined && value.proposed === undefined
    : value.scope === 'proposed'
      ? value.proposed !== undefined && value.tender === undefined
      : value.tender !== undefined && value.proposed !== undefined
  if (!valid) context.addIssue({ code: 'custom', path: ['scope'], message: 'scope must match query branches' })
  if (value.tender !== undefined && !hasSupportedQueryFilter(value.tender)) {
    context.addIssue({ code: 'custom', path: ['tender'], message: 'tender request must contain a supported filter' })
  }
  if (value.proposed !== undefined && !hasSupportedQueryFilter(value.proposed)) {
    context.addIssue({ code: 'custom', path: ['proposed'], message: 'proposed request must contain a supported filter' })
  }
})

export const GetRuleDraftingContextInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderToolOriginV2Schema,
  ...datasetBinding,
}).strict()

const rulePreviewMode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent-proposal'), contextFingerprint: idText }).strict(),
  z.object({ kind: z.literal('agent-adjustment'), baseDraftFingerprint: idText }).strict(),
  z.object({ kind: z.literal('user-dry-run'), draftFingerprint: idText }).strict(),
])

export const PreviewRulesToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...datasetBinding,
  mode: rulePreviewMode,
  rules: TenderRuleSetV1Schema,
}).strict()

export const ConfirmRulesToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...datasetBinding,
  previewArtifactRef: idText,
  draftFingerprint: idText,
}).strict()

export const PrepareAnalysisBatchInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...classificationBinding,
  scope: AnalysisScopeV1Schema,
}).strict()

export const CommitAnalysisBatchInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...classificationBinding,
  scope: AnalysisScopeV1Schema,
  batchId: idText,
  recommendations: z.array(AgentRecommendationInputV1Schema).min(1).max(20),
}).strict()

export const GetAnalysisRecordContextInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderToolOriginV2Schema,
  ...classificationBinding,
  analysisVersion: idText.optional(),
  recordRef: idText,
}).strict()

export const ReviewBasisV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataset-only') }).strict(),
  z.object({
    kind: z.literal('classified'),
    classificationArtifactRef: idText,
    ruleSetVersion: idText,
    analysisVersion: idText.optional(),
  }).strict(),
])

const reviewBinding = {
  ...datasetBinding,
  basis: ReviewBasisV2Schema,
  reviewArtifactRef: idText.optional(),
  reviewRevision: revision,
}

export const ApplyReviewToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...reviewBinding,
  decisions: z.array(z.object({
    recordRef: idText,
    decision: z.enum(USER_DECISIONS),
    note: z.string().trim().max(2_048),
  }).strict()).min(1).max(100).refine(
    values => new Set(values.map(value => value.recordRef)).size === values.length,
    'review record refs must be unique',
  ),
}).strict()

export const RevertReviewToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...reviewBinding,
  latestOperationRef: idText,
}).strict()

export const GetReportNarrativeContextInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderToolOriginV2Schema,
  ...reviewBinding,
}).strict()

const reportNarrative = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('bound'),
    contextFingerprint: z.string().regex(/^rc_[a-f0-9]{64}$/u),
    contextAsOf: z.string().datetime({ offset: true }),
    value: ReportNarrativeV1Schema,
  }).strict(),
])

export const CreateReportToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  ...reviewBinding,
  scope: z.enum(['complete', 'current-progress']),
  confirmPending: z.boolean(),
  narrative: reportNarrative,
}).strict()

export const RetryReportToolInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  origin: TenderActionOriginV2Schema,
  projectionRevision: revision,
  finalSnapshotId: idText,
  formats: z.array(z.enum(REPORT_FORMATS)).min(1).max(2)
    .refine(values => new Set(values).size === values.length, 'retry formats must be unique'),
}).strict()

export const TENDER_TOOL_INPUT_SCHEMAS = {
  tender_workbench_run_query: RunQueryToolInputV2Schema,
  tender_workbench_preview_rules: PreviewRulesToolInputV2Schema,
  tender_workbench_confirm_rules: ConfirmRulesToolInputV2Schema,
  tender_workbench_prepare_analysis_batch: PrepareAnalysisBatchInputV2Schema,
  tender_workbench_commit_analysis_batch: CommitAnalysisBatchInputV2Schema,
  tender_workbench_apply_review: ApplyReviewToolInputV2Schema,
  tender_workbench_revert_review: RevertReviewToolInputV2Schema,
  tender_workbench_create_report: CreateReportToolInputV2Schema,
  tender_workbench_retry_report: RetryReportToolInputV2Schema,
  tender_workbench_get_workflow_state: GetWorkflowStateInputV2Schema,
  tender_workbench_get_rule_drafting_context: GetRuleDraftingContextInputV2Schema,
  tender_workbench_get_analysis_record_context: GetAnalysisRecordContextInputV2Schema,
  tender_workbench_get_report_narrative_context: GetReportNarrativeContextInputV2Schema,
} as const satisfies Record<TenderToolNameV2, z.ZodType>

export type GetWorkflowStateInputV2 = z.infer<typeof GetWorkflowStateInputV2Schema>
export type RunQueryToolInputV2 = z.infer<typeof RunQueryToolInputV2Schema>
export type GetRuleDraftingContextInputV2 = z.infer<typeof GetRuleDraftingContextInputV2Schema>
export type PreviewRulesToolInputV2 = z.infer<typeof PreviewRulesToolInputV2Schema>
export type ConfirmRulesToolInputV2 = z.infer<typeof ConfirmRulesToolInputV2Schema>
export type PrepareAnalysisBatchInputV2 = z.infer<typeof PrepareAnalysisBatchInputV2Schema>
export type CommitAnalysisBatchInputV2 = z.infer<typeof CommitAnalysisBatchInputV2Schema>
export type GetAnalysisRecordContextInputV2 = z.infer<typeof GetAnalysisRecordContextInputV2Schema>
export type ApplyReviewToolInputV2 = z.infer<typeof ApplyReviewToolInputV2Schema>
export type RevertReviewToolInputV2 = z.infer<typeof RevertReviewToolInputV2Schema>
export type GetReportNarrativeContextInputV2 = z.infer<typeof GetReportNarrativeContextInputV2Schema>
export type CreateReportToolInputV2 = z.infer<typeof CreateReportToolInputV2Schema>
export type RetryReportToolInputV2 = z.infer<typeof RetryReportToolInputV2Schema>
