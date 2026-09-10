import { useSyncExternalStore } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconGoalOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { BetterSidebarService, TabComponentProps } from 'dsh-better-sidebar/client/service'
import type { TenderClientContext } from './client-context.ts'
import type { TenderTranslate } from './fields/field-props.ts'
import {
  TenderHeroTitleBridge,
  TenderSessionHeaderEntry,
  TenderSidebarEntry,
  type TenderHeaderEntryInjected,
  type TenderSidebarEntryInjected,
  type TenderHeroInjected,
} from './TenderEntry.tsx'
import { TenderPromptEntry, type TenderPromptInjected } from './TenderPrompt.tsx'
import { initialTenderPrompt, type TenderPromptMemory } from './tender-prompt.ts'
import {
  createTenderWorkbenchRevealController,
  assertBetterSidebarContract,
  openTenderWorkbench,
  registerTenderWorkbenchTab,
} from './better-sidebar-adapter.ts'
import { sendSessionTenderWorkbenchIntent } from './intents/send-session-intent.ts'
import type { TenderSkillCatalogConnection } from './skill-catalog.ts'
import { en, zh, type TenderKey } from './locales.ts'
import { createTenderProjectionPort } from './tender-projection-port.ts'
import { installOrdinarySessionGuard } from './ordinary-session-guard.ts'
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
  type WorkbenchDestination,
} from './workbench/navigation-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tender workbench, entries, filters, and result copy. */
    tenderFilter: TenderKey
  }
}

const NS = 'tenderFilter'

/** Core conversation stays available while the optional workbench provider is absent. */
export const inject = [
  'slots', 'sessions', 'workspaces', 'conversation', 'uiConversation', 'locale', 'remote.skills',
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
  ctx.effect(() => ctx.uiConversation.events.register(tenderSearchDefinition), 'dsh-tender-workbench: search events')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tender-workbench: dictionaries')

  const sessions = ctx.get('sessions') as ISessions | undefined
  const locale = ctx.get('locale') as TenderClientContext['locale'] | undefined
  const skills = ctx.get('remote.skills') as TenderSkillCatalogConnection['skills'] | undefined
  if (sessions === undefined || locale === undefined || skills === undefined) {
    throw new Error('dsh-tender-workbench requires the public sessions, locale, and remote.skills services')
  }
  const connection: TenderSkillCatalogConnection = { skills }
  const t = locale.bind(NS)
  ctx.inject(['uiWorkspace'], scope => {
    scope.effect(() => installOrdinarySessionGuard(sessions, ctx.workspaces, scope.uiWorkspace), 'dsh-tender-workbench: ordinary Session reuse')
  })
  let sidebar: BetterSidebarService | undefined
  let reveal: ReturnType<typeof createTenderWorkbenchRevealController> | undefined
  const navigation = createTenderWorkbenchNavigationController()
  const projectionPort = createTenderProjectionPort(sessions)
  // Scoped to this Client lifetime, not shared between plugin sessions or clients.
  const promptMemory = new Map<SessionId, TenderPromptMemory>()
  let active = true
  const sendIntent: TenderWorkbenchTabProps['sendIntent'] = (sessionId, intent) => (
    sendSessionTenderWorkbenchIntent(sessions, connection, sessionId, intent)
  )
  const openSession = (sessionId: SessionId, phase?: WorkbenchDestination): boolean => {
    if (!active || sidebar === undefined || reveal === undefined) return false
    const summary = sessions.list.getSnapshot().byId[sessionId]
    const opened = openTenderWorkbench(
      sidebar,
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
      // The menu enters the landing page only. Create/reveal the workbench
      // on an explicit shortcut (or header recovery) action, never on entry.
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

  // A dependency-scoped child follows provider arrival/removal, without taking
  // down the conversation entry, prompts, or supported Host tools.
  ctx.inject(['betterSidebar'], providerContext => {
    const service = providerContext.betterSidebar
    try { assertBetterSidebarContract(service) } catch { return }
    const controller = createTenderWorkbenchRevealController(service)
    sidebar = service
    reveal = controller
    providerContext.effect(() => () => {
      controller.dispose()
      if (sidebar === service) { sidebar = undefined; reveal = undefined }
    }, 'dsh-tender-workbench: provider subscription lifetime')
    providerContext.effect(() => registerTenderWorkbenchTab(
      service,
      props => (
        <RegisteredTenderWorkbenchTab
          {...props}
          locale={locale}
          sendIntent={sendIntent}
          t={t}
          projectionPort={projectionPort}
          reveal={controller}
          navigation={navigation}
        />
      ),
      () => t('sidebar.label'),
      size => <IconGoalOutline16 size={size} />,
    ), 'dsh-tender-workbench: Better Sidebar tab')
  })

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-tender-workbench:hero-title',
    order: 120,
    locale: NS,
    inject: (sessionId): TenderHeroInjected => ({ openPhase: phase => openSession(sessionId, phase) }),
  }, TenderHeroTitleBridge))

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'dsh-tender-workbench:prompt',
    order: 120,
    inject: (sessionId): TenderPromptInjected => {
      let memory = promptMemory.get(sessionId)
      if (!memory) { memory = { draft: initialTenderPrompt() }; promptMemory.set(sessionId, memory) }
      const input = () => {
        const scoped = sessions.scope(sessionId)
        if (!scoped) throw new Error('Tender Session unavailable')
        return ctx.conversation.input.for(scoped)
      }
      return { memory, draftPort: {
        read: () => input().state.getSnapshot().draft,
        write: value => { input().setDraft(value) },
      } }
    },
  }, TenderPromptEntry))

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

  ctx.effect(() => () => {
    active = false
    reveal?.dispose()
    navigation.dispose()
    promptMemory.clear()
  }, 'dsh-tender-workbench: Session entry lifetime')
}
