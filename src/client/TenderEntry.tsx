import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutline16,
  IconChecklistOutline14,
  IconDownloadOutline16,
  IconGoalOutline16,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TenderTranslate } from './fields/field-props.ts'
import { readTenderProjectionSnapshot } from './tender-projection-port.ts'
import {
  TENDER_WORKBENCH_PHASES,
  tenderWorkbenchPhaseProgress,
  type WorkbenchPhase,
  type WorkbenchPhaseIcon,
} from './workbench/navigation-controller.ts'
import { tenderWorkbenchDisplayStatus } from './workbench/workbench-status.ts'
import css from './workbench-entry.module.css'

const SIDEBAR_WORKSPACES_SELECTOR = '[data-slot="sidebar.workspaces"]'
const DATA_CLEANING_TOP_MOUNT_SELECTOR = '[data-data-cleaning-top-mount="true"]'
const TENDER_TOP_MOUNT_SELECTOR = '[data-dsh-tender-top-mount="true"]'

export interface TenderDockEntryInjected {
  openWorkbench(phase: WorkbenchPhase): boolean
}

export interface TenderDockEntryViewProps extends TenderDockEntryInjected {
  readonly projection: unknown
  readonly t: TenderTranslate
}

function phaseIcon(icon: WorkbenchPhaseIcon): ReactNode {
  if (icon === 'search') return <IconSearchOutline16 size={16} />
  if (icon === 'screening') return <IconChecklistOutline14 size={16} />
  if (icon === 'decision') return <IconCheckOutline16 size={16} />
  return <IconDownloadOutline16 size={16} />
}

/** Four existing workbench phases presented as one compact launcher group. */
export function TenderDockEntryView({ openWorkbench, projection, t }: TenderDockEntryViewProps) {
  const read = readTenderProjectionSnapshot(projection)
  const workflow = read.status === 'ready' ? read.projection : undefined
  return (
    <div
      className={css.dockBar}
      role="group"
      aria-label={t('workbench.phases')}
      data-dsh-plugin="tender-workbench"
      data-dsh-part="dock-entry"
    >
      <span className={css.dockBrand}>
        <IconGoalOutline16 size={15} />
        <span>{t('sidebar.label')}</span>
      </span>
      <span className={css.dockActions}>
        {TENDER_WORKBENCH_PHASES.map((phase) => {
          const progress = tenderWorkbenchPhaseProgress(workflow, phase.id)
          const label = t(phase.labelKey)
          return (
            <button
              key={phase.id}
              type="button"
              className={css.dockButton}
              data-phase={phase.id}
              data-phase-status={progress}
              title={`${label} · ${t(`workbench.phaseStatus.${progress}`)}`}
              onClick={() => { openWorkbench(phase.id) }}
            >
              {phaseIcon(phase.icon)}
              <span>{label}</span>
            </button>
          )
        })}
      </span>
    </div>
  )
}

export type TenderDockEntryProps = PropsRuntime<'conversation.input.dock'>
  & InjectFace<TenderDockEntryInjected>
  & PropsLocale<'tenderFilter'>

/** Session entry hosted after the composer so it remains visible in the hero phase. */
export function TenderDockEntry({ openWorkbench, sessionId, t, useProjection }: TenderDockEntryProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const projection = useProjection('dshTenderWorkflow')

  useEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return
    const stack = anchor.closest<HTMLElement>('[class*="composerStack"]') ?? anchor.parentElement
    if (stack === null) return
    const nextHost = document.createElement('div')
    nextHost.className = css.dockHost ?? ''
    nextHost.dataset.dshTenderDockHost = 'true'
    stack.append(nextHost)
    setHost(nextHost)
    return () => {
      nextHost.remove()
      setHost(current => current === nextHost ? null : current)
    }
  }, [sessionId])

  return (
    <>
      <span ref={anchorRef} hidden data-dsh-tender-dock-anchor="true" />
      {host !== null && createPortal(
        <TenderDockEntryView openWorkbench={openWorkbench} projection={projection} t={t} />,
        host,
      )}
    </>
  )
}

export interface TenderSidebarEntryInjected {
  openCurrentWorkbench(): boolean
}

export type TenderSidebarEntryProps = PropsRuntime<'sidebar.footer.action'>
  & InjectFace<TenderSidebarEntryInjected>
  & PropsLocale<'tenderFilter'>

function ensureTenderTopMount(): HTMLElement | null {
  const workspaceSlot = document.querySelector<HTMLElement>(SIDEBAR_WORKSPACES_SELECTOR)
  if (workspaceSlot === null) return null
  const parent = workspaceSlot.parentElement
  if (parent === null) return null
  let mount = parent.querySelector<HTMLElement>(TENDER_TOP_MOUNT_SELECTOR)
  if (mount === null) {
    mount = document.createElement('div')
    mount.dataset.dshTenderTopMount = 'true'
    mount.className = css.topMount ?? ''
  }

  const dataCleaningMount = parent.querySelector<HTMLElement>(DATA_CLEANING_TOP_MOUNT_SELECTOR)
  if (dataCleaningMount !== null) {
    if (mount.parentElement !== parent || mount.previousSibling !== dataCleaningMount) {
      parent.insertBefore(mount, dataCleaningMount.nextSibling)
    }
  } else if (mount.parentElement !== parent) {
    parent.insertBefore(mount, workspaceSlot)
  }
  return mount
}

/** Global launcher portalled between the Data Cleaning entry and workspace browser. */
export function TenderSidebarEntry({ wide, openCurrentWorkbench, t }: TenderSidebarEntryProps) {
  const [topMount, setTopMount] = useState<HTMLElement | null>(null)

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
  return createPortal(
    <div className={css.topEntry} data-dsh-plugin="tender-workbench" data-dsh-part="top-entry">
      <button
        type="button"
        className={wide ? css.sidebarButton : `${css.sidebarButton} ${css.sidebarRail}`}
        aria-label={t('sidebar.aria')}
        onClick={openCurrentWorkbench}
      >
        <IconGoalOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('sidebar.label')}</span>}
      </button>
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
