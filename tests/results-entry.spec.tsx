// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ConversationLocationDataStore, ConversationTimelineSnapshot, ConversationTurnDataMap, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it } from 'vitest'
import { adaptTenderSearchPayload } from '../src/client/result-adapters.ts'
import type { TenderSearchTurnData } from '../src/client/result-types.ts'
import { TenderResultsEntry, type TenderResultsEntryProps } from '../src/client/TenderResultsEntry.tsx'
import { zh, type TenderKey } from '../src/client/locales.ts'
import { tenderPayload } from './result-fixtures.ts'

const t = ((key: TenderKey, values?: Record<string, unknown>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}) as unknown as TranslateNS<'tenderFilter'>

function turn(turn: number, endedAt = 1): TurnLocation {
  const value: TenderSearchTurnData = { turn, lastResultSeq: turn * 10, calls: [{ status: 'success', callId: `c-${turn}`, tool: 'mcp__qcc-tender__search_tenders', argsRaw: '{}', seq: turn * 10, result: adaptTenderSearchPayload(tenderPayload) }] }
  const data = { get: (key: keyof ConversationTurnDataMap) => key === 'tender-search' ? value : undefined } as ConversationLocationDataStore<ConversationTurnDataMap>
  const end = { seq: turn * 10 + 1, time: endedAt, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } } as TurnLocation['end']
  return { turn, start: undefined, end, status: 'closed', steps: [], data }
}
function timeline(...turns: TurnLocation[]): ConversationTimelineSnapshot {
  return { turnOrder: turns.map(value => value.turn), turns: new Map(turns.map(value => [value.turn, value])) }
}

afterEach(cleanup)

describe('TenderResultsEntry', () => {
  it('establishes a historical baseline and auto-opens a later closed search once', () => {
    let current = timeline(turn(1))
    const useSession = (<T,>(selector: (snapshot: { chat: { timeline: ConversationTimelineSnapshot } }) => T): T => selector({ chat: { timeline: current } }))
    const props = { useSession, t } as unknown as TenderResultsEntryProps
    const view = render(<TenderResultsEntry {...props} />)
    expect(screen.getByRole('button', { name: '招投标结果 · 2' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    current = timeline(turn(1), turn(2, Date.now() + 1_000))
    view.rerender(<TenderResultsEntry {...props} />)
    expect(screen.getByRole('dialog', { name: '招投标搜索结果' })).toBeTruthy()
    screen.getAllByRole('button', { name: zh['results.close'] })[0]?.click()
    view.rerender(<TenderResultsEntry {...props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
