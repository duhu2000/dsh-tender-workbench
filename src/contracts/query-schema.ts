import { z } from 'zod'
import { hasUnresolvedTenderPlaceholder } from './initial-draft.ts'

const shortText = z.string().trim().min(1).max(128).refine(value => !hasUnresolvedTenderPlaceholder(value), '请先替换【】占位符，再查询。')
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const optionalAmount = z.number().finite().nonnegative().optional()

export const TENDER_QUERY_SCOPES = ['tender', 'proposed', 'combined'] as const
export type TenderQueryScope = typeof TENDER_QUERY_SCOPES[number]

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

export function hasSupportedQueryFilter(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, entry]) => key !== 'smartSort'
    && (Array.isArray(entry) ? entry.length > 0 : entry !== undefined && entry !== ''))
}
