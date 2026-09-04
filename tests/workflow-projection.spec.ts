import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { TenderWorkbenchIntentV2 } from '../src/contracts/intents.ts'
import type { TenderToolNameV2 } from '../src/contracts/orchestration.ts'
import {
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV2,
} from '../src/contracts/workflow.ts'
import { serializeTenderWorkbenchIntent } from '../src/client/intents/screening-intent.ts'
import { tenderWorkflowProjectionDefinition } from '../src/host/projection.ts'

const baseTime = Date.UTC(2026, 8, 1)

function turnStart(seq = 1): SessionEvent {
  return { seq, time: baseTime + seq, type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent
}

function userMessage(seq: number, intent: TenderWorkbenchIntentV2): SessionEvent {
  return {
    seq, time: baseTime + seq, type: 'user/message',
    data: {
      turn: 1, source: { kind: 'user' },
      content: [{ type: 'text', text: serializeTenderWorkbenchIntent(intent) }],
    },
  } as unknown as SessionEvent
}

function call(seq: number, callId: string, name: TenderToolNameV2, intentId?: string): SessionEvent {
  return {
    seq, time: baseTime + seq, type: 'tool/call',
    data: {
      turn: 1, step: seq, callId, name,
      arguments: JSON.stringify({
        origin: intentId === undefined ? { kind: 'autonomous' } : { kind: 'workbench-intent', intentId },
      }),
    },
  } as unknown as SessionEvent
}

function conversationCall(
  seq: number,
  callId: string,
  name: TenderToolNameV2,
  args: Record<string, unknown> = {},
): SessionEvent {
  return {
    seq, time: baseTime + seq, type: 'tool/call',
    data: {
      turn: 1, step: seq, callId, name,
      arguments: JSON.stringify({ origin: { kind: 'conversation' }, ...args }),
    },
  } as unknown as SessionEvent
}

function result(seq: number, callId: string, meta: unknown, error?: string): SessionEvent {
  return {
    seq, time: baseTime + seq, type: 'tool/result', surfaceOp: 'append',
    data: {
      turn: 1, step: seq,
      message: {
        source: { type: 'tool-result', callId },
        content: [{
          type: 'tool-result',
          content: [{ type: 'text', text: error ?? 'ok' }],
          ...(error === undefined ? {} : { isError: true }),
        }],
      },
      meta,
    },
  } as unknown as SessionEvent
}

function turnEnd(seq: number): SessionEvent {
  return {
    seq, time: baseTime + seq, type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
  } as unknown as SessionEvent
}

function mutationMeta(input: {
  readonly tool: TenderToolNameV2
  readonly intentId: string
  readonly previousRevision: number
  readonly state: TenderWorkflowProjectionV2
  readonly control: { readonly status: 'complete' } | { readonly status: 'continue'; readonly nextTool: TenderToolNameV2 }
}) {
  return {
    domain: 'dsh-tender-workbench', schemaVersion: 2,
    tool: input.tool, intentId: input.intentId, origin: 'workbench-intent',
    effect: 'mutation', previousRevision: input.previousRevision,
    state: input.state, control: input.control,
  }
}

function readMeta(tool: TenderToolNameV2, intentId: string, revision: number) {
  return {
    domain: 'dsh-tender-workbench', schemaVersion: 2,
    tool, intentId, origin: 'workbench-intent', effect: 'read-only',
    observedRevision: revision, control: { status: 'complete' },
  }
}

function fold(events: readonly SessionEvent[]): TenderWorkflowProjectionV2 | null {
  return events.reduce<TenderWorkflowProjectionV2 | null>(
    (state, event) => tenderWorkflowProjectionDefinition.apply(state, event),
    tenderWorkflowProjectionDefinition.init(),
  )
}

const queryIntent: TenderWorkbenchIntentV2 = {
  schemaVersion: 2, intentId: 'query-intent', kind: 'query.run', skill: 'tender-workbench-query',
  binding: { projectionRevision: 0 },
  payload: { scope: 'tender', target: '数据项目', tender: { keywords: ['数据'] } },
}

describe('Tender workflow V2 Projection', () => {
  it('admits a strict Intent, requires its exact entry Tool, and adopts continuous mutation state', () => {
    const waiting = fold([turnStart(), userMessage(2, queryIntent)])
    expect(waiting).toMatchObject({
      schemaVersion: 2,
      pendingIntent: {
        intentId: 'query-intent', status: 'waiting-agent',
        expectedTool: 'tender_workbench_run_query',
      },
      stages: { query: { status: 'waiting-agent' } },
    })
    const running = tenderWorkflowProjectionDefinition.apply(
      waiting, call(3, 'query-call', 'tender_workbench_run_query', 'query-intent'),
    )
    expect(running?.activeOperation).toMatchObject({
      callId: 'query-call', intentId: 'query-intent', tool: 'tender_workbench_run_query',
      origin: 'workbench-intent', stage: 'query',
    })
    const completedState = {
      ...createEmptyTenderWorkflowProjection(),
      observedTurn: 1,
      revision: 1,
      currentStage: 'overview' as const,
      stages: {
        ...createEmptyTenderWorkflowProjection().stages,
        query: { status: 'succeeded' as const, updatedAt: '2026-09-01T00:00:00.000Z' },
        overview: { status: 'succeeded' as const, updatedAt: '2026-09-01T00:00:00.000Z' },
      },
    }
    const completed = tenderWorkflowProjectionDefinition.apply(running, result(4, 'query-call', mutationMeta({
      tool: 'tender_workbench_run_query', intentId: 'query-intent', previousRevision: 0,
      state: completedState, control: { status: 'complete' },
    })))
    expect(completed).toEqual(completedState)
    expect(completed?.pendingIntent).toBeUndefined()
  })

  it('does not allow an allowed terminal Tool to skip the required first context Tool', () => {
    const intent: TenderWorkbenchIntentV2 = {
      schemaVersion: 2, intentId: 'rules-intent', kind: 'rules.propose', skill: 'tender-workbench-screening',
      binding: { activeDatasetRef: 'data-1', projectionRevision: 1 }, payload: {},
    }
    const state = fold([
      turnStart(), userMessage(2, intent),
      call(3, 'preview-call', 'tender_workbench_preview_rules', 'rules-intent'),
      turnEnd(4),
    ])
    expect(state).toMatchObject({
      stages: { rules: { status: 'failed', errorCode: 'intent-incomplete' } },
      lastFailure: { intentId: 'rules-intent', tool: 'tender_workbench_get_rule_drafting_context' },
    })
  })

  it('records a conflicting second Intent without replacing the active Intent', () => {
    const secondIntent: TenderWorkbenchIntentV2 = {
      ...queryIntent,
      intentId: 'query-intent-2',
      payload: { scope: 'tender', target: '第二次查询', tender: { keywords: ['云'] } },
    }
    const state = fold([
      turnStart(), userMessage(2, queryIntent), userMessage(3, secondIntent),
    ])
    expect(state).toMatchObject({
      pendingIntent: { intentId: 'query-intent', status: 'waiting-agent' },
      lastFailure: {
        intentId: 'query-intent-2', tool: 'tender_workbench_run_query', code: 'intent-conflict',
      },
    })
  })

  it('treats an identical Intent event as a replay but rejects same-id content changes', () => {
    const waiting = fold([
      turnStart(), userMessage(2, queryIntent), userMessage(2, queryIntent),
    ])
    expect(waiting?.pendingIntent?.intentId).toBe('query-intent')
    expect(waiting?.lastFailure).toBeUndefined()

    const changed: TenderWorkbenchIntentV2 = {
      ...queryIntent,
      payload: { scope: 'tender', target: '同 id 的改写查询', tender: { keywords: ['云'] } },
    }
    const conflicted = tenderWorkflowProjectionDefinition.apply(waiting, userMessage(3, changed))
    expect(conflicted).toMatchObject({
      pendingIntent: { intentId: 'query-intent' },
      lastFailure: { intentId: 'query-intent', code: 'intent-conflict' },
    })
  })

  it('keeps a multi-step analysis pending until control reports complete', () => {
    const intent: TenderWorkbenchIntentV2 = {
      schemaVersion: 2, intentId: 'analysis-intent', kind: 'analysis.run', skill: 'tender-workbench-analysis',
      binding: {
        activeDatasetRef: 'data-1', classificationArtifactRef: 'class-1',
        ruleSetVersion: 'rules-1', projectionRevision: 0,
      },
      payload: { scope: { kind: 'all-eligible' } },
    }
    const waiting = fold([turnStart(), userMessage(2, intent)])
    const preparing = tenderWorkflowProjectionDefinition.apply(
      waiting, call(3, 'prepare', 'tender_workbench_prepare_analysis_batch', 'analysis-intent'),
    )
    const partialState: TenderWorkflowProjectionV2 = {
      ...createEmptyTenderWorkflowProjection(),
      observedTurn: 1,
      revision: 1,
      currentStage: 'analysis',
      stages: { ...createEmptyTenderWorkflowProjection().stages, analysis: { status: 'running' } },
      analysis: {
        version: 'analysis-1', activeDatasetId: 'data-1', ruleSetVersion: 'rules-1',
        eligibleTotal: 2, completed: 0, priorityReview: 0, watch: 0, notRecommended: 0, urgent: 0,
      },
    }
    const prepared = tenderWorkflowProjectionDefinition.apply(preparing, result(4, 'prepare', mutationMeta({
      tool: 'tender_workbench_prepare_analysis_batch', intentId: 'analysis-intent', previousRevision: 0,
      state: partialState,
      control: { status: 'continue', nextTool: 'tender_workbench_commit_analysis_batch' },
    })))
    expect(prepared).toMatchObject({
      revision: 1,
      pendingIntent: { status: 'running', expectedTool: 'tender_workbench_commit_analysis_batch' },
    })
    const committing = tenderWorkflowProjectionDefinition.apply(
      prepared, call(5, 'commit', 'tender_workbench_commit_analysis_batch', 'analysis-intent'),
    )
    const terminalState: TenderWorkflowProjectionV2 = {
      ...partialState,
      revision: 2,
      stages: { ...partialState.stages, analysis: { status: 'succeeded', updatedAt: '2026-09-01T00:00:00.000Z' } },
      analysis: { ...partialState.analysis!, completed: 2, priorityReview: 2 },
    }
    const completed = tenderWorkflowProjectionDefinition.apply(committing, result(6, 'commit', mutationMeta({
      tool: 'tender_workbench_commit_analysis_batch', intentId: 'analysis-intent', previousRevision: 1,
      state: terminalState, control: { status: 'complete' },
    })))
    expect(completed).toEqual(terminalState)
  })

  it('requires a current-record answer turn to end after the read Tool completes', () => {
    const intent: TenderWorkbenchIntentV2 = {
      schemaVersion: 2, intentId: 'follow-intent', kind: 'analysis.follow-up', skill: 'tender-workbench-analysis',
      binding: {
        activeDatasetRef: 'data-1', classificationArtifactRef: 'class-1',
        ruleSetVersion: 'rules-1', analysisVersion: 'analysis-1', projectionRevision: 0,
      },
      payload: { recordRef: 'record-1', question: '当前需要核验什么？' },
    }
    const reading = fold([
      turnStart(), userMessage(2, intent),
      call(3, 'record-context', 'tender_workbench_get_analysis_record_context', 'follow-intent'),
    ])
    const answered = tenderWorkflowProjectionDefinition.apply(
      reading, result(4, 'record-context', readMeta('tender_workbench_get_analysis_record_context', 'follow-intent', 0)),
    )
    expect(answered?.pendingIntent?.awaitingTurnEnd).toBe(true)
    expect(tenderWorkflowProjectionDefinition.apply(answered, turnEnd(5))?.pendingIntent).toBeUndefined()
  })

  it('keeps a Tool error retryable in the same Intent and fails only when the turn ends incomplete', () => {
    const running = fold([
      turnStart(), userMessage(2, queryIntent),
      call(3, 'query-call', 'tender_workbench_run_query', 'query-intent'),
    ])
    const retryable = tenderWorkflowProjectionDefinition.apply(
      running, result(4, 'query-call', undefined, 'permission denied'),
    )
    expect(retryable).toMatchObject({
      stages: { query: { status: 'running' } },
      pendingIntent: {
        intentId: 'query-intent', status: 'running', expectedTool: 'tender_workbench_run_query',
      },
    })
    expect(retryable?.activeOperation).toBeUndefined()
    expect(retryable?.lastFailure).toBeUndefined()
    expect(tenderWorkflowProjectionDefinition.apply(retryable, turnEnd(5))).toMatchObject({
      stages: { query: { status: 'failed', errorCode: 'intent-incomplete' } },
      lastFailure: { intentId: 'query-intent', code: 'intent-incomplete' },
    })
  })

  it('returns a retrying structured action to running and accepts the corrected Tool result', () => {
    const running = fold([
      turnStart(), userMessage(2, queryIntent),
      call(3, 'query-call', 'tender_workbench_run_query', 'query-intent'),
    ])
    const retryable = tenderWorkflowProjectionDefinition.apply(
      running, result(4, 'query-call', undefined, 'invalid arguments'),
    )
    const retried = tenderWorkflowProjectionDefinition.apply(
      retryable, call(5, 'query-retry', 'tender_workbench_run_query', 'query-intent'),
    )
    expect(retried).toMatchObject({
      stages: { query: { status: 'running' } },
      activeOperation: { callId: 'query-retry', tool: 'tender_workbench_run_query' },
    })
    const completedState: TenderWorkflowProjectionV2 = {
      ...createEmptyTenderWorkflowProjection(),
      observedTurn: 1,
      revision: 1,
      currentStage: 'overview',
      stages: {
        ...createEmptyTenderWorkflowProjection().stages,
        query: { status: 'succeeded' }, overview: { status: 'succeeded' },
      },
    }
    expect(tenderWorkflowProjectionDefinition.apply(retried, result(6, 'query-retry', mutationMeta({
      tool: 'tender_workbench_run_query', intentId: 'query-intent', previousRevision: 0,
      state: completedState, control: { status: 'complete' },
    })))).toEqual(completedState)
  })

  it('creates conversation pending on the first single-step Tool call and keeps validation errors running', () => {
    const current: TenderWorkflowProjectionV2 = {
      ...createEmptyTenderWorkflowProjection(),
      observedTurn: 1,
      revision: 2,
      currentStage: 'rules',
    }
    const running = tenderWorkflowProjectionDefinition.apply(
      current,
      conversationCall(3, 'confirm-call', 'tender_workbench_confirm_rules'),
    )
    expect(running).toMatchObject({
      stages: { classification: { status: 'running' } },
      pendingIntent: {
        kind: 'rules.confirm', origin: 'conversation', status: 'running',
        expectedTool: 'tender_workbench_confirm_rules',
      },
      activeOperation: { callId: 'confirm-call', origin: 'conversation' },
    })
    const retryable = tenderWorkflowProjectionDefinition.apply(
      running, result(4, 'confirm-call', undefined, 'stale revision'),
    )
    expect(retryable).toMatchObject({
      stages: { classification: { status: 'running' } },
      pendingIntent: {
        kind: 'rules.confirm', status: 'running', expectedTool: 'tender_workbench_confirm_rules',
      },
    })
    expect(retryable?.activeOperation).toBeUndefined()
  })

  it('ignores non-V2 protocol events', () => {
    expect(fold([turnStart(), {
      seq: 2, time: baseTime + 2, type: 'user/message',
      data: { turn: 1, source: { kind: 'user' }, content: [{ type: 'text', text: '{"schemaVersion":1,"legacyIdentity":"old"}' }] },
    } as unknown as SessionEvent])).toEqual({ ...createEmptyTenderWorkflowProjection(), observedTurn: 1 })
  })
})
