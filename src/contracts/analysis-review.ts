import { z } from 'zod'
import { NormalizedProjectV1Schema, TENDER_DATA_SOURCES } from './dataset.ts'
import {
  CLASSIFICATION_VALUES,
  type ClassificationValue,
} from './screening.ts'

export const AGENT_RECOMMENDATIONS = [
  'priority-review', 'watch', 'not-recommended',
] as const
export const USER_DECISIONS = [
  'confirmed-candidate', 'watch', 'exclude', 'pending',
] as const
export const DEADLINE_STATUSES = ['active', 'expired', 'missing'] as const

const idText = z.string().min(1).max(128)
const boundedText = z.string().trim().min(1).max(2_048)
const optionalNote = z.string().trim().max(2_048)
const timestamp = z.string().datetime({ offset: true })

const uniqueValues = <T>(values: readonly T[]) => new Set(values).size === values.length

export const AnalysisScopeV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('records'),
    recordRefs: z.array(idText).min(1).max(100)
      .refine(uniqueValues, 'record refs must be unique'),
  }).strict(),
  z.object({
    kind: z.literal('classifications'),
    classifications: z.array(z.enum(CLASSIFICATION_VALUES)).min(1).max(CLASSIFICATION_VALUES.length)
      .refine(uniqueValues, 'classifications must be unique'),
  }).strict(),
])

export type AnalysisScopeV1 = z.infer<typeof AnalysisScopeV1Schema>

export const AnalysisEvidenceV1Schema = z.object({
  ref: z.string().min(1).max(256),
  kind: z.enum(['source-field', 'classification', 'rule', 'disclosure']),
  label: z.string().min(1).max(128),
  value: z.string().max(2_048),
  limitation: z.string().max(512).optional(),
}).strict()

export type AnalysisEvidenceV1 = z.infer<typeof AnalysisEvidenceV1Schema>

export const AnalysisBatchRecordV1Schema = z.object({
  recordRef: idText,
  source: z.enum(TENDER_DATA_SOURCES),
  title: z.string().min(1).max(2_048),
  classification: z.enum(CLASSIFICATION_VALUES).optional(),
  evidence: z.array(AnalysisEvidenceV1Schema).min(1).max(32),
}).strict()

export const AnalysisNextCommandV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('analysis.next'),
  commandId: idText,
  activeDatasetRef: idText,
  classificationArtifactRef: idText.optional(),
  ruleSetVersion: idText.optional(),
  projectionRevision: z.number().int().nonnegative(),
  scope: AnalysisScopeV1Schema,
  batchSize: z.number().int().min(1).max(20),
}).strict()

export type AnalysisNextCommandV1 = z.infer<typeof AnalysisNextCommandV1Schema>

export const RequestAnalysisIntentV1Schema = AnalysisNextCommandV1Schema.omit({ kind: true }).extend({
  kind: z.literal('analysis.request'),
}).strict()

export type RequestAnalysisIntentV1 = z.infer<typeof RequestAnalysisIntentV1Schema>

export const AnalysisBatchV1Schema = z.object({
  schemaVersion: z.literal(1),
  analysisVersion: idText,
  activeDatasetRef: idText,
  classificationArtifactRef: idText.optional(),
  ruleSetVersion: idText.optional(),
  basedOnRevision: z.number().int().nonnegative(),
  scope: AnalysisScopeV1Schema,
  batchSize: z.number().int().min(1).max(20),
  batchId: idText,
  remaining: z.number().int().nonnegative(),
  records: z.array(AnalysisBatchRecordV1Schema).max(20),
}).strict()

export type AnalysisBatchV1 = z.infer<typeof AnalysisBatchV1Schema>

export const AgentRecommendationInputV1Schema = z.object({
  recordRef: idText,
  recommendation: z.enum(AGENT_RECOMMENDATIONS),
  evidenceRefs: z.array(z.string().min(1).max(256)).min(1).max(32)
    .refine(uniqueValues, 'evidence refs must be unique'),
  reason: boundedText,
  verificationItems: z.array(boundedText).min(1).max(12),
  limitations: z.array(boundedText).min(1).max(12),
}).strict()

export type AgentRecommendationInputV1 = z.infer<typeof AgentRecommendationInputV1Schema>

export const AnalysisCommitCommandV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('analysis.commit'),
  commandId: idText,
  activeDatasetRef: idText,
  classificationArtifactRef: idText.optional(),
  ruleSetVersion: idText.optional(),
  projectionRevision: z.number().int().nonnegative(),
  scope: AnalysisScopeV1Schema,
  batchSize: z.number().int().min(1).max(20),
  batchId: idText,
  recommendations: z.array(AgentRecommendationInputV1Schema).min(1).max(20),
}).strict()

export type AnalysisCommitCommandV1 = z.infer<typeof AnalysisCommitCommandV1Schema>

export const AgentRecommendationV1Schema = AgentRecommendationInputV1Schema.extend({
  batchId: idText,
  committedAt: timestamp,
  evidence: z.array(AnalysisEvidenceV1Schema).min(1).max(32),
}).omit({ evidenceRefs: true }).strict()

export type AgentRecommendationV1 = z.infer<typeof AgentRecommendationV1Schema>

export const AnalysisRecordV1Schema = z.object({
  schemaVersion: z.literal(1),
  project: NormalizedProjectV1Schema,
  classification: z.enum(CLASSIFICATION_VALUES).optional(),
  finalRuleId: idText.optional(),
  recommendation: AgentRecommendationV1Schema.optional(),
}).strict()

export type AnalysisRecordV1 = z.infer<typeof AnalysisRecordV1Schema>

export const AnalysisDatasetV1Schema = z.object({
  schemaVersion: z.literal(1),
  analysisVersion: idText,
  activeDatasetId: idText,
  classificationArtifactId: idText.optional(),
  ruleSetVersion: idText.optional(),
  updatedAt: timestamp,
  rows: z.array(AnalysisRecordV1Schema).max(20_000),
}).strict()

export type AnalysisDatasetV1 = z.infer<typeof AnalysisDatasetV1Schema>

export const ReviewValueV1Schema = z.object({
  decision: z.enum(USER_DECISIONS),
  note: optionalNote,
}).strict()

export const ReviewRecordV1Schema = AnalysisRecordV1Schema.extend({
  review: ReviewValueV1Schema,
}).strict()

export type ReviewRecordV1 = z.infer<typeof ReviewRecordV1Schema>

export const ReviewOperationV1Schema = z.object({
  operationId: idText,
  commandId: idText,
  appliedAt: timestamp,
  decision: z.enum(USER_DECISIONS),
  note: optionalNote,
  recordRefs: z.array(idText).min(1).max(100),
  previous: z.array(z.object({
    recordRef: idText,
    value: ReviewValueV1Schema,
  }).strict()).min(1).max(100),
}).strict()

export const ReviewDatasetV1Schema = z.object({
  schemaVersion: z.literal(1),
  activeDatasetId: idText,
  classificationArtifactId: idText.optional(),
  ruleSetVersion: idText.optional(),
  analysisVersion: idText.optional(),
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  revertedOperationCount: z.number().int().nonnegative(),
  operations: z.array(ReviewOperationV1Schema).max(10_000),
  rows: z.array(ReviewRecordV1Schema).max(20_000),
}).strict()

export type ReviewDatasetV1 = z.infer<typeof ReviewDatasetV1Schema>

const reviewBinding = {
  schemaVersion: z.literal(1),
  commandId: idText,
  activeDatasetRef: idText,
  classificationArtifactRef: idText.optional(),
  ruleSetVersion: idText.optional(),
  analysisVersion: idText.optional(),
  projectionRevision: z.number().int().nonnegative(),
}

export const ApplyReviewCommandV1Schema = z.object({
  ...reviewBinding,
  kind: z.literal('review.apply'),
  recordRefs: z.array(idText).min(1).max(100)
    .refine(uniqueValues, 'record refs must be unique'),
  decision: z.enum(USER_DECISIONS),
  note: optionalNote,
}).strict()

export type ApplyReviewCommandV1 = z.infer<typeof ApplyReviewCommandV1Schema>

export const RevertReviewCommandV1Schema = z.object({
  ...reviewBinding,
  kind: z.literal('review.revert'),
}).strict()

export type RevertReviewCommandV1 = z.infer<typeof RevertReviewCommandV1Schema>

export const ReviewCountsV1Schema = z.object({
  confirmedCandidate: z.number().int().nonnegative(),
  watch: z.number().int().nonnegative(),
  exclude: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
}).strict()

export type ReviewCountsV1 = z.infer<typeof ReviewCountsV1Schema>

export interface ReviewRowsFilterV1 {
  readonly page: number
  readonly pageSize: number
  readonly query?: string
  readonly source?: 'tender' | 'proposed'
  readonly classification?: ClassificationValue
  readonly recommendation?: typeof AGENT_RECOMMENDATIONS[number] | 'unanalyzed'
  readonly userDecision?: typeof USER_DECISIONS[number]
  readonly deadlineStatus?: typeof DEADLINE_STATUSES[number]
}

export const ReviewRowsPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  artifactId: idText,
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  rows: z.array(ReviewRecordV1Schema).max(100),
}).strict()

export type ReviewRowsPageV1 = z.infer<typeof ReviewRowsPageV1Schema>

export function reviewCounts(rows: readonly ReviewRecordV1[]): ReviewCountsV1 {
  const counts: ReviewCountsV1 = { confirmedCandidate: 0, watch: 0, exclude: 0, pending: 0 }
  rows.forEach((row) => {
    if (row.review.decision === 'confirmed-candidate') counts.confirmedCandidate += 1
    else counts[row.review.decision] += 1
  })
  return ReviewCountsV1Schema.parse(counts)
}
