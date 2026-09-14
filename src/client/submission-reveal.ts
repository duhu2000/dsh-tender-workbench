import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isTenderEntrySessionId } from './tender-session-entry.ts'

interface Submission {
  readonly text: string
  readonly onRetire?: (settlement: { readonly reason: string }) => void
}
interface SubmissionFace {
  beginSubmission?: (input: Submission) => unknown
}
interface Sessions {
  list: { getSnapshot(): { current?: SessionId }; subscribe?(listener: () => void): () => void }
  binding(sessionId: SessionId): { session: unknown } | undefined
}

/** Observe Host admission, never draft edits, model output, or restored history. */
export function installTenderSubmissionReveal(sessions: Sessions, reveal: (id: SessionId) => void): () => void {
  let stop = () => {}
  let current: SessionId | undefined
  let active = true
  let bound: unknown
  const connect = () => {
    const id = sessions.list.getSnapshot().current
    const face = id === undefined ? undefined : sessions.binding(id)?.session as SubmissionFace | undefined
    if (id === current && face === bound) return
    stop(); stop = () => {}; current = id; bound = face
    if (!id || !isTenderEntrySessionId(id) || typeof face?.beginSubmission !== 'function') return
    const original = face.beginSubmission
    const wrapped: NonNullable<SubmissionFace['beginSubmission']> = function(this: SubmissionFace, input) {
      let retired = false
      return original.call(this, { ...input, onRetire: settlement => {
        try { input.onRetire?.(settlement) }
        finally {
          if (!retired) {
            retired = true
            // A background acceptance must not steal another Session's panel.
            if (settlement.reason === 'observed' && active && sessions.list.getSnapshot().current === id) {
              try { reveal(id) } catch { /* Optional workbench failures must not break Host admission. */ }
            }
          }
        }
      } })
    }
    face.beginSubmission = wrapped
    stop = () => { if (face.beginSubmission === wrapped) face.beginSubmission = original }
  }
  const unsubscribe = sessions.list.subscribe?.(connect)
  connect()
  return () => { active = false; unsubscribe?.(); stop() }
}
