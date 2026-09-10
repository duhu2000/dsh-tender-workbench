import { useEffect, type ReactNode } from 'react'
import type {
  BetterSidebarService,
  SidebarState,
  SidebarStore,
  SessionScope,
  TabComponentProps,
} from 'dsh-better-sidebar/client/service'

export const TENDER_WORKBENCH_TAB_ID = 'dsh-tender-workbench:agent' as const

interface RevealTarget {
  readonly store: SidebarStore
  readonly tabId: string
}

export interface TenderWorkbenchRevealController {
  /** Attach the mounted workbench Tab for one Session. */
  attach(sessionId: string, target: RevealTarget): () => void
  /** Consume one explicit user-entry reveal request, now or after first mount. */
  request(sessionId: string): void
  dispose(): void
}

function treeContainsTab(node: SidebarState['splits'], tabId: string): boolean {
  if (node.kind === 'leaf') return node.tabs.some(tab => tab.id === tabId)
  return node.children.some(child => treeContainsTab(child, tabId))
}

function treeFocusesTab(node: SidebarState['splits'], tabId: string): boolean {
  return node.kind === 'leaf' ? node.active === tabId && node.tabs.some(tab => tab.id === tabId)
    : node.children.some(child => treeFocusesTab(child, tabId))
}

function ownsWorkbench(state: SidebarState): boolean {
  const owns = (node: SidebarState['splits']): boolean => node.kind === 'leaf'
    ? node.tabs.some(tab => tab.type === TENDER_WORKBENCH_TAB_ID) : node.children.some(owns)
  return owns(state.splits) || owns(state.bottomSplits) || state.floats.some(item => item.tab.type === TENDER_WORKBENCH_TAB_ID)
}

/** Reveal only the panel that owns the workbench Tab; floating Tabs are already visible. */
export function revealTenderWorkbenchState(state: SidebarState, tabId: string): SidebarState {
  if (state.floats.some(float => float.tab.id === tabId)) return state
  if (treeContainsTab(state.bottomSplits, tabId)) {
    return state.bottomOpen ? state : { ...state, bottomOpen: true }
  }
  if (treeContainsTab(state.splits, tabId)) {
    return state.panelOpen ? state : { ...state, panelOpen: true }
  }
  return state
}

/**
 * Session-scoped, non-persistent handshake between an explicit product entry
 * and the mounted Better Sidebar Tab. No service means inert (isolated rendering
 * only). Production binds a probed service and explicitly disposes its listener.
 */
export function createTenderWorkbenchRevealController(
  service?: Pick<BetterSidebarService, 'getSnapshot' | 'subscribeState'>,
): TenderWorkbenchRevealController {
  const targets = new Map<string, RevealTarget>()
  const pending = new Set<string>()
  let disposed = false
  const flush = (sessionId: string) => {
    if (disposed || !pending.has(sessionId)) return
    // SidebarStore.reduce mutates the CURRENT Session, not the Tab's scope.
    // Never use a stale mounted Tab/store to reveal a different Session.
    if (service === undefined || service.getSnapshot().sessionId !== sessionId) return
    const snapshot = service.getSnapshot()
    if (snapshot.state !== undefined && !ownsWorkbench(snapshot.state)) {
      pending.delete(sessionId) // The host X won the race before the content mounted.
      return
    }
    const target = targets.get(sessionId)
    if (target === undefined) return
    pending.delete(sessionId) // Consume before reduce: notifications can be synchronous.
    target.store.reduce(state => service.getSnapshot().sessionId === sessionId
      && (treeFocusesTab(state.splits, target.tabId) || treeFocusesTab(state.bottomSplits, target.tabId))
      ? revealTenderWorkbenchState(state, target.tabId) : state)
  }
  const unsubscribe = service?.subscribeState(() => {
    const sessionId = service.getSnapshot().sessionId
    if (sessionId !== undefined) flush(sessionId)
  })

  return {
    attach(sessionId, target) {
      if (disposed) return () => {}
      targets.set(sessionId, target)
      flush(sessionId)
      return () => {
        if (targets.get(sessionId) === target) targets.delete(sessionId)
      }
    },
    request(sessionId) {
      if (disposed) return
      pending.add(sessionId)
      flush(sessionId)
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe?.()
      pending.clear()
      targets.clear()
    },
  }
}

/** Bind the workbench shell to its Session reveal controller. */
export function useTenderWorkbenchReveal(
  controller: TenderWorkbenchRevealController,
  props: Pick<TabComponentProps, 'scope' | 'store' | 'tab'>,
): void {
  const sessionId = props.scope.sessionId
  const store = props.store
  const tabId = props.tab.id
  useEffect(() => controller.attach(sessionId, { store, tabId }), [controller, sessionId, store, tabId])
}

/** Probe the optional provider before registering or opening its workbench. */
export function assertBetterSidebarContract(service: BetterSidebarService): void {
  const methods = ['registerTab', 'isTabEnabled', 'openTab', 'getSnapshot', 'subscribeState'] as const
  for (const method of methods) {
    if (typeof service[method] !== 'function') {
      throw new Error(`dsh-tender-workbench requires the Better Sidebar ${method}() capability`)
    }
  }
  const features: readonly string[] = Array.isArray(service.features) ? service.features : []
  if (!features.includes('targetedOpen')) {
    throw new Error('dsh-tender-workbench requires the Better Sidebar targetedOpen capability')
  }
  if (!features.includes('stateSubscription')) {
    throw new Error('dsh-tender-workbench requires the Better Sidebar stateSubscription capability')
  }
}

/** Register the single Session-scoped workbench tab through Better Sidebar's public service. */
export function registerTenderWorkbenchTab(
  service: BetterSidebarService,
  component: (props: TabComponentProps) => ReactNode,
  title: string | (() => string) = '招投标',
  icon?: ReactNode | ((size: number) => ReactNode),
): () => void {
  assertBetterSidebarContract(service)
  return service.registerTab({
    id: TENDER_WORKBENCH_TAB_ID,
    title,
    icon,
    order: 40,
    single: true,
    component,
  })
}

/**
 * Create or focus the workbench Tab in the explicitly supplied Session. A
 * pending reveal is consumed only when its Session becomes current.
 */
export function openTenderWorkbench(
  service: BetterSidebarService,
  scope: SessionScope,
  reveal: TenderWorkbenchRevealController,
): boolean {
  assertBetterSidebarContract(service)
  if (!service.isTabEnabled(TENDER_WORKBENCH_TAB_ID)) return false
  service.openTab({ type: TENDER_WORKBENCH_TAB_ID }, scope)
  reveal.request(scope.sessionId)
  return true
}
