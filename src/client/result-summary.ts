import { dedupeProposedItems, dedupeTenderItems } from './result-adapters.ts'
import type { ProposedItem, TenderItem, TenderSearchCall } from './result-types.ts'

export interface DistributionItem {
  readonly label: string
  readonly count: number
}

export interface LoadedTenderSummary {
  readonly loadedCount: number
  readonly invalidItemCount: number
  readonly regions: readonly DistributionItem[]
  readonly amountPresent: number
  readonly infoTypes?: readonly DistributionItem[]
  readonly statuses?: readonly DistributionItem[]
  readonly nearestPendingDeadline?: string
  readonly stages?: readonly DistributionItem[]
  readonly approvalStatuses?: readonly DistributionItem[]
}

export interface MergedTurnResults {
  readonly tenders: readonly TenderItem[]
  readonly proposed: readonly ProposedItem[]
  readonly successCalls: readonly Extract<TenderSearchCall, { readonly status: 'success' }>[]
  readonly failures: readonly Exclude<TenderSearchCall, { readonly status: 'running' | 'success' }>[]
  readonly invalidItemCount: number
}

export function mergeTurnSearchResults(calls: readonly TenderSearchCall[]): MergedTurnResults {
  const successCalls = calls.filter((call): call is Extract<TenderSearchCall, { readonly status: 'success' }> => call.status === 'success').sort((left, right) => left.seq - right.seq)
  const failures = calls.filter((call): call is Exclude<TenderSearchCall, { readonly status: 'running' | 'success' }> => call.status === 'error' || call.status === 'incompatible')
  return {
    tenders: dedupeTenderItems(successCalls.flatMap(call => call.result.kind === 'tender' ? call.result.items : [])),
    proposed: dedupeProposedItems(successCalls.flatMap(call => call.result.kind === 'proposed' ? call.result.items : [])),
    successCalls,
    failures,
    invalidItemCount: successCalls.reduce((sum, call) => sum + call.result.invalidItemCount, 0),
  }
}

function distribution(values: readonly string[]): readonly DistributionItem[] {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const value = raw.trim() || '未标注'
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
}

function dateValue(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Statistics are intentionally limited to the entries loaded in this Turn. */
export function deriveLoadedSummary(merged: MergedTurnResults, now = new Date()): LoadedTenderSummary {
  if (merged.tenders.length > 0 || merged.proposed.length === 0) {
    const pending = merged.tenders
      .map(item => ({ text: item.deadline, value: dateValue(item.deadline) }))
      .filter((item): item is { readonly text: string; readonly value: number } => item.value !== undefined && item.value > now.getTime())
      .sort((left, right) => left.value - right.value)[0]
    return {
      loadedCount: merged.tenders.length,
      invalidItemCount: merged.invalidItemCount,
      regions: distribution(merged.tenders.map(item => item.region)),
      amountPresent: merged.tenders.filter(item => item.budgetAmount.trim() !== '' || item.winningAmount.trim() !== '').length,
      infoTypes: distribution(merged.tenders.map(item => item.infoType)),
      statuses: distribution(merged.tenders.map(item => item.status)),
      ...(pending === undefined ? {} : { nearestPendingDeadline: pending.text }),
    }
  }
  return {
    loadedCount: merged.proposed.length,
    invalidItemCount: merged.invalidItemCount,
    regions: distribution(merged.proposed.map(item => item.region)),
    amountPresent: merged.proposed.filter(item => item.investmentAmount.trim() !== '').length,
    stages: distribution(merged.proposed.map(item => item.stage)),
    approvalStatuses: distribution(merged.proposed.map(item => item.approvalStatus)),
  }
}
