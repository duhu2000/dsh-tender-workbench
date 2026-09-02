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
  GenerateReportCommandV1Schema,
  GetReportContextCommandV1Schema,
  ReportContextV1Schema,
  ReportDatasetV1Schema,
  type GetReportContextCommandV1,
  type ReportDatasetV1,
} from '../../contracts/reporting.ts'
import { ClassifiedDatasetV1Schema } from '../../contracts/screening.ts'
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

const ReportContextResultV1Schema = z.object({
  message: z.string().min(1).max(512),
  context: ReportContextV1Schema,
}).strict()

const ReportMutationResultV1Schema = z.object({
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  state: TenderWorkflowProjectionV1Schema,
}).strict()

export type ReportContextResultV1 = z.infer<typeof ReportContextResultV1Schema>
export type ReportMutationResultV1 = z.infer<typeof ReportMutationResultV1Schema>

type Renderer = (dataset: ReportDatasetV1, signal: AbortSignal) => Promise<RenderedReportFile>

export interface ReportToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: CommandReceiptCoordinator
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

function currentProjection(dependencies: ReportToolDependencies, exec: ToolRunContext): TenderWorkflowProjectionV1 {
  const agent = requireAgent(exec)
  return dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

function assertReportBinding(state: TenderWorkflowProjectionV1, input: GetReportContextCommandV1): void {
  if (state.revision !== input.projectionRevision) {
    throw new Error('Projection revision 已变化；旧报告上下文或叙述已失效。')
  }
  if (state.query?.normalizedData?.id !== input.activeDatasetRef) {
    throw new Error('活动数据快照已变化；旧报告上下文或叙述已失效。')
  }
  if (state.classification?.data.id !== input.classificationArtifactRef
    || state.classification?.ruleSetVersion !== input.ruleSetVersion) {
    throw new Error('当前分类版本与报告请求绑定不一致。')
  }
  if (state.analysis?.version !== input.analysisVersion) {
    throw new Error('当前 Agent 分析版本与报告请求绑定不一致。')
  }
  if (state.review?.data.id !== input.reviewArtifactRef || (state.review?.revision ?? 0) !== input.reviewRevision) {
    throw new Error('当前用户复核版本与报告请求绑定不一致。')
  }
}

async function loadCurrentData(
  transaction: ArtifactTransaction,
  state: TenderWorkflowProjectionV1,
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
  if (classified !== undefined && (classified.activeDatasetId !== normalizedRef.id || classified.ruleSetVersion !== state.classification?.ruleSetVersion)) {
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
  const base = analysis?.rows ?? analysisBaseRows(normalized, classified)
  const review = syncReviewDataset({
    previous: previousReview,
    rows: base,
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

function reportBindingParameters(includeCommandId: boolean, requireCreateBinding = true) {
  return {
    schemaVersion: { type: 'integer' as const, const: 1, required: true as const },
    kind: { type: 'string' as const, const: includeCommandId ? 'report.generate' : 'report.context', required: true as const },
    ...(includeCommandId ? { commandId: { type: 'string' as const, required: true as const } } : {}),
    activeDatasetRef: { type: 'string' as const, ...(requireCreateBinding ? { required: true as const } : {}) },
    classificationArtifactRef: { type: 'string' as const },
    ruleSetVersion: { type: 'string' as const },
    analysisVersion: { type: 'string' as const },
    reviewArtifactRef: { type: 'string' as const },
    reviewRevision: { type: 'integer' as const, ...(requireCreateBinding ? { required: true as const } : {}) },
    projectionRevision: { type: 'integer' as const, required: true as const },
  }
}

function reportObservationParameter() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    description: 'One evidence-bound narrative observation. Do not put numeric, date, percentage, or amount facts in title, statement, or limitations.',
    properties: {
      title: { type: 'string' as const, required: true as const },
      statement: { type: 'string' as const, required: true as const },
      metricRefs: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
      recordRefs: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
      limitations: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
    },
  }
}

function reportNarrativeParameter() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    description: 'Exact ReportNarrativeV1. Use only allowed refs from ReportContextV1; omit executiveSummary or provide one complete observation.',
    properties: {
      executiveSummary: reportObservationParameter(),
      keyFindings: { type: 'array' as const, items: reportObservationParameter(), required: true as const },
      priorityVerification: { type: 'array' as const, items: reportObservationParameter(), required: true as const },
      risksAndLimitations: { type: 'array' as const, items: reportObservationParameter(), required: true as const },
    },
  }
}

export function createTenderWorkbenchReportContextTool(dependencies: ReportToolDependencies) {
  return defineTool({
    name: 'tender_workbench_get_report_context',
    description: 'Read one bounded deterministic ReportContextV1 for the current active data and review state. This read-only tool returns Host metrics, analysis coverage, at most ten Host-selected priority records, allowed refs, and a context fingerprint. It never creates a snapshot, reads the full dataset into Agent context, or asks Agent to calculate facts.',
    parameters: reportBindingParameters(false),
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          message: { type: 'string' as const, required: true as const },
          context: { type: 'json' as const, required: true as const },
        },
      },
      render(_args, value) {
        const parsed = ReportContextResultV1Schema.parse(value)
        return [{
          type: 'text',
          text: `${parsed.message}\n\nReportContextV1（叙述只能引用其中的 metricRefs、recordRefs，并原样绑定 contextFingerprint 与 stateRevision）：\n${JSON.stringify(parsed.context, null, 2)}`,
        }]
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = GetReportContextCommandV1Schema.parse(rawArgs)
      const state = currentProjection(dependencies, exec)
      assertReportBinding(state, args)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      await transaction.load()
      const { normalized, review } = await loadCurrentData(transaction, state)
      exec.signal.throwIfAborted()
      const context = createReportContext({ normalized, review, stateRevision: state.revision })
      return ReportContextResultV1Schema.parse({
        message: `已返回有界报告上下文：${context.metrics.length} 项 Host 指标、${context.priorityRecords.length} 条确定性优先核验记录；上下文只允许这些引用。`,
        context,
      })
    },
  })
}

function formatError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : '未知 renderer 错误'
  return raw.replaceAll(/\p{C}/gu, '').trim().slice(0, 512) || '文件生成失败。'
}

async function renderFormat(
  transaction: ArtifactTransaction,
  dataset: ReportDatasetV1,
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
  previous: TenderWorkflowProjectionV1,
  nextRevision: number,
  dataset: ReportDatasetV1,
  finalSnapshot: ArtifactRefV1,
  excel: NonNullable<TenderWorkflowProjectionV1['report']>['excel'],
  pdf: NonNullable<TenderWorkflowProjectionV1['report']>['pdf'],
): TenderWorkflowProjectionV1 {
  const bothFailed = excel.status === 'failed' && pdf.status === 'failed'
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, ...base } = previous
  return TenderWorkflowProjectionV1Schema.parse({
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

function presentationMeta(args: { readonly commandId: string }, value: unknown): JsonValue {
  const parsed = ReportMutationResultV1Schema.parse(value)
  return jsonValue({
    domain: 'dsh-tender-workbench', schemaVersion: 1,
    commandId: args.commandId, command: 'tender_workbench_generate_report', state: parsed.state,
  })
}

export function createTenderWorkbenchGenerateReportTool(dependencies: ReportToolDependencies) {
  const renderers = dependencies.renderers ?? { excel: renderReportExcel, pdf: renderReportPdf }
  return defineTool({
    name: 'tender_workbench_generate_report',
    description: 'Create one immutable delivery snapshot and independently render deterministic Excel/PDF, or retry only specified failed formats from an existing snapshot. An optional ReportNarrativeV1 is accepted only with the exact current context fingerprint. Retry reuses the snapshot narrative and never asks Agent again.',
    parameters: {
      ...reportBindingParameters(true, false),
      mode: { type: 'string' as const, enum: ['create', 'retry'], required: true as const },
      confirmPending: { type: 'boolean' as const },
      contextFingerprint: { type: 'string' as const },
      narrative: reportNarrativeParameter(),
      finalSnapshotId: { type: 'string' as const },
      formats: { type: 'array' as const, items: { type: 'string' as const } },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          outcome: { type: 'string' as const, const: 'succeeded' as const, required: true as const },
          message: { type: 'string' as const, required: true as const },
          state: { type: 'json' as const, required: true as const },
        },
      },
      render(_args, value) { return [{ type: 'text', text: ReportMutationResultV1Schema.parse(value).message }] },
      presentationMeta(args, value) {
        return presentationMeta({ commandId: z.string().min(1).max(128).parse(args.commandId) }, value)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = GenerateReportCommandV1Schema.parse(rawArgs)
      const previousState = currentProjection(dependencies, exec)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const command = await dependencies.receipts.run(String(agent.session.id), {
        commandId: args.commandId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: result => ReportMutationResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          if (previousState.revision !== args.projectionRevision) throw new Error('Projection revision 已变化；请基于当前状态重新生成或重试。')
          if (args.mode === 'create') {
            assertReportBinding(previousState, GetReportContextCommandV1Schema.parse({
              schemaVersion: args.schemaVersion,
              kind: 'report.context',
              activeDatasetRef: args.activeDatasetRef,
              ...(args.classificationArtifactRef === undefined ? {} : { classificationArtifactRef: args.classificationArtifactRef }),
              ...(args.ruleSetVersion === undefined ? {} : { ruleSetVersion: args.ruleSetVersion }),
              ...(args.analysisVersion === undefined ? {} : { analysisVersion: args.analysisVersion }),
              ...(args.reviewArtifactRef === undefined ? {} : { reviewArtifactRef: args.reviewArtifactRef }),
              reviewRevision: args.reviewRevision,
              projectionRevision: args.projectionRevision,
            }))
            const { normalized, review } = await loadCurrentData(transaction, previousState)
            const context = createReportContext({ normalized, review, stateRevision: previousState.revision })
            if (args.contextFingerprint !== undefined && args.contextFingerprint !== context.contextFingerprint) {
              throw new Error('报告上下文指纹已过期；数据、分类、分析或用户决定已变化。')
            }
            const narrative = args.narrative === undefined ? undefined : validateReportNarrative(args.narrative, context)
            const pending = review.rows.filter(row => row.review.decision === 'pending').length
            if (pending > 0 && !args.confirmPending) {
              throw new Error(`当前仍有 ${pending} 个待复核项目；生成阶段性报告前必须明确确认 pending 范围。`)
            }
            const createdAt = new Date().toISOString()
            const finalSnapshotId = `fs_${createHash('sha256').update(JSON.stringify({ commandId: args.commandId, contextFingerprint: context.contextFingerprint, createdAt }), 'utf8').digest('hex').slice(0, 32)}`
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
                  ...(query.sources.tender === undefined ? {} : { tender: { status: query.sources.tender.status, loaded: query.sources.tender.loaded, ...(query.sources.tender.errorMessage === undefined ? {} : { errorMessage: query.sources.tender.errorMessage }) } }),
                  ...(query.sources.proposed === undefined ? {} : { proposed: { status: query.sources.proposed.status, loaded: query.sources.proposed.loaded, ...(query.sources.proposed.errorMessage === undefined ? {} : { errorMessage: query.sources.proposed.errorMessage }) } }),
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
            const successCount = [excel, pdf].filter(item => item.status === 'succeeded').length
            return jsonValue(ReportMutationResultV1Schema.parse({
              outcome: 'succeeded',
              message: `${dataset.completeness === 'complete' ? '完整' : '阶段性'}交付快照已固化；Excel/PDF 成功 ${successCount}/2，失败格式可基于同一快照重试。`,
              state,
            })) as ReceiptJsonValue
          }

          const report = previousState.report
          if (report?.finalSnapshot === undefined || report.finalSnapshotId !== args.finalSnapshotId) {
            throw new Error('指定交付快照不是当前可重试快照。')
          }
          args.formats.forEach((format) => {
            if (report[format].status !== 'failed') throw new Error(`只能重试失败格式：${format}`)
          })
          const dataset = ReportDatasetV1Schema.parse(
            await transaction.readJsonArtifact(report.finalSnapshot.id, 'final-snapshot'),
          )
          if (dataset.finalSnapshotId !== args.finalSnapshotId) throw new Error('交付快照内容与重试参数不一致。')
          let excel = report.excel
          let pdf = report.pdf
          if (args.formats.includes('excel')) excel = await renderFormat(transaction, dataset, 'excel', renderers.excel, exec.signal)
          if (args.formats.includes('pdf')) pdf = await renderFormat(transaction, dataset, 'pdf', renderers.pdf, exec.signal)
          const state = projectionReport(previousState, nextRevision, dataset, report.finalSnapshot, excel, pdf)
          const retried = args.formats.map(format => `${format}:${state.report?.[format].status ?? 'failed'}`).join('，')
          return jsonValue(ReportMutationResultV1Schema.parse({
            outcome: 'succeeded',
            message: `已基于同一交付快照重试失败格式（${retried}）；未重新查询、分类、分析、复核或请求 Agent 叙述。`,
            state,
          })) as ReceiptJsonValue
        },
      })
      return ReportMutationResultV1Schema.parse(command.result)
    },
  })
}
