// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'
import type { TenderClientContext } from '../src/client/client-context.ts'
import { TENDER_WORKBENCH_TAB_ID } from '../src/client/better-sidebar-adapter.ts'

afterEach(() => { cleanup() })

function harness() {
  const entries: unknown[] = []
  const effects: Array<() => void> = []
  const disposeEntries: Array<ReturnType<typeof vi.fn>> = []
  const disposeTab = vi.fn()
  const openTab = vi.fn()
  const startSession = vi.fn()
  let current: string | undefined = 'session-1'
  const sessionState = {
    ids: ['session-1', 'session-2'],
    byId: {
      'session-1': { id: 'session-1', cwd: 'C:\\one' },
      'session-2': { id: 'session-2', cwd: 'C:\\two' },
    },
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
  const sessions = {
    list: { getSnapshot: () => sessionState },
    binding: vi.fn(),
    scope: vi.fn(),
  }
  const ctx = {
    effect: vi.fn((factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    }),
    get: vi.fn((name: string) => name === 'sessions' ? sessions : name === 'locale' ? locale : undefined),
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
    workspaces: { startSession },
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
    ctx, entries, effects, disposeEntries, disposeTab, openTab, startSession,
    setCurrent(value: string | undefined) { current = value },
  }
}

function entryOf<T>(entries: readonly unknown[], name: string): T {
  const entry = entries.find(value => (value as { name?: string }).name === name)
  if (entry === undefined) throw new Error(`missing entry ${name}`)
  return entry as T
}

describe('S1a client integration', () => {
  it('registers one workbench Tab and exactly the three official entries', () => {
    const test = harness()
    apply(test.ctx)

    expect(test.ctx.conversationEvents.register).toHaveBeenCalledTimes(1)
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledTimes(1)
    expect(test.ctx.betterSidebar.registerTab).toHaveBeenCalledWith(expect.objectContaining({
      id: TENDER_WORKBENCH_TAB_ID,
      single: true,
    }))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('sidebar.footer.action', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.input.left', expect.any(Function))
    expect(test.ctx.slots.inject).toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function))
    expect(test.entries).toHaveLength(3)
    expect(test.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'sidebar.footer.action', id: 'dsh-tender-workbench:sidebar' }),
      expect.objectContaining({ name: 'conversation.input.left', id: 'dsh-tender-workbench:query' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'dsh-tender-workbench:reopen' }),
    ]))
  })

  it('routes all entries through the same targeted Tab opener and starts the native flow without a Session', () => {
    const test = harness()
    apply(test.ctx)
    const input = entryOf<{ inject(sessionId: string): { openWorkbench(): boolean } }>(
      test.entries, 'conversation.input.left',
    ).inject('session-2')
    const header = entryOf<{ inject(sessionId: string): { openWorkbench(): boolean } }>(
      test.entries, 'conversation.session.header.actions',
    ).inject('session-1')
    const sidebar = entryOf<{ inject(): { openCurrentWorkbench(): boolean } }>(
      test.entries, 'sidebar.footer.action',
    ).inject()

    expect(input.openWorkbench()).toBe(true)
    expect(header.openWorkbench()).toBe(true)
    expect(sidebar.openCurrentWorkbench()).toBe(true)
    expect(test.openTab).toHaveBeenNthCalledWith(1, { type: TENDER_WORKBENCH_TAB_ID }, {
      sessionId: 'session-2', cwd: 'C:\\two',
    })
    expect(test.openTab).toHaveBeenNthCalledWith(2, { type: TENDER_WORKBENCH_TAB_ID }, {
      sessionId: 'session-1', cwd: 'C:\\one',
    })
    expect(test.openTab).toHaveBeenNthCalledWith(3, { type: TENDER_WORKBENCH_TAB_ID }, {
      sessionId: 'session-1', cwd: 'C:\\one',
    })

    test.setCurrent(undefined)
    expect(sidebar.openCurrentWorkbench()).toBe(false)
    expect(test.startSession).toHaveBeenCalledTimes(1)
    expect(test.openTab).toHaveBeenCalledTimes(3)
  })

  it('releases the Tab and all Slot entries with the Client Context', () => {
    const test = harness()
    apply(test.ctx)
    expect(test.disposeTab).not.toHaveBeenCalled()
    for (const dispose of [...test.effects].reverse()) dispose()
    expect(test.disposeTab).toHaveBeenCalledTimes(1)
    expect(test.disposeEntries).toHaveLength(3)
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
