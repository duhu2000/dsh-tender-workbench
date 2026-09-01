import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { createArtifactRouteHandler } from './host/artifacts/artifact-route.ts'
import { CommandReceiptCoordinator } from './host/artifacts/command-receipts.ts'
import { registerArtifactRoute } from './host/artifacts/register-route.ts'
import type { SessionPersistenceLocator } from './host/artifacts/store.ts'
import { tenderWorkflowProjectionDefinition } from './host/projection.ts'
import { createTenderWorkbenchQueryTool } from './host/tools/query-tool.ts'

/** Public Host services required by the S2 query and Session-private Artifact seam. */
export const inject = ['sessionProjections', 'tools', 'sessionPersistence', 'webServer', 'sessions']

function sessionPersistenceLocator(ctx: Context): SessionPersistenceLocator {
  const candidate: unknown = ctx.get('sessionPersistence')
  if (typeof candidate !== 'object' || candidate === null || !('locate' in candidate) || typeof candidate.locate !== 'function') {
    throw new Error('dsh-tender-workbench requires the public sessionPersistence.locate() service')
  }
  const service = candidate as { locate(header: SessionHeader): { readonly kind: string; readonly path: string } | undefined }
  return { locate: header => service.locate(header) }
}

/** Register the whole-Session Projection, high-level query tool, and read-only Artifact route. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(tenderWorkflowProjectionDefinition)
  const persistence = sessionPersistenceLocator(ctx)
  const receipts = new CommandReceiptCoordinator()
  ctx.effect(() => ctx.tools.register(createTenderWorkbenchQueryTool({
    tools: ctx.tools,
    sessionProjections: ctx.sessionProjections,
    sessionPersistence: persistence,
    receipts,
  })), 'dsh-tender-workbench: query tool')
  ctx.effect(() => registerArtifactRoute(
    ctx.webServer,
    createArtifactRouteHandler({ sessions: ctx.sessions, sessionPersistence: persistence }),
  ), 'dsh-tender-workbench: artifact route')
}
