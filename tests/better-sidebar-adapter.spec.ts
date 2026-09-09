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
    subscribeState: vi.fn(() => vi.fn()),
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
  it('honors host Files selection and Tab X before delayed content mount', () => {
    const target = store(state('right'))
    let notify = () => {}
    const sidebar = service({ getSnapshot: () => ({ ...snapshot('session-1'), state: target.read() }), subscribeState: listener => { notify = listener; return vi.fn() } })
    const reveal = createTenderWorkbenchRevealController(sidebar)
    openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)
    const initial = target.read()
    if (initial.splits.kind !== 'leaf') throw new Error('fixture leaf required')
    const files = { id: 'files', type: 'explorer', title: 'Files' }
    target.set({ ...initial, splits: { ...initial.splits, tabs: [...initial.splits.tabs, files], active: 'files' } })
    const detach = reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    expect(target.read().panelOpen).toBe(false)
    expect(target.read().splits).toMatchObject({ active: 'files' })
    detach()
    openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)
    target.set({ ...initial, splits: { ...initial.splits, tabs: [files], active: 'files' } })
    notify() // X cancels pending reveal even before any component can attach.
    target.set(initial)
    reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    expect(target.read().panelOpen).toBe(false)
  })
  it('requires a callable state subscription, not only its advertised feature', () => {
    expect(() => assertBetterSidebarContract(service({ subscribeState: undefined as never }))).toThrow('subscribeState()')
  })

  it('guards the current-session store during delayed mount, then consumes reveal once on return', () => {
    let current = 'session-1'
    let notify = () => {}
    const unsubscribe = vi.fn()
    const sidebar = service({
      getSnapshot: () => snapshot(current),
      subscribeState: vi.fn(listener => { notify = listener; return unsubscribe }),
    })
    const reveal = createTenderWorkbenchRevealController(sidebar)
    const target = store(state('right'))
    openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)
    current = 'session-2'
    reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    notify()
    expect(target.store.reduce).not.toHaveBeenCalled()
    current = 'session-1'
    notify()
    expect(target.read().panelOpen).toBe(true)
    expect(target.read().width).toBe(400)
    target.set(state('right', false)) // Native collapse; a notification is NOT an open request.
    notify()
    expect(target.read().panelOpen).toBe(false)
    reveal.dispose()
    reveal.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('defers inactive targeted intent, leaves the foreground geometry untouched, and disposes pending work', () => {
    let current = 'session-1'
    let notify = () => {}
    const sidebar = service({ getSnapshot: () => snapshot(current), subscribeState: listener => { notify = listener; return vi.fn() } })
    const reveal = createTenderWorkbenchRevealController(sidebar)
    const target = store(state('bottom'))
    reveal.attach('session-2', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    openTenderWorkbench(sidebar, { sessionId: 'session-2', cwd: '/two' }, reveal)
    expect(target.store.reduce).not.toHaveBeenCalled()
    current = 'session-2'
    notify()
    expect(target.read()).toMatchObject({ panelOpen: false, bottomOpen: true, width: 400, bottomHeight: 220 })
    reveal.request('late-session')
    reveal.dispose()
    current = 'late-session'
    const late = store(state('right'))
    reveal.attach(current, { store: late.store, tabId: TENDER_WORKBENCH_TAB_ID })
    reveal.request(current)
    notify()
    expect(late.store.reduce).not.toHaveBeenCalled()
  })

  it('does not revive a closed Tab or change other Tabs, splits, width, docking or floats', () => {
    const initial = state('right')
    const files = { id: 'files', type: 'explorer', title: 'Files' }
    const closed = { ...initial, splits: { kind: 'leaf' as const, id: 'right', tabs: [files], active: 'files' } }
    expect(revealTenderWorkbenchState(closed, TENDER_WORKBENCH_TAB_ID)).toBe(closed)
    for (const location of ['right', 'bottom', 'float'] as const) {
      const before = state(location)
      const after = revealTenderWorkbenchState(before, TENDER_WORKBENCH_TAB_ID)
      expect(after.splits).toBe(before.splits)
      expect(after.bottomSplits).toBe(before.bottomSplits)
      expect(after.floats).toBe(before.floats)
      expect(after.width).toBe(before.width)
      expect(after.bottomHeight).toBe(before.bottomHeight)
      expect(after.activePane).toBe(before.activePane)
    }
  })
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
    const reveal = createTenderWorkbenchRevealController(service())
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
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-1' }, createTenderWorkbenchRevealController(service()))).toBe(false)
    expect(sidebar.openTab).not.toHaveBeenCalled()
  })

  it('consumes a first-open request after the current Session Tab mounts', () => {
    const sidebar = service()
    const reveal = createTenderWorkbenchRevealController(service())
    const target = store(state('right'))
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)).toBe(true)
    expect(target.read().panelOpen).toBe(false)
    reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    expect(target.read().panelOpen).toBe(true)
  })

  it('reveals an attached existing Tab only on another explicit request', () => {
    const sidebar = service()
    const reveal = createTenderWorkbenchRevealController(service())
    const target = store(state('right', true))
    reveal.attach('session-1', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    target.set(state('right', false))
    expect(target.read().panelOpen).toBe(false)
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-1' }, reveal)).toBe(true)
    expect(target.read().panelOpen).toBe(true)
  })

  it('detaches the mounted reveal target so unmount and HMR leave no live Store reference', () => {
    const reveal = createTenderWorkbenchRevealController(service())
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

  it('does not reveal an inactive targeted Session', () => {
    const sidebar = service({
      getSnapshot: vi.fn(() => snapshot('session-1')),
    })
    const reveal = createTenderWorkbenchRevealController(service())
    const target = store(state('right'))
    expect(openTenderWorkbench(sidebar, { sessionId: 'session-2' }, reveal)).toBe(true)
    reveal.attach('session-2', { store: target.store, tabId: TENDER_WORKBENCH_TAB_ID })
    expect(target.read().panelOpen).toBe(false)
  })
})
