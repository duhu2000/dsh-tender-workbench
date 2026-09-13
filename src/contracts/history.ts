import { z } from 'zod'
export const HistoryEntrySchema = z.object({
  taskId: z.string().min(1).max(128),
  originSessionId: z.string().min(1).max(128),
  originWorkspaceId: z.string().max(128).nullable(),
  originWorkspaceTitle: z.string().max(200),
  title: z.string().max(2048),
  createdAt: z.string(), updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['in-progress', 'needs-review', 'partial', 'completed', 'failed']),
  records: z.number().int().nonnegative().nullable(),
  reviewed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  deliverables: z.array(z.enum(['excel', 'pdf'])).max(2),
}).strict()
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>
export const HistoryResponseSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal('profile'),
  entries: z.array(HistoryEntrySchema.extend({ sourceAvailable: z.boolean() })),
  total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive(),
}).strict()
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>
