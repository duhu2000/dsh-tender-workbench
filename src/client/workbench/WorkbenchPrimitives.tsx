import type { ReactNode } from 'react'
import css from './tender-workbench.module.css'

export type WorkbenchTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'purple'

export function PageHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly aside?: ReactNode
}) {
  return (
    <header className={css.pageHeading}>
      <div className={css.pageHeadingCopy}>
        <p className={css.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {aside === undefined ? null : <div className={css.pageHeadingAside}>{aside}</div>}
    </header>
  )
}

export function StatusPill({ tone = 'neutral', children }: {
  readonly tone?: WorkbenchTone
  readonly children: ReactNode
}) {
  return <span className={css.statusPill} data-tone={tone}>{children}</span>
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  dataClassification,
  muted = false,
}: {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly detail?: ReactNode
  readonly tone?: WorkbenchTone
  readonly dataClassification?: string
  readonly muted?: boolean
}) {
  return (
    <article
      className={css.metricCard}
      data-tone={tone}
      data-classification={dataClassification}
      data-zero={muted ? 'true' : 'false'}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {detail === undefined ? null : <small>{detail}</small>}
    </article>
  )
}

export function SurfaceHeader({ title, description, action }: {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly action?: ReactNode
}) {
  return (
    <header className={css.surfaceHeader}>
      <div><h3>{title}</h3>{description === undefined ? null : <p>{description}</p>}</div>
      {action === undefined ? null : <div className={css.surfaceActions}>{action}</div>}
    </header>
  )
}

export function ProgressMeter({ value, max, label }: {
  readonly value: number
  readonly max: number
  readonly label: string
}) {
  return (
    <div className={css.progressMeter}>
      <div><span>{label}</span><strong>{value} / {max}</strong></div>
      <progress value={Math.min(value, Math.max(1, max))} max={Math.max(1, max)} />
    </div>
  )
}

export function StatePanel({
  tone = 'neutral',
  title,
  description,
  action,
  role = 'status',
}: {
  readonly tone?: WorkbenchTone
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly action?: ReactNode
  readonly role?: 'status' | 'alert'
}) {
  return (
    <div className={css.statePanel} data-tone={tone} role={role}>
      <span className={css.stateMark} aria-hidden="true" />
      <div><strong>{title}</strong>{description === undefined ? null : <p>{description}</p>}</div>
      {action}
    </div>
  )
}
