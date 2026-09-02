import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type {
  TenderWorkflowProjectionV1,
  WorkflowStage,
} from '../../contracts/workflow.ts'
import type { TenderKey } from '../locales.ts'

export type WorkbenchPhaseIcon = 'search' | 'screening' | 'decision' | 'delivery'

/** Single front-stage mapping for the seven non-linear Projection nodes. */
export const TENDER_WORKBENCH_PHASES = [
  {
    id: 'opportunity',
    labelKey: 'workbench.phase.opportunity',
    icon: 'search',
    nodes: ['query', 'overview'],
    implemented: true,
    completionNode: 'overview',
  },
  {
    id: 'screening',
    labelKey: 'workbench.phase.screening',
    icon: 'screening',
    nodes: ['rules', 'classification', 'analysis'],
    implemented: true,
    completionNode: 'classification',
  },
  {
    id: 'decision',
    labelKey: 'workbench.phase.decision',
    icon: 'decision',
    nodes: ['review'],
    implemented: true,
    completionNode: 'review',
  },
  {
    id: 'delivery',
    labelKey: 'workbench.phase.delivery',
    icon: 'delivery',
    nodes: ['report'],
    implemented: true,
    completionNode: 'report',
  },
] as const satisfies readonly {
  readonly id: string
  readonly labelKey: TenderKey
  readonly icon: WorkbenchPhaseIcon
  readonly nodes: readonly WorkflowStage[]
  readonly implemented: boolean
  readonly completionNode: WorkflowStage | undefined
}[]

export type WorkbenchPhase = typeof TENDER_WORKBENCH_PHASES[number]['id']
export type WorkbenchPhaseProgress = 'not-started' | 'progress' | 'completed' | 'running' | 'failed' | 'blocked' | 'unavailable'

export const WORKBENCH_PHASES: readonly WorkbenchPhase[] = TENDER_WORKBENCH_PHASES.map(phase => phase.id)

export function tenderWorkbenchPhaseProgress(
  projection: TenderWorkflowProjectionV1 | undefined,
  phase: WorkbenchPhase,
): WorkbenchPhaseProgress {
  const config = TENDER_WORKBENCH_PHASES.find(candidate => candidate.id === phase)
  if (config === undefined) return 'not-started'
  if (!config.implemented) return 'unavailable'
  if (projection === undefined) return 'not-started'
  const statuses = config.nodes.map(stage => projection.stages[stage].status)
  if (statuses.includes('running') || statuses.includes('waiting-agent')) return 'running'
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('blocked')) return 'blocked'
  if (config.completionNode !== undefined && projection.stages[config.completionNode].status === 'succeeded') return 'completed'
  if (statuses.includes('succeeded')) return 'progress'
  return 'not-started'
}

export function tenderWorkbenchPhaseForStage(stage: WorkflowStage | undefined): WorkbenchPhase {
  if (stage === undefined) return 'opportunity'
  return TENDER_WORKBENCH_PHASES.find(phase => (phase.nodes as readonly WorkflowStage[]).includes(stage))?.id ?? 'opportunity'
}

export interface TenderWorkbenchNavigationController {
  attach(sessionId: string, select: Dispatch<SetStateAction<WorkbenchPhase>>): () => void
  request(sessionId: string, phase: WorkbenchPhase): void
}

/** Session-scoped transient navigation; it never represents workflow progress. */
export function createTenderWorkbenchNavigationController(): TenderWorkbenchNavigationController {
  const targets = new Map<string, Dispatch<SetStateAction<WorkbenchPhase>>>()
  const pending = new Map<string, WorkbenchPhase>()
  return {
    attach(sessionId, select) {
      targets.set(sessionId, select)
      const requested = pending.get(sessionId)
      if (requested !== undefined) {
        pending.delete(sessionId)
        select(requested)
      }
      return () => {
        if (targets.get(sessionId) === select) targets.delete(sessionId)
      }
    },
    request(sessionId, phase) {
      const select = targets.get(sessionId)
      if (select === undefined) pending.set(sessionId, phase)
      else select(phase)
    },
  }
}

export function useTenderWorkbenchNavigation(
  controller: TenderWorkbenchNavigationController,
  sessionId: string,
  select: Dispatch<SetStateAction<WorkbenchPhase>>,
): void {
  useEffect(() => controller.attach(sessionId, select), [controller, select, sessionId])
}
