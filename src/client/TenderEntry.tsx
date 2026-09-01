import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TenderTranslate } from './fields/field-props.ts'
import { readTenderProjectionSnapshot } from './tender-projection-port.ts'
import { tenderWorkbenchDisplayStatus } from './workbench/workbench-status.ts'
import css from './workbench-entry.module.css'

export interface TenderEntryInjected {
  openWorkbench(): boolean
}

export interface TenderEntryViewProps extends TenderEntryInjected {
  readonly t: TenderTranslate
}

/** Current-Session composer shortcut; the form itself lives in the shared workbench Tab. */
export function TenderEntryView({ openWorkbench, t }: TenderEntryViewProps) {
  return (
    <div className={css.inputEntry} data-dsh-plugin="tender-workbench" data-dsh-part="input-entry">
      <button type="button" className={css.inputButton} onClick={openWorkbench}>
        <IconSearchOutline16 size={15} />
        <span>{t('trigger.label')}</span>
      </button>
    </div>
  )
}

export type TenderEntryProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<TenderEntryInjected>
  & PropsLocale<'tenderFilter'>

export function TenderEntry({ openWorkbench, t }: TenderEntryProps) {
  return <TenderEntryView openWorkbench={openWorkbench} t={t} />
}

export interface TenderSidebarEntryInjected {
  openCurrentWorkbench(): boolean
}

export type TenderSidebarEntryProps = PropsRuntime<'sidebar.footer.action'>
  & InjectFace<TenderSidebarEntryInjected>
  & PropsLocale<'tenderFilter'>

export function TenderSidebarEntry({ wide, openCurrentWorkbench, t }: TenderSidebarEntryProps) {
  return (
    <button
      type="button"
      className={wide ? css.sidebarButton : `${css.sidebarButton} ${css.sidebarRail}`}
      aria-label={t('sidebar.aria')}
      onClick={openCurrentWorkbench}
    >
      <IconSearchOutline16 size={wide ? 16 : 18} />
      {wide && <span>{t('sidebar.label')}</span>}
    </button>
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
