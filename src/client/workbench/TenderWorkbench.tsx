import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import type { TenderWorkflowProjectionV1 } from '../../contracts/workflow.ts'
import type { TenderQueryIntentV1 } from '../../contracts/query-schema.ts'
import type { TenderWorkbenchIntentV1 } from '../../contracts/screening-intents.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  fetchArtifactRows,
  fetchClassifiedArtifactRows,
  fetchRuleArtifactContent,
} from '../artifact-api.ts'
import type { TenderWorkbenchRevealController } from '../better-sidebar-adapter.ts'
import { useTenderWorkbenchReveal } from '../better-sidebar-adapter.ts'
import { createTenderQueryIntent } from '../intents/query-intent.ts'
import { createContinueScreeningIntent } from '../intents/screening-intent.ts'
import {
  useTenderProjection,
  type TenderProjectionPort,
  type TenderProjectionRead,
} from '../tender-projection-port.ts'
import {
  TENDER_WORKBENCH_PHASES,
  tenderWorkbenchPhaseProgress,
  useTenderWorkbenchNavigation,
  type WorkbenchPhaseIcon,
  type TenderWorkbenchNavigationController,
  type WorkbenchPhase,
} from './navigation-controller.ts'
import {
  hasCompletedLightweightQuery,
  tenderWorkbenchDisplayStatus,
  type PendingTenderIntent,
  type TenderWorkbenchDisplayStatus,
} from './workbench-status.ts'
import {
  TenderDataDetails,
  TenderDataOverview,
  type TenderRowsLoader,
} from './TenderDataViews.tsx'
import {
  TenderClassificationView,
  TenderRulesView,
  type ClassifiedRowsLoader,
  type RuleContentLoader,
} from './TenderScreeningViews.tsx'
import css from './tender-workbench.module.css'

export { tenderWorkbenchDisplayStatus }
export type { TenderWorkbenchDisplayStatus }

function projectionOf(read: TenderProjectionRead): TenderWorkflowProjectionV1 | undefined {
  return read.status === 'ready' ? read.projection : undefined
}

export interface TenderWorkbenchViewProps {
  readonly sessionId: SessionId
  readonly projection: TenderProjectionRead
  readonly navigation: TenderWorkbenchNavigationController
  readonly sendIntent: (intent: TenderWorkbenchIntentV1) => Promise<void>
  readonly createCommandId?: () => string
  readonly loadRows?: TenderRowsLoader
  readonly loadRuleContent?: RuleContentLoader
  readonly loadClassifiedRows?: ClassifiedRowsLoader
  readonly t: TenderTranslate
}

const defaultRowsLoader: TenderRowsLoader = (sessionId, artifact, filter, signal) => fetchArtifactRows(
  globalThis.fetch.bind(globalThis), sessionId, artifact, filter, signal,
)
const defaultRuleContentLoader: RuleContentLoader = (sessionId, artifact, signal) => fetchRuleArtifactContent(
  globalThis.fetch.bind(globalThis), sessionId, artifact, signal,
)
const defaultClassifiedRowsLoader: ClassifiedRowsLoader = (sessionId, artifact, filter, signal) => fetchClassifiedArtifactRows(
  globalThis.fetch.bind(globalThis), sessionId, artifact, filter, signal,
)

type WorkbenchIconName = WorkbenchPhaseIcon | 'briefcase' | 'check' | 'clock' | 'warning'

function WorkbenchIcon({ name }: { readonly name: WorkbenchIconName }) {
  const paths: Record<WorkbenchIconName, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
    screening: <><path d="M4 5h16l-6.5 7.2V18l-3 1.5v-7.3z" /><path d="M7 9h10" /></>,
    decision: <><circle cx="9" cy="8" r="3" /><path d="M4 19c.8-3.3 2.5-5 5-5 1.2 0 2.2.4 3 1" /><path d="m14 17 2 2 4-5" /></>,
    delivery: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 7V5h8v2M3 12h18M10 12v2h4v-2" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    warning: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v4M12 17h.01" /></>,
  }
  return (
    <svg className={css.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  )
}

interface WorkbenchFeedbackProps {
  readonly tone: 'notice' | 'progress' | 'success' | 'error'
  readonly title: string
  readonly children: ReactNode
  readonly role: 'alert' | 'status'
}

function WorkbenchFeedback({ tone, title, children, role }: WorkbenchFeedbackProps) {
  const icon: WorkbenchIconName = tone === 'success'
    ? 'check'
    : tone === 'error'
      ? 'warning'
      : 'clock'
  return (
    <div
      className={css.feedback}
      data-tone={tone}
      data-workbench-feedback={tone}
      role={role}
    >
      <span className={css.feedbackIcon} aria-hidden="true"><WorkbenchIcon name={icon} /></span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}

/** S3 vertical slice: S1a shell + S2 data + explicit screening/classification. */
export function TenderWorkbenchView({
  sessionId,
  projection,
  navigation,
  sendIntent,
  createCommandId = () => globalThis.crypto.randomUUID(),
  loadRows = defaultRowsLoader,
  loadRuleContent = defaultRuleContentLoader,
  loadClassifiedRows = defaultClassifiedRowsLoader,
  t,
}: TenderWorkbenchViewProps) {
  const workflow = projectionOf(projection)
  const [selectedPhase, setSelectedPhase] = useState<WorkbenchPhase>('opportunity')
  const [scope, setScope] = useState<TenderQueryIntentV1['scope']>('tender')
  const [target, setTarget] = useState('')
  const [keywords, setKeywords] = useState('')
  const [pending, setPending] = useState<PendingTenderIntent>()
  const [submitting, setSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string>()
  const [sendFailed, setSendFailed] = useState(false)
  const [opportunityView, setOpportunityView] = useState<'form' | 'overview' | 'details'>('overview')
  const [screeningView, setScreeningView] = useState<'rules' | 'classification'>('rules')
  const phaseTabs = useRef<Partial<Record<WorkbenchPhase, HTMLButtonElement | null>>>({})
  const proposalRequestKey = useRef<string>()
  const navigationId = useId()
  const queryFormId = useId()
  useTenderWorkbenchNavigation(navigation, sessionId, setSelectedPhase)

  useEffect(() => {
    if (pending === undefined || workflow === undefined) return
    const pendingStage = pending.stage ?? 'query'
    const operationFailed = workflow.stages[pendingStage].status === 'failed'
    const completed = workflow.revision > pending.revision
    if (operationFailed || completed) setPending(undefined)
    if (pendingStage === 'query' && completed && !operationFailed && workflow.query?.normalizedData !== undefined) setOpportunityView('overview')
  }, [pending, workflow])

  const status = tenderWorkbenchDisplayStatus(projection, pending, sendFailed)
  const capabilityAvailable = projection.status === 'empty' || projection.status === 'ready'
  const queryCompleted = hasCompletedLightweightQuery(workflow)
  const activeDataset = workflow?.query?.normalizedData
  useEffect(() => {
    proposalRequestKey.current = undefined
  }, [activeDataset?.id, sessionId, workflow?.revision])
  const replacementRequired = activeDataset !== undefined
    || workflow?.rules !== undefined
    || workflow?.classification !== undefined
    || workflow?.analysis !== undefined
    || workflow?.review !== undefined
    || workflow?.report !== undefined
  const lightweightFailure = workflow?.stages.query.errorMessage
    ?? workflow?.stages.overview.errorMessage
  const selectedPhaseConfig = TENDER_WORKBENCH_PHASES.find(phase => phase.id === selectedPhase)
  const selectPhaseFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    phase: WorkbenchPhase,
  ): void => {
    const currentIndex = TENDER_WORKBENCH_PHASES.findIndex(candidate => candidate.id === phase)
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % TENDER_WORKBENCH_PHASES.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + TENDER_WORKBENCH_PHASES.length) % TENDER_WORKBENCH_PHASES.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = TENDER_WORKBENCH_PHASES.length - 1
    }
    if (nextIndex === undefined) return
    event.preventDefault()
    const nextPhase = TENDER_WORKBENCH_PHASES[nextIndex]?.id
    if (nextPhase === undefined) return
    setSelectedPhase(nextPhase)
    phaseTabs.current[nextPhase]?.focus()
  }
  const submit = async (): Promise<void> => {
    setValidationError(undefined)
    setSendFailed(false)
    const trimmedTarget = target.trim()
    const keywordCount = keywords.split(/[\s,，、]+/u).filter(Boolean).length
    if (trimmedTarget === '') {
      setValidationError(t('workbench.query.targetRequired'))
      return
    }
    if (keywordCount > 10) {
      setValidationError(t('error.keywordLimit'))
      return
    }
    setSubmitting(true)
    try {
      const intent = createTenderQueryIntent({ scope, target: trimmedTarget, keywords }, createCommandId())
      await sendIntent(intent)
      setPending({ commandId: intent.commandId, revision: workflow?.revision ?? 0, stage: 'query' })
    } catch {
      setSendFailed(true)
    } finally {
      setSubmitting(false)
    }
  }
  const requestRules = async (): Promise<void> => {
    if (activeDataset === undefined || workflow === undefined) return
    const requestKey = `${String(sessionId)}:${activeDataset.id}:${workflow.revision}`
    if (proposalRequestKey.current === requestKey) return
    proposalRequestKey.current = requestKey
    setSelectedPhase('screening')
    setScreeningView('rules')
    setSendFailed(false)
    const intent = createContinueScreeningIntent({
      commandId: createCommandId(),
      activeDatasetRef: activeDataset.id,
      projectionRevision: workflow.revision,
    })
    setPending({ commandId: intent.commandId, revision: workflow.revision, stage: 'rules' })
    try {
      await sendIntent(intent)
    } catch {
      proposalRequestKey.current = undefined
      setPending(undefined)
      setSendFailed(true)
    }
  }

  useEffect(() => {
    if (workflow?.classification !== undefined) setScreeningView('classification')
  }, [workflow?.classification?.data.id])

  return (
    <section
      className={css.shell}
      aria-label={t('workbench.title')}
      data-workbench-status={status}
      data-visual-shell="s3"
    >
      <header className={css.header}>
        <div className={css.brandBlock}>
          <span className={css.brandIcon} aria-hidden="true"><WorkbenchIcon name="briefcase" /></span>
          <div className={css.brandCopy}>
            <div className={css.titleRow}>
              <h1 className={css.title}>{t('workbench.title')}</h1>
              <span className={css.liveDot} data-status={status} aria-hidden="true" />
            </div>
            <p className={css.subtitle}>{t('workbench.subtitle')}</p>
          </div>
        </div>
        <div className={css.headerMeta}>
          <span className={css.status} data-status={status}>
            <span aria-hidden="true" />
            {t(`workbench.status.${status}`)}
          </span>
          <span className={css.session} title={t('workbench.session', { sessionId })}>
            {t('workbench.session', { sessionId })}
          </span>
        </div>
      </header>

      <nav className={css.stages} aria-label={t('workbench.phases')} role="tablist">
        {TENDER_WORKBENCH_PHASES.map(phase => {
          const progress = tenderWorkbenchPhaseProgress(workflow, phase.id)
          const selected = phase.id === selectedPhase
          return (
            <button
              key={phase.id}
              type="button"
              ref={(element) => { phaseTabs.current[phase.id] = element }}
              id={`${navigationId}-${phase.id}-tab`}
              role="tab"
              className={selected ? `${css.stage} ${css.stageSelected}` : css.stage}
              aria-label={t(phase.labelKey)}
              aria-selected={selected}
              aria-controls={`${navigationId}-${phase.id}-panel`}
              tabIndex={selected ? 0 : -1}
              data-phase-status={progress}
              onClick={() => { setSelectedPhase(phase.id) }}
              onKeyDown={(event) => { selectPhaseFromKeyboard(event, phase.id) }}
            >
              <span className={css.stageIcon} aria-hidden="true"><WorkbenchIcon name={phase.icon} /></span>
              <span className={css.stageCopy}>
                <strong>{t(phase.labelKey)}</strong>
                <small aria-hidden="true">{t(`workbench.phaseStatus.${progress}`)}</small>
              </span>
            </button>
          )
        })}
      </nav>

      <div className={css.body}>
        {(projection.status === 'unavailable' || projection.status === 'invalid') && (
          <WorkbenchFeedback tone="error" title={t('workbench.capability.title')} role="alert">
            {t(projection.status === 'invalid'
              ? 'workbench.capability.incompatible'
              : 'workbench.capability.missing')}
          </WorkbenchFeedback>
        )}

        {selectedPhase === 'opportunity' ? (workflow !== undefined && activeDataset !== undefined && opportunityView === 'details' ? (
          <section
            className={css.stagePanel}
            id={`${navigationId}-opportunity-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-opportunity-tab`}
            tabIndex={0}
          >
            <TenderDataDetails
              sessionId={sessionId}
              artifact={activeDataset}
              loadRows={loadRows}
              onBack={() => { setOpportunityView('overview') }}
              t={t}
            />
          </section>
        ) : workflow !== undefined && activeDataset !== undefined && opportunityView !== 'form' ? (
          <section
            className={css.stagePanel}
            id={`${navigationId}-opportunity-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-opportunity-tab`}
            tabIndex={0}
          >
            <TenderDataOverview
              workflow={workflow}
              onOpenDetails={() => { setOpportunityView('details') }}
              onRequery={() => { setOpportunityView('form') }}
              onContinue={() => { void requestRules() }}
              t={t}
            />
          </section>
        ) : (
          <section
            className={css.stagePanel}
            id={`${navigationId}-opportunity-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-opportunity-tab`}
            tabIndex={0}
          >
            <header className={css.pageHeading}>
              <div>
                <p className={css.eyebrow}>{t('workbench.query.eyebrow')}</p>
                <h2>{t('workbench.query.title')}</h2>
                <p>{t('workbench.query.description')}</p>
              </div>
              <div className={css.contextChips} aria-hidden="true">
                <span>{t('workbench.sessionChip')}</span>
                <span className={css.intentChip}>query.start</span>
              </div>
            </header>

            <form
              id={queryFormId}
              className={css.queryCard}
              aria-label={t('workbench.query.formTitle')}
              aria-busy={submitting || status === 'running'}
              onSubmit={(event) => { event.preventDefault(); void submit() }}
            >
              <div className={css.scopeSurface}>
                <div className={css.scopeCopy}>
                  <strong>{t('workbench.query.scope')}</strong>
                  <span>{t('workbench.query.scopeDescription')}</span>
                </div>
                <fieldset className={css.scopeGroup}>
                  <legend>{t('workbench.query.scope')}</legend>
                  {(['tender', 'proposed', 'combined'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={scope === value}
                      className={scope === value ? `${css.scopeButton} ${css.scopeSelected}` : css.scopeButton}
                      onClick={() => { setScope(value) }}
                    >{t(`workbench.query.scope.${value}`)}</button>
                  ))}
                </fieldset>
              </div>

              <div className={css.formSection}>
                <div className={css.formSectionHeading}>
                  <div>
                    <h3>{t('workbench.query.formTitle')}</h3>
                    <p>{t('workbench.query.formDescription')}</p>
                  </div>
                  <span>{t('workbench.query.editHint')}</span>
                </div>

                <label className={css.field}>
                  <span>{t('workbench.query.target')}</span>
                  <textarea
                    aria-label={t('workbench.query.target')}
                    rows={3}
                    maxLength={2_048}
                    value={target}
                    placeholder={t('workbench.query.targetPlaceholder')}
                    onChange={(event) => { setTarget(event.target.value); setValidationError(undefined) }}
                  />
                </label>

                <label className={css.field}>
                  <span>{t('field.keywords')}</span>
                  <input
                    aria-label={t('field.keywords')}
                    value={keywords}
                    placeholder={t('field.keywords.placeholder')}
                    onChange={(event) => { setKeywords(event.target.value); setValidationError(undefined) }}
                  />
                  <small>{t('workbench.query.keywordsHint')}</small>
                </label>

                {validationError !== undefined && <p className={css.fieldError} role="alert">{validationError}</p>}
              </div>

              <div className={css.feedbackStack}>
                {replacementRequired && (
                  <WorkbenchFeedback tone="notice" title={t('workbench.query.replacementTitle')} role="status">
                    {t('workbench.query.replacementWarning')}
                  </WorkbenchFeedback>
                )}
                {sendFailed && (
                  <WorkbenchFeedback tone="error" title={t('workbench.status.failed')} role="alert">
                    {t('workbench.sendFailed')}
                  </WorkbenchFeedback>
                )}
                {status === 'waiting-agent' && (
                  <WorkbenchFeedback tone="notice" title={t('workbench.status.waiting-agent')} role="status">
                    {t('workbench.waitingAgent')}
                  </WorkbenchFeedback>
                )}
                {status === 'running' && (
                  <WorkbenchFeedback tone="progress" title={t('workbench.status.running')} role="status">
                    {t('workbench.running')}
                  </WorkbenchFeedback>
                )}
                {status === 'failed' && lightweightFailure !== undefined && (
                  <WorkbenchFeedback tone="error" title={t('workbench.status.failed')} role="alert">
                    {lightweightFailure}
                  </WorkbenchFeedback>
                )}
                {queryCompleted && (
                  <WorkbenchFeedback tone="success" title={t('workbench.query.completeTitle')} role="status">
                    {t('workbench.query.complete')}
                  </WorkbenchFeedback>
                )}
              </div>
            </form>
          </section>
        )) : selectedPhase === 'screening' && workflow !== undefined && activeDataset !== undefined ? (
          <section
            className={css.stagePanel}
            id={`${navigationId}-screening-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-screening-tab`}
            tabIndex={0}
          >
            {workflow.classification !== undefined && (
              <div className={css.subNavigation} role="tablist" aria-label={t('workbench.screening.views')}>
                <button type="button" role="tab" aria-selected={screeningView === 'rules'} onClick={() => { setScreeningView('rules') }}>{t('workbench.rules.title')}</button>
                <button type="button" role="tab" aria-selected={screeningView === 'classification'} onClick={() => { setScreeningView('classification') }}>{t('workbench.classification.title')}</button>
              </div>
            )}
            {screeningView === 'classification' && workflow.classification !== undefined ? (
              <TenderClassificationView
                key={`${sessionId}:${workflow.classification.data.id}`}
                sessionId={sessionId}
                workflow={workflow}
                loadRows={loadClassifiedRows}
                loadContent={loadRuleContent}
                t={t}
              />
            ) : (
              <TenderRulesView
                key={`${sessionId}:${activeDataset.id}`}
                sessionId={sessionId}
                workflow={workflow}
                loadContent={loadRuleContent}
                sendIntent={sendIntent}
                createCommandId={createCommandId}
                proposalPending={pending?.stage === 'rules'}
                proposalFailed={sendFailed}
                onRequestProposal={() => { void requestRules() }}
                t={t}
              />
            )}
          </section>
        ) : (
          <section
            className={css.stagePanel}
            id={`${navigationId}-${selectedPhase}-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-${selectedPhase}-tab`}
            tabIndex={0}
          >
            <header className={css.pageHeading}>
              <div>
                <p className={css.eyebrow}>{t('workbench.phase.workspace')}</p>
                <h2>{t(selectedPhaseConfig?.labelKey ?? 'workbench.phase.opportunity')}</h2>
                <p>{t('workbench.phase.empty')}</p>
              </div>
              <span className={css.stageState} data-phase-status={tenderWorkbenchPhaseProgress(workflow, selectedPhase)}>
                {t(`workbench.phaseStatus.${tenderWorkbenchPhaseProgress(workflow, selectedPhase)}`)}
              </span>
            </header>
            <div className={css.emptyState}>
              <span className={css.emptyIcon} aria-hidden="true">
                <WorkbenchIcon name={selectedPhaseConfig?.icon ?? 'search'} />
              </span>
              <h3>{t('workbench.phase.emptyTitle')}</h3>
              <p>{t('workbench.stage.empty')}</p>
            </div>
          </section>
        )}
      </div>

      <footer className={css.footer}>
        <span className={css.footerHint}>{t('workbench.footerHint')}</span>
        {selectedPhase === 'opportunity' && (activeDataset === undefined || opportunityView === 'form') && (
          <button
            type="submit"
            form={queryFormId}
            className={css.primary}
            disabled={!capabilityAvailable || submitting || status === 'running'}
          >
            <span>{submitting ? t('workbench.sending') : t('workbench.query.submit')}</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
      </footer>
    </section>
  )
}

export interface TenderWorkbenchTabProps extends TabComponentProps {
  readonly projectionPort: TenderProjectionPort
  readonly reveal: TenderWorkbenchRevealController
  readonly navigation: TenderWorkbenchNavigationController
  readonly sendIntent: (sessionId: SessionId, intent: TenderWorkbenchIntentV1) => Promise<void>
  readonly t: TenderTranslate
}

export function TenderWorkbenchTab(props: TenderWorkbenchTabProps) {
  useTenderWorkbenchReveal(props.reveal, props)
  const sessionId = props.scope.sessionId as SessionId
  const projection = useTenderProjection(props.projectionPort, sessionId, props.visible)
  return (
    <TenderWorkbenchView
      sessionId={sessionId}
      projection={projection}
      navigation={props.navigation}
      sendIntent={intent => props.sendIntent(sessionId, intent)}
      t={props.t}
    />
  )
}
