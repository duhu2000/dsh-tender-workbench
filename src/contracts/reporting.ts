import { z } from 'zod'
import { TechnicalInvalidRecordV1Schema } from './dataset.ts'
import { ReviewRecordV1Schema } from './analysis-review.ts'

export const REPORT_FORMATS = ['excel', 'pdf'] as const
export const REPORT_COMPLETENESS = ['partial', 'complete'] as const

const idText = z.string().min(1).max(128)
const boundedText = z.string().trim().min(1).max(2_048)
const timestamp = z.string().datetime({ offset: true })

export const MetricDefinitionV1Schema = z.object({
  id: idText,
  label: z.string().min(1).max(128),
  description: boundedText,
  unit: z.enum(['record', 'project', 'currency', 'percent']),
  numeratorLabel: z.string().min(1).max(128).optional(),
  denominatorLabel: z.string().min(1).max(128).optional(),
  scopeDescription: boundedText,
  limitation: boundedText.optional(),
}).strict()

export type MetricDefinitionV1 = z.infer<typeof MetricDefinitionV1Schema>

export const MetricValueV1Schema = z.object({
  metricId: idText,
  value: z.number().finite(),
  numerator: z.number().finite().nonnegative().optional(),
  denominator: z.number().finite().nonnegative().optional(),
  missingCount: z.number().int().nonnegative().optional(),
}).strict()

export type MetricValueV1 = z.infer<typeof MetricValueV1Schema>

export const ReportContextRecordV1Schema = z.object({
  recordRef: idText,
  source: z.enum(['tender', 'proposed']),
  title: z.string().min(1).max(2_048),
  evidenceRefs: z.array(z.string().min(1).max(256)).max(32),
}).strict()

export type ReportContextRecordV1 = z.infer<typeof ReportContextRecordV1Schema>

export const ReportContextV1Schema = z.object({
  schemaVersion: z.literal(1),
  activeDatasetId: idText,
  stateRevision: z.number().int().nonnegative(),
  contextFingerprint: z.string().regex(/^rc_[a-f0-9]{64}$/u),
  metricDefinitions: z.array(MetricDefinitionV1Schema).min(1).max(100),
  metrics: z.array(MetricValueV1Schema).min(1).max(100),
  priorityRecords: z.array(ReportContextRecordV1Schema).max(10),
  analysisCoverage: z.object({
    analyzedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export type ReportContextV1 = z.infer<typeof ReportContextV1Schema>

/** One bounded Agent-authored observation. It never carries numeric facts or layout instructions. */
export const ReportObservationV1Schema = z.object({
  title: z.string().trim().min(1).max(128),
  statement: boundedText,
  metricRefs: z.array(idText).max(10)
    .refine(values => new Set(values).size === values.length, 'metric refs must be unique'),
  recordRefs: z.array(idText).max(10)
    .refine(values => new Set(values).size === values.length, 'record refs must be unique'),
  limitations: z.array(boundedText).max(5),
}).strict().refine(value => value.metricRefs.length > 0 || value.recordRefs.length > 0, {
  message: 'report observation requires at least one metricRef or recordRef',
})

export type ReportObservationV1 = z.infer<typeof ReportObservationV1Schema>

export const ReportNarrativeV1Schema = z.object({
  executiveSummary: ReportObservationV1Schema.optional(),
  keyFindings: z.array(ReportObservationV1Schema).max(5),
  priorityVerification: z.array(ReportObservationV1Schema).max(10),
  risksAndLimitations: z.array(ReportObservationV1Schema).max(5),
}).strict()

export type ReportNarrativeV1 = z.infer<typeof ReportNarrativeV1Schema>

export const AmountDistributionV1Schema = z.object({
  source: z.enum(['tender', 'proposed']),
  amountType: z.enum(['budget', 'total-investment']),
  eligibleCount: z.number().int().nonnegative(),
  parsedCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  medianCny: z.number().finite().nonnegative().optional(),
  bands: z.array(z.object({
    id: idText,
    label: z.string().min(1).max(128),
    count: z.number().int().nonnegative(),
  }).strict()).min(3).max(6),
  limitation: boundedText,
}).strict()

export const ReportDatasetV1Schema = z.object({
  schemaVersion: z.literal(1),
  finalSnapshotId: idText,
  createdAt: timestamp,
  timeZone: z.literal('Asia/Shanghai'),
  completeness: z.enum(REPORT_COMPLETENESS),
  activeDatasetId: idText,
  ruleSetVersion: idText.optional(),
  analysisVersion: idText.optional(),
  reviewRevision: z.number().int().nonnegative(),
  stateRevision: z.number().int().nonnegative(),
  contextFingerprint: z.string().regex(/^rc_[a-f0-9]{64}$/u),
  narrative: ReportNarrativeV1Schema.optional(),
  query: z.object({
    scope: z.enum(['tender', 'proposed', 'combined']),
    targetSummary: z.string().max(2_048),
    sources: z.object({
      tender: z.object({ status: z.enum(['succeeded', 'failed']), loaded: z.number().int().nonnegative(), errorMessage: boundedText.optional() }).strict().optional(),
      proposed: z.object({ status: z.enum(['succeeded', 'failed']), loaded: z.number().int().nonnegative(), errorMessage: boundedText.optional() }).strict().optional(),
    }).strict(),
  }).strict(),
  metricDefinitions: z.array(MetricDefinitionV1Schema).min(1).max(100),
  metricValues: z.array(MetricValueV1Schema).min(1).max(100),
  amountDistributions: z.array(AmountDistributionV1Schema).length(2),
  priorityRecordRefs: z.array(idText).max(10),
  limitations: z.array(boundedText).min(1).max(20),
  invalidRecords: z.array(TechnicalInvalidRecordV1Schema).max(20_000),
  rows: z.array(ReviewRecordV1Schema).max(20_000),
}).strict()

export type ReportDatasetV1 = z.infer<typeof ReportDatasetV1Schema>

const reportStateBinding = {
  schemaVersion: z.literal(1),
  activeDatasetRef: idText,
  classificationArtifactRef: idText.optional(),
  ruleSetVersion: idText.optional(),
  analysisVersion: idText.optional(),
  reviewArtifactRef: idText.optional(),
  reviewRevision: z.number().int().nonnegative(),
  projectionRevision: z.number().int().nonnegative(),
}

export const GetReportContextCommandV1Schema = z.object({
  ...reportStateBinding,
  kind: z.literal('report.context'),
}).strict()

export type GetReportContextCommandV1 = z.infer<typeof GetReportContextCommandV1Schema>

const reportCommandBinding = {
  ...reportStateBinding,
  kind: z.literal('report.generate'),
  commandId: idText,
}

export const CreateReportCommandV1Schema = z.object({
  ...reportCommandBinding,
  mode: z.literal('create'),
  confirmPending: z.boolean(),
  contextFingerprint: z.string().regex(/^rc_[a-f0-9]{64}$/u).optional(),
  narrative: ReportNarrativeV1Schema.optional(),
}).strict().superRefine((value, context) => {
  if ((value.contextFingerprint === undefined) !== (value.narrative === undefined)) {
    context.addIssue({ code: 'custom', message: 'contextFingerprint and narrative must be provided together' })
  }
})

export const RetryReportCommandV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('report.generate'),
  commandId: idText,
  projectionRevision: z.number().int().nonnegative(),
  mode: z.literal('retry'),
  finalSnapshotId: idText,
  formats: z.array(z.enum(REPORT_FORMATS)).min(1).max(2)
    .refine(values => new Set(values).size === values.length, 'retry formats must be unique'),
}).strict()

export const GenerateReportCommandV1Schema = z.union([
  CreateReportCommandV1Schema,
  RetryReportCommandV1Schema,
])

export type CreateReportCommandV1 = z.infer<typeof CreateReportCommandV1Schema>
export type RetryReportCommandV1 = z.infer<typeof RetryReportCommandV1Schema>
export type GenerateReportCommandV1 = z.infer<typeof GenerateReportCommandV1Schema>

export const CreateReportIntentV1Schema = z.object({
  ...reportStateBinding,
  kind: z.literal('report.create'),
  commandId: idText,
  confirmPending: z.boolean(),
  includeNarrative: z.boolean(),
}).strict()

export const RetryReportIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('report.retry'),
  commandId: idText,
  projectionRevision: z.number().int().nonnegative(),
  finalSnapshotId: idText,
  formats: z.array(z.enum(REPORT_FORMATS)).min(1).max(2)
    .refine(values => new Set(values).size === values.length, 'retry formats must be unique'),
}).strict()

export type CreateReportIntentV1 = z.infer<typeof CreateReportIntentV1Schema>
export type RetryReportIntentV1 = z.infer<typeof RetryReportIntentV1Schema>
