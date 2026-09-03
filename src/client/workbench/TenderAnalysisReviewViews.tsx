import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ReviewRowsFilterV1,
  ReviewRowsPageV1,
} from '../../contracts/analysis-review.ts'
import type {
  ArtifactRefV1,
  TenderWorkflowProjectionV1,
  UserDecision,
} from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  createApplyReviewIntent,
  createRequestAnalysisIntent,
  createRevertReviewIntent,
} from '../intents/screening-intent.ts'
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

function currentRowsArtifact(workflow: TenderWorkflowProjectionV1): ArtifactRefV1 | undefined {
  return workflow.review?.data
    ?? workflow.analysis?.data
    ?? workflow.classification?.data
    ?? workflow.query?.normalizedData
}

function fieldStatus(row: ReviewRowsPageV1['rows'][number]): 'normalized' | 'missing' | 'unparseable' {
  if (row.project.disclosure.unparseableFields.length > 0) return 'unparseable'
  if (row.project.disclosure.missingFields.length > 0) return 'missing'
  return 'normalized'
}

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
  useEffect(() => {
    if (artifact === undefined) return
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
  }, [
    artifact?.id,
    filter.classification,
    filter.deadlineStatus,
    filter.page,
    filter.pageSize,
    filter.query,
    filter.recommendation,
    filter.source,
    filter.userDecision,
    loadRows,
    retry,
    sessionId,
  ])
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

function decisionLabel(t: TenderTranslate, decision: UserDecision, source: 'tender' | 'proposed'): string {
  if (decision === 'confirmed-candidate') {
    return t(source === 'tender' ? 'workbench.review.confirmedTender' : 'workbench.review.confirmedProposed')
  }
  return t(`workbench.review.decision.${decision}`)
}

interface AnalysisViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly loadRows: ReviewRowsLoader
  readonly write: SessionWriteFlight
  readonly onOpenReview: () => void
  readonly footerTarget: HTMLElement | null
  readonly t: TenderTranslate
}

export function TenderAnalysisView({ sessionId, workflow, loadRows, write, onOpenReview, footerTarget, t }: AnalysisViewProps) {
  const artifact = currentRowsArtifact(workflow)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ReviewRowsFilterV1['source']>()
  const [classification, setClassification] = useState<ReviewRowsFilterV1['classification']>()
  const [recommendation, setRecommendation] = useState<ReviewRowsFilterV1['recommendation']>()
  const [sort, setSort] = useState<'source-order' | 'recommendation' | 'published'>('source-order')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string>()
  const analysisDetailRef = useRef<HTMLElement>(null)
  const filter = useMemo<ReviewRowsFilterV1>(() => ({
    page, pageSize: 20,
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(source === undefined ? {} : { source }),
    ...(classification === undefined ? {} : { classification }),
    ...(recommendation === undefined ? {} : { recommendation }),
  }), [classification, page, query, recommendation, source])
  const rows = useReviewRows({ sessionId, artifact, filter, loadRows })
  useEffect(() => { setSelected(new Set()); setFocusedId(undefined) }, [artifact?.id, classification, page, query, recommendation, source])
  const startAnalysis = (scope: Parameters<typeof createRequestAnalysisIntent>[0]['scope']): void => {
    const active = workflow.query?.normalizedData
    if (active === undefined) return
    write.start('analysis.request', commandId => createRequestAnalysisIntent({
      commandId,
      activeDatasetRef: active.id,
      ...(workflow.classification === undefined ? {} : {
        classificationArtifactRef: workflow.classification.data.id,
        ruleSetVersion: workflow.classification.ruleSetVersion,
      }),
      projectionRevision: workflow.revision,
      scope,
      batchSize: 12,
    }))
  }
  const toggle = (recordId: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }
  const completed = workflow.analysis?.completed ?? 0
  const total = workflow.analysis?.total ?? workflow.query?.total ?? 0
  const maximumPage = Math.max(1, Math.ceil((rows.data?.total ?? 0) / 20))
  const displayedRows = useMemo(() => {
    const result = [...(rows.data?.rows ?? [])]
    if (sort === 'recommendation') {
      const rank = { 'priority-review': 0, watch: 1, 'not-recommended': 2 } as const
      result.sort((left, right) => (left.recommendation === undefined ? 3 : rank[left.recommendation.recommendation]) - (right.recommendation === undefined ? 3 : rank[right.recommendation.recommendation]))
    } else if (sort === 'published') {
      result.sort((left, right) => (right.project.publishedAt.value ?? '').localeCompare(left.project.publishedAt.value ?? ''))
    }
    return result
  }, [rows.data?.rows, sort])
  const focused = displayedRows.find(row => row.project.recordId === focusedId) ?? displayedRows[0]
  useEffect(() => { if (focusedId !== undefined) analysisDetailRef.current?.focus() }, [focusedId])
  return (
    <section className={css.s4View} aria-label={t('workbench.analysis.title')}>
      <PageHeader eyebrow={t('workbench.analysis.eyebrow')} title={t('workbench.analysis.title')} description={t('workbench.analysis.description')} aside={<div className={css.analysisHeaderMeta}><StatusPill>{workflow.analysis?.version ?? t('workbench.analysis.unanalyzed')}</StatusPill><ProgressMeter value={completed} max={total} label={t('workbench.analysis.progressLabel')} /></div>} />
      <AnalysisBoundary t={t} />
      <div className={css.s4Summary}>
        <MetricCard label={t('workbench.analysis.priority')} value={workflow.analysis?.priorityReview ?? 0} tone="success" />
        <MetricCard label={t('workbench.analysis.watch')} value={workflow.analysis?.watch ?? 0} tone="warning" />
        <MetricCard label={t('workbench.analysis.notRecommended')} value={workflow.analysis?.notRecommended ?? 0} />
        <MetricCard label={t('workbench.analysis.unanalyzed')} value={Math.max(0, total - completed)} tone={total > completed ? 'purple' : 'neutral'} />
      </div>
      <div className={css.s4Actions}>
        <button type="button" className={css.primary} disabled={write.busy || selected.size === 0} onClick={() => { startAnalysis({ kind: 'records', recordRefs: [...selected] }) }}>
          <SessionWriteButtonLabel action="analysis.request" idle={t('workbench.analysis.analyzeSelected', { count: selected.size })} t={t} write={write} />
        </button>
        {workflow.classification !== undefined && classification !== undefined && (
          <button type="button" className={css.secondary} disabled={write.busy} onClick={() => { startAnalysis({ kind: 'classifications', classifications: [classification] }) }}>
            {t('workbench.analysis.analyzeClassification')}
          </button>
        )}
      </div>
      <SessionWriteProgress t={t} write={write} />
      {rows.failed ? <div className={css.dataError} role="alert"><span>{t('workbench.analysis.loadFailed')}</span><button type="button" onClick={rows.retry}>{t('workbench.data.retry')}</button></div> : rows.data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.analysis.loading')}</p> : (
        <>
          {rows.loading && <div className={css.inlineLoading} role="status">{t('workbench.analysis.loading')}</div>}
          <div className={css.analysisWorkspace} data-analysis-layout>
            <section className={css.queuePanel}>
              <SurfaceHeader title={t('workbench.analysis.queueTitle')} description={t('workbench.analysis.queueDescription')} />
              <div className={css.dataToolbar}>
                <input type="search" aria-label={t('workbench.analysis.search')} value={query} placeholder={t('workbench.analysis.searchPlaceholder')} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
                <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={(event) => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); setPage(1) }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
                <select aria-label={t('workbench.classification.filter')} value={classification ?? ''} onChange={(event) => { setClassification(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof classification>); setPage(1) }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
                <select aria-label={t('workbench.analysis.filterRecommendation')} value={recommendation ?? ''} onChange={(event) => { setRecommendation(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof recommendation>); setPage(1) }}><option value="">{t('workbench.analysis.recommendationAll')}</option><option value="priority-review">{t('workbench.analysis.recommendation.priority-review')}</option><option value="watch">{t('workbench.analysis.recommendation.watch')}</option><option value="not-recommended">{t('workbench.analysis.recommendation.not-recommended')}</option><option value="unanalyzed">{t('workbench.analysis.unanalyzed')}</option></select>
                <select aria-label={t('workbench.analysis.sort')} value={sort} onChange={event => { setSort(event.target.value as typeof sort) }}><option value="source-order">{t('workbench.analysis.sort.source')}</option><option value="recommendation">{t('workbench.analysis.sort.recommendation')}</option><option value="published">{t('workbench.analysis.sort.published')}</option></select>
              </div>
              <div className={css.opportunityList}>{displayedRows.map((row, index) => (
                <article key={row.project.recordId} className={focused?.project.recordId === row.project.recordId ? css.opportunitySelected : css.opportunityRow}>
                  <input type="checkbox" aria-label={t('workbench.review.selectRecord', { title: row.project.title })} checked={selected.has(row.project.recordId)} onChange={() => { toggle(row.project.recordId) }} />
                  <button type="button" onClick={() => { setFocusedId(row.project.recordId) }} aria-pressed={focused?.project.recordId === row.project.recordId}>
                    <span className={css.rowRank}>{String((page - 1) * 20 + index + 1).padStart(2, '0')}</span>
                    <span className={css.rowMain}><strong>{row.project.title}</strong><small>{t(`workbench.data.source.${row.project.source}`)} · {row.project.region.value ?? t('workbench.data.value.missing')} · {row.project.amount.display}</small></span>
                    <span className={css.rowSignals}><span data-agent-recommendation={row.recommendation?.recommendation ?? 'unanalyzed'}><StatusPill tone={row.recommendation?.recommendation === 'priority-review' ? 'success' : row.recommendation?.recommendation === 'watch' ? 'warning' : 'neutral'}>{recommendationLabel(t, row.recommendation?.recommendation)}</StatusPill></span><small>{row.project.publishedAt.value ?? t('workbench.data.value.missing')}</small></span>
                  </button>
                </article>
              ))}</div>
              <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: rows.data.page, pages: maximumPage, total: rows.data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div></footer>
            </section>
            {focused === undefined ? null : (
              <aside ref={analysisDetailRef} className={css.analysisDetail} tabIndex={-1} aria-label={t('workbench.analysis.detailTitle')}>
                <header className={css.analysisDetailHero}><div><StatusPill tone={focused.project.source === 'tender' ? 'brand' : 'warning'}>{t(`workbench.data.source.${focused.project.source}`)}</StatusPill><h3>{focused.project.title}</h3><p>{focused.project.region.value ?? t('workbench.data.value.missing')} · {focused.project.amount.display}</p></div><span data-agent-recommendation={focused.recommendation?.recommendation ?? 'unanalyzed'}><StatusPill tone={focused.recommendation?.recommendation === 'priority-review' ? 'success' : focused.recommendation?.recommendation === 'watch' ? 'warning' : 'neutral'}>{recommendationLabel(t, focused.recommendation?.recommendation)}</StatusPill></span></header>
                <div className={css.analysisFactGrid}>
                  <div><span>{t('workbench.analysis.factQuery')}</span><strong>{t(`workbench.data.source.${focused.project.source}`)}</strong></div>
                  <div><span>{t('workbench.analysis.factRule')}</span><strong>{focused.classification === undefined ? '—' : t(`workbench.classification.${focused.classification}`)}</strong></div>
                  <div><span>{t('workbench.analysis.factTiming')}</span><strong>{focused.project.publishedAt.value ?? t('workbench.data.value.missing')}</strong></div>
                  <div><span>{t('workbench.analysis.factDisclosure')}</span><strong>{t(`workbench.data.status.${fieldStatus(focused)}`)}</strong></div>
                </div>
                {focused.recommendation === undefined ? <StatePanel title={t('workbench.analysis.unanalyzed')} description={t('workbench.analysis.unanalyzedDescription')} /> : (
                  <>
                    <section className={css.analysisConclusion}><span>{t('workbench.analysis.conclusion')}</span><p>{focused.recommendation.reason}</p></section>
                    <section className={css.detailSection}><h4>{t('workbench.analysis.evidence')}</h4><ul className={css.evidenceList}>{focused.recommendation.evidence.map(item => <li key={item.ref}><strong>{item.label}</strong><span>{item.value}</span>{item.limitation === undefined ? null : <small>{item.limitation}</small>}</li>)}</ul></section>
                    <div className={css.detailColumns}><section className={css.detailSection} data-analysis-risk><h4>{t('workbench.analysis.limitations')}</h4><ul>{focused.recommendation.limitations.map(item => <li key={item}>{item}</li>)}</ul></section><section className={css.detailSection} data-analysis-verification><h4>{t('workbench.analysis.verification')}</h4><ul>{focused.recommendation.verificationItems.map(item => <li key={item}>{item}</li>)}</ul></section></div>
                  </>
                )}
                <p className={css.analysisBoundary}>{t('workbench.analysis.boundary')}</p>
              </aside>
            )}
          </div>
        </>
      )}
      {footerTarget === null ? null : createPortal(<>
        <div className={css.footerCopy}><span className={css.footerHint}>{t(workflow.analysis === undefined ? 'workbench.analysis.footerWaiting' : 'workbench.analysis.footerNote')}</span></div>
        {workflow.analysis === undefined ? null : <button type="button" className={css.primary} disabled={write.busy} onClick={onOpenReview}>{t('workbench.analysis.openReview')}</button>}
      </>, footerTarget)}
    </section>
  )
}

interface ReviewViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly loadRows: ReviewRowsLoader
  readonly write: SessionWriteFlight
  readonly t: TenderTranslate
}

export function TenderReviewView({ sessionId, workflow, loadRows, write, t }: ReviewViewProps) {
  const artifact = currentRowsArtifact(workflow)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ReviewRowsFilterV1['source']>()
  const [classification, setClassification] = useState<ReviewRowsFilterV1['classification']>()
  const [recommendation, setRecommendation] = useState<ReviewRowsFilterV1['recommendation']>()
  const [decisionFilter, setDecisionFilter] = useState<ReviewRowsFilterV1['userDecision']>()
  const [deadlineStatus, setDeadlineStatus] = useState<ReviewRowsFilterV1['deadlineStatus']>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [batchNote, setBatchNote] = useState('')
  const [currentDecision, setCurrentDecision] = useState<UserDecision>('pending')
  const [currentNote, setCurrentNote] = useState('')
  const [focusedId, setFocusedId] = useState<string>()
  const selectPageRef = useRef<HTMLInputElement>(null)
  const reviewDetailRef = useRef<HTMLElement>(null)
  const filter = useMemo<ReviewRowsFilterV1>(() => ({
    page, pageSize: 20,
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(source === undefined ? {} : { source }),
    ...(classification === undefined ? {} : { classification }),
    ...(recommendation === undefined ? {} : { recommendation }),
    ...(decisionFilter === undefined ? {} : { userDecision: decisionFilter }),
    ...(deadlineStatus === undefined ? {} : { deadlineStatus }),
  }), [classification, deadlineStatus, decisionFilter, page, query, recommendation, source])
  const rows = useReviewRows({ sessionId, artifact, filter, loadRows })
  useEffect(() => { setSelected(new Set()); setFocusedId(undefined) }, [artifact?.id, classification, deadlineStatus, decisionFilter, page, query, recommendation, source])
  const binding = (commandId: string) => {
    const active = workflow.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    return {
      commandId,
      activeDatasetRef: active.id,
      ...(workflow.classification === undefined ? {} : {
        classificationArtifactRef: workflow.classification.data.id,
        ruleSetVersion: workflow.classification.ruleSetVersion,
      }),
      ...(workflow.analysis === undefined ? {} : { analysisVersion: workflow.analysis.version }),
      projectionRevision: workflow.revision,
    }
  }
  const apply = (
    recordRefs: readonly string[] = [...selected],
    decision: UserDecision = 'pending',
    note: string = batchNote,
  ): void => {
    write.start('review.apply', commandId => createApplyReviewIntent({
      ...binding(commandId), recordRefs: [...recordRefs], decision, note,
    }))
  }
  const revert = (): void => {
    write.start('review.revert', commandId => createRevertReviewIntent(binding(commandId)))
  }
  const toggle = (recordId: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }
  const total = workflow.review === undefined ? workflow.query?.total ?? 0 : workflow.review.pending + workflow.review.confirmedCandidate + workflow.review.watch + workflow.review.exclude
  const pending = workflow.review?.pending ?? total
  const reviewed = total - pending
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
  useEffect(() => {
    if (focusedId !== undefined) reviewDetailRef.current?.focus()
  }, [focusedId])
  const currentDirty = focused !== undefined
    && (currentDecision !== focused.review.decision || currentNote !== focused.review.note)
  return (
    <section className={css.s4View} aria-label={t('workbench.review.title')}>
      <PageHeader eyebrow={t('workbench.review.eyebrow')} title={t('workbench.review.title')} description={t('workbench.review.description')} aside={<ProgressMeter value={reviewed} max={total} label={t('workbench.review.progressLabel')} />} />
      <StatePanel tone="neutral" title={t('workbench.review.boundaryTitle')} description={t('workbench.review.boundary')} />
      <div className={css.s4Summary}>
        <MetricCard label={t('workbench.review.confirmed')} value={workflow.review?.confirmedCandidate ?? 0} tone="success" />
        <MetricCard label={t('workbench.review.watch')} value={workflow.review?.watch ?? 0} tone="warning" />
        <MetricCard label={t('workbench.review.exclude')} value={workflow.review?.exclude ?? 0} />
        <MetricCard label={t('workbench.review.pending')} value={pending} tone={pending > 0 ? 'purple' : 'neutral'} />
      </div>
      <SessionWriteProgress t={t} write={write} />
      {rows.failed ? <div className={css.dataError} role="alert"><span>{t('workbench.review.loadFailed')}</span><button type="button" onClick={rows.retry}>{t('workbench.data.retry')}</button></div> : rows.data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.review.loading')}</p> : (
        <>
          {rows.loading && <div className={css.inlineLoading} role="status">{t('workbench.review.loading')}</div>}
          <div className={css.reviewWorkspace}>
            <section className={css.queuePanel}>
              <SurfaceHeader title={t('workbench.review.queueTitle')} description={t('workbench.review.queueDescription')} action={<button type="button" className={css.secondary} disabled={write.busy || workflow.review?.canRevert !== true} onClick={revert}><SessionWriteButtonLabel action="review.revert" idle={t('workbench.review.revert')} t={t} write={write} /></button>} />
              <div className={css.dataToolbar}>
                <input type="search" aria-label={t('workbench.review.search')} value={query} placeholder={t('workbench.review.searchPlaceholder')} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
                <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={(event) => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); setPage(1) }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
                <select aria-label={t('workbench.classification.filter')} value={classification ?? ''} onChange={(event) => { setClassification(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof classification>); setPage(1) }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
                <select aria-label={t('workbench.analysis.filterRecommendation')} value={recommendation ?? ''} onChange={(event) => { setRecommendation(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof recommendation>); setPage(1) }}><option value="">{t('workbench.analysis.recommendationAll')}</option><option value="priority-review">{t('workbench.analysis.recommendation.priority-review')}</option><option value="watch">{t('workbench.analysis.recommendation.watch')}</option><option value="not-recommended">{t('workbench.analysis.recommendation.not-recommended')}</option><option value="unanalyzed">{t('workbench.analysis.unanalyzed')}</option></select>
                <select aria-label={t('workbench.review.filterDecision')} value={decisionFilter ?? ''} onChange={(event) => { setDecisionFilter(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof decisionFilter>); setPage(1) }}><option value="">{t('workbench.review.decisionAll')}</option><option value="confirmed-candidate">{t('workbench.review.confirmedMixed')}</option><option value="watch">{t('workbench.review.decision.watch')}</option><option value="exclude">{t('workbench.review.decision.exclude')}</option><option value="pending">{t('workbench.review.decision.pending')}</option></select>
                <select aria-label={t('workbench.review.filterDeadline')} value={deadlineStatus ?? ''} onChange={(event) => { setDeadlineStatus(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof deadlineStatus>); setPage(1) }}><option value="">{t('workbench.review.deadlineAll')}</option><option value="active">{t('workbench.review.deadline.active')}</option><option value="expired">{t('workbench.review.deadline.expired')}</option><option value="missing">{t('workbench.review.deadline.missing')}</option></select>
              </div>
              <div className={css.reviewBulkBar}>
                <label className={css.reviewBulkSelection}><input ref={selectPageRef} type="checkbox" aria-label={t('workbench.review.selectPage')} aria-checked={somePageSelected ? 'mixed' : allPageSelected} checked={allPageSelected} onChange={togglePageSelection} /><strong>{t('workbench.review.selectedCount', { count: selected.size })}</strong></label>
                <div className={css.reviewBulkActions} role="group" aria-label={t('workbench.review.batchDecision')}>
                  <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'confirmed-candidate', batchNote) }}>{t('workbench.review.batchSetConfirmed')}</button>
                  <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'watch', batchNote) }}>{t('workbench.review.batchSetWatch')}</button>
                  <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'exclude', batchNote) }}>{t('workbench.review.batchSetExclude')}</button>
                  <button type="button" className={css.secondary} disabled={write.busy || selected.size === 0} onClick={() => { apply([...selected], 'pending', batchNote) }}>{t('workbench.review.batchSetPending')}</button>
                  <button type="button" className={css.ghostButton} disabled={selected.size === 0} onClick={() => { setSelected(new Set()); setBatchNote('') }}>{t('workbench.review.clearSelection')}</button>
                </div>
                <span className={css.reviewBulkHint}>{t('workbench.review.batchUndoHint')}</span>
                {selected.size === 0 ? null : <label className={css.reviewBulkNote}><span>{t('workbench.review.batchNote')}</span><input disabled={write.busy} maxLength={2048} value={batchNote} placeholder={t('workbench.review.notePlaceholder')} onChange={(event) => { setBatchNote(event.target.value) }} /></label>}
              </div>
              <div className={css.dataTableWrap}><table className={css.dataTable}><thead><tr><th>{t('workbench.review.select')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.analysis.agentRecommendation')}</th><th>{t('workbench.analysis.classification')}</th><th>{t('workbench.review.userDecision')}</th><th>{t('workbench.data.column.action')}</th></tr></thead><tbody>{rows.data.rows.map(row => <tr key={row.project.recordId} data-row-selected={focused?.project.recordId === row.project.recordId ? 'true' : 'false'}><td data-label={t('workbench.review.select')}><input type="checkbox" aria-label={t('workbench.review.selectRecord', { title: row.project.title })} checked={selected.has(row.project.recordId)} onChange={() => { toggle(row.project.recordId); setFocusedId(row.project.recordId) }} /></td><td data-label={t('workbench.data.column.project')}><button type="button" className={css.rowTitleButton} aria-pressed={focused?.project.recordId === row.project.recordId} onClick={() => { setFocusedId(row.project.recordId) }}><strong>{row.project.title}</strong><small>{t(`workbench.data.source.${row.project.source}`)} · {row.project.amount.display || t('workbench.data.value.missing')}</small></button></td><td data-label={t('workbench.analysis.agentRecommendation')}><StatusPill tone={row.recommendation?.recommendation === 'priority-review' ? 'success' : row.recommendation?.recommendation === 'watch' ? 'warning' : 'neutral'}>{recommendationLabel(t, row.recommendation?.recommendation)}</StatusPill></td><td data-label={t('workbench.analysis.classification')}>{row.classification === undefined ? '—' : t(`workbench.classification.${row.classification}`)}</td><td data-label={t('workbench.review.userDecision')}><StatusPill tone={row.review.decision === 'confirmed-candidate' ? 'success' : row.review.decision === 'watch' ? 'warning' : row.review.decision === 'pending' ? 'purple' : 'neutral'}>{decisionLabel(t, row.review.decision, row.project.source)}</StatusPill></td><td data-label={t('workbench.data.column.action')}><button type="button" className={css.rowAction} aria-pressed={focused?.project.recordId === row.project.recordId} onClick={() => { setFocusedId(row.project.recordId) }}>{t('workbench.review.openDetail')}</button></td></tr>)}</tbody></table></div>
              <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: rows.data.page, pages: maximumPage, total: rows.data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div></footer>
            </section>
            {focused === undefined ? null : (
              <aside ref={reviewDetailRef} className={css.reviewDetail} tabIndex={-1} aria-label={t('workbench.review.detailTitle')}>
                <header><div><StatusPill tone={focused.project.source === 'tender' ? 'brand' : 'warning'}>{t(`workbench.data.source.${focused.project.source}`)}</StatusPill><h3>{focused.project.title}</h3><p>{focused.project.region.value ?? t('workbench.data.value.missing')} · {focused.project.amount.display}</p></div><StatusPill tone={focused.review.decision === 'confirmed-candidate' ? 'success' : focused.review.decision === 'watch' ? 'warning' : focused.review.decision === 'pending' ? 'purple' : 'neutral'}>{decisionLabel(t, focused.review.decision, focused.project.source)}</StatusPill></header>
                <section className={css.agentRecap}><span>{t('workbench.analysis.agentRecommendation')}</span><strong>{recommendationLabel(t, focused.recommendation?.recommendation)}</strong><p>{focused.recommendation?.reason ?? t('workbench.analysis.unanalyzedDescription')}</p></section>
                <div className={css.reviewLayers}>
                  <div><span>{t('workbench.review.layerData')}</span><strong>{t(`workbench.data.status.${fieldStatus(focused)}`)}</strong></div>
                  <div><span>{t('workbench.review.layerClassification')}</span><strong>{focused.classification === undefined ? '—' : t(`workbench.classification.${focused.classification}`)}</strong></div>
                  <div><span>{t('workbench.review.layerAgent')}</span><strong>{recommendationLabel(t, focused.recommendation?.recommendation)}</strong></div>
                  <div><span>{t('workbench.review.layerDecision')}</span><strong>{decisionLabel(t, focused.review.decision, focused.project.source)}</strong></div>
                </div>
                <section className={css.decisionEditor}>
                  <div><span className={css.decisionLabel}>{t('workbench.review.currentDecision')}</span><div className={css.decisionSegment} role="group" aria-label={t('workbench.review.currentDecision')}>{(['confirmed-candidate', 'watch', 'exclude', 'pending'] as const).map(decision => <button key={decision} type="button" disabled={write.busy} aria-pressed={currentDecision === decision} onClick={() => { setCurrentDecision(decision) }}>{decision === 'confirmed-candidate' ? t(focused.project.source === 'tender' ? 'workbench.review.confirmedTender' : 'workbench.review.confirmedProposed') : t(`workbench.review.decision.${decision}`)}</button>)}</div></div>
                  <label><span>{t('workbench.review.currentNote')}</span><textarea disabled={write.busy} maxLength={2048} value={currentNote} placeholder={t('workbench.review.notePlaceholder')} onChange={(event) => { setCurrentNote(event.target.value) }} /></label>
                  <div className={css.decisionSaveRow}><span>{t('workbench.review.savedDecision', { decision: decisionLabel(t, focused.review.decision, focused.project.source) })}</span><button type="button" className={css.secondary} disabled={write.busy || currentDecision === 'pending'} onClick={() => { setCurrentDecision('pending') }}>{t('workbench.review.clearDecision')}</button><button type="button" className={css.primary} disabled={write.busy || !currentDirty} onClick={() => { apply([focused.project.recordId], currentDecision, currentNote) }}><SessionWriteButtonLabel action="review.apply" idle={t('workbench.review.saveCurrent')} t={t} write={write} /></button></div>
                </section>
                {focused.review.note === '' ? null : <details className={css.savedNoteDetails}><summary>{t('workbench.review.savedNote')}</summary><p>{focused.review.note}</p></details>}
              </aside>
            )}
          </div>
        </>
      )}
    </section>
  )
}
