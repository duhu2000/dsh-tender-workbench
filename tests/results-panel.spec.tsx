// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConversationLocationDataStore, ConversationTurnDataMap, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptTenderSearchPayload } from '../src/client/result-adapters.ts'
import type { TenderSearchTurnData } from '../src/client/result-types.ts'
import { TenderResultsPanel } from '../src/client/TenderResultsPanel.tsx'
import { zh, type TenderKey } from '../src/client/locales.ts'
import { tenderPayload } from './result-fixtures.ts'

const t = ((key: TenderKey, values?: Record<string, unknown>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}) as unknown as TranslateNS<'tenderFilter'>

function history() {
  const value: TenderSearchTurnData = {
    turn: 1, lastResultSeq: 5,
    calls: [{ status: 'success', callId: 'one', tool: 'mcp__qcc-tender__search_tenders', argsRaw: '{}', seq: 5, result: adaptTenderSearchPayload(tenderPayload) }],
  }
  const data = { get: (key: keyof ConversationTurnDataMap) => key === 'tender-search' ? value : undefined } as ConversationLocationDataStore<ConversationTurnDataMap>
  const location = { turn: 1, start: undefined, end: undefined, status: 'closed', steps: [], data } satisfies TurnLocation
  return { location, data: value }
}

afterEach(cleanup)

describe('TenderResultsPanel', () => {
  it('renders deterministic summary and only the loaded list records', () => {
    const close = vi.fn()
    render(<TenderResultsPanel histories={[history()]} selectedTurn={1} onSelectTurn={() => {}} onClose={close} t={t} />)
    expect(screen.getByRole('dialog', { name: '招投标搜索结果' })).toBeTruthy()
    expect(screen.getByText('基于本次已加载结果')).toBeTruthy()
    expect(screen.getByText('最近待截止时间')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh['results.list'] }))
    expect(screen.getByText('数据平台招标')).toBeTruthy()
    expect(screen.getByText('设备中标')).toBeTruthy()
    expect(document.querySelector('a')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开“数据平台招标”详情' }))
    expect(screen.getByText('t-1')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: zh['results.close'] })[0]!)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
