import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { z } from 'zod'
import { HistoryEntrySchema, type HistoryEntry } from '../contracts/history.ts'
import { TenderWorkflowProjectionV2Schema, type TenderWorkflowProjectionV2 } from '../contracts/workflow.ts'
import { historyRequestIdentity } from './http-trust.ts'

const IndexSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(HistoryEntrySchema) }).strict()
export const HISTORY_ROUTE = '/dsh-tender-workbench/api/v1/history'

/** One Profile's derivative metadata only. Never stores raw data, tokens, or writable projections. */
export class TenderHistoryIndex {
  private entries = new Map<string, HistoryEntry>()
  private tail: Promise<void> = Promise.resolve()
  readonly ready: Promise<void>
  private closed = false
  constructor(private readonly path: string) {
    this.ready = readFile(path, 'utf8').then(raw => {
      for (const entry of IndexSchema.parse(JSON.parse(raw)).entries) this.entries.set(this.key(entry), entry)
    }).catch(error => { if (error.code !== 'ENOENT') throw error })
    // Keep failures visible to every read/write without an unhandled startup rejection.
    void this.ready.catch(() => {})
  }
  private key(entry: HistoryEntry) { return `${entry.originSessionId}:${entry.taskId}` }
  async put(entry: HistoryEntry): Promise<void> {
    if (this.closed) return
    const operation = this.tail.then(async () => {
      await this.ready
      const validated = HistoryEntrySchema.parse(entry), key = this.key(validated), old = this.entries.get(key)
      if (old && (old.revision > entry.revision || old.status === 'completed')) return
      // Origin is immutable, including when the Workspace is later renamed/deleted.
      const next = old ? { ...validated, originWorkspaceId: old.originWorkspaceId, originWorkspaceTitle: old.originWorkspaceTitle } : validated
      if (JSON.stringify(old) === JSON.stringify(next)) return
      const entries = new Map(this.entries); entries.set(key, next)
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, entries: [...entries.values()] }), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
      this.entries = entries
    })
    this.tail = operation.catch(() => {})
    return operation
  }
  async list(): Promise<HistoryEntry[]> {
    await this.ready; await this.tail
    return [...this.entries.values()].map(entry => structuredClone(entry)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.taskId.localeCompare(b.taskId))
  }
  async close() { this.closed = true; await this.tail }
}

export function historyEntry(header: SessionHeader, state: TenderWorkflowProjectionV2, workspace?: { id: string; title: string }): HistoryEntry | undefined {
  const failedAttempt = state.execution
  if (failedAttempt?.queryTarget && ['failed', 'interrupted'].includes(failedAttempt.status)) return HistoryEntrySchema.parse({
    taskId: failedAttempt.operationId, originSessionId: String(header.id), originWorkspaceId: workspace?.id ?? null,
    originWorkspaceTitle: workspace?.title.slice(0, 200) ?? '原任务未绑定 Workspace', title: failedAttempt.queryTarget,
    createdAt: new Date(failedAttempt.startedAt).toISOString(), updatedAt: new Date(failedAttempt.finishedAt ?? failedAttempt.updatedAt).toISOString(),
    revision: state.revision, status: 'failed', records: null, reviewed: 0, pending: 0, deliverables: [],
  })
  const query = state.query
  if (!query) return undefined // no invented tasks for a blank Session / navigation
  const report = state.report
  const completed = report?.completeness === 'complete' && report.excel.status === 'succeeded' && report.pdf.status === 'succeeded'
  const times = Object.values(state.stages).flatMap(stage => stage.updatedAt ? [stage.updatedAt] : [])
  return HistoryEntrySchema.parse({
    taskId: query.querySpec.id, originSessionId: String(header.id), originWorkspaceId: workspace?.id ?? null,
    originWorkspaceTitle: workspace?.title.slice(0, 200) ?? '原任务未绑定 Workspace', title: query.targetSummary,
    createdAt: query.querySpec.createdAt, updatedAt: times.sort().at(-1) ?? query.querySpec.createdAt, revision: state.revision,
    status: completed ? 'completed' : state.stages[state.currentStage].status === 'failed' ? 'failed' : report?.finalSnapshot ? 'partial' : (state.review?.pending ?? state.classification?.manualReview ?? 0) > 0 ? 'needs-review' : 'in-progress',
    records: query.total, reviewed: report?.reviewed ?? (state.review ? state.review.confirmedCandidate + state.review.watch + state.review.exclude : 0),
    pending: state.review?.pending ?? state.classification?.manualReview ?? 0,
    deliverables: ['excel', 'pdf'].filter(format => report?.[format as 'excel' | 'pdf'].status === 'succeeded'),
  })
}

/** Loader root baseUrl is the public, verified Profile anchor; never default to process cwd/HOME. */
export function profileHistoryPath(loader: unknown): string | undefined {
  const baseUrl = (loader as { ctx?: { baseUrl?: unknown } } | undefined)?.ctx?.baseUrl
  if (typeof baseUrl !== 'string') return undefined
  try {
    const url = new URL('.', baseUrl)
    if (url.protocol !== 'file:') return undefined
    return join(fileURLToPath(url), '.dsh-tender-workbench', 'history-v1.json')
  } catch { return undefined }
}

export function registerTenderHistory(ctx: Context): () => Promise<void> {
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('History requires loopback Host')
  const path = profileHistoryPath(ctx.get('loader'))
  const index = path ? new TenderHistoryIndex(path) : undefined
  let disposed = false, lastError = false
  const capture = (session: Session, raw: unknown) => {
    if (!index || disposed) return
    const parsed = TenderWorkflowProjectionV2Schema.safeParse(raw)
    if (!parsed.success) return
    try {
      const workspace = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(session.id))
      const entry = historyEntry(session.header, parsed.data, workspace)
      if (entry) void index.put(entry).catch(() => { lastError = true })
    } catch { lastError = true } // derivative indexing must not interrupt the business projection
  }
  const unsubscribe = ctx.sessionProjections.onChanged((session, key, value) => {
    if (key === 'dshTenderWorkflow') capture(session, value)
  })
  // Existing live Sessions / re-mounted plugin: take a real initial snapshot, not just future events.
  for (const session of ctx.sessions.list()) capture(session, ctx.sessionProjections.stateOf(session, 'dshTenderWorkflow'))
  const created = ctx.on('session/created', session => capture(session, ctx.sessionProjections.stateOf(session, 'dshTenderWorkflow')))
  const unregister = ctx.webServer.register({ kind: 'exact', path: HISTORY_ROUTE, async handler(req, res) {
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)) }
    if (req.method !== 'GET') { json(405, { error: '只读历史' }); return }
    const identity = historyRequestIdentity(req)
    // A listed Session need not be live yet immediately after host restart/navigation.
    // Profile membership is sufficient for read-only metadata, never artifact access.
    if (!identity || (!ctx.sessions.get(identity as SessionId)
      && !ctx.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(identity as SessionId)))) {
      json(403, { error: '来源请求不可验证' }); return
    }
    if (!index || lastError) { json(503, { error: '当前 Profile 历史不可用，请检查宿主能力或本地存储；来源会话不受影响。' }); return }
    try {
      const url = new URL(req.url ?? HISTORY_ROUTE, 'http://127.0.0.1')
      const page = Number(url.searchParams.get('page') ?? 1), pageSize = 20
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) { json(400, { error: '页码无效' }); return }
      const rows = await index.list(), workspaces = ctx.workspaceRegistry.list()
      const entries = rows.slice((page - 1) * pageSize, page * pageSize).map(entry => ({ ...entry,
        sourceAvailable: workspaces.some(w => String(w.id) === entry.originWorkspaceId && w.sessionIds.includes(entry.originSessionId as SessionId)) }))
      json(200, { schemaVersion: 1, scope: 'profile', entries, page, pageSize, total: rows.length })
    } catch { json(503, { error: '历史索引读取失败；没有将错误视为空历史。' }) }
  } })
  return async () => { disposed = true; unsubscribe(); created(); unregister(); await index?.close() }
}
