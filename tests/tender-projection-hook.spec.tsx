// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  useTenderProjection,
  type TenderProjectionPort,
  type TenderProjectionRead,
} from '../src/client/tender-projection-port.ts'

describe('useTenderProjection visibility lifecycle', () => {
  it('pauses the Projection subscription while the Better Sidebar Tab is hidden', () => {
    let snapshot: TenderProjectionRead = { status: 'empty' }
    const listeners = new Set<() => void>()
    const dispose = vi.fn()
    const subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener); dispose() }
    })
    const port: TenderProjectionPort = {
      source: () => ({ getSnapshot: () => snapshot, subscribe }),
    }
    const hook = renderHook(
      ({ visible }) => useTenderProjection(port, 'session-1' as never, visible),
      { initialProps: { visible: true } },
    )
    expect(subscribe).toHaveBeenCalledTimes(1)
    hook.rerender({ visible: false })
    expect(dispose).toHaveBeenCalledTimes(1)

    snapshot = { status: 'unavailable' }
    act(() => { listeners.forEach(listener => { listener() }) })
    expect(hook.result.current.status).toBe('empty')

    hook.rerender({ visible: true })
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(hook.result.current.status).toBe('unavailable')
  })
})
