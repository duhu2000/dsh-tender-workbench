import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { closeTenderDrawer, openTenderDrawer, subscribeTenderDrawers } from './drawer-coordinator.ts'
import { mergeTurnSearchResults } from './result-summary.ts'
import { TenderResultsPanel, type TenderSearchHistory } from './TenderResultsPanel.tsx'
import css from './tender-results.module.css'

export type TenderResultsEntryProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'tenderFilter'>

export function TenderResultsEntry({ useSession, t }: TenderResultsEntryProps) {
  const timeline = useSession(snapshot => snapshot.chat.timeline)
  const histories = useMemo<TenderSearchHistory[]>(() => timeline.turnOrder.flatMap(turn => {
    const location = timeline.turns.get(turn)
    const data = location?.data.get('tender-search')
    return location === undefined || data === undefined || data.lastResultSeq === undefined ? [] : [{ location, data }]
  }), [timeline])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const mountedAt = useRef(Date.now())
  const baselineTurn = useRef<number>()
  const openedTurns = useRef(new Set<number>())
  const [open, setOpen] = useState(false)
  const [selectedTurn, setSelectedTurn] = useState<number>()

  useEffect(() => subscribeTenderDrawers(kind => { if (kind === 'filter') setOpen(false) }), [])
  useEffect(() => () => { closeTenderDrawer('results') }, [])
  useEffect(() => {
    const latestTurn = timeline.turnOrder.at(-1) ?? 0
    if (baselineTurn.current === undefined) { baselineTurn.current = latestTurn; return }
    const next = histories.findLast(history => history.data.turn > (baselineTurn.current ?? 0)
      && history.location.status === 'closed'
      && history.location.end !== undefined
      && history.location.end.time >= mountedAt.current
      && !openedTurns.current.has(history.data.turn))
    if (next === undefined) return
    openedTurns.current.add(next.data.turn)
    baselineTurn.current = Math.max(baselineTurn.current, next.data.turn)
    setSelectedTurn(next.data.turn)
    setOpen(true)
    openTenderDrawer('results')
  }, [histories, timeline.turnOrder])

  if (histories.length === 0) return null
  const latest = histories.at(-1)
  if (latest === undefined) return null
  const latestMerged = mergeTurnSearchResults(latest.data.calls)
  const loaded = latestMerged.tenders.length + latestMerged.proposed.length
  const close = (): void => { setOpen(false); closeTenderDrawer('results'); triggerRef.current?.focus() }
  const show = (): void => { setSelectedTurn(latest.data.turn); setOpen(true); openTenderDrawer('results') }
  return (
    <>
      <button ref={triggerRef} type="button" className={css.headerTrigger} aria-haspopup="dialog" aria-expanded={open} onClick={show}>{t('results.trigger', { count: loaded })}</button>
      {open && <TenderResultsPanel histories={histories} selectedTurn={selectedTurn ?? latest.data.turn} onSelectTurn={setSelectedTurn} onClose={close} t={t} />}
    </>
  )
}
