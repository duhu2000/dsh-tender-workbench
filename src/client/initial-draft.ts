import { TENDER_INITIAL_DRAFT } from '../contracts/initial-draft.ts'
import { isTenderEntrySessionId } from './tender-session-entry.ts'

export interface InitialDraftSnapshot {
  readonly current: string | undefined
  readonly ready: boolean
  readonly composing: boolean
  readonly draft: string
  readonly revision: number
  readonly attachments: number
  readonly plain: boolean
}

export interface InitialDraftPort {
  snapshot(): InitialDraftSnapshot
  subscribe(check: () => void, cancel: () => void): () => void
  write(text: string): void
}

/** Entry-issued capability only. No mount/history observer may create a permit. */
export function initializeTenderDraft(
  sessionId: string,
  port: InitialDraftPort,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  schedule: (job: () => void) => void = queueMicrotask,
): () => void {
  const key = `${TENDER_INITIAL_DRAFT.id}/session/${sessionId}`
  let alive = true
  let off = () => {}
  const stop = () => { alive = false; off() }
  if (!isTenderEntrySessionId(sessionId)) return stop
  try {
    if (storage.getItem(key) !== null) return stop
    // Reserve before waiting. Reload/crash/remount must never retry this Session.
    storage.setItem(key, JSON.stringify({ status: 'reserved', ...TENDER_INITIAL_DRAFT, text: undefined }))
  } catch { return stop } // Unavailable persistence: fail closed, do not refill.
  const safe = (s: InitialDraftSnapshot) => s.current === sessionId && !s.composing
    && s.draft === '' && s.revision === 0 && s.attachments === 0 && s.plain
  const check = () => {
    if (!alive) return
    let first: InitialDraftSnapshot
    try { first = port.snapshot() } catch { stop(); return }
    if (!safe(first)) { stop(); return }
    if (!first.ready) return
    schedule(() => {
      if (!alive) return
      try {
        const latest = port.snapshot()
        if (!safe(latest) || !latest.ready || latest.revision !== first.revision) { stop(); return }
        // No await between second snapshot and synchronous public draft write.
        stop()
        port.write(TENDER_INITIAL_DRAFT.text)
        storage.setItem(key, JSON.stringify({ status: 'initialized', id: TENDER_INITIAL_DRAFT.id,
          version: TENDER_INITIAL_DRAFT.version, fingerprint: TENDER_INITIAL_DRAFT.fingerprint }))
      } catch { stop() }
    })
  }
  off = port.subscribe(check, stop)
  if (!alive) off()
  check()
  return stop
}
