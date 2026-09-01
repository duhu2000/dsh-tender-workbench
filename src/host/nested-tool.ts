import type { ToolExecutionInput, ToolRunContext } from '@deepseek-ai/dsh-tools'

type NestedParent = Pick<ToolRunContext, 'agent' | 'rootCallId' | 'signal' | 'token'>

/** Build one canonical nested call; Session identity comes only from exec.agent. */
export function nestedToolExecution(
  exec: NestedParent,
  callId: ToolExecutionInput['callId'],
  name: string,
  argumentsValue: unknown,
): ToolExecutionInput {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return {
    callId,
    rootCallId: exec.rootCallId,
    name,
    arguments: argumentsValue,
    parent: exec.token,
    agent: exec.agent,
    signal: exec.signal,
  }
}

