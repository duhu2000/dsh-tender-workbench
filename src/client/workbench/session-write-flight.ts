import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TenderWorkbenchIntentV2 } from '../../contracts/intents.ts'
import {
  orchestrationFor,
  type TenderWorkbenchIntentKindV2,
} from '../../contracts/orchestration.ts'
import type { TenderWorkflowProjectionV2, WorkflowStage } from '../../contracts/workflow.ts'

export type SessionWriteAction = Exclude<TenderWorkbenchIntentKindV2, 'analysis.follow-up'>
export type SessionWritePhase = 'idle' | 'sending' | 'waiting-agent' | 'running' | 'succeeded' | 'failed'

export interface SessionWriteState {
  readonly sessionId: SessionId
  readonly phase: SessionWritePhase
  readonly action?: SessionWriteAction
  readonly intentId?: string
  readonly failure?: 'transport' | 'workflow'
}

export interface SessionWriteFlight {
  readonly state: SessionWriteState
  readonly busy: boolean
  readonly start: (
    action: SessionWriteAction,
    buildIntent: (intentId: string) => TenderWorkbenchIntentV2,
  ) => boolean
  readonly retry: () => boolean
}

interface ProjectionBaseline {
  readonly revision: number
  readonly stageStatus: string | undefined
  readonly stageUpdatedAt: string | undefined
  readonly queryArtifactId: string | undefined
  readonly draftArtifactId: string | undefined
  readonly previewArtifactRef: string | undefined
  readonly classificationArtifactId: string | undefined
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
  readonly intentId: string
  readonly intent: TenderWorkbenchIntentV2
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

function projectionPhase(workflow: TenderWorkflowProjectionV2 | undefined): 'waiting-agent' | 'running' | undefined {
  const pending = workflow?.pendingIntent
  if (pending !== undefined) return pending.status
  return workflow?.activeOperation === undefined ? undefined : 'running'
}

function actionForProjection(workflow: TenderWorkflowProjectionV2 | undefined): SessionWriteAction | undefined {
  const kind = workflow?.pendingIntent?.kind
  return kind === undefined || kind === 'analysis.follow-up' ? undefined : kind
}

function baselineOf(workflow: TenderWorkflowProjectionV2 | undefined, stage: WorkflowStage): ProjectionBaseline {
  return {
    revision: workflow?.revision ?? 0,
    stageStatus: workflow?.stages[stage].status,
    stageUpdatedAt: workflow?.stages[stage].updatedAt,
    queryArtifactId: workflow?.query?.querySpec.id,
    draftArtifactId: workflow?.rules?.draft?.id,
    previewArtifactRef: workflow?.rules?.preview?.id,
    classificationArtifactId: workflow?.classification?.data.id,
    reviewArtifactId: workflow?.review?.data.id,
    reviewRevision: workflow?.review?.revision,
    finalSnapshotArtifactId: workflow?.report?.finalSnapshot?.id,
    excelArtifactId: workflow?.report?.excel.artifact?.id,
    pdfArtifactId: workflow?.report?.pdf.artifact?.id,
    excelStatus: workflow?.report?.excel.status,
    pdfStatus: workflow?.report?.pdf.status,
  }
}

function intentDataset(intent: TenderWorkbenchIntentV2): string | undefined {
  return 'activeDatasetRef' in intent.binding ? intent.binding.activeDatasetRef : undefined
}

function hasSucceeded(flight: ActiveFlight, workflow: TenderWorkflowProjectionV2): boolean {
  if (!flight.seenRunning || workflow.pendingIntent?.intentId === flight.intentId) return false
  if (flight.action === 'analysis.run') {
    const analysis = workflow.analysis
    return workflow.stages.analysis.status === 'succeeded'
      && analysis !== undefined
      && analysis.activeDatasetId === intentDataset(flight.intent)
      && analysis.completed === analysis.eligibleTotal
  }
  if (workflow.revision <= flight.baseline.revision) return false
  if (flight.action === 'query.run') {
    return workflow.stages.query.status === 'succeeded'
      && workflow.stages.overview.status === 'succeeded'
      && workflow.query?.querySpec.id !== flight.baseline.queryArtifactId
  }
  const datasetId = intentDataset(flight.intent)
  if (flight.action === 'rules.confirm') {
    return workflow.stages.classification.status === 'succeeded'
      && workflow.classification?.activeDatasetId === datasetId
      && workflow.classification?.data.id !== flight.baseline.classificationArtifactId
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
    && rules?.preview?.id !== flight.baseline.previewArtifactRef
    && rules?.draft?.id !== flight.baseline.draftArtifactId
}

function hasFailed(flight: ActiveFlight, workflow: TenderWorkflowProjectionV2): boolean {
  const stage = workflow.stages[flight.stage]
  const contract = orchestrationFor(flight.action)
  if (stage.status !== 'failed' || workflow.lastFailure === undefined
    || !contract.allowedTools.includes(workflow.lastFailure.tool)) return false
  return flight.seenRunning
    && (flight.baseline.stageStatus !== 'failed' || stage.updatedAt !== flight.baseline.stageUpdatedAt)
}

function publicState(flight: ActiveFlight): SessionWriteState {
  return {
    sessionId: flight.sessionId,
    phase: flight.phase,
    action: flight.action,
    intentId: flight.intentId,
    ...(flight.failure === undefined ? {} : { failure: flight.failure }),
  }
}

function externalState(
  sessionId: SessionId,
  workflow: TenderWorkflowProjectionV2 | undefined,
): SessionWriteState | undefined {
  const phase = projectionPhase(workflow)
  const action = actionForProjection(workflow)
  if (phase === undefined || action === undefined) return undefined
  return { sessionId, phase, action, intentId: workflow?.pendingIntent?.intentId }
}

export function useSessionWriteFlight(input: {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV2 | undefined
  readonly sendIntent: (intent: TenderWorkbenchIntentV2) => Promise<void>
  readonly createIntentId: () => string
}): SessionWriteFlight {
  const { sessionId, workflow, sendIntent, createIntentId } = input
  const [rendered, setRendered] = useState<SessionWriteState>({ sessionId, phase: 'idle' })
  const lifecycleRef = useRef<Lifecycle>({ sessionId, generation: 0, busy: false, disposed: false })
  const projectionRef = useRef(workflow)
  projectionRef.current = workflow

  if (lifecycleRef.current.sessionId !== sessionId) {
    lifecycleRef.current = { sessionId, generation: lifecycleRef.current.generation + 1, busy: false, disposed: false }
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
    const intentId = createIntentId()
    const stage = orchestrationFor(action).stage
    let intent: TenderWorkbenchIntentV2
    try {
      intent = buildIntent(intentId)
      if (intent.intentId !== intentId || intent.kind !== action) throw new Error('Intent builder returned a mismatched action')
    } catch (error) {
      lifecycle.busy = false
      throw error
    }
    const flight: ActiveFlight = {
      sessionId, action, intentId, intent, stage,
      baseline: baselineOf(projectionRef.current, stage), phase: 'sending', seenRunning: false,
    }
    lifecycle.flight = flight
    setRendered(publicState(flight))
    send(flight, generation)
    return true
  }, [createIntentId, send, sessionId])

  const retry = useCallback((): boolean => {
    const lifecycle = lifecycleRef.current
    const flight = lifecycle.flight
    if (lifecycle.disposed || lifecycle.sessionId !== sessionId || lifecycle.busy || flight === undefined
      || flight.phase !== 'failed' || flight.failure !== 'transport'
      || projectionPhase(projectionRef.current) !== undefined) return false
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
    const pending = workflow.pendingIntent
    const active = workflow.activeOperation
    if (pending?.intentId === flight.intentId && (pending.status === 'running' || active?.intentId === flight.intentId)) {
      flight.seenRunning = true
      flight.phase = 'running'
      flight.failure = undefined
      lifecycle.busy = true
      publish(flight, lifecycle.generation)
      return
    }
    if (active !== undefined || pending !== undefined) return
    if (hasFailed(flight, workflow)) {
      flight.phase = 'failed'
      flight.failure = 'workflow'
      lifecycle.busy = false
      publish(flight, lifecycle.generation)
    } else if (hasSucceeded(flight, workflow)) {
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
  return { state: localBusy || external === undefined ? localState : external, busy: localBusy || external !== undefined, start, retry }
}
