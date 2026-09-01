import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { ARTIFACT_ROUTE_PREFIX, registerArtifactRoute } from '../src/host/artifacts/register-route.ts'
import { nestedToolExecution } from '../src/host/nested-tool.ts'
import { TENDER_AGENT_SKILL, registerTenderAgentSkill } from '../src/host/skill.ts'

describe('official Host seam contracts', () => {
  it('registers one releasable whole-Session Projection definition', () => {
    const projectionRegister = vi.fn((_definition: unknown) => () => {})
    const toolRegister = vi.fn((_definition: unknown) => () => {})
    const routeRegister = vi.fn((_route: unknown) => () => {})
    const persistence = { locate: vi.fn() }
    const effect = vi.fn((callback: () => unknown) => callback())
    apply({
      sessionProjections: { register: projectionRegister },
      tools: { register: toolRegister },
      webServer: { host: '127.0.0.1', register: routeRegister },
      sessions: { get: vi.fn() },
      get: (name: string) => name === 'sessionPersistence' ? persistence : undefined,
      effect,
    } as unknown as Context)
    expect(projectionRegister).toHaveBeenCalledOnce()
    const definition = (projectionRegister.mock.calls[0] as unknown[] | undefined)?.[0]
    expect(definition).toMatchObject({
      key: 'dshTenderWorkflow',
      stateVersion: 1,
      wire: expect.any(Object),
    })
    expect(toolRegister.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ name: 'tender_workbench_query' }),
      expect.objectContaining({ name: 'tender_workbench_get_screening_context' }),
      expect.objectContaining({ name: 'tender_workbench_preview_rules' }),
      expect.objectContaining({ name: 'tender_workbench_confirm_rules' }),
    ])
    expect(routeRegister).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: ARTIFACT_ROUTE_PREFIX }))
    expect(effect).toHaveBeenCalledTimes(5)
  })

  it('threads the official parent/root/agent/signal identity into nested calls', () => {
    const signal = new AbortController().signal
    const agent = { id: 'agent-1', session: { id: 'session-1' } }
    const token = { id: 'parent-token' }
    const input = nestedToolExecution({
      agent,
      rootCallId: 'root-1',
      signal,
      token,
    } as unknown as Pick<ToolRunContext, 'agent' | 'rootCallId' | 'signal' | 'token'>, 'child-1' as never, 'mcp__qcc-tender__search_tenders', { keywords: ['大数据'] })
    expect(input).toMatchObject({
      callId: 'child-1', rootCallId: 'root-1', name: 'mcp__qcc-tender__search_tenders',
      parent: token, agent,
    })
    expect(input.signal).toBe(signal)
    expect(() => nestedToolExecution({ rootCallId: 'root', signal, token } as never, 'child' as never, 'tool', {}))
      .toThrow('require an Agent-owned Session')
  })

  it('claims one prefix route only on loopback and returns the provider disposer', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const handler = vi.fn()
    expect(registerArtifactRoute({ host: '127.0.0.1', register } as never, handler)).toBe(dispose)
    expect(register).toHaveBeenCalledWith({ kind: 'prefix', path: ARTIFACT_ROUTE_PREFIX, handler })
    expect(() => registerArtifactRoute({ host: '0.0.0.0', register } as never, handler))
      .toThrow('requires a 127.0.0.1')
  })

  it('freezes the bundled skill identity and MVP boundaries before registration', () => {
    expect(TENDER_AGENT_SKILL.name).toBe('tender-agent-workbench')
    expect(TENDER_AGENT_SKILL.content).toContain('查询 → 概况 → 规则共创与确认')
    expect(TENDER_AGENT_SKILL.content).toContain('订阅、定时任务和商机跟进不属于 MVP')
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    expect(registerTenderAgentSkill({ register } as never)).toBe(dispose)
    expect(register).toHaveBeenCalledWith(TENDER_AGENT_SKILL)
  })
})
