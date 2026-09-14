import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installTenderSubmissionReveal } from '../src/client/submission-reveal.ts'

const id = 'session-dsh-tender-workbench-11111111-1111-4111-8111-111111111111' as SessionId
function fixture() {
  let current: SessionId = id
  let update = () => {}
  let retire: ((value: { reason: string }) => void) | undefined
  const original = vi.fn((input: { onRetire?: typeof retire }) => { retire = input.onRetire; return { requestId: 'one' } })
  const face = { beginSubmission: original }
  const reveal = vi.fn()
  const stop = installTenderSubmissionReveal({
    list: { getSnapshot: () => ({ current }), subscribe: listener => { update = listener; return vi.fn() } },
    binding: () => ({ session: face }),
  }, reveal)
  return { face, original, reveal, stop, update: () => update(), settle: (reason: string) => retire?.({ reason }), switch: (value = 'ordinary' as SessionId) => { current = value; update() } }
}
describe('accepted submission reveal', () => {
  it('does not open on entry or draft; opens once on observed admission and preserves callback/result', () => {
    const f = fixture(), callback = vi.fn()
    expect(f.reveal).not.toHaveBeenCalled()
    expect(f.face.beginSubmission({ onRetire: callback })).toEqual({ requestId: 'one' })
    expect(f.reveal).not.toHaveBeenCalled()
    f.settle('observed'); f.settle('observed'); f.update()
    expect(callback).toHaveBeenCalled()
    expect(f.reveal).toHaveBeenCalledExactlyOnceWith(id)
    // Closing the panel and subsequent Session updates do not reveal again.
    f.update(); expect(f.reveal).toHaveBeenCalledTimes(1)
    f.stop(); expect(f.face.beginSubmission).toBe(f.original)
  })
  it('never opens for rejected sends or a different active Session', () => {
    const f = fixture()
    f.face.beginSubmission({}); f.settle('failed')
    expect(f.reveal).not.toHaveBeenCalled()
    f.face.beginSubmission({}); f.switch(); f.settle('observed')
    expect(f.reveal).not.toHaveBeenCalled()
    f.switch(id); f.settle('observed')
    expect(f.reveal).not.toHaveBeenCalled()
    f.stop()
  })
  it('ignores delayed settlement after disposal', () => {
    const f = fixture()
    f.face.beginSubmission({}); f.stop(); f.settle('observed')
    expect(f.reveal).not.toHaveBeenCalled()
  })
  it('isolates optional sidebar errors from successful admission', () => {
    const f = fixture()
    f.reveal.mockImplementation(() => { throw new Error('provider removed') })
    f.face.beginSubmission({})
    expect(() => f.settle('observed')).not.toThrow()
    f.stop()
  })
})
