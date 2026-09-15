import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { initializeTenderDraft, type InitialDraftSnapshot } from '../src/client/initial-draft.ts'
import { TENDER_INITIAL_DRAFT, isTenderInitialDraft } from '../src/contracts/initial-draft.ts'
import { planTenderDraftFill } from '../src/client/tender-prompt.ts'

const a = 'session-dsh-tender-workbench-11111111-1111-4111-8111-111111111111'
const b = 'session-dsh-tender-workbench-22222222-2222-4222-8222-222222222222'
function harness(overrides: Partial<InitialDraftSnapshot> = {}) {
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  let state: InitialDraftSnapshot = { current: a, ready: true, composing: false, draft: '', revision: 0, attachments: 0, plain: true, ...overrides }
  let notify = () => {}, cancel = () => {}
  const jobs: (() => void)[] = []
  const write = vi.fn((draft: string) => { state = { ...state, draft, revision: state.revision + 1 }; notify() })
  const off = vi.fn()
  const port = { snapshot: () => state, write, subscribe(check: () => void, abort: () => void) { notify = check; cancel = abort; return off } }
  return { data, write, off, port, storage, get: () => state,
    set: (s: Partial<InitialDraftSnapshot>) => { state = { ...state, ...s } }, notify: () => notify(), cancel: () => cancel(),
    start: (id = a) => initializeTenderDraft(id, port, storage, job => jobs.push(job)),
    flush: () => { for (const job of jobs.splice(0)) job() } }
}

describe('UX-49 entry-only native draft permit', () => {
  it('writes once after a second snapshot; exposes no send/tool/task/reveal port', () => {
    const h = harness(); h.start(); expect(h.write).not.toHaveBeenCalled(); h.flush()
    expect(h.write).toHaveBeenCalledExactlyOnceWith(TENDER_INITIAL_DRAFT.text)
    expect([...h.data.values()][0]).toContain('initialized')
    expect(h.off).toHaveBeenCalled()
    h.notify(); h.flush(); expect(h.write).toHaveBeenCalledTimes(1)
    expect(Object.keys(h.port).sort()).toEqual(['snapshot', 'subscribe', 'write'])
  })
  it.each([{ draft: '我的条件' }, { draft: ' ' }, { attachments: 1 }, { composing: true }, { revision: 2 }, { plain: false }, { current: b }])('preserves initial unsafe state %j', state => {
    const h = harness(state); h.start(); h.flush(); expect(h.write).not.toHaveBeenCalled()
  })
  it.each([{ draft: '用户晚到输入' }, { attachments: 1 }, { composing: true }, { revision: 1 }, { current: b }, { ready: false }])('rechecks late race %j immediately before writing', state => {
    const h = harness(); h.start(); h.set(state); h.flush(); expect(h.write).not.toHaveBeenCalled()
  })
  it('waits for readiness, but cancels permanently on input/paste/drop/composition even if later empty', () => {
    const h = harness({ ready: false }); h.start(); h.flush(); expect(h.write).not.toHaveBeenCalled()
    h.cancel(); h.set({ ready: true }); h.notify(); h.flush(); expect(h.write).not.toHaveBeenCalled()
  })
  it('initializes when the pristine native input becomes ready', () => {
    const h = harness({ ready: false }); h.start(); h.set({ ready: true }); h.notify(); h.flush()
    expect(h.write).toHaveBeenCalledTimes(1)
  })
  it('never restores user-cleared content on remount/refresh/re-entry or a queued callback', () => {
    const h = harness(); h.start(); h.flush(); h.set({ draft: '', revision: 0 })
    h.start(); h.notify(); h.flush(); expect(h.get().draft).toBe(''); expect(h.write).toHaveBeenCalledTimes(1)
  })
  it('marks reserved before async work, so an interrupted initialization cannot retry after restart', () => {
    const h = harness(); const stop = h.start(); stop(); h.start(); h.flush(); expect(h.write).not.toHaveBeenCalled()
  })
  it('ordinary/other-product Sessions cannot acquire a tender permit', () => {
    for (const id of ['session-normal', a.replace('tender-workbench', 'pre-duediligence'), 'session-dsh-tender-workbench-invalid']) {
      const h = harness({ current: id }); h.start(id); h.flush(); expect(h.write).not.toHaveBeenCalled(); expect(h.data.size).toBe(0)
    }
  })
  it('late A callback cannot write into B or refill A when switching back', () => {
    const h = harness(); h.start(); h.set({ current: b }); h.notify(); h.set({ current: a }); h.flush()
    expect(h.write).not.toHaveBeenCalled()
    h.set({ current: b }); h.start(b); h.flush(); expect(h.write).toHaveBeenCalledTimes(1)
  })
  it('fails closed if storage, snapshot or draft API throws', () => {
    const h = harness()
    initializeTenderDraft(a, h.port, { ...h.storage, setItem() { throw Error('denied') } }); expect(h.write).not.toHaveBeenCalled()
    h.port.snapshot = () => { throw Error('unmounted') }; h.start(); h.flush(); expect(h.write).not.toHaveBeenCalled()
  })
  it('fingerprints exact text and only ignores an entirely unmodified template', () => {
    expect(TENDER_INITIAL_DRAFT.fingerprint).toBe('sha256:' + createHash('sha256').update(TENDER_INITIAL_DRAFT.text).digest('hex'))
    expect(planTenderDraftFill(TENDER_INITIAL_DRAFT.text, '新的条件')).toBe('新的条件')
    for (const text of [TENDER_INITIAL_DRAFT.text + ' ', TENDER_INITIAL_DRAFT.text.replace('【地区】', '江苏'), '我的条件\n' + TENDER_INITIAL_DRAFT.text]) {
      expect(isTenderInitialDraft(text)).toBe(false)
      expect(planTenderDraftFill(text, '新的条件')).toBeUndefined()
    }
  })
})
