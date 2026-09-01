import type { ISessions, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import { createTenderProjectionPort } from '../src/client/tender-projection-port.ts'

function observable(initial: unknown): ObservableSnapshot<unknown> & { set(value: unknown): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next) { value = next; listeners.forEach(listener => { listener() }) },
  }
}

describe('TenderProjectionPort', () => {
  it('distinguishes missing, empty, invalid, and valid Host Projection values', () => {
    const faces = new Map([
      ['missing', observable(undefined)],
      ['empty', observable(null)],
      ['invalid', observable({ schemaVersion: 99 })],
      ['ready', observable(createEmptyTenderWorkflowProjection())],
    ])
    const sessions = {
      binding: (sessionId: string) => ({
        session: { projections: { faceOf: () => faces.get(sessionId) } },
      }),
    } as unknown as Pick<ISessions, 'binding'>
    const port = createTenderProjectionPort(sessions)
    expect(port.source('missing' as never).getSnapshot()).toEqual({ status: 'unavailable' })
    expect(port.source('empty' as never).getSnapshot()).toEqual({ status: 'empty' })
    expect(port.source('invalid' as never).getSnapshot()).toEqual({ status: 'invalid' })
    expect(port.source('ready' as never).getSnapshot()).toMatchObject({
      status: 'ready',
      projection: { currentStage: 'query', revision: 0 },
    })
  })

  it('subscribes only to the requested Session face and preserves stable snapshots', () => {
    const first = observable(null)
    const second = observable(null)
    const sessions = {
      binding: (sessionId: string) => ({
        session: { projections: { faceOf: () => sessionId === 'one' ? first : second } },
      }),
    } as unknown as Pick<ISessions, 'binding'>
    const source = createTenderProjectionPort(sessions).source('one' as never)
    const listener = vi.fn()
    const dispose = source.subscribe(listener)
    const before = source.getSnapshot()
    second.set(createEmptyTenderWorkflowProjection())
    expect(listener).not.toHaveBeenCalled()
    first.set(createEmptyTenderWorkflowProjection())
    expect(listener).toHaveBeenCalledTimes(1)
    const after = source.getSnapshot()
    expect(after).not.toBe(before)
    expect(source.getSnapshot()).toBe(after)
    dispose()
  })

  it('reports an unavailable Session binding without throwing', () => {
    const sessions = { binding: () => undefined } as unknown as Pick<ISessions, 'binding'>
    expect(createTenderProjectionPort(sessions).source('gone' as never).getSnapshot()).toEqual({
      status: 'unavailable',
    })
  })
})
