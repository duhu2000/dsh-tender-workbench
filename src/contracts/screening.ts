import { z } from 'zod'
import {
  NormalizedProjectV1Schema,
  OPPORTUNITY_LIFECYCLES,
  TENDER_DATA_SOURCES,
} from './dataset.ts'
import {
  QccProposedSearchArgsSchema,
  QccTenderSearchArgsSchema,
} from './query-schema.ts'
import {
  ArtifactRefV1Schema,
  TenderRuleSetV1Schema,
  TenderRuleV1Schema,
} from './workflow.ts'

export const CLASSIFICATION_VALUES = [
  'include', 'observe', 'manual-review', 'exclude', 'unmatched',
] as const

export type ClassificationValue = typeof CLASSIFICATION_VALUES[number]

const idText = z.string().min(1).max(128)
const timestamp = z.string().datetime({ offset: true })

export const RuleMatchTraceV1Schema = z.object({
  ruleId: idText,
  ruleIndex: z.number().int().nonnegative(),
  action: z.enum(['include', 'observe', 'exclude', 'manual-review']),
  priority: z.number().int().min(-1_000).max(1_000),
  matchedKeywords: z.array(z.string().min(1).max(128)).max(50),
  exceptionKeywords: z.array(z.string().min(1).max(128)).max(50),
  eligible: z.boolean(),
}).strict()

export type RuleMatchTraceV1 = z.infer<typeof RuleMatchTraceV1Schema>

export const ClassifiedRecordV1Schema = z.object({
  schemaVersion: z.literal(1),
  project: NormalizedProjectV1Schema,
  classification: z.enum(CLASSIFICATION_VALUES),
  rawMatches: z.array(RuleMatchTraceV1Schema).max(100),
  conflictRuleIds: z.array(idText).max(100),
  finalRuleId: idText.optional(),
  decision: z.object({
    kind: z.enum(['unmatched', 'single-action', 'priority', 'stable-order']),
    winningPriority: z.number().int().min(-1_000).max(1_000).optional(),
  }).strict(),
}).strict()

export type ClassifiedRecordV1 = z.infer<typeof ClassifiedRecordV1Schema>

export const ClassificationCountsV1Schema = z.object({
  include: z.number().int().nonnegative(),
  observe: z.number().int().nonnegative(),
  manualReview: z.number().int().nonnegative(),
  exclude: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
}).strict()

export type ClassificationCountsV1 = z.infer<typeof ClassificationCountsV1Schema>

export const RuleImpactV1Schema = z.object({
  ruleId: idText,
  rawMatchCount: z.number().int().nonnegative(),
  exceptionCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  finalCount: z.number().int().nonnegative(),
}).strict()

export const RulePreviewSampleV1Schema = z.object({
  kind: z.enum(['match', 'boundary', 'conflict', 'exception']),
  recordId: idText,
  title: z.string().min(1).max(2_048),
  source: z.enum(TENDER_DATA_SOURCES),
  classification: z.enum(CLASSIFICATION_VALUES),
  matchedRuleIds: z.array(idText).max(100),
  finalRuleId: idText.optional(),
}).strict()

export const RuleDraftArtifactV1Schema = z.object({
  schemaVersion: z.literal(1),
  activeDatasetId: idText,
  basedOnRevision: z.number().int().nonnegative(),
  draftFingerprint: idText,
  origin: z.enum(['agent', 'user']),
  rules: TenderRuleSetV1Schema,
}).strict()

export type RuleDraftArtifactV1 = z.infer<typeof RuleDraftArtifactV1Schema>

export const RulePreviewArtifactV1Schema = z.object({
  schemaVersion: z.literal(1),
  activeDatasetId: idText,
  basedOnRevision: z.number().int().nonnegative(),
  stateRevision: z.number().int().positive(),
  draftFingerprint: idText,
  origin: z.enum(['agent', 'user']),
  counts: ClassificationCountsV1Schema,
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  rawMatches: z.number().int().nonnegative(),
  ruleImpacts: z.array(RuleImpactV1Schema).max(100),
  samples: z.array(RulePreviewSampleV1Schema).max(20),
}).strict()

export type RulePreviewArtifactV1 = z.infer<typeof RulePreviewArtifactV1Schema>

export const ConfirmedRuleSetV1Schema = z.object({
  schemaVersion: z.literal(1),
  ruleSetVersion: idText,
  activeDatasetId: idText,
  previewArtifactId: idText,
  confirmedAt: timestamp,
  commandId: idText,
  draftFingerprint: idText,
  rules: TenderRuleSetV1Schema,
}).strict()

export type ConfirmedRuleSetV1 = z.infer<typeof ConfirmedRuleSetV1Schema>

export const ClassifiedDatasetV1Schema = z.object({
  schemaVersion: z.literal(1),
  activeDatasetId: idText,
  ruleSetVersion: idText,
  classifiedAt: timestamp,
  counts: ClassificationCountsV1Schema,
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  rawMatches: z.number().int().nonnegative(),
  ruleImpacts: z.array(RuleImpactV1Schema).max(100),
  rows: z.array(ClassifiedRecordV1Schema).max(20_000),
}).strict()

export type ClassifiedDatasetV1 = z.infer<typeof ClassifiedDatasetV1Schema>

export const ClassifiedRowsPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  artifactId: idText,
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  datasetTotal: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  rawMatches: z.number().int().nonnegative(),
  counts: ClassificationCountsV1Schema,
  ruleImpacts: z.array(RuleImpactV1Schema).max(100),
  rows: z.array(ClassifiedRecordV1Schema).max(100),
}).strict()

export type ClassifiedRowsPageV1 = z.infer<typeof ClassifiedRowsPageV1Schema>

export interface ClassifiedRowsFilterV1 {
  readonly page: number
  readonly pageSize: number
  readonly query?: string
  readonly source?: 'tender' | 'proposed'
  readonly classification?: ClassificationValue
  readonly ruleId?: string
  readonly conflict?: boolean
  readonly fieldStatus?: 'normalized' | 'missing' | 'unparseable'
}

const ruleIntentBase = {
  schemaVersion: z.literal(1),
  commandId: idText,
  activeDatasetRef: idText,
  projectionRevision: z.number().int().nonnegative(),
}

export const PreviewRulesCommandV1Schema = z.object({
  ...ruleIntentBase,
  kind: z.literal('rules.preview'),
  origin: z.enum(['agent', 'user']),
  draftFingerprint: idText.optional(),
  rules: TenderRuleSetV1Schema,
}).strict()

export type PreviewRulesCommandV1 = z.infer<typeof PreviewRulesCommandV1Schema>

export const ConfirmRulesCommandV1Schema = z.object({
  ...ruleIntentBase,
  kind: z.literal('rules.confirm'),
  draftFingerprint: idText,
  previewArtifactId: idText,
  rules: TenderRuleSetV1Schema,
}).strict()

export type ConfirmRulesCommandV1 = z.infer<typeof ConfirmRulesCommandV1Schema>

export const ScreeningDraftSampleV1Schema = z.object({
  recordId: idText,
  source: z.enum(TENDER_DATA_SOURCES),
  title: z.string().min(1).max(2_048),
  purchaser: z.string().max(512),
  fieldStatus: z.enum(['normalized', 'missing', 'unparseable']),
}).strict()

export const ScreeningDraftContextV1Schema = z.object({
  activeDatasetRef: idText,
  projectionRevision: z.number().int().positive(),
  targetSummary: z.string().min(1).max(2_048),
  query: z.object({
    scope: z.enum(['tender', 'proposed', 'combined']),
    target: z.string().min(1).max(2_048),
    tender: QccTenderSearchArgsSchema.optional(),
    proposed: QccProposedSearchArgsSchema.optional(),
  }).strict(),
  total: z.number().int().nonnegative(),
  sourceCounts: z.object({
    tender: z.number().int().nonnegative(),
    proposed: z.number().int().nonnegative(),
  }).strict(),
  missingFieldCount: z.number().int().nonnegative(),
  unparseableFieldCount: z.number().int().nonnegative(),
  lifecycleCounts: z.object(Object.fromEntries(
    OPPORTUNITY_LIFECYCLES.map(lifecycle => [lifecycle, z.number().int().nonnegative()]),
  ) as Record<typeof OPPORTUNITY_LIFECYCLES[number], z.ZodNumber>).strict(),
  regions: z.array(z.object({
    label: z.string().min(1).max(128),
    count: z.number().int().positive(),
  }).strict()).max(20),
  samples: z.array(ScreeningDraftSampleV1Schema).max(8),
}).strict()

export type ScreeningDraftContextV1 = z.infer<typeof ScreeningDraftContextV1Schema>

export const RuleArtifactContentV1Schema = z.union([
  RuleDraftArtifactV1Schema,
  RulePreviewArtifactV1Schema,
  ConfirmedRuleSetV1Schema,
])

export type RuleArtifactContentV1 = z.infer<typeof RuleArtifactContentV1Schema>

export const RuleArtifactRefV1Schema = ArtifactRefV1Schema.refine(
  value => value.kind === 'rule-draft' || value.kind === 'rule-preview' || value.kind === 'rule-set',
  'not a rule artifact',
)

/** Canonical, platform-neutral fingerprint for stale-preview detection. */
export function ruleDraftFingerprint(rules: readonly z.infer<typeof TenderRuleV1Schema>[]): string {
  const parsed = TenderRuleSetV1Schema.parse(rules)
  const canonical = JSON.stringify(parsed)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const bytes = new TextEncoder().encode(canonical)
  bytes.forEach((byte) => {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  })
  return `r_${hash.toString(16).padStart(16, '0')}`
}
