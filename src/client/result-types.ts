import type { QccSearchTool } from './qcc-request.ts'

export interface SearchSummary {
  readonly total: number
  readonly description: string
  readonly filters: Readonly<Record<string, unknown>>
}

export interface SearchEntity {
  readonly id: string
  readonly name: string
}

export interface TenderItem {
  readonly id: string
  readonly title: string
  readonly infoType: string
  readonly status: string
  readonly region: string
  readonly purchasers: readonly SearchEntity[]
  readonly agencies: readonly SearchEntity[]
  readonly winners: readonly SearchEntity[]
  readonly procurementMethod: string
  readonly procurementType: string
  readonly industries: readonly string[]
  readonly projectNumber: string
  readonly budgetAmount: string
  readonly winningAmount: string
  readonly publishedAt: string
  readonly deadline: string
  readonly products: readonly string[]
}

export interface ProposedItem {
  readonly id: string
  readonly title: string
  readonly stage: string
  readonly approvalStatus: string
  readonly region: string
  readonly investmentAmount: string
  readonly publishedAt: string
  readonly builders: readonly SearchEntity[]
  readonly approvers: readonly SearchEntity[]
  readonly projectNumber: string
}

export type TenderSearchResult =
  | { readonly kind: 'tender'; readonly summary: SearchSummary; readonly items: readonly TenderItem[]; readonly invalidItemCount: number }
  | { readonly kind: 'proposed'; readonly summary: SearchSummary; readonly items: readonly ProposedItem[]; readonly invalidItemCount: number }

interface SearchCallBase {
  readonly callId: string
  readonly tool: QccSearchTool
  readonly argsRaw: string
}

export type TenderSearchCall =
  | SearchCallBase & { readonly status: 'running' }
  | SearchCallBase & { readonly status: 'success'; readonly seq: number; readonly result: TenderSearchResult }
  | SearchCallBase & { readonly status: 'error'; readonly seq: number; readonly message: string }
  | SearchCallBase & { readonly status: 'incompatible'; readonly seq: number; readonly reason: string; readonly rawPreview: string }

export interface TenderSearchTurnData {
  readonly turn: number
  readonly calls: readonly TenderSearchCall[]
  readonly lastResultSeq?: number
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Persisted qcc-tender search calls and results scoped to one Turn. */
    readonly 'tender-search': TenderSearchTurnData
  }
}
