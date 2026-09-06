import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { IconGoalOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import theme from '../qcc-theme.module.css'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import type { TenderWorkbenchIntentV2 } from '../../contracts/intents.ts'
import type { TenderWorkflowProjectionV2 } from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  fetchArtifactRows,
  fetchClassifiedArtifactRows,
  fetchReviewArtifactRows,
  fetchReportDeliveryView,
  fetchRuleArtifactContent,
  downloadArtifact,
} from '../artifact-api.ts'
import type { TenderWorkbenchRevealController } from '../better-sidebar-adapter.ts'
import { useTenderWorkbenchReveal } from '../better-sidebar-adapter.ts'
import { createTenderQueryIntent, type TenderQueryDraft } from '../intents/query-intent.ts'
import { createContinueScreeningIntent, createRequestAnalysisIntent } from '../intents/screening-intent.ts'
import { createInitialTenderFilters, type TenderFilters } from '../types.ts'
import { validateTenderFilters, type TenderValidationErrors } from '../validation.ts'
import {
  useTenderProjection,
  type TenderProjectionPort,
  type TenderProjectionRead,
} from '../tender-projection-port.ts'
import {
  TENDER_WORKBENCH_PHASES,
  tenderWorkbenchPhaseForStage,
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
import { useSessionWriteFlight } from './session-write-flight.ts'
import {
  SessionWriteButtonLabel,
  SessionWriteProgress,
  sessionWriteProgressText,
} from './SessionWriteProgress.tsx'
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
import {
  TenderAnalysisView,
  TenderReviewView,
  type ReviewRowsLoader,
} from './TenderAnalysisReviewViews.tsx'
import { TenderReportView, type ReportArtifactDownloader, type ReportDeliveryViewLoader } from './TenderReportView.tsx'
import { StatePanel } from './WorkbenchPrimitives.tsx'
import { TenderQueryWorkspace } from './TenderQueryWorkspace.tsx'
import css from './tender-workbench.module.css'

export { tenderWorkbenchDisplayStatus }
export type { TenderWorkbenchDisplayStatus }

function projectionOf(read: TenderProjectionRead): TenderWorkflowProjectionV2 | undefined {
  return read.status === 'ready' ? read.projection : undefined
}

function validationMessageKey(errors: TenderValidationErrors): Parameters<TenderTranslate>[0] {
  if (errors.dates === 'required') return 'error.customDateRequired'
  if (errors.dates === 'order') return 'error.dateOrder'
  if (errors.amount === 'invalid') return 'error.amountInvalid'
  if (errors.amount === 'order') return 'error.amountOrder'
  if (errors.keywords !== undefined) return 'error.keywordLimit'
  if (errors.regions === 'limit') return 'error.regionLimit'
  if (errors.regions === 'unsupported') return 'error.regionUnsupported'
  if (errors.supported !== undefined) return 'error.noSupportedFilter'
  return 'error.request'
}

export interface TenderWorkbenchViewProps {
  readonly sessionId: SessionId
  readonly projection: TenderProjectionRead
  readonly navigation: TenderWorkbenchNavigationController
  readonly sendIntent: (intent: TenderWorkbenchIntentV2) => Promise<void>
  readonly createIntentId?: () => string
  readonly loadRows?: TenderRowsLoader
  readonly loadRuleContent?: RuleContentLoader
  readonly loadClassifiedRows?: ClassifiedRowsLoader
  readonly loadReviewRows?: ReviewRowsLoader
  readonly loadReportView?: ReportDeliveryViewLoader
  readonly downloadReport?: ReportArtifactDownloader
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
const defaultReviewRowsLoader: ReviewRowsLoader = (sessionId, artifact, filter, signal) => fetchReviewArtifactRows(
  globalThis.fetch.bind(globalThis), sessionId, artifact, filter, signal,
)
const defaultReportViewLoader: ReportDeliveryViewLoader = (sessionId, artifact, signal) => fetchReportDeliveryView(
  globalThis.fetch.bind(globalThis), sessionId, artifact, signal,
)
const defaultReportDownloader: ReportArtifactDownloader = (sessionId, artifact) => downloadArtifact(
  globalThis.fetch.bind(globalThis), sessionId, artifact,
)

type WorkbenchIconName = WorkbenchPhaseIcon | 'briefcase' | 'check' | 'clock' | 'warning'

export function WorkbenchIcon({ name }: { readonly name: WorkbenchIconName }) {
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

/** S1-S5 workbench: persistent business facts with local, disposable view state. */
export function TenderWorkbenchView({
  sessionId,
  projection,
  navigation,
  sendIntent,
  createIntentId = () => globalThis.crypto.randomUUID(),
  loadRows = defaultRowsLoader,
  loadRuleContent = defaultRuleContentLoader,
  loadClassifiedRows = defaultClassifiedRowsLoader,
  loadReviewRows = defaultReviewRowsLoader,
  loadReportView = defaultReportViewLoader,
  downloadReport = defaultReportDownloader,
  t,
}: TenderWorkbenchViewProps) {
  const workflow = projectionOf(projection)
  const [selectedPhase, setSelectedPhase] = useState<WorkbenchPhase>('opportunity')
  const [scope, setScope] = useState<TenderQueryDraft['scope']>('combined')
  const [target, setTarget] = useState('')
  const [filters, setFilters] = useState<TenderFilters>(() => createInitialTenderFilters())
  const [queryBranch, setQueryBranch] = useState<'tender' | 'proposed'>('tender')
  const [validationError, setValidationError] = useState<string>()
  const [validationField, setValidationField] = useState<'target' | 'keywords' | 'branch'>()
  const [opportunityView, setOpportunityView] = useState<'form' | 'overview' | 'details'>('overview')
  const [screeningView, setScreeningView] = useState<'rules' | 'classification' | 'analysis'>('rules')
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null)
  const phaseTabs = useRef<Partial<Record<WorkbenchPhase, HTMLButtonElement | null>>>({})
  const screeningTabs = useRef<Partial<Record<'rules' | 'classification' | 'analysis', HTMLButtonElement | null>>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const navigationId = useId()
  const screeningNavigationId = useId()
  const queryFormId = useId()
  const queryErrorId = useId()
  const queryDisabledReasonId = useId()
  useTenderWorkbenchNavigation(navigation, sessionId, setSelectedPhase)
  const write = useSessionWriteFlight({ sessionId, workflow, sendIntent, createIntentId })
  const writeStage: PendingTenderIntent['stage'] = write.state.action === 'query.run'
    ? 'query'
    : write.state.action === 'rules.confirm'
      ? 'classification'
      : write.state.action === 'analysis.run'
        ? 'analysis'
        : write.state.action === 'review.apply' || write.state.action === 'review.revert'
          ? 'review'
          : write.state.action === 'report.create' || write.state.action === 'report.retry'
            ? 'report'
          : 'rules'
  const writePending = write.state.action === undefined || !write.busy
    ? undefined
    : { intentId: write.state.intentId ?? '', revision: workflow?.revision ?? 0, stage: writeStage }
  const status = tenderWorkbenchDisplayStatus(
    projection,
    writePending,
    write.state.phase === 'failed',
  )
  const capabilityAvailable = projection.status === 'empty' || projection.status === 'ready'
  const queryCompleted = hasCompletedLightweightQuery(workflow)
  const activeDataset = workflow?.query?.normalizedData
  useEffect(() => {
    if (
      write.state.action === 'query.run'
      && write.state.phase === 'succeeded'
      && workflow?.query?.normalizedData !== undefined
    ) setOpportunityView('overview')
  }, [workflow?.query?.normalizedData?.id, write.state.action, write.state.phase])
  const replacementRequired = activeDataset !== undefined
    || workflow?.rules !== undefined
    || workflow?.classification !== undefined
    || workflow?.analysis !== undefined
    || workflow?.review !== undefined
    || workflow?.report !== undefined
  const lightweightFailure = workflow?.stages.query.errorMessage
    ?? workflow?.stages.overview.errorMessage
  const selectedPhaseConfig = TENDER_WORKBENCH_PHASES.find(phase => phase.id === selectedPhase)
  const recommendedPhase = tenderWorkbenchPhaseForStage(workflow?.currentStage)
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
    setValidationField(undefined)
    const trimmedTarget = target.trim()
    if (trimmedTarget === '') {
      setValidationError(t('workbench.query.targetRequired'))
      setValidationField('target')
      return
    }
    for (const branch of scope === 'combined' ? ['tender', 'proposed'] as const : [scope] as const) {
      const errors = validateTenderFilters({ ...filters, searchMode: branch })
      if (Object.keys(errors).length > 0) {
        setQueryBranch(branch)
        setValidationError(t(validationMessageKey(errors)))
        setValidationField(errors.keywords === undefined ? 'branch' : 'keywords')
        return
      }
    }
    try {
      write.start('query.run', intentId => createTenderQueryIntent({
        scope,
        target: trimmedTarget,
        filters,
      }, intentId, workflow?.revision ?? 0))
    } catch {
      setValidationError(t('workbench.sendFailed'))
    }
  }
  const updateFilter = <K extends keyof TenderFilters>(key: K, value: TenderFilters[K]): void => {
    setFilters(current => ({ ...current, [key]: value }))
    setValidationError(undefined)
    setValidationField(undefined)
  }
  const requestRules = (): void => {
    if (activeDataset === undefined || workflow === undefined) return
    const started = write.start('rules.propose', intentId => createContinueScreeningIntent({
      intentId,
      activeDatasetRef: activeDataset.id,
      projectionRevision: workflow.revision,
    }))
    if (started) {
      setSelectedPhase('screening')
      setScreeningView('rules')
    }
  }
  const requestCandidateAnalysis = (): void => {
    const classification = workflow?.classification
    if (activeDataset === undefined || workflow === undefined || classification === undefined) return
    const started = write.start('analysis.run', intentId => createRequestAnalysisIntent({
      intentId,
      activeDatasetRef: activeDataset.id,
      classificationArtifactRef: classification.data.id,
      ruleSetVersion: classification.ruleSetVersion,
      projectionRevision: workflow.revision,
    }))
    if (started) setScreeningView('analysis')
  }

  useEffect(() => {
    if (workflow?.classification !== undefined) setScreeningView('classification')
  }, [workflow?.classification?.data.id])

  useEffect(() => {
    if (workflow?.analysis !== undefined) setScreeningView('analysis')
  }, [workflow?.analysis?.data?.id])

  useEffect(() => {
    if (workflow?.classification === undefined && screeningView !== 'rules') setScreeningView('rules')
  }, [screeningView, sessionId, workflow?.classification])

  useEffect(() => {
    if (workflow?.report?.finalSnapshotId !== undefined) setSelectedPhase('delivery')
  }, [workflow?.report?.finalSnapshotId])

  useEffect(() => {
    const body = bodyRef.current
    if (body !== null && typeof body.scrollTo === 'function') body.scrollTo({ top: 0, left: 0 })
  }, [opportunityView, screeningView, selectedPhase, sessionId])

  const queryDisabledReason = !capabilityAvailable
    ? t('workbench.query.disabled.capability')
    : write.busy
      ? t('workbench.write.busyReason', {
        action: sessionWriteProgressText(t, write.state) ?? t('workbench.query.disabled.running'),
      })
      : undefined

  const selectScreeningViewFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    view: 'rules' | 'classification' | 'analysis',
  ): void => {
    const views: readonly ('rules' | 'classification' | 'analysis')[] = workflow?.classification === undefined
      ? ['rules'] as const
      : ['rules', 'classification', 'analysis'] as const
    const currentIndex = views.indexOf(view)
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % views.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + views.length) % views.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = views.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const nextView = views[nextIndex]
    if (nextView === undefined) return
    setScreeningView(nextView)
    screeningTabs.current[nextView]?.focus()
  }

  return (
    <section
      className={`${theme.scope} ${css.shell}`}
      aria-label={t('workbench.title')}
      data-workbench-status={status}
      data-visual-shell="qcc-blue-v1.1"
    >
      <header className={css.header}>
        <div className={css.brandBlock}>
          <span className={css.brandIcon} aria-hidden="true"><IconGoalOutline16 size={22} /></span>
          <div className={css.brandCopy}>
            <div className={css.titleRow}>
              <h1 className={css.title}>{t('workbench.title')}</h1>
              <span className={css.liveDot} data-status={status} aria-hidden="true" />
            </div>
            <p className={css.subtitle}>{t('workbench.subtitle')}</p>
            <p className={css.subtitle}>会话 · {sessionId.slice(-8)}</p>
          </div>
        </div>
        <div className={css.headerMeta}>
          <span className={css.status} data-status={status}>
            <span aria-hidden="true" />
            {t(`workbench.status.${status}`)}
          </span>
        </div>
      </header>

      <nav className={css.stages} aria-label={t('workbench.phases')} role="tablist">
        {TENDER_WORKBENCH_PHASES.map(phase => {
          const progress = tenderWorkbenchPhaseProgress(workflow, phase.id)
          const selected = phase.id === selectedPhase
          const recommended = phase.id === recommendedPhase && phase.implemented
          return (
            <button
              key={phase.id}
              type="button"
              ref={(element) => { phaseTabs.current[phase.id] = element }}
              id={`${navigationId}-${phase.id}-tab`}
              role="tab"
              className={selected ? `${css.stage} ${css.stageSelected}` : css.stage}
              aria-label={t(phase.labelKey)}
              aria-describedby={`${navigationId}-${phase.id}-status`}
              aria-selected={selected}
              aria-current={recommended ? 'step' : undefined}
              aria-controls={`${navigationId}-${phase.id}-panel`}
              tabIndex={selected ? 0 : -1}
              data-phase-status={progress}
              data-phase-selected={selected ? 'true' : 'false'}
              data-phase-recommended={recommended ? 'true' : 'false'}
              onClick={() => { setSelectedPhase(phase.id) }}
              onKeyDown={(event) => { selectPhaseFromKeyboard(event, phase.id) }}
            >
              <span className={css.stageIcon} aria-hidden="true"><WorkbenchIcon name={phase.icon} /></span>
              <span className={css.stageCopy}>
                <strong>{t(phase.labelKey)}</strong>
                <small id={`${navigationId}-${phase.id}-status`}>{t(`workbench.phaseStatus.${progress}`)}</small>
              </span>
            </button>
          )
        })}
      </nav>

      <div ref={bodyRef} className={css.body}>
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
              onContinue={requestRules}
              write={write}
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
            <TenderQueryWorkspace
              formId={queryFormId}
              scope={scope}
              filters={filters}
              target={target}
              activeBranch={queryBranch}
              busy={write.busy}
              replacementRequired={replacementRequired}
              validationError={validationError}
              validationField={validationField}
              validationErrorId={queryErrorId}
              onScopeChange={(value) => { setScope(value); setValidationError(undefined); setValidationField(undefined) }}
              onFiltersChange={updateFilter}
              onTargetChange={(value) => { setTarget(value); setValidationError(undefined); setValidationField(undefined) }}
              onBranchChange={setQueryBranch}
              onSubmit={() => { void submit() }}
              t={t}
              feedback={(
                <div className={css.feedbackStack}>
                  <SessionWriteProgress t={t} write={write} />
                  {status === 'failed' && lightweightFailure !== undefined && <WorkbenchFeedback tone="error" title={t('workbench.status.failed')} role="alert">{lightweightFailure}</WorkbenchFeedback>}
                  {queryCompleted && <WorkbenchFeedback tone="success" title={t('workbench.query.completeTitle')} role="status">{t('workbench.query.complete')}</WorkbenchFeedback>}
                </div>
              )}
            />
          </section>
        )) : selectedPhase === 'screening' && workflow !== undefined && activeDataset !== undefined ? (
          <section
            className={css.stagePanel}
            id={`${navigationId}-screening-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-screening-tab`}
            tabIndex={0}
          >
            <div className={css.subNavigation} role="tablist" aria-label={t('workbench.screening.views')}>
                {(['rules', 'classification', 'analysis'] as const).map(view => {
                  const available = view === 'rules' || workflow.classification !== undefined
                  return (
                  <button
                    key={view}
                    ref={(element) => { screeningTabs.current[view] = element }}
                    id={`${screeningNavigationId}-${view}-tab`}
                    type="button"
                    role="tab"
                    aria-selected={screeningView === view}
                    aria-disabled={!available}
                    aria-controls={`${screeningNavigationId}-${view}-panel`}
                    tabIndex={screeningView === view ? 0 : -1}
                    disabled={!available}
                    onClick={() => { if (available) setScreeningView(view) }}
                    onKeyDown={(event) => { selectScreeningViewFromKeyboard(event, view) }}
                  >
                    {t(view === 'rules' ? 'workbench.rules.title' : view === 'classification' ? 'workbench.classification.title' : 'workbench.analysis.shortTitle')}
                  </button>
                  )
                })}
              </div>
            <div
              id={`${screeningNavigationId}-rules-panel`}
              role="tabpanel"
              aria-labelledby={`${screeningNavigationId}-rules-tab`}
              hidden={screeningView !== 'rules'}
            >
              <TenderRulesView
                key={`${sessionId}:${activeDataset.id}`}
                sessionId={sessionId}
                workflow={workflow}
                loadContent={loadRuleContent}
                write={write}
                onRequestProposal={requestRules}
                footerTarget={screeningView === 'rules' ? footerTarget : null}
                t={t}
              />
            </div>
            {workflow.classification !== undefined && (
              <div
                id={`${screeningNavigationId}-classification-panel`}
                role="tabpanel"
                aria-labelledby={`${screeningNavigationId}-classification-tab`}
                hidden={screeningView !== 'classification'}
              >
                <TenderClassificationView
                  key={`${sessionId}:${workflow.classification.data.id}`}
                  sessionId={sessionId}
                  workflow={workflow}
                  loadRows={loadClassifiedRows}
                  loadContent={loadRuleContent}
                  write={write}
                  onOpenAnalysis={requestCandidateAnalysis}
                  onOpenReview={() => { setSelectedPhase('decision') }}
                  footerTarget={screeningView === 'classification' ? footerTarget : null}
                  t={t}
                />
              </div>
            )}
            {workflow.classification !== undefined && (
              <div
                id={`${screeningNavigationId}-analysis-panel`}
                role="tabpanel"
                aria-labelledby={`${screeningNavigationId}-analysis-tab`}
                hidden={screeningView !== 'analysis'}
              >
                <TenderAnalysisView
                  key={`${sessionId}:${activeDataset.id}`}
                  sessionId={sessionId}
                  workflow={workflow}
                  loadRows={loadReviewRows}
                  write={write}
                  sendIntent={sendIntent}
                  createIntentId={createIntentId}
                  onRunAnalysis={requestCandidateAnalysis}
                  onOpenReview={() => { setSelectedPhase('decision') }}
                  footerTarget={screeningView === 'analysis' ? footerTarget : null}
                  t={t}
                />
              </div>
            )}
          </section>
        ) : selectedPhase === 'decision' && workflow !== undefined && activeDataset !== undefined ? (
          <section
            className={css.stagePanel}
            id={`${navigationId}-decision-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-decision-tab`}
            tabIndex={0}
          >
            <TenderReviewView
              key={`${sessionId}:${activeDataset.id}`}
              sessionId={sessionId}
              workflow={workflow}
              loadRows={loadReviewRows}
              loadRuleContent={loadRuleContent}
              write={write}
              onOpenReport={() => { setSelectedPhase('delivery') }}
              footerTarget={footerTarget}
              t={t}
            />
          </section>
        ) : selectedPhase === 'delivery' && workflow !== undefined && activeDataset !== undefined ? (
          <section
            className={css.stagePanel}
            id={`${navigationId}-delivery-panel`}
            role="tabpanel"
            aria-labelledby={`${navigationId}-delivery-tab`}
            tabIndex={0}
          >
            <TenderReportView
              sessionId={sessionId}
              workflow={workflow}
              write={write}
              loadView={loadReportView}
              download={downloadReport}
              footerTarget={footerTarget}
              t={t}
            />
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

      <footer className={css.footer} data-workbench-phase={selectedPhase}>
        <div className={css.footerPortal} ref={setFooterTarget}>
          {selectedPhase !== 'screening' && selectedPhase !== 'decision' && !(selectedPhase === 'delivery' && workflow !== undefined && activeDataset !== undefined && (workflow.review !== undefined || workflow.report !== undefined)) && <div className={css.footerCopy}>
            <span className={css.footerHint}>{t('workbench.footerHint')}</span>
            {selectedPhase === 'opportunity' && queryDisabledReason !== undefined && (
              <span id={queryDisabledReasonId} className={css.disabledReason}>{queryDisabledReason}</span>
            )}
          </div>}
        </div>
        {selectedPhase === 'opportunity' && (activeDataset === undefined || opportunityView === 'form') && (
          <button
            type="submit"
            form={queryFormId}
            className={css.primary}
            data-write-button="query"
            disabled={!capabilityAvailable || write.busy}
            aria-describedby={queryDisabledReason === undefined ? undefined : queryDisabledReasonId}
            aria-busy={write.state.action === 'query.run' && write.busy}
            title={queryDisabledReason}
          >
            <SessionWriteButtonLabel action="query.run" idle={t('workbench.query.submit')} t={t} write={write} />
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
  readonly sendIntent: (sessionId: SessionId, intent: TenderWorkbenchIntentV2) => Promise<void>
  readonly t: TenderTranslate
}

export function TenderWorkbenchTab(props: TenderWorkbenchTabProps) {
  useTenderWorkbenchReveal(props.reveal, props)
  const sessionId = props.scope.sessionId as SessionId
  const projection = useTenderProjection(props.projectionPort, sessionId, props.visible)
  return (
    <TenderWorkbenchView
      key={String(sessionId)}
      sessionId={sessionId}
      projection={projection}
      navigation={props.navigation}
      sendIntent={intent => props.sendIntent(sessionId, intent)}
      t={props.t}
    />
  )
}
