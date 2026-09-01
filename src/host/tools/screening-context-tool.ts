import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { NormalizedDatasetV1Schema } from '../../contracts/dataset.ts'
import { TenderQueryIntentV1Schema } from '../../contracts/query-schema.ts'
import { ScreeningDraftContextV1Schema } from '../../contracts/screening.ts'
import {
  createArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import { createScreeningDraftContext } from '../pipeline/screening-context.ts'

const ScreeningContextInputV1Schema = z.object({
  schemaVersion: z.literal(1),
  activeDatasetRef: z.string().min(1).max(128),
  projectionRevision: z.number().int().nonnegative(),
}).strict()

const ScreeningContextResultV1Schema = z.object({
  message: z.string().min(1).max(512),
  context: ScreeningDraftContextV1Schema,
}).strict()

export type ScreeningContextResultV1 = z.infer<typeof ScreeningContextResultV1Schema>

export interface ScreeningContextToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
}

function requireAgent(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return exec.agent
}

/** Read-only bridge for old, refreshed, or compacted S2 snapshots entering S3. */
export function createTenderWorkbenchScreeningContextTool(dependencies: ScreeningContextToolDependencies) {
  return defineTool({
    name: 'tender_workbench_get_screening_context',
    description: 'Read the bounded, deterministic S3 drafting context for the current active dataset. Call this before proposing rules. Never re-query qcc, read raw source artifacts, write files, or use shell tools to derive the draft.',
    parameters: {
      schemaVersion: { type: 'integer', const: 1, required: true },
      activeDatasetRef: { type: 'string', required: true },
      projectionRevision: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string', required: true },
          context: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        const parsed = ScreeningContextResultV1Schema.parse(value)
        return [{ type: 'text', text: parsed.message }]
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = ScreeningContextInputV1Schema.parse(rawArgs)
      const state = dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
      const query = state?.query
      const active = query?.normalizedData
      if (state === null || state === undefined || query === undefined || active === undefined || active.id !== args.activeDatasetRef) {
        throw new Error('活动数据快照已变化；不能读取旧 activeDatasetRef 的初筛上下文。')
      }
      if (state.revision !== args.projectionRevision) {
        throw new Error('Projection revision 已变化；请基于当前状态重新读取初筛上下文。')
      }
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      await transaction.load()
      exec.signal.throwIfAborted()
      const dataset = NormalizedDatasetV1Schema.parse(await transaction.readJsonArtifact(active.id, 'normalized-data'))
      const intent = TenderQueryIntentV1Schema.parse(await transaction.readJsonArtifact(query.querySpec.id, 'query-spec'))
      const context = createScreeningDraftContext({
        activeDatasetRef: active.id,
        projectionRevision: state.revision,
        intent,
        dataset,
      })
      return ScreeningContextResultV1Schema.parse({
        message: `已读取当前活动快照的有界初筛上下文：${context.total} 个规范化项目、${context.samples.length} 个代表性样本。`,
        context,
      })
    },
  })
}
