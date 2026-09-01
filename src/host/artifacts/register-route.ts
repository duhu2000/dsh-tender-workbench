import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'

export const ARTIFACT_ROUTE_PREFIX = '/dsh-tender-workbench/api/v1/artifacts'

/** Claim the single MVP artifact prefix on a loopback-only DSH Web host. */
export function registerArtifactRoute(
  webServer: Pick<WebServer, 'host' | 'register'>,
  handler: WebRoute['handler'],
): () => void {
  if (webServer.host !== '127.0.0.1') {
    throw new Error('dsh-tender-workbench artifact API requires a 127.0.0.1 WebServer binding')
  }
  return webServer.register({ kind: 'prefix', path: ARTIFACT_ROUTE_PREFIX, handler })
}

