import type { ProposedItem, SearchEntity, SearchSummary, TenderItem, TenderSearchResult } from './result-types.ts'

export class ResultContractError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ResultContractError'
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined
}

function entities(value: unknown): readonly SearchEntity[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: SearchEntity[] = []
  for (const item of value) {
    if (!record(item) || typeof item['企业ID'] !== 'string' || typeof item['企业名称'] !== 'string') return undefined
    result.push({ id: item['企业ID'], name: item['企业名称'] })
  }
  return result
}

function summary(value: unknown): SearchSummary {
  if (!record(value) || typeof value['命中总数'] !== 'number' || typeof value['结果说明'] !== 'string' || !record(value['生效筛选'])) {
    throw new ResultContractError('invalid-summary')
  }
  return { total: value['命中总数'], description: value['结果说明'], filters: value['生效筛选'] }
}

function tenderItem(value: unknown): TenderItem | undefined {
  if (!record(value)) return undefined
  const id = requiredString(value['标讯ID'])
  const title = requiredString(value['标题'])
  const purchasers = entities(value['招采单位'])
  const agencies = entities(value['代理单位'])
  const winners = entities(value['中标单位'])
  const industries = strings(value['标讯行业分类'])
  const products = strings(value['相关产品'])
  if (id === undefined || title === undefined || purchasers === undefined || agencies === undefined || winners === undefined || industries === undefined || products === undefined) return undefined
  return {
    id, title,
    infoType: string(value['信息类型']), status: string(value['公告子状态']), region: string(value['省市区']),
    purchasers, agencies, winners,
    procurementMethod: string(value['招采方式']), procurementType: string(value['招采类型']), industries,
    projectNumber: string(value['项目编号']), budgetAmount: string(value['预算金额（元）']), winningAmount: string(value['中标金额（元）']),
    publishedAt: string(value['发布时间']), deadline: string(value['投标截止时间']), products,
  }
}

function proposedItem(value: unknown): ProposedItem | undefined {
  if (!record(value)) return undefined
  const id = requiredString(value['拟建项目ID'])
  const title = requiredString(value['项目名称'])
  const builders = entities(value['建设单位'])
  const approvers = entities(value['审批单位'])
  if (id === undefined || title === undefined || builders === undefined || approvers === undefined) return undefined
  return {
    id, title, stage: string(value['项目阶段']), approvalStatus: string(value['审批进度']), region: string(value['省市区']),
    investmentAmount: string(value['项目总投资（元）']), publishedAt: string(value['发布时间']), builders, approvers,
    projectNumber: string(value['项目编号']),
  }
}

function adaptList<T>(value: unknown, adapt: (item: unknown) => T | undefined): { readonly items: readonly T[]; readonly invalidItemCount: number } {
  if (!Array.isArray(value)) throw new ResultContractError('invalid-list')
  const items = value.map(adapt).filter((item): item is T => item !== undefined)
  return { items, invalidItemCount: value.length - items.length }
}

export function adaptTenderSearchPayload(value: unknown): TenderSearchResult {
  if (!record(value)) throw new ResultContractError('invalid-payload')
  const list = adaptList(value['标讯列表'], tenderItem)
  return { kind: 'tender', summary: summary(value['查询摘要']), ...list }
}

export function adaptProposedSearchPayload(value: unknown): TenderSearchResult {
  if (!record(value)) throw new ResultContractError('invalid-payload')
  const list = adaptList(value['拟建项目列表'], proposedItem)
  return { kind: 'proposed', summary: summary(value['查询摘要']), ...list }
}

export function dedupeTenderItems(items: readonly TenderItem[]): readonly TenderItem[] {
  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
}

export function dedupeProposedItems(items: readonly ProposedItem[]): readonly ProposedItem[] {
  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
}
