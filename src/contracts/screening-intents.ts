import { z } from 'zod'
import { TenderQueryIntentV1Schema } from './query-schema.ts'
import {
  ConfirmRulesCommandV1Schema,
  PreviewRulesCommandV1Schema,
} from './screening.ts'
import { TenderRuleSetV1Schema } from './workflow.ts'
import {
  ApplyReviewCommandV1Schema,
  RequestAnalysisIntentV1Schema,
  RevertReviewCommandV1Schema,
} from './analysis-review.ts'
import { CreateReportIntentV1Schema, RetryReportIntentV1Schema } from './reporting.ts'

const idText = z.string().min(1).max(128)
const screeningBase = {
  schemaVersion: z.literal(1),
  commandId: idText,
  activeDatasetRef: idText,
  projectionRevision: z.number().int().nonnegative(),
}

export const ContinueScreeningIntentV1Schema = z.object({
  ...screeningBase,
  kind: z.literal('rules.propose'),
}).strict()

export const AdjustRulesIntentV1Schema = z.object({
  ...screeningBase,
  kind: z.literal('rules.adjust'),
  instruction: z.string().trim().min(1).max(2_048),
  draftFingerprint: idText,
  rules: TenderRuleSetV1Schema,
}).strict()

export const TenderWorkbenchIntentV1Schema = z.union([
  TenderQueryIntentV1Schema,
  ContinueScreeningIntentV1Schema,
  AdjustRulesIntentV1Schema,
  PreviewRulesCommandV1Schema,
  ConfirmRulesCommandV1Schema,
  RequestAnalysisIntentV1Schema,
  ApplyReviewCommandV1Schema,
  RevertReviewCommandV1Schema,
  CreateReportIntentV1Schema,
  RetryReportIntentV1Schema,
])

export type ContinueScreeningIntentV1 = z.infer<typeof ContinueScreeningIntentV1Schema>
export type AdjustRulesIntentV1 = z.infer<typeof AdjustRulesIntentV1Schema>
export type TenderWorkbenchIntentV1 = z.infer<typeof TenderWorkbenchIntentV1Schema>
