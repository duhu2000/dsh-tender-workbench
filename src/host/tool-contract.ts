import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  orchestrationFor,
  type TenderToolNameV2,
  type TenderWorkbenchIntentKindV2,
} from '../contracts/orchestration.ts'
import { TenderWorkbenchIntentV2Schema, type TenderWorkbenchIntentV2 } from '../contracts/intents.ts'
import { TenderToolOriginV2Schema, type TenderToolOriginV2 } from '../contracts/tool-results.ts'
import type { TenderWorkflowProjectionV2 } from '../contracts/workflow.ts'
import { canonicalJson, conversationIntentId, tenderIntentFingerprint } from './intent-fingerprint.ts'

export interface ResolvedToolInvocation {
  readonly intentId?: string
  readonly origin: TenderToolOriginV2['kind']
}

function latestDirectUserEvent(exec: ToolRunContext) {
  const events = exec.agent?.session.events
  if (events === undefined) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'user/message' && event.data.source.kind === 'user') return event
  }
  return undefined
}

function directUserText(event: NonNullable<ReturnType<typeof latestDirectUserEvent>>): string {
  const values: string[] = []
  for (const block of event.data.content) {
    if (block.type === 'text') values.push(block.text)
  }
  return values.join('\n').trim()
}

function workbenchIntentFrom(text: string): TenderWorkbenchIntentV2 | undefined {
  const matches = [...text.matchAll(/<dsh_tender_workbench_intent>\s*([\s\S]*?)\s*<\/dsh_tender_workbench_intent>/gu)]
  if (matches.length !== 1 || matches[0]?.[1] === undefined) return undefined
  try {
    return TenderWorkbenchIntentV2Schema.parse(JSON.parse(matches[0][1]) as unknown)
  } catch {
    return undefined
  }
}

function matchingWorkbenchIntent(
  exec: ToolRunContext,
  intentId: string,
  intentFingerprint: string,
): TenderWorkbenchIntentV2 | undefined {
  const events = exec.agent?.session.events
  if (events === undefined) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const intent = workbenchIntentFrom(directUserText(event))
    if (intent?.intentId === intentId && tenderIntentFingerprint(intent) === intentFingerprint) return intent
  }
  return undefined
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(message)
}

function assertWorkbenchArguments(
  intent: TenderWorkbenchIntentV2,
  tool: TenderToolNameV2,
  rawArgs: unknown,
  state: TenderWorkflowProjectionV2,
): void {
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    throw new Error('Tool 参数不是封闭对象。')
  }
  const args = rawArgs as Record<string, unknown>
  const origin = { kind: 'workbench-intent', intentId: intent.intentId }
  const currentRevision = state.revision
  if (intent.kind === 'query.run') {
    assertSame(args, {
      schemaVersion: 2, origin, projectionRevision: intent.binding.projectionRevision, ...intent.payload,
    }, '查询 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'rules.propose') {
    const common = {
      schemaVersion: 2, origin,
      activeDatasetRef: intent.binding.activeDatasetRef,
      projectionRevision: currentRevision,
    }
    if (tool === 'tender_workbench_get_rule_drafting_context') {
      assertSame(args, common, '规则上下文 Tool 参数与工作台 Intent 不一致。')
      return
    }
    assertSame({
      schemaVersion: args['schemaVersion'], origin: args['origin'],
      activeDatasetRef: args['activeDatasetRef'], projectionRevision: args['projectionRevision'],
      modeKind: (args['mode'] as Record<string, unknown> | undefined)?.['kind'],
    }, { ...common, modeKind: 'agent-proposal' }, '规则提议 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'rules.adjust') {
    assertSame({
      schemaVersion: args['schemaVersion'], origin: args['origin'],
      activeDatasetRef: args['activeDatasetRef'], projectionRevision: args['projectionRevision'],
      mode: args['mode'],
    }, {
      schemaVersion: 2, origin,
      activeDatasetRef: intent.binding.activeDatasetRef,
      projectionRevision: currentRevision,
      mode: { kind: 'agent-adjustment', baseDraftFingerprint: intent.binding.baseDraftFingerprint },
    }, '规则调整 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'rules.preview') {
    assertSame(args, {
      schemaVersion: 2, origin,
      activeDatasetRef: intent.binding.activeDatasetRef,
      projectionRevision: currentRevision,
      mode: { kind: 'user-dry-run', draftFingerprint: intent.payload.draftFingerprint },
      rules: intent.payload.rules,
    }, '规则 Dry Run Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'rules.confirm') {
    assertSame(args, {
      schemaVersion: 2, origin,
      activeDatasetRef: intent.binding.activeDatasetRef,
      projectionRevision: currentRevision,
      previewArtifactRef: intent.binding.previewArtifactRef,
      draftFingerprint: intent.binding.draftFingerprint,
    }, '规则确认 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'analysis.run') {
    const common = {
      schemaVersion: 2, origin,
      activeDatasetRef: intent.binding.activeDatasetRef,
      classificationArtifactRef: intent.binding.classificationArtifactRef,
      ruleSetVersion: intent.binding.ruleSetVersion,
      projectionRevision: currentRevision,
      scope: intent.payload.scope,
    }
    if (tool === 'tender_workbench_prepare_analysis_batch') {
      assertSame(args, common, '分析准备 Tool 参数与工作台 Intent 不一致。')
      return
    }
    assertSame({
      schemaVersion: args['schemaVersion'], origin: args['origin'],
      activeDatasetRef: args['activeDatasetRef'], classificationArtifactRef: args['classificationArtifactRef'],
      ruleSetVersion: args['ruleSetVersion'], projectionRevision: args['projectionRevision'], scope: args['scope'],
    }, common, '分析提交 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'analysis.follow-up') {
    assertSame(args, {
      schemaVersion: 2, origin, ...intent.binding, projectionRevision: currentRevision,
      recordRef: intent.payload.recordRef,
    }, '记录上下文 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'review.apply') {
    assertSame(args, {
      schemaVersion: 2, origin, ...intent.binding, projectionRevision: currentRevision,
      decisions: intent.payload.decisions,
    }, '复核 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'review.revert') {
    const { latestOperationRef, ...binding } = intent.binding
    assertSame(args, {
      schemaVersion: 2, origin, ...binding, projectionRevision: currentRevision, latestOperationRef,
    }, '复核撤销 Tool 参数与工作台 Intent 不一致。')
    return
  }
  if (intent.kind === 'report.create') {
    if (tool === 'tender_workbench_get_report_narrative_context') {
      assertSame(args, {
        schemaVersion: 2, origin, ...intent.binding, projectionRevision: currentRevision,
      }, '报告叙述上下文 Tool 参数与工作台 Intent 不一致。')
      return
    }
    const fixed = {
      schemaVersion: args['schemaVersion'], origin: args['origin'],
      activeDatasetRef: args['activeDatasetRef'], projectionRevision: args['projectionRevision'],
      basis: args['basis'],
      ...(args['reviewArtifactRef'] === undefined ? {} : { reviewArtifactRef: args['reviewArtifactRef'] }),
      reviewRevision: args['reviewRevision'],
      scope: args['scope'], confirmPending: args['confirmPending'],
    }
    const expected = {
      schemaVersion: 2, origin, ...intent.binding, projectionRevision: currentRevision,
      scope: intent.payload.scope, confirmPending: intent.payload.confirmPending,
    }
    assertSame(fixed, expected, '报告创建 Tool 参数与工作台 Intent 不一致。')
    const narrative = args['narrative'] as Record<string, unknown> | undefined
    if ((intent.payload.narrativeMode === 'none' && narrative?.['kind'] !== 'none')
      || (intent.payload.narrativeMode === 'requested' && narrative?.['kind'] !== 'bound')) {
      throw new Error('报告叙述分支与工作台 Intent 不一致。')
    }
    return
  }
  assertSame(args, {
    schemaVersion: 2, origin,
    projectionRevision: currentRevision,
    finalSnapshotId: intent.binding.finalSnapshotId,
    formats: intent.payload.formats,
  }, '报告重试 Tool 参数与工作台 Intent 不一致。')
}

function latestConversationUserEvent(exec: ToolRunContext) {
  const events = exec.agent?.session.events
  if (events === undefined) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = directUserText(event)
    if (text === '' || text.includes('<dsh_tender_workbench_intent>')) continue
    return event
  }
  return undefined
}

export function resolveToolInvocation(input: {
  readonly rawOrigin: unknown
  readonly rawArgs: unknown
  readonly exec: ToolRunContext
  readonly state: TenderWorkflowProjectionV2
  readonly tool: TenderToolNameV2
  readonly intentKind: TenderWorkbenchIntentKindV2
  readonly mutation: boolean
}): ResolvedToolInvocation {
  if (input.exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  const origin = TenderToolOriginV2Schema.parse(input.rawOrigin)
  const contract = orchestrationFor(input.intentKind)
  if (!contract.allowedTools.includes(input.tool)) {
    throw new Error(`Tool ${input.tool} is not allowed for ${input.intentKind}`)
  }
  if (origin.kind === 'workbench-intent') {
    const pending = input.state.pendingIntent
    if (pending === undefined || pending.intentId !== origin.intentId || pending.kind !== input.intentKind) {
      throw new Error('当前 Tool 调用与待执行的工作台 Intent 不匹配。')
    }
    if (pending.expectedTool !== input.tool) {
      throw new Error(`当前工作台 Intent 只允许调用 control.nextTool：${pending.expectedTool}。`)
    }
    const intent = matchingWorkbenchIntent(input.exec, origin.intentId, pending.intentFingerprint)
    if (intent === undefined || intent.intentId !== origin.intentId || intent.kind !== input.intentKind) {
      throw new Error('当前 Session 中找不到与 Tool 调用匹配的 V2 工作台 Intent。')
    }
    assertWorkbenchArguments(intent, input.tool, input.rawArgs, input.state)
    return { origin: origin.kind, intentId: origin.intentId }
  }
  if (origin.kind === 'autonomous') {
    if (input.mutation) throw new Error('自主只读调用不能修改工作流事实。')
    return { origin: origin.kind }
  }
  const pending = input.state.pendingIntent
  const event = latestConversationUserEvent(input.exec)
  if (event === undefined) throw new Error('修改型 Tool 需要当前 Session 中的直接用户请求。')
  const text = directUserText(event)
  if (text === '' || text.includes('<dsh_tender_workbench_intent>')) {
    throw new Error('普通对话 origin 必须对应非工作台 Intent 的直接用户请求。')
  }
  const turn = pending?.origin === 'conversation' ? pending.turn : event.data.turn
  const intentId = conversationIntentId(turn, input.intentKind)
  if (pending !== undefined && (pending.origin !== 'conversation'
    || pending.intentId !== intentId
    || pending.kind !== input.intentKind
    || pending.expectedTool !== input.tool)) {
    throw new Error('普通对话 Tool 与当前待执行动作或 control.nextTool 不匹配。')
  }
  return { origin: origin.kind, intentId }
}

export function toolOriginParameter(options: { readonly autonomous: boolean }) {
  const workbench = {
    type: 'object' as const,
    description: 'Use only for a structured workbench action. Pass the exact intentId from the current V2 Intent.',
    additionalProperties: false,
    properties: {
      kind: { type: 'string' as const, const: 'workbench-intent' as const, required: true as const },
      intentId: { type: 'string' as const, required: true as const },
    },
  }
  const conversation = {
    type: 'object' as const,
    description: 'Use for an explicit action requested directly in Agent conversation. Do not add or reuse an intentId.',
    additionalProperties: false,
    properties: {
      kind: { type: 'string' as const, const: 'conversation' as const, required: true as const },
    },
  }
  if (!options.autonomous) return {
    description: 'Identify whether this action comes from the current structured workbench Intent or the current direct conversation request.',
    oneOf: [workbench, conversation],
  } as const
  return {
    description: 'Identify a structured workbench Intent, a direct conversation request, or an autonomous read-only context lookup.',
    oneOf: [workbench, conversation, {
      type: 'object' as const,
      description: 'Use only for an Agent-initiated read-only context lookup. This origin cannot modify workflow facts.',
      additionalProperties: false,
      properties: {
        kind: { type: 'string' as const, const: 'autonomous' as const, required: true as const },
      },
    }],
  } as const
}
