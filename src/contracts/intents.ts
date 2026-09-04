import { z } from 'zod'
import {
  QccProposedSearchArgsSchema,
  QccTenderSearchArgsSchema,
  hasSupportedQueryFilter,
} from './query-schema.ts'
import { REPORT_FORMATS } from './reporting.ts'
import { AnalysisScopeV1Schema, USER_DECISIONS } from './analysis-review.ts'
import { ruleDraftFingerprint } from './screening.ts'
import { TenderRuleSetV1Schema } from './workflow.ts'
import {
  TENDER_ACTION_SKILLS,
  TENDER_INTENT_KINDS,
  orchestrationFor,
  type TenderWorkbenchIntentKindV2,
} from './orchestration.ts'

const idText = z.string().min(1).max(128)
const revision = z.number().int().nonnegative()
const userText = z.string().trim().min(1).max(2_048)

const base = {
  schemaVersion: z.literal(2),
  intentId: idText,
  skill: z.enum(TENDER_ACTION_SKILLS),
}

const queryPayload = z.object({
  scope: z.enum(['tender', 'proposed', 'combined']),
  target: userText,
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

const datasetBinding = z.object({
  activeDatasetRef: idText,
  projectionRevision: revision,
}).strict()

const classificationBinding = datasetBinding.extend({
  classificationArtifactRef: idText,
  ruleSetVersion: idText,
}).strict()

const reviewBasis = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataset-only') }).strict(),
  z.object({
    kind: z.literal('classified'),
    classificationArtifactRef: idText,
    ruleSetVersion: idText,
    analysisVersion: idText.optional(),
  }).strict(),
])

const reviewBinding = datasetBinding.extend({
  basis: reviewBasis,
  reviewArtifactRef: idText.optional(),
  reviewRevision: revision,
}).strict()

const queryIntent = z.object({
  ...base,
  kind: z.literal('query.run'),
  binding: z.object({ projectionRevision: revision }).strict(),
  payload: queryPayload,
}).strict()

const rulesProposeIntent = z.object({
  ...base,
  kind: z.literal('rules.propose'),
  binding: datasetBinding,
  payload: z.object({ guidance: userText.optional() }).strict(),
}).strict()

const rulesAdjustIntent = z.object({
  ...base,
  kind: z.literal('rules.adjust'),
  binding: datasetBinding.extend({ baseDraftFingerprint: idText }).strict(),
  payload: z.object({ instruction: userText, rules: TenderRuleSetV1Schema }).strict(),
}).strict()

const rulesPreviewIntent = z.object({
  ...base,
  kind: z.literal('rules.preview'),
  binding: datasetBinding,
  payload: z.object({ draftFingerprint: idText, rules: TenderRuleSetV1Schema }).strict(),
}).strict()

const rulesConfirmIntent = z.object({
  ...base,
  kind: z.literal('rules.confirm'),
  binding: datasetBinding.extend({ previewArtifactRef: idText, draftFingerprint: idText }).strict(),
  payload: z.object({}).strict(),
}).strict()

const analysisRunIntent = z.object({
  ...base,
  kind: z.literal('analysis.run'),
  binding: classificationBinding,
  payload: z.object({ scope: AnalysisScopeV1Schema }).strict(),
}).strict()

const analysisFollowUpIntent = z.object({
  ...base,
  kind: z.literal('analysis.follow-up'),
  binding: classificationBinding.extend({ analysisVersion: idText.optional() }).strict(),
  payload: z.object({ recordRef: idText, question: userText }).strict(),
}).strict()

const reviewApplyIntent = z.object({
  ...base,
  kind: z.literal('review.apply'),
  binding: reviewBinding,
  payload: z.object({
    decisions: z.array(z.object({
      recordRef: idText,
      decision: z.enum(USER_DECISIONS),
      note: z.string().trim().max(2_048),
    }).strict()).min(1).max(100).refine(
      values => new Set(values.map(value => value.recordRef)).size === values.length,
      'review record refs must be unique',
    ),
  }).strict(),
}).strict()

const reviewRevertIntent = z.object({
  ...base,
  kind: z.literal('review.revert'),
  binding: reviewBinding.extend({ latestOperationRef: idText }).strict(),
  payload: z.object({}).strict(),
}).strict()

const reportCreateIntent = z.object({
  ...base,
  kind: z.literal('report.create'),
  binding: reviewBinding,
  payload: z.object({
    scope: z.enum(['complete', 'current-progress']),
    confirmPending: z.boolean(),
    narrativeMode: z.enum(['none', 'requested']),
  }).strict(),
}).strict()

const reportRetryIntent = z.object({
  ...base,
  kind: z.literal('report.retry'),
  binding: z.object({ finalSnapshotId: idText, projectionRevision: revision }).strict(),
  payload: z.object({
    formats: z.array(z.enum(REPORT_FORMATS)).min(1).max(2)
      .refine(values => new Set(values).size === values.length, 'retry formats must be unique'),
  }).strict(),
}).strict()

export const TenderWorkbenchIntentV2Schema = z.discriminatedUnion('kind', [
  queryIntent,
  rulesProposeIntent,
  rulesAdjustIntent,
  rulesPreviewIntent,
  rulesConfirmIntent,
  analysisRunIntent,
  analysisFollowUpIntent,
  reviewApplyIntent,
  reviewRevertIntent,
  reportCreateIntent,
  reportRetryIntent,
]).superRefine((intent, context) => {
  const expected = orchestrationFor(intent.kind).actionSkill
  if (intent.skill !== expected) {
    context.addIssue({ code: 'custom', path: ['skill'], message: `${intent.kind} requires ${expected}` })
  }
  if (intent.kind === 'rules.adjust'
    && ruleDraftFingerprint(intent.payload.rules) !== intent.binding.baseDraftFingerprint) {
    context.addIssue({
      code: 'custom',
      path: ['binding', 'baseDraftFingerprint'],
      message: 'base draft fingerprint must match payload rules',
    })
  }
})

export type TenderWorkbenchIntentV2 = z.infer<typeof TenderWorkbenchIntentV2Schema>

export function parseTenderWorkbenchIntentV2(value: unknown): TenderWorkbenchIntentV2 {
  return TenderWorkbenchIntentV2Schema.parse(value)
}

export function isTenderWorkbenchIntentKindV2(value: string): value is TenderWorkbenchIntentKindV2 {
  return (TENDER_INTENT_KINDS as readonly string[]).includes(value)
}
