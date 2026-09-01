import { QccRequestValidationError, toQccSearchRequest } from './qcc-request.ts'
import type { TenderFilters } from './types.ts'

export interface TenderValidationErrors {
  readonly dates?: 'required' | 'order'
  readonly amount?: 'invalid' | 'order'
  readonly keywords?: 'limit'
  readonly regions?: 'limit' | 'unsupported'
  readonly supported?: 'required'
  readonly request?: 'invalid'
}

const AMOUNT = /^\d+(?:\.\d+)?$/u

function activeAmounts(filters: TenderFilters): ReadonlyArray<readonly [string | undefined, string | undefined, string | undefined]> {
  if (filters.searchMode === 'proposed') return [[filters.proposedInvestmentPreset, filters.proposedInvestmentMin, filters.proposedInvestmentMax]]
  const tender = [filters.tenderAmountPreset, filters.tenderAmountMin, filters.tenderAmountMax] as const
  const award = [filters.awardAmountPreset, filters.awardAmountMin, filters.awardAmountMax] as const
  if (filters.noticeType === 'ifb') return [tender]
  if (filters.noticeType === 'wtb') return [award]
  return [tender, award]
}

/** Validate UI relations and every qcc-tender limit before writing the draft. */
export function validateTenderFilters(filters: TenderFilters, now = new Date()): TenderValidationErrors {
  const errors: { dates?: 'required' | 'order'; amount?: 'invalid' | 'order'; keywords?: 'limit'; regions?: 'limit' | 'unsupported'; supported?: 'required'; request?: 'invalid' } = {}
  if (filters.publishPreset === 'custom') {
    if (filters.startDate === undefined && filters.endDate === undefined) errors.dates = 'required'
    else if (filters.startDate !== undefined && filters.endDate !== undefined && filters.endDate < filters.startDate) errors.dates = 'order'
  }
  for (const [preset, rawMinimum, rawMaximum] of activeAmounts(filters)) {
    if (preset !== undefined) continue
    const minimum = rawMinimum?.trim()
    const maximum = rawMaximum?.trim()
    if ((minimum !== undefined && minimum !== '' && !AMOUNT.test(minimum)) || (maximum !== undefined && maximum !== '' && !AMOUNT.test(maximum))) {
      errors.amount = 'invalid'
      break
    }
    if (minimum !== undefined && minimum !== '' && maximum !== undefined && maximum !== '' && Number(maximum) < Number(minimum)) {
      errors.amount = 'order'
      break
    }
  }
  if (Object.keys(errors).length !== 0) return errors
  try {
    toQccSearchRequest(filters, now)
  } catch (error) {
    if (error instanceof QccRequestValidationError) {
      if (error.code === 'keywords-limit') errors.keywords = 'limit'
      else if (error.code === 'regions-limit') errors.regions = 'limit'
      else if (error.code === 'unsupported-region') errors.regions = 'unsupported'
      else errors.supported = 'required'
    } else errors.request = 'invalid'
  }
  return errors
}
