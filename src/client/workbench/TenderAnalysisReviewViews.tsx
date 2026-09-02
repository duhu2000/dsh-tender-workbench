import { useEffect, useMemo, useState } from 'react'
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
  return <p className={css.scopeNotice}>{t('workbench.analysis.boundary')}</p>
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
  readonly t: TenderTranslate
}

export function TenderAnalysisView({ sessionId, workflow, loadRows, write, onOpenReview, t }: AnalysisViewProps) {
  const artifact = currentRowsArtifact(workflow)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ReviewRowsFilterV1['source']>()
  const [classification, setClassification] = useState<ReviewRowsFilterV1['classification']>()
  const [recommendation, setRecommendation] = useState<ReviewRowsFilterV1['recommendation']>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const filter = useMemo<ReviewRowsFilterV1>(() => ({
    page, pageSize: 20,
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(source === undefined ? {} : { source }),
    ...(classification === undefined ? {} : { classification }),
    ...(recommendation === undefined ? {} : { recommendation }),
  }), [classification, page, query, recommendation, source])
  const rows = useReviewRows({ sessionId, artifact, filter, loadRows })
  useEffect(() => { setSelected(new Set()) }, [artifact?.id, classification, page, query, recommendation, source])
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
  return (
    <section className={css.s4View} aria-label={t('workbench.analysis.title')}>
      <header className={css.pageHeading}>
        <div><p className={css.eyebrow}>{t('workbench.analysis.eyebrow')}</p><h2>{t('workbench.analysis.title')}</h2><p>{t('workbench.analysis.description')}</p></div>
        <span className={css.stageState}>{t('workbench.analysis.coverage', { completed, total })}</span>
      </header>
      <AnalysisBoundary t={t} />
      <div className={css.s4Summary}>
        <article><span>{t('workbench.analysis.priority')}</span><strong>{workflow.analysis?.priorityReview ?? 0}</strong></article>
        <article><span>{t('workbench.analysis.watch')}</span><strong>{workflow.analysis?.watch ?? 0}</strong></article>
        <article><span>{t('workbench.analysis.notRecommended')}</span><strong>{workflow.analysis?.notRecommended ?? 0}</strong></article>
        <article><span>{t('workbench.analysis.unanalyzed')}</span><strong>{Math.max(0, total - completed)}</strong></article>
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
        <button type="button" className={css.secondary} disabled={write.busy} onClick={onOpenReview}>{t('workbench.analysis.skip')}</button>
      </div>
      <SessionWriteProgress t={t} write={write} />
      <div className={css.dataToolbar}>
        <input type="search" aria-label={t('workbench.analysis.search')} value={query} placeholder={t('workbench.analysis.searchPlaceholder')} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
        <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={(event) => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); setPage(1) }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
        <select aria-label={t('workbench.classification.filter')} value={classification ?? ''} onChange={(event) => { setClassification(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof classification>); setPage(1) }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
        <select aria-label={t('workbench.analysis.filterRecommendation')} value={recommendation ?? ''} onChange={(event) => { setRecommendation(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof recommendation>); setPage(1) }}><option value="">{t('workbench.analysis.recommendationAll')}</option><option value="priority-review">{t('workbench.analysis.recommendation.priority-review')}</option><option value="watch">{t('workbench.analysis.recommendation.watch')}</option><option value="not-recommended">{t('workbench.analysis.recommendation.not-recommended')}</option><option value="unanalyzed">{t('workbench.analysis.unanalyzed')}</option></select>
      </div>
      {rows.failed ? <div className={css.dataError} role="alert"><span>{t('workbench.analysis.loadFailed')}</span><button type="button" onClick={rows.retry}>{t('workbench.data.retry')}</button></div> : rows.data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.analysis.loading')}</p> : (
        <>
          {rows.loading && <div className={css.inlineLoading} role="status">{t('workbench.analysis.loading')}</div>}
          <div className={css.dataTableWrap}><table className={css.dataTable}><thead><tr><th>{t('workbench.review.select')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.data.column.source')}</th><th>{t('workbench.analysis.classification')}</th><th>{t('workbench.analysis.agentRecommendation')}</th><th>{t('workbench.analysis.evidence')}</th><th>{t('workbench.review.userDecision')}</th></tr></thead><tbody>{rows.data.rows.map(row => <tr key={row.project.recordId}><td><input type="checkbox" aria-label={t('workbench.review.selectRecord', { title: row.project.title })} checked={selected.has(row.project.recordId)} onChange={() => { toggle(row.project.recordId) }} /></td><td><strong>{row.project.title}</strong><small>{row.project.sourceId}</small></td><td>{t(`workbench.data.source.${row.project.source}`)}</td><td>{row.classification === undefined ? '—' : t(`workbench.classification.${row.classification}`)}</td><td><span className={css.sourceTag} data-recommendation={row.recommendation?.recommendation ?? 'unanalyzed'}>{recommendationLabel(t, row.recommendation?.recommendation)}</span><small>{row.recommendation?.reason}</small></td><td>{row.recommendation === undefined ? '—' : <details><summary>{t('workbench.analysis.evidenceCount', { count: row.recommendation.evidence.length })}</summary><ul className={css.evidenceList}>{row.recommendation.evidence.map(item => <li key={item.ref}><strong>{item.label}</strong><span>{item.value}</span></li>)}</ul><strong>{t('workbench.analysis.verification')}</strong><ul>{row.recommendation.verificationItems.map(item => <li key={item}>{item}</li>)}</ul><strong>{t('workbench.analysis.limitations')}</strong><ul>{row.recommendation.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>}</td><td>{decisionLabel(t, row.review.decision, row.project.source)}</td></tr>)}</tbody></table></div>
          <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: rows.data.page, pages: maximumPage, total: rows.data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div></footer>
        </>
      )}
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
  const [decision, setDecision] = useState<UserDecision>('pending')
  const [note, setNote] = useState('')
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
  useEffect(() => { setSelected(new Set()) }, [artifact?.id, classification, deadlineStatus, decisionFilter, page, query, recommendation, source])
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
  const apply = (): void => {
    write.start('review.apply', commandId => createApplyReviewIntent({
      ...binding(commandId), recordRefs: [...selected], decision, note,
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
  return (
    <section className={css.s4View} aria-label={t('workbench.review.title')}>
      <header className={css.pageHeading}><div><p className={css.eyebrow}>{t('workbench.review.eyebrow')}</p><h2>{t('workbench.review.title')}</h2><p>{t('workbench.review.description')}</p></div><span className={css.stageState}>{t('workbench.review.progress', { reviewed, total })}</span></header>
      <p className={css.scopeNotice}>{t('workbench.review.boundary')}</p>
      <div className={css.s4Summary}>
        <article><span>{t('workbench.review.confirmed')}</span><strong>{workflow.review?.confirmedCandidate ?? 0}</strong></article>
        <article><span>{t('workbench.review.watch')}</span><strong>{workflow.review?.watch ?? 0}</strong></article>
        <article><span>{t('workbench.review.exclude')}</span><strong>{workflow.review?.exclude ?? 0}</strong></article>
        <article><span>{t('workbench.review.pending')}</span><strong>{pending}</strong></article>
      </div>
      <div className={css.reviewComposer}>
        <label><span>{t('workbench.review.batchDecision')}</span><select disabled={write.busy} value={decision} onChange={(event) => { setDecision(event.target.value as UserDecision) }}><option value="confirmed-candidate">{t('workbench.review.confirmedMixed')}</option><option value="watch">{t('workbench.review.decision.watch')}</option><option value="exclude">{t('workbench.review.decision.exclude')}</option><option value="pending">{t('workbench.review.decision.pending')}</option></select></label>
        <label><span>{t('workbench.review.note')}</span><textarea disabled={write.busy} maxLength={2048} value={note} placeholder={t('workbench.review.notePlaceholder')} onChange={(event) => { setNote(event.target.value) }} /></label>
        <div className={css.s4Actions}><button type="button" className={css.primary} disabled={write.busy || selected.size === 0} onClick={apply}><SessionWriteButtonLabel action="review.apply" idle={t('workbench.review.applySelected', { count: selected.size })} t={t} write={write} /></button><button type="button" className={css.secondary} disabled={write.busy || workflow.review?.canRevert !== true} onClick={revert}><SessionWriteButtonLabel action="review.revert" idle={t('workbench.review.revert')} t={t} write={write} /></button></div>
      </div>
      <SessionWriteProgress t={t} write={write} />
      <div className={css.dataToolbar}>
        <input type="search" aria-label={t('workbench.review.search')} value={query} placeholder={t('workbench.review.searchPlaceholder')} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
        <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={(event) => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); setPage(1) }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
        <select aria-label={t('workbench.classification.filter')} value={classification ?? ''} onChange={(event) => { setClassification(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof classification>); setPage(1) }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
        <select aria-label={t('workbench.analysis.filterRecommendation')} value={recommendation ?? ''} onChange={(event) => { setRecommendation(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof recommendation>); setPage(1) }}><option value="">{t('workbench.analysis.recommendationAll')}</option><option value="priority-review">{t('workbench.analysis.recommendation.priority-review')}</option><option value="watch">{t('workbench.analysis.recommendation.watch')}</option><option value="not-recommended">{t('workbench.analysis.recommendation.not-recommended')}</option><option value="unanalyzed">{t('workbench.analysis.unanalyzed')}</option></select>
        <select aria-label={t('workbench.review.filterDecision')} value={decisionFilter ?? ''} onChange={(event) => { setDecisionFilter(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof decisionFilter>); setPage(1) }}><option value="">{t('workbench.review.decisionAll')}</option><option value="confirmed-candidate">{t('workbench.review.confirmedMixed')}</option><option value="watch">{t('workbench.review.decision.watch')}</option><option value="exclude">{t('workbench.review.decision.exclude')}</option><option value="pending">{t('workbench.review.decision.pending')}</option></select>
        <select aria-label={t('workbench.review.filterDeadline')} value={deadlineStatus ?? ''} onChange={(event) => { setDeadlineStatus(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof deadlineStatus>); setPage(1) }}><option value="">{t('workbench.review.deadlineAll')}</option><option value="active">{t('workbench.review.deadline.active')}</option><option value="expired">{t('workbench.review.deadline.expired')}</option><option value="missing">{t('workbench.review.deadline.missing')}</option></select>
      </div>
      {rows.failed ? <div className={css.dataError} role="alert"><span>{t('workbench.review.loadFailed')}</span><button type="button" onClick={rows.retry}>{t('workbench.data.retry')}</button></div> : rows.data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.review.loading')}</p> : (
        <>
          {rows.loading && <div className={css.inlineLoading} role="status">{t('workbench.review.loading')}</div>}
          <div className={css.dataTableWrap}><table className={css.dataTable}><thead><tr><th>{t('workbench.review.select')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.data.column.source')}</th><th>{t('workbench.analysis.classification')}</th><th>{t('workbench.analysis.agentRecommendation')}</th><th>{t('workbench.review.userDecision')}</th><th>{t('workbench.review.note')}</th><th>{t('workbench.data.column.status')}</th></tr></thead><tbody>{rows.data.rows.map(row => <tr key={row.project.recordId}><td><input type="checkbox" aria-label={t('workbench.review.selectRecord', { title: row.project.title })} checked={selected.has(row.project.recordId)} onChange={() => { toggle(row.project.recordId) }} /></td><td><strong>{row.project.title}</strong><small>{row.project.sourceId}</small></td><td>{t(`workbench.data.source.${row.project.source}`)}</td><td>{row.classification === undefined ? '—' : t(`workbench.classification.${row.classification}`)}</td><td><span className={css.sourceTag} data-recommendation={row.recommendation?.recommendation ?? 'unanalyzed'}>{recommendationLabel(t, row.recommendation?.recommendation)}</span><small>{row.recommendation?.reason}</small></td><td><span className={css.sourceTag} data-decision={row.review.decision}>{decisionLabel(t, row.review.decision, row.project.source)}</span></td><td>{row.review.note || '—'}</td><td><span className={css.fieldStatus} data-field-status={fieldStatus(row)}>{t(`workbench.data.status.${fieldStatus(row)}`)}</span></td></tr>)}</tbody></table></div>
          <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: rows.data.page, pages: maximumPage, total: rows.data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div></footer>
        </>
      )}
    </section>
  )
}
