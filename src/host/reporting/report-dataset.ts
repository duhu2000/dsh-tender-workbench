import { createHash } from 'node:crypto'
import {
  MetricDefinitionV1Schema,
  ReportContextV1Schema,
  ReportDatasetV1Schema,
  ReportNarrativeV1Schema,
  type MetricDefinitionV1,
  type MetricValueV1,
  type ReportContextV1,
  type ReportDatasetV1,
  type ReportNarrativeV1,
  type ReportObservationV1,
} from '../../contracts/reporting.ts'
import type { NormalizedDatasetV1 } from '../../contracts/dataset.ts'
import type { ReviewDatasetV1, ReviewRecordV1 } from '../../contracts/analysis-review.ts'

export const REPORT_METRIC_DEFINITIONS: readonly MetricDefinitionV1[] = [
  { id: 'raw-records', label: '原始记录', description: '本次成功来源返回并进入处理管线的原始记录数。', unit: 'record', scopeDescription: '当前活动查询的实际加载范围。', limitation: '原始公告/记录数不能与关联后的规范化项目数混用。' },
  { id: 'normalized-projects', label: '规范化项目', description: '经过字段标准化与保守关联后形成的项目数。', unit: 'project', scopeDescription: '当前活动规范化数据快照。', limitation: '更正及明确关联公告不会重复计为独立项目。' },
  { id: 'screening-candidates', label: '初筛候选', description: '当前已确认初筛口径确定性分类为 include 的项目数。', unit: 'project', scopeDescription: '当前分类版本；无分类版本时为 0。', limitation: '初筛候选不是 Agent 建议，也不是用户确认候选。' },
  { id: 'reviewed-projects', label: '已复核', description: '用户决定不为 pending 的项目数。', unit: 'project', numeratorLabel: '已复核项目', denominatorLabel: '规范化项目', scopeDescription: '当前活动数据上的用户决定集合。', limitation: '未分析记录仍可被人工复核。' },
  { id: 'confirmed-tender', label: '正式招投标确认候选', description: '来源为招投标且用户决定为 confirmed-candidate 的项目数。', unit: 'project', scopeDescription: '当前用户决定；只统计正式招投标来源。', limitation: '确认候选商机不表示决定投标。' },
  { id: 'priority-proposed', label: '拟建重点前期线索', description: '来源为拟建项目且用户决定为 confirmed-candidate 的项目数。', unit: 'project', scopeDescription: '当前用户决定；只统计拟建项目来源。', limitation: '重点前期线索不表示已有采购包或决定投标。' },
  { id: 'user-watch', label: '观察', description: '用户决定为 watch 的项目数。', unit: 'project', scopeDescription: '当前用户决定集合。', limitation: '不与初筛 observe 或 Agent watch 混用。' },
  { id: 'pending-review', label: '待复核', description: '用户决定仍为 pending 的项目数。', unit: 'project', scopeDescription: '当前用户决定集合。', limitation: '阶段性报告单列 pending，不计入已复核或确认候选。' },
  { id: 'user-excluded', label: '用户排除', description: '用户决定为 exclude 的项目数。', unit: 'project', scopeDescription: '当前用户决定集合。', limitation: '不与初筛 exclude 混用。' },
  { id: 'projects-with-missing-fields', label: '存在未披露字段', description: '至少一个关键字段未由来源披露的规范化项目数。', unit: 'project', scopeDescription: '当前规范化项目的字段披露范围。', limitation: '未披露不表示来源错误或数据不准确。' },
  { id: 'projects-with-unparseable-fields', label: '存在无法解析字段', description: '至少一个来源原值无法规范化解析的项目数。', unit: 'project', scopeDescription: '当前规范化项目的字段解析范围。', limitation: '保留来源原文，无法解析值不按零处理。' },
  { id: 'agent-analyzed', label: 'Agent 分析覆盖', description: '拥有已提交结构化 Agent 建议的项目数。', unit: 'project', numeratorLabel: '已分析项目', denominatorLabel: '规范化项目', scopeDescription: '当前活动数据与可选分析版本。', limitation: '分析是可选增强，未分析项目仍可复核和交付。' },
  { id: 'agent-analysis-coverage', label: 'Agent 分析覆盖率', description: '已提交 Agent 建议项目数除以规范化项目数。', unit: 'percent', numeratorLabel: '已分析项目', denominatorLabel: '规范化项目', scopeDescription: '当前活动数据与可选分析版本。', limitation: '覆盖率不表示证据准确率或建议质量。' },
  { id: 'confirmed-rate-reviewed', label: '已复核确认候选率', description: '正式确认候选与拟建重点线索之和除以已复核项目数。', unit: 'percent', numeratorLabel: '用户确认候选', denominatorLabel: '已复核项目', scopeDescription: '当前用户决定；pending 从分母中排除。', limitation: '该比例不是投标转化率或中标率。' },
  { id: 'tender-budget-parsed', label: '正式候选预算可解析', description: '正式招投标确认候选中预算可解析的项目数。', unit: 'project', numeratorLabel: '预算可解析项目', denominatorLabel: '正式招投标确认候选', scopeDescription: '当前正式招投标确认候选。', limitation: '预算不等于合同收入或利润。' },
  { id: 'tender-budget-missing', label: '正式候选预算缺失/无法解析', description: '正式招投标确认候选中预算缺失或无法解析的项目数。', unit: 'project', scopeDescription: '当前正式招投标确认候选。', limitation: '缺失预算不按零处理。' },
  { id: 'tender-budget-median', label: '正式候选预算中位数', description: '预算可解析的正式招投标确认候选金额中位数。', unit: 'currency', scopeDescription: '仅覆盖预算可解析的当前正式候选。', limitation: '中位数不代表收入、利润或报价。' },
  { id: 'proposed-investment-parsed', label: '拟建线索总投资可解析', description: '拟建重点前期线索中总投资可解析的项目数。', unit: 'project', numeratorLabel: '总投资可解析项目', denominatorLabel: '拟建重点前期线索', scopeDescription: '当前拟建重点前期线索。', limitation: '总投资不等于可参与采购金额。' },
  { id: 'proposed-investment-missing', label: '拟建线索总投资缺失/无法解析', description: '拟建重点前期线索中总投资缺失或无法解析的项目数。', unit: 'project', scopeDescription: '当前拟建重点前期线索。', limitation: '缺失投资额不按零处理。' },
  { id: 'proposed-investment-median', label: '拟建线索总投资中位数', description: '总投资可解析的拟建重点前期线索金额中位数。', unit: 'currency', scopeDescription: '仅覆盖总投资可解析的当前拟建线索。', limitation: '不与正式招投标预算合计。' },
].map(value => MetricDefinitionV1Schema.parse(value))

function metricValue(metricId: string, value: number, extras: Omit<MetricValueV1, 'metricId' | 'value'> = {}): MetricValueV1 {
  return { metricId, value, ...extras }
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function amountValue(row: ReviewRecordV1): number | undefined {
  const { minCny, maxCny, parseStatus } = row.project.amount
  if (parseStatus === 'missing' || parseStatus === 'unparseable') return undefined
  if (minCny !== undefined && maxCny !== undefined) return (minCny + maxCny) / 2
  return minCny ?? maxCny
}

function amountDistribution(rows: readonly ReviewRecordV1[], source: 'tender' | 'proposed') {
  const eligible = rows.filter(row => row.project.source === source && row.review.decision === 'confirmed-candidate')
  const values = eligible.map(amountValue).filter((value): value is number => value !== undefined)
  const thresholds = source === 'tender'
    ? [3_000_000, 10_000_000] as const
    : [50_000_000, 200_000_000] as const
  const labels = source === 'tender'
    ? ['300 万以下', '300 万至 1,000 万', '1,000 万以上'] as const
    : ['5,000 万以下', '5,000 万至 2 亿元', '2 亿元以上'] as const
  return {
    source,
    amountType: source === 'tender' ? 'budget' as const : 'total-investment' as const,
    eligibleCount: eligible.length,
    parsedCount: values.length,
    missingCount: eligible.length - values.length,
    ...(median(values) === undefined ? {} : { medianCny: median(values) }),
    bands: [
      { id: 'low', label: labels[0], count: values.filter(value => value < thresholds[0]).length },
      { id: 'middle', label: labels[1], count: values.filter(value => value >= thresholds[0] && value <= thresholds[1]).length },
      { id: 'high', label: labels[2], count: values.filter(value => value > thresholds[1]).length },
    ],
    limitation: source === 'tender'
      ? '公告预算不等于合同收入或利润；缺失金额不按零处理。'
      : '拟建总投资不等于可参与采购金额，且不与招投标预算合计。',
  }
}

function descending(left: string | undefined, right: string | undefined): number {
  return (right ?? '').localeCompare(left ?? '')
}

export function selectPriorityRecordRefs(rows: readonly ReviewRecordV1[]): string[] {
  const selected = rows.filter(row => row.review.decision === 'confirmed-candidate')
  const tender = selected.filter(row => row.project.source === 'tender').sort((left, right) => {
    const deadline = (left.project.deadline?.value ?? '9999').localeCompare(right.project.deadline?.value ?? '9999')
    if (deadline !== 0) return deadline
    const published = descending(left.project.publishedAt.value, right.project.publishedAt.value)
    return published !== 0 ? published : left.project.recordId.localeCompare(right.project.recordId)
  })
  const proposed = selected.filter(row => row.project.source === 'proposed').sort((left, right) => {
    const updated = descending(left.project.publishedAt.value, right.project.publishedAt.value)
    return updated !== 0 ? updated : left.project.recordId.localeCompare(right.project.recordId)
  })
  const tenderTake = Math.min(5, tender.length)
  const proposedTake = Math.min(5, proposed.length)
  let remaining = 10 - tenderTake - proposedTake
  const tenderExtra = Math.min(remaining, tender.length - tenderTake)
  remaining -= tenderExtra
  const proposedExtra = Math.min(remaining, proposed.length - proposedTake)
  return [
    ...tender.slice(0, tenderTake + tenderExtra),
    ...proposed.slice(0, proposedTake + proposedExtra),
  ].map(row => row.project.recordId)
}

function reportMetricValues(normalized: NormalizedDatasetV1, review: ReviewDatasetV1): MetricValueV1[] {
  const rows = review.rows
  const normalizedCount = rows.length
  const screeningCandidates = rows.filter(row => row.classification === 'include').length
  const reviewed = rows.filter(row => row.review.decision !== 'pending').length
  const confirmedTender = rows.filter(row => row.project.source === 'tender' && row.review.decision === 'confirmed-candidate').length
  const priorityProposed = rows.filter(row => row.project.source === 'proposed' && row.review.decision === 'confirmed-candidate').length
  const watch = rows.filter(row => row.review.decision === 'watch').length
  const pending = rows.filter(row => row.review.decision === 'pending').length
  const excluded = rows.filter(row => row.review.decision === 'exclude').length
  const missing = rows.filter(row => row.project.disclosure.missingFields.length > 0).length
  const unparseable = rows.filter(row => row.project.disclosure.unparseableFields.length > 0).length
  const analyzed = rows.filter(row => row.recommendation !== undefined).length
  const confirmed = confirmedTender + priorityProposed
  const tenderAmount = amountDistribution(rows, 'tender')
  const proposedAmount = amountDistribution(rows, 'proposed')
  return [
    metricValue('raw-records', normalized.summary.rawRecordCount),
    metricValue('normalized-projects', normalizedCount),
    metricValue('screening-candidates', screeningCandidates),
    metricValue('reviewed-projects', reviewed, { numerator: reviewed, denominator: normalizedCount }),
    metricValue('confirmed-tender', confirmedTender),
    metricValue('priority-proposed', priorityProposed),
    metricValue('user-watch', watch),
    metricValue('pending-review', pending),
    metricValue('user-excluded', excluded),
    metricValue('projects-with-missing-fields', missing),
    metricValue('projects-with-unparseable-fields', unparseable),
    metricValue('agent-analyzed', analyzed, { numerator: analyzed, denominator: normalizedCount }),
    metricValue('agent-analysis-coverage', normalizedCount === 0 ? 0 : analyzed / normalizedCount, { numerator: analyzed, denominator: normalizedCount }),
    metricValue('confirmed-rate-reviewed', reviewed === 0 ? 0 : confirmed / reviewed, { numerator: confirmed, denominator: reviewed }),
    metricValue('tender-budget-parsed', tenderAmount.parsedCount, { numerator: tenderAmount.parsedCount, denominator: tenderAmount.eligibleCount, missingCount: tenderAmount.missingCount }),
    metricValue('tender-budget-missing', tenderAmount.missingCount),
    metricValue('tender-budget-median', tenderAmount.medianCny ?? 0, { missingCount: tenderAmount.missingCount }),
    metricValue('proposed-investment-parsed', proposedAmount.parsedCount, { numerator: proposedAmount.parsedCount, denominator: proposedAmount.eligibleCount, missingCount: proposedAmount.missingCount }),
    metricValue('proposed-investment-missing', proposedAmount.missingCount),
    metricValue('proposed-investment-median', proposedAmount.medianCny ?? 0, { missingCount: proposedAmount.missingCount }),
  ]
}

function contextWithoutFingerprint(input: {
  readonly activeDatasetId: string
  readonly stateRevision: number
  readonly metrics: readonly MetricValueV1[]
  readonly priorityRecords: readonly {
    readonly recordRef: string
    readonly source: 'tender' | 'proposed'
    readonly title: string
    readonly evidenceRefs: readonly string[]
  }[]
  readonly analysisCoverage: { readonly analyzedCount: number; readonly totalCount: number }
}) {
  return {
    schemaVersion: 1 as const,
    activeDatasetId: input.activeDatasetId,
    stateRevision: input.stateRevision,
    metricDefinitions: REPORT_METRIC_DEFINITIONS,
    metrics: input.metrics,
    priorityRecords: input.priorityRecords,
    analysisCoverage: input.analysisCoverage,
  }
}

export function createReportContext(input: {
  readonly normalized: NormalizedDatasetV1
  readonly review: ReviewDatasetV1
  readonly stateRevision: number
}): ReportContextV1 {
  const metrics = reportMetricValues(input.normalized, input.review)
  const byRef = new Map(input.review.rows.map(row => [row.project.recordId, row]))
  const priorityRecords = selectPriorityRecordRefs(input.review.rows).map((recordRef) => {
    const row = byRef.get(recordRef)
    if (row === undefined) throw new Error(`优先核验记录不存在：${recordRef}`)
    return {
      recordRef,
      source: row.project.source,
      title: row.project.title,
      evidenceRefs: row.recommendation?.evidence.map(item => item.ref) ?? [],
    }
  })
  const analyzedCount = input.review.rows.filter(row => row.recommendation !== undefined).length
  const content = contextWithoutFingerprint({
    activeDatasetId: input.review.activeDatasetId,
    stateRevision: input.stateRevision,
    metrics,
    priorityRecords,
    analysisCoverage: { analyzedCount, totalCount: input.review.rows.length },
  })
  const contextFingerprint = `rc_${createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')}`
  return ReportContextV1Schema.parse({ ...content, contextFingerprint })
}

function narrativeObservations(narrative: ReportNarrativeV1): ReportObservationV1[] {
  return [
    ...(narrative.executiveSummary === undefined ? [] : [narrative.executiveSummary]),
    ...narrative.keyFindings,
    ...narrative.priorityVerification,
    ...narrative.risksAndLimitations,
  ]
}

/** Validate unknown Agent narrative against one exact Host context; return an immutable clone. */
export function validateReportNarrative(value: unknown, context: ReportContextV1): ReportNarrativeV1 {
  const narrative = ReportNarrativeV1Schema.parse(value)
  const metricRefs = new Set(context.metrics.map(metric => metric.metricId))
  const recordRefs = new Set(context.priorityRecords.map(record => record.recordRef))
  const forbiddenNumericFact = /[0-9０-９][0-9０-９,，.．:%％￥¥元万亿年月日号-]*|百分之[〇零一二三四五六七八九十百千万亿]+|[〇零一二三四五六七八九十百千万亿]+(?:个|项|条|家|份|元|万|亿|年|月|日)/u
  narrativeObservations(narrative).forEach((observation) => {
    const unknownMetric = observation.metricRefs.find(ref => !metricRefs.has(ref))
    if (unknownMetric !== undefined) throw new Error(`Agent 报告叙述包含未知 metricRef：${unknownMetric}`)
    const unknownRecord = observation.recordRefs.find(ref => !recordRefs.has(ref))
    if (unknownRecord !== undefined) throw new Error(`Agent 报告叙述包含未知或非优先核验 recordRef：${unknownRecord}`)
    const freeText = [observation.title, observation.statement, ...observation.limitations]
    if (freeText.some(text => forbiddenNumericFact.test(text))) {
      throw new Error('Agent 报告叙述不得在自由文本中写入数字、比例、金额或日期；请只引用 Host metricRef / recordRef。')
    }
  })
  return structuredClone(narrative)
}

export function buildReportDataset(input: {
  readonly finalSnapshotId: string
  readonly createdAt: string
  readonly stateRevision: number
  readonly normalized: NormalizedDatasetV1
  readonly review: ReviewDatasetV1
  readonly query: {
    readonly scope: 'tender' | 'proposed' | 'combined'
    readonly targetSummary: string
    readonly sources: {
      readonly tender?: { readonly status: 'succeeded' | 'failed'; readonly loaded: number; readonly errorMessage?: string }
      readonly proposed?: { readonly status: 'succeeded' | 'failed'; readonly loaded: number; readonly errorMessage?: string }
    }
  }
  readonly narrative?: ReportNarrativeV1
}): ReportDatasetV1 {
  const rows = input.review.rows
  const context = createReportContext({ normalized: input.normalized, review: input.review, stateRevision: input.stateRevision })
  const narrative = input.narrative === undefined ? undefined : validateReportNarrative(input.narrative, context)
  const pending = rows.filter(row => row.review.decision === 'pending').length
  return ReportDatasetV1Schema.parse({
    schemaVersion: 1,
    finalSnapshotId: input.finalSnapshotId,
    createdAt: input.createdAt,
    timeZone: 'Asia/Shanghai',
    completeness: pending === 0 ? 'complete' : 'partial',
    activeDatasetId: input.review.activeDatasetId,
    ...(input.review.ruleSetVersion === undefined ? {} : { ruleSetVersion: input.review.ruleSetVersion }),
    ...(input.review.analysisVersion === undefined ? {} : { analysisVersion: input.review.analysisVersion }),
    reviewRevision: input.review.revision,
    stateRevision: input.stateRevision,
    contextFingerprint: context.contextFingerprint,
    ...(narrative === undefined ? {} : { narrative }),
    query: input.query,
    metricDefinitions: context.metricDefinitions,
    metricValues: context.metrics,
    amountDistributions: [amountDistribution(rows, 'tender'), amountDistribution(rows, 'proposed')],
    priorityRecordRefs: context.priorityRecords.map(record => record.recordRef),
    limitations: [
      '本报告只覆盖当前 Session 中 qcc-tender MCP 实际返回并成功加载的数据，不使用 Web 搜索补全。',
      '没有企业能力画像，不判断资格符合度、交付能力、客户关系、利润、中标概率或 Bid/No-Bid。',
      '数据处理状态、初筛分类、Agent 建议和用户决定是四个独立维度。',
      '招投标预算与拟建项目总投资分开统计，缺失金额不按零处理，也不合计两类金额。',
    ],
    invalidRecords: input.normalized.invalidRecords,
    rows,
  })
}

export function metricValueOf(dataset: ReportDatasetV1, metricId: string): MetricValueV1 {
  const value = dataset.metricValues.find(metric => metric.metricId === metricId)
  if (value === undefined) throw new Error(`missing report metric: ${metricId}`)
  return value
}
