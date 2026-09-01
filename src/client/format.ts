import { formatAreaSelections } from './area-utils.ts'
import type { QccSearchRequest } from './qcc-request.ts'
import type { PublishPreset, TenderFilters } from './types.ts'

const PUBLISH_LABELS: Readonly<Record<Exclude<PublishPreset, 'all' | 'custom' | 'year'>, string>> = {
  today: '今天',
  '3d': '近3天',
  '7d': '近7天',
  '1m': '近1个月',
  '3m': '近3个月',
  '6m': '近6个月',
  '1y': '近1年',
  '3y': '近3年',
  '5y': '近5年',
}

function normalized(value: string | undefined): string | undefined {
  const next = value?.trim().replace(/\s+/gu, ' ')
  return next === '' ? undefined : next
}

function joined(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values.join('、')
}

function amount(preset: string | undefined, minimum: string | undefined, maximum: string | undefined): string | undefined {
  if (preset !== undefined) return preset
  const min = normalized(minimum)
  const max = normalized(maximum)
  if (min !== undefined && max !== undefined) return `${min}万-${max}万`
  if (min !== undefined) return `${min}万元以上`
  if (max !== undefined) return `${max}万元以下`
  return undefined
}

function publishSummary(request: QccSearchRequest, filters: TenderFilters): string | undefined {
  if (filters.publishPreset === 'all') return undefined
  if (filters.publishPreset === 'year') return filters.publishYear === undefined ? undefined : `${filters.publishYear}年`
  if (filters.publishPreset === 'custom') {
    if (filters.startDate !== undefined && filters.endDate !== undefined) return `${filters.startDate} 至 ${filters.endDate}（工具开区间参数已向外扩 1 天）`
    if (filters.startDate !== undefined) return `${filters.startDate} 及以后`
    if (filters.endDate !== undefined) return `${filters.endDate} 及以前`
    return undefined
  }
  const label = PUBLISH_LABELS[filters.publishPreset]
  return request.args.beginDate === undefined ? label : `${label}（自 ${request.args.beginDate}）`
}

function supportedRows(request: QccSearchRequest, filters: TenderFilters): Array<readonly [string, string | undefined]> {
  const common: Array<readonly [string, string | undefined]> = [
    ['关键词', request.args.keywords?.join('、')],
    ['发布时间', publishSummary(request, filters)],
    ['省市区', formatAreaSelections(filters.regionCodes)],
  ]
  if (filters.searchMode === 'proposed') {
    return [
      ['搜索类型', '拟建项目搜索'],
      ...common,
      ['项目阶段', joined(filters.proposedStages)],
      ['审批进度', joined(filters.approvalProgress)],
      ['项目总投资', amount(filters.proposedInvestmentPreset, filters.proposedInvestmentMin, filters.proposedInvestmentMax)],
    ]
  }
  const branch = filters.noticeType === 'all' ? '招投标搜索' : `招投标搜索 / ${filters.noticeType === 'ifb' ? '招标' : '中标'}`
  return [
    ['搜索类型', branch],
    ...common,
    [filters.noticeType === 'wtb' ? '中标阶段' : '招标阶段', filters.noticeType === 'all' ? undefined : joined(filters.noticeType === 'ifb' ? filters.tenderStages : filters.awardStages)],
    ['招采方式', joined(filters.procurementMethods)],
    ['行业分类', joined(filters.industries)],
    ['招采类型', joined(filters.procurementTypes)],
    ['预算金额', filters.noticeType === 'wtb' ? undefined : amount(filters.tenderAmountPreset, filters.tenderAmountMin, filters.tenderAmountMax)],
    ['中标金额', filters.noticeType === 'ifb' ? undefined : amount(filters.awardAmountPreset, filters.awardAmountMin, filters.awardAmountMax)],
  ]
}

/** Build a deterministic Agent request from an already validated MCP request. */
export function formatTenderPrompt(request: QccSearchRequest, filters: TenderFilters): string {
  const rows = supportedRows(request, filters).flatMap(([label, value]) => value === undefined ? [] : [`- ${label}：${value}`])
  return [
    '【招投标检索请求】',
    `请调用已连接的企查查招投标 MCP 工具 \`${request.tool}\` 执行查询。`,
    '请按下面的 JSON 原样构造工具参数，不要使用 Web 搜索或其他数据源替代；若该工具不可用或调用失败，请如实说明。',
    '',
    '工具参数：',
    '```json',
    JSON.stringify(request.args, null, 2),
    '```',
    '',
    '筛选摘要：',
    ...rows,
    '',
    '工具返回后，请在对话中给出一句简短结论。结构化结果将由页面直接读取 MCP 工具结果并展示，无需改写或复述完整列表。',
  ].join('\n')
}
