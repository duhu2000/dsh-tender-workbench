import type {
  ISessions,
  IWorkspaces,
  SessionId,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import {
  TENDER_ENTRY_SESSION_ID_PREFIX,
  TenderSessionEntryError,
  createTenderEntrySession,
  createTenderEntrySessionId,
  isTenderEntrySessionId,
  resolveTenderEntryWorkspacePath,
} from '../src/client/tender-session-entry.ts'

const firstWorkspaceId = 'workspace-1' as WorkspaceId
const recentWorkspaceId = 'workspace-2' as WorkspaceId

function runtime(current: SessionId | null = 'ordinary-session' as SessionId) {
  const currentSessionId = current ?? undefined
  const sessionSnapshot = {
    ids: [],
    byId: {},
    current: currentSessionId,
    phase: 'ready' as const,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaceSnapshot = {
    items: [
      { workspaceId: firstWorkspaceId, path: 'C:\\one', title: 'one', sessionIds: currentSessionId === undefined ? [] : [currentSessionId] },
      { workspaceId: recentWorkspaceId, path: 'C:\\two', title: 'two', sessionIds: [] },
    ],
    archivedSessionIds: [],
    state: 'idle' as const,
    phase: 'ready' as const,
    error: null,
    baselinesReady: true,
    recentWorkspaceId,
  }
  const create = vi.fn(async ({ sessionId }: { sessionId: SessionId }) => sessionId)
  const sessions = {
    list: { getSnapshot: () => sessionSnapshot },
    create,
  } as unknown as ISessions
  const workspaces = {
    list: { getSnapshot: () => workspaceSnapshot },
    connectWorkspace: vi.fn(),
    startSession: vi.fn(),
  } as unknown as IWorkspaces
  return { create, sessions, workspaces, workspaceSnapshot }
}

describe('dedicated tender Session entry', () => {
  it('uses the current Session workspace and creates a namespaced native Session id', async () => {
    const test = runtime()
    const uuid = '12345678-1234-4234-8234-123456789abc'
    const sessionId = await createTenderEntrySession(test.sessions, test.workspaces, () => uuid)

    expect(sessionId).toBe(`${TENDER_ENTRY_SESSION_ID_PREFIX}${uuid}`)
    expect(isTenderEntrySessionId(sessionId)).toBe(true)
    expect(isTenderEntrySessionId(`${TENDER_ENTRY_SESSION_ID_PREFIX}not-a-uuid`)).toBe(false)
    expect(test.create).toHaveBeenCalledWith({
      cwd: 'C:\\one',
      sessionId: createTenderEntrySessionId(uuid),
    })
    expect(test.workspaces.connectWorkspace).not.toHaveBeenCalled()
    expect(test.workspaces.startSession).not.toHaveBeenCalled()
  })

  it('falls back to the recent workspace path when no Session is selected', () => {
    const test = runtime(null)
    expect(resolveTenderEntryWorkspacePath(test.sessions, test.workspaces)).toBe('C:\\two')
  })

  it('rejects a runtime without distinct Session creation instead of reusing a blank Session', async () => {
    const test = runtime()
    const sessions = { list: test.sessions.list } as ISessions
    await expect(createTenderEntrySession(
      sessions,
      test.workspaces,
      () => '12345678-1234-4234-8234-123456789abc',
    )).rejects.toMatchObject({ code: 'create-unavailable' } satisfies Partial<TenderSessionEntryError>)
    expect(test.workspaces.connectWorkspace).not.toHaveBeenCalled()
  })

  it('rejects missing workspaces and malformed or mismatched ids', async () => {
    const test = runtime(null)
    test.workspaceSnapshot.items = []
    test.workspaceSnapshot.recentWorkspaceId = undefined
    await expect(createTenderEntrySession(test.sessions, test.workspaces))
      .rejects.toMatchObject({ code: 'workspace-unavailable' } satisfies Partial<TenderSessionEntryError>)

    expect(() => createTenderEntrySessionId('not-a-uuid'))
      .toThrow(expect.objectContaining({ code: 'invalid-session-id' }))

    const mismatch = runtime()
    mismatch.create.mockResolvedValue('ordinary-session' as SessionId)
    await expect(createTenderEntrySession(
      mismatch.sessions,
      mismatch.workspaces,
      () => '12345678-1234-4234-8234-123456789abc',
    )).rejects.toMatchObject({ code: 'invalid-session-id' } satisfies Partial<TenderSessionEntryError>)
  })
})
