import { createHash } from 'node:crypto'
import {
  MetricDefinitionV1Schema,
  ReportContextV2Schema,
  ReportDeliveryViewV1Schema,
  ReportDatasetV2Schema,
  ReportNarrativeV1Schema,
  type AmountDistributionV2,
  type MetricDefinitionV1,
  type MetricValueV1,
  type ReportContextV2,
  type ReportDeliveryRecordV1,
  type ReportDeliveryViewV1,
  type ReportDatasetV2,
  type ReportDistributionV2,
  type ReportNarrativeV1,
  type ReportObservationV1,
} from '../../contracts/reporting.ts'
import type { NormalizedDatasetV1, NormalizedProjectV1 } from '../../contracts/dataset.ts'
import type { ReviewDatasetV1, ReviewRecordV1 } from '../../contracts/analysis-review.ts'

export const REPORT_METRIC_DEFINITIONS: readonly MetricDefinitionV1[] = [
  { id: 'raw-records', label: '来源记录', description: '本轮成功来源实际返回并进入处理的数据记录数。', unit: 'record', scopeDescription: '当前活动查询的实际来源覆盖范围。', limitation: '来源记录数不能与去重归并后的项目数混用。' },
  { id: 'normalized-projects', label: '去重归并后的项目', description: '经过字段标准化与保守关联后形成的项目数。', unit: 'project', scopeDescription: '当前活动数据快照。', limitation: '更正及明确关联公告不会重复计为独立项目。' },
  { id: 'screening-candidates', label: '规则初筛纳入', description: '当前规则初筛分类为 include 的项目数。', unit: 'project', scopeDescription: '当前分类版本；无分类版本时为 0。', limitation: '该指标只表示 include，不代表人工确认候选；完整初筛结果应查看五分类分布。' },
  { id: 'reviewed-projects', label: '已完成人工复核', description: '人工确认结论不为 pending 的项目数。', unit: 'project', numeratorLabel: '已完成复核项目', denominatorLabel: '当前项目', scopeDescription: '当前活动数据上的人工复核结论集合。', limitation: '未进行智能辅助分析的记录仍可由人工形成结论。' },
  { id: 'review-completion-rate', label: '人工复核完成比例', description: '已完成人工复核的项目数除以当前项目数。', unit: 'percent', numeratorLabel: '已完成复核项目', denominatorLabel: '当前项目', scopeDescription: '当前活动数据上的人工复核范围。', limitation: '该比例表示复核范围，不表示效率提升或商机转化。' },
  { id: 'confirmed-tender', label: '正式招投标确认候选', description: '来源为招投标且人工确认结论为 confirmed-candidate 的项目数。', unit: 'project', scopeDescription: '当前人工确认结论；只统计正式招投标来源。', limitation: '确认候选不表示决定投标。' },
  { id: 'priority-proposed', label: '拟建重点前期线索', description: '来源为拟建项目且人工确认结论为 confirmed-candidate 的项目数。', unit: 'project', scopeDescription: '当前人工确认结论；只统计拟建项目来源。', limitation: '重点前期线索不表示已有采购包或决定投标。' },
  { id: 'confirmed-total', label: '纳入结果清单', description: '正式确认候选与拟建重点前期线索之和。', unit: 'project', scopeDescription: '当前人工确认结论。', limitation: '两类来源的金额和业务阶段不合并。' },
  { id: 'user-watch', label: '观察', description: '人工确认结论为 watch 的项目数。', unit: 'project', scopeDescription: '当前人工确认结论集合。', limitation: '不与规则初筛 observe 或智能辅助建议混用。' },
  { id: 'pending-review', label: '待复核', description: '人工确认结论仍为 pending 的项目数。', unit: 'project', scopeDescription: '当前人工确认结论集合。', limitation: '阶段性报告单列待复核，不计入已形成结论或确认候选。' },
  { id: 'user-excluded', label: '人工排除', description: '人工确认结论为 exclude 的项目数。', unit: 'project', scopeDescription: '当前人工确认结论集合。', limitation: '不与规则初筛排除或数据异常混用。' },
  { id: 'near-term-tender', label: '近期需核验的正式候选', description: '正式候选中已截止或在 30 天内截止的项目数。', unit: 'project', scopeDescription: '按报告生成时的北京时间计算。', limitation: '只表示截止紧迫性，不是价值排名。' },
  { id: 'projects-with-missing-fields', label: '存在来源未披露字段', description: '至少一个关键字段未由来源披露的项目数。', unit: 'project', scopeDescription: '当前项目的字段披露范围。', limitation: '未披露不表示来源错误或项目无价值。' },
  { id: 'projects-with-unparseable-fields', label: '存在暂无法解析字段', description: '至少一个来源原值暂无法规范化解析的项目数。', unit: 'project', scopeDescription: '当前项目的字段解析范围。', limitation: '保留来源原文，无法解析值不按零处理。' },
  { id: 'agent-analyzed', label: '已获得补充分析建议', description: '拥有已提交结构化智能辅助建议的项目数。', unit: 'project', numeratorLabel: '已有补充建议项目', denominatorLabel: '当前项目', scopeDescription: '当前活动数据与可选分析版本。', limitation: '未分析项目仍可人工复核和交付。' },
  { id: 'agent-analysis-coverage', label: '补充分析建议覆盖比例', description: '已获得补充分析建议的项目数除以当前项目数。', unit: 'percent', numeratorLabel: '已有补充建议项目', denominatorLabel: '当前项目', scopeDescription: '当前活动数据与可选分析版本。', limitation: '覆盖比例不表示证据准确率或建议质量。' },
  { id: 'confirmed-rate-reviewed', label: '纳入结果清单占已复核比例', description: '正式确认候选与拟建重点线索之和除以已完成人工复核的项目数。', unit: 'percent', numeratorLabel: '纳入结果清单', denominatorLabel: '已完成人工复核', scopeDescription: '当前人工确认结论；待复核项目不进入分母。', limitation: '该比例不是转化率、命中率或中标率。' },
  { id: 'tender-budget-parsed', label: '正式候选预算可分档', description: '正式候选中预算可作为单值或可确定落入一个金额档位的项目数。', unit: 'project', numeratorLabel: '可分档项目', denominatorLabel: '正式招投标确认候选', scopeDescription: '当前正式候选。', limitation: '预算不等于合同收入或利润。' },
  { id: 'tender-budget-missing', label: '正式候选预算不可用', description: '正式候选中预算未披露、无法解析或区间暂无法确定的项目数。', unit: 'project', scopeDescription: '当前正式候选。', limitation: '不可用预算不按零处理。' },
  { id: 'tender-budget-median', label: '正式候选预算中位数', description: '拥有可解析单一预算值的正式候选金额中位数。', unit: 'currency', scopeDescription: '只覆盖可解析单值的当前正式候选。', limitation: '不使用区间中点，不代表收入、利润或报价。' },
  { id: 'proposed-investment-parsed', label: '拟建线索总投资可分档', description: '拟建重点线索中总投资可作为单值或可确定落入一个金额档位的项目数。', unit: 'project', numeratorLabel: '可分档项目', denominatorLabel: '拟建重点前期线索', scopeDescription: '当前拟建重点线索。', limitation: '总投资不等于可参与采购金额。' },
  { id: 'proposed-investment-missing', label: '拟建线索总投资不可用', description: '拟建重点线索中总投资未披露、无法解析或区间暂无法确定的项目数。', unit: 'project', scopeDescription: '当前拟建重点线索。', limitation: '不可用投资额不按零处理。' },
  { id: 'proposed-investment-median', label: '拟建线索总投资中位数', description: '拥有可解析单一总投资值的拟建重点线索金额中位数。', unit: 'currency', scopeDescription: '只覆盖可解析单值的当前拟建重点线索。', limitation: '不使用区间中点，也不与正式招投标预算合计。' },
].map(value => MetricDefinitionV1Schema.parse(value))

export const DEADLINE_WINDOW_IDS = [
  'expired', 'within-7-days', 'within-8-to-30-days', 'after-30-days', 'unavailable',
] as const

export type DeadlineWindowId = typeof DEADLINE_WINDOW_IDS[number]

const DEADLINE_WINDOW_LABELS: Record<DeadlineWindowId, string> = {
  expired: '已截止',
  'within-7-days': '7 天内',
  'within-8-to-30-days': '8-30 天',
  'after-30-days': '30 天以后',
  unavailable: '截止时间不可用',
}

export function deadlineWindowLabel(id: DeadlineWindowId): string {
  return DEADLINE_WINDOW_LABELS[id]
}

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

function shanghaiDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function formatReportDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date).replaceAll('/', '-')
}

function dayNumber(dateKey: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey)
  if (match === null) return undefined
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000)
}

export function deadlineWindowOf(row: ReviewRecordV1, createdAt: string): DeadlineWindowId {
  if (row.project.source !== 'tender') return 'unavailable'
  const deadline = row.project.deadline
  if (deadline?.parseStatus !== 'normalized' || deadline.value === undefined) return 'unavailable'
  const asOf = new Date(createdAt)
  if (!Number.isFinite(asOf.getTime())) return 'unavailable'
  if (deadline.precision === 'date-time') {
    const instant = new Date(deadline.value)
    if (!Number.isFinite(instant.getTime())) return 'unavailable'
    if (instant.getTime() < asOf.getTime()) return 'expired'
    const difference = (dayNumber(shanghaiDateKey(instant)) ?? 0) - (dayNumber(shanghaiDateKey(asOf)) ?? 0)
    if (difference <= 7) return 'within-7-days'
    if (difference <= 30) return 'within-8-to-30-days'
    return 'after-30-days'
  }
  if (deadline.precision !== 'date') return 'unavailable'
  const deadlineDay = dayNumber(deadline.value)
  const asOfDay = dayNumber(shanghaiDateKey(asOf))
  if (deadlineDay === undefined || asOfDay === undefined) return 'unavailable'
  const difference = deadlineDay - asOfDay
  if (difference < 0) return 'expired'
  if (difference <= 7) return 'within-7-days'
  if (difference <= 30) return 'within-8-to-30-days'
  return 'after-30-days'
}

function amountBandOf(value: number, thresholds: readonly [number, number]): 'low' | 'middle' | 'high' {
  if (value < thresholds[0]) return 'low'
  if (value < thresholds[1]) return 'middle'
  return 'high'
}

function niceAmountStep(target: number): number {
  if (!Number.isFinite(target) || target <= 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const normalized = target / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

function amountAxis(ranges: readonly { readonly minCny: number, readonly maxCny: number }[]): NonNullable<AmountDistributionV2['axis']> | undefined {
  if (ranges.length === 0) return undefined
  const dataMin = Math.min(...ranges.map(range => range.minCny))
  const dataMax = Math.max(...ranges.map(range => range.maxCny))
  const dataSpan = dataMax - dataMin
  const targetSpan = dataSpan === 0 ? Math.max(dataMax * 0.3, 3) : dataSpan * 1.16
  let step = niceAmountStep(targetSpan / 3)
  let minCny: number
  let maxCny: number
  if (dataSpan === 0) {
    minCny = Math.max(0, (Math.floor(dataMin / step) - 1) * step)
    maxCny = minCny + step * 3
  } else {
    minCny = Math.max(0, Math.floor(dataMin / step) * step)
    maxCny = minCny + step * 3
    while (maxCny < dataMax) {
      step = niceAmountStep(step * 1.01)
      minCny = Math.max(0, Math.floor(dataMin / step) * step)
      maxCny = minCny + step * 3
    }
  }
  const unit = maxCny >= 100_000_000
    ? 'hundred-million-yuan' as const
    : maxCny >= 10_000
      ? 'ten-thousand-yuan' as const
      : 'yuan' as const
  const unitLabel = unit === 'hundred-million-yuan' ? '亿元' as const : unit === 'ten-thousand-yuan' ? '万元' as const : '元' as const
  return {
    unit,
    unitLabel,
    minCny,
    maxCny,
    ticksCny: [minCny, minCny + step, minCny + step * 2, maxCny],
  }
}

function formatAmountTick(value: number, unit: NonNullable<AmountDistributionV2['axis']>['unit']): string {
  const divisor = unit === 'hundred-million-yuan' ? 100_000_000 : unit === 'ten-thousand-yuan' ? 10_000 : 1
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / divisor)
}

export function formatAmountAxis(axis: NonNullable<AmountDistributionV2['axis']>): string {
  return `${formatAmountTick(axis.minCny, axis.unit)} 至 ${formatAmountTick(axis.maxCny, axis.unit)} ${axis.unitLabel}`
}

export function amountDistribution(rows: readonly ReviewRecordV1[], source: 'tender' | 'proposed'): AmountDistributionV2 {
  const eligible = rows.filter(row => row.project.source === source && row.review.decision === 'confirmed-candidate')
  const singleValues: number[] = []
  const closedRanges: { minCny: number, maxCny: number }[] = []
  eligible.forEach((row) => {
    const { minCny, maxCny, parseStatus } = row.project.amount
    if (parseStatus !== 'missing' && parseStatus !== 'unparseable' && minCny !== undefined && maxCny !== undefined) {
      closedRanges.push({ minCny, maxCny })
    }
  })
  const axis = amountAxis(closedRanges)
  const thresholds = axis === undefined ? [0, 0] as const : [axis.ticksCny[1] ?? 0, axis.ticksCny[2] ?? 0] as const
  const tickLabels = axis === undefined ? undefined : axis.ticksCny.map(value => formatAmountTick(value, axis.unit))
  const labels = tickLabels === undefined || axis === undefined
    ? ['低金额档', '中金额档', '高金额档'] as const
    : [
        `${tickLabels[0]} 至 ${tickLabels[1]} ${axis.unitLabel}`,
        `${tickLabels[1]} 至 ${tickLabels[2]} ${axis.unitLabel}`,
        `${tickLabels[2]} 至 ${tickLabels[3]} ${axis.unitLabel}`,
      ] as const
  const bands = { low: 0, middle: 0, high: 0 }
  let bandedRangeCount = 0
  let indeterminateCount = 0
  let missingCount = 0
  let unparseableCount = 0
  eligible.forEach((row) => {
    const amount = row.project.amount
    if (amount.parseStatus === 'missing') { missingCount += 1; return }
    if (amount.parseStatus === 'unparseable') { unparseableCount += 1; return }
    if (amount.minCny !== undefined && amount.maxCny !== undefined && amount.minCny === amount.maxCny) {
      singleValues.push(amount.minCny)
      bands[amountBandOf(amount.minCny, thresholds)] += 1
      return
    }
    if (amount.minCny !== undefined && amount.maxCny !== undefined) {
      const lowBand = amountBandOf(amount.minCny, thresholds)
      const highBand = amountBandOf(amount.maxCny, thresholds)
      if (lowBand === highBand) {
        bands[lowBand] += 1
        bandedRangeCount += 1
      } else {
        indeterminateCount += 1
      }
      return
    }
    indeterminateCount += 1
  })
  const medianCny = median(singleValues)
  return {
    source,
    amountType: source === 'tender' ? 'budget' : 'total-investment',
    eligibleCount: eligible.length,
    singleValueCount: singleValues.length,
    bandedRangeCount,
    indeterminateCount,
    missingCount,
    unparseableCount,
    ...(medianCny === undefined ? {} : { medianCny }),
    ...(axis === undefined ? {} : { axis }),
    bands: [
      { id: 'low', label: labels[0], count: bands.low },
      { id: 'middle', label: labels[1], count: bands.middle },
      { id: 'high', label: labels[2], count: bands.high },
    ],
    limitation: source === 'tender'
      ? '中位数只使用可解析单值；跨档或开放区间不强行分档。公告预算不等于合同收入或利润。'
      : '中位数只使用可解析单值；跨档或开放区间不强行分档。拟建总投资不等于可参与采购金额。',
  }
}

function textValue(value: NormalizedProjectV1['stage'] | undefined): string | undefined {
  if (value?.status !== 'normalized') return undefined
  return value.value
}

function topCategoryBuckets(values: readonly string[], maximum = 8): ReportDistributionV2['buckets'] {
  const counts = new Map<string, number>()
  values.forEach((value) => { counts.set(value, (counts.get(value) ?? 0) + 1) })
  const ordered = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
  const shown = ordered.slice(0, maximum)
  const hidden = ordered.slice(maximum).reduce((sum, [, count]) => sum + count, 0)
  return [
    ...shown.map(([label, count], index) => ({ id: `category-${index + 1}`, label, count })),
    ...(hidden === 0 ? [] : [{ id: 'other', label: '其他', count: hidden }]),
  ]
}

function categoricalDistribution(input: {
  readonly id: string
  readonly label: string
  readonly rows: readonly ReviewRecordV1[]
  readonly values: (row: ReviewRecordV1) => readonly string[]
  readonly scopeDescription: string
  readonly limitation?: string
}): ReportDistributionV2 {
  const values = input.rows.flatMap(row => input.values(row).filter(value => value.trim() !== ''))
  const rowsWithValue = input.rows.filter(row => input.values(row).some(value => value.trim() !== '')).length
  return {
    id: input.id,
    label: input.label,
    scopeDescription: input.scopeDescription,
    buckets: topCategoryBuckets(values),
    missingCount: input.rows.length - rowsWithValue,
    ...(input.limitation === undefined ? {} : { limitation: input.limitation }),
  }
}

export function reportDistributions(rows: readonly ReviewRecordV1[], createdAt: string): ReportDistributionV2[] {
  const confirmed = rows.filter(row => row.review.decision === 'confirmed-candidate')
  const confirmedTender = confirmed.filter(row => row.project.source === 'tender')
  const confirmedProposed = confirmed.filter(row => row.project.source === 'proposed')
  const deadlineCounts = Object.fromEntries(DEADLINE_WINDOW_IDS.map(id => [id, 0])) as Record<DeadlineWindowId, number>
  confirmedTender.forEach((row) => { deadlineCounts[deadlineWindowOf(row, createdAt)] += 1 })
  const classificationValues = ['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const
  const oneText = (value: string | undefined): string[] => value === undefined ? [] : [value]
  return [
    {
      id: 'review-decisions', label: '人工确认结果结构', scopeDescription: '当前全部项目的人工确认结论。',
      buckets: [
        { id: 'confirmed', label: '纳入结果清单', count: confirmed.length },
        { id: 'watch', label: '观察', count: rows.filter(row => row.review.decision === 'watch').length },
        { id: 'exclude', label: '人工排除', count: rows.filter(row => row.review.decision === 'exclude').length },
        { id: 'pending', label: '待复核', count: rows.filter(row => row.review.decision === 'pending').length },
      ],
      limitation: '人工确认结果与规则初筛、补充分析建议彼此独立。',
    },
    {
      id: 'tender-deadline-window', label: '正式候选截止窗口', scopeDescription: '当前正式招投标确认候选。',
      buckets: DEADLINE_WINDOW_IDS.map(id => ({ id, label: DEADLINE_WINDOW_LABELS[id], count: deadlineCounts[id] })),
      limitation: '按报告生成时的北京时间计算，只表示核验紧迫性。',
    },
    {
      id: 'screening-classifications', label: '规则初筛分布', scopeDescription: '当前全部项目的规则初筛结果。',
      buckets: classificationValues.map(id => ({
        id,
        label: id === 'include' ? '初选' : id === 'observe' ? '观察' : id === 'manual-review' ? '人工复核' : id === 'exclude' ? '初筛排除' : '未匹配',
        count: rows.filter(row => row.classification === id).length,
      })),
      missingCount: rows.filter(row => row.classification === undefined).length,
      limitation: '未执行规则初筛的项目不并入未匹配。',
    },
    categoricalDistribution({ id: 'confirmed-regions', label: '确认结果地区分布', rows: confirmed, values: row => oneText(textValue(row.project.region)), scopeDescription: '正式候选和拟建重点线索。' }),
    categoricalDistribution({ id: 'tender-procurement-methods', label: '正式候选招采方式', rows: confirmedTender, values: row => oneText(textValue(row.project.tenderDetails?.procurementMethod)), scopeDescription: '当前正式招投标确认候选。' }),
    categoricalDistribution({ id: 'tender-procurement-types', label: '正式候选招采类型', rows: confirmedTender, values: row => oneText(textValue(row.project.tenderDetails?.procurementType)), scopeDescription: '当前正式招投标确认候选。' }),
    categoricalDistribution({ id: 'tender-industries', label: '正式候选行业分布', rows: confirmedTender, values: row => row.project.tenderDetails?.industries ?? [], scopeDescription: '当前正式招投标确认候选。', limitation: '一个项目可包含多个行业标签，各标签数量之和可能超过项目数。' }),
    categoricalDistribution({ id: 'proposed-project-stages', label: '拟建重点线索项目阶段', rows: confirmedProposed, values: row => oneText(textValue(row.project.proposedDetails?.projectStage)), scopeDescription: '当前拟建重点前期线索。' }),
    categoricalDistribution({ id: 'proposed-approval-progress', label: '拟建重点线索审批进度', rows: confirmedProposed, values: row => oneText(textValue(row.project.proposedDetails?.approvalProgress)), scopeDescription: '当前拟建重点前期线索。' }),
  ]
}

function deadlineSort(left: ReviewRecordV1, right: ReviewRecordV1, createdAt: string): number {
  const ranks: Record<DeadlineWindowId, number> = { expired: 0, 'within-7-days': 1, 'within-8-to-30-days': 2, 'after-30-days': 3, unavailable: 4 }
  const leftWindow = deadlineWindowOf(left, createdAt)
  const rightWindow = deadlineWindowOf(right, createdAt)
  if (leftWindow !== rightWindow) return ranks[leftWindow] - ranks[rightWindow]
  const leftDeadline = left.project.deadline?.value ?? ''
  const rightDeadline = right.project.deadline?.value ?? ''
  if (leftDeadline !== rightDeadline) {
    return leftWindow === 'expired' ? rightDeadline.localeCompare(leftDeadline) : leftDeadline.localeCompare(rightDeadline)
  }
  const published = (right.project.publishedAt.value ?? '').localeCompare(left.project.publishedAt.value ?? '')
  return published !== 0 ? published : left.project.recordId.localeCompare(right.project.recordId)
}

export function selectPriorityRecordRefs(rows: readonly ReviewRecordV1[], createdAt: string): string[] {
  const selected = rows.filter(row => row.review.decision === 'confirmed-candidate')
  const tender = selected.filter(row => row.project.source === 'tender').sort((left, right) => deadlineSort(left, right, createdAt))
  const proposed = selected.filter(row => row.project.source === 'proposed').sort((left, right) => {
    const updated = (right.project.publishedAt.value ?? '').localeCompare(left.project.publishedAt.value ?? '')
    return updated !== 0 ? updated : left.project.recordId.localeCompare(right.project.recordId)
  })
  const tenderTake = Math.min(5, tender.length)
  const proposedTake = Math.min(5, proposed.length)
  let remaining = 10 - tenderTake - proposedTake
  const tenderExtra = Math.min(remaining, tender.length - tenderTake)
  remaining -= tenderExtra
  const proposedExtra = Math.min(remaining, proposed.length - proposedTake)
  return [...tender.slice(0, tenderTake + tenderExtra), ...proposed.slice(0, proposedTake + proposedExtra)]
    .map(row => row.project.recordId)
}

export function selectHomepageRecordRefs(rows: readonly ReviewRecordV1[], createdAt: string): string[] {
  const priority = selectPriorityRecordRefs(rows, createdAt)
  const byRef = new Map(rows.map(row => [row.project.recordId, row]))
  const tender = priority.filter(ref => byRef.get(ref)?.project.source === 'tender')
  const proposed = priority.filter(ref => byRef.get(ref)?.project.source === 'proposed')
  const selected = [...tender.slice(0, 2), ...proposed.slice(0, 1)]
  priority.forEach((ref) => { if (selected.length < 3 && !selected.includes(ref)) selected.push(ref) })
  return selected
}

function reportMetricValues(
  rawRecordCount: number,
  rows: readonly ReviewRecordV1[],
  createdAt: string,
): MetricValueV1[] {
  const normalizedCount = rows.length
  const reviewed = rows.filter(row => row.review.decision !== 'pending').length
  const confirmedTender = rows.filter(row => row.project.source === 'tender' && row.review.decision === 'confirmed-candidate').length
  const priorityProposed = rows.filter(row => row.project.source === 'proposed' && row.review.decision === 'confirmed-candidate').length
  const confirmed = confirmedTender + priorityProposed
  const watch = rows.filter(row => row.review.decision === 'watch').length
  const pending = rows.filter(row => row.review.decision === 'pending').length
  const excluded = rows.filter(row => row.review.decision === 'exclude').length
  const missing = rows.filter(row => row.project.disclosure.missingFields.length > 0).length
  const unparseable = rows.filter(row => row.project.disclosure.unparseableFields.length > 0).length
  const analyzed = rows.filter(row => row.recommendation !== undefined).length
  const nearTerm = rows.filter(row => row.project.source === 'tender' && row.review.decision === 'confirmed-candidate')
    .filter(row => ['expired', 'within-7-days', 'within-8-to-30-days'].includes(deadlineWindowOf(row, createdAt))).length
  const tenderAmount = amountDistribution(rows, 'tender')
  const proposedAmount = amountDistribution(rows, 'proposed')
  const amountUnavailable = (value: AmountDistributionV2) => value.indeterminateCount + value.missingCount + value.unparseableCount
  return [
    metricValue('raw-records', rawRecordCount),
    metricValue('normalized-projects', normalizedCount),
    metricValue('screening-candidates', rows.filter(row => row.classification === 'include').length),
    metricValue('reviewed-projects', reviewed, { numerator: reviewed, denominator: normalizedCount }),
    metricValue('review-completion-rate', normalizedCount === 0 ? 0 : reviewed / normalizedCount, { numerator: reviewed, denominator: normalizedCount }),
    metricValue('confirmed-tender', confirmedTender),
    metricValue('priority-proposed', priorityProposed),
    metricValue('confirmed-total', confirmed),
    metricValue('user-watch', watch),
    metricValue('pending-review', pending),
    metricValue('user-excluded', excluded),
    metricValue('near-term-tender', nearTerm),
    metricValue('projects-with-missing-fields', missing),
    metricValue('projects-with-unparseable-fields', unparseable),
    metricValue('agent-analyzed', analyzed, { numerator: analyzed, denominator: normalizedCount }),
    metricValue('agent-analysis-coverage', normalizedCount === 0 ? 0 : analyzed / normalizedCount, { numerator: analyzed, denominator: normalizedCount }),
    metricValue('confirmed-rate-reviewed', reviewed === 0 ? 0 : confirmed / reviewed, { numerator: confirmed, denominator: reviewed }),
    metricValue('tender-budget-parsed', tenderAmount.singleValueCount + tenderAmount.bandedRangeCount, { numerator: tenderAmount.singleValueCount + tenderAmount.bandedRangeCount, denominator: tenderAmount.eligibleCount, missingCount: amountUnavailable(tenderAmount) }),
    metricValue('tender-budget-missing', amountUnavailable(tenderAmount)),
    metricValue('tender-budget-median', tenderAmount.medianCny ?? 0, { missingCount: tenderAmount.eligibleCount - tenderAmount.singleValueCount }),
    metricValue('proposed-investment-parsed', proposedAmount.singleValueCount + proposedAmount.bandedRangeCount, { numerator: proposedAmount.singleValueCount + proposedAmount.bandedRangeCount, denominator: proposedAmount.eligibleCount, missingCount: amountUnavailable(proposedAmount) }),
    metricValue('proposed-investment-missing', amountUnavailable(proposedAmount)),
    metricValue('proposed-investment-median', proposedAmount.medianCny ?? 0, { missingCount: proposedAmount.eligibleCount - proposedAmount.singleValueCount }),
  ]
}

function contextWithoutFingerprint(input: {
  readonly createdAt: string
  readonly activeDatasetId: string
  readonly stateRevision: number
  readonly metrics: readonly MetricValueV1[]
  readonly distributions: readonly ReportDistributionV2[]
  readonly priorityRecords: ReportContextV2['priorityRecords']
  readonly analysisCoverage: { readonly analyzedCount: number; readonly totalCount: number }
}) {
  return {
    schemaVersion: 2 as const,
    createdAt: input.createdAt,
    activeDatasetId: input.activeDatasetId,
    stateRevision: input.stateRevision,
    metricDefinitions: REPORT_METRIC_DEFINITIONS,
    metrics: input.metrics,
    distributions: input.distributions,
    priorityRecords: input.priorityRecords,
    analysisCoverage: input.analysisCoverage,
  }
}

function contextRecord(row: ReviewRecordV1, createdAt: string): ReportContextV2['priorityRecords'][number] {
  const deadlineOrUpdatedAt = row.project.source === 'tender' ? row.project.deadline?.value : row.project.publishedAt.value
  const stage = row.project.source === 'proposed'
    ? textValue(row.project.proposedDetails?.projectStage) ?? textValue(row.project.stage)
    : textValue(row.project.tenderDetails?.noticeStatus) ?? textValue(row.project.stage)
  const counterparty = textValue(row.project.counterparty)
  const region = textValue(row.project.region)
  return {
    recordRef: row.project.recordId,
    source: row.project.source,
    title: row.project.title,
    evidenceRefs: row.recommendation?.evidence.map(item => item.ref) ?? [],
    ...(counterparty === undefined ? {} : { counterparty }),
    ...(region === undefined ? {} : { region }),
    amountDisplay: row.project.amount.display,
    ...(stage === undefined ? {} : { stage }),
    ...(deadlineOrUpdatedAt === undefined ? {} : { deadlineOrUpdatedAt }),
    ...(row.project.source === 'tender' ? { deadlineWindow: deadlineWindowOf(row, createdAt) } : {}),
    ...(row.review.note.trim() === '' ? {} : { userNote: row.review.note }),
    ...(row.recommendation === undefined ? {} : { recommendationSummary: row.recommendation.reason }),
    verificationItems: row.recommendation?.verificationItems.slice(0, 5) ?? [],
  }
}

export function createReportContext(input: {
  readonly normalized: NormalizedDatasetV1
  readonly review: ReviewDatasetV1
  readonly stateRevision: number
  readonly createdAt: string
}): ReportContextV2 {
  const metrics = reportMetricValues(input.normalized.summary.rawRecordCount, input.review.rows, input.createdAt)
  const distributions = reportDistributions(input.review.rows, input.createdAt)
  const byRef = new Map(input.review.rows.map(row => [row.project.recordId, row]))
  const priorityRecords = selectPriorityRecordRefs(input.review.rows, input.createdAt).map((recordRef) => {
    const row = byRef.get(recordRef)
    if (row === undefined) throw new Error(`近期需核验记录不存在：${recordRef}`)
    return contextRecord(row, input.createdAt)
  })
  const analyzedCount = input.review.rows.filter(row => row.recommendation !== undefined).length
  const content = contextWithoutFingerprint({
    createdAt: input.createdAt,
    activeDatasetId: input.review.activeDatasetId,
    stateRevision: input.stateRevision,
    metrics,
    distributions,
    priorityRecords,
    analysisCoverage: { analyzedCount, totalCount: input.review.rows.length },
  })
  const contextFingerprint = `rc_${createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')}`
  return ReportContextV2Schema.parse({ ...content, contextFingerprint })
}

function narrativeObservations(narrative: ReportNarrativeV1): ReportObservationV1[] {
  return [
    ...(narrative.executiveSummary === undefined ? [] : [narrative.executiveSummary]),
    ...narrative.keyFindings,
    ...narrative.priorityVerification,
    ...narrative.risksAndLimitations,
  ]
}

export function validateReportNarrative(value: unknown, context: ReportContextV2): ReportNarrativeV1 {
  const narrative = ReportNarrativeV1Schema.parse(value)
  const metricRefs = new Set(context.metrics.map(metric => metric.metricId))
  const distributionRefs = new Set(context.distributions.map(distribution => distribution.id))
  const recordRefs = new Set(context.priorityRecords.map(record => record.recordRef))
  const forbiddenNumericFact = /[0-9０-９][0-9０-９,，.．:%％￥¥元万亿年月日号-]*|百分之[〇零一二三四五六七八九十百千万亿]+|[〇零一二三四五六七八九十百千万亿]+(?:个|项|条|家|份|元|万|亿|年|月|日)/u
  narrativeObservations(narrative).forEach((observation) => {
    const unknownMetric = observation.metricRefs.find(ref => !metricRefs.has(ref))
    if (unknownMetric !== undefined) throw new Error(`Agent 报告叙述包含未知 metricRef：${unknownMetric}`)
    const unknownDistribution = observation.distributionRefs?.find(ref => !distributionRefs.has(ref))
    if (unknownDistribution !== undefined) throw new Error(`Agent 报告叙述包含未知 distributionRef：${unknownDistribution}`)
    const unknownRecord = observation.recordRefs.find(ref => !recordRefs.has(ref))
    if (unknownRecord !== undefined) throw new Error(`Agent 报告叙述包含未知或非近期核验 recordRef：${unknownRecord}`)
    const freeText = [observation.title, observation.statement, ...observation.limitations]
    if (freeText.some(text => forbiddenNumericFact.test(text))) {
      throw new Error('Agent 报告叙述不得在自由文本中写入数字、比例、金额或日期；请只引用 Host metricRef / distributionRef / recordRef。')
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
}): ReportDatasetV2 {
  const rows = input.review.rows
  const context = createReportContext({ normalized: input.normalized, review: input.review, stateRevision: input.stateRevision, createdAt: input.createdAt })
  const narrative = input.narrative === undefined ? undefined : validateReportNarrative(input.narrative, context)
  const pending = rows.filter(row => row.review.decision === 'pending').length
  return ReportDatasetV2Schema.parse({
    schemaVersion: 2,
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
    distributions: context.distributions,
    amountDistributions: [amountDistribution(rows, 'tender'), amountDistribution(rows, 'proposed')],
    homepageRecordRefs: selectHomepageRecordRefs(rows, input.createdAt),
    priorityRecordRefs: context.priorityRecords.map(record => record.recordRef),
    limitations: [
      '本报告只覆盖本轮授权数据源实际返回并成功加载的数据，不使用 Web 搜索补全。',
      '没有企业能力画像，不判断资格符合度、交付能力、客户关系、利润、中标概率或是否投标。',
      '规则初筛、补充分析建议和人工确认结论是彼此独立的维度。',
      '招投标预算与拟建项目总投资分开统计，缺失金额不按零处理，也不合计两类金额。',
      '近期需核验只表示截止紧迫性或信息新近程度，不是商业价值排名。',
    ],
    invalidRecords: input.normalized.invalidRecords,
    rows,
  })
}

function deliveryRecord(row: ReviewRecordV1, createdAt: string): ReportDeliveryRecordV1 {
  const { evidenceRefs: _evidenceRefs, ...record } = contextRecord(row, createdAt)
  return record
}

export function createReportDeliveryView(datasetValue: unknown): ReportDeliveryViewV1 {
  const dataset = ReportDatasetV2Schema.parse(datasetValue)
  const byRef = new Map(dataset.rows.map(row => [row.project.recordId, row]))
  const recordsFor = (refs: readonly string[]): ReportDeliveryRecordV1[] => refs.map((ref) => {
    const row = byRef.get(ref)
    if (row === undefined) throw new Error(`交付视图引用了不存在的记录：${ref}`)
    return deliveryRecord(row, dataset.createdAt)
  })
  const completed = metricValueOf(dataset, 'agent-analyzed').value
  const total = metricValueOf(dataset, 'normalized-projects').value
  return ReportDeliveryViewV1Schema.parse({
    schemaVersion: 1,
    finalSnapshotId: dataset.finalSnapshotId,
    createdAt: dataset.createdAt,
    timeZone: dataset.timeZone,
    completeness: dataset.completeness,
    query: dataset.query,
    rulesIncluded: dataset.ruleSetVersion !== undefined,
    analysisIncluded: dataset.analysisVersion !== undefined,
    analysisCoverage: { completed, total },
    metricDefinitions: dataset.metricDefinitions,
    metricValues: dataset.metricValues,
    distributions: dataset.distributions,
    amountDistributions: dataset.amountDistributions,
    homepageRecords: recordsFor(dataset.homepageRecordRefs),
    priorityRecords: recordsFor(dataset.priorityRecordRefs),
    ...(dataset.narrative === undefined ? {} : { narrative: dataset.narrative }),
    limitations: dataset.limitations,
  })
}

export function distributionOf(dataset: ReportDatasetV2, id: string): ReportDistributionV2 {
  const distribution = dataset.distributions.find(item => item.id === id)
  if (distribution === undefined) throw new Error(`missing report distribution: ${id}`)
  return distribution
}

export function metricValueOf(dataset: ReportDatasetV2, metricId: string): MetricValueV1 {
  const value = dataset.metricValues.find(metric => metric.metricId === metricId)
  if (value === undefined) throw new Error(`missing report metric: ${metricId}`)
  return value
}
