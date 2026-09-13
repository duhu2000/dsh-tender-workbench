import { z } from 'zod'

export const PROVIDER_OUTCOMES = ['data', 'zero', 'not-needed', 'no-permission', 'failed', 'unknown'] as const
export const ProviderOutcomeSchema = z.enum(PROVIDER_OUTCOMES)
export type ProviderOutcome = z.infer<typeof ProviderOutcomeSchema>
const count = z.number().int().nonnegative()
export const TenderExecutionSchema = z.object({
  operationId: z.string().min(1).max(128),
  status: z.enum(['running', 'succeeded', 'partial', 'failed', 'interrupted']),
  currentAction: z.string().min(1).max(200),
  startedAt: count,
  updatedAt: count,
  finishedAt: count.optional(),
  counts: z.object({ queried: count, succeeded: count, zero: count, failed: count, noPermission: count, unknown: count, needsReview: count }).strict(),
  recentItem: z.string().max(200).optional(),
  queryTarget: z.string().max(2048).optional(),
  providers: z.object({ tender: ProviderOutcomeSchema, proposed: ProviderOutcomeSchema }).strict(),
}).strict()
export type TenderExecution = z.infer<typeof TenderExecutionSchema>
export function emptyExecution(operationId: string, currentAction: string, time: number): TenderExecution {
  return { operationId, currentAction, status: 'running', startedAt: time, updatedAt: time,
    counts: { queried: 0, succeeded: 0, zero: 0, failed: 0, noPermission: 0, unknown: 0, needsReview: 0 },
    providers: { tender: 'not-needed', proposed: 'not-needed' } }
}
export const PROVIDER_LABELS: Record<ProviderOutcome, string> = { data: '成功有数据', zero: '成功零记录', 'not-needed': '无需执行', 'no-permission': '无权限', failed: '失败', unknown: '未知结果' }
