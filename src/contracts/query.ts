export const QCC_TENDER_SEARCH_TOOL = 'mcp__qcc-tender__search_tenders' as const
export const QCC_PROPOSED_SEARCH_TOOL = 'mcp__qcc-tender__search_proposed_projects' as const
export type QccSearchTool = typeof QCC_TENDER_SEARCH_TOOL | typeof QCC_PROPOSED_SEARCH_TOOL

export interface QccTenderSearchArgs {
  readonly keywords?: readonly string[]
  readonly infoTypes?: readonly ('招标公告' | '中标公告')[]
  readonly bidStatuses?: readonly string[]
  readonly beginDate?: string
  readonly endDate?: string
  readonly regions?: readonly string[]
  readonly procurementMethods?: readonly string[]
  readonly procurementTypes?: readonly ('货物' | '工程' | '服务')[]
  readonly TenderIndustries?: readonly string[]
  readonly budgetMin?: number
  readonly budgetMax?: number
  readonly winningAmountMin?: number
  readonly winningAmountMax?: number
  readonly smartSort?: boolean
}

export interface QccProposedSearchArgs {
  readonly keywords?: readonly string[]
  readonly beginDate?: string
  readonly endDate?: string
  readonly regions?: readonly string[]
  readonly projectStages?: readonly string[]
  readonly approvalStatuses?: readonly string[]
  readonly investmentMin?: number
  readonly investmentMax?: number
}

export type QccSearchRequest =
  | { readonly tool: typeof QCC_TENDER_SEARCH_TOOL; readonly args: QccTenderSearchArgs }
  | { readonly tool: typeof QCC_PROPOSED_SEARCH_TOOL; readonly args: QccProposedSearchArgs }

