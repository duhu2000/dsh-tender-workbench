/** Supported top-level search modes. */
export type SearchMode = 'tender' | 'proposed'

/** Tender announcement branches mirrored from the reference search pages. */
export type TenderNoticeType = 'all' | 'ifb' | 'wtb'

/** Supported publication-time presets. */
export type PublishPreset =
  | 'all'
  | 'today'
  | '3d'
  | '7d'
  | '1m'
  | '3m'
  | '6m'
  | '1y'
  | '3y'
  | '5y'
  | 'year'
  | 'custom'

/** Editable query state retained by one Session-scoped entry. */
export interface TenderFilters {
  searchMode: SearchMode
  noticeType: TenderNoticeType
  keywords: string
  publishPreset: PublishPreset
  publishYear?: number
  startDate?: string
  endDate?: string
  regionCodes: string[]
  tenderStages: string[]
  awardStages: string[]
  proposedStages: string[]
  approvalProgress: string[]
  procurementMethods: string[]
  industries: string[]
  procurementTypes: string[]
  tenderAmountPreset?: string
  tenderAmountMin?: string
  tenderAmountMax?: string
  awardAmountPreset?: string
  awardAmountMin?: string
  awardAmountMax?: string
  proposedInvestmentPreset?: string
  proposedInvestmentMin?: string
  proposedInvestmentMax?: string
}

/** Create fresh filter state so Session entries never share mutable arrays. */
export function createInitialTenderFilters(): TenderFilters {
  return {
    searchMode: 'tender',
    noticeType: 'all',
    keywords: '',
    publishPreset: '3m',
    regionCodes: [],
    tenderStages: [],
    awardStages: [],
    proposedStages: [],
    approvalProgress: [],
    procurementMethods: [],
    industries: [],
    procurementTypes: [],
  }
}

/** Initial values exposed for pure-function tests and consumers inside the plugin. */
export const initialTenderFilters: Readonly<TenderFilters> = createInitialTenderFilters()
