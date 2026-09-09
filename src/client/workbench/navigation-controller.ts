import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type {
  TenderWorkflowProjectionV2,
  WorkflowStage,
} from '../../contracts/workflow.ts'
import type { TenderKey } from '../locales.ts'
import { createSessionViewMemory } from './session-view-memory.ts'

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
export type WorkbenchDestination = WorkbenchPhase | 'history'
export type WorkbenchPhaseProgress = 'not-started' | 'progress' | 'completed' | 'running' | 'failed' | 'blocked' | 'unavailable'

export const WORKBENCH_PHASES: readonly WorkbenchPhase[] = TENDER_WORKBENCH_PHASES.map(phase => phase.id)

export function tenderWorkbenchPhaseProgress(
  projection: TenderWorkflowProjectionV2 | undefined,
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
  if (phase === 'decision' && projection.stages.classification.status === 'succeeded') return 'progress'
  return 'not-started'
}

export function tenderWorkbenchPhaseForStage(stage: WorkflowStage | undefined): WorkbenchPhase {
  if (stage === undefined) return 'opportunity'
  return TENDER_WORKBENCH_PHASES.find(phase => (phase.nodes as readonly WorkflowStage[]).includes(stage))?.id ?? 'opportunity'
}

export interface TenderWorkbenchNavigationController {
  readonly memory: ReturnType<typeof createSessionViewMemory>
  currentView(sessionId: string): WorkbenchDestination
  attach(sessionId: string, select: Dispatch<SetStateAction<WorkbenchDestination>>): () => void
  request(sessionId: string, phase: WorkbenchDestination): void
  dispose(): void
}

/** Session-scoped transient navigation; it never represents workflow progress. */
export function createTenderWorkbenchNavigationController(): TenderWorkbenchNavigationController {
  const targets = new Map<string, Dispatch<SetStateAction<WorkbenchDestination>>>()
  const views = new Map<string, WorkbenchDestination>()
  let disposed = false
  const memory = createSessionViewMemory()
  return {
    memory,
    currentView: sessionId => views.get(sessionId) ?? 'opportunity',
    attach(sessionId, select) {
      if (disposed) return () => {}
      targets.set(sessionId, select)
      const requested = views.get(sessionId)
      if (requested !== undefined) {
        select(requested)
      }
      return () => {
        if (targets.get(sessionId) === select) targets.delete(sessionId)
      }
    },
    request(sessionId, phase) {
      if (disposed || views.get(sessionId) === phase) return
      views.set(sessionId, phase)
      const select = targets.get(sessionId)
      select?.(phase)
    },
    dispose() {
      disposed = true
      targets.clear()
      views.clear()
      memory.dispose()
    },
  }
}

export function useTenderWorkbenchNavigation(
  controller: TenderWorkbenchNavigationController,
  sessionId: string,
  select: Dispatch<SetStateAction<WorkbenchDestination>>,
): void {
  useEffect(() => controller.attach(sessionId, select), [controller, select, sessionId])
}
