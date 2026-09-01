import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import {
  defineTool,
  type ToolExecutionResult,
  type ToolRuntime,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import {
  QCC_PROPOSED_SEARCH_TOOL,
  QCC_TENDER_SEARCH_TOOL,
  type QccProposedSearchArgs,
  type QccTenderSearchArgs,
} from '../../contracts/query.ts'
import {
  TenderQueryIntentV1Schema,
  type TenderQueryIntentV1,
} from '../../contracts/query-schema.ts'
import {
  TenderWorkflowProjectionV1Schema,
  createEmptyTenderWorkflowProjection,
  type ArtifactRefV1,
  type TenderWorkflowProjectionV1,
} from '../../contracts/workflow.ts'
import {
  CommandReceiptCoordinator,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/command-receipts.ts'
import {
  createArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import { nestedToolExecution } from '../nested-tool.ts'
import {
  adaptQccProposedPayload,
  adaptQccTenderPayload,
  type AdaptedQccSource,
  type QccProposedSourceItem,
  type QccTenderSourceItem,
} from '../pipeline/qcc-adapters.ts'
import { normalizeQccSources } from '../pipeline/normalize.ts'

const QueryToolResultV1Schema = z.object({
  outcome: z.enum(['succeeded', 'partial', 'failed']),
  message: z.string().min(1).max(512),
  state: TenderWorkflowProjectionV1Schema,
}).strict()

export type QueryToolResultV1 = z.infer<typeof QueryToolResultV1Schema>

interface QueryToolDependencies {
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: CommandReceiptCoordinator
}

type SourceKey = 'tender' | 'proposed'

type SourceExecution =
  | {
    readonly source: SourceKey
    readonly status: 'succeeded'
    readonly payload: JsonValue
    readonly adapted: AdaptedQccSource<QccTenderSourceItem> | AdaptedQccSource<QccProposedSourceItem>
  }
  | {
    readonly source: SourceKey
    readonly status: 'failed'
    readonly message: string
  }

function sanitizeMessage(value: string): string {
  const sanitized = value.replaceAll(/\p{C}/gu, '').trim()
  return (sanitized === '' ? '来源工具调用失败。' : sanitized).slice(0, 512)
}

function contentText(result: ToolExecutionResult): string {
  const texts: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return
    if ('text' in value && typeof value.text === 'string') texts.push(value.text)
    if ('content' in value && Array.isArray(value.content)) value.content.forEach(visit)
  }
  result.content.forEach(visit)
  return texts.join('\n')
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

/** Extract the documented MCP canonical value: structuredContent first, otherwise text JSON. */
export function extractMcpCanonicalPayload(value: unknown): JsonValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('MCP canonical value must be an object')
  }
  const record = value as Record<string, unknown>
  if (record['structuredContent'] !== undefined) return jsonValue(record['structuredContent'])
  const content = record['content']
  if (!Array.isArray(content)) throw new TypeError('MCP canonical value has no content array')
  const text = content.flatMap((block): string[] => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const candidate = block as Record<string, unknown>
    return candidate['type'] === 'text' && typeof candidate['text'] === 'string' ? [candidate['text']] : []
  }).join('\n').trim()
  if (text === '') throw new TypeError('MCP canonical value has no structuredContent or text JSON')
  return jsonValue(JSON.parse(text) as unknown)
}

async function executeSource(
  dependencies: QueryToolDependencies,
  exec: ToolRunContext,
  source: SourceKey,
  args: QccTenderSearchArgs | QccProposedSearchArgs,
): Promise<SourceExecution> {
  const name = source === 'tender' ? QCC_TENDER_SEARCH_TOOL : QCC_PROPOSED_SEARCH_TOOL
  const callId = `${String(exec.callId)}:qcc:${source}` as Parameters<typeof nestedToolExecution>[1]
  const result = await dependencies.tools.execute(nestedToolExecution(exec, callId, name, args))
  exec.signal.throwIfAborted()
  if (result.isError) {
    return { source, status: 'failed', message: sanitizeMessage(result.error.message || contentText(result)) }
  }
  try {
    const payload = extractMcpCanonicalPayload(result.value)
    const adapted = source === 'tender'
      ? adaptQccTenderPayload(payload)
      : adaptQccProposedPayload(payload)
    return { source, status: 'succeeded', payload, adapted }
  } catch (error) {
    return {
      source,
      status: 'failed',
      message: sanitizeMessage(error instanceof Error ? error.message : '来源结果无法校验。'),
    }
  }
}

function failedState(
  previous: TenderWorkflowProjectionV1 | null,
  revision: number,
  message: string,
  now: string,
): TenderWorkflowProjectionV1 {
  const base = previous ?? createEmptyTenderWorkflowProjection()
  return TenderWorkflowProjectionV1Schema.parse({
    ...base,
    revision,
    currentStage: 'query',
    activeOperation: undefined,
    stages: {
      ...base.stages,
      query: { status: 'failed', updatedAt: now, errorCode: 'all-sources-failed', errorMessage: message },
    },
    lastFailure: { command: 'tender_workbench_query', code: 'all-sources-failed', message },
  })
}

function succeededState(
  revision: number,
  intent: TenderQueryIntentV1,
  now: string,
  querySpec: ArtifactRefV1,
  normalizedData: ArtifactRefV1,
  sourceArtifacts: Readonly<Partial<Record<SourceKey, ArtifactRefV1>>>,
  executions: readonly SourceExecution[],
  summary: ReturnType<typeof normalizeQccSources>['summary'],
): TenderWorkflowProjectionV1 {
  const stages = createEmptyTenderWorkflowProjection().stages
  const sourceState = Object.fromEntries(executions.map(execution => [execution.source, execution.status === 'succeeded'
    ? {
      status: 'succeeded' as const,
      loaded: execution.adapted.rawRecordCount,
      sourceData: sourceArtifacts[execution.source],
    }
    : { status: 'failed' as const, loaded: 0, errorMessage: execution.message }]))
  return TenderWorkflowProjectionV1Schema.parse({
    schemaVersion: 1,
    revision,
    currentStage: 'overview',
    stages: {
      ...stages,
      query: { status: 'succeeded', updatedAt: now },
      overview: { status: 'succeeded', updatedAt: now },
    },
    query: {
      scope: intent.scope,
      targetSummary: intent.target,
      querySpec,
      sources: sourceState,
      normalizedData,
      sourceRecordCount: summary.rawRecordCount,
      total: summary.normalizedProjectCount,
      duplicateCount: summary.linkedRecordCount,
      invalidCount: summary.invalidRecordCount,
      missingFieldCount: summary.missingFieldCount,
      unparseableFieldCount: summary.unparseableFieldCount,
    },
  })
}

function toolArgumentsSchema() {
  const textArray = { type: 'array' as const, items: { type: 'string' as const } }
  const amount = { type: 'number' as const }
  const tender = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      keywords: textArray,
      infoTypes: textArray,
      bidStatuses: textArray,
      beginDate: { type: 'string' as const },
      endDate: { type: 'string' as const },
      regions: textArray,
      procurementMethods: textArray,
      procurementTypes: textArray,
      TenderIndustries: textArray,
      budgetMin: amount,
      budgetMax: amount,
      winningAmountMin: amount,
      winningAmountMax: amount,
      smartSort: { type: 'boolean' as const },
    },
  }
  const proposed = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      keywords: textArray,
      beginDate: { type: 'string' as const },
      endDate: { type: 'string' as const },
      regions: textArray,
      projectStages: textArray,
      approvalStatuses: textArray,
      investmentMin: amount,
      investmentMax: amount,
    },
  }
  return {
    schemaVersion: { type: 'integer' as const, const: 1, required: true as const },
    commandId: { type: 'string' as const, required: true as const },
    kind: { type: 'string' as const, const: 'query.start', required: true as const },
    scope: { type: 'string' as const, enum: ['tender', 'proposed', 'combined'] as const, required: true as const },
    target: { type: 'string' as const, required: true as const },
    tender,
    proposed,
  }
}

export function createTenderWorkbenchQueryTool(dependencies: QueryToolDependencies) {
  return defineTool({
    name: 'tender_workbench_query',
    description: 'Execute one Session-scoped tender/proposed-project query, normalize the actual qcc results, and atomically replace the active dataset snapshot.',
    parameters: toolArgumentsSchema(),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', enum: ['succeeded', 'partial', 'failed'], required: true },
          message: { type: 'string', required: true },
          state: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        const parsed = QueryToolResultV1Schema.parse(value)
        return [{ type: 'text', text: parsed.message }]
      },
      presentationMeta(args, value) {
        const parsed = QueryToolResultV1Schema.parse(value)
        return jsonValue({
          domain: 'dsh-tender-workbench',
          schemaVersion: 1,
          commandId: args.commandId,
          command: 'tender_workbench_query',
          state: parsed.state,
        })
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
      const intent = TenderQueryIntentV1Schema.parse(args)
      const previous = dependencies.sessionProjections.stateOf(exec.agent.session, 'dshTenderWorkflow') ?? null
      const observedRevision = previous?.revision ?? 0
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, exec.agent.session.header)
      const command = await dependencies.receipts.run(String(exec.agent.session.id), {
        commandId: intent.commandId,
        arguments: jsonValue(intent) as ReceiptJsonValue,
        observedProjectionRevision: observedRevision,
        store: transaction,
        revisionOf: result => QueryToolResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          const executions: SourceExecution[] = []
          if (intent.tender !== undefined) executions.push(await executeSource(dependencies, exec, 'tender', intent.tender))
          if (intent.proposed !== undefined) executions.push(await executeSource(dependencies, exec, 'proposed', intent.proposed))
          exec.signal.throwIfAborted()
          const successes = executions.filter((execution): execution is Extract<SourceExecution, { readonly status: 'succeeded' }> => execution.status === 'succeeded')
          const now = new Date().toISOString()
          if (successes.length === 0) {
            const message = sanitizeMessage(executions.map(execution => execution.status === 'failed' ? `${execution.source}: ${execution.message}` : '').filter(Boolean).join('；'))
            return jsonValue(QueryToolResultV1Schema.parse({
              outcome: 'failed',
              message: `查询失败：${message}`.slice(0, 512),
              state: failedState(previous, nextRevision, message, now),
            })) as ReceiptJsonValue
          }

          const sourceArtifacts: Partial<Record<SourceKey, ArtifactRefV1>> = {}
          for (const success of successes) {
            sourceArtifacts[success.source] = await transaction.stageJson(
              'source-data',
              `qcc-${success.source}-${intent.commandId}.json`,
              success.payload,
              success.adapted.rawRecordCount,
            )
          }
          const sourceSummary = Object.fromEntries(executions.map(execution => [execution.source, execution.status === 'succeeded'
            ? { status: 'succeeded' as const, loaded: execution.adapted.rawRecordCount }
            : { status: 'failed' as const, loaded: 0, errorMessage: execution.message }]))
          const tenderSuccess = successes.find(success => success.source === 'tender')
          const proposedSuccess = successes.find(success => success.source === 'proposed')
          const dataset = normalizeQccSources({
            ...(tenderSuccess === undefined ? {} : { tender: tenderSuccess.adapted as AdaptedQccSource<QccTenderSourceItem> }),
            ...(proposedSuccess === undefined ? {} : { proposed: proposedSuccess.adapted as AdaptedQccSource<QccProposedSourceItem> }),
            sources: sourceSummary,
            createdAt: now,
          })
          const querySpec = await transaction.stageJson('query-spec', `query-${intent.commandId}.json`, jsonValue(intent))
          const normalizedData = await transaction.stageJson(
            'normalized-data',
            `dataset-${intent.commandId}.json`,
            jsonValue(dataset),
            dataset.rows.length,
          )
          const state = succeededState(
            nextRevision,
            intent,
            now,
            querySpec,
            normalizedData,
            sourceArtifacts,
            executions,
            dataset.summary,
          )
          const outcome = successes.length === executions.length ? 'succeeded' : 'partial'
          const message = outcome === 'partial'
            ? `查询部分完成：已保留 ${successes.length} 个可用来源，失败来源已明确记录。`
            : `查询完成：已生成包含 ${dataset.rows.length} 个规范化项目的新活动快照。`
          return jsonValue(QueryToolResultV1Schema.parse({ outcome, message, state })) as ReceiptJsonValue
        },
      })
      return QueryToolResultV1Schema.parse(command.result)
    },
  })
}
