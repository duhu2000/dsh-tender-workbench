// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TenderHistoryView, type HistoryLoader } from '../src/client/workbench/TenderHistoryView.tsx'
import { LongTaskProgress } from '../src/client/workbench/SessionWriteProgress.tsx'
import { emptyExecution } from '../src/contracts/execution.ts'
import type { HistoryResponse } from '../src/contracts/history.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })
const response = (title = '历史 A'): HistoryResponse => ({ scope: 'profile', schemaVersion: 1, total: 1, page: 1, pageSize: 20, entries: [{
  taskId: 'task-A', originSessionId: 'A', originWorkspaceId: 'workspace-A', originWorkspaceTitle: '原工作区', title,
  createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z', revision: 5, status: 'completed', records: 2, reviewed: 2, pending: 0, deliverables: ['excel', 'pdf'], sourceAvailable: true,
}] })

it('opens only the recorded source explicitly; rendering/refresh never executes or rebinds a task', async () => {
  const open = vi.fn(async () => {}), load = vi.fn<HistoryLoader>(async () => response())
  render(<TenderHistoryView sessionId={'B' as never} load={load} openOriginSession={open} />)
  await screen.findByText('历史 A')
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('刷新历史')); await screen.findByText('历史 A')
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '打开来源会话' }))
  expect(open).toHaveBeenCalledExactlyOnceWith('A', 'B')
  expect(screen.queryByRole('button', { name: /下载|执行查询|复核任务/ })).toBeNull()
})

it('aborts A on Session switch and ignores its late response, including after unmount', async () => {
  const pending: { signal: AbortSignal; resolve: (r: HistoryResponse) => void }[] = []
  const load: HistoryLoader = (_id, _page, signal) => new Promise(resolve => pending.push({ signal, resolve }))
  const view = render(<TenderHistoryView sessionId={'A' as never} load={load} />)
  view.rerender(<TenderHistoryView sessionId={'B' as never} load={load} />)
  expect(pending[0]!.signal.aborted).toBe(true)
  await act(async () => pending[1]!.resolve(response('新快照 B')))
  await act(async () => pending[0]!.resolve(response('迟到 A')))
  expect(screen.queryByText('迟到 A')).toBeNull()
  expect(screen.getByText('新快照 B')).toBeTruthy()
  view.unmount(); expect(pending[1]!.signal.aborted).toBe(true)
})

it('distinguishes unavailable history from zero and disables unavailable origin navigation', async () => {
  const load: HistoryLoader = async () => { throw new Error('索引损坏') }
  const view = render(<TenderHistoryView sessionId={'B' as never} load={load} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '索引损坏')
  expect(screen.queryByText(/本页没有/)).toBeNull()
  view.unmount()
  const unavailable = response(); unavailable.entries[0]!.sourceAvailable = false
  render(<TenderHistoryView sessionId={'B' as never} load={async () => unavailable} openOriginSession={vi.fn()} />)
  await screen.findByText('历史 A')
  expect(screen.getByRole('button', { name: '打开来源会话' })).toHaveProperty('disabled', true)
})

it('renders actual initial counts and elapsed time; terminal snapshots stop the clock and retain independent semantics', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000)
  const running = emptyExecution('call', '查询中', 5_000)
  running.counts = { queried: 2, succeeded: 7, zero: 0, failed: 1, noPermission: 0, unknown: 0, needsReview: 3 }
  running.providers = { tender: 'data', proposed: 'failed' }; running.recentItem = '已返回招投标来源'
  const view = render(<LongTaskProgress execution={running} />)
  expect(screen.getByText(/耗时 5 秒/)).toBeTruthy()
  expect(screen.getByText(/成功记录 7 条/)).toBeTruthy()
  expect(screen.queryByText(/\d+%/)).toBeNull()
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByText(/耗时 7 秒/)).toBeTruthy()
  view.rerender(<LongTaskProgress execution={{ ...running, status: 'partial', finishedAt: 11_000 }} />)
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByText(/耗时 6 秒/)).toBeTruthy()
  expect(screen.getByLabelText('真实执行进度').getAttribute('data-execution-status')).toBe('partial')
  expect(vi.getTimerCount()).toBe(0)
  view.unmount(); expect(vi.getTimerCount()).toBe(0)
})
