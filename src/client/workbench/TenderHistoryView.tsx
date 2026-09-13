import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HistoryResponseSchema, type HistoryResponse } from '../../contracts/history.ts'
import css from './tender-workbench.module.css'

export type HistoryLoader = (sessionId: SessionId, page: number, signal: AbortSignal) => Promise<HistoryResponse>
export const loadTenderHistory: HistoryLoader = async (sessionId, page, signal) => {
  const response = await fetch(`/dsh-tender-workbench/api/v1/history?page=${page}`, {
    headers: { 'X-Dsh-Tender-Session': sessionId }, credentials: 'same-origin', cache: 'no-store', signal,
  })
  if (!response.ok) throw new Error('历史暂不可读，请检查本地存储或宿主能力后重试。来源会话仍可从宿主进入。')
  return HistoryResponseSchema.parse(await response.json())
}
const labels = { 'in-progress': '处理中 / 已保存', 'needs-review': '待人工核验', partial: '部分交付', completed: '已完成', failed: '执行失败' }
export function TenderHistoryView({ sessionId, load = loadTenderHistory, openOriginSession }: {
  sessionId: SessionId; load?: HistoryLoader; openOriginSession?: (origin: SessionId, from: SessionId) => Promise<void>
}) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ sessionId: SessionId; page: number; data: HistoryResponse }>()
  const [error, setError] = useState<string>(), [opening, setOpening] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    setError(undefined); setResult(undefined)
    void load(sessionId, page, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ sessionId, page, data })
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '历史读取失败') })
    return () => controller.abort()
  }, [sessionId, page, refresh, load])
  const data = result?.sessionId === sessionId && result.page === page ? result.data : undefined
  return <section className={css.stagePanel} aria-label="Profile 任务历史">
    <header className={css.pageHeading}><div><h2>任务历史 · 当前 Profile</h2><p>只读摘要。来源 Workspace / Session 不变；不会将旧任务重绑到当前任务。完整消息、证据、Excel/PDF 留在来源会话。</p></div></header>
    <button type="button" className={css.secondary} onClick={() => setRefresh(n => n + 1)}>刷新历史</button>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">正在读取持久历史…</p> : <>
      <p>共 {data.total} 项 · 第 {page} 页。升级前未重新打开的会话可能尚未入索引。</p>
      {data.entries.length === 0 ? <p>本页没有已索引任务；不代表来源会话不存在。</p> : data.entries.map(entry => <article key={`${entry.originSessionId}:${entry.taskId}`} className={css.historyEntry}>
        <h3>{entry.title}</h3><p data-execution-status={entry.status}>{labels[entry.status]}</p>
        <dl><dt>来源 Workspace</dt><dd>{entry.originWorkspaceTitle} · {entry.originWorkspaceId ?? '未绑定'}</dd>
          <dt>来源 Session</dt><dd>{entry.originSessionId}</dd><dt>任务</dt><dd>{entry.taskId}</dd>
          <dt>时间</dt><dd>{entry.createdAt} / 最近保存 {entry.updatedAt}</dd>
          <dt>结果</dt><dd>{entry.records === null ? '记录数未知' : `${entry.records} 条`} · 已复核 {entry.reviewed} · 待核验 {entry.pending}</dd>
          <dt>客户交付物</dt><dd>{entry.deliverables.length ? entry.deliverables.map(f => f.toUpperCase()).join(' / ') : '尚未生成'}</dd></dl>
        <p>此页不执行查询、复核或下载。打开来源会话不回滚该会话当前任务；旧快照与制品请查看原消息。</p>
        <button type="button" className={css.secondary} disabled={!entry.sourceAvailable || !openOriginSession || opening !== undefined} onClick={() => {
          setOpening(entry.taskId)
          void openOriginSession?.(entry.originSessionId as SessionId, sessionId).catch(() => setError('来源会话打开失败或已切换；请从宿主历史会话进入。')).finally(() => setOpening(undefined))
        }}>打开来源会话</button>
        {(!entry.sourceAvailable || !openOriginSession) && <p>来源归属或宿主打开能力不可用；请通过宿主历史查找以上 Session，不会另建或迁移任务。</p>}
      </article>)}
      <div className={css.inlineActions}><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><button type="button" disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button></div>
    </>}
  </section>
}
