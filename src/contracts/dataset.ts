import { z } from 'zod'

export const TENDER_DATA_SOURCES = ['tender', 'proposed'] as const
export const OPPORTUNITY_LIFECYCLES = [
  'early-signal',
  'active-procurement',
  'amended',
  'terminated',
  'awarded',
  'contracted',
  'unknown',
] as const

export type TenderDataSource = typeof TENDER_DATA_SOURCES[number]
export type OpportunityLifecycle = typeof OPPORTUNITY_LIFECYCLES[number]
export type FieldParseStatus = 'normalized' | 'missing' | 'unparseable'

const boundedText = z.string().max(2_048)
const shortText = z.string().max(512)
const idText = z.string().min(1).max(128)
const timestamp = z.string().datetime({ offset: true })

export const NormalizedTextV1Schema = z.object({
  original: shortText,
  value: shortText.optional(),
  status: z.enum(['normalized', 'missing', 'unparseable']),
}).strict()

export const NormalizedRegionV1Schema = z.object({
  original: shortText,
  value: shortText.optional(),
  parts: z.array(z.string().min(1).max(128)).max(8),
  status: z.enum(['normalized', 'missing', 'unparseable']),
}).strict()

export const NormalizedAmountV1Schema = z.object({
  original: shortText,
  type: z.enum(['budget', 'ceiling', 'award', 'total-investment', 'other']),
  minCny: z.number().finite().nonnegative().optional(),
  maxCny: z.number().finite().nonnegative().optional(),
  parseStatus: z.enum(['exact', 'range', 'approximate', 'unparseable', 'missing']),
  display: shortText,
}).strict()

export const NormalizedDateV1Schema = z.object({
  original: shortText,
  value: z.string().max(64).optional(),
  precision: z.enum(['date-time', 'date', 'month', 'unknown']),
  timeZone: z.literal('Asia/Shanghai'),
  parseStatus: z.enum(['normalized', 'missing', 'unparseable']),
}).strict()

const sourceEntitySchema = z.object({
  id: shortText,
  name: shortText,
}).strict()

export const NormalizedAnnouncementV1Schema = z.object({
  sourceRecordId: idText,
  title: boundedText,
  lifecycle: z.enum(OPPORTUNITY_LIFECYCLES),
  stage: NormalizedTextV1Schema,
  projectNumber: NormalizedTextV1Schema,
  region: NormalizedRegionV1Schema,
  amount: NormalizedAmountV1Schema,
  publishedAt: NormalizedDateV1Schema,
  deadline: NormalizedDateV1Schema.optional(),
  parties: z.array(sourceEntitySchema).max(100),
  sourceLink: z.string().max(2_048).optional(),
}).strict()

export const NormalizedProjectV1Schema = z.object({
  schemaVersion: z.literal(1),
  recordId: idText,
  source: z.enum(TENDER_DATA_SOURCES),
  sourceId: idText,
  title: boundedText,
  lifecycle: z.enum(OPPORTUNITY_LIFECYCLES),
  dataDisposition: z.literal('normalized'),
  stage: NormalizedTextV1Schema,
  projectNumber: NormalizedTextV1Schema,
  region: NormalizedRegionV1Schema,
  counterparty: NormalizedTextV1Schema,
  amount: NormalizedAmountV1Schema,
  publishedAt: NormalizedDateV1Schema,
  deadline: NormalizedDateV1Schema.optional(),
  announcements: z.array(NormalizedAnnouncementV1Schema).min(1).max(500),
  disclosure: z.object({
    missingFields: z.array(z.string().min(1).max(128)).max(64),
    unparseableFields: z.array(z.string().min(1).max(128)).max(64),
  }).strict(),
}).strict()

export type NormalizedProjectV1 = z.infer<typeof NormalizedProjectV1Schema>

export const TechnicalInvalidRecordV1Schema = z.object({
  source: z.enum(TENDER_DATA_SOURCES),
  index: z.number().int().nonnegative(),
  code: z.string().min(1).max(128),
  message: boundedText,
  rawPreview: boundedText,
}).strict()

export type TechnicalInvalidRecordV1 = z.infer<typeof TechnicalInvalidRecordV1Schema>

const sourceSummarySchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  loaded: z.number().int().nonnegative(),
  errorMessage: boundedText.optional(),
}).strict()

const lifecycleCountsSchema = z.object(Object.fromEntries(
  OPPORTUNITY_LIFECYCLES.map(lifecycle => [lifecycle, z.number().int().nonnegative()]),
) as Record<OpportunityLifecycle, z.ZodNumber>).strict()

export const NormalizedDatasetSummaryV1Schema = z.object({
  rawRecordCount: z.number().int().nonnegative(),
  validRecordCount: z.number().int().nonnegative(),
  normalizedProjectCount: z.number().int().nonnegative(),
  linkedRecordCount: z.number().int().nonnegative(),
  invalidRecordCount: z.number().int().nonnegative(),
  missingFieldCount: z.number().int().nonnegative(),
  unparseableFieldCount: z.number().int().nonnegative(),
  sources: z.object({
    tender: sourceSummarySchema.optional(),
    proposed: sourceSummarySchema.optional(),
  }).strict(),
  lifecycleCounts: lifecycleCountsSchema,
  regions: z.array(z.object({
    label: z.string().min(1).max(128),
    count: z.number().int().positive(),
  }).strict()).max(100),
}).strict()

export type NormalizedDatasetSummaryV1 = z.infer<typeof NormalizedDatasetSummaryV1Schema>

export const NormalizedDatasetV1Schema = z.object({
  schemaVersion: z.literal(1),
  createdAt: timestamp,
  rows: z.array(NormalizedProjectV1Schema).max(20_000),
  invalidRecords: z.array(TechnicalInvalidRecordV1Schema).max(20_000),
  summary: NormalizedDatasetSummaryV1Schema,
}).strict()

export type NormalizedDatasetV1 = z.infer<typeof NormalizedDatasetV1Schema>

export const ArtifactRowsPageV1Schema = z.object({
  schemaVersion: z.literal(1),
  artifactId: idText,
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  rows: z.array(NormalizedProjectV1Schema).max(100),
}).strict()

export type ArtifactRowsPageV1 = z.infer<typeof ArtifactRowsPageV1Schema>

export interface ArtifactRowsFilterV1 {
  readonly page: number
  readonly pageSize: number
  readonly query?: string
  readonly source?: TenderDataSource
  readonly lifecycle?: OpportunityLifecycle
  readonly fieldStatus?: 'missing' | 'unparseable'
  readonly region?: string
  readonly sort?: 'published-desc' | 'amount-desc' | 'deadline-asc'
}
