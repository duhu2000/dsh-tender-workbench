import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import {
  TENDER_TOOL_CONTRACTS,
  TenderWorkflowProjectionV1Schema,
  createEmptyTenderWorkflowProjection,
  parseTenderToolMetaV1,
  type TenderCommandKind,
  type TenderToolName,
  type TenderWorkflowProjectionV1,
  type WorkflowStage,
} from '../contracts/workflow.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    dshTenderWorkflow: TenderWorkflowProjectionV1 | null
  }
  interface SessionProjectionMap {
    dshTenderWorkflow: TenderWorkflowProjectionV1 | null
  }
}

function isTenderToolName(name: string): name is TenderToolName {
  return Object.hasOwn(TENDER_TOOL_CONTRACTS, name)
}

function commandIdFrom(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const commandId = (value as Record<string, unknown>)['commandId']
    return typeof commandId === 'string' && commandId.length > 0 && commandId.length <= 128
      ? commandId
      : undefined
  } catch {
    return undefined
  }
}

function withoutActiveOperation(state: TenderWorkflowProjectionV1): TenderWorkflowProjectionV1 {
  const { activeOperation: _activeOperation, ...rest } = state
  return rest
}

function runningState(
  state: TenderWorkflowProjectionV1 | null,
  callId: string,
  commandId: string,
  command: TenderCommandKind,
  stage: WorkflowStage,
): TenderWorkflowProjectionV1 {
  const current = state ?? createEmptyTenderWorkflowProjection()
  if (current.activeOperation !== undefined) return current
  return {
    ...current,
    currentStage: stage,
    activeOperation: {
      callId,
      commandId,
      command,
      stage,
      previousCurrentStage: current.currentStage,
      previousStageState: current.stages[stage],
    },
    stages: {
      ...current.stages,
      [stage]: { status: 'running' },
    },
  }
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
  state: TenderWorkflowProjectionV1,
  event: SessionEvent<'tool/result'>,
  code: string,
  message: string,
): TenderWorkflowProjectionV1 {
  const active = state.activeOperation
  if (active === undefined) return state
  const base = withoutActiveOperation(state)
  return {
    ...base,
    stages: {
      ...base.stages,
      [active.stage]: {
        status: 'failed',
        updatedAt: new Date(event.time).toISOString(),
        errorCode: code.slice(0, 128),
        errorMessage: message.slice(0, 512),
      },
    },
    lastFailure: { command: active.command, code: code.slice(0, 128), message: message.slice(0, 512) },
  }
}

function applyTenderProjection(
  state: TenderWorkflowProjectionV1 | null,
  event: SessionEvent,
): TenderWorkflowProjectionV1 | null {
  if (event.type === 'turn/end' && state !== null) {
    const analysis = state.analysis
    if (state.activeOperation === undefined
      && state.stages.analysis.status === 'running'
      && analysis !== undefined
      && analysis.completed < analysis.eligibleTotal) {
      const message = `Agent 分析在 ${analysis.completed}/${analysis.eligibleTotal} 时中断；可继续处理剩余记录。`
      return {
        ...state,
        stages: {
          ...state.stages,
          analysis: {
            status: 'failed',
            updatedAt: new Date(event.time).toISOString(),
            errorCode: 'analysis-incomplete',
            errorMessage: message,
          },
        },
        lastFailure: {
          command: 'tender_workbench_analysis_commit',
          code: 'analysis-incomplete',
          message,
        },
      }
    }
  }
  if (event.type === 'tool/call') {
    if (!isTenderToolName(event.data.name)) return state
    const commandId = commandIdFrom(event.data.arguments)
    if (commandId === undefined) return state
    const contract = TENDER_TOOL_CONTRACTS[event.data.name]
    return runningState(state, String(event.data.callId), commandId, contract.command, contract.stage)
  }
  if (event.type !== 'tool/result' || state?.activeOperation === undefined) return state
  if (String(event.data.message.source.callId) !== state.activeOperation.callId) return state
  const result = event.data.message.content[0]
  if (result.isError === true || event.data.error !== undefined) {
    return failedState(
      state,
      event,
      event.data.error?.code ?? 'tool-failed',
      resultText(event),
    )
  }
  let meta
  try {
    meta = parseTenderToolMetaV1(event.data.meta)
  } catch {
    return failedState(state, event, 'invalid-tool-meta', '工具返回了不兼容的工作流状态。')
  }
  if (meta.commandId !== state.activeOperation.commandId || meta.command !== state.activeOperation.command) {
    return failedState(state, event, 'mismatched-tool-meta', '工具返回的命令身份与当前操作不匹配。')
  }
  if (meta.state.revision < state.revision) {
    const active = state.activeOperation
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
  return meta.state.activeOperation === undefined ? meta.state : withoutActiveOperation(meta.state)
}

type TenderProjectionDefinition = Omit<ProjectionDefinition<'dshTenderWorkflow'>, 'wire'> & {
  readonly wire: NonNullable<ProjectionDefinition<'dshTenderWorkflow'>['wire']>
}

export const tenderWorkflowProjectionDefinition: TenderProjectionDefinition = {
  key: 'dshTenderWorkflow',
  stateVersion: 1,
  stateSchema: TenderWorkflowProjectionV1Schema.nullable(),
  init: () => null,
  apply: applyTenderProjection,
  wire: {
    viewSchema: TenderWorkflowProjectionV1Schema.nullable(),
    view: state => state,
  },
}
