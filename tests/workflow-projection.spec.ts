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

function turnEnd(seq: number): SessionEvent {
  return {
    seq,
    time: Date.UTC(2026, 7, 31) + seq,
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
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
  it('keeps the read-only report-context tool outside the mutating Projection state machine', () => {
    const current: TenderWorkflowProjectionV1 = {
      ...createEmptyTenderWorkflowProjection(), revision: 8, currentStage: 'review',
    }
    expect(tenderWorkflowProjectionDefinition.apply(
      current,
      call(1, 'report-context', 'tender_workbench_get_report_context', 'report-command'),
    )).toBe(current)
  })

  it('settles a read-only analysis batch before adopting the same user command commit', () => {
    const current: TenderWorkflowProjectionV1 = {
      ...createEmptyTenderWorkflowProjection(),
      revision: 4,
      currentStage: 'classification',
    }
    const reading = tenderWorkflowProjectionDefinition.apply(
      current,
      call(1, 'analysis-next', 'tender_workbench_analysis_next', 'analysis-command'),
    )
    expect(reading?.stages.analysis.status).toBe('running')
    const readSettled = tenderWorkflowProjectionDefinition.apply(
      reading,
      result(2, 'analysis-next', meta('analysis-command', 'tender_workbench_analysis_next', current)),
    )
    expect(readSettled).toEqual(current)

    const committing = tenderWorkflowProjectionDefinition.apply(
      readSettled,
      call(3, 'analysis-commit', 'tender_workbench_analysis_commit', 'analysis-command'),
    )
    const completed: TenderWorkflowProjectionV1 = {
      ...current,
      revision: 5,
      currentStage: 'analysis',
      stages: { ...current.stages, analysis: { status: 'succeeded' } },
      analysis: {
        version: 'analysis-v1', activeDatasetId: 'data-v1',
        eligibleTotal: 2, completed: 1, priorityReview: 1, watch: 0, notRecommended: 0, urgent: 0,
      },
    }
    expect(tenderWorkflowProjectionDefinition.apply(
      committing,
      result(4, 'analysis-commit', meta('analysis-command', 'tender_workbench_analysis_commit', completed)),
    )).toEqual(completed)
  })

  it('marks a partial all-eligible analysis as resumable when the Agent turn ends', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const partial: TenderWorkflowProjectionV1 = {
      ...empty,
      revision: 5,
      currentStage: 'analysis',
      stages: { ...empty.stages, analysis: { status: 'running' } },
      analysis: {
        version: 'analysis-v1', activeDatasetId: 'data-v1',
        eligibleTotal: 15, completed: 12, priorityReview: 3, watch: 7, notRecommended: 2, urgent: 1,
      },
    }
    const interrupted = tenderWorkflowProjectionDefinition.apply(partial, turnEnd(10))
    expect(interrupted).toMatchObject({
      revision: 5,
      stages: { analysis: { status: 'failed', errorCode: 'analysis-incomplete', errorMessage: expect.stringContaining('12/15') } },
      lastFailure: { command: 'tender_workbench_analysis_commit', code: 'analysis-incomplete', message: expect.stringContaining('12/15') },
    })
    expect(tenderWorkflowProjectionDefinition.apply(interrupted, turnEnd(11))).toBe(interrupted)
  })

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
    const empty = createEmptyTenderWorkflowProjection()
    const current = {
      ...empty,
      revision: 2,
      currentStage: 'overview' as const,
      stages: {
        ...empty.stages,
        query: { status: 'succeeded' as const },
        overview: { status: 'succeeded' as const },
      },
    }
    const pending = tenderWorkflowProjectionDefinition.apply(current, call(1, 'call-1', 'tender_workbench_query'))
    const stale = { ...createEmptyTenderWorkflowProjection(), revision: 1 }
    const settled = tenderWorkflowProjectionDefinition.apply(
      pending,
      result(2, 'call-1', meta('command-1', 'tender_workbench_query', stale)),
    )
    expect(settled?.revision).toBe(2)
    expect(settled?.activeOperation).toBeUndefined()
    expect(settled?.currentStage).toBe('overview')
    expect(settled?.stages.query.status).toBe('succeeded')
    expect(tenderWorkflowProjectionDefinition.apply(settled, call(3, 'other', 'search_companies'))).toBe(settled)
    expect(tenderWorkflowProjectionDefinition.apply(settled, result(4, 'other', undefined))).toBe(settled)
  })

  it('adopts the first completed state for a same-command idempotent retry', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const completed: TenderWorkflowProjectionV1 = {
      ...empty,
      revision: 2,
      currentStage: 'overview',
      stages: {
        ...empty.stages,
        query: { status: 'succeeded' },
        overview: { status: 'succeeded' },
      },
    }
    const retry = tenderWorkflowProjectionDefinition.apply(
      completed,
      call(3, 'retry-call', 'tender_workbench_query', 'command-1'),
    )
    expect(retry?.stages.query.status).toBe('running')

    const settled = tenderWorkflowProjectionDefinition.apply(
      retry,
      result(4, 'retry-call', meta('command-1', 'tender_workbench_query', completed)),
    )
    expect(settled).toEqual(completed)
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

  it('keeps the newest active dataset across refresh replay, historical prepends, and a late old result', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const artifact = (id: string) => ({
      id,
      kind: 'normalized-data' as const,
      fileName: `${id}.json`,
      mediaType: 'application/json',
      rowCount: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      accessToken: `${id}-token`,
    })
    const querySpec = {
      id: 'query-spec', kind: 'query-spec' as const, fileName: 'query.json', mediaType: 'application/json',
      createdAt: '2026-09-01T00:00:00.000Z', accessToken: 'query-token',
    }
    const oldState: TenderWorkflowProjectionV1 = {
      ...empty,
      revision: 1,
      currentStage: 'overview',
      query: { scope: 'tender', targetSummary: 'old', querySpec, sources: { tender: { status: 'succeeded', loaded: 1 } }, normalizedData: artifact('old-data'), total: 1, duplicateCount: 0, invalidCount: 0 },
    }
    const newState: TenderWorkflowProjectionV1 = {
      ...oldState,
      revision: 2,
      query: { ...oldState.query!, targetSummary: 'new', normalizedData: artifact('new-data') },
    }
    const history = [
      call(1, 'old-call', 'tender_workbench_query', 'old-command'),
      result(2, 'old-call', meta('old-command', 'tender_workbench_query', oldState)),
      call(3, 'new-call', 'tender_workbench_query', 'new-command'),
      result(4, 'new-call', meta('new-command', 'tender_workbench_query', newState)),
    ]
    expect(fold(history)?.query?.normalizedData?.id).toBe('new-data')
    expect(fold(history)).toEqual(fold([...history]))

    const pendingOld = tenderWorkflowProjectionDefinition.apply(newState, call(5, 'late-old', 'tender_workbench_query', 'old-command'))
    const afterLate = tenderWorkflowProjectionDefinition.apply(
      pendingOld,
      result(6, 'late-old', meta('old-command', 'tender_workbench_query', oldState)),
    )
    expect(afterLate?.revision).toBe(2)
    expect(afterLate?.query?.normalizedData?.id).toBe('new-data')
  })

  it('does not let a late historical S3 confirmation reactivate old rules or classification after a new query', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const now = '2026-09-01T00:00:00.000Z'
    const artifact = (id: string, kind: 'query-spec' | 'normalized-data' | 'rule-set' | 'classified-data') => ({
      id, kind, fileName: `${id}.json`, mediaType: 'application/json', createdAt: now, accessToken: `${id}-token`,
    })
    const newQuery: TenderWorkflowProjectionV1 = {
      ...empty,
      revision: 5,
      currentStage: 'overview',
      stages: { ...empty.stages, query: { status: 'succeeded' }, overview: { status: 'succeeded' } },
      query: {
        scope: 'tender', targetSummary: 'new', querySpec: artifact('query-new', 'query-spec'),
        sources: { tender: { status: 'succeeded', loaded: 1 } }, normalizedData: artifact('data-new', 'normalized-data'),
        total: 1, duplicateCount: 0, invalidCount: 0,
      },
    }
    const oldConfirmed: TenderWorkflowProjectionV1 = {
      ...newQuery,
      revision: 4,
      currentStage: 'classification',
      rules: { confirmed: artifact('rules-old', 'rule-set'), ruleSetVersion: 'rsv-old', ruleCount: 1, rawMatches: 1, covered: 1, conflicts: 0 },
      classification: {
        data: artifact('classified-old', 'classified-data'), include: 1, observe: 0, manualReview: 0, exclude: 0,
        unmatched: 0, covered: 1, conflicts: 0, ruleSetVersion: 'rsv-old', activeDatasetId: 'data-old',
      },
    }
    const pending = tenderWorkflowProjectionDefinition.apply(
      newQuery,
      call(10, 'late-confirm', 'tender_workbench_confirm_rules', 'old-confirm-command'),
    )
    const settled = tenderWorkflowProjectionDefinition.apply(
      pending,
      result(11, 'late-confirm', meta('old-confirm-command', 'tender_workbench_confirm_rules', oldConfirmed)),
    )
    expect(settled?.revision).toBe(5)
    expect(settled?.query?.normalizedData?.id).toBe('data-new')
    expect(settled?.rules).toBeUndefined()
    expect(settled?.classification).toBeUndefined()
  })
})
