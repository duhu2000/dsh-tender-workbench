import {
  TenderWorkbenchIntentV2Schema,
  type TenderWorkbenchIntentV2,
} from '../../contracts/intents.ts'
import type { TenderRuleV1, UserDecision } from '../../contracts/workflow.ts'
import { ruleDraftFingerprint } from '../../contracts/screening.ts'

interface DatasetBindingInput {
  readonly intentId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
}

interface ClassifiedBindingInput extends DatasetBindingInput {
  readonly classificationArtifactRef: string
  readonly ruleSetVersion: string
}

interface ReviewBindingInput extends DatasetBindingInput {
  readonly classificationArtifactRef?: string
  readonly ruleSetVersion?: string
  readonly analysisVersion?: string
  readonly reviewArtifactRef?: string
  readonly reviewRevision: number
}

function reviewBasis(input: ReviewBindingInput) {
  return input.classificationArtifactRef === undefined || input.ruleSetVersion === undefined
    ? { kind: 'dataset-only' as const }
    : {
        kind: 'classified' as const,
        classificationArtifactRef: input.classificationArtifactRef,
        ruleSetVersion: input.ruleSetVersion,
        ...(input.analysisVersion === undefined ? {} : { analysisVersion: input.analysisVersion }),
      }
}

function reviewBinding(input: ReviewBindingInput) {
  return {
    activeDatasetRef: input.activeDatasetRef,
    projectionRevision: input.projectionRevision,
    basis: reviewBasis(input),
    ...(input.reviewArtifactRef === undefined ? {} : { reviewArtifactRef: input.reviewArtifactRef }),
    reviewRevision: input.reviewRevision,
  }
}

export function createContinueScreeningIntent(input: DatasetBindingInput & { readonly guidance?: string }) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'rules.propose', skill: 'tender-workbench-screening',
    binding: { activeDatasetRef: input.activeDatasetRef, projectionRevision: input.projectionRevision },
    payload: { ...(input.guidance === undefined ? {} : { guidance: input.guidance }) },
  })
}

export function createAdjustRulesIntent(input: DatasetBindingInput & {
  readonly instruction: string
  readonly rules: readonly TenderRuleV1[]
}) {
  const baseDraftFingerprint = ruleDraftFingerprint(input.rules)
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'rules.adjust', skill: 'tender-workbench-screening',
    binding: { activeDatasetRef: input.activeDatasetRef, projectionRevision: input.projectionRevision, baseDraftFingerprint },
    payload: { instruction: input.instruction, rules: input.rules },
  })
}

export function createPreviewRulesIntent(input: DatasetBindingInput & { readonly rules: readonly TenderRuleV1[] }) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'rules.preview', skill: 'tender-workbench-screening',
    binding: { activeDatasetRef: input.activeDatasetRef, projectionRevision: input.projectionRevision },
    payload: { draftFingerprint: ruleDraftFingerprint(input.rules), rules: input.rules },
  })
}

export function createConfirmRulesIntent(input: DatasetBindingInput & {
  readonly previewArtifactRef: string
  readonly rules: readonly TenderRuleV1[]
}) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'rules.confirm', skill: 'tender-workbench-screening',
    binding: {
      activeDatasetRef: input.activeDatasetRef,
      projectionRevision: input.projectionRevision,
      previewArtifactRef: input.previewArtifactRef,
      draftFingerprint: ruleDraftFingerprint(input.rules),
    },
    payload: {},
  })
}

export function createRequestAnalysisIntent(input: ClassifiedBindingInput) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'analysis.run', skill: 'tender-workbench-analysis',
    binding: {
      activeDatasetRef: input.activeDatasetRef,
      classificationArtifactRef: input.classificationArtifactRef,
      ruleSetVersion: input.ruleSetVersion,
      projectionRevision: input.projectionRevision,
    },
    payload: { scope: { kind: 'all-eligible' } },
  })
}

export function createAnalysisFollowUpIntent(input: ClassifiedBindingInput & {
  readonly analysisVersion?: string
  readonly recordRef: string
  readonly question: string
}) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'analysis.follow-up', skill: 'tender-workbench-analysis',
    binding: {
      activeDatasetRef: input.activeDatasetRef,
      classificationArtifactRef: input.classificationArtifactRef,
      ruleSetVersion: input.ruleSetVersion,
      projectionRevision: input.projectionRevision,
      ...(input.analysisVersion === undefined ? {} : { analysisVersion: input.analysisVersion }),
    },
    payload: { recordRef: input.recordRef, question: input.question },
  })
}

export function createApplyReviewIntent(input: ReviewBindingInput & {
  readonly recordRefs: readonly string[]
  readonly decision: UserDecision
  readonly note: string
}) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'review.apply', skill: 'tender-workbench-review',
    binding: reviewBinding(input),
    payload: { decisions: input.recordRefs.map(recordRef => ({ recordRef, decision: input.decision, note: input.note })) },
  })
}

export function createRevertReviewIntent(input: ReviewBindingInput & { readonly latestOperationRef: string }) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'review.revert', skill: 'tender-workbench-review',
    binding: { ...reviewBinding(input), latestOperationRef: input.latestOperationRef },
    payload: {},
  })
}

export function createGenerateReportIntent(input: ReviewBindingInput & {
  readonly confirmPending: boolean
  readonly includeNarrative: boolean
}) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'report.create', skill: 'tender-workbench-report',
    binding: reviewBinding(input),
    payload: {
      scope: input.confirmPending ? 'current-progress' : 'complete',
      confirmPending: input.confirmPending,
      narrativeMode: input.includeNarrative ? 'requested' : 'none',
    },
  })
}

export function createRetryReportIntent(input: {
  readonly intentId: string
  readonly projectionRevision: number
  readonly finalSnapshotId: string
  readonly formats: readonly ('excel' | 'pdf')[]
}) {
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2, intentId: input.intentId, kind: 'report.retry', skill: 'tender-workbench-report',
    binding: { finalSnapshotId: input.finalSnapshotId, projectionRevision: input.projectionRevision },
    payload: { formats: input.formats },
  })
}

const summaries: Record<TenderWorkbenchIntentV2['kind'], string> = {
  'query.run': '执行招投标工作台查询。',
  'rules.propose': '为当前活动数据生成初筛口径草案并执行 Dry Run。',
  'rules.adjust': '按用户要求调整当前初筛口径草案并执行 Dry Run。',
  'rules.preview': '保存当前初筛口径草案并执行 Dry Run。',
  'rules.confirm': '确认当前初筛口径并执行全量分类。',
  'analysis.run': '分析当前分类中全部可分析候选。',
  'analysis.follow-up': '回答当前候选的有界上下文问题。',
  'review.apply': '应用用户明确选择的人工复核决定。',
  'review.revert': '撤销当前复核链路最近一次操作。',
  'report.create': '按用户确认的当前范围创建报告。',
  'report.retry': '重试当前交付快照中失败的文件格式。',
}

export function serializeTenderWorkbenchIntent(input: TenderWorkbenchIntentV2): string {
  const intent = TenderWorkbenchIntentV2Schema.parse(input)
  return [
    summaries[intent.kind],
    `/${intent.skill}`,
    '',
    '<dsh_tender_workbench_intent>',
    JSON.stringify(intent, null, 2),
    '</dsh_tender_workbench_intent>',
  ].join('\n')
}
