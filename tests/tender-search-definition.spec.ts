// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type {
  ConversationContextReader,
  ConversationEventInput,
  ConversationLocationData,
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { tenderSearchDefinition } from '../src/client/tender-search-definition.ts'
import type { TenderSearchTurnData } from '../src/client/result-types.ts'
import { tenderPayload } from './result-fixtures.ts'

class DefinitionHarness<State> {
  private matches: ConversationMatch[] = []
  private state: State | undefined

  constructor(private readonly definition: ConversationNodeDefinition<State>) {}

  append(input: ConversationEventInput): void {
    const accepted = this.definition.match(input.event)
    if (accepted === null) return
    const match = {
      ...input,
      role: accepted.role,
      location: { kind: 'unresolved' },
    } as ConversationMatch
    this.matches.push(match)
    if (accepted.role === 'start') {
      const reader: ConversationContextReader = { previous: () => undefined }
      this.state = this.definition.start(this.context(), match, reader)
    } else if (this.state !== undefined) {
      this.state = this.definition.update(this.context() as ConversationNodeContext<State> & { readonly state: State }, match)
    }
  }

  replaceWindow(inputs: readonly ConversationEventInput[]): void {
    this.matches = []
    this.state = undefined
    for (const input of [...inputs].sort((left, right) => left.event.seq - right.event.seq)) this.append(input)
  }

  turnData(): TenderSearchTurnData | undefined {
    const published = this.definition.buildLocationData?.(this.context(), 'turn') as ConversationLocationData | null | undefined
    return published?.value as TenderSearchTurnData | undefined
  }

  private context(): ConversationNodeContext<State> {
    return {
      key: `${this.definition.kind}:1`,
      kind: this.definition.kind,
      id: '1',
      matches: this.matches,
      start: this.matches.find(match => match.role === 'start'),
      state: this.state,
      current: new Map(),
    }
  }
}

function event(seq: number, type: string, data: unknown, append = false): ConversationEventInput {
  return { event: { seq, time: seq * 1000, type, data, ...(append ? { surfaceOp: 'append' } : {}) } as ConversationEventInput['event'], view: undefined }
}
function result(seq: number, callId: string, text: string, isError = false, append = true): ConversationEventInput {
  return event(seq, 'tool/result', { turn: 1, step: 1, message: { source: { type: 'tool-result', callId }, content: [{ type: 'tool-result', content: [{ type: 'text', text }], isError }] } }, append)
}
function assemble(entries: readonly ConversationEventInput[], incremental = false): TenderSearchTurnData | undefined {
  const assembler = new DefinitionHarness(tenderSearchDefinition)
  if (incremental) {
    for (const entry of entries) assembler.append(entry)
  } else {
    assembler.replaceWindow(entries)
  }
  return assembler.turnData()
}
function fixtureEntries(): readonly ConversationEventInput[] {
  return [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'tool/call', { turn: 1, step: 1, callId: 'ignored', name: 'search_companies', arguments: '{}' }),
    event(3, 'tool/call', { turn: 1, step: 1, callId: 'qcc-1', name: 'mcp__qcc-tender__search_tenders', arguments: '{"beginDate":"2026-01-01"}' }),
    result(4, 'ignored', '{}'),
    result(5, 'qcc-1', JSON.stringify(tenderPayload)),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('tenderSearchDefinition', () => {
  it('pairs exact qcc tools by callId and publishes normalized Turn data', () => {
    const data = assemble(fixtureEntries())
    expect(data?.calls).toHaveLength(1)
    expect(data?.calls[0]).toMatchObject({ callId: 'qcc-1', status: 'success', seq: 5 })
    expect(data?.lastResultSeq).toBe(5)
    expect(data?.calls[0]?.status === 'success' && data.calls[0].result.items[0]?.id).toBe('t-1')
  })

  it('replays to the same projection as live append', () => {
    const replay = assemble(fixtureEntries())
    const live = assemble(fixtureEntries(), true)
    expect(live).toEqual(replay)
  })

  it('records tool errors and incompatible payloads without throwing', () => {
    const entries = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'tool/call', { turn: 1, step: 1, callId: 'failed', name: 'mcp__qcc-tender__search_tenders', arguments: '{}' }),
      result(3, 'failed', '\u0000permission denied', true),
      event(4, 'tool/call', { turn: 1, step: 1, callId: 'bad', name: 'mcp__qcc-tender__search_proposed_projects', arguments: '{}' }),
      result(5, 'bad', '{not-json'),
      event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const calls = assemble(entries)?.calls
    expect(calls?.[0]).toMatchObject({ status: 'error', message: 'permission denied' })
    expect(calls?.[1]).toMatchObject({ status: 'incompatible', reason: 'invalid-json', rawPreview: '{not-json' })
  })

  it('ignores replacement-surface results', () => {
    const entries = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'tool/call', { turn: 1, step: 1, callId: 'qcc', name: 'mcp__qcc-tender__search_tenders', arguments: '{}' }),
      result(3, 'qcc', JSON.stringify(tenderPayload), false, false),
      event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const data = assemble(entries)
    expect(data?.calls[0]?.status).toBe('running')
    expect(data?.lastResultSeq).toBeUndefined()
  })
})
