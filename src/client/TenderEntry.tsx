import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconGoalOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { readTenderProjectionSnapshot } from './tender-projection-port.ts'
import { isTenderEntrySessionId } from './tender-session-entry.ts'
import { tenderWorkbenchDisplayStatus } from './workbench/workbench-status.ts'
import css from './workbench-entry.module.css'
import theme from './qcc-theme.module.css'
import { mountTenderHero, mountTenderShortcuts } from './tender-hero-bridge.ts'
import type { WorkbenchPhase } from './workbench/navigation-controller.ts'
import { WorkbenchIcon } from './workbench/TenderWorkbench.tsx'

const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]'
const TENDER_TOP_MOUNT_SELECTOR = '[data-dsh-tender-top-mount="true"]'
export interface TenderHeroInjected {
  openPhase(phase: WorkbenchPhase): boolean
}
export type TenderHeroTitleBridgeProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'tenderFilter'> & InjectFace<TenderHeroInjected>

/** Only this session's own DOM is branded; no root/single brand slot. */
export function TenderHeroTitleBridge({ sessionId, useSession, openPhase }: TenderHeroTitleBridgeProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [heroMount, setHeroMount] = useState<HTMLElement | null>(null)
  const [menuMount, setMenuMount] = useState<HTMLElement | null>(null)
  const blank = useSession(snapshot => snapshot.composerPhase === 'blank')
  const owned = isTenderEntrySessionId(sessionId)
  useEffect(() => {
    setHeroMount(null)
    if (!anchorRef.current || !owned || !blank) return
    return mountTenderHero(anchorRef.current, setHeroMount)
  }, [blank, owned, sessionId])
  useEffect(() => {
    setMenuMount(null)
    if (!anchorRef.current || !owned) return
    return mountTenderShortcuts(anchorRef.current, setMenuMount)
  }, [owned, sessionId])
  const menu = <nav className={`${theme.scope} ${css.shortcuts}`} aria-label="招投标快捷导航">
    {([['opportunity', '项目查询', 'search'], ['screening', '规则筛选', 'screening'], ['decision', '人工复核', 'decision'], ['delivery', '结果交付', 'delivery']] as const).map(([phase, label, icon]) =>
      <button key={phase} type="button" onClick={() => openPhase(phase)}><span aria-hidden="true"><WorkbenchIcon name={icon} /></span>{label}</button>)}
  </nav>
  return <>
    <span ref={anchorRef} hidden data-dsh-tender-hero-anchor="true" />
    {owned && blank && heroMount && createPortal(<div className={css.hero}>
      <div className={css.heroRow}><span className={css.heroLogo} aria-hidden="true"><IconGoalOutline16 size={26} /></span><h1>招投标智能体</h1></div>
      <p>发现项目机会，筛选相关标讯，协同复核与交付。</p>
    </div>, heroMount)}
    {owned && menuMount && createPortal(menu, menuMount)}
  </>
}

export interface TenderSidebarEntryInjected {
  startTenderSession(): Promise<void>
}

export type TenderSidebarEntryProps = PropsRuntime<'sidebar.footer.action'>
  & InjectFace<TenderSidebarEntryInjected>
  & PropsLocale<'tenderFilter'>

function ensureTenderTopMount(): HTMLElement | null {
  const workspaceSlot = document.querySelector<HTMLElement>(SIDEBAR_WORKSPACES_SELECTOR)
  if (workspaceSlot === null) return null
  const parent = workspaceSlot.parentElement
  if (parent === null) return null
  let mount = document.querySelector<HTMLElement>(TENDER_TOP_MOUNT_SELECTOR)
  if (mount === null) {
    mount = document.createElement('div')
    mount.dataset.dshTenderTopMount = 'true'
    mount.className = css.topMount ?? ''
  }
  if (mount.parentElement !== parent) parent.insertBefore(mount, workspaceSlot)
  return mount
}

/** Global launcher portalled at the start of the sidebar's primary action region. */
export function TenderSidebarEntry({ wide, startTenderSession, t, useSessions }: TenderSidebarEntryProps) {
  const currentSessionId = useSessions(snapshot => snapshot.current)
  const [topMount, setTopMount] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const creatingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    let disposed = false
    const ownedMounts = new Set<HTMLElement>()
    const syncMount = () => {
      if (disposed) return
      const mount = ensureTenderTopMount()
      if (mount !== null) ownedMounts.add(mount)
      setTopMount(current => current === mount ? current : mount)
    }
    syncMount()
    const Observer = document.defaultView?.MutationObserver
    const observer = Observer === undefined ? undefined : new Observer(syncMount)
    observer?.observe(document.body, { childList: true, subtree: true })
    return () => {
      disposed = true
      observer?.disconnect()
      for (const mount of ownedMounts) mount.remove()
    }
  }, [])

  if (topMount === null) return null
  const start = () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setError(undefined)
    void startTenderSession().catch((reason: unknown) => {
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : t('sidebar.createFailed'))
      }
    }).finally(() => {
      creatingRef.current = false
      if (mountedRef.current) setCreating(false)
    })
  }
  return createPortal(
    <div className={`${theme.scope} ${css.topEntry}`} data-wide={wide} data-dsh-plugin="tender-workbench" data-dsh-part="top-entry">
      <Button
        type="button"
        variant="ghost"
        className={wide ? css.sidebarButton : `${css.sidebarButton} ${css.sidebarRail}`}
        data-wide={wide}
        aria-label={t('sidebar.aria')}
        aria-current={isTenderEntrySessionId(currentSessionId) ? 'page' : undefined}
        aria-busy={creating}
        disabled={creating}
        title={error}
        onClick={start}
      >
        <IconGoalOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('sidebar.label')}</span>}
      </Button>
      {error !== undefined && <span className={css.sidebarError} role="alert">{error}</span>}
    </div>,
    topMount,
  )
}

export interface TenderHeaderEntryInjected {
  openWorkbench(): boolean
}

export type TenderHeaderEntryProps = PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<TenderHeaderEntryInjected>
  & PropsLocale<'tenderFilter'>

export function TenderSessionHeaderEntry({ sessionId, openWorkbench, t, useProjection }: TenderHeaderEntryProps) {
  const state = tenderWorkbenchDisplayStatus(
    readTenderProjectionSnapshot(useProjection('dshTenderWorkflow')),
  )
  if (!isTenderEntrySessionId(sessionId)) return null
  return (
    <button
      type="button"
      className={`${theme.scope} ${css.headerButton}`}
      data-workbench-status={state}
      title={t(`workbench.status.${state}`)}
      onClick={openWorkbench}
    >{t('header.reopen')}</button>
  )
}
