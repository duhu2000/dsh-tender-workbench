import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TenderHistoryIndex, historyEntry, profileHistoryPath, registerTenderHistory } from '../src/host/history.ts'
import type { HistoryEntry } from '../src/contracts/history.ts'
import { emptyExecution } from '../src/contracts/execution.ts'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import { tenderWorkflowProjectionDefinition as projection } from '../src/host/projection.ts'
import { adaptQccTenderPayload, adaptQccProposedPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { historyRequestIdentity } from '../src/host/http-trust.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function root() { const path = await mkdtemp(join(tmpdir(), 'tender-history-test-')); roots.push(path); return path }
const row = (session = 'A', task = 'task-1'): HistoryEntry => ({ taskId: task, originSessionId: session, originWorkspaceId: 'w-A', originWorkspaceTitle: '甲工作区', title: '合成查询', createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z', revision: 1, status: 'in-progress', records: 2, reviewed: 0, pending: 2, deliverables: [] })

describe('Profile history persistence and ownership', () => {
  it('persists A/B and multiple tasks; restarts without rebinding or storing artifacts/tokens', async () => {
    const path = join(await root(), 'history.json'), index = new TenderHistoryIndex(path)
    await Promise.all([index.put(row('A')), index.put(row('B')), index.put(row('A', 'task-2'))])
    await index.close()
    const recovered = new TenderHistoryIndex(path)
    expect(await recovered.list()).toHaveLength(3)
    expect((await recovered.list()).map(x => x.originSessionId).sort()).toEqual(['A', 'A', 'B'])
    expect(await readFile(path, 'utf8')).not.toMatch(/accessToken|artifactToken|projection|source-data/)
    const snapshot = await recovered.list(); snapshot[0]!.title = 'tampered'
    expect((await recovered.list())[0]!.title).toBe('合成查询')
    await recovered.close()
  })
  it('latches completion and immutable origin; a new query is a distinct task', async () => {
    const index = new TenderHistoryIndex(join(await root(), 'history.json'))
    await index.put(row())
    await index.put({ ...row(), revision: 2, originWorkspaceId: 'w-B', originWorkspaceTitle: '乙', status: 'completed', pending: 0, reviewed: 2, deliverables: ['excel', 'pdf'] })
    await index.put({ ...row(), revision: 3, status: 'failed' })
    expect((await index.list())[0]).toMatchObject({ status: 'completed', revision: 2, originWorkspaceId: 'w-A', originWorkspaceTitle: '甲工作区' })
    await index.put(row('A', 'new-query')); expect(await index.list()).toHaveLength(2)
    await index.close()
  })
  it('isolates Profiles and surfaces corruption without overwriting it', async () => {
    const folder = await root(), first = new TenderHistoryIndex(join(folder, 'first.json')), second = new TenderHistoryIndex(join(folder, 'second.json'))
    await first.put(row()); expect(await second.list()).toEqual([])
    const bad = join(folder, 'corrupt.json'); await writeFile(bad, 'broken')
    const broken = new TenderHistoryIndex(bad)
    await expect(broken.list()).rejects.toThrow(); await expect(broken.put(row())).rejects.toThrow()
    expect(await readFile(bad, 'utf8')).toBe('broken')
    await first.close(); await second.close(); await broken.close()
  })
  it('uses the Loader Profile anchor, never implicit process cwd', () => {
    const folder = join(tmpdir(), 'profiles', 'web')
    expect(profileHistoryPath({ ctx: { baseUrl: pathToFileURL(join(folder, 'root.yml')).href } })).toBe(join(folder, '.dsh-tender-workbench/history-v1.json'))
    expect(profileHistoryPath(undefined)).toBeUndefined()
    expect(profileHistoryPath({ ctx: { baseUrl: 'https://example.org/' } })).toBeUndefined()
  })
  it('takes startup snapshots, retains read-only registration and cleans all subscriptions on remount', async () => {
    const folder = await root(), state = createEmptyTenderWorkflowProjection()
    const header = { id: 'A', createdAt: 1, version: 0, isSeeded: false } as SessionHeader
    state.query = { scope: 'tender', targetSummary: '启动已有任务', sources: {}, total: 0, duplicateCount: 0, invalidCount: 0,
      querySpec: { id: 'task', kind: 'query-spec', createdAt: '2026-09-13T00:00:00Z', fileName: 'query.json', mediaType: 'application/json', accessToken: 'never-index-this' } }
    const disposed = [vi.fn(), vi.fn(), vi.fn()]
    let route: any
    const ctx = { get: () => ({ ctx: { baseUrl: pathToFileURL(join(folder, 'root.yml')).href } }),
      sessions: { list: () => [{ id: 'A', header }], get: () => undefined },
      workspaceRegistry: { list: () => [{ id: 'workspace', title: '起源', sessionIds: ['A'] }] },
      sessionProjections: { stateOf: () => state, onChanged: () => disposed[0] },
      on: () => disposed[1], webServer: { host: '127.0.0.1', register: (value: any) => { route = value; return disposed[2] } } } as unknown as Context
    const dispose = registerTenderHistory(ctx)
    const response = { writeHead: vi.fn(), end: vi.fn() }
    await route.handler({ method: 'POST' }, response)
    expect(response.writeHead.mock.calls[0]?.[0]).toBe(405)
    response.writeHead.mockClear(); response.end.mockClear()
    await route.handler({ method: 'GET', url: '/dsh-tender-workbench/api/v1/history', rawHeaders: ['host', '127.0.0.1:3080', 'x-dsh-tender-session', 'A', 'sec-fetch-site', 'same-origin'], socket: { remoteAddress: '127.0.0.1' } }, response)
    expect(response.writeHead.mock.calls[0]?.[0]).toBe(200) // membership exists before live Session hydration
    expect(JSON.parse(response.end.mock.calls[0]?.[0]).entries[0].originSessionId).toBe('A')
    await dispose(); expect(disposed.every(fn => fn.mock.calls.length === 1)).toBe(true)
    const index = new TenderHistoryIndex(join(folder, '.dsh-tender-workbench/history-v1.json'))
    expect((await index.list())[0]).toMatchObject({ originSessionId: 'A', originWorkspaceId: 'workspace', title: '启动已有任务' })
    expect(historyEntry(header, createEmptyTenderWorkflowProjection())).toBeUndefined()
    await index.close()
  })
  it('requires same-origin loopback and a unique source Session header', () => {
    const req = (headers: string[], address = '127.0.0.1') => ({ rawHeaders: headers, socket: { remoteAddress: address } }) as never
    const valid = ['host', '127.0.0.1:3080', 'x-dsh-tender-session', 'A', 'origin', 'http://127.0.0.1:3080']
    expect(historyRequestIdentity(req(valid))).toBe('A')
    expect(historyRequestIdentity(req(valid, '8.8.8.8'))).toBeUndefined()
    expect(historyRequestIdentity(req([...valid, 'x-dsh-tender-session', 'B']))).toBeUndefined()
    expect(historyRequestIdentity(req([...valid, 'sec-fetch-site', 'cross-site']))).toBeUndefined()
    expect(historyRequestIdentity(req(valid.slice(0, 4)))).toBeUndefined()
  })
})

describe('Provider result contracts', () => {
  it.each([0, '0', 200, '200'])('unwraps explicit QCC wrapper code %s and numeric-string totals', code => {
    expect(adaptQccTenderPayload({ Status: code, Result: { 查询摘要: { 命中总数: '1' }, 标讯列表: [{ 标讯ID: '1', 标题: '测试' }] } })).toMatchObject({ rawRecordCount: 1, summary: { 命中总数: 1 } })
  })
  it('accepts direct and wrapped zero only with an explicit empty array', () => {
    expect(adaptQccProposedPayload({ success: true, data: { 拟建项目列表: [] } }).rawRecordCount).toBe(0)
    expect(() => adaptQccTenderPayload({ 查询摘要: { 命中总数: '0' } })).toThrow('未知')
    expect(() => adaptQccTenderPayload({ 标讯列表: null })).toThrow('未知')
  })
  it.each(['401', 403, 'FORBIDDEN', 'NO_PERMISSION'])('preserves denied response %s instead of zero', code => {
    expect(() => adaptQccTenderPayload({ code, data: { 标讯列表: [] } })).toThrow('权限不足')
  })
  it('does not hide wrapper errors behind a valid-looking empty list', () => {
    expect(() => adaptQccTenderPayload({ success: false, 标讯列表: [] })).toThrow('明确返回失败')
    expect(() => adaptQccTenderPayload({ isError: true, structuredContent: { 标讯列表: [] } })).toThrow('明确返回失败')
    expect(() => adaptQccTenderPayload({ code: 500, Result: { 标讯列表: [] } })).toThrow('明确返回失败')
    expect(() => adaptQccTenderPayload({ arbitrary: { 标讯列表: [] } })).toThrow('未知')
  })
})

describe('real execution fold', () => {
  it('is Session-local, rejects late/foreign progress and never regresses a terminal operation', () => {
    let state = createEmptyTenderWorkflowProjection()
    const call = { seq: 1, time: 100, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-A', name: 'tender_workbench_run_query', arguments: JSON.stringify({ origin: { kind: 'conversation' } }) } } as unknown as SessionEvent
    state = projection.apply(state, call)!
    const progress = { ...emptyExecution('call-A', '查询来源', 100), updatedAt: 200, counts: { queried: 1, succeeded: 2, zero: 0, failed: 0, noPermission: 0, unknown: 0, needsReview: 0 } }
    const event = { type: 'dsh-tender/progress', seq: 2, time: 200, data: progress } as unknown as SessionEvent
    state = projection.apply(state, event)!
    expect(state.execution?.counts.succeeded).toBe(2)
    expect(projection.apply(null, event)).toBeNull()
    expect(projection.apply(state, { ...event, data: { ...progress, updatedAt: 150 } } as SessionEvent)).toBe(state)
    expect(projection.apply(state, { ...event, data: { ...progress, operationId: 'B' } } as SessionEvent)).toBe(state)
    const terminal = { ...state, execution: { ...state.execution!, status: 'succeeded' as const, finishedAt: 300 } }
    expect(projection.apply(terminal, event)).toBe(terminal)
    expect(terminal.revision).toBe(0) // telemetry does not advance business revision
  })
})
