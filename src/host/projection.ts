import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import {
  expectedEntryTool,
  isTenderToolName,
  orchestrationFor,
  TENDER_ORCHESTRATION_V2,
  type TenderOrchestrationActionV2,
  type TenderToolNameV2,
  type TenderWorkbenchIntentKindV2,
} from '../contracts/orchestration.ts'
import { TenderWorkbenchIntentV2Schema, type TenderWorkbenchIntentV2 } from '../contracts/intents.ts'
import {
  TenderWorkflowProjectionV2Schema,
  createEmptyTenderWorkflowProjection,
  parseTenderToolMetaV2,
  type TenderWorkflowProjectionV2,
  type WorkflowStage,
} from '../contracts/workflow.ts'
import { conversationIntentId, tenderBindingFingerprint, tenderIntentFingerprint } from './intent-fingerprint.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    dshTenderWorkflow: TenderWorkflowProjectionV2 | null
  }
  interface SessionProjectionMap {
    dshTenderWorkflow: TenderWorkflowProjectionV2 | null
  }
}

type ToolOrigin = 'workbench-intent' | 'conversation' | 'autonomous'

function messageText(event: SessionEvent<'user/message'>): string {
  const text: string[] = []
  for (const block of event.data.content) {
    if (block.type === 'text') text.push(block.text)
  }
  return text.join('\n')
}

function intentFrom(event: SessionEvent<'user/message'>): TenderWorkbenchIntentV2 | undefined {
  if (event.data.source.kind !== 'user') return undefined
  const text = messageText(event)
  const matches = [...text.matchAll(/<dsh_tender_workbench_intent>\s*([\s\S]*?)\s*<\/dsh_tender_workbench_intent>/gu)]
  if (matches.length !== 1) return undefined
  const raw = matches[0]?.[1]
  if (raw === undefined) return undefined
  try {
    return TenderWorkbenchIntentV2Schema.parse(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

function toolOriginFrom(raw: string): { readonly kind: ToolOrigin; readonly intentId?: string } | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const origin = (value as Record<string, unknown>)['origin']
    if (typeof origin !== 'object' || origin === null || Array.isArray(origin)) return undefined
    const kind = (origin as Record<string, unknown>)['kind']
    if (kind === 'workbench-intent') {
      const intentId = (origin as Record<string, unknown>)['intentId']
      return typeof intentId === 'string' && intentId.length > 0 && intentId.length <= 128
        ? { kind, intentId }
        : undefined
    }
    return kind === 'conversation' || kind === 'autonomous' ? { kind } : undefined
  } catch {
    return undefined
  }
}

function withoutLifecycle(state: TenderWorkflowProjectionV2): TenderWorkflowProjectionV2 {
  const { activeOperation: _activeOperation, pendingIntent: _pendingIntent, ...rest } = state
  return rest
}

function withoutActiveOperation(state: TenderWorkflowProjectionV2): TenderWorkflowProjectionV2 {
  const { activeOperation: _activeOperation, ...rest } = state
  return rest
}

function restoreActiveStage(state: TenderWorkflowProjectionV2): TenderWorkflowProjectionV2 {
  const active = state.activeOperation
  if (active === undefined) return state
  const base = withoutActiveOperation(state)
  return {
    ...base,
    currentStage: active.previousCurrentStage ?? base.currentStage,
    stages: {
      ...base.stages,
      [active.stage]: active.previousStageState ?? base.stages[active.stage],
    },
  }
}

function runningState(
  state: TenderWorkflowProjectionV2 | null,
  callId: string,
  tool: TenderToolNameV2,
  origin: { readonly kind: ToolOrigin; readonly intentId?: string },
  turn: number,
  rawArguments: string,
): TenderWorkflowProjectionV2 {
  const current = state ?? createEmptyTenderWorkflowProjection()
  if (current.activeOperation !== undefined) return current
  const contractStage = stageForTool(tool) ?? current.currentStage
  const pending = current.pendingIntent ?? (origin.kind === 'conversation'
    ? pendingFromConversationCall(current, tool, turn, rawArguments)
    : undefined)
  if (origin.kind === 'workbench-intent') {
    if (pending === undefined || pending.intentId !== origin.intentId) return current
    const contract = orchestrationFor(pending.kind)
    if (!contract.allowedTools.includes(tool)) return current
    if (tool !== pending.expectedTool) return current
  } else if (origin.kind === 'conversation' && pending !== undefined) {
    if (pending.origin !== 'conversation') return current
    const contract = orchestrationFor(pending.kind)
    if (!contract.allowedTools.includes(tool) || tool !== pending.expectedTool) return current
  }
  const mutatesVisibleStage = origin.kind !== 'autonomous'
  return {
    ...current,
    ...(mutatesVisibleStage ? { currentStage: contractStage } : {}),
    ...(pending === undefined ? {} : { pendingIntent: { ...pending, status: 'running' as const } }),
    activeOperation: {
      callId,
      ...(origin.intentId === undefined
        ? pending?.origin === 'conversation' ? { intentId: pending.intentId } : {}
        : { intentId: origin.intentId }),
      tool,
      origin: origin.kind,
      stage: contractStage,
      previousCurrentStage: current.currentStage,
      previousStageState: current.stages[contractStage],
    },
    ...(mutatesVisibleStage ? {
      stages: { ...current.stages, [contractStage]: { status: 'running' as const } },
    } : {}),
  }
}

function stageForTool(tool: TenderToolNameV2): WorkflowStage | undefined {
  const contracts = Object.values(TENDER_ORCHESTRATION_V2) as readonly TenderOrchestrationActionV2[]
  return contracts.find(contract => contract.allowedTools.includes(tool))?.stage
}

function resultText(event: SessionEvent<'tool/result'>): string {
  const seen: string[] = []
  const visit = (value: unknown): void => {
    if (seen.join('').length >= 512) return
    if (typeof value === 'object' && value !== null) {
      if ('text' in value && typeof value.text === 'string') seen.push(value.text)
      if ('content' in value && Array.isArray(value.content)) value.content.forEach(visit)
    }
  }
  visit(event.data.message)
  const value = seen.join('\n').replaceAll(/\p{C}/gu, '').trim()
  return value === '' ? '工具调用失败，未返回详细信息。' : value.slice(0, 512)
}

function failedState(
  state: TenderWorkflowProjectionV2,
  time: number,
  code: string,
  message: string,
): TenderWorkflowProjectionV2 {
  const active = state.activeOperation
  if (active?.origin === 'autonomous') return restoreActiveStage(state)
  const pending = state.pendingIntent
  const tool = active?.tool ?? pending?.expectedTool
  if (tool === undefined) return state
  const stage = active?.stage ?? orchestrationFor(pending?.kind ?? 'query.run').stage
  const intentId = active?.intentId ?? pending?.intentId
  const base = withoutLifecycle(state)
  return {
    ...base,
    currentStage: stage,
    stages: {
      ...base.stages,
      [stage]: {
        status: 'failed',
        updatedAt: new Date(time).toISOString(),
        errorCode: code.slice(0, 128),
        errorMessage: message.slice(0, 512),
      },
    },
    lastFailure: {
      ...(intentId === undefined ? {} : { intentId }),
      tool,
      code: code.slice(0, 128),
      message: message.slice(0, 512),
    },
  }
}

function retryableToolErrorState(state: TenderWorkflowProjectionV2): TenderWorkflowProjectionV2 {
  const active = state.activeOperation
  if (active?.origin === 'autonomous') return restoreActiveStage(state)
  if (active === undefined || state.pendingIntent === undefined) return state
  const base = withoutActiveOperation(state)
  return {
    ...base,
    currentStage: active.stage,
    stages: { ...base.stages, [active.stage]: { status: 'running' } },
    pendingIntent: { ...state.pendingIntent, status: 'running' },
  }
}

function conversationKindFor(tool: TenderToolNameV2, rawArguments?: string): TenderWorkbenchIntentKindV2 | undefined {
  if (tool === 'tender_workbench_run_query') return 'query.run'
  if (tool === 'tender_workbench_get_rule_drafting_context') return 'rules.propose'
  if (tool === 'tender_workbench_preview_rules') {
    try {
      const args = JSON.parse(rawArguments ?? '') as { readonly mode?: { readonly kind?: unknown } }
      if (args.mode?.kind === 'agent-proposal') return 'rules.propose'
      if (args.mode?.kind === 'agent-adjustment') return 'rules.adjust'
      if (args.mode?.kind === 'user-dry-run') return 'rules.preview'
    } catch {}
    return undefined
  }
  if (tool === 'tender_workbench_confirm_rules') return 'rules.confirm'
  if (tool === 'tender_workbench_prepare_analysis_batch') return 'analysis.run'
  if (tool === 'tender_workbench_commit_analysis_batch') return 'analysis.run'
  if (tool === 'tender_workbench_get_analysis_record_context') return 'analysis.follow-up'
  if (tool === 'tender_workbench_apply_review') return 'review.apply'
  if (tool === 'tender_workbench_revert_review') return 'review.revert'
  if (tool === 'tender_workbench_get_report_narrative_context') return 'report.create'
  if (tool === 'tender_workbench_create_report') return 'report.create'
  if (tool === 'tender_workbench_retry_report') return 'report.retry'
  return undefined
}

function pendingFromConversationCall(
  state: TenderWorkflowProjectionV2,
  tool: TenderToolNameV2,
  turn: number,
  rawArguments: string,
): TenderWorkflowProjectionV2['pendingIntent'] | undefined {
  const kind = conversationKindFor(tool, rawArguments)
  if (kind === undefined) return undefined
  const intentId = conversationIntentId(turn, kind)
  const contract = orchestrationFor(kind)
  return {
    intentId,
    kind,
    skill: contract.actionSkill,
    origin: 'conversation',
    status: 'running',
    turn: state.observedTurn ?? turn,
    expectedTool: tool,
    terminalTools: [...contract.terminalTools],
    intentFingerprint: intentId,
    bindingFingerprint: intentId,
  }
}

function pendingFromConversation(
  state: TenderWorkflowProjectionV2,
  tool: TenderToolNameV2,
  intentId: string,
): TenderWorkflowProjectionV2['pendingIntent'] | undefined {
  const kind = conversationKindFor(tool)
  if (kind === undefined) return undefined
  const contract = orchestrationFor(kind)
  return {
    intentId,
    kind,
    skill: contract.actionSkill,
    origin: 'conversation',
    status: 'running',
    turn: state.observedTurn ?? 1,
    expectedTool: contract.entry.kind === 'fixed' ? contract.entry.tool : tool,
    terminalTools: [...contract.terminalTools],
    intentFingerprint: `conversation_${intentId}`.slice(0, 128),
    bindingFingerprint: `conversation_${intentId}`.slice(0, 128),
  }
}

function applyTenderProjection(
  state: TenderWorkflowProjectionV2 | null,
  event: SessionEvent,
): TenderWorkflowProjectionV2 | null {
  if (event.type === 'turn/start') {
    return { ...(state ?? createEmptyTenderWorkflowProjection()), observedTurn: event.data.turn }
  }
  if (event.type === 'user/message') {
    const intent = intentFrom(event)
    if (intent === undefined) return state
    const current = state ?? createEmptyTenderWorkflowProjection()
    if (current.pendingIntent !== undefined) {
      if (current.pendingIntent.intentId === intent.intentId
        && current.pendingIntent.intentFingerprint === tenderIntentFingerprint(intent)) return current
      return {
        ...current,
        lastFailure: {
          intentId: intent.intentId,
          tool: expectedEntryTool(intent.kind, intent.payload),
          code: 'intent-conflict',
          message: `当前动作 ${current.pendingIntent.kind} 尚未完成，不能开始 ${intent.kind}。`,
        },
      }
    }
    const contract = orchestrationFor(intent.kind)
    return {
      ...current,
      currentStage: contract.stage,
      pendingIntent: {
        intentId: intent.intentId,
        kind: intent.kind,
        skill: intent.skill,
        origin: 'workbench-intent',
        status: 'waiting-agent',
        turn: current.observedTurn ?? 1,
        expectedTool: expectedEntryTool(intent.kind, intent.payload),
        terminalTools: [...contract.terminalTools],
        intentFingerprint: tenderIntentFingerprint(intent),
        bindingFingerprint: tenderBindingFingerprint(intent.binding),
      },
      stages: { ...current.stages, [contract.stage]: { status: 'waiting-agent' } },
    }
  }
  if (event.type === 'turn/end' && state !== null) {
    const pending = state.pendingIntent
    if (pending === undefined) return state
    if (pending.awaitingTurnEnd === true && pending.turn === event.data.turn) {
      const { pendingIntent: _pendingIntent, ...rest } = state
      return rest
    }
    if (pending.turn !== event.data.turn) return state
    return failedState(state, event.time, 'intent-incomplete', 'Agent 未按工作流契约完成当前动作；可以基于当前状态重试。')
  }
  if (event.type === 'tool/call') {
    if (!isTenderToolName(event.data.name)) return state
    const origin = toolOriginFrom(event.data.arguments)
    if (origin === undefined) return state
    return runningState(
      state, String(event.data.callId), event.data.name, origin, event.data.turn, event.data.arguments,
    )
  }
  if (event.type !== 'tool/result' || state?.activeOperation === undefined) return state
  if (String(event.data.message.source.callId) !== state.activeOperation.callId) return state
  const result = event.data.message.content[0]
  if (result.isError === true || event.data.error !== undefined) {
    if (state.pendingIntent !== undefined) return retryableToolErrorState(state)
    return failedState(state, event.time, event.data.error?.code ?? 'tool-failed', resultText(event))
  }
  let meta
  try {
    meta = parseTenderToolMetaV2(event.data.meta)
  } catch {
    return failedState(state, event.time, 'invalid-tool-meta', '工具返回了不兼容的工作流状态。')
  }
  const active = state.activeOperation
  if (meta.tool !== active.tool || meta.origin !== active.origin
    || (active.intentId !== undefined && meta.intentId !== active.intentId)) {
    return failedState(state, event.time, 'mismatched-tool-meta', '工具返回的动作身份与当前操作不匹配。')
  }
  if (meta.effect === 'failed') {
    if (meta.control.retryable) return retryableToolErrorState(state)
    return failedState(state, event.time, meta.control.reasonCode, resultText(event))
  }
  const pending = state.pendingIntent
    ?? (meta.origin === 'conversation' && meta.intentId !== undefined
      ? pendingFromConversation(state, meta.tool, meta.intentId)
      : undefined)
  const contract = pending === undefined ? undefined : orchestrationFor(pending.kind)
  if (meta.control.status === 'continue') {
    if (pending === undefined || contract === undefined || !contract.allowedTools.includes(meta.control.nextTool)) {
      return failedState(state, event.time, 'invalid-next-tool', '工具返回了当前动作不允许的下一步。')
    }
    const nextState = meta.effect === 'mutation' ? withoutActiveOperation(meta.state) : withoutActiveOperation(state)
    return {
      ...nextState,
      pendingIntent: { ...pending, status: 'running', expectedTool: meta.control.nextTool },
    }
  }
  if (contract !== undefined && !contract.terminalTools.includes(meta.tool)) {
    return failedState(state, event.time, 'invalid-terminal-tool', '非终止 Tool 不能完成当前动作。')
  }
  if (meta.effect === 'mutation') {
    if (meta.previousRevision !== state.revision || meta.state.revision !== state.revision + 1) {
      return failedState(state, event.time, 'invalid-revision', '工具返回的状态修订不连续。')
    }
    return withoutLifecycle(meta.state)
  }
  const restored = restoreActiveStage(state)
  if (contract?.completion === 'tool-control-and-turn-end' && pending !== undefined) {
    return { ...restored, pendingIntent: { ...pending, status: 'running', awaitingTurnEnd: true } }
  }
  if (pending !== undefined) {
    const { pendingIntent: _pendingIntent, ...rest } = restored
    return rest
  }
  return restored
}

type TenderProjectionDefinition = Omit<ProjectionDefinition<'dshTenderWorkflow'>, 'wire'> & {
  readonly wire: NonNullable<ProjectionDefinition<'dshTenderWorkflow'>['wire']>
}

export const tenderWorkflowProjectionDefinition: TenderProjectionDefinition = {
  key: 'dshTenderWorkflow',
  stateVersion: 2,
  stateSchema: TenderWorkflowProjectionV2Schema.nullable(),
  init: () => null,
  apply: applyTenderProjection,
  wire: {
    viewSchema: TenderWorkflowProjectionV2Schema.nullable(),
    view: state => state,
  },
}
