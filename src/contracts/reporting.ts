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

export const ReportDistributionV2Schema = z.object({
  id: idText,
  label: z.string().min(1).max(128),
  scopeDescription: boundedText,
  buckets: z.array(z.object({
    id: idText,
    label: z.string().min(1).max(128),
    count: z.number().int().nonnegative(),
  }).strict()).max(20),
  missingCount: z.number().int().nonnegative().optional(),
  limitation: boundedText.optional(),
}).strict()

export type ReportDistributionV2 = z.infer<typeof ReportDistributionV2Schema>

export const ReportContextRecordV2Schema = z.object({
  recordRef: idText,
  source: z.enum(['tender', 'proposed']),
  title: z.string().min(1).max(2_048),
  evidenceRefs: z.array(z.string().min(1).max(256)).max(32),
  counterparty: z.string().max(512).optional(),
  region: z.string().max(512).optional(),
  amountDisplay: z.string().max(512),
  stage: z.string().max(512).optional(),
  deadlineOrUpdatedAt: z.string().max(128).optional(),
  deadlineWindow: idText.optional(),
  userNote: z.string().max(2_048).optional(),
  recommendationSummary: z.string().max(2_048).optional(),
  verificationItems: z.array(boundedText).max(5),
}).strict()

export const ReportContextV2Schema = z.object({
  schemaVersion: z.literal(2),
  createdAt: timestamp,
  activeDatasetId: idText,
  stateRevision: z.number().int().nonnegative(),
  contextFingerprint: z.string().regex(/^rc_[a-f0-9]{64}$/u),
  metricDefinitions: z.array(MetricDefinitionV1Schema).min(1).max(100),
  metrics: z.array(MetricValueV1Schema).min(1).max(100),
  distributions: z.array(ReportDistributionV2Schema).min(1).max(20),
  priorityRecords: z.array(ReportContextRecordV2Schema).max(10),
  analysisCoverage: z.object({
    analyzedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export type ReportContextV2 = z.infer<typeof ReportContextV2Schema>

/** One bounded Agent-authored observation. It never carries numeric facts or layout instructions. */
export const ReportObservationV1Schema = z.object({
  title: z.string().trim().min(1).max(128),
  statement: boundedText,
  metricRefs: z.array(idText).max(10)
    .refine(values => new Set(values).size === values.length, 'metric refs must be unique'),
  recordRefs: z.array(idText).max(10)
    .refine(values => new Set(values).size === values.length, 'record refs must be unique'),
  distributionRefs: z.array(idText).max(10)
    .refine(values => new Set(values).size === values.length, 'distribution refs must be unique')
    .optional(),
  limitations: z.array(boundedText).max(5),
}).strict().refine(value => value.metricRefs.length > 0 || value.recordRefs.length > 0 || (value.distributionRefs?.length ?? 0) > 0, {
  message: 'report observation requires at least one metricRef, distributionRef, or recordRef',
})

export type ReportObservationV1 = z.infer<typeof ReportObservationV1Schema>

export const ReportNarrativeV1Schema = z.object({
  executiveSummary: ReportObservationV1Schema.optional(),
  keyFindings: z.array(ReportObservationV1Schema).max(5),
  priorityVerification: z.array(ReportObservationV1Schema).max(10),
  risksAndLimitations: z.array(ReportObservationV1Schema).max(5),
}).strict()

export type ReportNarrativeV1 = z.infer<typeof ReportNarrativeV1Schema>

const AmountAxisV1Schema = z.object({
  unit: z.enum(['yuan', 'ten-thousand-yuan', 'hundred-million-yuan']),
  unitLabel: z.enum(['元', '万元', '亿元']),
  minCny: z.number().finite().nonnegative(),
  maxCny: z.number().finite().positive(),
  ticksCny: z.array(z.number().finite().nonnegative()).length(4),
}).strict().superRefine((value, context) => {
  const expectedUnitLabel = value.unit === 'yuan' ? '元' : value.unit === 'ten-thousand-yuan' ? '万元' : '亿元'
  if (value.unitLabel !== expectedUnitLabel) {
    context.addIssue({ code: 'custom', message: 'amount axis unit and label must match' })
  }
  if (value.maxCny <= value.minCny) {
    context.addIssue({ code: 'custom', message: 'amount axis max must be greater than min' })
  }
  if (value.ticksCny[0] !== value.minCny || value.ticksCny[3] !== value.maxCny) {
    context.addIssue({ code: 'custom', message: 'amount axis boundary ticks must match min and max' })
  }
  if (!value.ticksCny.every((tick, index) => index === 0 || tick > (value.ticksCny[index - 1] ?? -1))) {
    context.addIssue({ code: 'custom', message: 'amount axis ticks must be strictly increasing' })
  }
})

export const AmountDistributionV2Schema = z.object({
  source: z.enum(['tender', 'proposed']),
  amountType: z.enum(['budget', 'total-investment']),
  eligibleCount: z.number().int().nonnegative(),
  singleValueCount: z.number().int().nonnegative(),
  bandedRangeCount: z.number().int().nonnegative(),
  indeterminateCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  unparseableCount: z.number().int().nonnegative(),
  medianCny: z.number().finite().nonnegative().optional(),
  axis: AmountAxisV1Schema.optional(),
  bands: z.array(z.object({
    id: idText,
    label: z.string().min(1).max(128),
    count: z.number().int().nonnegative(),
  }).strict()).length(3),
  limitation: boundedText,
}).strict().superRefine((value, context) => {
  const banded = value.bands.reduce((sum, band) => sum + band.count, 0)
  if (banded !== value.singleValueCount + value.bandedRangeCount) {
    context.addIssue({ code: 'custom', message: 'amount band counts must match reportable amount counts' })
  }
  if (banded > 0 && value.axis === undefined) {
    context.addIssue({ code: 'custom', message: 'a non-empty amount distribution requires an axis' })
  }
  if (value.eligibleCount !== value.singleValueCount + value.bandedRangeCount + value.indeterminateCount + value.missingCount + value.unparseableCount) {
    context.addIssue({ code: 'custom', message: 'amount status counts must cover the eligible scope' })
  }
})

export type AmountDistributionV2 = z.infer<typeof AmountDistributionV2Schema>

export const ReportQuerySnapshotV2Schema = z.object({
  scope: z.enum(['tender', 'proposed', 'combined']),
  targetSummary: z.string().max(2_048),
  sources: z.object({
    tender: z.object({ status: z.enum(['succeeded', 'failed']), loaded: z.number().int().nonnegative(), errorMessage: boundedText.optional() }).strict().optional(),
    proposed: z.object({ status: z.enum(['succeeded', 'failed']), loaded: z.number().int().nonnegative(), errorMessage: boundedText.optional() }).strict().optional(),
  }).strict(),
}).strict()

export const ReportDatasetV2Schema = z.object({
  schemaVersion: z.literal(2),
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
  query: ReportQuerySnapshotV2Schema,
  metricDefinitions: z.array(MetricDefinitionV1Schema).min(1).max(100),
  metricValues: z.array(MetricValueV1Schema).min(1).max(100),
  distributions: z.array(ReportDistributionV2Schema).min(1).max(20),
  amountDistributions: z.array(AmountDistributionV2Schema).length(2),
  homepageRecordRefs: z.array(idText).max(3),
  priorityRecordRefs: z.array(idText).max(10),
  limitations: z.array(boundedText).min(1).max(20),
  invalidRecords: z.array(TechnicalInvalidRecordV1Schema).max(20_000),
  rows: z.array(ReviewRecordV1Schema).max(20_000),
}).strict()

export type ReportDatasetV2 = z.infer<typeof ReportDatasetV2Schema>

export const ReportDeliveryRecordV1Schema = ReportContextRecordV2Schema.omit({ evidenceRefs: true })

export type ReportDeliveryRecordV1 = z.infer<typeof ReportDeliveryRecordV1Schema>

/** Bounded, read-only Client view derived from one immutable ReportDatasetV2. */
export const ReportDeliveryViewV1Schema = z.object({
  schemaVersion: z.literal(1),
  finalSnapshotId: idText,
  createdAt: timestamp,
  timeZone: z.literal('Asia/Shanghai'),
  completeness: z.enum(REPORT_COMPLETENESS),
  query: ReportQuerySnapshotV2Schema,
  rulesIncluded: z.boolean(),
  analysisIncluded: z.boolean(),
  analysisCoverage: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).strict(),
  metricDefinitions: z.array(MetricDefinitionV1Schema).min(1).max(100),
  metricValues: z.array(MetricValueV1Schema).min(1).max(100),
  distributions: z.array(ReportDistributionV2Schema).min(1).max(20),
  amountDistributions: z.array(AmountDistributionV2Schema).length(2),
  homepageRecords: z.array(ReportDeliveryRecordV1Schema).max(3),
  priorityRecords: z.array(ReportDeliveryRecordV1Schema).max(10),
  narrative: ReportNarrativeV1Schema.optional(),
  limitations: z.array(boundedText).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (value.analysisCoverage.completed > value.analysisCoverage.total) {
    context.addIssue({ code: 'custom', path: ['analysisCoverage', 'completed'], message: 'analysis coverage exceeds total' })
  }
  const priorityRefs = new Set(value.priorityRecords.map(record => record.recordRef))
  if (value.homepageRecords.some(record => !priorityRefs.has(record.recordRef))) {
    context.addIssue({ code: 'custom', path: ['homepageRecords'], message: 'homepage records must be selected from priority records' })
  }
})

export type ReportDeliveryViewV1 = z.infer<typeof ReportDeliveryViewV1Schema>

export const ReportDatasetSchema = ReportDatasetV2Schema

export type ReportDataset = ReportDatasetV2

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
  contextAsOf: timestamp.optional(),
  narrative: ReportNarrativeV1Schema.optional(),
}).strict().superRefine((value, context) => {
  const narrativeBound = value.contextFingerprint !== undefined && value.contextAsOf !== undefined && value.narrative !== undefined
  const narrativeAbsent = value.contextFingerprint === undefined && value.contextAsOf === undefined && value.narrative === undefined
  if (!narrativeBound && !narrativeAbsent) {
    context.addIssue({ code: 'custom', message: 'contextFingerprint, contextAsOf, and narrative must be provided together' })
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
