import { useEffect, useState, type ReactNode } from 'react'
import { PROVIDER_LABELS, type TenderExecution } from '../../contracts/execution.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import type { TenderKey } from '../locales.ts'
import type {
  SessionWriteAction,
  SessionWriteFlight,
  SessionWritePhase,
  SessionWriteState,
} from './session-write-flight.ts'
import css from './tender-workbench.module.css'

type ActiveWritePhase = Exclude<SessionWritePhase, 'idle'>

export function LongTaskProgress({ execution }: { execution?: TenderExecution }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (execution?.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [execution?.operationId, execution?.status])
  if (!execution) return null
  const elapsed = Math.floor(Math.max(0, (execution.finishedAt ?? now) - execution.startedAt) / 1000)
  const { queried, succeeded, zero, failed, noPermission, unknown, needsReview } = execution.counts
  const action = execution.currentAction.startsWith('tender_workbench_') ? 'Host 正在执行已授权工作流操作' : execution.currentAction
  return <section className={css.executionProgress} data-execution-status={execution.status} aria-label="真实执行进度">
    <strong>{action}</strong><p>耗时 {elapsed} 秒 · {execution.status === 'running' ? '执行中（未估算百分比）' : execution.status === 'succeeded' ? '执行成功' : execution.status === 'partial' ? '执行部分成功' : execution.status === 'interrupted' ? '执行中断' : '执行失败'}</p>
    <p>实际查询返回 {queried} 个来源 · 成功记录 {succeeded} 条 · 零记录来源 {zero} · 失败来源 {failed} · 无权限来源 {noPermission} · 未知来源 {unknown} · 需复核记录 {needsReview}</p>
    <p>招投标：{PROVIDER_LABELS[execution.providers.tender]}；拟建项目：{PROVIDER_LABELS[execution.providers.proposed]}</p>
    {execution.recentItem && <p>最近处理：{execution.recentItem}</p>}
    <small>仅表示本次执行事实，不代表业务入选、风险程度或最终人工定案。</small>
  </section>
}

const PROGRESS_KEYS: Record<SessionWriteAction, Record<ActiveWritePhase, TenderKey>> = {
  'query.run': {
    sending: 'workbench.write.query.sending',
    'waiting-agent': 'workbench.write.query.waiting',
    running: 'workbench.write.query.running',
    succeeded: 'workbench.write.query.succeeded',
    failed: 'workbench.write.query.failed',
  },
  'rules.propose': {
    sending: 'workbench.write.propose.sending',
    'waiting-agent': 'workbench.write.propose.waiting',
    running: 'workbench.write.propose.running',
    succeeded: 'workbench.write.propose.succeeded',
    failed: 'workbench.write.propose.failed',
  },
  'rules.adjust': {
    sending: 'workbench.write.adjust.sending',
    'waiting-agent': 'workbench.write.adjust.waiting',
    running: 'workbench.write.adjust.running',
    succeeded: 'workbench.write.adjust.succeeded',
    failed: 'workbench.write.adjust.failed',
  },
  'rules.preview': {
    sending: 'workbench.write.preview.sending',
    'waiting-agent': 'workbench.write.preview.waiting',
    running: 'workbench.write.preview.running',
    succeeded: 'workbench.write.preview.succeeded',
    failed: 'workbench.write.preview.failed',
  },
  'rules.confirm': {
    sending: 'workbench.write.confirm.sending',
    'waiting-agent': 'workbench.write.confirm.waiting',
    running: 'workbench.write.confirm.running',
    succeeded: 'workbench.write.confirm.succeeded',
    failed: 'workbench.write.confirm.failed',
  },
  'analysis.run': {
    sending: 'workbench.write.analysis.sending',
    'waiting-agent': 'workbench.write.analysis.waiting',
    running: 'workbench.write.analysis.running',
    succeeded: 'workbench.write.analysis.succeeded',
    failed: 'workbench.write.analysis.failed',
  },
  'review.apply': {
    sending: 'workbench.write.review.sending',
    'waiting-agent': 'workbench.write.review.waiting',
    running: 'workbench.write.review.running',
    succeeded: 'workbench.write.review.succeeded',
    failed: 'workbench.write.review.failed',
  },
  'review.revert': {
    sending: 'workbench.write.revert.sending',
    'waiting-agent': 'workbench.write.revert.waiting',
    running: 'workbench.write.revert.running',
    succeeded: 'workbench.write.revert.succeeded',
    failed: 'workbench.write.revert.failed',
  },
  'report.create': {
    sending: 'workbench.write.report.sending',
    'waiting-agent': 'workbench.write.report.waiting',
    running: 'workbench.write.report.running',
    succeeded: 'workbench.write.report.succeeded',
    failed: 'workbench.write.report.failed',
  },
  'report.retry': {
    sending: 'workbench.write.reportRetry.sending',
    'waiting-agent': 'workbench.write.reportRetry.waiting',
    running: 'workbench.write.reportRetry.running',
    succeeded: 'workbench.write.reportRetry.succeeded',
    failed: 'workbench.write.reportRetry.failed',
  },
}

export function sessionWriteProgressText(
  t: TenderTranslate,
  state: SessionWriteState,
): string | undefined {
  if (state.action === undefined || state.phase === 'idle') return undefined
  return t(PROGRESS_KEYS[state.action][state.phase])
}

function Spinner(): ReactNode {
  return <span className={css.spinner} aria-hidden="true" />
}

export function SessionWriteButtonLabel({
  action,
  idle,
  t,
  write,
}: {
  readonly action: SessionWriteAction
  readonly idle: ReactNode
  readonly t: TenderTranslate
  readonly write: SessionWriteFlight
}) {
  const isCurrent = write.state.action === action
    && (write.state.phase === 'sending'
      || write.state.phase === 'waiting-agent'
      || write.state.phase === 'running')
  return (
    <>
      {isCurrent && <Spinner />}
      <span>{isCurrent ? sessionWriteProgressText(t, write.state) : idle}</span>
    </>
  )
}

export function SessionWriteProgress({
  id,
  t,
  write,
}: {
  readonly id?: string
  readonly t: TenderTranslate
  readonly write: SessionWriteFlight
}) {
  const text = sessionWriteProgressText(t, write.state)
  const busy = write.state.phase === 'sending'
    || write.state.phase === 'waiting-agent'
    || write.state.phase === 'running'
  if (text === undefined || (!busy && write.state.phase !== 'failed')) return null
  const failed = write.state.phase === 'failed'
  return (
    <div
      id={id}
      className={css.writeProgress}
      data-write-action={write.state.action}
      data-write-phase={write.state.phase}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? undefined : 'polite'}
    >
      {busy && <Spinner />}
      <span>
        <strong>{text}</strong>
        <small>{failed
          ? t(write.state.failure === 'transport'
            ? 'workbench.write.transportFailed'
            : 'workbench.write.workflowFailed')
          : t('workbench.write.busyReason', { action: text })}</small>
      </span>
      {failed && write.state.failure === 'transport' && (
        <button type="button" className={css.secondary} onClick={() => { write.retry() }}>
          {t('workbench.write.retry')}
        </button>
      )}
    </div>
  )
}
