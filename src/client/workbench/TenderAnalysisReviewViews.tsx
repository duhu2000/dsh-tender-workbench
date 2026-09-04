import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconRefreshOutline14,
  IconSendOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  type ReviewRecordV1,
  type ReviewRowsFilterV1,
  type ReviewRowsPageV1,
} from '../../contracts/analysis-review.ts'
import type { TenderWorkbenchIntentV2 } from '../../contracts/intents.ts'
import type {
  ArtifactRefV1,
  TenderRuleV1,
  TenderWorkflowProjectionV2,
  UserDecision,
} from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  createAnalysisFollowUpIntent,
  createApplyReviewIntent,
  createRevertReviewIntent,
} from '../intents/screening-intent.ts'
import type { RuleContentLoader } from './TenderScreeningViews.tsx'
import type { SessionWriteFlight } from './session-write-flight.ts'
import { SessionWriteButtonLabel, SessionWriteProgress } from './SessionWriteProgress.tsx'
import {
  MetricCard,
  PageHeader,
  ProgressMeter,
  StatePanel,
  StatusPill,
  SurfaceHeader,
} from './WorkbenchPrimitives.tsx'
import css from './tender-workbench.module.css'

export type ReviewRowsLoader = (
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  filter: ReviewRowsFilterV1,
  signal?: AbortSignal,
) => Promise<ReviewRowsPageV1>

function currentRowsArtifact(workflow: TenderWorkflowProjectionV2): ArtifactRefV1 | undefined {
  return workflow.review?.data
    ?? workflow.analysis?.data
    ?? workflow.classification?.data
    ?? workflow.query?.normalizedData
}

function fieldStatus(row: ReviewRecordV1): 'normalized' | 'missing' | 'unparseable' {
  if (row.project.disclosure.unparseableFields.length > 0) return 'unparseable'
  if (row.project.disclosure.missingFields.length > 0) return 'missing'
  return 'normalized'
}

function visibleRegion(row: ReviewRecordV1, t: TenderTranslate): string {
  return (row.project.region.value ?? row.project.region.original) || t('workbench.data.value.missing')
}

function visibleProjectNumber(row: ReviewRecordV1): string | undefined {
  const value = row.project.projectNumber.value ?? row.project.projectNumber.original
  return value === '' ? undefined : value
}

function shanghaiCalendarDay(timestamp: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value)
  return Date.UTC(value('year'), value('month') - 1, value('day'))
}

export function reviewTimingLabel(row: ReviewRecordV1, t: TenderTranslate, now = Date.now()): string {
  if (row.project.source !== 'tender') {
    return (row.project.stage.value ?? row.project.stage.original) || t('workbench.data.value.missing')
  }
  const deadline = row.project.deadline
  const value = deadline?.value
  if (deadline === undefined || value === undefined || deadline.parseStatus !== 'normalized') return t('workbench.data.value.missing')
  if (deadline.precision === 'month') return t('workbench.review.timing.month', { value: value.slice(0, 7) })
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return t('workbench.data.value.missing')
  if (deadline.precision === 'date-time' && parsed < now) return t('workbench.review.timing.expired')
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value)
  const deadlineDay = deadline.precision === 'date' && dateMatch !== null
    ? Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
    : shanghaiCalendarDay(parsed)
  const remainingDays = Math.round((deadlineDay - shanghaiCalendarDay(now)) / (24 * 60 * 60 * 1_000))
  if (remainingDays < 0) return t('workbench.review.timing.expired')
  if (remainingDays === 0) return t('workbench.review.timing.today')
  return t('workbench.review.timing.remaining', { days: remainingDays })
}

const timingLabel = reviewTimingLabel

function useReviewRows(input: {
  readonly sessionId: SessionId
  readonly artifact: ArtifactRefV1 | undefined
  readonly filter: ReviewRowsFilterV1
  readonly loadRows: ReviewRowsLoader
}) {
  const { sessionId, artifact, filter, loadRows } = input
  const [data, setData] = useState<ReviewRowsPageV1>()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const filterKey = JSON.stringify(filter)
  useEffect(() => {
    if (artifact === undefined) {
      setData(undefined)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    setFailed(false)
    void loadRows(sessionId, artifact, filter, abort.signal).then((value) => {
      if (!abort.signal.aborted) setData(value)
    }, () => {
      if (!abort.signal.aborted) setFailed(true)
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false)
    })
    return () => { abort.abort() }
  }, [artifact?.id, filterKey, loadRows, retry, sessionId])
  return { data, loading, failed, retry: () => { setRetry(value => value + 1) } }
}

function AnalysisBoundary({ t }: { readonly t: TenderTranslate }) {
  return <StatePanel tone="neutral" title={t('workbench.analysis.boundaryTitle')} description={t('workbench.analysis.boundary')} />
}

function recommendationLabel(t: TenderTranslate, recommendation: string | undefined): string {
  return t(recommendation === undefined
    ? 'workbench.analysis.unanalyzed'
    : `workbench.analysis.recommendation.${recommendation}` as Parameters<TenderTranslate>[0])
}

function recommendationTone(recommendation: string | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (recommendation === 'priority-review') return 'success'
  if (recommendation === 'watch') return 'warning'
  if (recommendation === 'not-recommended') return 'danger'
  return 'neutral'
}

function decisionLabel(t: TenderTranslate, decision: UserDecision, source: 'tender' | 'proposed'): string {
  if (decision === 'confirmed-candidate') {
    return t(source === 'tender' ? 'workbench.review.confirmedTender' : 'workbench.review.confirmedProposed')
  }
  return t(`workbench.review.decision.${decision}`)
}

interface AnalysisViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV2
  readonly loadRows: ReviewRowsLoader
  readonly write: SessionWriteFlight
  readonly sendIntent: (intent: TenderWorkbenchIntentV2) => Promise<void>
  readonly createIntentId: () => string
  readonly onRunAnalysis: () => void
  readonly onOpenReview: () => void
  readonly footerTarget: HTMLElement | null
  readonly t: TenderTranslate
}

export function TenderAnalysisView({
  sessionId,
  workflow,
  loadRows,
  write,
  sendIntent,
  createIntentId,
  onRunAnalysis,
  onOpenReview,
  footerTarget,
  t,
}: AnalysisViewProps) {
  const artifact = currentRowsArtifact(workflow)
  const [page, setPage] = useState(1)
  const [source, setSource] = useState<ReviewRowsFilterV1['source']>()
  const [recommendation, setRecommendation] = useState<ReviewRowsFilterV1['recommendation']>()
  const [sort, setSort] = useState<ReviewRowsFilterV1['sort']>('recommendation')
  const [focusedId, setFocusedId] = useState<string>()
  const [question, setQuestion] = useState('')
  const [questionState, setQuestionState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const analysisDetailRef = useRef<HTMLElement>(null)
  const filter = useMemo<ReviewRowsFilterV1>(() => ({
    page,
    pageSize: 20,
    queue: 'analysis-eligible',
    sort,
    ...(source === undefined ? {} : { source }),
    ...(recommendation === undefined ? {} : { recommendation }),
  }), [page, recommendation, sort, source])
  const rows = useReviewRows({ sessionId, artifact, filter, loadRows })
  useEffect(() => {
    if (rows.data !== undefined && rows.data.page !== page) setPage(rows.data.page)
  }, [page, rows.data])
  const focused = rows.data?.rows.find(row => row.project.recordId === focusedId) ?? rows.data?.rows[0]
  const completed = workflow.analysis?.completed ?? 0
  const eligibleTotal = workflow.analysis?.eligibleTotal
    ?? (workflow.classification === undefined ? 0 : workflow.classification.include + workflow.classification.observe + workflow.classification.manualReview)
  const complete = workflow.stages.analysis.status === 'succeeded' && completed === eligibleTotal
  const maximumPage = Math.max(1, Math.ceil((rows.data?.total ?? 0) / 20))
  const focusRow = (recordId: string): void => {
    setFocusedId(recordId)
    setQuestion('')
    setQuestionState('idle')
    queueMicrotask(() => { analysisDetailRef.current?.focus() })
  }
  const askQuestion = async (): Promise<void> => {
    const active = workflow.query?.normalizedData
    const classification = workflow.classification
    const analysis = workflow.analysis
    const recommendationValue = focused?.recommendation
    if (active === undefined || classification === undefined || analysis === undefined
      || focused?.classification === undefined || recommendationValue === undefined || question.trim() === '') return
    let intent: TenderWorkbenchIntentV2
    try {
      intent = createAnalysisFollowUpIntent({
        intentId: createIntentId(),
        activeDatasetRef: active.id,
        classificationArtifactRef: classification.data.id,
        ruleSetVersion: classification.ruleSetVersion,
        analysisVersion: analysis.version,
        projectionRevision: workflow.revision,
        recordRef: focused.project.recordId,
        question: question.trim(),
      })
    } catch {
      setQuestionState('failed')
      return
    }
    setQuestionState('sending')
    try {
      await sendIntent(intent)
      setQuestion('')
      setQuestionState('sent')
    } catch {
      setQuestionState('failed')
    }
  }
  return (
    <section className={css.s4View} aria-label={t('workbench.analysis.title')}>
      <PageHeader
        eyebrow={t('workbench.analysis.eyebrow')}
        title={t('workbench.analysis.title')}
        description={t('workbench.analysis.description')}
        aside={<div className={css.analysisHeaderMeta}><StatusPill>{workflow.analysis?.version ?? t('workbench.analysis.notStarted')}</StatusPill><ProgressMeter value={completed} max={eligibleTotal} label={t('workbench.analysis.progressLabel')} /></div>}
      />
      <AnalysisBoundary t={t} />
      <div className={css.s4Summary}>
        <MetricCard label={t('workbench.analysis.priority')} value={workflow.analysis?.priorityReview ?? 0} detail={t('workbench.analysis.priorityDetail')} tone="success" />
        <MetricCard label={t('workbench.analysis.watch')} value={workflow.analysis?.watch ?? 0} detail={t('workbench.analysis.watchDetail')} tone="warning" />
        <MetricCard label={t('workbench.analysis.notRecommended')} value={workflow.analysis?.notRecommended ?? 0} detail={t('workbench.analysis.notRecommendedDetail')} tone="danger" />
        <MetricCard label={t('workbench.analysis.urgent')} value={workflow.analysis?.urgent ?? 0} detail={t('workbench.analysis.urgentDetail')} tone="warning" />
      </div>
      {workflow.stages.analysis.status === 'failed' && <StatePanel tone="danger" title={t('workbench.analysis.incompleteTitle')} description={workflow.stages.analysis.errorMessage ?? t('workbench.analysis.incompleteDescription', { completed, total: eligibleTotal })} action={<button type="button" className={css.secondary} disabled={write.busy} onClick={onRunAnalysis}><IconRefreshOutline14 size={14} />{t('workbench.analysis.resume')}</button>} />}
      {workflow.analysis === undefined && <StatePanel tone="brand" title={t('workbench.analysis.notStartedTitle')} description={t('workbench.analysis.notStartedDescription', { total: eligibleTotal })} />}
      <SessionWriteProgress t={t} write={write} />
      {rows.failed && <div className={css.dataError} role="alert"><span>{t('workbench.analysis.loadFailed')}</span><button type="button" onClick={rows.retry}>{t('workbench.data.retry')}</button></div>}
      {rows.data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.analysis.loading')}</p> : (
        <div className={css.analysisWorkspace} data-analysis-layout>
          <section className={css.queuePanel}>
            <SurfaceHeader title={t('workbench.analysis.queueTitle')} description={t('workbench.analysis.queueCount', { count: rows.data.total })} />
            <div className={css.analysisToolbar}>
              <select aria-label={t('workbench.analysis.filterRecommendation')} value={recommendation ?? ''} onChange={(event) => { setRecommendation(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof recommendation>); setPage(1); setFocusedId(undefined) }}><option value="">{t('workbench.analysis.recommendationAll')}</option><option value="priority-review">{t('workbench.analysis.recommendation.priority-review')}</option><option value="watch">{t('workbench.analysis.recommendation.watch')}</option><option value="not-recommended">{t('workbench.analysis.recommendation.not-recommended')}</option><option value="unanalyzed">{t('workbench.analysis.unanalyzed')}</option></select>
              <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={(event) => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); setPage(1); setFocusedId(undefined) }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
              <select aria-label={t('workbench.analysis.sort')} value={sort} onChange={(event) => { setSort(event.target.value as NonNullable<typeof sort>); setPage(1); setFocusedId(undefined) }}><option value="recommendation">{t('workbench.analysis.sort.recommendation')}</option><option value="timing">{t('workbench.analysis.sort.timing')}</option><option value="amount-desc">{t('workbench.analysis.sort.amount')}</option><option value="source-order">{t('workbench.analysis.sort.source')}</option></select>
            </div>
            {rows.loading && <div className={css.inlineLoading} role="status">{t('workbench.analysis.loading')}</div>}
            {rows.data.rows.length === 0 ? <div className={css.dataEmpty} role="status"><strong>{t('workbench.analysis.emptyTitle')}</strong><span>{t('workbench.analysis.emptyDescription')}</span></div> : <div className={css.opportunityList}>{rows.data.rows.map((row, index) => (
              <button key={row.project.recordId} type="button" className={focused?.project.recordId === row.project.recordId ? css.opportunitySelected : css.opportunityRow} aria-pressed={focused?.project.recordId === row.project.recordId} onClick={() => { focusRow(row.project.recordId) }}>
                <span className={css.rowRank}>{String((page - 1) * 20 + index + 1).padStart(2, '0')}</span>
                <span className={css.rowMain}><strong>{row.project.title}</strong><small>{visibleRegion(row, t)} · {row.project.amount.display} · {timingLabel(row, t)}</small><small>{row.classification === undefined ? '—' : t(`workbench.classification.${row.classification}`)} · {t(`workbench.data.status.${fieldStatus(row)}`)}</small></span>
                <span className={css.rowRecommendation} data-agent-recommendation={row.recommendation?.recommendation ?? 'unanalyzed'}><StatusPill tone={recommendationTone(row.recommendation?.recommendation)}>{recommendationLabel(t, row.recommendation?.recommendation)}</StatusPill></span>
              </button>
            ))}</div>}
            <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: rows.data.page, pages: maximumPage, total: rows.data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setFocusedId(undefined) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1); setFocusedId(undefined) }}>{t('workbench.data.next')}</button></div></footer>
          </section>
          {focused === undefined ? <aside className={css.analysisDetail}><StatePanel title={t('workbench.analysis.emptyTitle')} description={t('workbench.analysis.emptyDescription')} /></aside> : (
            <aside ref={analysisDetailRef} className={css.analysisDetail} tabIndex={-1} aria-label={t('workbench.analysis.detailTitle')}>
              <header className={css.analysisDetailHero}><div><h3>{focused.project.title}</h3><p>{t(`workbench.data.source.${focused.project.source}`)} · {visibleRegion(focused, t)} · {focused.project.amount.display} · {timingLabel(focused, t)}</p></div><span data-agent-recommendation={focused.recommendation?.recommendation ?? 'unanalyzed'}><StatusPill tone={recommendationTone(focused.recommendation?.recommendation)}>{recommendationLabel(t, focused.recommendation?.recommendation)}</StatusPill></span></header>
              {focused.recommendation === undefined ? <StatePanel title={t('workbench.analysis.unanalyzed')} description={t('workbench.analysis.unanalyzedDescription')} /> : <>
                <section className={css.analysisConclusion}><span>{t('workbench.analysis.conclusion')}</span><p>{focused.recommendation.reason}</p></section>
                <div className={css.analysisFactGrid}>
                  <div><span>{t('workbench.analysis.factQuery')}</span><strong>{focused.recommendation.evidence.length > 0 ? t('workbench.analysis.signal.bounded') : '—'}</strong><small>{t('workbench.analysis.signal.queryNote')}</small></div>
                  <div><span>{t('workbench.analysis.factTiming')}</span><strong>{timingLabel(focused, t)}</strong><small>{focused.project.source === 'tender' ? t('workbench.analysis.signal.deadlineNote') : t('workbench.analysis.signal.stageNote')}</small></div>
                  <div><span>{t('workbench.analysis.factAmount')}</span><strong>{focused.project.amount.display}</strong><small>{t(focused.project.source === 'tender' ? 'workbench.analysis.signal.tenderAmount' : 'workbench.analysis.signal.proposedAmount')}</small></div>
                  <div><span>{t('workbench.analysis.factDisclosure')}</span><strong>{t(`workbench.data.status.${fieldStatus(focused)}`)}</strong><small>{t('workbench.analysis.signal.disclosureNote')}</small></div>
                </div>
                <section className={css.detailSection}><div className={css.analysisSectionHeader}><h4>{t('workbench.analysis.evidence')}</h4><span>{t('workbench.analysis.evidenceCount', { count: focused.recommendation.evidence.length })}</span></div><div className={css.analysisEvidenceGrid}>{focused.recommendation.evidence.map(item => <article key={item.ref}><strong>{item.label}</strong><p>{item.value}</p>{item.limitation === undefined ? null : <small>{item.limitation}</small>}</article>)}</div></section>
                <section className={css.sourceExcerpt}><strong>{t('workbench.analysis.sourceExcerpt')}</strong><p>{t('workbench.analysis.sourceExcerptUnavailable')}</p></section>
                <div className={css.detailColumns}><section className={css.detailSection} data-analysis-risk><h4>{t('workbench.analysis.verification')}</h4><ul>{focused.recommendation.verificationItems.map(item => <li key={item}>{item}</li>)}</ul></section><section className={css.detailSection} data-analysis-verification><h4>{t('workbench.analysis.limitations')}</h4><ul>{focused.recommendation.limitations.map(item => <li key={item}>{item}</li>)}</ul></section></div>
                <div className={css.analysisBoundary}><IconWarningOutline16 size={16} /><span>{t('workbench.analysis.boundary')}</span></div>
                <form className={css.analysisQuestion} onSubmit={(event) => { event.preventDefault(); void askQuestion() }}><input aria-label={t('workbench.analysis.question')} value={question} maxLength={2048} placeholder={t('workbench.analysis.questionPlaceholder')} onChange={(event) => { setQuestion(event.target.value); setQuestionState('idle') }} /><button type="submit" className={css.secondary} disabled={write.busy || questionState === 'sending' || question.trim() === ''}><IconSendOutline16 size={15} />{t(questionState === 'sending' ? 'workbench.analysis.questionSending' : 'workbench.analysis.questionSubmit')}</button></form>
                {questionState === 'sent' && <p className={css.inlineSuccess} role="status">{t('workbench.analysis.questionSent')}</p>}
                {questionState === 'failed' && <p className={css.inlineError} role="alert">{t('workbench.analysis.questionFailed')}</p>}
              </>}
            </aside>
          )}
        </div>
      )}
      {footerTarget === null ? null : createPortal(<>
        <div className={css.footerCopy}><span className={css.footerHint}>{t(complete ? 'workbench.analysis.footerNote' : 'workbench.analysis.footerWaiting', { completed, total: eligibleTotal })}</span></div>
        <div className={css.footerActions}>
          {!complete && <button type="button" className={css.secondary} disabled={write.busy} onClick={onOpenReview}>{t('workbench.analysis.skip')}</button>}
          <button type="button" className={css.primary} disabled={write.busy} onClick={complete ? onOpenReview : onRunAnalysis}>{complete ? t('workbench.analysis.openReview') : <SessionWriteButtonLabel action="analysis.run" idle={t(workflow.analysis === undefined ? 'workbench.classification.openAnalysis' : 'workbench.analysis.resume')} t={t} write={write} />}</button>
        </div>
      </>, footerTarget)}
    </section>
  )
}

interface ReviewViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV2
  readonly loadRows: ReviewRowsLoader
  readonly loadRuleContent: RuleContentLoader
  readonly write: SessionWriteFlight
  readonly onOpenReport: () => void
  readonly footerTarget: HTMLElement | null
  readonly t: TenderTranslate
}

export function TenderReviewView({ sessionId, workflow, loadRows, loadRuleContent, write, onOpenReport, footerTarget, t }: ReviewViewProps) {
  const artifact = currentRowsArtifact(workflow)
  const tabId = useId()
  const [queue, setQueue] = useState<'pending' | 'reviewed'>(() => workflow.review?.pending === 0 ? 'reviewed' : 'pending')
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [classification, setClassification] = useState<ReviewRowsFilterV1['classification']>()
  const [recommendation, setRecommendation] = useState<ReviewRowsFilterV1['recommendation']>()
  const [decisionFilter, setDecisionFilter] = useState<ReviewRowsFilterV1['userDecision']>()
  const [deadlineStatus, setDeadlineStatus] = useState<ReviewRowsFilterV1['deadlineStatus']>()
  const [region, setRegion] = useState<string>()
  const [stage, setStage] = useState<string>()
  const [procurementMethod, setProcurementMethod] = useState<string>()
  const [procurementType, setProcurementType] = useState<string>()
  const [ruleId, setRuleId] = useState<string>()
  const [risk, setRisk] = useState<ReviewRowsFilterV1['risk']>()
  const [disclosure, setDisclosure] = useState<ReviewRowsFilterV1['disclosure']>()
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [sort, setSort] = useState<ReviewRowsFilterV1['sort']>('recommendation')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [batchNote, setBatchNote] = useState('')
  const [currentDecision, setCurrentDecision] = useState<UserDecision>('pending')
  const [currentNote, setCurrentNote] = useState('')
  const [focusedId, setFocusedId] = useState<string>()
  const [rules, setRules] = useState<readonly TenderRuleV1[]>([])
  const selectPageRef = useRef<HTMLInputElement>(null)
  const reviewDetailRef = useRef<HTMLElement>(null)
  const queueTabs = useRef<Array<HTMLButtonElement | null>>([])
  const previousPageIds = useRef<readonly string[]>([])
  const submitted = useRef<{ intentId: string, refs: readonly string[] }>()
  const queryRuleIds = useMemo(() => query.trim() === '' ? [] : rules
    .filter(rule => rule.name.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN')))
    .map(rule => rule.id), [query, rules])
  const filter = useMemo<ReviewRowsFilterV1>(() => ({
    page,
    pageSize: 20,
    queue,
    sort,
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(queryRuleIds.length === 0 ? {} : { queryRuleIds }),
    ...(classification === undefined ? {} : { classification }),
    ...(recommendation === undefined ? {} : { recommendation }),
    ...(queue !== 'reviewed' || decisionFilter === undefined ? {} : { userDecision: decisionFilter }),
    ...(deadlineStatus === undefined ? {} : { deadlineStatus }),
    ...(region === undefined ? {} : { region }),
    ...(stage === undefined ? {} : { stage }),
    ...(procurementMethod === undefined ? {} : { procurementMethod }),
    ...(procurementType === undefined ? {} : { procurementType }),
    ...(ruleId === undefined ? {} : { ruleId }),
    ...(risk === undefined ? {} : { risk }),
    ...(disclosure === undefined ? {} : { disclosure }),
    ...(amountMin === '' ? {} : { amountMinCny: Number(amountMin) * 10_000 }),
    ...(amountMax === '' ? {} : { amountMaxCny: Number(amountMax) * 10_000 }),
  }), [amountMax, amountMin, classification, deadlineStatus, decisionFilter, disclosure, page, procurementMethod, procurementType, query, queryRuleIds, queue, recommendation, region, risk, ruleId, sort, stage])
  const rows = useReviewRows({ sessionId, artifact, filter, loadRows })
  useEffect(() => {
    const confirmed = workflow.rules?.confirmed
    if (confirmed === undefined) return
    const abort = new AbortController()
    void loadRuleContent(sessionId, confirmed, abort.signal).then((content) => {
      if (!abort.signal.aborted && 'rules' in content && !('origin' in content)) setRules(content.rules)
    }, () => undefined)
    return () => { abort.abort() }
  }, [loadRuleContent, sessionId, workflow.rules?.confirmed?.id])
  useEffect(() => {
    if (rows.data === undefined) return
    if (rows.data.page !== page) setPage(rows.data.page)
    const currentIds = rows.data.rows.map(row => row.project.recordId)
    if (focusedId !== undefined && !currentIds.includes(focusedId)) {
      const oldIndex = previousPageIds.current.indexOf(focusedId)
      const next = currentIds[Math.min(Math.max(0, oldIndex), Math.max(0, currentIds.length - 1))]
      setFocusedId(next)
      if (next !== undefined) queueMicrotask(() => { reviewDetailRef.current?.focus() })
    }
    previousPageIds.current = currentIds
  }, [focusedId, page, rows.data])
  useEffect(() => {
    const mutation = submitted.current
    if (mutation === undefined || write.state.phase !== 'succeeded' || write.state.intentId !== mutation.intentId) return
    setSelected(previous => new Set([...previous].filter(recordId => !mutation.refs.includes(recordId))))
    submitted.current = undefined
  }, [write.state.intentId, write.state.phase])
  const binding = (intentId: string) => {
    const active = workflow.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    return {
      intentId,
      activeDatasetRef: active.id,
      ...(workflow.classification === undefined ? {} : {
        classificationArtifactRef: workflow.classification.data.id,
        ruleSetVersion: workflow.classification.ruleSetVersion,
      }),
      ...(workflow.analysis === undefined ? {} : { analysisVersion: workflow.analysis.version }),
      ...(workflow.review === undefined ? {} : { reviewArtifactRef: workflow.review.data.id }),
      reviewRevision: workflow.review?.revision ?? 0,
      projectionRevision: workflow.revision,
    }
  }
  const apply = (recordRefs: readonly string[], decision: UserDecision, note: string): void => {
    let intentId = ''
    const started = write.start('review.apply', value => {
      intentId = value
      return createApplyReviewIntent({ ...binding(value), recordRefs: [...recordRefs], decision, note })
    })
    if (started) submitted.current = { intentId, refs: recordRefs }
  }
  const revert = (): void => {
    const latestOperationRef = workflow.review?.latestOperationRef
    if (latestOperationRef === undefined) return
    write.start('review.revert', intentId => createRevertReviewIntent({ ...binding(intentId), latestOperationRef }))
  }
  const resetView = (): void => { setPage(1); setSelected(new Set()); setFocusedId(undefined) }
  const toggle = (recordId: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }
  const total = workflow.review === undefined ? workflow.query?.total ?? 0 : workflow.review.pending + workflow.review.confirmedCandidate + workflow.review.watch + workflow.review.exclude
  const pending = rows.data?.pending ?? workflow.review?.pending ?? total
  const reviewed = rows.data?.reviewed ?? total - pending
  const maximumPage = Math.max(1, Math.ceil((rows.data?.total ?? 0) / 20))
  const focused = rows.data?.rows.find(row => row.project.recordId === focusedId) ?? rows.data?.rows[0]
  const pageRecordIds = rows.data?.rows.map(row => row.project.recordId) ?? []
  const selectedOnPage = pageRecordIds.filter(recordId => selected.has(recordId)).length
  const allPageSelected = pageRecordIds.length > 0 && selectedOnPage === pageRecordIds.length
  const somePageSelected = selectedOnPage > 0 && !allPageSelected
  const togglePageSelection = (): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (allPageSelected) pageRecordIds.forEach(recordId => { next.delete(recordId) })
      else pageRecordIds.forEach(recordId => { next.add(recordId) })
      return next
    })
  }
  useEffect(() => {
    if (selectPageRef.current !== null) selectPageRef.current.indeterminate = somePageSelected
  }, [somePageSelected])
  useEffect(() => {
    setCurrentDecision(focused?.review.decision ?? 'pending')
    setCurrentNote(focused?.review.note ?? '')
  }, [focused?.project.recordId, focused?.review.decision, focused?.review.note])
  const currentDirty = focused !== undefined && (currentDecision !== focused.review.decision || currentNote !== focused.review.note)
  const ruleName = (value: string | undefined) => rules.find(rule => rule.id === value)?.name
  const switchQueue = (value: 'pending' | 'reviewed'): void => { setQueue(value); setDecisionFilter(undefined); resetView() }
  const queueKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % 2
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + 1) % 2
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === undefined) return
    event.preventDefault()
    const value = next === 0 ? 'pending' : 'reviewed'
    switchQueue(value)
    queueTabs.current[next]?.focus()
  }
  const audit = focused === undefined ? [] : rows.data?.audit.filter(entry => entry.recordRefs.includes(focused.project.recordId)) ?? []
  const projectNumber = focused === undefined ? undefined : visibleProjectNumber(focused)
  const clearFilter = (clear: () => void): void => { clear(); resetView() }
  const activeFilters: Array<{ readonly key: string, readonly label: string, readonly clear?: () => void }> = [{
    key: 'sort',
    label: t('workbench.review.activeFilter', {
      name: t('workbench.review.active.sort'),
      value: t(sort === 'recommendation' ? 'workbench.review.sort.recommendation' : sort === 'timing' ? 'workbench.review.sort.timing' : sort === 'amount-desc' ? 'workbench.review.sort.amountDesc' : sort === 'amount-asc' ? 'workbench.review.sort.amountAsc' : 'workbench.review.sort.source'),
    }),
  }]
  const addActiveFilter = (key: string, name: string, value: string, clear: () => void): void => {
    activeFilters.push({ key, label: t('workbench.review.activeFilter', { name, value }), clear })
  }
  if (query.trim() !== '') addActiveFilter('query', t('workbench.review.active.search'), query.trim(), () => { clearFilter(() => { setQuery('') }) })
  if (recommendation !== undefined) addActiveFilter('recommendation', t('workbench.review.active.recommendation'), recommendationLabel(t, recommendation === 'unanalyzed' ? undefined : recommendation), () => { clearFilter(() => { setRecommendation(undefined) }) })
  if (deadlineStatus !== undefined) addActiveFilter('deadline', t('workbench.review.active.deadline'), t(`workbench.review.deadline.${deadlineStatus}`), () => { clearFilter(() => { setDeadlineStatus(undefined) }) })
  if (region !== undefined) addActiveFilter('region', t('workbench.review.active.region'), region, () => { clearFilter(() => { setRegion(undefined) }) })
  if (queue === 'reviewed' && decisionFilter !== undefined) addActiveFilter('decision', t('workbench.review.active.decision'), decisionFilter === 'confirmed-candidate' ? t('workbench.review.confirmedMixed') : t(`workbench.review.decision.${decisionFilter}`), () => { clearFilter(() => { setDecisionFilter(undefined) }) })
  if (classification !== undefined) addActiveFilter('classification', t('workbench.review.active.classification'), t(`workbench.classification.${classification}`), () => { clearFilter(() => { setClassification(undefined) }) })
  if (stage !== undefined) addActiveFilter('stage', t('workbench.review.active.stage'), stage, () => { clearFilter(() => { setStage(undefined) }) })
  if (amountMin !== '' || amountMax !== '') addActiveFilter('amount', t('workbench.review.active.amount'), t('workbench.review.activeAmount', { min: amountMin || '0', max: amountMax || '∞' }), () => { clearFilter(() => { setAmountMin(''); setAmountMax('') }) })
  if (procurementMethod !== undefined) addActiveFilter('method', t('workbench.review.active.method'), procurementMethod, () => { clearFilter(() => { setProcurementMethod(undefined) }) })
  if (procurementType !== undefined) addActiveFilter('type', t('workbench.review.active.type'), procurementType, () => { clearFilter(() => { setProcurementType(undefined) }) })
  if (ruleId !== undefined) addActiveFilter('rule', t('workbench.review.active.rule'), ruleName(ruleId) ?? ruleId, () => { clearFilter(() => { setRuleId(undefined) }) })
  if (risk !== undefined) addActiveFilter('risk', t('workbench.review.active.risk'), t(risk === 'has-verification' ? 'workbench.review.riskVerification' : 'workbench.review.riskUrgent'), () => { clearFilter(() => { setRisk(undefined) }) })
  if (disclosure !== undefined) addActiveFilter('disclosure', t('workbench.review.active.disclosure'), t(disclosure === 'complete' ? 'workbench.data.status.normalized' : `workbench.data.status.${disclosure}`), () => { clearFilter(() => { setDisclosure(undefined) }) })
  return (
    <section className={css.s4View} aria-label={t('workbench.review.title')}>
      <PageHeader eyebrow={t('workbench.review.eyebrow')} title={t('workbench.review.title')} description={t('workbench.review.description')} aside={<ProgressMeter value={reviewed} max={total} label={t('workbench.review.progressLabel')} />} />
      <StatePanel tone="neutral" title={t('workbench.review.boundaryTitle')} description={t('workbench.review.boundary')} />
      <div className={`${css.s4Summary} ${css.reviewSummary}`}>
        <MetricCard label={t('workbench.review.candidates')} value={total} detail={t('workbench.review.candidatesDetail', { count: pending })} />
        <MetricCard label={t('workbench.review.confirmed')} value={workflow.review?.confirmedCandidate ?? 0} detail={t('workbench.review.confirmedDetail')} tone="success" />
        <MetricCard label={t('workbench.review.watch')} value={workflow.review?.watch ?? 0} detail={t('workbench.review.watchDetail')} tone="warning" />
        <MetricCard label={t('workbench.review.exclude')} value={workflow.review?.exclude ?? 0} detail={t('workbench.review.excludeDetail')} tone="danger" />
        <MetricCard label={t('workbench.review.agentSuggested')} value={workflow.analysis?.completed ?? 0} detail={t('workbench.review.agentSuggestedDetail')} tone="purple" />
      </div>
      {pending === 0 && <StatePanel tone="success" title={t('workbench.review.completeTitle')} description={t('workbench.review.completeDescription')} />}
      <SessionWriteProgress t={t} write={write} />
      <div className={css.reviewWorkspace}>
        <section className={css.queuePanel}>
          <SurfaceHeader title={t('workbench.review.queueTitle')} description={t('workbench.review.queueDescription')} action={<button type="button" className={css.secondary} disabled={write.busy || workflow.review?.canRevert !== true} onClick={revert}><IconRefreshOutline14 size={14} />{t('workbench.review.revert')}</button>} />
          <div className={css.reviewQueueTabs} role="tablist" aria-label={t('workbench.review.queueTabs')}>
            {(['pending', 'reviewed'] as const).map((value, index) => <button key={value} ref={element => { queueTabs.current[index] = element }} id={`${tabId}-${value}-tab`} type="button" role="tab" aria-selected={queue === value} aria-controls={`${tabId}-panel`} tabIndex={queue === value ? 0 : -1} onClick={() => { switchQueue(value) }} onKeyDown={event => { queueKeyDown(event, index) }}>{t(`workbench.review.queue.${value}`, { count: value === 'pending' ? pending : reviewed })}</button>)}
          </div>
          <div className={css.reviewToolbar}>
            <input type="search" aria-label={t('workbench.review.search')} value={query} placeholder={t('workbench.review.searchPlaceholder')} onChange={(event) => { setQuery(event.target.value); resetView() }} />
            <select aria-label={t('workbench.analysis.filterRecommendation')} value={recommendation ?? ''} onChange={(event) => { setRecommendation(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof recommendation>); resetView() }}><option value="">{t('workbench.analysis.recommendationAll')}</option><option value="priority-review">{t('workbench.analysis.recommendation.priority-review')}</option><option value="watch">{t('workbench.analysis.recommendation.watch')}</option><option value="not-recommended">{t('workbench.analysis.recommendation.not-recommended')}</option><option value="unanalyzed">{t('workbench.analysis.unanalyzed')}</option></select>
            <select aria-label={t('workbench.review.filterDeadline')} value={deadlineStatus ?? ''} onChange={(event) => { setDeadlineStatus(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof deadlineStatus>); resetView() }}><option value="">{t('workbench.review.deadlineAll')}</option><option value="urgent">{t('workbench.review.deadline.urgent')}</option><option value="active">{t('workbench.review.deadline.active')}</option><option value="expired">{t('workbench.review.deadline.expired')}</option><option value="missing">{t('workbench.review.deadline.missing')}</option></select>
            <select aria-label={t('workbench.review.filterRegion')} value={region ?? ''} onChange={(event) => { setRegion(event.target.value || undefined); resetView() }}><option value="">{t('workbench.review.regionAll')}</option>{rows.data?.facets.regions.map(value => <option key={value} value={value}>{value}</option>)}</select>
            <select aria-label={t('workbench.review.sort')} value={sort} onChange={(event) => { setSort(event.target.value as NonNullable<typeof sort>); resetView() }}><option value="recommendation">{t('workbench.review.sort.recommendation')}</option><option value="timing">{t('workbench.review.sort.timing')}</option><option value="amount-desc">{t('workbench.review.sort.amountDesc')}</option><option value="amount-asc">{t('workbench.review.sort.amountAsc')}</option><option value="source-order">{t('workbench.review.sort.source')}</option></select>
            {queue === 'reviewed' && <select aria-label={t('workbench.review.filterDecision')} value={decisionFilter ?? ''} onChange={(event) => { setDecisionFilter(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof decisionFilter>); resetView() }}><option value="">{t('workbench.review.decisionAll')}</option><option value="confirmed-candidate">{t('workbench.review.confirmedMixed')}</option><option value="watch">{t('workbench.review.decision.watch')}</option><option value="exclude">{t('workbench.review.decision.exclude')}</option></select>}
            <button type="button" className={css.secondary} aria-expanded={advancedOpen} onClick={() => { setAdvancedOpen(value => !value) }}>{t('workbench.review.advanced')}<IconChevronDownOutline14 size={14} className={advancedOpen ? css.expandedIcon : undefined} /></button>
          </div>
          <div className={css.reviewAdvanced} hidden={!advancedOpen}><div>
            <select aria-label={t('workbench.classification.filter')} value={classification ?? ''} onChange={(event) => { setClassification(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof classification>); resetView() }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
            <select aria-label={t('workbench.review.filterStage')} value={stage ?? ''} onChange={(event) => { setStage(event.target.value || undefined); resetView() }}><option value="">{t('workbench.review.stageAll')}</option>{rows.data?.facets.stages.map(value => <option key={value} value={value}>{value}</option>)}</select>
            <label><span>{t('workbench.review.amountRange')}</span><span className={css.amountFilter}><input type="number" min="0" value={amountMin} placeholder={t('workbench.review.amountMin')} onChange={event => { setAmountMin(event.target.value); resetView() }} /><i>–</i><input type="number" min="0" value={amountMax} placeholder={t('workbench.review.amountMax')} onChange={event => { setAmountMax(event.target.value); resetView() }} /><small>{t('workbench.review.amountUnit')}</small></span></label>
            <select aria-label={t('workbench.review.filterMethod')} value={procurementMethod ?? ''} onChange={(event) => { setProcurementMethod(event.target.value || undefined); resetView() }}><option value="">{t('workbench.review.methodAll')}</option>{rows.data?.facets.procurementMethods.map(value => <option key={value} value={value}>{value}</option>)}</select>
            <select aria-label={t('workbench.review.filterType')} value={procurementType ?? ''} onChange={(event) => { setProcurementType(event.target.value || undefined); resetView() }}><option value="">{t('workbench.review.typeAll')}</option>{rows.data?.facets.procurementTypes.map(value => <option key={value} value={value}>{value}</option>)}</select>
            <select aria-label={t('workbench.review.filterRule')} value={ruleId ?? ''} onChange={(event) => { setRuleId(event.target.value || undefined); resetView() }}><option value="">{t('workbench.review.ruleAll')}</option>{rows.data?.facets.ruleIds.map(value => <option key={value} value={value}>{ruleName(value) ?? value}</option>)}</select>
            <select aria-label={t('workbench.review.filterRisk')} value={risk ?? ''} onChange={(event) => { setRisk(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof risk>); resetView() }}><option value="">{t('workbench.review.riskAll')}</option><option value="has-verification">{t('workbench.review.riskVerification')}</option><option value="deadline-urgent">{t('workbench.review.riskUrgent')}</option></select>
            <select aria-label={t('workbench.review.filterDisclosure')} value={disclosure ?? ''} onChange={(event) => { setDisclosure(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof disclosure>); resetView() }}><option value="">{t('workbench.review.disclosureAll')}</option><option value="complete">{t('workbench.data.status.normalized')}</option><option value="missing">{t('workbench.data.status.missing')}</option><option value="unparseable">{t('workbench.data.status.unparseable')}</option></select>
          </div></div>
          <div className={css.activeFilterStrip} aria-label={t('workbench.review.activeFilters')}>{activeFilters.map(item => <span className={css.activeFilter} key={item.key}>{item.label}{item.clear === undefined ? null : <button type="button" aria-label={t('workbench.review.removeFilter', { name: item.label })} title={t('workbench.review.removeFilter', { name: item.label })} onClick={item.clear}><IconCloseOutline16 size={12} /></button>}</span>)}</div>
          <div className={css.reviewBulkBar}>
            <label className={css.reviewBulkSelection}><input ref={selectPageRef} type="checkbox" aria-label={t('workbench.review.selectPage')} aria-checked={somePageSelected ? 'mixed' : allPageSelected} checked={allPageSelected} onChange={togglePageSelection} /><strong>{t('workbench.review.selectedCount', { count: selected.size })}</strong></label>
            <div className={css.reviewBulkActions} role="group" aria-label={t('workbench.review.batchDecision')}>
              <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'confirmed-candidate', batchNote) }}>{t('workbench.review.batchSetConfirmed')}</button>
              <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'watch', batchNote) }}>{t('workbench.review.batchSetWatch')}</button>
              <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'exclude', batchNote) }}>{t('workbench.review.batchSetExclude')}</button>
              <button type="button" className={css.ghostButton} disabled={selected.size === 0} onClick={() => { setSelected(new Set()); setBatchNote('') }}>{t('workbench.review.clearSelection')}</button>
            </div>
            <span className={css.reviewBulkHint}>{t('workbench.review.batchUndoHint')}</span>
            {selected.size === 0 ? null : <label className={css.reviewBulkNote}><span>{t('workbench.review.batchNote')}</span><input disabled={write.busy} maxLength={2048} value={batchNote} placeholder={t('workbench.review.notePlaceholder')} onChange={(event) => { setBatchNote(event.target.value) }} /></label>}
          </div>
          {rows.failed && <div className={css.dataError} role="alert"><span>{t('workbench.review.loadFailed')}</span><button type="button" onClick={rows.retry}>{t('workbench.data.retry')}</button></div>}
          {rows.loading && <div className={css.inlineLoading} role="status">{t('workbench.review.loading')}</div>}
          {rows.data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.review.loading')}</p> : rows.data.rows.length === 0 ? <div className={css.dataEmpty} role="status"><strong>{t(queue === 'pending' && pending === 0 ? 'workbench.review.completeTitle' : 'workbench.review.emptyTitle')}</strong><span>{t(queue === 'pending' && pending === 0 ? 'workbench.review.completeDescription' : 'workbench.review.emptyDescription')}</span></div> : <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${queue}-tab`} className={css.dataTableWrap}><table className={`${css.dataTable} ${css.reviewTable}`}><thead><tr><th>{t('workbench.review.select')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.analysis.agentRecommendation')}</th><th>{t('workbench.analysis.classification')}</th><th>{t('workbench.review.deadlineStage')}</th><th>{t('workbench.review.verificationColumn')}</th><th>{t('workbench.review.userDecision')}</th></tr></thead><tbody>{rows.data.rows.map(row => <tr key={row.project.recordId} tabIndex={0} data-row-selected={focused?.project.recordId === row.project.recordId ? 'true' : 'false'} onClick={() => { setFocusedId(row.project.recordId) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFocusedId(row.project.recordId); queueMicrotask(() => { reviewDetailRef.current?.focus() }) } }}><td data-label={t('workbench.review.select')} onClick={event => { event.stopPropagation() }}><input type="checkbox" aria-label={t('workbench.review.selectRecord', { title: row.project.title })} checked={selected.has(row.project.recordId)} onChange={() => { toggle(row.project.recordId) }} /></td><td data-label={t('workbench.data.column.project')}><strong>{row.project.title}</strong><small>{visibleRegion(row, t)} · {row.project.amount.display} · {t(`workbench.data.source.${row.project.source}`)}</small></td><td data-label={t('workbench.analysis.agentRecommendation')}><span data-agent-recommendation={row.recommendation?.recommendation ?? 'unanalyzed'}><StatusPill tone={recommendationTone(row.recommendation?.recommendation)}>{recommendationLabel(t, row.recommendation?.recommendation)}</StatusPill></span></td><td data-label={t('workbench.analysis.classification')}><strong>{row.classification === undefined ? '—' : t(`workbench.classification.${row.classification}`)}</strong>{ruleName(row.finalRuleId) === undefined ? null : <small>{ruleName(row.finalRuleId)}</small>}</td><td data-label={t('workbench.review.deadlineStage')}><span className={css.reviewTiming}>{timingLabel(row, t)}</span></td><td data-label={t('workbench.review.verificationColumn')}>{row.recommendation === undefined || row.recommendation.verificationItems.length === 0 ? <span>{t('workbench.analysis.unanalyzed')}</span> : <><span>{row.recommendation.verificationItems.slice(0, 2).join('；')}</span>{row.recommendation.verificationItems.length > 2 && <small>{t('workbench.review.moreVerification', { count: row.recommendation.verificationItems.length - 2 })}</small>}</>}</td><td data-label={t('workbench.review.userDecision')}><StatusPill tone={row.review.decision === 'confirmed-candidate' ? 'success' : row.review.decision === 'watch' ? 'warning' : row.review.decision === 'pending' ? 'purple' : 'danger'}>{decisionLabel(t, row.review.decision, row.project.source)}</StatusPill><small className={css.decisionAgreement}>{t(row.review.decision === 'pending' ? 'workbench.review.waitingDecision' : 'workbench.review.independentDecision')}</small></td></tr>)}</tbody></table></div>}
          {rows.data !== undefined && <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: rows.data.page, pages: maximumPage, total: rows.data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setSelected(new Set()); setFocusedId(undefined) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1); setSelected(new Set()); setFocusedId(undefined) }}>{t('workbench.data.next')}</button></div></footer>}
        </section>
        {focused === undefined ? <aside className={css.reviewDetail}><StatePanel title={t('workbench.review.emptyTitle')} description={t('workbench.review.emptyDescription')} /></aside> : <aside ref={reviewDetailRef} className={css.reviewDetail} tabIndex={-1} aria-label={t('workbench.review.detailTitle')}>
          <header><div>{projectNumber === undefined ? null : <span className={css.recordIdentifier}>{projectNumber}</span>}<h3>{focused.project.title}</h3><p>{t(`workbench.data.source.${focused.project.source}`)} · {visibleRegion(focused, t)} · {focused.project.amount.display} · {timingLabel(focused, t)}</p></div><StatusPill tone={focused.review.decision === 'confirmed-candidate' ? 'success' : focused.review.decision === 'watch' ? 'warning' : focused.review.decision === 'pending' ? 'purple' : 'danger'}>{decisionLabel(t, focused.review.decision, focused.project.source)}</StatusPill></header>
          <section className={css.agentRecap}><span>{t('workbench.analysis.agentRecommendation')}</span><strong>{recommendationLabel(t, focused.recommendation?.recommendation)}</strong><p>{focused.recommendation?.reason ?? t('workbench.analysis.unanalyzedDescription')}</p>{focused.recommendation === undefined ? null : <div>{focused.recommendation.evidence.slice(0, 3).map(item => <span key={item.ref}>{item.label}</span>)}</div>}</section>
          <section className={css.decisionEditor}>
            <div><span className={css.decisionLabel}>{t('workbench.review.currentDecision')}</span><div className={css.decisionSegment} role="group" aria-label={t('workbench.review.currentDecision')}>{(['confirmed-candidate', 'watch', 'exclude', 'pending'] as const).map(decision => <button key={decision} type="button" disabled={write.busy} aria-pressed={currentDecision === decision} onClick={() => { setCurrentDecision(decision) }}>{decision === 'confirmed-candidate' ? t(focused.project.source === 'tender' ? 'workbench.review.confirmedTender' : 'workbench.review.confirmedProposed') : decision === 'pending' ? t('workbench.review.pendingOption') : t(`workbench.review.decision.${decision}`)}</button>)}</div></div>
            <label><span>{t('workbench.review.currentNote')}</span><textarea disabled={write.busy} maxLength={2048} value={currentNote} placeholder={t('workbench.review.notePlaceholder')} onChange={(event) => { setCurrentNote(event.target.value) }} /></label>
            <div className={css.decisionSaveRow}><span>{t('workbench.review.savedDecision', { decision: decisionLabel(t, focused.review.decision, focused.project.source) })}</span><button type="button" className={css.secondary} disabled={write.busy || currentDecision === 'pending'} onClick={() => { setCurrentDecision('pending') }}>{t('workbench.review.clearDecision')}</button><button type="button" className={css.primary} disabled={write.busy || !currentDirty} onClick={() => { apply([focused.project.recordId], currentDecision, currentNote) }}><SessionWriteButtonLabel action="review.apply" idle={t('workbench.review.saveCurrent')} t={t} write={write} /></button></div>
          </section>
          <section className={css.reviewAudit}><h4>{t('workbench.review.auditTitle')}</h4>{audit.length === 0 && focused.recommendation === undefined ? <p>{t('workbench.review.auditEmpty')}</p> : <ol>{audit.map(entry => <li key={`${entry.operationId}:${entry.decision}:${entry.note}`}><div><strong>{decisionLabel(t, entry.decision, focused.project.source)}</strong><span>{entry.appliedAt} · {entry.recordRefs.length > 1 ? t('workbench.review.auditBatch', { count: entry.recordRefs.length }) : t('workbench.review.auditSingle')}</span></div>{workflow.review?.latestOperationRef === entry.operationId && workflow.review.canRevert ? <button type="button" className={css.ghostButton} disabled={write.busy} onClick={revert}>{t('workbench.review.auditRevert')}</button> : null}{entry.note === '' ? null : <p>{entry.note}</p>}</li>)}{focused.recommendation === undefined ? null : <li data-audit-kind="agent"><div><strong>{t('workbench.review.agentHistory', { recommendation: recommendationLabel(t, focused.recommendation.recommendation) })}</strong><span>{workflow.analysis?.version ?? focused.recommendation.batchId}</span></div></li>}</ol>}</section>
          <div className={css.reviewSnapshotHint}><strong>{pending === 0 ? t('workbench.review.snapshotComplete') : t('workbench.review.snapshotPartial')}</strong><p>{pending === 0 ? t('workbench.review.snapshotCompleteDescription') : t('workbench.review.snapshotPartialDescription', { count: pending })}</p></div>
        </aside>}
      </div>
      {footerTarget === null ? null : createPortal(<>
        <div className={css.reviewFooterProgress}><span>{t('workbench.review.footerBoundary')}</span><strong>{t('workbench.review.progress', { reviewed, total })}</strong></div>
        <div className={css.footerActions}><button type="button" className={css.secondary} disabled={write.busy || workflow.review?.canRevert !== true} onClick={revert}><SessionWriteButtonLabel action="review.revert" idle={t('workbench.review.revert')} t={t} write={write} /></button><button type="button" className={css.primary} disabled={write.busy} onClick={onOpenReport}>{t('workbench.review.generateCurrent')}</button></div>
      </>, footerTarget)}
    </section>
  )
}
