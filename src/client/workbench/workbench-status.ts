import type { TenderWorkflowProjectionV2 } from '../../contracts/workflow.ts'
import type { TenderProjectionRead } from '../tender-projection-port.ts'

export type TenderWorkbenchDisplayStatus =
  | 'unavailable'
  | 'empty'
  | 'waiting-agent'
  | 'running'
  | 'failed'
  | 'ready'

export interface PendingTenderIntent {
  readonly intentId: string
  readonly revision: number
  readonly stage?: 'query' | 'rules' | 'classification' | 'analysis' | 'review' | 'report'
}

export function hasCompletedLightweightQuery(
  projection: TenderWorkflowProjectionV2 | undefined,
): boolean {
  return projection?.stages.query.status === 'succeeded'
    && projection.stages.overview.status === 'succeeded'
}

/**
 * S1a owns only the query send boundary. Later node failures stay phase-local
 * instead of turning an otherwise usable non-linear workbench into a failed wizard.
 */
export function tenderWorkbenchDisplayStatus(
  read: TenderProjectionRead,
  pending?: PendingTenderIntent,
  sendFailed = false,
): TenderWorkbenchDisplayStatus {
  if (read.status === 'unavailable' || read.status === 'invalid') return 'unavailable'
  if (sendFailed) return 'failed'
  if (read.status === 'ready') {
    if (read.projection.activeOperation !== undefined) return 'running'
    const queryStatuses = [
      read.projection.stages.query.status,
      read.projection.stages.overview.status,
    ]
    if (queryStatuses.includes('running')) return 'running'
    if (queryStatuses.includes('waiting-agent')) return 'waiting-agent'
    if (queryStatuses.includes('failed')) return 'failed'
  }
  if (pending !== undefined) return 'waiting-agent'
  if (read.status === 'empty') return 'empty'
  return 'ready'
}
