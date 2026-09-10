// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.tsx'
import type { WorkbenchDestination } from '../src/client/workbench/navigation-controller.ts'
import type { TenderClientContext } from '../src/client/client-context.ts'
import { TENDER_WORKBENCH_TAB_ID } from '../src/client/better-sidebar-adapter.ts'
import { TENDER_ENTRY_SESSION_ID_PREFIX } from '../src/client/tender-session-entry.ts'

afterEach(() => { cleanup() })

it('requires the current conversation service and disposes the event definition', () => {
  const test = harness()
  expect(inject).toContain('uiConversation')
  expect(inject).not.toContain('conversationEvents')
  apply(test.ctx)
  const stop = vi.mocked(test.ctx.uiConversation.events.register).mock.results[0]?.value
  expect(stop).toBeTypeOf('function')
  for (const dispose of [...test.effects].reverse()) dispose()
  expect(stop).toHaveBeenCalledTimes(1)
})

function harness(providerAvailable = true) {
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
    skills: { list: vi.fn(async () => ({ ok: true, value: { skills: [] } })) },
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
    inject: vi.fn((deps: string[], callback: (ctx: TenderClientContext) => void) => { if (providerAvailable && deps.includes('betterSidebar')) callback(ctx) }),
    effect: vi.fn((factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    }),
    get: vi.fn((name: string) => name === 'sessions'
      ? sessions
      : name === 'locale' ? locale : name === 'remote.skills' ? connection.skills : undefined),
    locale,
    slots: {
      inject: vi.fn((_name: string, callback: () => unknown) => {
        const dispose = callback()
        if (typeof dispose === 'function') effects.push(dispose as () => void)
        return dispose
      }),
      register,
    },
    uiConversation: { events: { register: vi.fn(() => vi.fn()) } },
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
      subscribeState: vi.fn(() => vi.fn()),
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
  it('attaches a late provider and removes only its own subscription/descriptor when that provider unloads', () => {
    const test = harness(false)
    apply(test.ctx)
    const shortcut = entryOf<{ inject(id: string): { openPhase(phase: WorkbenchDestination): boolean } }>(test.entries, 'conversation.input.dock').inject('session-1')
    expect(shortcut.openPhase('opportunity')).toBe(false)
    const attachProvider = vi.mocked(test.ctx.inject).mock.calls.find(call => call[0].includes('betterSidebar'))?.[1]
    if (!attachProvider) throw new Error('provider dependency scope missing')
    attachProvider(test.ctx as never, undefined as never)
    expect(shortcut.openPhase('opportunity')).toBe(true)
    expect(test.entries).toHaveLength(4)
    const effect = vi.mocked(test.ctx.effect)
    for (const label of ['dsh-tender-workbench: Better Sidebar tab', 'dsh-tender-workbench: provider subscription lifetime']) {
      const index = effect.mock.calls.findIndex(call => call[1] === label)
      const dispose = effect.mock.results[index]?.value
      if (typeof dispose !== 'function') throw new Error('provider cleanup missing')
      dispose()
    }
    expect(test.disposeTab).toHaveBeenCalledTimes(1)
    expect(vi.mocked(test.ctx.betterSidebar.subscribeState).mock.results[0]?.value).toHaveBeenCalledTimes(1)
    expect(shortcut.openPhase('history')).toBe(false)
    for (const dispose of test.disposeEntries) expect(dispose).not.toHaveBeenCalled()
  })
  it('keeps conversation slots when Better Sidebar is absent or incompatible', () => {
    expect(inject).not.toContain('betterSidebar')
    for (const present of [false, true]) {
      const test = harness(present)
      if (present) Object.assign(test.ctx.betterSidebar, { subscribeState: undefined })
      expect(() => apply(test.ctx)).not.toThrow()
      expect(test.entries).toHaveLength(4)
      const shortcut = entryOf<{ inject(id: string): { openPhase(phase: WorkbenchDestination): boolean } }>(test.entries, 'conversation.input.dock').inject('session-1')
      expect(shortcut.openPhase('history')).toBe(false)
      expect(test.openTab).not.toHaveBeenCalled()
      expect(test.ctx.betterSidebar.registerTab).not.toHaveBeenCalled()
    }
  })

  it('all five shortcuts repeatedly target the same Tab without creating Sessions or invoking tools', () => {
    const test = harness()
    apply(test.ctx)
    const shortcut = entryOf<{ inject(id: string): { openPhase(phase: WorkbenchDestination): boolean } }>(test.entries, 'conversation.input.dock').inject('session-2')
    for (const phase of ['opportunity', 'screening', 'decision', 'delivery', 'history'] as const) {
      expect(shortcut.openPhase(phase)).toBe(true)
      expect(shortcut.openPhase(phase)).toBe(true)
    }
    expect(test.openTab).toHaveBeenCalledTimes(10)
    for (const call of test.openTab.mock.calls) expect(call).toEqual([{ type: TENDER_WORKBENCH_TAB_ID }, { sessionId: 'session-2', cwd: test.ctx.sessions.list.getSnapshot().byId['session-2' as import('@deepseek-ai/dsh-session/types').SessionId]?.cwd }])
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledTimes(1)
    expect(test.createSession).not.toHaveBeenCalled()
    expect(test.openSession).not.toHaveBeenCalled()
    expect(test.ctx.sessions.scope).not.toHaveBeenCalled()
    const subscriptionDisposer = vi.mocked(test.ctx.betterSidebar.subscribeState).mock.results[0]?.value
    for (const dispose of [...test.effects].reverse()) dispose()
    expect(subscriptionDisposer).toHaveBeenCalledTimes(1)
    expect(shortcut.openPhase('opportunity')).toBe(false)
    expect(test.openTab).toHaveBeenCalledTimes(10)
  })
  it('registers one icon-bearing workbench Tab, the dedicated entry, Hero branding, and Header recovery', () => {
    const test = harness()
    apply(test.ctx)

    expect(test.ctx.uiConversation.events.register).toHaveBeenCalledTimes(1)
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledTimes(1)
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledWith(expect.objectContaining({
      id: TENDER_WORKBENCH_TAB_ID,
      single: true,
      icon: expect.any(Function),
    }))
    expect(test.ctx.slots.inject).not.toHaveBeenCalledWith('conversation.hero.brand.mark', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.input.overlay', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('sidebar.footer.action', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function))
    expect(test.entries).toHaveLength(4)
    expect(test.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.input.overlay', id: 'dsh-tender-workbench:prompt' }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'dsh-tender-workbench:hero-title' }),
      expect.objectContaining({ name: 'sidebar.footer.action', id: 'dsh-tender-workbench:sidebar' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'dsh-tender-workbench:reopen' }),
    ]))
    expect(test.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dsh-tender-workbench:dock' }),
    ]))
  })

  it('enters distinct landing Sessions without opening the workbench; shortcuts explicitly open it', async () => {
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
    expect(test.openTab).toHaveBeenCalledTimes(1)

    await sidebar.startTenderSession()
    const second = test.createSession.mock.calls[1]?.[0]
    expect(second?.sessionId).toMatch(new RegExp(`^${TENDER_ENTRY_SESSION_ID_PREFIX}`))
    expect(second?.sessionId).not.toBe(first?.sessionId)
    expect(test.createSession).toHaveBeenCalledTimes(2)
    expect(test.openTab).toHaveBeenCalledTimes(1)

    const shortcut = entryOf<{ inject(sessionId: string): { openPhase(phase: 'screening'): boolean } }>(
      test.entries, 'conversation.input.dock',
    ).inject(second!.sessionId)
    expect(shortcut.openPhase('screening')).toBe(true)
    expect(test.openTab).toHaveBeenNthCalledWith(2, { type: TENDER_WORKBENCH_TAB_ID }, {
      sessionId: second!.sessionId, cwd: second!.cwd,
    })
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
