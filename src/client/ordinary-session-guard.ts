import type { ISessions, IWorkspaces, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

/** Compatibility for legacy workbench Sessions still attached to a Workspace.
 * Keep their history/drafts intact; exclude them only from New Session reuse.
 * DSH's public connectWorkspace currently has no candidate-filter extension.
 */
export function installOrdinarySessionGuard(sessions: ISessions, workspaces: IWorkspaces): () => void {
  const original = workspaces.connectWorkspace
  if (typeof original !== 'function') return () => {}
  const businessSession = (id: string) => /^session-dsh-(?:tender-workbench|pre-duediligence|data-cleaning-agent)-/u.test(id)
  const pending = new Map<WorkspaceId, Promise<SessionId>>()
  let active = true
  const guarded = async function (this: IWorkspaces, workspaceId: WorkspaceId): Promise<SessionId> {
    const selected = await original.call(this, workspaceId)
    if (!active || !businessSession(selected)) return selected
    const existing = pending.get(workspaceId)
    if (existing !== undefined) return existing
    const resolve = async (): Promise<SessionId> => {
      const workspace = this.list.getSnapshot()
      const target = workspace.items.find(item => item.workspaceId === workspaceId)
      if (target === undefined) throw new Error('New Session workspace is unavailable')
      const snapshot = sessions.list.getSnapshot()
      const reusable = snapshot.ids.find(id => {
        const item = snapshot.byId[id]
        return !businessSession(id) && item?.blank === true && item.cwd === target.path
          && target.sessionIds.includes(id) && !workspace.archivedSessionIds.includes(id)
      })
      if (reusable !== undefined) return reusable
      const capability = sessions as ISessions & { create(options: { workspaceId: WorkspaceId }): Promise<SessionId> }
      const created = await capability.create({ workspaceId })
      if (businessSession(created)) throw new Error('New Session returned a business Session')
      return created
    }
    const attempt = resolve().finally(() => { pending.delete(workspaceId) })
    pending.set(workspaceId, attempt)
    return attempt
  }
  workspaces.connectWorkspace = guarded
  return () => {
    active = false
    if (workspaces.connectWorkspace === guarded) workspaces.connectWorkspace = original
  }
}
