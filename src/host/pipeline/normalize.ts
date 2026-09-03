import { createHash } from 'node:crypto'
import {
  NormalizedDatasetV1Schema,
  OPPORTUNITY_LIFECYCLES,
  type NormalizedAmountV1Schema,
  type NormalizedDatasetSummaryV1,
  type NormalizedDatasetV1,
  type NormalizedDateV1Schema,
  type NormalizedProjectV1,
  type NormalizedRegionV1Schema,
  type NormalizedTextV1Schema,
  type OpportunityLifecycle,
} from '../../contracts/dataset.ts'
import type {
  AdaptedQccSource,
  QccProposedSourceItem,
  QccTenderSourceItem,
} from './qcc-adapters.ts'
import type { z } from 'zod'

type NormalizedAmountV1 = z.infer<typeof NormalizedAmountV1Schema>
type NormalizedDateV1 = z.infer<typeof NormalizedDateV1Schema>
type NormalizedRegionV1 = z.infer<typeof NormalizedRegionV1Schema>
type NormalizedTextV1 = z.infer<typeof NormalizedTextV1Schema>
type TenderSourceDetailsV1 = NonNullable<NormalizedProjectV1['tenderDetails']>
type ProposedSourceDetailsV1 = NonNullable<NormalizedProjectV1['proposedDetails']>

export interface NormalizeQccSourcesInput {
  readonly tender?: AdaptedQccSource<QccTenderSourceItem>
  readonly proposed?: AdaptedQccSource<QccProposedSourceItem>
  readonly sources: NormalizedDatasetSummaryV1['sources']
  readonly createdAt: string
}

interface AnnouncementCandidate {
  readonly index: number
  readonly relationKey: string
  readonly announcement: NormalizedProjectV1['announcements'][number]
}

function normalizedText(value: string | undefined): NormalizedTextV1 {
  const original = value ?? ''
  const trimmed = original.trim()
  return trimmed === ''
    ? { original, status: 'missing' }
    : { original, value: trimmed, status: 'normalized' }
}

function sourceEntities(values: readonly { readonly 企业ID: string; readonly 企业名称: string }[] | undefined) {
  return (values ?? []).map(entity => ({ id: entity.企业ID, name: entity.企业名称 }))
}

function sourceStrings(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])]
}

function tenderDetails(item: QccTenderSourceItem): TenderSourceDetailsV1 {
  return {
    infoType: normalizedText(item.信息类型),
    noticeStatus: normalizedText(item.公告子状态),
    procurementMethod: normalizedText(item.招采方式),
    procurementType: normalizedText(item.招采类型),
    industries: sourceStrings(item.标讯行业分类),
    products: sourceStrings(item.相关产品),
    agents: sourceEntities(item.代理单位),
    awardees: sourceEntities(item.中标单位),
  }
}

function proposedDetails(item: QccProposedSourceItem): ProposedSourceDetailsV1 {
  return {
    projectStage: normalizedText(item.项目阶段),
    approvalProgress: normalizedText(item.审批进度),
    approvalAuthorities: sourceEntities(item.审批单位),
  }
}

function datePartsValid(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function normalizeDate(value: string | undefined): NormalizedDateV1 {
  const original = value ?? ''
  const text = original.trim()
  const base = { original, timeZone: 'Asia/Shanghai' as const }
  if (text === '') return { ...base, precision: 'unknown', parseStatus: 'missing' }

  const fullDate = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/u.exec(text)
  if (fullDate !== null) {
    const year = Number(fullDate[1])
    const month = Number(fullDate[2])
    const day = Number(fullDate[3])
    if (datePartsValid(year, month, day)) {
      return { ...base, value: `${year}-${pad(month)}-${pad(day)}`, precision: 'date', parseStatus: 'normalized' }
    }
  }

  const monthOnly = /^(\d{4})[-/.年](\d{1,2})(?:月)?$/u.exec(text)
  if (monthOnly !== null) {
    const year = Number(monthOnly[1])
    const month = Number(monthOnly[2])
    if (month >= 1 && month <= 12) {
      return { ...base, value: `${year}-${pad(month)}`, precision: 'month', parseStatus: 'normalized' }
    }
  }

  const localDateTime = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(text)
  if (localDateTime !== null) {
    const year = Number(localDateTime[1])
    const month = Number(localDateTime[2])
    const day = Number(localDateTime[3])
    const hour = Number(localDateTime[4])
    const minute = Number(localDateTime[5])
    const second = Number(localDateTime[6] ?? 0)
    if (datePartsValid(year, month, day) && hour <= 23 && minute <= 59 && second <= 59) {
      return {
        ...base,
        value: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`,
        precision: 'date-time',
        parseStatus: 'normalized',
      }
    }
  }

  if (/^\d{4}-\d{2}-\d{2}T/u.test(text)) {
    const timestamp = Date.parse(text)
    if (Number.isFinite(timestamp)) {
      return { ...base, value: new Date(timestamp).toISOString(), precision: 'date-time', parseStatus: 'normalized' }
    }
  }
  return { ...base, precision: 'unknown', parseStatus: 'unparseable' }
}

const UNIT_MULTIPLIER: Readonly<Record<string, number>> = {
  '': 1,
  元: 1,
  万: 10_000,
  万元: 10_000,
  亿: 100_000_000,
  亿元: 100_000_000,
}

function amountNumber(value: string, unit: string): number | undefined {
  const number = Number(value.replaceAll(',', ''))
  const multiplier = UNIT_MULTIPLIER[unit]
  if (!Number.isFinite(number) || number < 0 || multiplier === undefined) return undefined
  const result = number * multiplier
  return Number.isSafeInteger(result) ? result : undefined
}

export function normalizeAmount(
  value: string | undefined,
  type: NormalizedAmountV1['type'],
): NormalizedAmountV1 {
  const original = value ?? ''
  const text = original.trim()
  if (text === '') return { original, type, parseStatus: 'missing', display: '未披露' }

  const match = /^(约|大约)?\s*([\d,.]+)\s*(亿元|万元|亿|万|元)?\s*(?:([-~～至到])\s*([\d,.]+)\s*(亿元|万元|亿|万|元)?)?\s*(以上|以下)?$/u.exec(text)
  if (match === null) return { original, type, parseStatus: 'unparseable', display: original }
  const firstUnit = match[3] ?? match[6] ?? ''
  const secondUnit = match[6] ?? firstUnit
  const first = amountNumber(match[2] ?? '', firstUnit)
  const second = match[5] === undefined ? undefined : amountNumber(match[5], secondUnit)
  if (first === undefined || (match[5] !== undefined && second === undefined)) {
    return { original, type, parseStatus: 'unparseable', display: original }
  }
  if (match[7] === '以上') {
    return { original, type, minCny: first, parseStatus: 'range', display: original }
  }
  if (match[7] === '以下') {
    return { original, type, maxCny: first, parseStatus: 'range', display: original }
  }
  if (second !== undefined) {
    return {
      original,
      type,
      minCny: Math.min(first, second),
      maxCny: Math.max(first, second),
      parseStatus: match[1] === undefined ? 'range' : 'approximate',
      display: original,
    }
  }
  return {
    original,
    type,
    minCny: first,
    maxCny: first,
    parseStatus: match[1] === undefined ? 'exact' : 'approximate',
    display: original,
  }
}

export function normalizeRegion(value: string | undefined): NormalizedRegionV1 {
  const original = value ?? ''
  const text = original.trim()
  if (text === '') return { original, parts: [], status: 'missing' }
  const parts = text.split(/\s*(?:[,，、/>&]|\s+-\s+)\s*/u).map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return { original, parts: [], status: 'unparseable' }
  return { original, value: parts.join(' / '), parts, status: 'normalized' }
}

export function tenderLifecycle(infoType: string | undefined, status: string | undefined): OpportunityLifecycle {
  const value = `${infoType ?? ''} ${status ?? ''}`
  if (/合同/u.test(value)) return 'contracted'
  if (/终止|废标|流标/u.test(value)) return 'terminated'
  if (/中标|成交|结果/u.test(value)) return 'awarded'
  if (/更正|变更|澄清|延期/u.test(value)) return 'amended'
  if (/采购意向|预告/u.test(value)) return 'early-signal'
  if (/资格预审|招标|采购公告|磋商|询价|竞谈/u.test(value)) return 'active-procurement'
  return 'unknown'
}

function sourceLink(value: { readonly 来源链接?: string; readonly 原文链接?: string; readonly 链接?: string }): string | undefined {
  return [value.来源链接, value.原文链接, value.链接]
    .find(candidate => candidate !== undefined && candidate.trim() !== '')?.trim()
}

function relationKey(
  source: 'tender' | 'proposed',
  sourceId: string,
  explicitId: string | undefined,
  projectNumber: string | undefined,
  link: string | undefined,
): string {
  const relation = explicitId?.trim()
  if (relation !== undefined && relation !== '') return `${source}:explicit:${relation}`
  const project = projectNumber?.trim()
  if (project !== undefined && project !== '') return `${source}:project-number:${project}`
  if (link !== undefined) return `${source}:source-link:${link}`
  return `${source}:source-id:${sourceId}`
}

function recordId(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32)
}

function tenderCandidates(items: readonly QccTenderSourceItem[]): AnnouncementCandidate[] {
  return items.map((item, index) => {
    const lifecycle = tenderLifecycle(item.信息类型, item.公告子状态)
    const amount = lifecycle === 'awarded' || lifecycle === 'contracted'
      ? normalizeAmount(item['中标金额（元）'] ?? item['预算金额（元）'], item['中标金额（元）'] === undefined ? 'budget' : 'award')
      : normalizeAmount(item['预算金额（元）'], 'budget')
    const parties = sourceEntities(item.招采单位)
    const link = sourceLink(item)
    return {
      index,
      relationKey: relationKey('tender', item.标讯ID, item.关联项目ID ?? item.项目ID, item.项目编号, link),
      announcement: {
        sourceRecordId: item.标讯ID,
        title: item.标题,
        lifecycle,
        stage: normalizedText(item.公告子状态 ?? item.信息类型),
        projectNumber: normalizedText(item.项目编号),
        region: normalizeRegion(item.省市区),
        amount,
        publishedAt: normalizeDate(item.发布时间),
        deadline: normalizeDate(item.投标截止时间),
        parties,
        tenderDetails: tenderDetails(item),
        ...(link === undefined ? {} : { sourceLink: link }),
      },
    }
  })
}

function proposedCandidates(items: readonly QccProposedSourceItem[]): AnnouncementCandidate[] {
  return items.map((item, index) => {
    const parties = sourceEntities(item.建设单位)
    const link = sourceLink(item)
    return {
      index,
      relationKey: relationKey('proposed', item.拟建项目ID, item.关联项目ID, item.项目编号, link),
      announcement: {
        sourceRecordId: item.拟建项目ID,
        title: item.项目名称,
        lifecycle: 'early-signal',
        stage: normalizedText(item.项目阶段 ?? item.审批进度),
        projectNumber: normalizedText(item.项目编号),
        region: normalizeRegion(item.省市区),
        amount: normalizeAmount(item['项目总投资（元）'], 'total-investment'),
        publishedAt: normalizeDate(item.发布时间),
        parties,
        proposedDetails: proposedDetails(item),
        ...(link === undefined ? {} : { sourceLink: link }),
      },
    }
  })
}

function announcementOrder(left: AnnouncementCandidate, right: AnnouncementCandidate): number {
  const leftDate = left.announcement.publishedAt.value
  const rightDate = right.announcement.publishedAt.value
  if (leftDate !== undefined && rightDate !== undefined && leftDate !== rightDate) return leftDate.localeCompare(rightDate)
  if (leftDate !== undefined && rightDate === undefined) return 1
  if (leftDate === undefined && rightDate !== undefined) return -1
  return left.index - right.index
}

function fieldIssues(current: NormalizedProjectV1['announcements'][number], source: 'tender' | 'proposed') {
  const missingFields: string[] = []
  const unparseableFields: string[] = []
  const textFields: readonly [string, NormalizedTextV1 | NormalizedRegionV1][] = [
    ['项目编号', current.projectNumber],
    ['地区', current.region],
    ['采购人/建设单位', current.parties.length === 0 ? normalizedText(undefined) : normalizedText(current.parties.map(party => party.name).join('、'))],
    ['阶段', current.stage],
  ]
  textFields.forEach(([name, field]) => {
    if (field.status === 'missing') missingFields.push(name)
    if (field.status === 'unparseable') unparseableFields.push(name)
  })
  if (current.amount.parseStatus === 'missing') missingFields.push(source === 'tender' ? '预算/中标金额' : '项目总投资')
  if (current.amount.parseStatus === 'unparseable') unparseableFields.push(source === 'tender' ? '预算/中标金额' : '项目总投资')
  if (current.publishedAt.parseStatus === 'missing') missingFields.push('发布时间')
  if (current.publishedAt.parseStatus === 'unparseable') unparseableFields.push('发布时间')
  if (source === 'tender' && current.deadline !== undefined) {
    if (current.deadline.parseStatus === 'missing') missingFields.push('投标截止时间')
    if (current.deadline.parseStatus === 'unparseable') unparseableFields.push('投标截止时间')
  }
  if (current.lifecycle === 'unknown') unparseableFields.push('公告生命周期')
  return { missingFields, unparseableFields }
}

function projectsFromCandidates(
  source: 'tender' | 'proposed',
  candidates: readonly AnnouncementCandidate[],
): NormalizedProjectV1[] {
  const groups = new Map<string, AnnouncementCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.relationKey)
    if (group === undefined) groups.set(candidate.relationKey, [candidate])
    else group.push(candidate)
  }
  return [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort(announcementOrder)
    const newest = ordered.at(-1)?.announcement
    if (newest === undefined) throw new Error('normalization group unexpectedly empty')
    const newestAnnouncement = newest
    const announcements = ordered.map(candidate => candidate.announcement)
    const newestDisclosed = <T>(select: (announcement: typeof newestAnnouncement) => T, disclosed: (value: T) => boolean): T => {
      for (let index = announcements.length - 1; index >= 0; index -= 1) {
        const announcement = announcements[index]
        if (announcement === undefined) continue
        const value = select(announcement)
        if (disclosed(value)) return value
      }
      return select(newestAnnouncement)
    }
    const projectNumber = newestDisclosed(announcement => announcement.projectNumber, value => value.status !== 'missing')
    const region = newestDisclosed(announcement => announcement.region, value => value.status !== 'missing')
    const amount = newestDisclosed(announcement => announcement.amount, value => value.parseStatus !== 'missing')
    const parties = newestDisclosed(announcement => announcement.parties, value => value.length > 0)
    const deadline = source === 'tender'
      ? newestDisclosed(announcement => announcement.deadline, value => value !== undefined && value.parseStatus !== 'missing')
      : undefined
    const effective = {
      ...newest,
      projectNumber,
      region,
      amount,
      parties,
      ...(deadline === undefined ? {} : { deadline }),
    }
    const counterparty = normalizedText(parties.map(party => party.name).filter(Boolean).join('、'))
    const selectedTenderDetails = source === 'tender'
      ? {
          infoType: newestDisclosed(
            announcement => announcement.tenderDetails?.infoType ?? normalizedText(undefined),
            value => value.status !== 'missing',
          ),
          noticeStatus: newestDisclosed(
            announcement => announcement.tenderDetails?.noticeStatus ?? normalizedText(undefined),
            value => value.status !== 'missing',
          ),
          procurementMethod: newestDisclosed(
            announcement => announcement.tenderDetails?.procurementMethod ?? normalizedText(undefined),
            value => value.status !== 'missing',
          ),
          procurementType: newestDisclosed(
            announcement => announcement.tenderDetails?.procurementType ?? normalizedText(undefined),
            value => value.status !== 'missing',
          ),
          industries: newestDisclosed(
            announcement => announcement.tenderDetails?.industries ?? [],
            value => value.length > 0,
          ),
          products: newestDisclosed(
            announcement => announcement.tenderDetails?.products ?? [],
            value => value.length > 0,
          ),
          agents: newestDisclosed(
            announcement => announcement.tenderDetails?.agents ?? [],
            value => value.length > 0,
          ),
          awardees: newestDisclosed(
            announcement => announcement.tenderDetails?.awardees ?? [],
            value => value.length > 0,
          ),
        } satisfies TenderSourceDetailsV1
      : undefined
    const selectedProposedDetails = source === 'proposed'
      ? {
          projectStage: newestDisclosed(
            announcement => announcement.proposedDetails?.projectStage ?? normalizedText(undefined),
            value => value.status !== 'missing',
          ),
          approvalProgress: newestDisclosed(
            announcement => announcement.proposedDetails?.approvalProgress ?? normalizedText(undefined),
            value => value.status !== 'missing',
          ),
          approvalAuthorities: newestDisclosed(
            announcement => announcement.proposedDetails?.approvalAuthorities ?? [],
            value => value.length > 0,
          ),
        } satisfies ProposedSourceDetailsV1
      : undefined
    return {
      schemaVersion: 1,
      recordId: recordId(key),
      source,
      sourceId: newest.sourceRecordId,
      title: newest.title,
      lifecycle: newest.lifecycle,
      dataDisposition: 'normalized',
      stage: newest.stage,
      projectNumber,
      region,
      counterparty,
      amount,
      publishedAt: newest.publishedAt,
      ...(deadline === undefined ? {} : { deadline }),
      ...(selectedTenderDetails === undefined ? {} : { tenderDetails: selectedTenderDetails }),
      ...(selectedProposedDetails === undefined ? {} : { proposedDetails: selectedProposedDetails }),
      announcements,
      disclosure: fieldIssues(effective, source),
    }
  })
}

function lifecycleCounts(rows: readonly NormalizedProjectV1[]): NormalizedDatasetSummaryV1['lifecycleCounts'] {
  const counts = Object.fromEntries(OPPORTUNITY_LIFECYCLES.map(lifecycle => [lifecycle, 0])) as Record<OpportunityLifecycle, number>
  rows.forEach(row => { counts[row.lifecycle] += 1 })
  return counts
}

function regionDistribution(rows: readonly NormalizedProjectV1[]): NormalizedDatasetSummaryV1['regions'] {
  const counts = new Map<string, number>()
  rows.forEach(row => {
    if (row.region.value === undefined) return
    counts.set(row.region.value, (counts.get(row.region.value) ?? 0) + 1)
  })
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
    .slice(0, 100)
}

export function normalizeQccSources(input: NormalizeQccSourcesInput): NormalizedDatasetV1 {
  const tenderRows = input.tender === undefined
    ? []
    : projectsFromCandidates('tender', tenderCandidates(input.tender.items))
  const proposedRows = input.proposed === undefined
    ? []
    : projectsFromCandidates('proposed', proposedCandidates(input.proposed.items))
  const rows = [...tenderRows, ...proposedRows]
  const invalidRecords = [
    ...(input.tender?.invalidRecords ?? []),
    ...(input.proposed?.invalidRecords ?? []),
  ]
  const rawRecordCount = (input.tender?.rawRecordCount ?? 0) + (input.proposed?.rawRecordCount ?? 0)
  const validRecordCount = (input.tender?.items.length ?? 0) + (input.proposed?.items.length ?? 0)
  const summary: NormalizedDatasetSummaryV1 = {
    rawRecordCount,
    validRecordCount,
    normalizedProjectCount: rows.length,
    linkedRecordCount: Math.max(0, validRecordCount - rows.length),
    invalidRecordCount: invalidRecords.length,
    missingFieldCount: rows.reduce((sum, row) => sum + row.disclosure.missingFields.length, 0),
    unparseableFieldCount: rows.reduce((sum, row) => sum + row.disclosure.unparseableFields.length, 0),
    sources: input.sources,
    lifecycleCounts: lifecycleCounts(rows),
    regions: regionDistribution(rows),
  }
  return NormalizedDatasetV1Schema.parse({
    schemaVersion: 1,
    createdAt: input.createdAt,
    rows,
    invalidRecords,
    summary,
  })
}
