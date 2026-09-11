import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
  create(options: { workspaceId: WorkspaceId; sessionId: SessionId }): Promise<SessionId>
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
 * Resolve Host-owned Workspace identity, not just a directory. Existing
 * membership wins; a legacy ungrouped Session may match a registered path.
 * Never register a new Workspace or create an ungrouped business Session here.
 */
export function resolveTenderEntryWorkspaceId(
  sessions: Pick<ISessions, 'list'>,
  workspaces: Pick<IWorkspaces, 'list'>,
): WorkspaceId | undefined {
  const sessionSnapshot = sessions.list.getSnapshot()
  const current = sessionSnapshot.current
  const workspaceSnapshot = workspaces.list.getSnapshot()
  const currentWorkspace = current === undefined
    ? undefined
    : workspaceSnapshot.items.find(workspace => workspace.sessionIds.includes(current))
  if (currentWorkspace !== undefined) return currentWorkspace.workspaceId
  const cwd = current === undefined ? undefined : sessionSnapshot.byId[current]?.cwd
  if (cwd !== undefined) {
    // Do not silently redirect a selected but unregistered directory into an
    // unrelated first Workspace. Ask the user to register/select it instead.
    return workspaceSnapshot.items.find(workspace => workspace.path === cwd)?.workspaceId
  }
  return workspaceSnapshot.items[0]?.workspaceId
}

/**
 * Create a distinct native Session explicitly attached to its Workspace.
 * Namespaced identity + ordinary-session-guard prevent New Session reuse;
 * detaching the business Session from its Workspace is not an isolation method.
 */
export async function createTenderEntrySession(
  sessions: ISessions,
  workspaces: IWorkspaces,
  uuid: () => string = browserUuid,
): Promise<SessionId> {
  const workspaceId = resolveTenderEntryWorkspaceId(sessions, workspaces)
  if (workspaceId === undefined) throw new TenderSessionEntryError('workspace-unavailable')

  const capability = sessions as ISessions & Partial<SessionCreateCapability>
  if (typeof capability.create !== 'function') {
    throw new TenderSessionEntryError('create-unavailable')
  }

  const requestedId = createTenderEntrySessionId(uuid())
  const createdId = await capability.create({ workspaceId, sessionId: requestedId })
  if (createdId !== requestedId) throw new TenderSessionEntryError('invalid-session-id')
  return createdId
}
