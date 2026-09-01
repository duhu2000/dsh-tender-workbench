import { describe, expect, it } from 'vitest'
import { createInitialTenderFilters } from '../src/client/types.ts'
import { validateTenderFilters } from '../src/client/validation.ts'

describe('validateTenderFilters', () => {
  it('requires at least one custom date and rejects reversed ranges', () => {
    const initial = createInitialTenderFilters()
    expect(validateTenderFilters({ ...initial, publishPreset: 'custom' })).toEqual({ dates: 'required' })
    expect(validateTenderFilters({ ...initial, publishPreset: 'custom', startDate: '2026-02-01', endDate: '2026-01-01' }))
      .toEqual({ dates: 'order' })
  })

  it('accepts numeric tender amounts and rejects malformed or reversed ranges', () => {
    const initial = createInitialTenderFilters()
    expect(validateTenderFilters({ ...initial, tenderAmountMin: '500' })).toEqual({})
    expect(validateTenderFilters({ ...initial, tenderAmountMin: '100', tenderAmountMax: '500' })).toEqual({})
    expect(validateTenderFilters({ ...initial, tenderAmountMin: '很多' })).toEqual({ amount: 'invalid' })
    expect(validateTenderFilters({ ...initial, tenderAmountMin: '500', tenderAmountMax: '100' })).toEqual({ amount: 'order' })
  })

  it('validates both amount ranges in combined mode and only the selected branch otherwise', () => {
    const initial = createInitialTenderFilters()
    expect(validateTenderFilters({ ...initial, awardAmountMin: '500', awardAmountMax: '100' }))
      .toEqual({ amount: 'order' })
    expect(validateTenderFilters({ ...initial, noticeType: 'ifb', awardAmountMin: 'invalid' })).toEqual({})
    expect(validateTenderFilters({ ...initial, noticeType: 'wtb', tenderAmountMin: 'invalid' })).toEqual({})
  })

  it('validates only the active search mode amount range', () => {
    const filters = {
      ...createInitialTenderFilters(),
      searchMode: 'proposed' as const,
      tenderAmountMin: 'invalid',
      awardAmountMin: 'invalid',
      proposedInvestmentMin: '1000',
      proposedInvestmentMax: '500',
    }
    expect(validateTenderFilters(filters)).toEqual({ amount: 'order' })
  })
})
