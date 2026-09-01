import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import { tenderWorkflowProjectionDefinition } from './host/projection.ts'

/** Host services required by the first durable workflow seam. */
export const inject = ['sessionProjections']

/** Register the Session-scoped workflow projection through the official seam. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(tenderWorkflowProjectionDefinition)
}
