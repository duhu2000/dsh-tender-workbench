import { Fragment, useEffect, useId, useMemo, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ArtifactRowsFilterV1,
  ArtifactRowsPageV1,
  NormalizedProjectV1,
} from '../../contracts/dataset.ts'
import type {
  ArtifactRefV1,
  TenderWorkflowProjectionV1,
} from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import type { SessionWriteFlight } from './session-write-flight.ts'
import {
  SessionWriteButtonLabel,
  SessionWriteProgress,
  sessionWriteProgressText,
} from './SessionWriteProgress.tsx'
import css from './tender-workbench.module.css'

export type TenderRowsLoader = (
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  filter: ArtifactRowsFilterV1,
  signal?: AbortSignal,
) => Promise<ArtifactRowsPageV1>

interface TenderDataOverviewProps {
  readonly workflow: TenderWorkflowProjectionV1
  readonly onOpenDetails: () => void
  readonly onRequery: () => void
  readonly onContinue: () => void
  readonly write: SessionWriteFlight
  readonly t: TenderTranslate
}

function sourceLoaded(workflow: TenderWorkflowProjectionV1, source: 'tender' | 'proposed'): number {
  return workflow.query?.sources[source]?.loaded ?? 0
}

export function TenderDataOverview({
  workflow,
  onOpenDetails,
  onRequery,
  onContinue,
  write,
  t,
}: TenderDataOverviewProps) {
  const writeReasonId = useId()
  const query = workflow.query
  if (query?.normalizedData === undefined) return null
  const sources = Object.values(query.sources)
  const hasFailure = sources.some(source => source?.status === 'failed')
  const hasSuccess = sources.some(source => source?.status === 'succeeded')
  const raw = query.sourceRecordCount ?? sources.reduce((sum, source) => sum + (source?.loaded ?? 0), 0)
  return (
    <section className={css.dataView} aria-label={t('workbench.data.overview')}>
      <header className={css.pageHeading}>
        <div>
          <p className={css.eyebrow}>{t('workbench.data.eyebrow')}</p>
          <h2>{t('workbench.data.completeTitle')}</h2>
          <p>{t('workbench.data.completeDescription')}</p>
        </div>
        <div className={css.contextChips}>
          <span>{t('workbench.data.snapshot')}</span>
          <span>{t(`workbench.query.scope.${query.scope}`)}</span>
        </div>
      </header>

      {hasFailure && hasSuccess && (
        <div className={css.feedback} data-tone="notice" role="status">
          <div><strong>{t('workbench.data.partialTitle')}</strong><p>{t('workbench.data.partialDescription')}</p></div>
        </div>
      )}
      {workflow.stages.query.status === 'failed' && (
        <div className={css.feedback} data-tone="error" role="alert">
          <div><strong>{t('workbench.data.requeryFailedTitle')}</strong><p>{workflow.stages.query.errorMessage ?? t('workbench.data.requeryFailed')}</p></div>
        </div>
      )}
      {query.invalidCount > 0 && (
        <div className={css.feedback} data-tone="error" role="alert">
          <div><strong>{t('workbench.data.technicalTitle')}</strong><p>{t('workbench.data.technicalDescription', { count: query.invalidCount })}</p></div>
        </div>
      )}

      <div className={css.metricGrid}>
        <article className={css.metricCard}><span>{t('workbench.data.raw')}</span><strong>{raw}</strong><small>{t('workbench.data.sourceSplit', { tender: sourceLoaded(workflow, 'tender'), proposed: sourceLoaded(workflow, 'proposed') })}</small></article>
        <article className={css.metricCard}><span>{t('workbench.data.normalized')}</span><strong>{query.total}</strong><small>{t('workbench.data.linked', { count: query.duplicateCount })}</small></article>
        <article className={css.metricCard}><span>{t('workbench.data.missing')}</span><strong>{query.missingFieldCount ?? 0}</strong><small>{t('workbench.data.missingDescription')}</small></article>
        <article className={css.metricCard}><span>{t('workbench.data.unparseable')}</span><strong>{query.unparseableFieldCount ?? 0}</strong><small>{t('workbench.data.unparseableDescription')}</small></article>
      </div>

      <section className={css.dataCard}>
        <header className={css.dataCardHeader}>
          <div><h3>{t('workbench.data.sources')}</h3><p>{t('workbench.data.sourcesDescription')}</p></div>
          <div className={css.dataActions}>
            <button type="button" className={css.secondary} onClick={onRequery}>{t('workbench.data.requery')}</button>
            <button type="button" className={css.secondary} onClick={onOpenDetails}>{t('workbench.data.openDetails')}</button>
          </div>
        </header>
        <div className={css.sourceGrid}>
          {(['tender', 'proposed'] as const).map(source => {
            const state = query.sources[source]
            if (state === undefined) return null
            return (
              <article key={source} className={css.sourceCard} data-source-status={state.status}>
                <span>{t(`workbench.data.source.${source}`)}</span>
                <strong>{state.loaded}</strong>
                <small>{state.status === 'succeeded' ? t('workbench.data.sourceSucceeded') : state.errorMessage}</small>
              </article>
            )
          })}
        </div>
        <div className={css.scopeNotice}>{t('workbench.data.factBoundary')}</div>
      </section>

      <form className={css.nextSuggestion} onSubmit={(event) => { event.preventDefault(); onContinue() }}>
        <div><strong>{t('workbench.data.nextTitle')}</strong><p>{t('workbench.data.nextDescription')}</p></div>
        <button
          type="submit"
          className={css.primary}
          data-write-button="rules.propose"
          disabled={write.busy}
          aria-busy={write.state.action === 'rules.propose' && write.busy}
          aria-describedby={write.busy ? writeReasonId : undefined}
          title={write.busy ? t('workbench.write.busyReason', {
            action: sessionWriteProgressText(t, write.state) ?? t('workbench.rules.waitingAgent'),
          }) : undefined}
          onClick={onContinue}
        >
          <SessionWriteButtonLabel action="rules.propose" idle={t('workbench.data.continue')} t={t} write={write} />
        </button>
      </form>
      <SessionWriteProgress id={writeReasonId} t={t} write={write} />
    </section>
  )
}

interface TenderDataDetailsProps {
  readonly sessionId: SessionId
  readonly artifact: ArtifactRefV1
  readonly loadRows: TenderRowsLoader
  readonly onBack: () => void
  readonly t: TenderTranslate
}

function fieldBadgeStatus(row: NormalizedProjectV1): 'normalized' | 'missing' | 'unparseable' {
  if (row.disclosure.unparseableFields.length > 0) return 'unparseable'
  if (row.disclosure.missingFields.length > 0) return 'missing'
  return 'normalized'
}

function dateDisplay(row: NormalizedProjectV1, field: 'publishedAt' | 'deadline', t: TenderTranslate): string {
  const value = row[field]
  if (value === undefined || value.parseStatus === 'missing') return t('workbench.data.value.missing')
  return value.value ?? value.original
}

function amountDisplay(row: NormalizedProjectV1, t: TenderTranslate): string {
  if (row.amount.parseStatus === 'missing') return t('workbench.data.value.missing')
  return row.amount.display || row.amount.original || t('workbench.data.value.missing')
}

function sourceLink(row: NormalizedProjectV1): string | undefined {
  const candidate = row.announcements.find(announcement => announcement.sourceLink !== undefined)?.sourceLink
  if (candidate === undefined) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function TenderDataDetails({ sessionId, artifact, loadRows, onBack, t }: TenderDataDetailsProps) {
  const recordDetailId = useId()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ArtifactRowsFilterV1['source']>()
  const [fieldStatus, setFieldStatus] = useState<ArtifactRowsFilterV1['fieldStatus']>()
  const [sort, setSort] = useState<NonNullable<ArtifactRowsFilterV1['sort']>>('published-desc')
  const [data, setData] = useState<ArtifactRowsPageV1>()
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [requestVersion, setRequestVersion] = useState(0)
  const [selectedRecordId, setSelectedRecordId] = useState<string>()
  const filter = useMemo<ArtifactRowsFilterV1>(() => ({
    page,
    pageSize: 50,
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(source === undefined ? {} : { source }),
    ...(fieldStatus === undefined ? {} : { fieldStatus }),
    sort,
  }), [fieldStatus, page, query, sort, source])

  useEffect(() => {
    const abort = new AbortController()
    setFailed(false)
    setLoading(true)
    void loadRows(sessionId, artifact, filter, abort.signal).then((result) => {
      if (!abort.signal.aborted) {
        setData(result)
        setLoading(false)
      }
    }, () => {
      if (!abort.signal.aborted) {
        setFailed(true)
        setLoading(false)
      }
    })
    return () => { abort.abort() }
  }, [artifact, filter, loadRows, requestVersion, sessionId])

  useEffect(() => {
    setSelectedRecordId(undefined)
  }, [filter, sessionId])

  const maximumPage = Math.max(1, Math.ceil((data?.total ?? 0) / 50))
  const selectedRow = data?.rows.find(row => row.recordId === selectedRecordId)
  const selectedSourceLink = selectedRow === undefined ? undefined : sourceLink(selectedRow)
  const resetPage = () => { setPage(1) }
  return (
    <section className={css.dataView} aria-label={t('workbench.data.details')}>
      <button type="button" className={css.backButton} onClick={onBack}>← {t('workbench.data.back')}</button>
      <header className={css.pageHeading}>
        <div><p className={css.eyebrow}>{t('workbench.data.detailsEyebrow')}</p><h2>{t('workbench.data.details')}</h2><p>{t('workbench.data.detailsDescription')}</p></div>
        <div className={css.contextChips}><span>{t('workbench.data.rows', { count: data?.total ?? artifact.rowCount ?? 0 })}</span></div>
      </header>
      <section className={css.dataCard} aria-busy={loading}>
        <div className={css.detailToolbar}>
          <input
            type="search"
            value={query}
            aria-label={t('workbench.data.search')}
            placeholder={t('workbench.data.searchPlaceholder')}
            onChange={(event) => { setQuery(event.target.value); resetPage() }}
          />
          <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={(event) => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); resetPage() }}>
            <option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option>
          </select>
          <select aria-label={t('workbench.data.filterStatus')} value={fieldStatus ?? ''} onChange={(event) => { setFieldStatus(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof fieldStatus>); resetPage() }}>
            <option value="">{t('workbench.data.filterStatusAll')}</option><option value="missing">{t('workbench.data.status.missing')}</option><option value="unparseable">{t('workbench.data.status.unparseable')}</option>
          </select>
          <select aria-label={t('workbench.data.sort')} value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); resetPage() }}>
            <option value="published-desc">{t('workbench.data.sort.published')}</option><option value="amount-desc">{t('workbench.data.sort.amount')}</option><option value="deadline-asc">{t('workbench.data.sort.deadline')}</option>
          </select>
        </div>
        {failed ? (
          <div className={css.dataError} role="alert">
            <strong>{t('workbench.data.loadFailedTitle')}</strong>
            <span>{t('workbench.data.loadFailed')}</span>
            <button type="button" className={css.secondary} onClick={() => { setRequestVersion(value => value + 1) }}>{t('workbench.data.retry')}</button>
          </div>
        ) : data === undefined ? <div className={css.dataLoading} role="status">{t('workbench.data.loading')}</div> : data.rows.length === 0 ? (
          <div className={css.dataEmpty} role="status">
            <strong>{t('workbench.data.emptyTitle')}</strong>
            <span>{t('workbench.data.emptyDescription')}</span>
          </div>
        ) : (
          <>
            {loading && <div className={css.inlineLoading} role="status">{t('workbench.data.loading')}</div>}
            <div className={css.dataTableWrap}>
              <table className={css.dataTable}>
                <thead><tr><th>{t('workbench.data.column.source')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.data.column.stage')}</th><th>{t('workbench.data.column.region')}</th><th>{t('workbench.data.column.party')}</th><th>{t('workbench.data.column.amount')}</th><th>{t('workbench.data.column.published')}</th><th>{t('workbench.data.column.deadline')}</th><th>{t('workbench.data.column.status')}</th><th>{t('workbench.data.column.action')}</th></tr></thead>
                <tbody>{data.rows.map(row => (
                  <Fragment key={row.recordId}>
                    <tr>
                      <td><span className={css.sourceTag} data-source={row.source}>{t(`workbench.data.source.${row.source}`)}</span></td>
                      <td><strong>{row.title}</strong><small>{row.projectNumber.value ?? row.sourceId}</small></td>
                      <td>{(row.stage.value ?? row.stage.original) || t('workbench.data.value.missing')}</td>
                      <td>{(row.region.value ?? row.region.original) || t('workbench.data.value.missing')}</td>
                      <td>{row.counterparty.value ?? t('workbench.data.value.missing')}</td>
                      <td>{amountDisplay(row, t)}</td>
                      <td>{dateDisplay(row, 'publishedAt', t)}</td>
                      <td>{dateDisplay(row, 'deadline', t)}</td>
                      <td><span className={css.fieldStatus} data-field-status={fieldBadgeStatus(row)}>{t(`workbench.data.status.${fieldBadgeStatus(row)}`)}</span></td>
                      <td>
                        <button
                          type="button"
                          className={css.rowAction}
                          aria-expanded={selectedRecordId === row.recordId}
                          aria-controls={recordDetailId}
                          onClick={() => { setSelectedRecordId(current => current === row.recordId ? undefined : row.recordId) }}
                        >
                          {selectedRecordId === row.recordId ? t('workbench.data.closeDetail') : t('workbench.data.openRowDetail')}
                        </button>
                      </td>
                    </tr>
                    {selectedRecordId === row.recordId && (
                      <tr className={css.recordDetailRow}>
                        <td colSpan={10}>
                          <aside id={recordDetailId} className={css.recordDetail} aria-label={t('workbench.data.recordDetail')}>
                            <header>
                              <div><span>{t(`workbench.data.source.${row.source}`)}</span><h3>{row.title}</h3></div>
                              <button type="button" className={css.secondary} onClick={() => { setSelectedRecordId(undefined) }}>{t('workbench.data.closeDetail')}</button>
                            </header>
                            <dl>
                              <div><dt>{t('workbench.data.detail.projectNumber')}</dt><dd>{(row.projectNumber.value ?? row.projectNumber.original) || t('workbench.data.value.missing')}</dd></div>
                              <div><dt>{t('workbench.data.detail.fieldStatus')}</dt><dd>{t(`workbench.data.status.${fieldBadgeStatus(row)}`)}</dd></div>
                              <div><dt>{t('workbench.data.detail.normalizedStage')}</dt><dd>{row.stage.value ?? t('workbench.data.value.missing')}</dd></div>
                              <div><dt>{t('workbench.data.detail.sourceStage')}</dt><dd>{row.stage.original || t('workbench.data.value.missing')}</dd></div>
                              <div><dt>{t('workbench.data.detail.normalizedRegion')}</dt><dd>{row.region.value ?? t('workbench.data.value.missing')}</dd></div>
                              <div><dt>{t('workbench.data.detail.sourceRegion')}</dt><dd>{row.region.original || t('workbench.data.value.missing')}</dd></div>
                            </dl>
                            {selectedSourceLink !== undefined && (
                              <a className={css.sourceLink} href={selectedSourceLink} target="_blank" rel="noreferrer">{t('workbench.data.openSource')} ↗</a>
                            )}
                          </aside>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
            <footer className={css.tableFooter}>
              <span>{t('workbench.data.pageSummary', { page: data.page, pages: maximumPage, total: data.total })}</span>
              <div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div>
            </footer>
          </>
        )}
        <div className={css.scopeNotice}>{t('workbench.data.detailBoundary')}</div>
      </section>
    </section>
  )
}
