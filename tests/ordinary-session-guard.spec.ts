import { describe, expect, it, vi } from 'vitest'
import type { ISessions, IWorkspaces, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { installOrdinarySessionGuard } from '../src/client/ordinary-session-guard.ts'

const legacy = 'session-dsh-tender-workbench-12345678-1234-4234-8234-123456789abc'
function fixture(selected = legacy) {
  const workspace = { items: [{ workspaceId: 'w', path: '/work', sessionIds: [legacy] }], archivedSessionIds: [] as string[] }
  const snapshot = { ids: [legacy], byId: { [legacy]: { blank: true, cwd: '/work' } } as Record<string, { blank: boolean; cwd: string }> }
  const sessions = {
    list: { getSnapshot: () => snapshot },
    create: vi.fn(async function (this: unknown, _opts: unknown) {
      expect(this).toBe(sessions)
      return 'ordinary'
    }),
  }
  const workspaces = {
    list: { getSnapshot: () => workspace },
    connectWorkspace: vi.fn(async function (this: unknown, _id: unknown) {
      expect(this).toBe(workspaces)
      return selected
    }),
  }
  const original = workspaces.connectWorkspace
  const release = installOrdinarySessionGuard(sessions as unknown as ISessions, workspaces as unknown as IWorkspaces)
  const connect = () => workspaces.connectWorkspace('w' as WorkspaceId)
  return { workspace, snapshot, sessions, workspaces, original, release, connect }
}

describe('ordinary New Session compatibility', () => {
  it('does not select a legacy business blank or alter its history/registration', async () => {
    const f = fixture()
    const before = structuredClone(f.workspace)
    expect(await f.connect()).toBe('ordinary')
    expect(f.sessions.create).toHaveBeenCalledWith({ workspaceId: 'w' })
    expect(f.workspace).toEqual(before)
    f.release()
    expect(f.workspaces.connectWorkspace).toBe(f.original)
  })
  it('passes ordinary selections through unchanged', async () => {
    const f = fixture('ordinary-existing')
    expect(await f.connect()).toBe('ordinary-existing')
    expect(f.sessions.create).not.toHaveBeenCalled()
  })
  it('reuses a non-archived ordinary blank in the same workspace', async () => {
    const f = fixture()
    f.snapshot.ids.push('archived', 'ordinary-existing')
    f.workspace.items[0]!.sessionIds.push('archived', 'ordinary-existing')
    f.workspace.archivedSessionIds.push('archived')
    f.snapshot.byId.archived = { blank: true, cwd: '/work' }
    f.snapshot.byId['ordinary-existing'] = { blank: true, cwd: '/work' }
    expect(await f.connect()).toBe('ordinary-existing')
    expect(f.sessions.create).not.toHaveBeenCalled()
  })
  it('coalesces concurrent New Session requests', async () => {
    const f = fixture()
    let finish!: (id: string) => void
    f.sessions.create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const results = [f.connect(), f.connect()]
    await vi.waitFor(() => expect(f.sessions.create).toHaveBeenCalledTimes(1))
    finish('ordinary')
    expect(await Promise.all(results)).toEqual(['ordinary', 'ordinary'])
  })
  it('propagates creation failure without returning the foreign Session', async () => {
    const f = fixture()
    f.sessions.create.mockRejectedValueOnce(new Error('offline'))
    await expect(f.connect()).rejects.toThrow('offline')
    expect(await f.connect()).toBe('ordinary')
  })
  it('becomes inert on disposal even when another wrapper retains it', async () => {
    const f = fixture()
    const retained = f.workspaces.connectWorkspace
    f.workspaces.connectWorkspace = vi.fn(() => retained.call(f.workspaces, 'w' as WorkspaceId))
    f.release()
    expect(await f.connect()).toBe(legacy as SessionId)
    expect(f.sessions.create).not.toHaveBeenCalled()
  })
})
