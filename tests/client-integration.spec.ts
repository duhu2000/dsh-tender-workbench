// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'
import type { TenderClientContext } from '../src/client/client-context.ts'
import { TENDER_WORKBENCH_TAB_ID } from '../src/client/better-sidebar-adapter.ts'
import { TENDER_ENTRY_SESSION_ID_PREFIX } from '../src/client/tender-session-entry.ts'

afterEach(() => { cleanup() })

function harness() {
  const entries: unknown[] = []
  const effects: Array<() => void> = []
  const disposeEntries: Array<ReturnType<typeof vi.fn>> = []
  const disposeTab = vi.fn()
  const openTab = vi.fn()
  let current: string | undefined = 'session-1'
  const sessionState = {
    ids: ['session-1', 'session-2'],
    byId: {
      'session-1': { id: 'session-1', cwd: 'C:\\one' },
      'session-2': { id: 'session-2', cwd: 'C:\\two' },
    } as Record<string, { id: string; cwd?: string }>,
    get current() { return current },
  }
  const register = vi.fn((entry: unknown) => {
    entries.push(entry)
    const dispose = vi.fn()
    disposeEntries.push(dispose)
    return dispose
  })
  const localeSnapshot = { active: 'zh', locales: [], revision: 1 }
  const locale = {
    register: vi.fn(() => vi.fn()),
    bind: vi.fn(() => (key: string) => key),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => localeSnapshot),
  }
  const connection = {
    api: { skills: { list: vi.fn(async () => ({ result: { ok: true, value: { skills: [] } } })) } },
  }
  const createSession = vi.fn(async ({ sessionId, cwd }: { sessionId: string; cwd: string }) => {
    sessionState.ids.unshift(sessionId)
    sessionState.byId[sessionId] = { id: sessionId, cwd }
    return sessionId
  })
  const openSession = vi.fn((sessionId: string) => { current = sessionId })
  const sessions = {
    list: { getSnapshot: () => sessionState },
    binding: vi.fn(),
    scope: vi.fn(),
    create: createSession,
    open: openSession,
  }
  const ctx = {
    effect: vi.fn((factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    }),
    get: vi.fn((name: string) => name === 'sessions'
      ? sessions
      : name === 'locale' ? locale : name === 'connection' ? connection : undefined),
    locale,
    slots: {
      inject: vi.fn((_name: string, callback: () => unknown) => {
        const dispose = callback()
        if (typeof dispose === 'function') effects.push(dispose as () => void)
        return dispose
      }),
      register,
    },
    conversationEvents: { register: vi.fn() },
    sessions,
    workspaces: {
      list: { getSnapshot: () => ({
        items: [
          { workspaceId: 'workspace-1', path: 'C:\\one', title: 'one', sessionIds: ['session-1'] },
          { workspaceId: 'workspace-2', path: 'C:\\two', title: 'two', sessionIds: ['session-2'] },
        ],
        recentWorkspaceId: 'workspace-2',
      }) },
    },
    betterSidebar: {
      version: '0.17.1',
      features: ['targetedOpen', 'stateSubscription'],
      registerTab: vi.fn(() => disposeTab),
      isTabEnabled: vi.fn(() => true),
      openTab,
      getSnapshot: vi.fn(() => ({ sessionId: current, state: undefined, prefs: {} })),
    },
  } as unknown as TenderClientContext
  return {
    ctx, entries, effects, disposeEntries, disposeTab, openTab, createSession, openSession,
    setCurrent(value: string | undefined) { current = value },
  }
}

function entryOf<T>(entries: readonly unknown[], name: string): T {
  const entry = entries.find(value => (value as { name?: string }).name === name)
  if (entry === undefined) throw new Error(`missing entry ${name}`)
  return entry as T
}

describe('S1a client integration', () => {
  it('registers one icon-bearing workbench Tab, the dedicated entry, Hero branding, and Header recovery', () => {
    const test = harness()
    apply(test.ctx)

    expect(test.ctx.conversationEvents.register).toHaveBeenCalledTimes(1)
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledTimes(1)
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledWith(expect.objectContaining({
      id: TENDER_WORKBENCH_TAB_ID,
      single: true,
      icon: expect.any(Function),
    }))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.hero.brand.mark', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('sidebar.footer.action', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function))
    expect(test.entries).toHaveLength(4)
    expect(test.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.hero.brand.mark', priority: -10 }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'dsh-tender-workbench:hero-title' }),
      expect.objectContaining({ name: 'sidebar.footer.action', id: 'dsh-tender-workbench:sidebar' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'dsh-tender-workbench:reopen' }),
    ]))
    expect(test.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dsh-tender-workbench:dock' }),
    ]))
  })

  it('creates a distinct namespaced Session on every launcher action and targets its workbench', async () => {
    const test = harness()
    apply(test.ctx)
    const header = entryOf<{ inject(sessionId: string): { openWorkbench(): boolean } }>(
      test.entries, 'conversation.session.header.actions',
    ).inject('session-1')
    const sidebar = entryOf<{ inject(): { startTenderSession(): Promise<void> } }>(
      test.entries, 'sidebar.footer.action',
    ).inject()

    expect(header.openWorkbench()).toBe(true)
    expect(test.openTab).toHaveBeenNthCalledWith(1, { type: TENDER_WORKBENCH_TAB_ID }, {
      sessionId: 'session-1', cwd: 'C:\\one',
    })

    await sidebar.startTenderSession()
    const first = test.createSession.mock.calls[0]?.[0]
    expect(first?.cwd).toBe('C:\\one')
    expect(first?.sessionId).toMatch(new RegExp(`^${TENDER_ENTRY_SESSION_ID_PREFIX}`))
    expect(test.openSession).toHaveBeenLastCalledWith(first?.sessionId)
    expect(test.openTab).toHaveBeenNthCalledWith(2, { type: TENDER_WORKBENCH_TAB_ID }, {
      sessionId: first?.sessionId, cwd: 'C:\\one',
    })

    await sidebar.startTenderSession()
    const second = test.createSession.mock.calls[1]?.[0]
    expect(second?.sessionId).toMatch(new RegExp(`^${TENDER_ENTRY_SESSION_ID_PREFIX}`))
    expect(second?.sessionId).not.toBe(first?.sessionId)
    expect(test.createSession).toHaveBeenCalledTimes(2)
  })

  it('releases the Tab and all Slot entries with the Client Context', () => {
    const test = harness()
    apply(test.ctx)
    expect(test.disposeTab).not.toHaveBeenCalled()
    for (const dispose of [...test.effects].reverse()) dispose()
    expect(test.disposeTab).toHaveBeenCalledTimes(1)
    expect(test.disposeEntries).toHaveLength(4)
    for (const dispose of test.disposeEntries) expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('renders a mounted Tab from narrow raw ports without reading an inactive plugin Context', () => {
    const test = harness()
    apply(test.ctx)
    const descriptor = vi.mocked(test.ctx.betterSidebar.registerTab).mock.calls[0]?.[0] as {
      component(props: unknown): ReactNode
    }
    for (const dispose of [...test.effects].reverse()) dispose()
    vi.mocked(test.ctx.get).mockImplementation(() => { throw new Error('inactive Context read') })

    const view = render(descriptor.component({
      scope: { sessionId: 'session-1' },
      visible: true,
      tab: { id: TENDER_WORKBENCH_TAB_ID },
      store: { reduce: vi.fn() },
    }) as ReactElement)
    expect(view.container.textContent).toContain('workbench.title')
  })
})
