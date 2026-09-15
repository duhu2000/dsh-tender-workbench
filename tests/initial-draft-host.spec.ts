// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TenderClientContext } from '../src/client/client-context.ts'
import { initializeTenderHostDraft } from '../src/client/initial-draft-host.ts'
import { TENDER_INITIAL_DRAFT } from '../src/contracts/initial-draft.ts'

const id = 'session-dsh-tender-workbench-33333333-3333-4333-8333-333333333333' as SessionId
beforeEach(() => {
  // Node 25 exposes a non-browser localStorage stub; model the browser storage port explicitly.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } })
})
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })
function setup({ imageIds = [] as string[], occurrences = [] as object[], composing = false } = {}) {
  const root = document.createElement('div'); document.body.append(root)
  const offRoot = vi.fn(), offState = vi.fn(), offSession = vi.fn()
  const shell = {
    state: { getSnapshot: () => ({ draft: '', draftRev: 0, phase: 'plain', imageIds, occurrences }), subscribe: vi.fn(() => offState) },
    setDraft: vi.fn(),
    editor: { getRootElement: () => root, isComposing: () => composing,
      registerRootListener: vi.fn((listener: (node: HTMLElement | null) => void) => { listener(root); return offRoot }),
      update: vi.fn((callback: () => void) => callback()) },
  }
  const ctx = { conversation: { input: { shell: vi.fn(() => shell) } },
    sessions: { list: { getSnapshot: () => ({ current: id }), subscribe: vi.fn(() => offSession) } } } as unknown as TenderClientContext
  return { root, shell, ctx, offRoot, offState, offSession }
}
describe('UX-49 public Host adapter', () => {
  it('uses the id-addressed shell and no-focus editor tag; releases all listeners', async () => {
    const h = setup(); const dispose = initializeTenderHostDraft(h.ctx, id)
    await Promise.resolve()
    expect(h.shell.setDraft).toHaveBeenCalledExactlyOnceWith(TENDER_INITIAL_DRAFT.text)
    expect(h.shell.editor.update).toHaveBeenCalledWith(expect.any(Function), { discrete: true, tag: 'skip-dom-selection' })
    expect(h.offRoot).toHaveBeenCalled(); expect(h.offState).toHaveBeenCalled(); expect(h.offSession).toHaveBeenCalled()
    dispose()
  })
  it.each([{ imageIds: ['image'] }, { occurrences: [{ source: 'file' }] }, { composing: true }])('preserves native attachments/chips/IME %j', async state => {
    const h = setup(state); const dispose = initializeTenderHostDraft(h.ctx, id)
    await Promise.resolve(); expect(h.shell.setDraft).not.toHaveBeenCalled(); dispose()
  })
  it.each(['beforeinput', 'paste', 'drop', 'compositionstart'])('cancels a queued write on native %s', async event => {
    const h = setup(); const dispose = initializeTenderHostDraft(h.ctx, id)
    h.root.dispatchEvent(new Event(event)); await Promise.resolve()
    expect(h.shell.setDraft).not.toHaveBeenCalled(); dispose()
  })
  it('does not fail the business menu when optional public input capabilities are missing', () => {
    const ctx = { conversation: { input: {} } } as unknown as TenderClientContext
    expect(() => initializeTenderHostDraft(ctx, id)()).not.toThrow()
  })
})
