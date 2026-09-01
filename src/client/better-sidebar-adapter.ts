import { useEffect, type ReactNode } from 'react'
import type {
  BetterSidebarService,
  SidebarState,
  SidebarStore,
  SessionScope,
  TabComponentProps,
} from 'dsh-better-sidebar/client/service'

export const TENDER_WORKBENCH_TAB_ID = 'dsh-tender-workbench:agent' as const
const SUPPORTED_SIDEBAR_VERSION = /^0\.17\./u

interface RevealTarget {
  readonly store: SidebarStore
  readonly tabId: string
}

export interface TenderWorkbenchRevealController {
  /** Attach the mounted workbench Tab for one Session. */
  attach(sessionId: string, target: RevealTarget): () => void
  /** Consume one explicit user-entry reveal request, now or after first mount. */
  request(sessionId: string): void
}

function treeContainsTab(node: SidebarState['splits'], tabId: string): boolean {
  if (node.kind === 'leaf') return node.tabs.some(tab => tab.id === tabId)
  return node.children.some(child => treeContainsTab(child, tabId))
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
 * and the mounted Better Sidebar Tab. It owns no business state and becomes
 * unreachable with the Client plugin Context.
 */
export function createTenderWorkbenchRevealController(): TenderWorkbenchRevealController {
  const targets = new Map<string, RevealTarget>()
  const pending = new Set<string>()

  return {
    attach(sessionId, target) {
      targets.set(sessionId, target)
      if (pending.delete(sessionId)) {
        target.store.reduce(state => revealTenderWorkbenchState(state, target.tabId))
      }
      return () => {
        if (targets.get(sessionId) === target) targets.delete(sessionId)
      }
    },
    request(sessionId) {
      const target = targets.get(sessionId)
      if (target === undefined) {
        pending.add(sessionId)
        return
      }
      target.store.reduce(state => revealTenderWorkbenchState(state, target.tabId))
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

/** Fail loudly when the mandatory provider does not expose the validated contract. */
export function assertBetterSidebarContract(service: BetterSidebarService): void {
  if (!SUPPORTED_SIDEBAR_VERSION.test(service.version)) {
    throw new Error(`dsh-tender-workbench requires dsh-better-sidebar 0.17.x, got ${service.version}`)
  }
  if (!service.features.includes('targetedOpen')) {
    throw new Error('dsh-tender-workbench requires the Better Sidebar targetedOpen capability')
  }
  if (!service.features.includes('stateSubscription')) {
    throw new Error('dsh-tender-workbench requires the Better Sidebar stateSubscription capability')
  }
}

/** Register the single Session-scoped workbench tab through Better Sidebar's public service. */
export function registerTenderWorkbenchTab(
  service: BetterSidebarService,
  component: (props: TabComponentProps) => ReactNode,
  title: string | (() => string) = '招投标',
): () => void {
  assertBetterSidebarContract(service)
  return service.registerTab({
    id: TENDER_WORKBENCH_TAB_ID,
    title,
    order: 40,
    single: true,
    component,
  })
}

/**
 * Create or focus the workbench Tab in the explicitly supplied Session. A
 * reveal request is emitted only when that Session is currently on screen;
 * inactive targeted opens never alter a hidden Session's panel geometry.
 */
export function openTenderWorkbench(
  service: BetterSidebarService,
  scope: SessionScope,
  reveal: TenderWorkbenchRevealController,
): boolean {
  assertBetterSidebarContract(service)
  if (!service.isTabEnabled(TENDER_WORKBENCH_TAB_ID)) return false
  service.openTab({ type: TENDER_WORKBENCH_TAB_ID }, scope)
  if (service.getSnapshot().sessionId === scope.sessionId) reveal.request(scope.sessionId)
  return true
}
