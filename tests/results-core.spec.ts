import { describe, expect, it } from 'vitest'
import { adaptProposedSearchPayload, adaptTenderSearchPayload, ResultContractError } from '../src/client/result-adapters.ts'
import { parseToolResultText, resultPreview, ResultParseError } from '../src/client/result-parser.ts'
import { deriveLoadedSummary, mergeTurnSearchResults } from '../src/client/result-summary.ts'
import type { TenderSearchCall } from '../src/client/result-types.ts'
import { proposedPayload, tenderPayload } from './result-fixtures.ts'

describe('qcc result parser and adapters', () => {
  it('parses text blocks and normalizes both observed result shapes', () => {
    expect(parseToolResultText([{ type: 'image' }, { type: 'text', text: JSON.stringify(tenderPayload) }])).toEqual(tenderPayload)
    const tender = adaptTenderSearchPayload(tenderPayload)
    const proposed = adaptProposedSearchPayload(proposedPayload)
    expect(tender.kind).toBe('tender')
    expect(tender.items[0]).toMatchObject({ id: 't-1', title: '数据平台招标', budgetAmount: '1000000' })
    expect(proposed.kind).toBe('proposed')
    expect(proposed.items[0]).toMatchObject({ id: 'p-1', investmentAmount: '50000000' })
  })

  it('skips invalid records but rejects an incompatible outer contract', () => {
    const adapted = adaptTenderSearchPayload({ ...tenderPayload, '标讯列表': [...tenderPayload['标讯列表'], { '标讯ID': 'bad' }] })
    expect(adapted.items).toHaveLength(2)
    expect(adapted.invalidItemCount).toBe(1)
    expect(() => adaptTenderSearchPayload({ '查询摘要': tenderPayload['查询摘要'] })).toThrow(ResultContractError)
    expect(() => adaptProposedSearchPayload({ ...proposedPayload, '查询摘要': null })).toThrow(ResultContractError)
  })

  it('isolates invalid JSON and sanitizes bounded diagnostics', () => {
    expect(() => parseToolResultText([])).toThrow(ResultParseError)
    expect(() => parseToolResultText([{ type: 'text', text: '{bad' }])).toThrow(ResultParseError)
    const preview = resultPreview(`a\u0000b${'x'.repeat(20)}`, 8)
    expect(preview).toBe('abxxxxxx…')
  })
})

describe('loaded result summary', () => {
  const success = (callId: string, seq: number, result: ReturnType<typeof adaptTenderSearchPayload>): TenderSearchCall => ({
    status: 'success', callId, seq, result, tool: 'mcp__qcc-tender__search_tenders', argsRaw: '{}',
  })

  it('deduplicates stable IDs in result order without adding hit totals', () => {
    const first = adaptTenderSearchPayload(tenderPayload)
    const second = adaptTenderSearchPayload({ ...tenderPayload, '标讯列表': [tenderPayload['标讯列表'][0]] })
    const merged = mergeTurnSearchResults([success('later', 9, second), success('first', 4, first)])
    expect(merged.tenders.map(item => item.id)).toEqual(['t-1', 't-2'])
    expect(merged.successCalls.map(call => call.seq)).toEqual([4, 9])
  })

  it('defines nearest pending deadline as the earliest parseable non-expired value', () => {
    const merged = mergeTurnSearchResults([success('one', 3, adaptTenderSearchPayload(tenderPayload))])
    const summary = deriveLoadedSummary(merged, new Date('2026-08-30T00:00:00+08:00'))
    expect(summary.loadedCount).toBe(2)
    expect(summary.amountPresent).toBe(2)
    expect(summary.nearestPendingDeadline).toBe('2026-09-05 10:00:00')
    expect(summary.regions).toEqual([{ label: '北京市', count: 1 }, { label: '上海市', count: 1 }])
  })

  it('reports no pending deadline when all loaded values have expired', () => {
    const merged = mergeTurnSearchResults([success('one', 3, adaptTenderSearchPayload(tenderPayload))])
    expect(deriveLoadedSummary(merged, new Date('2026-12-01T00:00:00+08:00')).nearestPendingDeadline).toBeUndefined()
  })
})
