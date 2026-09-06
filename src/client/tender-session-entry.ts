import type {
  ISessions,
  IWorkspaces,
  SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'

export const TENDER_ENTRY_SESSION_ID_PREFIX = 'session-dsh-tender-workbench-'

export type TenderSessionEntryErrorCode =
  | 'create-unavailable'
  | 'invalid-session-id'
  | 'workspace-unavailable'

export class TenderSessionEntryError extends Error {
  constructor(readonly code: TenderSessionEntryErrorCode) {
    super(code)
    this.name = 'TenderSessionEntryError'
  }
}

interface SessionCreateCapability {
  create(options: { cwd: string; sessionId: SessionId }): Promise<SessionId>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function browserUuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new TenderSessionEntryError('create-unavailable')
  }
  return globalThis.crypto.randomUUID()
}

export function isTenderEntrySessionId(sessionId: string | undefined): boolean {
  return sessionId?.startsWith(TENDER_ENTRY_SESSION_ID_PREFIX) === true
    && UUID_PATTERN.test(sessionId.slice(TENDER_ENTRY_SESSION_ID_PREFIX.length))
}

export function createTenderEntrySessionId(uuid: string): SessionId {
  if (!UUID_PATTERN.test(uuid)) throw new TenderSessionEntryError('invalid-session-id')
  return `${TENDER_ENTRY_SESSION_ID_PREFIX}${uuid}` as SessionId
}

/**
 * Resolve the owning workspace's canonical directory path to seed a
 * `cwd`-owned entry Session. A `cwd`-only create deliberately does NOT attach
 * the Session to the workspace, so DSH's New-Session blank-session reuse skips it.
 */
export function resolveTenderEntryWorkspacePath(
  sessions: Pick<ISessions, 'list'>,
  workspaces: Pick<IWorkspaces, 'list'>,
): string | undefined {
  const current = sessions.list.getSnapshot().current
  const workspaceSnapshot = workspaces.list.getSnapshot()
  const currentWorkspace = current === undefined
    ? undefined
    : workspaceSnapshot.items.find(workspace => workspace.sessionIds.includes(current))
  return currentWorkspace?.path
    ?? workspaceSnapshot.items.find(workspace => workspace.workspaceId === workspaceSnapshot.recentWorkspaceId)?.path
    ?? workspaceSnapshot.items[0]?.path
}

/**
 * Create a distinct native Session with `cwd` ownership only (no workspace
 * attachment). This keeps the Session out of the workspace's reusable blank-set,
 * so DSH's 新会话 action mints a fresh default Session instead of reopening the
 * workbench Session.
 */
export async function createTenderEntrySession(
  sessions: ISessions,
  workspaces: IWorkspaces,
  uuid: () => string = browserUuid,
): Promise<SessionId> {
  const cwd = resolveTenderEntryWorkspacePath(sessions, workspaces)
  if (cwd === undefined) throw new TenderSessionEntryError('workspace-unavailable')

  const capability = sessions as ISessions & Partial<SessionCreateCapability>
  if (typeof capability.create !== 'function') {
    throw new TenderSessionEntryError('create-unavailable')
  }

  const requestedId = createTenderEntrySessionId(uuid())
  const createdId = await capability.create({ cwd, sessionId: requestedId })
  if (createdId !== requestedId) throw new TenderSessionEntryError('invalid-session-id')
  return createdId
}
