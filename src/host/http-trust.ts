import type { IncomingMessage } from 'node:http'

export interface ArtifactRequestIdentity {
  readonly host: string
  readonly sessionId: string
  readonly artifactToken: string
}

function rawHeaderValues(request: IncomingMessage, name: string): string[] {
  const lower = name.toLowerCase()
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === lower) values.push(request.rawHeaders[index + 1] ?? '')
  }
  return values
}

function isLoopbackAddress(value: string | undefined): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

function isLoopbackHost(value: string): boolean {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLowerCase()
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

export function artifactRequestIdentity(request: IncomingMessage): ArtifactRequestIdentity | undefined {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return undefined
  const hosts = rawHeaderValues(request, 'host')
  const sessions = rawHeaderValues(request, 'x-dsh-tender-session')
  const tokens = rawHeaderValues(request, 'x-dsh-tender-artifact-token')
  const origins = rawHeaderValues(request, 'origin')
  const sites = rawHeaderValues(request, 'sec-fetch-site')
  if (hosts.length !== 1 || sessions.length !== 1 || tokens.length !== 1 || origins.length > 1 || sites.length > 1) return undefined
  const host = hosts[0] ?? ''
  const sessionId = sessions[0] ?? ''
  const artifactToken = tokens[0] ?? ''
  if (!isLoopbackHost(host) || sessionId === '' || sessionId.length > 128 || artifactToken === '' || artifactToken.length > 128) return undefined

  const site = sites[0]
  if (site !== undefined && site !== 'same-origin') return undefined
  const origin = origins[0]
  let sameAuthority = false
  if (origin !== undefined) {
    try {
      sameAuthority = new URL(origin).host.toLowerCase() === host.toLowerCase()
    } catch {
      return undefined
    }
    if (!sameAuthority) return undefined
  }
  if (site !== 'same-origin' && !sameAuthority) return undefined
  return { host, sessionId, artifactToken }
}
