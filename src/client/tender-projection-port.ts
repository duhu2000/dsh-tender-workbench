import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ISessions, ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  TenderWorkflowProjectionV1Schema,
  type TenderWorkflowProjectionV1,
} from '../contracts/workflow.ts'

export type TenderProjectionRead =
  | { readonly status: 'unavailable' }
  | { readonly status: 'empty' }
  | { readonly status: 'invalid' }
  | { readonly status: 'ready'; readonly projection: TenderWorkflowProjectionV1 }

export interface TenderProjectionSource extends ObservableSnapshot<TenderProjectionRead> {}

/** The only Projection surface exposed to the Better Sidebar workbench. */
export interface TenderProjectionPort {
  source(sessionId: SessionId): TenderProjectionSource
}

const UNAVAILABLE: TenderProjectionRead = Object.freeze({ status: 'unavailable' })
const EMPTY: TenderProjectionRead = Object.freeze({ status: 'empty' })
const INVALID: TenderProjectionRead = Object.freeze({ status: 'invalid' })

export function readTenderProjectionSnapshot(raw: unknown): TenderProjectionRead {
  if (raw === undefined) return UNAVAILABLE
  if (raw === null) return EMPTY
  const parsed = TenderWorkflowProjectionV1Schema.safeParse(raw)
  return parsed.success
    ? { status: 'ready', projection: parsed.data }
    : INVALID
}

function constantSource(value: TenderProjectionRead): TenderProjectionSource {
  return {
    getSnapshot: () => value,
    subscribe: () => () => {},
  }
}

function projectionSource(source: ObservableSnapshot<unknown>): TenderProjectionSource {
  let previousRaw: unknown = Symbol('unread')
  let previousRead: TenderProjectionRead = UNAVAILABLE
  return {
    subscribe: listener => source.subscribe(listener),
    getSnapshot() {
      const raw = source.getSnapshot()
      if (Object.is(raw, previousRaw)) return previousRead
      previousRaw = raw
      previousRead = readTenderProjectionSnapshot(raw)
      return previousRead
    },
  }
}

export function createTenderProjectionPort(
  sessions: Pick<ISessions, 'binding'>,
): TenderProjectionPort {
  return {
    source(sessionId) {
      const binding = sessions.binding(sessionId)
      if (binding === undefined) return constantSource(UNAVAILABLE)
      return projectionSource(binding.session.projections.faceOf('dshTenderWorkflow'))
    },
  }
}

/** Subscribe only while the tab is visible; snapshot reads stay Session-addressed. */
export function useTenderProjection(
  port: TenderProjectionPort,
  sessionId: SessionId,
  visible: boolean,
): TenderProjectionRead {
  const source = useMemo(() => port.source(sessionId), [port, sessionId])
  const subscribe = useCallback(
    (listener: () => void) => visible ? source.subscribe(listener) : () => {},
    [source, visible],
  )
  return useSyncExternalStore(subscribe, source.getSnapshot, source.getSnapshot)
}
