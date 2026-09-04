import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  FishLogo,
  IconGoalOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { readTenderProjectionSnapshot } from './tender-projection-port.ts'
import { isTenderEntrySessionId } from './tender-session-entry.ts'
import { tenderWorkbenchDisplayStatus } from './workbench/workbench-status.ts'
import css from './workbench-entry.module.css'

const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]'
const TENDER_TOP_MOUNT_SELECTOR = '[data-dsh-tender-top-mount="true"]'
const KNOWN_HERO_HEADLINES = new Set([
  '探索未至之境',
  'Into the Unknown',
  '访前尽调智能体',
])

export type TenderHeroBrandMarkProps = PropsRuntime<'conversation.hero.brand.mark'>

/** Preserve the native mark everywhere except Sessions created by the tender entry. */
export function TenderHeroBrandMark({ size, className, useSessions }: TenderHeroBrandMarkProps) {
  const sessionId = useSessions(snapshot => snapshot.current)
  return isTenderEntrySessionId(sessionId)
    ? <IconGoalOutline16 size={size} className={className} />
    : <FishLogo size={size} className={className} />
}

export function rewriteTenderHeroHeadline(
  anchor: HTMLElement,
  enabled: boolean,
  replacement: string,
): () => void {
  if (!enabled) return () => {}
  const hero = anchor.closest<HTMLElement>('[data-phase="hero"]')
  if (hero === null) return () => {}
  const title = [...hero.querySelectorAll<HTMLSpanElement>('span')].find(element => (
    element.dataset.dshTenderHeroHeadline === 'true'
    || KNOWN_HERO_HEADLINES.has(element.textContent?.trim() ?? '')
  ))
  if (title === undefined) return () => {}

  let original = title.dataset.dshTenderOriginalHeadline ?? title.textContent ?? ''
  title.dataset.dshTenderHeroHeadline = 'true'
  title.dataset.dshTenderOriginalHeadline = original
  title.textContent = replacement
  const Observer = anchor.ownerDocument.defaultView?.MutationObserver
  const observer = Observer === undefined ? undefined : new Observer(() => {
    if (title.textContent === replacement) return
    original = title.textContent ?? original
    title.dataset.dshTenderOriginalHeadline = original
    title.textContent = replacement
  })
  observer?.observe(title, { childList: true, characterData: true, subtree: true })
  return () => {
    observer?.disconnect()
    if (title.dataset.dshTenderOriginalHeadline !== original) return
    if (title.textContent === replacement) title.textContent = original
    delete title.dataset.dshTenderOriginalHeadline
    delete title.dataset.dshTenderHeroHeadline
  }
}

export type TenderHeroTitleBridgeProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'tenderFilter'>

/** Narrow, reversible bridge for the headline that DSH does not expose as a Slot. */
export function TenderHeroTitleBridge({ sessionId, t, useSession }: TenderHeroTitleBridgeProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const blank = useSession(snapshot => snapshot.composerPhase === 'blank')
  const replacement = t('sidebar.label')

  useEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return
    return rewriteTenderHeroHeadline(
      anchor,
      blank && isTenderEntrySessionId(sessionId),
      replacement,
    )
  }, [blank, replacement, sessionId])

  return <span ref={anchorRef} hidden data-dsh-tender-hero-anchor="true" />
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
  if (mount.parentElement !== parent) parent.prepend(mount)
  return mount
}

/** Global launcher portalled at the start of the sidebar's primary action region. */
export function TenderSidebarEntry({ wide, startTenderSession, t }: TenderSidebarEntryProps) {
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
    <div className={css.topEntry} data-wide={wide} data-dsh-plugin="tender-workbench" data-dsh-part="top-entry">
      <Button
        type="button"
        variant="ghost"
        className={wide ? css.sidebarButton : `${css.sidebarButton} ${css.sidebarRail}`}
        data-wide={wide}
        aria-label={t('sidebar.aria')}
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

export function TenderSessionHeaderEntry({ openWorkbench, t, useProjection }: TenderHeaderEntryProps) {
  const state = tenderWorkbenchDisplayStatus(
    readTenderProjectionSnapshot(useProjection('dshTenderWorkflow')),
  )
  return (
    <button
      type="button"
      className={css.headerButton}
      data-workbench-status={state}
      title={t(`workbench.status.${state}`)}
      onClick={openWorkbench}
    >{t('header.reopen')}</button>
  )
}
