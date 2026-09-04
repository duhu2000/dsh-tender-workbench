import type {
  BetterSidebarService,
  SidebarState,
  SidebarStore,
  SessionScope,
} from 'dsh-better-sidebar/client/service'
import { describe, expect, it, vi } from 'vitest'
import {
  TENDER_WORKBENCH_TAB_ID,
  assertBetterSidebarContract,
  createTenderWorkbenchRevealController,
  openTenderWorkbench,
  registerTenderWorkbenchTab,
  revealTenderWorkbenchState,
} from '../src/client/better-sidebar-adapter.ts'

function snapshot(sessionId: string): ReturnType<BetterSidebarService['getSnapshot']> {
  return { sessionId, state: undefined, prefs: {} } as ReturnType<BetterSidebarService['getSnapshot']>
}

function service(overrides: Partial<BetterSidebarService> = {}): BetterSidebarService {
  return {
    version: '0.17.1',
    features: ['targetedOpen', 'stateSubscription'],
    registerTab: vi.fn(() => () => {}),
    isTabEnabled: vi.fn(() => true),
    openTab: vi.fn(),
    getSnapshot: vi.fn(() => snapshot('session-1')),
    ...overrides,
  } as unknown as BetterSidebarService
}

function state(location: 'right' | 'bottom' | 'float', open = false): SidebarState {
  const workbench = { id: TENDER_WORKBENCH_TAB_ID, type: TENDER_WORKBENCH_TAB_ID, title: '招投标' }
  const empty = { kind: 'leaf' as const, id: 'empty', tabs: [], active: null }
  const right = location === 'right'
    ? { kind: 'leaf' as const, id: 'right', tabs: [workbench], active: workbench.id }
    : empty
  const bottom = location === 'bottom'
    ? { kind: 'leaf' as const, id: 'bottom', tabs: [workbench], active: workbench.id }
    : { ...empty, id: 'bottom' }
  return {
    panelOpen: location === 'right' ? open : false,
    width: 400,
    activePane: location === 'bottom' ? 'bottom' : 'right',
    nextTerminal: 1,
    nextBrowser: 1,
    expanded: [],
    revealed: [],
    splits: right,
    bottomOpen: location === 'bottom' ? open : false,
    bottomHeight: 220,
    bottomOpenedOnce: false,
    bottomSplits: bottom,
    floats: location === 'float' ? [{ id: 'float-1', tab: workbench, x: 0, y: 0, w: 390, h: 780 }] : [],
  }
}

function store(initial: SidebarState): { readonly store: SidebarStore; read(): SidebarState; set(next: SidebarState): void } {
  let current = initial
  return {
    store: {
      reduce: vi.fn((reducer: (value: SidebarState) => SidebarState) => { current = reducer(current) }),
    } as unknown as SidebarStore,
    read: () => current,
    set: next => { current = next },
  }
}

describe('Better Sidebar workbench adapter', () => {
  it('registers one public single-instance descriptor and disposes through the provider', () => {
    const dispose = vi.fn()
    const sidebar = service({ registerTab: vi.fn(() => dispose) })
    const component = () => null
    const icon = (size: number) => `goal-${size}`
    expect(registerTenderWorkbenchTab(sidebar, component, '招投标', icon)).toBe(dispose)
    expect(sidebar.registerTab).toHaveBeenCalledWith(expect.objectContaining({
      id: TENDER_WORKBENCH_TAB_ID,
      single: true,
      icon,
      component,
    }))
  })

  it('targets the requested Session and does not implement a fallback provider', () => {
    const sidebar = service()
    const reveal = createTenderWorkbenchRevealController()
    const scope: SessionScope = { sessionId: 'session-1', cwd: 'C:\\workspace' }
    expect(openTenderWorkbench(sidebar, scope, reveal)).toBe(true)
    expect(sidebar.openTab).toHaveBeenCalledWith({ type: TENDER_WORKBENCH_TAB_ID }, scope)

    expect(() => assertBetterSidebarContract(service({ version: '0.16.1' }))).not.toThrow()
    expect(() => assertBetterSidebarContract(service({ version: '0.18.0-alpha.0' }))).not.toThrow()
    expect(() => assertBetterSidebarContract(service({ openTab: undefined as never }))).toThrow('openTab()')
    expect(() => assertBetterSidebarContract(service({ features: [] }))).toThrow('targetedOpen')
    expect(() => assertBetterSidebarContract(service({ features: ['targetedOpen'] }))).toThrow('stateSubscription')
  })

  it('respects a user-disabled workbench tab without opening it', () => {
    const sidebar = service({ isTabEnabled: vi.fn(() => false) })
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-1' }, createTenderWorkbenchRevealController())).toBe(false)
    expect(sidebar.openTab).not.toHaveBeenCalled()
  })

  it('consumes a first-open request after the current Session Tab mounts', () => {
    const sidebar = service()
    const reveal = createTenderWorkbenchRevealController()
    const target = store(state('right'))
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)).toBe(true)
    expect(target.read().panelOpen).toBe(false)
    reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    expect(target.read().panelOpen).toBe(true)
  })

  it('reveals an attached existing Tab only on another explicit request', () => {
    const sidebar = service()
    const reveal = createTenderWorkbenchRevealController()
    const target = store(state('right', true))
    reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    target.set(state('right', false))
    expect(target.read().panelOpen).toBe(false)
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)).toBe(true)
    expect(target.read().panelOpen).toBe(true)
  })

  it('detaches the mounted reveal target so unmount and HMR leave no live Store reference', () => {
    const reveal = createTenderWorkbenchRevealController()
    const target = store(state('right'))
    const dispose = reveal.attach('session-1', {
      store: target.store,
      tabId: TENDER_WORKBENCH_TAB_ID,
    })
    dispose()
    reveal.request('session-1')
    expect(target.store.reduce).not.toHaveBeenCalled()
    expect(target.read().panelOpen).toBe(false)
  })

  it('opens only the owning bottom panel and leaves a floating Tab alone', () => {
    const bottom = state('bottom')
    const revealedBottom = revealTenderWorkbenchState(bottom, TENDER_WORKBENCH_TAB_ID)
    expect(revealedBottom.bottomOpen).toBe(true)
    expect(revealedBottom.panelOpen).toBe(false)

    const floating = state('float')
    expect(revealTenderWorkbenchState(floating, TENDER_WORKBENCH_TAB_ID)).toBe(floating)
  })

  it('does not queue a reveal for an inactive targeted Session', () => {
    const sidebar = service({
      getSnapshot: vi.fn(() => snapshot('session-1')),
    })
    const reveal = createTenderWorkbenchRevealController()
    const target = store(state('right'))
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-2' }, reveal)).toBe(true)
    reveal.attach('session-2', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    expect(target.read().panelOpen).toBe(false)
  })
})
