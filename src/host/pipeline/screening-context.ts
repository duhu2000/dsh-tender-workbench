import { createHash } from 'node:crypto'
import type { NormalizedDatasetV1 } from '../../contracts/dataset.ts'
import type { RunQueryToolInputV2 } from '../../contracts/tool-inputs.ts'
import {
  ScreeningDraftContextV1Schema,
  type ScreeningDraftContextV1,
} from '../../contracts/screening.ts'

/** Derive the only bounded Agent drafting context from an active normalized snapshot. */
export function createScreeningDraftContext(input: {
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly intent: RunQueryToolInputV2
  readonly dataset: NormalizedDatasetV1
}): ScreeningDraftContextV1 {
  const ordered = [...input.dataset.rows].sort((left, right) => (
    left.source.localeCompare(right.source) || left.recordId.localeCompare(right.recordId)
  ))
  const content = {
    activeDatasetRef: input.activeDatasetRef,
    projectionRevision: input.projectionRevision,
    targetSummary: input.intent.target,
    query: {
      scope: input.intent.scope,
      target: input.intent.target,
      ...(input.intent.tender === undefined ? {} : { tender: input.intent.tender }),
      ...(input.intent.proposed === undefined ? {} : { proposed: input.intent.proposed }),
    },
    total: input.dataset.rows.length,
    sourceCounts: {
      tender: input.dataset.rows.filter(row => row.source === 'tender').length,
      proposed: input.dataset.rows.filter(row => row.source === 'proposed').length,
    },
    missingFieldCount: input.dataset.summary.missingFieldCount,
    unparseableFieldCount: input.dataset.summary.unparseableFieldCount,
    lifecycleCounts: input.dataset.summary.lifecycleCounts,
    regions: input.dataset.summary.regions.slice(0, 20),
    samples: ordered.slice(0, 8).map(row => ({
      recordId: row.recordId,
      source: row.source,
      title: row.title,
      purchaser: row.counterparty.value ?? row.counterparty.original,
      fieldStatus: row.disclosure.unparseableFields.length > 0
        ? 'unparseable'
        : row.disclosure.missingFields.length > 0 ? 'missing' : 'normalized',
    })),
  }
  const contextFingerprint = `sc_${createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')}`
  return ScreeningDraftContextV1Schema.parse({ ...content, contextFingerprint })
}
