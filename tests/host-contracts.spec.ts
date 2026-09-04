import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { TENDER_SKILL_CONTRACT_MARKER, TENDER_TOOLS } from '../src/contracts/orchestration.ts'
import { apply } from '../src/index.ts'
import { ARTIFACT_ROUTE_PREFIX, registerArtifactRoute } from '../src/host/artifacts/register-route.ts'
import { nestedToolExecution } from '../src/host/nested-tool.ts'
import { TENDER_SKILL_REGISTRATIONS, registerTenderWorkflowSkills } from '../src/host/skills/index.ts'

describe('official Host seam contracts', () => {
  it('registers one V2 Projection, exactly thirteen Tools, and six Skills', () => {
    const projectionRegister = vi.fn((_definition: unknown) => () => {})
    const toolRegister = vi.fn((_definition: unknown) => () => {})
    const routeRegister = vi.fn((_route: unknown) => () => {})
    const skillRegister = vi.fn((_skill: unknown) => () => {})
    const effect = vi.fn((callback: () => unknown) => callback())
    apply({
      sessionProjections: { register: projectionRegister },
      tools: { register: toolRegister },
      webServer: { host: '127.0.0.1', register: routeRegister },
      sessions: { get: vi.fn() },
      skills: { register: skillRegister },
      get: (name: string) => name === 'sessionPersistence' ? { locate: vi.fn() } : undefined,
      effect,
    } as unknown as Context)

    expect(projectionRegister).toHaveBeenCalledWith(expect.objectContaining({
      key: 'dshTenderWorkflow', stateVersion: 2, wire: expect.any(Object),
    }))
    expect(toolRegister.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual(TENDER_TOOLS)
    const queryTool = toolRegister.mock.calls
      .map(call => call[0] as { name: string, parameters: unknown })
      .find(tool => tool.name === 'tender_workbench_run_query')
    const queryParameters = queryTool?.parameters as {
      readonly tender: { readonly properties: {
        readonly infoTypes: { readonly items: { readonly enum: readonly string[] } }
        readonly procurementTypes: { readonly items: { readonly enum: readonly string[] } }
      } }
    }
    expect(queryParameters.tender.properties.infoTypes.items.enum).toEqual(['招标公告', '中标公告'])
    expect(queryParameters.tender.properties.procurementTypes.items.enum).toEqual(['货物', '工程', '服务'])
    expect(skillRegister.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual(
      TENDER_SKILL_REGISTRATIONS.map(skill => skill.name),
    )
    expect(routeRegister).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: ARTIFACT_ROUTE_PREFIX }))
    expect(effect).toHaveBeenCalledTimes(15)
  })

  it('keeps every Skill self-contained and marked as the workflow-v2 provider', () => {
    for (const skill of TENDER_SKILL_REGISTRATIONS) {
      expect(skill.description).toContain(`[${TENDER_SKILL_CONTRACT_MARKER}]`)
      expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
      expect(skill.content).toContain('##')
    }
    expect(TENDER_SKILL_REGISTRATIONS[0]?.content).toContain('tender_workbench_get_workflow_state')
    expect(TENDER_SKILL_REGISTRATIONS[2]?.content).toContain('tender_workbench_preview_rules')
    expect(TENDER_SKILL_REGISTRATIONS[3]?.content).toContain('最终可见回答只报告完成进度')
    const disposers = TENDER_SKILL_REGISTRATIONS.map(() => vi.fn())
    const register = vi.fn((_skill: unknown) => disposers[register.mock.calls.length - 1]!)
    const dispose = registerTenderWorkflowSkills({ register } as never)
    dispose()
    expect(disposers.every(item => item.mock.calls.length === 1)).toBe(true)
  })

  it('threads official parent/root/agent/signal identity into nested calls', () => {
    const signal = new AbortController().signal
    const agent = { id: 'agent-1', session: { id: 'session-1' } }
    const token = { id: 'parent-token' }
    const input = nestedToolExecution({
      agent, rootCallId: 'root-1', signal, token,
    } as unknown as Pick<ToolRunContext, 'agent' | 'rootCallId' | 'signal' | 'token'>,
    'child-1' as never, 'mcp__qcc-tender__search_tenders', { keywords: ['大数据'] })
    expect(input).toMatchObject({
      callId: 'child-1', rootCallId: 'root-1', name: 'mcp__qcc-tender__search_tenders',
      parent: token, agent,
    })
    expect(input.signal).toBe(signal)
  })

  it('claims one prefix route only on loopback and returns the provider disposer', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const handler = vi.fn()
    expect(registerArtifactRoute({ host: '127.0.0.1', register } as never, handler)).toBe(dispose)
    expect(() => registerArtifactRoute({ host: '0.0.0.0', register } as never, handler))
      .toThrow('requires a 127.0.0.1')
  })
})
