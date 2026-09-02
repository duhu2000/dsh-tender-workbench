import type { ReactNode } from 'react'
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

const PROGRESS_KEYS: Record<SessionWriteAction, Record<ActiveWritePhase, TenderKey>> = {
  query: {
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
