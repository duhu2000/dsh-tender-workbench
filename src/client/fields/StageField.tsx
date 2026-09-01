import { useState } from 'react'
import type { TenderFieldProps } from './field-props.ts'
import {
  APPROVAL_PROGRESS_OPTIONS, AWARD_STAGE_OPTIONS, PROPOSED_STAGE_OPTIONS, TENDER_STAGE_OPTIONS,
} from './options.ts'
import css from '../tender-filter.module.css'

interface ChoiceFieldProps {
  readonly label: string
  readonly options: readonly string[]
  readonly values: readonly string[]
  readonly onChange: (values: string[]) => void
  readonly visibleLimit?: number
  readonly moreLabel?: string
  readonly lessLabel?: string
}

function ChoiceField({ label, options, values, onChange, visibleLimit, moreLabel, lessLabel }: ChoiceFieldProps) {
  const [expanded, setExpanded] = useState(false)
  const toggle = (value: string): void => {
    onChange(values.includes(value) ? values.filter(candidate => candidate !== value) : [...values, value])
  }
  const visibleOptions = expanded || visibleLimit === undefined ? options : options.slice(0, visibleLimit)
  const hasMore = visibleLimit !== undefined && options.length > visibleLimit
  return (
    <div className={css.filterRow} role="group" aria-label={label}>
      <span className={css.rowLabel}>{label}</span>
      <div className={`${css.rowContent} ${css.quickChoices}`}>
        {visibleOptions.map(option => (
          <button key={option} type="button" className={css.quickChoice} aria-pressed={values.includes(option)} onClick={() => { toggle(option) }}>
            {option}
          </button>
        ))}
        {hasMore && (
          <button type="button" className={css.moreChoice} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
            {expanded ? lessLabel : moreLabel}<span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** Stage controls adapt to 招标、中标、拟建项目 without leaking inactive values. */
export function StageField({ filters, onChange, t }: TenderFieldProps) {
  if (filters.searchMode === 'proposed') {
    return (
      <>
        <ChoiceField label={t('field.proposedStages')} options={PROPOSED_STAGE_OPTIONS} values={filters.proposedStages} onChange={value => { onChange('proposedStages', value) }} visibleLimit={10} moreLabel={t('option.more')} lessLabel={t('option.less')} />
        <ChoiceField label={t('field.approvalProgress')} options={APPROVAL_PROGRESS_OPTIONS} values={filters.approvalProgress} onChange={value => { onChange('approvalProgress', value) }} />
      </>
    )
  }
  if (filters.noticeType === 'wtb') {
    return <ChoiceField label={t('field.awardStages')} options={AWARD_STAGE_OPTIONS} values={filters.awardStages} onChange={value => { onChange('awardStages', value) }} />
  }
  if (filters.noticeType === 'all') return null
  return <ChoiceField label={t('field.tenderStages')} options={TENDER_STAGE_OPTIONS} values={filters.tenderStages} onChange={value => { onChange('tenderStages', value) }} />
}
