import { z } from 'zod'
import { TENDER_TOOLS, type TenderToolNameV2 } from './orchestration.ts'

const idText = z.string().min(1).max(128)

export const TenderToolOriginV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workbench-intent'), intentId: idText }).strict(),
  z.object({ kind: z.literal('conversation') }).strict(),
  z.object({ kind: z.literal('autonomous') }).strict(),
])

export type TenderToolOriginV2 = z.infer<typeof TenderToolOriginV2Schema>

export const TenderToolControlV2Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('complete') }).strict(),
  z.object({ status: z.literal('continue'), nextTool: z.enum(TENDER_TOOLS) }).strict(),
  z.object({
    status: z.literal('failed'),
    reasonCode: z.string().min(1).max(128),
    retryable: z.boolean(),
  }).strict(),
])

export type TenderToolControlV2 = z.infer<typeof TenderToolControlV2Schema>

export const TenderToolResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.enum(TENDER_TOOLS),
  intentId: idText.optional(),
  outcome: z.enum(['succeeded', 'partial', 'failed']).optional(),
  message: z.string().min(1).max(2_048),
  result: z.unknown().optional(),
  context: z.unknown().optional(),
  batch: z.unknown().optional(),
  progress: z.unknown().optional(),
  state: z.unknown().optional(),
  control: TenderToolControlV2Schema,
}).strict().superRefine((value, context) => {
  if (value.control.status === 'failed' && value.outcome !== 'failed') {
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'failed control requires failed outcome' })
  }
  if (value.control.status !== 'failed' && value.outcome === 'failed') {
    context.addIssue({ code: 'custom', path: ['control'], message: 'failed outcome requires failed control' })
  }
})

export interface TenderToolResultV2 {
  readonly domain: 'dsh-tender-workbench'
  readonly schemaVersion: 2
  readonly tool: TenderToolNameV2
  readonly intentId?: string
  readonly outcome?: 'succeeded' | 'partial' | 'failed'
  readonly message: string
  readonly result?: unknown
  readonly context?: unknown
  readonly batch?: unknown
  readonly progress?: unknown
  readonly state?: unknown
  readonly control: TenderToolControlV2
}

export function renderTenderToolResult(value: unknown): string {
  const parsed = TenderToolResultV2Schema.parse(value)
  const visible = {
    domain: parsed.domain,
    schemaVersion: parsed.schemaVersion,
    tool: parsed.tool,
    ...(parsed.intentId === undefined ? {} : { intentId: parsed.intentId }),
    ...(parsed.result === undefined ? {} : { result: parsed.result }),
    ...(parsed.context === undefined ? {} : { context: parsed.context }),
    ...(parsed.batch === undefined ? {} : { batch: parsed.batch }),
    ...(parsed.progress === undefined ? {} : { progress: parsed.progress }),
    control: parsed.control,
  }
  return `${parsed.message}\n\n<dsh_tender_workbench_tool_result>\n${JSON.stringify(visible, null, 2)}\n</dsh_tender_workbench_tool_result>`
}
