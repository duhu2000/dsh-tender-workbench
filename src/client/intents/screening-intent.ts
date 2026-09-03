import {
  AdjustRulesIntentV1Schema,
  ContinueScreeningIntentV1Schema,
  TenderWorkbenchIntentV1Schema,
  type TenderWorkbenchIntentV1,
} from '../../contracts/screening-intents.ts'
import {
  ConfirmRulesCommandV1Schema,
  PreviewRulesCommandV1Schema,
  ruleDraftFingerprint,
} from '../../contracts/screening.ts'
import type { TenderRuleV1 } from '../../contracts/workflow.ts'
import type { UserDecision } from '../../contracts/workflow.ts'
import {
  ApplyReviewCommandV1Schema,
  RequestAnalysisIntentV1Schema,
  RevertReviewCommandV1Schema,
  type AnalysisScopeV1,
} from '../../contracts/analysis-review.ts'
import {
  CreateReportIntentV1Schema,
  RetryReportIntentV1Schema,
  type CreateReportIntentV1,
  type RetryReportIntentV1,
} from '../../contracts/reporting.ts'
import { serializeTenderQueryIntent } from './query-intent.ts'

export function createContinueScreeningIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
}) {
  return ContinueScreeningIntentV1Schema.parse({ schemaVersion: 1, kind: 'rules.propose', ...input })
}

export function createAdjustRulesIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly instruction: string
  readonly rules: readonly TenderRuleV1[]
}) {
  return AdjustRulesIntentV1Schema.parse({
    schemaVersion: 1,
    kind: 'rules.adjust',
    ...input,
    draftFingerprint: ruleDraftFingerprint(input.rules),
  })
}

export function createPreviewRulesIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly rules: readonly TenderRuleV1[]
}) {
  return PreviewRulesCommandV1Schema.parse({
    schemaVersion: 1,
    kind: 'rules.preview',
    origin: 'user',
    ...input,
    draftFingerprint: ruleDraftFingerprint(input.rules),
  })
}

export function createConfirmRulesIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly previewArtifactId: string
  readonly rules: readonly TenderRuleV1[]
}) {
  return ConfirmRulesCommandV1Schema.parse({
    schemaVersion: 1,
    kind: 'rules.confirm',
    ...input,
    draftFingerprint: ruleDraftFingerprint(input.rules),
  })
}

interface CurrentS4Binding {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly classificationArtifactRef?: string
  readonly ruleSetVersion?: string
  readonly projectionRevision: number
}

export function createRequestAnalysisIntent(input: CurrentS4Binding & {
  readonly scope: AnalysisScopeV1
  readonly batchSize?: number
}) {
  return RequestAnalysisIntentV1Schema.parse({
    schemaVersion: 1,
    kind: 'analysis.request',
    batchSize: input.batchSize ?? 12,
    ...input,
  })
}

export function createApplyReviewIntent(input: CurrentS4Binding & {
  readonly analysisVersion?: string
  readonly recordRefs: readonly string[]
  readonly decision: UserDecision
  readonly note: string
}) {
  return ApplyReviewCommandV1Schema.parse({ schemaVersion: 1, kind: 'review.apply', ...input })
}

export function createRevertReviewIntent(input: CurrentS4Binding & {
  readonly analysisVersion?: string
}) {
  return RevertReviewCommandV1Schema.parse({ schemaVersion: 1, kind: 'review.revert', ...input })
}

export function createGenerateReportIntent(
  input: Omit<CreateReportIntentV1, 'schemaVersion' | 'kind'>,
) {
  return CreateReportIntentV1Schema.parse({ schemaVersion: 1, kind: 'report.create', ...input })
}

export function createRetryReportIntent(
  input: Omit<RetryReportIntentV1, 'schemaVersion' | 'kind'>,
) {
  return RetryReportIntentV1Schema.parse({ schemaVersion: 1, kind: 'report.retry', ...input })
}

function visibleJson(intent: TenderWorkbenchIntentV1): string {
  return ['```json', JSON.stringify(intent, null, 2), '```'].join('\n')
}

export function serializeTenderWorkbenchIntent(input: TenderWorkbenchIntentV1): string {
  const intent = TenderWorkbenchIntentV1Schema.parse(input)
  if (intent.kind === 'query.start') return serializeTenderQueryIntent(intent)
  if (intent.kind === 'rules.propose') {
    return [
      '继续筛候选。请基于本次查询目标、已校验查询条件、确定性统计和查询工具返回的有界代表性样本提出初筛口径，不使用任何默认行业规则。',
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
      '第一步必须调用 tender_workbench_get_screening_context，并原样传递 activeDatasetRef 和 projectionRevision；它是本次草案唯一允许使用的数据上下文。',
      '不得重新调用任何 qcc/MCP 搜索或详情工具，不得读取原始 Artifact，不得写草稿文件，也不得使用 Shell/代码计算统计或指纹。',
      '请基于该高层工具返回的查询条件、确定性统计和有界样本生成一层规则草案。字段范围只能是 title、purchaser，或表示同时覆盖这两个字段的 all；来源范围只能是 tender/proposed。',
      '随后准确调用一次 tender_workbench_preview_rules，origin 必须为 agent，并原样传递 commandId、activeDatasetRef 和 projectionRevision；Agent 草案不要传 draftFingerprint，由 Host 计算并绑定。',
      '预览工具返回后本轮立即结束；不得根据预览结果自行改稿、第二次预览或执行确认。草案和预览都不代表用户确认。',
    ].join('\n')
  }
  if (intent.kind === 'rules.adjust') {
    return [
      `请调整当前初筛口径草案：${intent.instruction}`,
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
      '请只基于消息中的当前结构化草案和用户调整要求输出完整的一层规则草案；不得重新查询 qcc、读取 Artifact、写文件或使用 Shell。',
      '准确调用一次 tender_workbench_preview_rules，origin 必须为 agent，并省略 draftFingerprint，由 Host 计算并绑定。工具返回后本轮立即结束，不得再次改稿、预览或执行确认。返回的建议会作为当前 Session 规则工作区的可编辑草案载入，但不会自动确认或分类。',
    ].join('\n')
  }
  if (intent.kind === 'rules.preview') {
    return [
      '请保存当前用户编辑的初筛口径草案并执行一次 Dry Run。',
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
      '请准确调用一次 tender_workbench_preview_rules 并原样传递全部字段。工具返回后本轮立即结束；不要再次改稿或预览，不要确认规则版本，不要修改当前分类。',
    ].join('\n')
  }
  if (intent.kind === 'rules.confirm') return [
    '我明确确认当前初筛口径，并要求对当前活动数据执行确定性全量分类。',
    '',
    '类型化工作台意图（schemaVersion 1）：',
    visibleJson(intent),
    '',
    '请调用 tender_workbench_confirm_rules 并原样传递全部字段。旧快照、旧 revision 或过期预览必须失败。',
  ].join('\n')
  if (intent.kind === 'analysis.request') return [
    '请只分析我在工作台中明确选择的当前记录范围，并保存一批证据化 Agent 建议。Agent 建议只用于安排人工复核，不是用户决定。',
    '',
    '类型化工作台意图（schemaVersion 1）：',
    visibleJson(intent),
    '',
    '先准确调用一次 tender_workbench_analysis_next：把 kind 改为 analysis.next，其余绑定、范围、batchSize 和 commandId 原样传递。不得扩大 scope、重新查询来源或维护隐藏游标。',
    '只使用该工具返回的本批 recordRef 与 evidenceRef，为每条记录形成一个 priority-review、watch 或 not-recommended 建议；每条必须包含 evidenceRefs、理由、待核验项和局限。',
    '随后准确调用一次 tender_workbench_analysis_commit，原样传递批次绑定、batchId 和完整建议。本轮只提交这一批，工具返回后立即结束。',
    '不得输出企业适配度、中标概率、利润、资格符合或 Bid/No-Bid 结论；分析失败或未覆盖的记录必须保留为可直接人工复核。',
  ].join('\n')
  if (intent.kind === 'review.apply') return [
    '请应用我在工作台中明确选择的用户复核决定和备注。该决定独立于初筛分类与 Agent 建议。',
    '',
    '类型化工作台意图（schemaVersion 1）：',
    visibleJson(intent),
    '',
    '请准确调用一次 tender_workbench_apply_review 并原样传递全部字段。不得扩大 recordRefs，不得根据 Agent 建议自动改变任何其他记录。',
  ].join('\n')
  if (intent.kind === 'report.create') {
    const common = [
      '请基于当前用户复核范围创建不可变交付快照，并由 Host 独立生成 Excel/PDF。用户决定、统计、重点记录、排序、Sheet、章节和版式均不得由 Agent 改写。',
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
    ]
    if (!intent.includeNarrative) return [
      ...common,
      '本次不生成 Agent 报告叙述。请准确调用一次 tender_workbench_generate_report：将 kind 改为 report.generate、mode 设为 create，原样传递全部状态绑定、commandId 与 confirmPending，并省略 contextFingerprint 和 narrative。',
      '工具返回后立即结束；没有 Agent 叙述仍必须生成完整的确定性 Excel/PDF。',
    ].join('\n')
    return [
      ...common,
      '先准确调用一次只读 tender_workbench_get_report_context：将 kind 改为 report.context，原样传递状态绑定并省略 commandId、confirmPending 与 includeNarrative。不得读取完整数据 Artifact、重新查询来源、使用 Shell 或自行计算统计。',
      '只能基于返回的 ReportContextV2 形成一个结构化 ReportNarrativeV1：可选管理摘要、主要发现最多五项、优先核验最多十项、风险/局限最多五项。每项必须引用上下文允许的 metricRef、distributionRef 或 recordRef。',
      'ReportNarrativeV1 顶层只能包含 executiveSummary（可省略）、keyFindings、priorityVerification、risksAndLimitations；后三项必须是数组。每个叙述项只能包含 title、statement、metricRefs、recordRefs、distributionRefs、limitations 六个字段；四个引用/局限字段都必须是数组，且三类引用至少一个非空。不得使用 item、refs、verificationPriorities 或其他字段名。',
      '自由文本不得写数字、比例、金额或日期；不得生成脚本、HTML/CSS、公式、Sheet、章节、图表或版式描述，也不得改变 Host 选出的重点记录和顺序。',
      '随后准确调用一次 tender_workbench_generate_report：将 kind 改为 report.generate、mode 设为 create，原样传递全部状态绑定、commandId 与 confirmPending，并提交工具返回的 contextFingerprint、createdAt（参数名 contextAsOf）和 ReportNarrativeV1。工具返回后立即结束。',
    ].join('\n')
  }
  if (intent.kind === 'report.retry') return [
    '请只重试当前交付快照中明确失败的文件格式。',
    '',
    '类型化工作台意图（schemaVersion 1）：',
    visibleJson(intent),
    '',
    '请准确调用一次 tender_workbench_generate_report：将 kind 改为 report.generate、mode 设为 retry，原样传递 commandId、projectionRevision、finalSnapshotId 和 formats。',
    '不得调用报告上下文工具，不得请求或改写 Agent 叙述，不得重新查询、分类、分析、复核或创建新快照。',
  ].join('\n')
  return [
    '请撤销当前复核状态中最近一次用户操作，恢复那次操作前的用户决定和备注。',
    '',
    '类型化工作台意图（schemaVersion 1）：',
    visibleJson(intent),
    '',
    '请准确调用一次 tender_workbench_revert_review 并原样传递全部字段。不得从 Agent 建议回填用户决定。',
  ].join('\n')
}
