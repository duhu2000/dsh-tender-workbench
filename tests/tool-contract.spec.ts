import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import type { TenderWorkbenchIntentV2 } from '../src/contracts/intents.ts'
import { createEmptyTenderWorkflowProjection, type TenderWorkflowProjectionV2 } from '../src/contracts/workflow.ts'
import { serializeTenderWorkbenchIntent } from '../src/client/intents/screening-intent.ts'
import { tenderIntentFingerprint } from '../src/host/intent-fingerprint.ts'
import { resolveToolInvocation } from '../src/host/tool-contract.ts'

function execution(intent: TenderWorkbenchIntentV2, laterText?: string): ToolRunContext {
  const events = [{
    type: 'user/message', seq: 1, time: 1,
    data: {
      turn: 1, source: { kind: 'user' },
      content: [{ type: 'text', text: serializeTenderWorkbenchIntent(intent) }],
    },
  }]
  if (laterText !== undefined) {
    events.push({
      type: 'user/message', seq: 2, time: 2,
      data: { turn: 2, source: { kind: 'user' }, content: [{ type: 'text', text: laterText }] },
    })
  }
  return {
    callId: 'call-1', rootCallId: 'call-1', token: Symbol('call'),
    signal: new AbortController().signal,
    agent: {
      id: 'agent-1',
      session: {
        id: 'session-1', header: { version: 0, id: 'session-1', createdAt: 1 },
        events,
      },
    },
  } as unknown as ToolRunContext
}

function pending(intent: TenderWorkbenchIntentV2): TenderWorkflowProjectionV2 {
  const state = createEmptyTenderWorkflowProjection()
  return {
    ...state,
    pendingIntent: {
      intentId: intent.intentId,
      kind: intent.kind,
      skill: intent.skill,
      origin: 'workbench-intent',
      status: 'running',
      turn: 1,
      expectedTool: intent.kind === 'query.run'
        ? 'tender_workbench_run_query'
        : 'tender_workbench_get_report_narrative_context',
      terminalTools: intent.kind === 'query.run'
        ? ['tender_workbench_run_query']
        : ['tender_workbench_create_report'],
      intentFingerprint: tenderIntentFingerprint(intent),
      bindingFingerprint: 'binding-test',
    },
  }
}

describe('Host Tool invocation binding', () => {
  it('requires actual query Tool arguments to equal the current workbench Intent', () => {
    const intent: TenderWorkbenchIntentV2 = {
      schemaVersion: 2, intentId: 'query-1', kind: 'query.run', skill: 'tender-workbench-query',
      binding: { projectionRevision: 0 },
      payload: { scope: 'tender', target: '数据项目', tender: { keywords: ['数据'] } },
    }
    const args = {
      schemaVersion: 2, origin: { kind: 'workbench-intent', intentId: intent.intentId },
      projectionRevision: 0, ...intent.payload,
    }
    expect(resolveToolInvocation({
      rawOrigin: args.origin, rawArgs: args, exec: execution(intent), state: pending(intent),
      tool: 'tender_workbench_run_query', intentKind: 'query.run', mutation: true,
    })).toEqual({ origin: 'workbench-intent', intentId: intent.intentId })
    expect(() => resolveToolInvocation({
      rawOrigin: args.origin, rawArgs: { ...args, target: '被 Agent 改写' },
      exec: execution(intent), state: pending(intent),
      tool: 'tender_workbench_run_query', intentKind: 'query.run', mutation: true,
    })).toThrow('与工作台 Intent 不一致')
  })

  it('binds requested report context without copying the report payload into the read Tool', () => {
    const intent: TenderWorkbenchIntentV2 = {
      schemaVersion: 2, intentId: 'report-1', kind: 'report.create', skill: 'tender-workbench-report',
      binding: {
        activeDatasetRef: 'data-1', projectionRevision: 0,
        basis: { kind: 'dataset-only' }, reviewRevision: 0,
      },
      payload: { scope: 'complete', confirmPending: false, narrativeMode: 'requested' },
    }
    const args = {
      schemaVersion: 2, origin: { kind: 'workbench-intent', intentId: intent.intentId }, ...intent.binding,
    }
    expect(resolveToolInvocation({
      rawOrigin: args.origin, rawArgs: args, exec: execution(intent), state: pending(intent),
      tool: 'tender_workbench_get_report_narrative_context', intentKind: 'report.create', mutation: false,
    })).toEqual({ origin: 'workbench-intent', intentId: intent.intentId })
    expect(() => resolveToolInvocation({
      rawOrigin: args.origin,
      rawArgs: { ...args, scope: 'complete', confirmPending: false, narrative: { kind: 'bound' } },
      exec: execution(intent), state: pending(intent),
      tool: 'tender_workbench_create_report', intentKind: 'report.create', mutation: true,
    })).toThrow('control.nextTool')
  })

  it('resolves the original pending Intent when a later conflicting message was rejected', () => {
    const intent: TenderWorkbenchIntentV2 = {
      schemaVersion: 2, intentId: 'query-1', kind: 'query.run', skill: 'tender-workbench-query',
      binding: { projectionRevision: 0 },
      payload: { scope: 'tender', target: '数据项目', tender: { keywords: ['数据'] } },
    }
    const conflicting: TenderWorkbenchIntentV2 = {
      ...intent,
      payload: { scope: 'tender', target: '云项目', tender: { keywords: ['云'] } },
    }
    const args = {
      schemaVersion: 2, origin: { kind: 'workbench-intent', intentId: intent.intentId },
      projectionRevision: 0, ...intent.payload,
    }
    expect(resolveToolInvocation({
      rawOrigin: args.origin, rawArgs: args,
      exec: execution(intent, serializeTenderWorkbenchIntent(conflicting)), state: pending(intent),
      tool: 'tender_workbench_run_query', intentKind: 'query.run', mutation: true,
    })).toEqual({ origin: 'workbench-intent', intentId: intent.intentId })
  })

  it('rejects autonomous mutation even when the Tool and Intent kind otherwise match', () => {
    const state = createEmptyTenderWorkflowProjection()
    expect(() => resolveToolInvocation({
      rawOrigin: { kind: 'autonomous' }, rawArgs: { origin: { kind: 'autonomous' } },
      exec: execution({
        schemaVersion: 2, intentId: 'query-1', kind: 'query.run', skill: 'tender-workbench-query',
        binding: { projectionRevision: 0 },
        payload: { scope: 'tender', target: '数据', tender: { keywords: ['数据'] } },
      }),
      state, tool: 'tender_workbench_run_query', intentKind: 'query.run', mutation: true,
    })).toThrow('自主只读调用不能修改')
  })

  it('allows one direct conversation action to continue with exactly control.nextTool', () => {
    const exec = execution({
      schemaVersion: 2, intentId: 'unused', kind: 'query.run', skill: 'tender-workbench-query',
      binding: { projectionRevision: 0 },
      payload: { scope: 'tender', target: 'unused', tender: { keywords: ['unused'] } },
    }, '继续生成当前初筛口径')
    const first = resolveToolInvocation({
      rawOrigin: { kind: 'conversation' }, rawArgs: { origin: { kind: 'conversation' } },
      exec, state: createEmptyTenderWorkflowProjection(),
      tool: 'tender_workbench_get_rule_drafting_context', intentKind: 'rules.propose', mutation: false,
    })
    expect(first.intentId).toMatch(/^conversation_/u)
    const state: TenderWorkflowProjectionV2 = {
      ...createEmptyTenderWorkflowProjection(),
      pendingIntent: {
        intentId: first.intentId!, kind: 'rules.propose', skill: 'tender-workbench-screening',
        origin: 'conversation', status: 'running', turn: 2,
        expectedTool: 'tender_workbench_preview_rules',
        terminalTools: ['tender_workbench_preview_rules'],
        intentFingerprint: `conversation_${first.intentId!}`.slice(0, 128),
        bindingFingerprint: `conversation_${first.intentId!}`.slice(0, 128),
      },
    }
    expect(resolveToolInvocation({
      rawOrigin: { kind: 'conversation' }, rawArgs: { origin: { kind: 'conversation' } },
      exec, state, tool: 'tender_workbench_preview_rules', intentKind: 'rules.propose', mutation: true,
    })).toEqual({ origin: 'conversation', intentId: first.intentId })
    ;(exec.agent!.session.events as unknown[]).push({
      type: 'user/message', seq: 3, time: 3,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '查看另一个问题' }] },
    })
    expect(resolveToolInvocation({
      rawOrigin: { kind: 'conversation' }, rawArgs: { origin: { kind: 'conversation' } },
      exec, state, tool: 'tender_workbench_preview_rules', intentKind: 'rules.propose', mutation: true,
    })).toEqual({ origin: 'conversation', intentId: first.intentId })
    expect(() => resolveToolInvocation({
      rawOrigin: { kind: 'conversation' }, rawArgs: { origin: { kind: 'conversation' } },
      exec, state, tool: 'tender_workbench_get_rule_drafting_context', intentKind: 'rules.propose', mutation: false,
    })).toThrow('control.nextTool')
  })
})
