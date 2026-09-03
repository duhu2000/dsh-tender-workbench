import { z } from 'zod'

const shortText = z.string().trim().min(1).max(128)
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const optionalAmount = z.number().finite().nonnegative().optional()

export const QccTenderSearchArgsSchema = z.object({
  keywords: z.array(shortText).max(10).optional(),
  infoTypes: z.array(z.enum(['招标公告', '中标公告'])).max(2).optional(),
  bidStatuses: z.array(shortText).max(20).optional(),
  beginDate: dateText.optional(),
  endDate: dateText.optional(),
  regions: z.array(shortText).max(20).optional(),
  procurementMethods: z.array(shortText).max(20).optional(),
  procurementTypes: z.array(z.enum(['货物', '工程', '服务'])).max(3).optional(),
  TenderIndustries: z.array(shortText).max(20).optional(),
  budgetMin: optionalAmount,
  budgetMax: optionalAmount,
  winningAmountMin: optionalAmount,
  winningAmountMax: optionalAmount,
  smartSort: z.boolean().optional(),
}).strict()

export const QccProposedSearchArgsSchema = z.object({
  keywords: z.array(shortText).max(10).optional(),
  beginDate: dateText.optional(),
  endDate: dateText.optional(),
  regions: z.array(shortText).max(20).optional(),
  projectStages: z.array(shortText).max(20).optional(),
  approvalStatuses: z.array(shortText).max(20).optional(),
  investmentMin: optionalAmount,
  investmentMax: optionalAmount,
}).strict()

function hasSupportedFilter(value: Record<string, unknown>): boolean {
  return Object.keys(value).some(key => key !== 'smartSort')
}

export const TenderQueryIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  commandId: shortText,
  kind: z.literal('query.start'),
  scope: z.enum(['tender', 'proposed', 'combined']),
  target: z.string().trim().min(1).max(2_048),
  tender: QccTenderSearchArgsSchema.optional(),
  proposed: QccProposedSearchArgsSchema.optional(),
}).strict().superRefine((intent, context) => {
  const valid = intent.scope === 'tender'
    ? intent.tender !== undefined && intent.proposed === undefined
    : intent.scope === 'proposed'
      ? intent.proposed !== undefined && intent.tender === undefined
      : intent.tender !== undefined && intent.proposed !== undefined
  if (!valid) {
    context.addIssue({
      code: 'custom',
      path: ['scope'],
      message: 'scope must match the supplied tender/proposed request branches',
    })
  }
  if (intent.tender !== undefined && !hasSupportedFilter(intent.tender)) {
    context.addIssue({
      code: 'custom',
      path: ['tender'],
      message: 'tender request must contain at least one supported filter',
    })
  }
  if (intent.proposed !== undefined && !hasSupportedFilter(intent.proposed)) {
    context.addIssue({
      code: 'custom',
      path: ['proposed'],
      message: 'proposed request must contain at least one supported filter',
    })
  }
})

export type TenderQueryIntentV1 = z.infer<typeof TenderQueryIntentV1Schema>
