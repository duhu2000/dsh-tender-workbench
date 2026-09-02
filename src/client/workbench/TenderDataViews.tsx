import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
import {
  MetricCard,
  PageHeader,
  ProgressMeter,
  StatePanel,
  StatusPill,
  SurfaceHeader,
} from './WorkbenchPrimitives.tsx'
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
  const missing = query.missingFieldCount ?? 0
  const unparseable = query.unparseableFieldCount ?? 0
  return (
    <section className={css.dataView} aria-label={t('workbench.data.overview')}>
      <PageHeader
        eyebrow={t('workbench.data.eyebrow')}
        title={t('workbench.data.completeTitle')}
        description={t('workbench.data.completeDescription')}
        aside={<StatusPill tone={hasFailure ? 'warning' : 'success'}>{hasFailure ? t('workbench.status.partial') : t('workbench.status.success')}</StatusPill>}
      />

      <section className={css.taskSummary} aria-label={t('workbench.data.currentTask')}>
        <span>{t('workbench.data.currentTask')}</span>
        <strong>{query.targetSummary}</strong>
        <small>{t(`workbench.query.scope.${query.scope}`)}</small>
      </section>

      {hasFailure && hasSuccess && (
        <StatePanel tone="warning" title={t('workbench.data.partialTitle')} description={t('workbench.data.partialDescription')} />
      )}
      {workflow.stages.query.status === 'failed' && (
        <StatePanel tone="danger" role="alert" title={t('workbench.data.requeryFailedTitle')} description={workflow.stages.query.errorMessage ?? t('workbench.data.requeryFailed')} />
      )}
      {query.invalidCount > 0 && (
        <StatePanel tone="danger" role="alert" title={t('workbench.data.technicalTitle')} description={t('workbench.data.technicalDescription', { count: query.invalidCount })} />
      )}

      <div className={css.metricGrid}>
        <MetricCard label={t('workbench.data.raw')} value={raw} detail={t('workbench.data.sourceSplit', { tender: sourceLoaded(workflow, 'tender'), proposed: sourceLoaded(workflow, 'proposed') })} />
        <MetricCard label={t('workbench.data.normalized')} value={query.total} detail={t('workbench.data.linked', { count: query.duplicateCount })} tone="brand" />
        <MetricCard label={t('workbench.data.missing')} value={missing} detail={t('workbench.data.missingDescription')} tone={missing > 0 ? 'warning' : 'neutral'} />
        <MetricCard label={t('workbench.data.unparseable')} value={unparseable} detail={t('workbench.data.unparseableDescription')} tone={unparseable > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className={css.overviewLayout}>
        <section className={css.dataCard}>
          <SurfaceHeader
            title={t('workbench.data.sources')}
            description={t('workbench.data.sourcesDescription')}
            action={<button type="button" className={css.secondary} onClick={onOpenDetails}>{t('workbench.data.openDetails')}</button>}
          />
          <div className={css.sourceProgressList}>
            {(['tender', 'proposed'] as const).map(source => {
              const state = query.sources[source]
              if (state === undefined) return null
              return (
                <article key={source} className={css.sourceProgress} data-source-status={state.status}>
                  <div><strong>{t(`workbench.data.source.${source}`)}</strong><StatusPill tone={state.status === 'succeeded' ? 'success' : 'danger'}>{state.status === 'succeeded' ? t('workbench.data.sourceSucceeded') : t('workbench.status.failed')}</StatusPill></div>
                  <ProgressMeter value={state.loaded} max={Math.max(1, raw)} label={t('workbench.data.loadedRecords')} />
                  {state.errorMessage === undefined ? null : <p>{state.errorMessage}</p>}
                </article>
              )
            })}
          </div>
        </section>
        <aside className={css.dataCard}>
          <SurfaceHeader title={t('workbench.data.qualityTitle')} description={t('workbench.data.qualityDescription')} />
          <dl className={css.qualityList}>
            <div><dt>{t('workbench.data.qualityNormalized')}</dt><dd>{query.total}</dd></div>
            <div><dt>{t('workbench.data.qualityLinked')}</dt><dd>{query.duplicateCount}</dd></div>
            <div data-tone={missing > 0 ? 'warning' : 'neutral'}><dt>{t('workbench.data.missing')}</dt><dd>{missing}</dd></div>
            <div data-tone={unparseable > 0 ? 'warning' : 'neutral'}><dt>{t('workbench.data.unparseable')}</dt><dd>{unparseable}</dd></div>
          </dl>
          <p className={css.scopeNotice}>{t('workbench.data.factBoundary')}</p>
        </aside>
      </div>

      <form className={css.nextSuggestion} onSubmit={(event) => { event.preventDefault(); onContinue() }}>
        <div><strong>{t('workbench.data.nextTitle')}</strong><p>{t('workbench.data.nextDescription')}</p></div>
        <div className={css.nextActions}>
          <button type="button" className={css.secondary} onClick={onRequery}>{t('workbench.data.requery')}</button>
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
          >
            <SessionWriteButtonLabel action="rules.propose" idle={t('workbench.data.continue')} t={t} write={write} />
          </button>
        </div>
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
  const recordDetailRef = useRef<HTMLElement>(null)
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

  useEffect(() => {
    if (selectedRow !== undefined) recordDetailRef.current?.focus()
  }, [selectedRow])

  return (
    <section className={css.dataView} aria-label={t('workbench.data.details')}>
      <button type="button" className={css.backButton} onClick={onBack}>← {t('workbench.data.back')}</button>
      <PageHeader
        eyebrow={t('workbench.data.detailsEyebrow')}
        title={t('workbench.data.details')}
        description={t('workbench.data.detailsDescription')}
        aside={<StatusPill tone="neutral">{t('workbench.data.rows', { count: data?.total ?? artifact.rowCount ?? 0 })}</StatusPill>}
      />
      <div className={css.detailTabs} role="group" aria-label={t('workbench.data.filterSource')}>
        {([undefined, 'tender', 'proposed'] as const).map(value => (
          <button
            key={value ?? 'all'}
            type="button"
            aria-pressed={source === value}
            onClick={() => { setSource(value); resetPage() }}
          >
            {value === undefined ? t('workbench.data.filterSourceAll') : t(`workbench.data.source.${value}`)}
          </button>
        ))}
      </div>
      <section className={css.dataCard} aria-busy={loading}>
        <div className={css.detailToolbar}>
          <input
            type="search"
            value={query}
            aria-label={t('workbench.data.search')}
            placeholder={t('workbench.data.searchPlaceholder')}
            onChange={(event) => { setQuery(event.target.value); resetPage() }}
          />
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
            <div className={selectedRow === undefined ? css.detailWorkspace : `${css.detailWorkspace} ${css.detailWorkspaceOpen}`}>
              <div className={css.dataTableWrap}>
                <table className={css.dataTable}>
                  <thead><tr><th>{t('workbench.data.column.source')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.data.column.stage')}</th><th>{t('workbench.data.column.region')}</th><th>{t('workbench.data.column.party')}</th><th>{t('workbench.data.column.amount')}</th><th>{t('workbench.data.column.published')}</th><th>{t('workbench.data.column.deadline')}</th><th>{t('workbench.data.column.status')}</th><th>{t('workbench.data.column.action')}</th></tr></thead>
                  <tbody>{data.rows.map(row => (
                    <tr key={row.recordId} data-row-selected={selectedRecordId === row.recordId ? 'true' : 'false'}>
                      <td data-label={t('workbench.data.column.source')}><span className={css.sourceTag} data-source={row.source}>{t(`workbench.data.source.${row.source}`)}</span></td>
                      <td data-label={t('workbench.data.column.project')}><strong>{row.title}</strong><small>{row.projectNumber.value ?? row.sourceId}</small></td>
                      <td data-label={t('workbench.data.column.stage')}>{(row.stage.value ?? row.stage.original) || t('workbench.data.value.missing')}</td>
                      <td data-label={t('workbench.data.column.region')}>{(row.region.value ?? row.region.original) || t('workbench.data.value.missing')}</td>
                      <td data-label={t('workbench.data.column.party')}>{row.counterparty.value ?? t('workbench.data.value.missing')}</td>
                      <td data-label={t('workbench.data.column.amount')}>{amountDisplay(row, t)}</td>
                      <td data-label={t('workbench.data.column.published')}>{dateDisplay(row, 'publishedAt', t)}</td>
                      <td data-label={t('workbench.data.column.deadline')}>{dateDisplay(row, 'deadline', t)}</td>
                      <td data-label={t('workbench.data.column.status')}><span className={css.fieldStatus} data-field-status={fieldBadgeStatus(row)}>{t(`workbench.data.status.${fieldBadgeStatus(row)}`)}</span></td>
                      <td data-label={t('workbench.data.column.action')}>
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
                  ))}</tbody>
                </table>
              </div>
              {selectedRow !== undefined && (
                <aside ref={recordDetailRef} id={recordDetailId} className={css.recordDetail} tabIndex={-1} aria-label={t('workbench.data.recordDetail')}>
                  <header>
                    <div><StatusPill tone={selectedRow.source === 'tender' ? 'brand' : 'warning'}>{t(`workbench.data.source.${selectedRow.source}`)}</StatusPill><h3>{selectedRow.title}</h3></div>
                    <button type="button" className={css.iconButton} aria-label={t('workbench.data.closeDetail')} onClick={() => { setSelectedRecordId(undefined) }}>×</button>
                  </header>
                  <p className={css.detailLead}>{selectedRow.counterparty.value ?? t('workbench.data.value.missing')} · {amountDisplay(selectedRow, t)}</p>
                  <dl>
                    <div><dt>{t('workbench.data.detail.projectNumber')}</dt><dd>{(selectedRow.projectNumber.value ?? selectedRow.projectNumber.original) || t('workbench.data.value.missing')}</dd></div>
                    <div><dt>{t('workbench.data.detail.fieldStatus')}</dt><dd><StatusPill tone={fieldBadgeStatus(selectedRow) === 'normalized' ? 'success' : 'warning'}>{t(`workbench.data.status.${fieldBadgeStatus(selectedRow)}`)}</StatusPill></dd></div>
                    <div><dt>{t('workbench.data.detail.normalizedStage')}</dt><dd>{selectedRow.stage.value ?? t('workbench.data.value.missing')}</dd></div>
                    <div><dt>{t('workbench.data.detail.sourceStage')}</dt><dd>{selectedRow.stage.original || t('workbench.data.value.missing')}</dd></div>
                    <div><dt>{t('workbench.data.detail.normalizedRegion')}</dt><dd>{selectedRow.region.value ?? t('workbench.data.value.missing')}</dd></div>
                    <div><dt>{t('workbench.data.detail.sourceRegion')}</dt><dd>{selectedRow.region.original || t('workbench.data.value.missing')}</dd></div>
                    <div><dt>{t('workbench.data.column.published')}</dt><dd>{dateDisplay(selectedRow, 'publishedAt', t)}</dd></div>
                    <div><dt>{t('workbench.data.column.deadline')}</dt><dd>{dateDisplay(selectedRow, 'deadline', t)}</dd></div>
                  </dl>
                  {selectedSourceLink !== undefined && (
                    <a className={css.sourceLink} href={selectedSourceLink} target="_blank" rel="noreferrer">{t('workbench.data.openSource')} ↗</a>
                  )}
                </aside>
              )}
            </div>
            <footer className={css.tableFooter}>
              <span>{t('workbench.data.pageSummary', { page: data.page, pages: maximumPage, total: data.total })}</span>
              <div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div>
            </footer>
          </>
        )}
        <p className={css.scopeNotice}>{t('workbench.data.detailBoundary')}</p>
      </section>
    </section>
  )
}
