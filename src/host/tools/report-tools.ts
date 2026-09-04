import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import {
  AnalysisDatasetV1Schema,
  ReviewDatasetV1Schema,
  type ReviewDatasetV1,
} from '../../contracts/analysis-review.ts'
import { NormalizedDatasetV1Schema, type NormalizedDatasetV1 } from '../../contracts/dataset.ts'
import {
  ReportContextV2Schema,
  ReportDatasetSchema,
  type ReportDataset,
} from '../../contracts/reporting.ts'
import { ClassifiedDatasetV1Schema } from '../../contracts/screening.ts'
import {
  CreateReportToolInputV2Schema,
  GetReportNarrativeContextInputV2Schema,
  RetryReportToolInputV2Schema,
  type CreateReportToolInputV2,
  type GetReportNarrativeContextInputV2,
} from '../../contracts/tool-inputs.ts'
import { renderTenderToolResult } from '../../contracts/tool-results.ts'
import {
  TenderWorkflowProjectionV2Schema,
  createEmptyTenderWorkflowProjection,
  type ArtifactRefV1,
  type TenderWorkflowProjectionV2,
} from '../../contracts/workflow.ts'
import {
  IntentReceiptCoordinator,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/intent-receipts.ts'
import {
  createArtifactTransaction,
  type ArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import { analysisBaseRows, syncReviewDataset } from '../pipeline/analysis-review.ts'
import { renderReportExcel, type RenderedReportFile } from '../reporting/excel.ts'
import { renderReportPdf } from '../reporting/pdf.ts'
import {
  buildReportDataset,
  createReportContext,
  metricValueOf,
  validateReportNarrative,
} from '../reporting/report-dataset.ts'
import { resolveToolInvocation, toolOriginParameter } from '../tool-contract.ts'

const ReportNarrativeContextResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_get_report_narrative_context'),
  intentId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(512),
  context: ReportContextV2Schema,
  control: z.union([
    z.object({ status: z.literal('complete') }).strict(),
    z.object({ status: z.literal('continue'), nextTool: z.literal('tender_workbench_create_report') }).strict(),
  ]),
}).strict()

const ReportProgressV2Schema = z.object({
  succeeded: z.number().int().min(0).max(2),
  failed: z.number().int().min(0).max(2),
  formats: z.object({
    excel: z.enum(['not-started', 'running', 'succeeded', 'failed']),
    pdf: z.enum(['not-started', 'running', 'succeeded', 'failed']),
  }).strict(),
  projectionRevision: z.number().int().nonnegative(),
}).strict()

const ReportMutationResultV2BaseSchema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  intentId: z.string().min(1).max(128),
  outcome: z.enum(['succeeded', 'partial']),
  message: z.string().min(1).max(512),
  result: z.object({
    finalSnapshotId: z.string().min(1).max(128),
    finalSnapshotArtifactRef: z.string().min(1).max(128),
    completeness: z.enum(['partial', 'complete']),
    excelArtifactRef: z.string().min(1).max(128).optional(),
    pdfArtifactRef: z.string().min(1).max(128).optional(),
  }).strict(),
  progress: ReportProgressV2Schema,
  state: TenderWorkflowProjectionV2Schema,
  control: z.object({ status: z.literal('complete') }).strict(),
}).strict()

const CreateReportResultV2Schema = ReportMutationResultV2BaseSchema.extend({
  tool: z.literal('tender_workbench_create_report'),
}).strict()

const RetryReportResultV2Schema = ReportMutationResultV2BaseSchema.extend({
  tool: z.literal('tender_workbench_retry_report'),
}).strict()

export type ReportNarrativeContextResultV2 = z.infer<typeof ReportNarrativeContextResultV2Schema>
export type CreateReportResultV2 = z.infer<typeof CreateReportResultV2Schema>
export type RetryReportResultV2 = z.infer<typeof RetryReportResultV2Schema>

type Renderer = (dataset: ReportDataset, signal: AbortSignal) => Promise<RenderedReportFile>

export interface ReportToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: IntentReceiptCoordinator
  readonly renderers?: {
    readonly excel: Renderer
    readonly pdf: Renderer
  }
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

function requireAgent(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return exec.agent
}

function currentProjection(dependencies: ReportToolDependencies, exec: ToolRunContext): TenderWorkflowProjectionV2 {
  const agent = requireAgent(exec)
  return dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

function assertReportBinding(
  state: TenderWorkflowProjectionV2,
  input: Pick<GetReportNarrativeContextInputV2,
    'activeDatasetRef' | 'projectionRevision' | 'basis' | 'reviewArtifactRef' | 'reviewRevision'>,
): void {
  if (state.revision !== input.projectionRevision) {
    throw new Error('Projection revision 已变化；旧报告上下文或叙述已失效。')
  }
  if (state.query?.normalizedData?.id !== input.activeDatasetRef) {
    throw new Error('活动数据快照已变化；旧报告上下文或叙述已失效。')
  }
  if (input.basis.kind === 'dataset-only') {
    if (state.classification !== undefined || state.analysis !== undefined) {
      throw new Error('报告请求必须绑定当前分类与分析链路。')
    }
  } else if (state.classification?.data.id !== input.basis.classificationArtifactRef
    || state.classification.ruleSetVersion !== input.basis.ruleSetVersion
    || state.analysis?.version !== input.basis.analysisVersion) {
    throw new Error('当前分类或分析版本与报告请求绑定不一致。')
  }
  if (state.review === undefined) {
    if (input.reviewArtifactRef !== undefined || input.reviewRevision !== 0) {
      throw new Error('当前尚无复核 Artifact；报告请求绑定无效。')
    }
  } else if (state.review.data.id !== input.reviewArtifactRef || state.review.revision !== input.reviewRevision) {
    throw new Error('当前用户复核版本与报告请求绑定不一致。')
  }
}

async function loadCurrentData(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV2,
): Promise<{ readonly normalized: NormalizedDatasetV1; readonly review: ReviewDatasetV1 }> {
  const normalizedRef = state.query?.normalizedData
  if (normalizedRef === undefined) throw new Error('当前 Session 尚无可生成报告的规范化数据。')
  const normalized = NormalizedDatasetV1Schema.parse(
    await transaction.readJsonArtifact(normalizedRef.id, 'normalized-data'),
  )
  const classified = state.classification === undefined
    ? undefined
    : ClassifiedDatasetV1Schema.parse(
      await transaction.readJsonArtifact(state.classification.data.id, 'classified-data'),
    )
  const analysis = state.analysis?.data === undefined
    ? undefined
    : AnalysisDatasetV1Schema.parse(
      await transaction.readJsonArtifact(state.analysis.data.id, 'analysis-data'),
    )
  const previousReview = state.review === undefined
    ? undefined
    : ReviewDatasetV1Schema.parse(
      await transaction.readJsonArtifact(state.review.data.id, 'review-data'),
    )
  if (classified !== undefined && (classified.activeDatasetId !== normalizedRef.id
    || classified.ruleSetVersion !== state.classification?.ruleSetVersion)) {
    throw new Error('分类 Artifact 与当前报告绑定不一致。')
  }
  if (analysis !== undefined && (analysis.activeDatasetId !== normalizedRef.id
    || analysis.classificationArtifactId !== state.classification?.data.id
    || analysis.ruleSetVersion !== state.classification?.ruleSetVersion
    || analysis.analysisVersion !== state.analysis?.version)) {
    throw new Error('分析 Artifact 与当前报告绑定不一致。')
  }
  if (previousReview !== undefined && (previousReview.activeDatasetId !== normalizedRef.id
    || previousReview.classificationArtifactId !== state.classification?.data.id
    || previousReview.ruleSetVersion !== state.classification?.ruleSetVersion
    || previousReview.analysisVersion !== state.analysis?.version
    || previousReview.revision !== state.review?.revision)) {
    throw new Error('复核 Artifact 与当前报告绑定不一致。')
  }
  const rows = analysis?.rows ?? analysisBaseRows(normalized, classified)
  const review = syncReviewDataset({
    previous: previousReview,
    rows,
    activeDatasetId: normalizedRef.id,
    ...(state.classification === undefined ? {} : {
      classificationArtifactId: state.classification.data.id,
      ruleSetVersion: state.classification.ruleSetVersion,
    }),
    ...(state.analysis === undefined ? {} : { analysisVersion: state.analysis.version }),
    now: previousReview?.updatedAt ?? normalized.createdAt,
  })
  return { normalized, review }
}

function reviewBasisParameter() {
  return {
    oneOf: [
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: { kind: { type: 'string' as const, const: 'dataset-only' as const, required: true as const } },
      },
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, const: 'classified' as const, required: true as const },
          classificationArtifactRef: { type: 'string' as const, required: true as const },
          ruleSetVersion: { type: 'string' as const, required: true as const },
          analysisVersion: { type: 'string' as const },
        },
      },
    ],
  } as const
}

function reportBindingParameters(autonomous: boolean) {
  return {
    schemaVersion: { type: 'integer' as const, const: 2, required: true as const },
    origin: { ...toolOriginParameter({ autonomous }), required: true as const },
    activeDatasetRef: { type: 'string' as const, required: true as const },
    projectionRevision: { type: 'integer' as const, required: true as const },
    basis: { ...reviewBasisParameter(), required: true as const },
    reviewArtifactRef: {
      type: 'string' as const,
      description: 'Current review Artifact id. Omit this field when reviewRevision is 0; never pass an empty string.',
    },
    reviewRevision: { type: 'integer' as const, required: true as const },
  }
}

function reportObservationParameter() {
  const refs = {
    type: 'array' as const,
    items: { type: 'string' as const },
    description: 'Use no more than 10 unique refs from the current report context.',
  }
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      title: { type: 'string' as const, description: '1-128 characters; do not write numeric facts.', required: true as const },
      statement: { type: 'string' as const, description: '1-2048 characters; express quantitative facts only through refs.', required: true as const },
      metricRefs: { ...refs, required: true as const },
      recordRefs: { ...refs, required: true as const },
      distributionRefs: refs,
      limitations: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'No more than 5 non-empty limitations, each at most 2048 characters and without numeric facts.',
        required: true as const,
      },
    },
  }
}

function reportNarrativeValueParameter() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      executiveSummary: reportObservationParameter(),
      keyFindings: { type: 'array' as const, items: reportObservationParameter(), description: 'No more than 5 observations.', required: true as const },
      priorityVerification: { type: 'array' as const, items: reportObservationParameter(), description: 'No more than 10 observations.', required: true as const },
      risksAndLimitations: { type: 'array' as const, items: reportObservationParameter(), description: 'No more than 5 observations.', required: true as const },
    },
  }
}

function reportNarrativeParameter() {
  return {
    oneOf: [
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: { kind: { type: 'string' as const, const: 'none' as const, required: true as const } },
      },
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, const: 'bound' as const, required: true as const },
          contextFingerprint: { type: 'string' as const, required: true as const },
          contextAsOf: { type: 'string' as const, required: true as const },
          value: { ...reportNarrativeValueParameter(), required: true as const },
        },
      },
    ],
  } as const
}

function formatError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : '未知 renderer 错误'
  return raw.replaceAll(/\p{C}/gu, '').trim().slice(0, 512) || '文件生成失败。'
}

async function renderFormat(
  transaction: ArtifactTransaction,
  dataset: ReportDataset,
  format: 'excel' | 'pdf',
  renderer: Renderer,
  signal: AbortSignal,
) {
  try {
    const rendered = await renderer(dataset, signal)
    const artifact = await transaction.stageBytes(format, rendered.fileName, rendered.mediaType, rendered.bytes)
    return { status: 'succeeded' as const, artifact }
  } catch (caught) {
    return { status: 'failed' as const, errorMessage: formatError(caught) }
  }
}

function projectionReport(
  previous: TenderWorkflowProjectionV2,
  nextRevision: number,
  dataset: ReportDataset,
  finalSnapshot: ArtifactRefV1,
  excel: NonNullable<TenderWorkflowProjectionV2['report']>['excel'],
  pdf: NonNullable<TenderWorkflowProjectionV2['report']>['pdf'],
): TenderWorkflowProjectionV2 {
  const bothFailed = excel.status === 'failed' && pdf.status === 'failed'
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, ...base } = previous
  return TenderWorkflowProjectionV2Schema.parse({
    ...base,
    revision: nextRevision,
    currentStage: 'report',
    stages: {
      ...base.stages,
      report: bothFailed
        ? { status: 'failed', updatedAt: dataset.createdAt, errorCode: 'renderers-failed', errorMessage: 'Excel 与 PDF 均生成失败，可分别重试失败格式。' }
        : { status: 'succeeded', updatedAt: dataset.createdAt },
    },
    report: {
      finalSnapshot,
      finalSnapshotId: dataset.finalSnapshotId,
      completeness: dataset.completeness,
      createdAt: dataset.createdAt,
      rawRecords: metricValueOf(dataset, 'raw-records').value,
      normalizedProjects: metricValueOf(dataset, 'normalized-projects').value,
      reviewed: metricValueOf(dataset, 'reviewed-projects').value,
      confirmedTender: metricValueOf(dataset, 'confirmed-tender').value,
      priorityProposed: metricValueOf(dataset, 'priority-proposed').value,
      watch: metricValueOf(dataset, 'user-watch').value,
      pending: metricValueOf(dataset, 'pending-review').value,
      exclude: metricValueOf(dataset, 'user-excluded').value,
      analysisCompleted: metricValueOf(dataset, 'agent-analyzed').value,
      analysisTotal: metricValueOf(dataset, 'normalized-projects').value,
      narrativeIncluded: dataset.narrative !== undefined,
      excel,
      pdf,
    },
  })
}

function reportProgress(state: NonNullable<TenderWorkflowProjectionV2['report']>, projectionRevision: number) {
  const statuses = [state.excel.status, state.pdf.status]
  return ReportProgressV2Schema.parse({
    succeeded: statuses.filter(status => status === 'succeeded').length,
    failed: statuses.filter(status => status === 'failed').length,
    formats: { excel: state.excel.status, pdf: state.pdf.status },
    projectionRevision,
  })
}

function mutationMeta(input: {
  readonly tool: 'tender_workbench_create_report' | 'tender_workbench_retry_report'
  readonly origin: 'workbench-intent' | 'conversation'
  readonly intentId: string
  readonly previousRevision: number
  readonly state: TenderWorkflowProjectionV2
}): JsonValue {
  return jsonValue({
    domain: 'dsh-tender-workbench', schemaVersion: 2,
    tool: input.tool, intentId: input.intentId, origin: input.origin,
    effect: 'mutation', previousRevision: input.previousRevision,
    state: input.state, control: { status: 'complete' },
  })
}

export function createTenderWorkbenchReportNarrativeContextTool(dependencies: ReportToolDependencies) {
  return defineTool({
    name: 'tender_workbench_get_report_narrative_context',
    description: 'Read bounded report metrics, distributions, up to ten record refs, an as-of time, and a context fingerprint without creating report facts.',
    parameters: reportBindingParameters(true),
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_get_report_narrative_context', required: true },
          intentId: { type: 'string' },
          message: { type: 'string', required: true },
          context: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(ReportNarrativeContextResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = GetReportNarrativeContextInputV2Schema.parse(args)
        const parsed = ReportNarrativeContextResultV2Schema.parse(value)
        return jsonValue({
          domain: 'dsh-tender-workbench', schemaVersion: 2,
          tool: 'tender_workbench_get_report_narrative_context',
          ...(parsed.intentId === undefined ? {} : { intentId: parsed.intentId }),
          origin: input.origin.kind,
          effect: 'read-only', observedRevision: input.projectionRevision,
          control: parsed.control,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = GetReportNarrativeContextInputV2Schema.parse(rawArgs)
      const state = currentProjection(dependencies, exec)
      assertReportBinding(state, args)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state,
        tool: 'tender_workbench_get_report_narrative_context', intentKind: 'report.create', mutation: false,
      })
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      await transaction.load()
      const { normalized, review } = await loadCurrentData(transaction, state)
      const context = createReportContext({
        normalized, review, stateRevision: state.revision, createdAt: new Date().toISOString(),
      })
      const control = invocation.origin === 'autonomous'
        ? { status: 'complete' as const }
        : { status: 'continue' as const, nextTool: 'tender_workbench_create_report' as const }
      exec.signal.throwIfAborted()
      return ReportNarrativeContextResultV2Schema.parse({
        domain: 'dsh-tender-workbench', schemaVersion: 2,
        tool: 'tender_workbench_get_report_narrative_context',
        ...(invocation.intentId === undefined ? {} : { intentId: invocation.intentId }),
        message: `已返回有界报告叙述上下文：${context.metrics.length} 项指标、${context.distributions.length} 项分布、${context.priorityRecords.length} 条记录。`,
        context,
        control,
      })
    },
  })
}

export function createTenderWorkbenchCreateReportTool(dependencies: ReportToolDependencies) {
  const renderers = dependencies.renderers ?? { excel: renderReportExcel, pdf: renderReportPdf }
  return defineTool({
    name: 'tender_workbench_create_report',
    description: 'Create one immutable delivery snapshot and independently render Excel and PDF from the same bound review facts.',
    parameters: {
      ...reportBindingParameters(false),
      scope: { type: 'string', enum: ['complete', 'current-progress'], required: true },
      confirmPending: { type: 'boolean', required: true },
      narrative: { ...reportNarrativeParameter(), required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_create_report', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', enum: ['succeeded', 'partial'], required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          progress: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(CreateReportResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = CreateReportToolInputV2Schema.parse(args)
        const parsed = CreateReportResultV2Schema.parse(value)
        return mutationMeta({
          tool: 'tender_workbench_create_report', origin: input.origin.kind,
          intentId: parsed.intentId, previousRevision: input.projectionRevision, state: parsed.state,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = CreateReportToolInputV2Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previousState,
        tool: 'tender_workbench_create_report', intentKind: 'report.create', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('报告创建动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_create_report',
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => CreateReportResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          assertReportBinding(previousState, args)
          const { normalized, review } = await loadCurrentData(transaction, previousState)
          const pending = review.rows.filter(row => row.review.decision === 'pending').length
          if (pending === 0 && (args.scope !== 'complete' || args.confirmPending)) {
            throw new Error('当前复核已完整，报告范围必须是 complete 且无需确认 pending。')
          }
          if (pending > 0 && (args.scope !== 'current-progress' || !args.confirmPending)) {
            throw new Error(`当前仍有 ${pending} 个待复核项目；必须明确确认当前进度范围。`)
          }
          const createdAt = args.narrative.kind === 'bound' ? args.narrative.contextAsOf : new Date().toISOString()
          const context = createReportContext({
            normalized, review, stateRevision: previousState.revision, createdAt,
          })
          let narrative
          if (args.narrative.kind === 'bound') {
            if (args.narrative.contextFingerprint !== context.contextFingerprint) {
              throw new Error('报告叙述上下文指纹已过期。')
            }
            narrative = validateReportNarrative(args.narrative.value, context)
          }
          const finalSnapshotId = `fs_${createHash('sha256').update(JSON.stringify({ intentId, contextFingerprint: context.contextFingerprint, createdAt }), 'utf8').digest('hex').slice(0, 32)}`
          const query = previousState.query
          if (query === undefined) throw new Error('当前 Session 缺少报告查询范围。')
          const dataset = buildReportDataset({
            finalSnapshotId,
            createdAt,
            stateRevision: previousState.revision,
            normalized,
            review,
            query: {
              scope: query.scope,
              targetSummary: query.targetSummary,
              sources: {
                ...(query.sources.tender === undefined ? {} : { tender: {
                  status: query.sources.tender.status,
                  loaded: query.sources.tender.loaded,
                  ...(query.sources.tender.errorMessage === undefined ? {} : { errorMessage: query.sources.tender.errorMessage }),
                } }),
                ...(query.sources.proposed === undefined ? {} : { proposed: {
                  status: query.sources.proposed.status,
                  loaded: query.sources.proposed.loaded,
                  ...(query.sources.proposed.errorMessage === undefined ? {} : { errorMessage: query.sources.proposed.errorMessage }),
                } }),
              },
            },
            ...(narrative === undefined ? {} : { narrative }),
          })
          const finalSnapshot = await transaction.stageJson(
            'final-snapshot', `delivery-snapshot-${finalSnapshotId}.json`, jsonValue(dataset), dataset.rows.length,
          )
          const [excel, pdf] = await Promise.all([
            renderFormat(transaction, dataset, 'excel', renderers.excel, exec.signal),
            renderFormat(transaction, dataset, 'pdf', renderers.pdf, exec.signal),
          ])
          const state = projectionReport(previousState, nextRevision, dataset, finalSnapshot, excel, pdf)
          if (state.report === undefined) throw new Error('报告状态未生成。')
          const currentProgress = reportProgress(state.report, nextRevision)
          return jsonValue(CreateReportResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_create_report', intentId,
            outcome: currentProgress.failed === 0 ? 'succeeded' : 'partial',
            message: `${dataset.completeness === 'complete' ? '完整' : '阶段性'}交付快照已固化；Excel/PDF 成功 ${currentProgress.succeeded}/2。`,
            result: {
              finalSnapshotId,
              finalSnapshotArtifactRef: finalSnapshot.id,
              completeness: dataset.completeness,
              ...(excel.status === 'succeeded' && excel.artifact !== undefined ? { excelArtifactRef: excel.artifact.id } : {}),
              ...(pdf.status === 'succeeded' && pdf.artifact !== undefined ? { pdfArtifactRef: pdf.artifact.id } : {}),
            },
            progress: currentProgress,
            state,
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return CreateReportResultV2Schema.parse(receipt.result)
    },
  })
}

export function createTenderWorkbenchRetryReportTool(dependencies: ReportToolDependencies) {
  const renderers = dependencies.renderers ?? { excel: renderReportExcel, pdf: renderReportPdf }
  return defineTool({
    name: 'tender_workbench_retry_report',
    description: 'Retry only requested failed Excel/PDF formats from the current immutable delivery snapshot.',
    parameters: {
      schemaVersion: { type: 'integer', const: 2, required: true },
      origin: { ...toolOriginParameter({ autonomous: false }), required: true },
      projectionRevision: { type: 'integer', required: true },
      finalSnapshotId: { type: 'string', required: true },
      formats: { type: 'array', items: { type: 'string', enum: ['excel', 'pdf'] }, required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_retry_report', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', enum: ['succeeded', 'partial'], required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          progress: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(RetryReportResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = RetryReportToolInputV2Schema.parse(args)
        const parsed = RetryReportResultV2Schema.parse(value)
        return mutationMeta({
          tool: 'tender_workbench_retry_report', origin: input.origin.kind,
          intentId: parsed.intentId, previousRevision: input.projectionRevision, state: parsed.state,
        })
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = RetryReportToolInputV2Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previousState,
        tool: 'tender_workbench_retry_report', intentKind: 'report.retry', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('报告重试动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_retry_report',
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => RetryReportResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          if (previousState.revision !== args.projectionRevision) {
            throw new Error('Projection revision 已变化；请基于当前报告状态重试。')
          }
          const report = previousState.report
          if (report?.finalSnapshot === undefined || report.finalSnapshotId !== args.finalSnapshotId) {
            throw new Error('指定交付快照不是当前可重试快照。')
          }
          for (const format of args.formats) {
            if (report[format].status !== 'failed') throw new Error(`只能重试失败格式：${format}`)
          }
          const dataset = ReportDatasetSchema.parse(
            await transaction.readJsonArtifact(report.finalSnapshot.id, 'final-snapshot'),
          )
          if (dataset.finalSnapshotId !== args.finalSnapshotId) {
            throw new Error('交付快照内容与重试参数不一致。')
          }
          let excel = report.excel
          let pdf = report.pdf
          if (args.formats.includes('excel')) excel = await renderFormat(transaction, dataset, 'excel', renderers.excel, exec.signal)
          if (args.formats.includes('pdf')) pdf = await renderFormat(transaction, dataset, 'pdf', renderers.pdf, exec.signal)
          const state = projectionReport(previousState, nextRevision, dataset, report.finalSnapshot, excel, pdf)
          if (state.report === undefined) throw new Error('报告状态未生成。')
          const currentProgress = reportProgress(state.report, nextRevision)
          return jsonValue(RetryReportResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_retry_report', intentId,
            outcome: currentProgress.failed === 0 ? 'succeeded' : 'partial',
            message: `已基于同一交付快照重试 ${args.formats.join('、')}；成功 ${currentProgress.succeeded}/2。`,
            result: {
              finalSnapshotId: dataset.finalSnapshotId,
              finalSnapshotArtifactRef: report.finalSnapshot.id,
              completeness: dataset.completeness,
              ...(excel.status === 'succeeded' && excel.artifact !== undefined ? { excelArtifactRef: excel.artifact.id } : {}),
              ...(pdf.status === 'succeeded' && pdf.artifact !== undefined ? { pdfArtifactRef: pdf.artifact.id } : {}),
            },
            progress: currentProgress,
            state,
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return RetryReportResultV2Schema.parse(receipt.result)
    },
  })
}
