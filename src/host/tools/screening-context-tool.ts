import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { NormalizedDatasetV1Schema } from '../../contracts/dataset.ts'
import { GetRuleDraftingContextInputV2Schema, RunQueryToolInputV2Schema } from '../../contracts/tool-inputs.ts'
import { renderTenderToolResult } from '../../contracts/tool-results.ts'
import { ScreeningDraftContextV1Schema } from '../../contracts/screening.ts'
import {
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV2,
} from '../../contracts/workflow.ts'
import {
  createArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import { createScreeningDraftContext } from '../pipeline/screening-context.ts'
import { resolveToolInvocation, toolOriginParameter } from '../tool-contract.ts'

const RuleDraftingContextResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_get_rule_drafting_context'),
  intentId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(512),
  context: ScreeningDraftContextV1Schema,
  control: z.union([
    z.object({ status: z.literal('complete') }).strict(),
    z.object({
      status: z.literal('continue'),
      nextTool: z.literal('tender_workbench_preview_rules'),
    }).strict(),
  ]),
}).strict()

export type RuleDraftingContextResultV2 = z.infer<typeof RuleDraftingContextResultV2Schema>

export interface ScreeningContextToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

function currentProjection(
  dependencies: ScreeningContextToolDependencies,
  exec: ToolRunContext,
): TenderWorkflowProjectionV2 {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return dependencies.sessionProjections.stateOf(exec.agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

export function createTenderWorkbenchRuleDraftingContextTool(dependencies: ScreeningContextToolDependencies) {
  return defineTool({
    name: 'tender_workbench_get_rule_drafting_context',
    description: 'Read the bounded current query scope, deterministic summary, up to eight samples, and context fingerprint used to propose screening rules.',
    parameters: {
      schemaVersion: { type: 'integer', const: 2, required: true },
      origin: { ...toolOriginParameter({ autonomous: true }), required: true },
      activeDatasetRef: { type: 'string', required: true },
      projectionRevision: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_get_rule_drafting_context', required: true },
          intentId: { type: 'string' },
          message: { type: 'string', required: true },
          context: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(RuleDraftingContextResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = GetRuleDraftingContextInputV2Schema.parse(args)
        const parsed = RuleDraftingContextResultV2Schema.parse(value)
        return jsonValue({
          domain: 'dsh-tender-workbench', schemaVersion: 2,
          tool: 'tender_workbench_get_rule_drafting_context',
          ...(parsed.intentId === undefined ? {} : { intentId: parsed.intentId }),
          origin: input.origin.kind,
          effect: 'read-only',
          observedRevision: input.projectionRevision,
          control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
      const args = GetRuleDraftingContextInputV2Schema.parse(rawArgs)
      const state = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin,
        rawArgs: args,
        exec,
        state,
        tool: 'tender_workbench_get_rule_drafting_context',
        intentKind: 'rules.propose',
        mutation: false,
      })
      const query = state.query
      const active = query?.normalizedData
      if (query === undefined || active === undefined || active.id !== args.activeDatasetRef) {
        throw new Error('活动数据快照已变化；不能读取旧 activeDatasetRef 的初筛上下文。')
      }
      if (state.revision !== args.projectionRevision) {
        throw new Error('Projection revision 已变化；请基于当前状态重新读取初筛上下文。')
      }
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, exec.agent.session.header)
      await transaction.load()
      exec.signal.throwIfAborted()
      const dataset = NormalizedDatasetV1Schema.parse(await transaction.readJsonArtifact(active.id, 'normalized-data'))
      const intent = RunQueryToolInputV2Schema.parse(await transaction.readJsonArtifact(query.querySpec.id, 'query-spec'))
      const context = createScreeningDraftContext({
        activeDatasetRef: active.id,
        projectionRevision: state.revision,
        intent,
        dataset,
      })
      const control = invocation.origin === 'autonomous'
        ? { status: 'complete' as const }
        : { status: 'continue' as const, nextTool: 'tender_workbench_preview_rules' as const }
      return RuleDraftingContextResultV2Schema.parse({
        domain: 'dsh-tender-workbench', schemaVersion: 2,
        tool: 'tender_workbench_get_rule_drafting_context',
        ...(invocation.intentId === undefined ? {} : { intentId: invocation.intentId }),
        message: `已读取当前活动快照的有界初筛上下文：${context.total} 个规范化项目、${context.samples.length} 个代表性样本。`,
        context,
        control,
      })
    },
  })
}
