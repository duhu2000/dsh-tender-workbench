import { useSyncExternalStore } from 'react'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconGoalOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import type { TenderClientContext } from './client-context.ts'
import type { TenderTranslate } from './fields/field-props.ts'
import {
  TenderHeroBrandMark,
  TenderHeroTitleBridge,
  TenderSessionHeaderEntry,
  TenderSidebarEntry,
  type TenderHeaderEntryInjected,
  type TenderSidebarEntryInjected,
} from './TenderEntry.tsx'
import {
  createTenderWorkbenchRevealController,
  openTenderWorkbench,
  registerTenderWorkbenchTab,
} from './better-sidebar-adapter.ts'
import { sendSessionTenderWorkbenchIntent } from './intents/send-session-intent.ts'
import { en, zh, type TenderKey } from './locales.ts'
import { createTenderProjectionPort } from './tender-projection-port.ts'
import { tenderSearchDefinition } from './tender-search-definition.ts'
import {
  TenderSessionEntryError,
  createTenderEntrySession,
} from './tender-session-entry.ts'
import {
  TenderWorkbenchTab,
  type TenderWorkbenchTabProps,
} from './workbench/TenderWorkbench.tsx'
import {
  createTenderWorkbenchNavigationController,
  type WorkbenchPhase,
} from './workbench/navigation-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tender workbench, entries, legacy filters, and result copy. */
    tenderFilter: TenderKey
  }
}

const NS = 'tenderFilter'

/** Required public Client services; Better Sidebar is deliberately mandatory. */
export const inject = [
  'slots', 'sessions', 'workspaces', 'conversation', 'conversationEvents', 'locale', 'betterSidebar',
]

function RegisteredTenderWorkbenchTab({
  locale,
  sendIntent,
  t,
  projectionPort,
  reveal,
  navigation,
  ...props
}: TabComponentProps & {
  readonly locale: Pick<TenderClientContext['locale'], 'subscribe' | 'getSnapshot'>
  readonly sendIntent: TenderWorkbenchTabProps['sendIntent']
  readonly t: TenderTranslate
  readonly projectionPort: ReturnType<typeof createTenderProjectionPort>
  readonly reveal: ReturnType<typeof createTenderWorkbenchRevealController>
  readonly navigation: ReturnType<typeof createTenderWorkbenchNavigationController>
}) {
  useSyncExternalStore(
    listener => locale.subscribe(listener),
    () => locale.getSnapshot(),
    () => locale.getSnapshot(),
  )
  return (
    <TenderWorkbenchTab
      {...props}
      projectionPort={projectionPort}
      reveal={reveal}
      navigation={navigation}
      sendIntent={sendIntent}
      t={t}
    />
  )
}

/** Register the dedicated Session entry, workbench Tab, Hero brand, and Header recovery action. */
export function apply(ctx: TenderClientContext): void {
  ctx.conversationEvents.register(tenderSearchDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tender-workbench: dictionaries')

  const sessions = ctx.get('sessions') as ISessions | undefined
  const locale = ctx.get('locale') as TenderClientContext['locale'] | undefined
  if (sessions === undefined || locale === undefined) {
    throw new Error('dsh-tender-workbench requires the public sessions and locale services')
  }
  const t = locale.bind(NS)
  const reveal = createTenderWorkbenchRevealController()
  const navigation = createTenderWorkbenchNavigationController()
  const projectionPort = createTenderProjectionPort(sessions)
  let active = true
  const sendIntent: TenderWorkbenchTabProps['sendIntent'] = (sessionId, intent) => (
    sendSessionTenderWorkbenchIntent(sessions, sessionId, intent)
  )
  const openSession = (sessionId: SessionId, phase?: WorkbenchPhase): boolean => {
    const summary = sessions.list.getSnapshot().byId[sessionId]
    const opened = openTenderWorkbench(
      ctx.betterSidebar,
      { sessionId, ...(summary?.cwd === undefined ? {} : { cwd: summary.cwd }) },
      reveal,
    )
    if (opened && phase !== undefined) navigation.request(sessionId, phase)
    return opened
  }
  const startTenderSession = async (): Promise<void> => {
    try {
      const sessionId = await createTenderEntrySession(sessions, ctx.workspaces)
      if (!active) return
      sessions.open(sessionId)
      if (openSession(sessionId)) reveal.request(sessionId)
    } catch (error: unknown) {
      if (error instanceof TenderSessionEntryError) {
        const key = error.code === 'workspace-unavailable'
          ? 'sidebar.workspaceRequired'
          : error.code === 'create-unavailable'
            ? 'sidebar.createUnavailable'
            : 'sidebar.createFailed'
        throw new Error(t(key), { cause: error })
      }
      throw new Error(t('sidebar.createFailed'), { cause: error })
    }
  }

  ctx.effect(() => registerTenderWorkbenchTab(
    ctx.betterSidebar,
    props => (
      <RegisteredTenderWorkbenchTab
        {...props}
        locale={locale}
        sendIntent={sendIntent}
        t={t}
        projectionPort={projectionPort}
        reveal={reveal}
        navigation={navigation}
      />
    ),
    () => t('sidebar.label'),
    size => <IconGoalOutline16 size={size} />,
  ), 'dsh-tender-workbench: Better Sidebar tab')

  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    priority: -10,
  }, TenderHeroBrandMark))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-tender-workbench:hero-title',
    order: 120,
    locale: NS,
  }, TenderHeroTitleBridge))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-tender-workbench:sidebar',
    order: 40,
    locale: NS,
    inject: (): TenderSidebarEntryInjected => ({ startTenderSession }),
  }, TenderSidebarEntry))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'dsh-tender-workbench:reopen',
    order: 100,
    locale: NS,
    inject: (sessionId): TenderHeaderEntryInjected => ({
      openWorkbench: () => openSession(sessionId),
    }),
  }, TenderSessionHeaderEntry))

  ctx.effect(() => () => { active = false }, 'dsh-tender-workbench: Session entry lifetime')
}
