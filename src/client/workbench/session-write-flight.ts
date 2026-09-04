import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TenderWorkbenchIntentV1 } from '../../contracts/screening-intents.ts'
import type {
  TenderCommandKind,
  TenderWorkflowProjectionV1,
  WorkflowStage,
} from '../../contracts/workflow.ts'

export type SessionWriteAction =
  | 'query'
  | 'rules.propose'
  | 'rules.adjust'
  | 'rules.preview'
  | 'rules.confirm'
  | 'analysis.request'
  | 'review.apply'
  | 'review.revert'
  | 'report.create'
  | 'report.retry'

export type SessionWritePhase =
  | 'idle'
  | 'sending'
  | 'waiting-agent'
  | 'running'
  | 'succeeded'
  | 'failed'

export interface SessionWriteState {
  readonly sessionId: SessionId
  readonly phase: SessionWritePhase
  readonly action?: SessionWriteAction
  readonly commandId?: string
  readonly failure?: 'transport' | 'workflow'
}

export interface SessionWriteFlight {
  readonly state: SessionWriteState
  readonly busy: boolean
  readonly start: (
    action: SessionWriteAction,
    buildIntent: (commandId: string) => TenderWorkbenchIntentV1,
  ) => boolean
  readonly retry: () => boolean
}

interface ProjectionBaseline {
  readonly revision: number
  readonly stageStatus: string | undefined
  readonly stageUpdatedAt: string | undefined
  readonly queryArtifactId: string | undefined
  readonly draftArtifactId: string | undefined
  readonly previewArtifactId: string | undefined
  readonly classificationArtifactId: string | undefined
  readonly analysisArtifactId: string | undefined
  readonly reviewArtifactId: string | undefined
  readonly reviewRevision: number | undefined
  readonly finalSnapshotArtifactId: string | undefined
  readonly excelArtifactId: string | undefined
  readonly pdfArtifactId: string | undefined
  readonly excelStatus: string | undefined
  readonly pdfStatus: string | undefined
}

interface ActiveFlight {
  readonly sessionId: SessionId
  readonly action: SessionWriteAction
  readonly commandId: string
  readonly intent: TenderWorkbenchIntentV1
  readonly command: TenderCommandKind
  readonly stage: WorkflowStage
  readonly baseline: ProjectionBaseline
  phase: Exclude<SessionWritePhase, 'idle'>
  seenRunning: boolean
  failure?: 'transport' | 'workflow'
}

interface Lifecycle {
  sessionId: SessionId
  generation: number
  busy: boolean
  disposed: boolean
  flight?: ActiveFlight
}

const IDLE_PHASES = new Set<SessionWritePhase>(['idle', 'succeeded', 'failed'])

function actionContract(action: SessionWriteAction): {
  readonly command: TenderCommandKind
  readonly stage: WorkflowStage
} {
  if (action === 'query') return { command: 'tender_workbench_query', stage: 'query' }
  if (action === 'rules.confirm') return { command: 'tender_workbench_confirm_rules', stage: 'classification' }
  if (action === 'analysis.request') return { command: 'tender_workbench_analysis_commit', stage: 'analysis' }
  if (action === 'review.apply') return { command: 'tender_workbench_apply_review', stage: 'review' }
  if (action === 'review.revert') return { command: 'tender_workbench_revert_review', stage: 'review' }
  if (action === 'report.create' || action === 'report.retry') return { command: 'tender_workbench_generate_report', stage: 'report' }
  return { command: 'tender_workbench_preview_rules', stage: 'rules' }
}

function actionCommands(action: SessionWriteAction): readonly TenderCommandKind[] {
  return action === 'analysis.request'
    ? ['tender_workbench_analysis_next', 'tender_workbench_analysis_commit']
    : [actionContract(action).command]
}

function actionForProjection(
  workflow: TenderWorkflowProjectionV1 | undefined,
): SessionWriteAction | undefined {
  const operation = workflow?.activeOperation
  if (operation !== undefined) {
    if (operation.command === 'tender_workbench_query') return 'query'
    if (operation.command === 'tender_workbench_confirm_rules') return 'rules.confirm'
    if (operation.command === 'tender_workbench_preview_rules') return 'rules.preview'
    if (operation.command === 'tender_workbench_analysis_next' || operation.command === 'tender_workbench_analysis_commit') return 'analysis.request'
    if (operation.command === 'tender_workbench_apply_review') return 'review.apply'
    if (operation.command === 'tender_workbench_revert_review') return 'review.revert'
    if (operation.command === 'tender_workbench_generate_report') return 'report.create'
    return undefined
  }
  if (workflow === undefined) return undefined
  if (workflow.stages.query.status === 'waiting-agent' || workflow.stages.overview.status === 'waiting-agent') return 'query'
  if (workflow.stages.rules.status === 'waiting-agent') return 'rules.preview'
  if (workflow.stages.classification.status === 'waiting-agent') return 'rules.confirm'
  if (workflow.stages.query.status === 'running' || workflow.stages.overview.status === 'running') return 'query'
  if (workflow.stages.rules.status === 'running') return 'rules.preview'
  if (workflow.stages.classification.status === 'running') return 'rules.confirm'
  if (workflow.stages.analysis.status === 'running') return 'analysis.request'
  if (workflow.stages.review.status === 'running') return 'review.apply'
  if (workflow.stages.report.status === 'running') return 'report.create'
  return undefined
}

function projectionPhase(
  workflow: TenderWorkflowProjectionV1 | undefined,
): 'waiting-agent' | 'running' | undefined {
  if (workflow?.activeOperation !== undefined) return 'running'
  if (workflow === undefined) return undefined
  const statuses = Object.values(workflow.stages).map(stage => stage.status)
  if (statuses.includes('running')) return 'running'
  return statuses.includes('waiting-agent') ? 'waiting-agent' : undefined
}

function baselineOf(
  workflow: TenderWorkflowProjectionV1 | undefined,
  stage: WorkflowStage,
): ProjectionBaseline {
  return {
    revision: workflow?.revision ?? 0,
    stageStatus: workflow?.stages[stage].status,
    stageUpdatedAt: workflow?.stages[stage].updatedAt,
    queryArtifactId: workflow?.query?.querySpec.id,
    draftArtifactId: workflow?.rules?.draft?.id,
    previewArtifactId: workflow?.rules?.preview?.id,
    classificationArtifactId: workflow?.classification?.data.id,
    analysisArtifactId: workflow?.analysis?.data?.id,
    reviewArtifactId: workflow?.review?.data.id,
    reviewRevision: workflow?.review?.revision,
    finalSnapshotArtifactId: workflow?.report?.finalSnapshot?.id,
    excelArtifactId: workflow?.report?.excel.artifact?.id,
    pdfArtifactId: workflow?.report?.pdf.artifact?.id,
    excelStatus: workflow?.report?.excel.status,
    pdfStatus: workflow?.report?.pdf.status,
  }
}

function intentDataset(intent: TenderWorkbenchIntentV1): string | undefined {
  return intent.kind === 'query.start' || intent.kind === 'report.retry' ? undefined : intent.activeDatasetRef
}

function hasSucceeded(
  flight: ActiveFlight,
  workflow: TenderWorkflowProjectionV1,
): boolean {
  if (!flight.seenRunning) return false
  if (flight.action === 'analysis.request') {
    const analysis = workflow.analysis
    return workflow.stages.analysis.status === 'succeeded'
      && analysis !== undefined
      && analysis.activeDatasetId === intentDataset(flight.intent)
      && analysis.completed === analysis.eligibleTotal
  }
  if (workflow.revision <= flight.baseline.revision) return false
  if (flight.action === 'query') {
    return workflow.stages.query.status === 'succeeded'
      && workflow.stages.overview.status === 'succeeded'
      && workflow.query?.querySpec.id !== flight.baseline.queryArtifactId
  }
  const datasetId = intentDataset(flight.intent)
  if (flight.action === 'rules.confirm') {
    const classification = workflow.classification
    return workflow.stages.classification.status === 'succeeded'
      && classification?.activeDatasetId === datasetId
      && classification?.data.id !== flight.baseline.classificationArtifactId
  }
  if (flight.action === 'review.apply' || flight.action === 'review.revert') {
    return workflow.stages.review.status === 'succeeded'
      && workflow.review?.data.id !== flight.baseline.reviewArtifactId
      && workflow.review?.revision !== flight.baseline.reviewRevision
  }
  if (flight.action === 'report.create') {
    return workflow.report?.finalSnapshot?.id !== undefined
      && workflow.report.finalSnapshot.id !== flight.baseline.finalSnapshotArtifactId
  }
  if (flight.action === 'report.retry') {
    const report = workflow.report
    return report !== undefined
      && report.finalSnapshot?.id === flight.baseline.finalSnapshotArtifactId
      && (report.excel.artifact?.id !== flight.baseline.excelArtifactId
        || report.pdf.artifact?.id !== flight.baseline.pdfArtifactId
        || report.excel.status !== flight.baseline.excelStatus
        || report.pdf.status !== flight.baseline.pdfStatus
        || workflow.revision > flight.baseline.revision)
  }
  const rules = workflow.rules
  return workflow.stages.rules.status === 'succeeded'
    && rules?.activeDatasetId === datasetId
    && rules?.previewRevision === workflow.revision
    && rules?.preview?.id !== flight.baseline.previewArtifactId
    && rules?.draft?.id !== flight.baseline.draftArtifactId
}

function hasFailed(
  flight: ActiveFlight,
  workflow: TenderWorkflowProjectionV1,
): boolean {
  const stage = workflow.stages[flight.stage]
  if (stage.status !== 'failed' || workflow.lastFailure === undefined
    || !actionCommands(flight.action).includes(workflow.lastFailure.command)) return false
  return flight.seenRunning
    && (flight.baseline.stageStatus !== 'failed'
      || stage.updatedAt !== flight.baseline.stageUpdatedAt)
}

function publicState(flight: ActiveFlight): SessionWriteState {
  return {
    sessionId: flight.sessionId,
    phase: flight.phase,
    action: flight.action,
    commandId: flight.commandId,
    ...(flight.failure === undefined ? {} : { failure: flight.failure }),
  }
}

function externalState(
  sessionId: SessionId,
  workflow: TenderWorkflowProjectionV1 | undefined,
): SessionWriteState | undefined {
  const phase = projectionPhase(workflow)
  const action = actionForProjection(workflow)
  if (phase === undefined || action === undefined) return undefined
  return {
    sessionId,
    phase,
    action,
    ...(workflow?.activeOperation?.commandId === undefined
      ? {}
      : { commandId: workflow.activeOperation.commandId }),
  }
}

/**
 * Owns the transient send/wait gap that is not represented by the Session Projection.
 * The ref lock is acquired before command creation so React rendering is not part of
 * the duplicate-submit guarantee.
 */
export function useSessionWriteFlight(input: {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1 | undefined
  readonly sendIntent: (intent: TenderWorkbenchIntentV1) => Promise<void>
  readonly createCommandId: () => string
}): SessionWriteFlight {
  const { sessionId, workflow, sendIntent, createCommandId } = input
  const [rendered, setRendered] = useState<SessionWriteState>({ sessionId, phase: 'idle' })
  const lifecycleRef = useRef<Lifecycle>({ sessionId, generation: 0, busy: false, disposed: false })
  const projectionRef = useRef(workflow)
  projectionRef.current = workflow

  if (lifecycleRef.current.sessionId !== sessionId) {
    lifecycleRef.current = {
      sessionId,
      generation: lifecycleRef.current.generation + 1,
      busy: false,
      disposed: false,
    }
  }

  const publish = useCallback((flight: ActiveFlight, generation: number): void => {
    const lifecycle = lifecycleRef.current
    if (lifecycle.disposed || lifecycle.generation !== generation || lifecycle.flight !== flight) return
    setRendered(publicState(flight))
  }, [])

  const send = useCallback((flight: ActiveFlight, generation: number): void => {
    void sendIntent(flight.intent).then(() => {
      const lifecycle = lifecycleRef.current
      if (lifecycle.disposed || lifecycle.generation !== generation || lifecycle.flight !== flight) return
      if (flight.phase === 'sending') {
        flight.phase = 'waiting-agent'
        publish(flight, generation)
      }
    }, () => {
      const lifecycle = lifecycleRef.current
      if (lifecycle.disposed || lifecycle.generation !== generation || lifecycle.flight !== flight) return
      flight.phase = 'failed'
      flight.failure = 'transport'
      lifecycle.busy = false
      publish(flight, generation)
    })
  }, [publish, sendIntent])

  const start = useCallback<SessionWriteFlight['start']>((action, buildIntent) => {
    const lifecycle = lifecycleRef.current
    if (lifecycle.disposed || lifecycle.sessionId !== sessionId || lifecycle.busy) return false
    if (projectionPhase(projectionRef.current) !== undefined) return false

    lifecycle.busy = true
    const generation = lifecycle.generation
    const commandId = createCommandId()
    const { command, stage } = actionContract(action)
    let intent: TenderWorkbenchIntentV1
    try {
      intent = buildIntent(commandId)
    } catch (error) {
      lifecycle.busy = false
      throw error
    }
    const flight: ActiveFlight = {
      sessionId,
      action,
      commandId,
      intent,
      command,
      stage,
      baseline: baselineOf(projectionRef.current, stage),
      phase: 'sending',
      seenRunning: false,
    }
    lifecycle.flight = flight
    setRendered(publicState(flight))
    send(flight, generation)
    return true
  }, [createCommandId, send, sessionId])

  const retry = useCallback((): boolean => {
    const lifecycle = lifecycleRef.current
    const flight = lifecycle.flight
    if (
      lifecycle.disposed
      || lifecycle.sessionId !== sessionId
      || lifecycle.busy
      || flight === undefined
      || flight.phase !== 'failed'
      || flight.failure !== 'transport'
      || projectionPhase(projectionRef.current) !== undefined
    ) return false
    lifecycle.busy = true
    flight.phase = 'sending'
    flight.failure = undefined
    publish(flight, lifecycle.generation)
    send(flight, lifecycle.generation)
    return true
  }, [publish, send, sessionId])

  useEffect(() => {
    const lifecycle = lifecycleRef.current
    const flight = lifecycle.flight
    if (flight === undefined || workflow === undefined || flight.sessionId !== sessionId) return
    const active = workflow.activeOperation
    if (active?.commandId === flight.commandId && actionCommands(flight.action).includes(active.command)) {
      flight.seenRunning = true
      flight.phase = 'running'
      flight.failure = undefined
      lifecycle.busy = true
      publish(flight, lifecycle.generation)
      return
    }
    if (active !== undefined) return
    if (hasFailed(flight, workflow)) {
      flight.phase = 'failed'
      flight.failure = 'workflow'
      lifecycle.busy = false
      publish(flight, lifecycle.generation)
      return
    }
    if (hasSucceeded(flight, workflow)) {
      flight.phase = 'succeeded'
      flight.failure = undefined
      lifecycle.busy = false
      publish(flight, lifecycle.generation)
    }
  }, [publish, sessionId, workflow])

  useEffect(() => () => {
    const lifecycle = lifecycleRef.current
    lifecycle.disposed = true
    lifecycle.busy = false
    lifecycle.flight = undefined
    lifecycle.generation += 1
  }, [])

  const localState = rendered.sessionId === sessionId ? rendered : { sessionId, phase: 'idle' as const }
  const external = externalState(sessionId, workflow)
  const localBusy = !IDLE_PHASES.has(localState.phase)
  return {
    state: localBusy || external === undefined ? localState : external,
    busy: localBusy || external !== undefined,
    start,
    retry,
  }
}
