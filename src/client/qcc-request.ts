import { getAreaRecord, isMcpSupportedAreaValue } from './area-utils.ts'
import type { PublishPreset, TenderFilters } from './types.ts'
import {
  QCC_PROPOSED_SEARCH_TOOL,
  QCC_TENDER_SEARCH_TOOL,
  type QccProposedSearchArgs,
  type QccSearchRequest,
  type QccTenderSearchArgs,
} from '../contracts/query.ts'

export { QCC_PROPOSED_SEARCH_TOOL, QCC_TENDER_SEARCH_TOOL }
export type { QccProposedSearchArgs, QccSearchRequest, QccSearchTool, QccTenderSearchArgs } from '../contracts/query.ts'

export type QccRequestErrorCode =
  | 'keywords-limit'
  | 'regions-limit'
  | 'unsupported-region'
  | 'no-supported-filter'

export class QccRequestValidationError extends Error {
  constructor(readonly code: QccRequestErrorCode) {
    super(code)
    this.name = 'QccRequestValidationError'
  }
}

const PROCUREMENT_METHOD_MAP: Readonly<Record<string, string>> = {
  竞谈: '竞争性谈判',
  竞磋: '竞争性磋商',
}

const TEN_THOUSAND = 10_000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day))
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function todayUtc(now: Date): Date {
  return calendarDate(now.getFullYear(), now.getMonth(), now.getDate())
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function shiftMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const day = date.getUTCDate()
  const first = calendarDate(year, month, 1)
  const lastDay = calendarDate(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getUTCDate()
  return calendarDate(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))
}

function shiftYears(date: Date, years: number): Date {
  return shiftMonths(date, years * 12)
}

function validDateText(value: string | undefined): value is string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value)
}

function dateArgs(filters: TenderFilters, now: Date): Pick<QccTenderSearchArgs, 'beginDate' | 'endDate'> {
  const today = todayUtc(now)
  const relative: Partial<Record<Exclude<PublishPreset, 'all' | 'custom' | 'year'>, Date>> = {
    today,
    '3d': shiftDays(today, -3),
    '7d': shiftDays(today, -7),
    '1m': shiftMonths(today, -1),
    '3m': shiftMonths(today, -3),
    '6m': shiftMonths(today, -6),
    '1y': shiftYears(today, -1),
    '3y': shiftYears(today, -3),
    '5y': shiftYears(today, -5),
  }
  if (filters.publishPreset === 'all') return {}
  if (filters.publishPreset === 'year') {
    return filters.publishYear === undefined
      ? {}
      : { beginDate: `${filters.publishYear - 1}-12-31`, endDate: `${filters.publishYear + 1}-01-01` }
  }
  if (filters.publishPreset === 'custom') {
    const start = validDateText(filters.startDate) ? filters.startDate : undefined
    const end = validDateText(filters.endDate) ? filters.endDate : undefined
    if (start !== undefined && end !== undefined) {
      return {
        beginDate: formatDate(shiftDays(calendarDate(...dateParts(start)), -1)),
        endDate: formatDate(shiftDays(calendarDate(...dateParts(end)), 1)),
      }
    }
    return { ...(start === undefined ? {} : { beginDate: start }), ...(end === undefined ? {} : { endDate: end }) }
  }
  const begin = relative[filters.publishPreset]
  return begin === undefined ? {} : { beginDate: formatDate(begin) }
}

function dateParts(value: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return [year, month - 1, day]
}

export function splitKeywords(value: string): string[] {
  return value.trim() === '' ? [] : value.trim().split(/\s+/u).filter(Boolean)
}

function regions(filters: TenderFilters): string[] {
  if (filters.regionCodes.length > 20) throw new QccRequestValidationError('regions-limit')
  return filters.regionCodes.map((value) => {
    const record = getAreaRecord(value)
    if (record === undefined || !isMcpSupportedAreaValue(value)) {
      throw new QccRequestValidationError('unsupported-region')
    }
    return record.path.map(option => option.label).join('')
  })
}

interface AmountBounds {
  readonly min?: number
  readonly max?: number
}

const AMOUNT_PRESETS: Readonly<Record<string, AmountBounds>> = {
  '20万内': { max: 20 * TEN_THOUSAND },
  '20万-50万': { min: 20 * TEN_THOUSAND, max: 50 * TEN_THOUSAND },
  '50万-100万': { min: 50 * TEN_THOUSAND, max: 100 * TEN_THOUSAND },
  '100万-300万': { min: 100 * TEN_THOUSAND, max: 300 * TEN_THOUSAND },
  '300万以上': { min: 300 * TEN_THOUSAND },
  '100万内': { max: 100 * TEN_THOUSAND },
  '100万-500万': { min: 100 * TEN_THOUSAND, max: 500 * TEN_THOUSAND },
  '500万-1000万': { min: 500 * TEN_THOUSAND, max: 1_000 * TEN_THOUSAND },
  '1000万-5000万': { min: 1_000 * TEN_THOUSAND, max: 5_000 * TEN_THOUSAND },
  '5000万-1亿': { min: 5_000 * TEN_THOUSAND, max: 100_000_000 },
  '1亿以上': { min: 100_000_000 },
}

function amountBounds(preset: string | undefined, minimum: string | undefined, maximum: string | undefined): AmountBounds {
  if (preset !== undefined) return AMOUNT_PRESETS[preset] ?? {}
  const min = minimum?.trim()
  const max = maximum?.trim()
  return {
    ...(min === undefined || min === '' ? {} : { min: Number(min) * TEN_THOUSAND }),
    ...(max === undefined || max === '' ? {} : { max: Number(max) * TEN_THOUSAND }),
  }
}

function commonArgs(filters: TenderFilters, now: Date): Pick<QccTenderSearchArgs, 'keywords' | 'beginDate' | 'endDate' | 'regions'> {
  const keywords = splitKeywords(filters.keywords)
  if (keywords.length > 10) throw new QccRequestValidationError('keywords-limit')
  const selectedRegions = regions(filters)
  return {
    ...(keywords.length === 0 ? {} : { keywords }),
    ...dateArgs(filters, now),
    ...(selectedRegions.length === 0 ? {} : { regions: selectedRegions }),
  }
}

function nonEmpty(value: object): void {
  if (Object.keys(value).length === 0) throw new QccRequestValidationError('no-supported-filter')
}

/** Deterministically map visible UI state to the two supported qcc-tender search Schemas. */
export function toQccSearchRequest(filters: TenderFilters, now: Date): QccSearchRequest {
  const common = commonArgs(filters, now)
  if (filters.searchMode === 'proposed') {
    const investment = amountBounds(filters.proposedInvestmentPreset, filters.proposedInvestmentMin, filters.proposedInvestmentMax)
    const args: QccProposedSearchArgs = {
      ...common,
      ...(filters.proposedStages.length === 0 ? {} : { projectStages: filters.proposedStages }),
      ...(filters.approvalProgress.length === 0 ? {} : { approvalStatuses: filters.approvalProgress }),
      ...(investment.min === undefined ? {} : { investmentMin: investment.min }),
      ...(investment.max === undefined ? {} : { investmentMax: investment.max }),
    }
    nonEmpty(args)
    return { tool: QCC_PROPOSED_SEARCH_TOOL, args }
  }

  const budget = amountBounds(filters.tenderAmountPreset, filters.tenderAmountMin, filters.tenderAmountMax)
  const winning = amountBounds(filters.awardAmountPreset, filters.awardAmountMin, filters.awardAmountMax)
  const bidStatuses = filters.noticeType === 'ifb'
    ? filters.tenderStages.map(value => value === '变更' ? '招标变更' : value)
    : filters.noticeType === 'wtb'
      ? filters.awardStages.map(value => value === '变更' ? '中标变更' : value)
      : []
  const procurementMethods = filters.procurementMethods.map(value => PROCUREMENT_METHOD_MAP[value] ?? value)
  const args: QccTenderSearchArgs = {
    ...common,
    ...(filters.noticeType === 'all' ? {} : { infoTypes: [filters.noticeType === 'ifb' ? '招标公告' : '中标公告'] }),
    ...(bidStatuses.length === 0 ? {} : { bidStatuses }),
    ...(procurementMethods.length === 0 ? {} : { procurementMethods }),
    ...(filters.procurementTypes.length === 0 ? {} : { procurementTypes: filters.procurementTypes as QccTenderSearchArgs['procurementTypes'] }),
    ...(filters.industries.length === 0 ? {} : { TenderIndustries: filters.industries }),
    ...(filters.noticeType === 'wtb' || budget.min === undefined ? {} : { budgetMin: budget.min }),
    ...(filters.noticeType === 'wtb' || budget.max === undefined ? {} : { budgetMax: budget.max }),
    ...(filters.noticeType === 'ifb' || winning.min === undefined ? {} : { winningAmountMin: winning.min }),
    ...(filters.noticeType === 'ifb' || winning.max === undefined ? {} : { winningAmountMax: winning.max }),
  }
  nonEmpty(args)
  return { tool: QCC_TENDER_SEARCH_TOOL, args }
}
