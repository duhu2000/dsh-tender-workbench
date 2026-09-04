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
  RunQueryToolInputV2Schema,
  type RunQueryToolInputV2,
} from '../../contracts/tool-inputs.ts'
import { renderTenderToolResult } from '../../contracts/tool-results.ts'
import {
  TenderWorkflowProjectionV2Schema,
  createEmptyTenderWorkflowProjection,
  type ArtifactRefV1,
  type TenderWorkflowProjectionV2,
} from '../../contracts/workflow.ts'
import {
  ScreeningDraftContextV1Schema,
} from '../../contracts/screening.ts'
import {
  IntentReceiptCoordinator,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/intent-receipts.ts'
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
import { createScreeningDraftContext } from '../pipeline/screening-context.ts'
import { resolveToolInvocation, toolOriginParameter } from '../tool-contract.ts'

const QueryToolResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_run_query'),
  intentId: z.string().min(1).max(128),
  outcome: z.enum(['succeeded', 'partial', 'failed']),
  message: z.string().min(1).max(512),
  state: TenderWorkflowProjectionV2Schema,
  context: ScreeningDraftContextV1Schema.optional(),
  control: z.union([
    z.object({ status: z.literal('complete') }).strict(),
    z.object({ status: z.literal('failed'), reasonCode: z.string().min(1).max(128), retryable: z.boolean() }).strict(),
  ]),
}).strict()

export type QueryToolResultV2 = z.infer<typeof QueryToolResultV2Schema>

interface QueryToolDependencies {
  readonly tools: Pick<ToolRuntime, 'execute'>
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: IntentReceiptCoordinator
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

function hasSourceList(value: JsonValue, source: SourceKey): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const key = source === 'tender' ? '标讯列表' : '拟建项目列表'
  return Object.hasOwn(value, key)
}

/** Extract every documented MCP payload candidate in precedence order. */
export function extractMcpCanonicalPayloadCandidates(value: unknown): readonly JsonValue[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('MCP canonical value must be an object')
  }
  const record = value as Record<string, unknown>
  const candidates: JsonValue[] = []
  if (record['structuredContent'] !== undefined) candidates.push(jsonValue(record['structuredContent']))
  const content = record['content']
  if (!Array.isArray(content)) {
    if (candidates.length > 0) return candidates
    throw new TypeError('MCP canonical value has no content array')
  }
  const text = content.flatMap((block): string[] => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const candidate = block as Record<string, unknown>
    return candidate['type'] === 'text' && typeof candidate['text'] === 'string' ? [candidate['text']] : []
  }).join('\n').trim()
  if (text !== '') {
    try {
      candidates.push(jsonValue(JSON.parse(text) as unknown))
    } catch (error) {
      if (candidates.length === 0) throw error
    }
  }
  if (candidates.length === 0) throw new TypeError('MCP canonical value has no structuredContent or text JSON')
  return candidates
}

/** Extract the preferred MCP payload without applying a source-specific contract. */
export function extractMcpCanonicalPayload(value: unknown): JsonValue {
  const [preferred] = extractMcpCanonicalPayloadCandidates(value)
  if (preferred === undefined) throw new TypeError('MCP canonical value has no payload candidate')
  return preferred
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
    const candidates = [...extractMcpCanonicalPayloadCandidates(result.value)]
      .sort((left, right) => Number(hasSourceList(right, source)) - Number(hasSourceList(left, source)))
    let contractError: unknown
    for (const payload of candidates) {
      try {
        const adapted = source === 'tender'
          ? adaptQccTenderPayload(payload)
          : adaptQccProposedPayload(payload)
        return { source, status: 'succeeded', payload, adapted }
      } catch (error) {
        contractError = error
      }
    }
    throw contractError ?? new TypeError('MCP canonical value has no payload candidate')
  } catch (error) {
    return {
      source,
      status: 'failed',
      message: sanitizeMessage(error instanceof Error ? error.message : '来源结果无法校验。'),
    }
  }
}

function failedState(
  previous: TenderWorkflowProjectionV2 | null,
  revision: number,
  intentId: string,
  message: string,
  now: string,
): TenderWorkflowProjectionV2 {
  const base = previous ?? createEmptyTenderWorkflowProjection()
  return TenderWorkflowProjectionV2Schema.parse({
    ...base,
    revision,
    currentStage: 'query',
    activeOperation: undefined,
    pendingIntent: undefined,
    stages: {
      ...base.stages,
      query: { status: 'failed', updatedAt: now, errorCode: 'all-sources-failed', errorMessage: message },
    },
    lastFailure: { intentId, tool: 'tender_workbench_run_query', code: 'all-sources-failed', message },
  })
}

function succeededState(
  revision: number,
  intent: RunQueryToolInputV2,
  now: string,
  querySpec: ArtifactRefV1,
  normalizedData: ArtifactRefV1,
  sourceArtifacts: Readonly<Partial<Record<SourceKey, ArtifactRefV1>>>,
  executions: readonly SourceExecution[],
  summary: ReturnType<typeof normalizeQccSources>['summary'],
): TenderWorkflowProjectionV2 {
  const stages = createEmptyTenderWorkflowProjection().stages
  const sourceState = Object.fromEntries(executions.map(execution => [execution.source, execution.status === 'succeeded'
    ? {
      status: 'succeeded' as const,
      loaded: execution.adapted.rawRecordCount,
      sourceData: sourceArtifacts[execution.source],
    }
    : { status: 'failed' as const, loaded: 0, errorMessage: execution.message }]))
  return TenderWorkflowProjectionV2Schema.parse({
    schemaVersion: 2,
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
      infoTypes: { type: 'array' as const, items: { type: 'string' as const, enum: ['招标公告', '中标公告'] as const } },
      bidStatuses: textArray,
      beginDate: { type: 'string' as const },
      endDate: { type: 'string' as const },
      regions: textArray,
      procurementMethods: textArray,
      procurementTypes: { type: 'array' as const, items: { type: 'string' as const, enum: ['货物', '工程', '服务'] as const } },
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
    schemaVersion: { type: 'integer' as const, const: 2, required: true as const },
    origin: { ...toolOriginParameter({ autonomous: false }), required: true as const },
    projectionRevision: { type: 'integer' as const, required: true as const },
    scope: { type: 'string' as const, enum: ['tender', 'proposed', 'combined'] as const, required: true as const },
    target: { type: 'string' as const, required: true as const },
    tender,
    proposed,
  }
}

export function createTenderWorkbenchQueryTool(dependencies: QueryToolDependencies) {
  return defineTool({
    name: 'tender_workbench_run_query',
    description: 'Execute one validated Session-scoped tender/proposed query and atomically replace the active normalized dataset.',
    parameters: toolArgumentsSchema(),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', enum: ['succeeded', 'partial', 'failed'], required: true },
          message: { type: 'string', required: true },
          state: { type: 'json', required: true },
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_run_query', required: true },
          intentId: { type: 'string', required: true },
          context: { type: 'json' },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(QueryToolResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const parsed = QueryToolResultV2Schema.parse(value)
        const origin = RunQueryToolInputV2Schema.parse(args).origin.kind
        return jsonValue({
          domain: 'dsh-tender-workbench',
          schemaVersion: 2,
          tool: 'tender_workbench_run_query',
          intentId: parsed.intentId,
          origin,
          effect: 'mutation',
          previousRevision: parsed.state.revision - 1,
          control: parsed.control,
          state: parsed.state,
        })
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
      const intent = RunQueryToolInputV2Schema.parse(args)
      const previous = dependencies.sessionProjections.stateOf(exec.agent.session, 'dshTenderWorkflow') ?? null
      const current = previous ?? createEmptyTenderWorkflowProjection()
      if (current.revision !== intent.projectionRevision) throw new Error('Projection revision 已变化；请重新提交查询。')
      const invocation = resolveToolInvocation({
        rawOrigin: intent.origin,
        rawArgs: intent,
        exec,
        state: current,
        tool: 'tender_workbench_run_query',
        intentKind: 'query.run',
        mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('查询动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, exec.agent.session.header)
      const command = await dependencies.receipts.run(String(exec.agent.session.id), {
        intentId,
        tool: 'tender_workbench_run_query',
        arguments: jsonValue(intent) as ReceiptJsonValue,
        observedProjectionRevision: intent.projectionRevision,
        store: transaction,
        revisionOf: result => QueryToolResultV2Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          const executions: SourceExecution[] = []
          if (intent.tender !== undefined) executions.push(await executeSource(dependencies, exec, 'tender', intent.tender))
          if (intent.proposed !== undefined) executions.push(await executeSource(dependencies, exec, 'proposed', intent.proposed))
          exec.signal.throwIfAborted()
          const successes = executions.filter((execution): execution is Extract<SourceExecution, { readonly status: 'succeeded' }> => execution.status === 'succeeded')
          const now = new Date().toISOString()
          if (successes.length === 0) {
            const message = sanitizeMessage(executions.map(execution => execution.status === 'failed' ? `${execution.source}: ${execution.message}` : '').filter(Boolean).join('；'))
            return jsonValue(QueryToolResultV2Schema.parse({
              domain: 'dsh-tender-workbench', schemaVersion: 2, tool: 'tender_workbench_run_query',
              intentId,
              outcome: 'failed',
              message: `查询失败：${message}`.slice(0, 512),
              state: failedState(previous, nextRevision, intentId, message, now),
              control: { status: 'failed', reasonCode: 'all-sources-failed', retryable: true },
            })) as ReceiptJsonValue
          }

          const sourceArtifacts: Partial<Record<SourceKey, ArtifactRefV1>> = {}
          for (const success of successes) {
            sourceArtifacts[success.source] = await transaction.stageJson(
              'source-data',
              `qcc-${success.source}-${intentId}.json`,
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
          const querySpec = await transaction.stageJson('query-spec', `query-${intentId}.json`, jsonValue(intent))
          const normalizedData = await transaction.stageJson(
            'normalized-data',
            `dataset-${intentId}.json`,
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
          return jsonValue(QueryToolResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2, tool: 'tender_workbench_run_query',
            intentId,
            outcome,
            message,
            state,
            context: createScreeningDraftContext({
              activeDatasetRef: normalizedData.id,
              projectionRevision: state.revision,
              intent,
              dataset,
            }),
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return QueryToolResultV2Schema.parse(command.result)
    },
  })
}
