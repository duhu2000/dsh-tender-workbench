import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TenderClientContext } from './client-context.ts'
import { initializeTenderDraft } from './initial-draft.ts'

/** DSH 0.1.2-rc.1 public input shell + public Lexical lifecycle; no keyboard/private fields. */
export function initializeTenderHostDraft(ctx: TenderClientContext, id: SessionId): () => void {
  try {
    // The published resolver type exposes only `for`; probe the documented id-addressed shell face.
    type Shell = ReturnType<typeof ctx.conversation.input.for> & { editor: {
      getRootElement(): HTMLElement | null
      isComposing(): boolean
      registerRootListener(listener: (root: HTMLElement | null) => void): () => void
      update(write: () => void, options: { discrete: boolean; tag: string }): void
    } }
    const input = ctx.conversation.input as unknown as { shell?: (id: SessionId) => Shell }
    if (typeof input.shell !== 'function') return () => {}
    const shell = input.shell(id)
    const editor = shell.editor
    if (!editor?.registerRootListener || !editor.isComposing || !editor.update) return () => {}
    const cleanup = initializeTenderDraft(id, {
      snapshot() {
        const state = shell.state.getSnapshot()
        return { current: ctx.sessions.list.getSnapshot().current,
          ready: editor.getRootElement()?.isConnected === true, composing: editor.isComposing(),
          draft: state.draft, revision: state.draftRev, plain: state.phase === 'plain',
          attachments: state.imageIds.length + state.occurrences.length }
      },
      subscribe(check, cancel) {
        let detach = () => {}
        const rootOff = editor.registerRootListener(root => {
          detach()
          if (root) {
            const events = ['beforeinput', 'paste', 'drop', 'compositionstart'] as const
            events.forEach(event => root.addEventListener(event, cancel, true))
            detach = () => events.forEach(event => root.removeEventListener(event, cancel, true))
          }
          check()
        })
        const stateOff = shell.state.subscribe(check)
        const sessionOff = ctx.sessions.list.subscribe(check)
        return () => { detach(); rootOff(); stateOff(); sessionOff() }
      },
      write(text) {
        // Public Lexical update tag suppresses DOM selection/focus synchronization.
        // setDraft remains the sole mutation API; no DOM text/placeholder writes.
        editor.update(() => shell.setDraft(text), { discrete: true, tag: 'skip-dom-selection' })
      },
    }, window.localStorage)
    const timeout = setTimeout(cleanup, 5_000)
    return () => { clearTimeout(timeout); cleanup() }
  } catch { return () => {} }
}
