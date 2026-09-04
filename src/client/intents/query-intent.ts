import {
  TenderWorkbenchIntentV2Schema,
  type TenderWorkbenchIntentV2,
} from '../../contracts/intents.ts'
import { toQccQueryBranches } from '../qcc-request.ts'
import type { TenderFilters } from '../types.ts'

export interface TenderQueryDraft {
  readonly scope: 'tender' | 'proposed' | 'combined'
  readonly target: string
  readonly filters: TenderFilters
}

export function createTenderQueryIntent(
  draft: TenderQueryDraft,
  intentId: string,
  projectionRevision: number,
  now = new Date(),
): TenderWorkbenchIntentV2 {
  const branches = toQccQueryBranches(draft.filters, draft.scope, now)
  return TenderWorkbenchIntentV2Schema.parse({
    schemaVersion: 2,
    intentId,
    kind: 'query.run',
    skill: 'tender-workbench-query',
    binding: { projectionRevision },
    payload: { scope: draft.scope, target: draft.target, ...branches },
  })
}

export { serializeTenderWorkbenchIntent as serializeTenderQueryIntent } from './screening-intent.ts'
