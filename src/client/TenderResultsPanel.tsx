import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import type { TenderTranslate } from './fields/field-props.ts'
import { deriveLoadedSummary, mergeTurnSearchResults, type DistributionItem } from './result-summary.ts'
import type { ProposedItem, SearchEntity, TenderItem, TenderSearchTurnData } from './result-types.ts'
import css from './tender-results.module.css'

export interface TenderSearchHistory {
  readonly location: TurnLocation
  readonly data: Readonly<TenderSearchTurnData>
}

export interface TenderResultsPanelProps {
  readonly histories: readonly TenderSearchHistory[]
  readonly selectedTurn: number
  readonly onSelectTurn: (turn: number) => void
  readonly onClose: () => void
  readonly t: TenderTranslate
}

function dash(value: string): string { return value.trim() === '' ? '—' : value }
function entityNames(values: readonly SearchEntity[]): string { return values.length === 0 ? '—' : values.map(value => value.name).join('、') }
function formatMoney(value: string, t: TenderTranslate): string {
  if (value.trim() === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? t('results.currency', { amount: new Intl.NumberFormat().format(amount) }) : value
}
function formatCompleted(history: TenderSearchHistory): string {
  const time = history.location.end?.time
  return time === undefined ? `Turn ${history.data.turn}` : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(time))
}
function Distribution({ title, items, t }: { readonly title: string; readonly items: readonly DistributionItem[]; readonly t: TenderTranslate }) {
  return <div className={css.distribution}><strong>{title}</strong><div>{items.length === 0 ? t('results.noStats') : items.map(item => <span key={item.label}>{item.label}<b>{item.count}</b></span>)}</div></div>
}

function TenderCard({ item, t }: { readonly item: TenderItem; readonly t: TenderTranslate }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className={css.resultCard}>
      <div className={css.resultTitleRow}><h3>{item.title}</h3><time>{dash(item.publishedAt)}</time></div>
      <div className={css.tags}>{item.infoType !== '' && <span>{item.infoType}</span>}{item.status !== '' && <span>{item.status}</span>}</div>
      <dl className={css.factGrid}>
        <div><dt>{t('results.region')}</dt><dd>{dash(item.region)}</dd></div><div><dt>{t('results.purchaser')}</dt><dd>{entityNames(item.purchasers)}</dd></div>
        <div><dt>{t('results.winner')}</dt><dd>{entityNames(item.winners)}</dd></div><div><dt>{t('results.tenderAmounts')}</dt><dd>{formatMoney(item.budgetAmount, t)} / {formatMoney(item.winningAmount, t)}</dd></div>
        <div><dt>{t('results.deadline')}</dt><dd>{dash(item.deadline)}</dd></div>
      </dl>
      <button type="button" className={css.expandButton} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>{expanded ? t('results.collapse') : t('results.expand', { title: item.title })}</button>
      {expanded && <dl className={css.detailGrid}>
        <div><dt>{t('results.agency')}</dt><dd>{entityNames(item.agencies)}</dd></div><div><dt>{t('results.procurementMethod')}</dt><dd>{dash(item.procurementMethod)}</dd></div>
        <div><dt>{t('results.procurementType')}</dt><dd>{dash(item.procurementType)}</dd></div><div><dt>{t('results.industries')}</dt><dd>{item.industries.join('、') || '—'}</dd></div>
        <div><dt>{t('results.projectNumber')}</dt><dd>{dash(item.projectNumber)}</dd></div><div><dt>{t('results.products')}</dt><dd>{item.products.join('、') || '—'}</dd></div>
        <div><dt>{t('results.tenderId')}</dt><dd>{item.id}</dd></div>
      </dl>}
    </article>
  )
}

function ProposedCard({ item, t }: { readonly item: ProposedItem; readonly t: TenderTranslate }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className={css.resultCard}>
      <div className={css.resultTitleRow}><h3>{item.title}</h3><time>{dash(item.publishedAt)}</time></div>
      <div className={css.tags}>{item.stage !== '' && <span>{item.stage}</span>}{item.approvalStatus !== '' && <span>{item.approvalStatus}</span>}</div>
      <dl className={css.factGrid}>
        <div><dt>{t('results.region')}</dt><dd>{dash(item.region)}</dd></div><div><dt>{t('results.investment')}</dt><dd>{formatMoney(item.investmentAmount, t)}</dd></div>
        <div><dt>{t('results.builder')}</dt><dd>{entityNames(item.builders)}</dd></div><div><dt>{t('results.approver')}</dt><dd>{entityNames(item.approvers)}</dd></div>
      </dl>
      <button type="button" className={css.expandButton} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>{expanded ? t('results.collapse') : t('results.expand', { title: item.title })}</button>
      {expanded && <dl className={css.detailGrid}><div><dt>{t('results.projectNumber')}</dt><dd>{dash(item.projectNumber)}</dd></div><div><dt>{t('results.proposedId')}</dt><dd>{item.id}</dd></div></dl>}
    </article>
  )
}

export function TenderResultsPanel({ histories, selectedTurn, onSelectTurn, onClose, t }: TenderResultsPanelProps) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const lastRef = useRef<HTMLButtonElement>(null)
  const tabByTurn = useRef(new Map<number, 'summary' | 'list'>())
  const [tab, setTabState] = useState<'summary' | 'list'>(() => tabByTurn.current.get(selectedTurn) ?? 'summary')
  const selected = histories.find(history => history.data.turn === selectedTurn) ?? histories.at(-1)
  const merged = mergeTurnSearchResults(selected?.data.calls ?? [])
  const loaded = deriveLoadedSummary(merged)
  const setTab = (value: 'summary' | 'list'): void => { tabByTurn.current.set(selectedTurn, value); setTabState(value) }

  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => { setTabState(tabByTurn.current.get(selectedTurn) ?? 'summary') }, [selectedTurn])
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [])
  if (selected === undefined) return null

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (event.target as HTMLElement).getAttribute('role') === 'tab') {
      event.preventDefault(); setTab(tab === 'summary' ? 'list' : 'summary'); return
    }
    if (event.key === 'Tab' && !event.shiftKey && document.activeElement === lastRef.current) { event.preventDefault(); titleRef.current?.focus() }
    else if (event.key === 'Tab' && event.shiftKey && document.activeElement === titleRef.current) { event.preventDefault(); lastRef.current?.focus() }
  }
  const type = t(merged.tenders.length > 0 ? 'results.tenderTitle' : 'results.proposedTitle')
  return createPortal(
    <div className={css.backdrop} data-dsh-plugin="tender-workbench" data-dsh-part="results-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keyDown}>
        <header className={css.header}>
          <div><h2 ref={titleRef} tabIndex={-1} id={titleId}>{type}</h2><p>{t('results.completedMeta', { time: formatCompleted(selected), count: merged.tenders.length + merged.proposed.length })}</p></div>
          <div className={css.headerActions}>
            <label><span>{t('results.turn')}</span><select value={selectedTurn} onChange={event => { onSelectTurn(Number(event.target.value)) }}>{histories.map(history => <option key={history.data.turn} value={history.data.turn}>{t('results.turnOption', { time: formatCompleted(history), count: mergeTurnSearchResults(history.data.calls).tenders.length + mergeTurnSearchResults(history.data.calls).proposed.length })}</option>)}</select></label>
            <button type="button" aria-label={t('results.close')} onClick={onClose}><IconCloseOutline16 size={18} /></button>
          </div>
        </header>
        <div className={css.tabs} role="tablist" aria-label={t('results.tabs')}>
          <button type="button" role="tab" aria-selected={tab === 'summary'} onClick={() => { setTab('summary') }}>{t('results.summary')}</button>
          <button type="button" role="tab" aria-selected={tab === 'list'} onClick={() => { setTab('list') }}>{t('results.list')}</button>
        </div>
        <main className={css.body} role="tabpanel">
          {merged.failures.length > 0 && <div className={css.warning} role="status">{t('results.partialFailure', { count: merged.failures.length })}</div>}
          {tab === 'summary' ? <>
            {merged.successCalls.map(call => <section key={call.callId} className={css.querySummary}><h3>{t(call.result.kind === 'tender' ? 'results.tenderSummary' : 'results.proposedSummary')}</h3><div className={css.metrics}><span><b>{call.result.summary.total}</b>{t('results.hitTotal')}</span><span><b>{call.result.items.length}</b>{t('results.loaded')}</span></div><p>{call.result.summary.description || '—'}</p><details><summary>{t('results.effectiveFilters')}</summary><pre>{JSON.stringify(call.result.summary.filters, null, 2)}</pre></details></section>)}
            {merged.successCalls.length > 0 && <section className={css.loadedSummary}><h3>{t('results.loadedSummary')}</h3><div className={css.metrics}><span><b>{loaded.loadedCount}</b>{t('results.loadedCount')}</span><span><b>{loaded.amountPresent}/{loaded.loadedCount}</b>{t('results.amountCoverage')}</span>{merged.tenders.length > 0 && <span><b>{loaded.nearestPendingDeadline ?? t('results.noPendingDeadline')}</b>{t('results.nearestPendingDeadline')}</span>}</div><Distribution title={t('results.regionDistribution')} items={loaded.regions} t={t} />{loaded.infoTypes !== undefined && <Distribution title={t('results.infoTypeDistribution')} items={loaded.infoTypes} t={t} />}{loaded.statuses !== undefined && <Distribution title={t('results.statusDistribution')} items={loaded.statuses} t={t} />}{loaded.stages !== undefined && <Distribution title={t('results.stageDistribution')} items={loaded.stages} t={t} />}{loaded.approvalStatuses !== undefined && <Distribution title={t('results.approvalDistribution')} items={loaded.approvalStatuses} t={t} />}{loaded.invalidItemCount > 0 && <p className={css.warning}>{t('results.invalidItems', { count: loaded.invalidItemCount })}</p>}</section>}
            {merged.successCalls.length === 0 && merged.failures.map(call => <section key={call.callId} className={css.errorState}><h3>{t(call.status === 'error' ? 'results.searchFailed' : 'results.incompatible')}</h3><p>{call.status === 'error' ? call.message : call.reason}</p>{call.status === 'incompatible' && call.rawPreview !== '' && <pre>{call.rawPreview}</pre>}</section>)}
          </> : <div className={css.resultsList}>{merged.tenders.map(item => <TenderCard key={`tender:${item.id}`} item={item} t={t} />)}{merged.proposed.map(item => <ProposedCard key={`proposed:${item.id}`} item={item} t={t} />)}{merged.tenders.length + merged.proposed.length === 0 && <p className={css.empty}>{t('results.empty')}</p>}</div>}
        </main>
        <footer className={css.footer}><span>{t('results.loadedScope')}</span><button ref={lastRef} type="button" onClick={onClose}>{t('results.close')}</button></footer>
      </div>
    </div>, document.body,
  )
}
