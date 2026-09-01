import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  createEmptyTenderWorkflowProjection,
  type TenderCommandKind,
  type TenderWorkflowProjectionV1,
} from '../src/contracts/workflow.ts'
import { tenderWorkflowProjectionDefinition } from '../src/host/projection.ts'

function call(seq: number, callId: string, name: string, commandId = 'command-1'): SessionEvent {
  return {
    seq,
    time: Date.UTC(2026, 7, 31) + seq,
    type: 'tool/call',
    data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify({ commandId }) },
  } as unknown as SessionEvent
}

function result(
  seq: number,
  callId: string,
  meta: unknown,
  options: { readonly error?: boolean; readonly text?: string } = {},
): SessionEvent {
  return {
    seq,
    time: Date.UTC(2026, 7, 31) + seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: {
        source: { type: 'tool-result', callId },
        content: [{
          type: 'tool-result',
          content: [{ type: 'text', text: options.text ?? 'ok' }],
          ...(options.error === true ? { isError: true } : {}),
        }],
      },
      meta,
    },
  } as unknown as SessionEvent
}

function meta(
  commandId: string,
  command: TenderCommandKind,
  state: TenderWorkflowProjectionV1,
): unknown {
  return { domain: 'dsh-tender-workbench', schemaVersion: 1, commandId, command, state }
}

function fold(events: readonly SessionEvent[]): TenderWorkflowProjectionV1 | null {
  return events.reduce<TenderWorkflowProjectionV1 | null>(
    (state, event) => tenderWorkflowProjectionDefinition.apply(state, event),
    tenderWorkflowProjectionDefinition.init(),
  )
}

describe('tenderWorkflowProjectionDefinition', () => {
  it('tracks an exact call and adopts only a validated newer whole state', () => {
    const pending = fold([call(1, 'call-1', 'tender_workbench_query')])
    expect(pending).toMatchObject({
      revision: 0,
      currentStage: 'query',
      activeOperation: { callId: 'call-1', commandId: 'command-1' },
    })
    expect(pending?.stages.query.status).toBe('running')

    const completed: TenderWorkflowProjectionV1 = {
      ...createEmptyTenderWorkflowProjection(),
      revision: 1,
      currentStage: 'overview',
      stages: {
        ...createEmptyTenderWorkflowProjection().stages,
        query: { status: 'succeeded' as const },
        overview: { status: 'succeeded' as const },
      },
    }
    const final = tenderWorkflowProjectionDefinition.apply(
      pending,
      result(2, 'call-1', meta('command-1', 'tender_workbench_query', completed)),
    )
    expect(final).toEqual(completed)
  })

  it('does not regress on a late duplicate and ignores unrelated calls/results by reference', () => {
    const current = { ...createEmptyTenderWorkflowProjection(), revision: 2 }
    const pending = tenderWorkflowProjectionDefinition.apply(current, call(1, 'call-1', 'tender_workbench_query'))
    const stale = { ...createEmptyTenderWorkflowProjection(), revision: 1 }
    const settled = tenderWorkflowProjectionDefinition.apply(
      pending,
      result(2, 'call-1', meta('command-1', 'tender_workbench_query', stale)),
    )
    expect(settled?.revision).toBe(2)
    expect(settled?.activeOperation).toBeUndefined()
    expect(tenderWorkflowProjectionDefinition.apply(settled, call(3, 'other', 'search_companies'))).toBe(settled)
    expect(tenderWorkflowProjectionDefinition.apply(settled, result(4, 'other', undefined))).toBe(settled)
  })

  it('preserves prior facts and exposes bounded failure for invalid or failed results', () => {
    const existing = { ...createEmptyTenderWorkflowProjection(), revision: 3 }
    const pending = tenderWorkflowProjectionDefinition.apply(existing, call(1, 'call-1', 'tender_workbench_generate_report', 'report-1'))
    const invalid = tenderWorkflowProjectionDefinition.apply(pending, result(2, 'call-1', { invalid: true }))
    expect(invalid).toMatchObject({
      revision: 3,
      stages: { report: { status: 'failed', errorCode: 'invalid-tool-meta' } },
    })

    const pendingAgain = tenderWorkflowProjectionDefinition.apply(invalid, call(3, 'call-2', 'tender_workbench_generate_report', 'report-2'))
    const failed = tenderWorkflowProjectionDefinition.apply(
      pendingAgain,
      result(4, 'call-2', undefined, { error: true, text: '\u0000permission denied' }),
    )
    expect(failed).toMatchObject({
      revision: 3,
      lastFailure: { command: 'tender_workbench_generate_report', code: 'tool-failed', message: 'permission denied' },
    })
  })

  it('replays to the same value as an incremental fold', () => {
    const state = { ...createEmptyTenderWorkflowProjection(), revision: 1, currentStage: 'rules' as const }
    const events = [
      call(1, 'call-1', 'tender_workbench_query'),
      result(2, 'call-1', meta('command-1', 'tender_workbench_query', state)),
    ]
    const replay = fold(events)
    let live: TenderWorkflowProjectionV1 | null = null
    for (const event of events) live = tenderWorkflowProjectionDefinition.apply(live, event)
    expect(live).toEqual(replay)
  })
})
