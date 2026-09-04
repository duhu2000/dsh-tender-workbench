import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV2,
} from '../src/contracts/workflow.ts'
import {
  createTenderWorkbenchWorkflowStateTool,
  type WorkflowStateResultV2,
} from '../src/host/tools/workflow-state-tool.ts'

function context(): ToolRunContext {
  return {
    callId: 'state-call', rootCallId: 'state-call', token: Symbol('state'),
    signal: new AbortController().signal,
    agent: { id: 'agent-1', session: { id: 'session-1', header: { version: 0, id: 'session-1', createdAt: 1 } } },
  } as unknown as ToolRunContext
}

describe('tender_workbench_get_workflow_state', () => {
  it('returns a bounded explicit empty state and action Skill routing', async () => {
    const tool = createTenderWorkbenchWorkflowStateTool({ sessionProjections: { stateOf: () => null } as never })
    const result = await tool.execute({}, context()) as WorkflowStateResultV2
    expect(result).toMatchObject({
      schemaVersion: 2, tool: 'tender_workbench_get_workflow_state',
      context: {
        projectionRevision: 0, currentStage: 'query',
      },
      control: { status: 'complete' },
    })
    expect(result.context.availableActions.find(action => action.kind === 'query.run'))
      .toMatchObject({ skill: 'tender-workbench-query', enabled: true })
    expect(result.context.availableActions.find(action => action.kind === 'rules.propose'))
      .toMatchObject({ skill: 'tender-workbench-screening', enabled: false })
    expect(result.context.availableActions.find(action => action.kind === 'report.create'))
      .toMatchObject({ skill: 'tender-workbench-report', enabled: false })
    expect(JSON.stringify(result)).not.toMatch(/accessToken|absolutePath|sessionId/u)
    await expect(tool.execute({ sessionId: 'forbidden' }, context())).rejects.toThrow()
  })

  it('reports current progress and enables only state-valid follow-up actions', async () => {
    const createdAt = '2026-09-01T00:00:00.000Z'
    const artifact = (kind: 'query-spec' | 'normalized-data' | 'review-data' | 'final-snapshot') => ({
      id: `${kind}-1`, kind, fileName: `${kind}.json`, mediaType: 'application/json', createdAt,
      accessToken: `${kind}-token`,
    })
    const base = createEmptyTenderWorkflowProjection()
    const state: TenderWorkflowProjectionV2 = {
      ...base,
      revision: 5,
      currentStage: 'report',
      query: {
        scope: 'tender', targetSummary: '数据项目', querySpec: artifact('query-spec'),
        sources: { tender: { status: 'succeeded', loaded: 4 } },
        normalizedData: artifact('normalized-data'), sourceRecordCount: 4, total: 4,
        duplicateCount: 0, invalidCount: 0,
      },
      review: {
        revision: 1, data: artifact('review-data'), pending: 1, confirmedCandidate: 2,
        watch: 1, exclude: 0, canRevert: false,
      },
      report: {
        finalSnapshot: artifact('final-snapshot'), finalSnapshotId: 'snapshot-1', completeness: 'partial',
        excel: { status: 'failed', errorMessage: 'failed' }, pdf: { status: 'succeeded' },
      },
    }
    const tool = createTenderWorkbenchWorkflowStateTool({ sessionProjections: { stateOf: () => state } as never })
    const result = await tool.execute({}, context()) as WorkflowStateResultV2
    expect(result.context).toMatchObject({
      projectionRevision: 5,
      query: { total: 4, sourceRecordCount: 4 },
      review: { reviewed: 3, pending: 1, canRevert: false },
      report: { finalSnapshotId: 'snapshot-1', excel: 'failed', pdf: 'succeeded' },
    })
    expect(result.context.availableActions.find(action => action.kind === 'report.retry')).toMatchObject({ enabled: true })
    expect(result.context.availableActions.find(action => action.kind === 'report.create')).toMatchObject({ enabled: true })
    expect(result.context.availableActions.find(action => action.kind === 'review.revert')).toMatchObject({ enabled: false })
  })

  it('marks every new action unavailable while one Intent is pending', async () => {
    const base = createEmptyTenderWorkflowProjection()
    const state: TenderWorkflowProjectionV2 = {
      ...base,
      pendingIntent: {
        intentId: 'query-pending', kind: 'query.run', skill: 'tender-workbench-query',
        origin: 'workbench-intent', status: 'waiting-agent', turn: 1,
        expectedTool: 'tender_workbench_run_query',
        terminalTools: ['tender_workbench_run_query'],
        intentFingerprint: 'intent-pending',
        bindingFingerprint: 'binding-pending',
      },
    }
    const tool = createTenderWorkbenchWorkflowStateTool({ sessionProjections: { stateOf: () => state } as never })
    const result = await tool.execute({}, context()) as WorkflowStateResultV2
    expect(result.context.pending).toMatchObject({
      intentId: 'query-pending', status: 'waiting-agent', expectedTool: 'tender_workbench_run_query',
    })
    expect(result.context.availableActions.every(action => !action.enabled)).toBe(true)
    expect(result.context.availableActions.every(action => action.reason?.includes('query.run'))).toBe(true)
  })
})
