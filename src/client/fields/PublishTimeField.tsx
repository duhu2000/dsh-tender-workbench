import type { TenderFieldProps } from './field-props.ts'
import { PUBLISH_OPTIONS } from './options.ts'
import css from '../tender-filter.module.css'

/** Publication preset and custom date-range controls. */
export function PublishTimeField({ filters, onChange, t }: TenderFieldProps) {
  const currentYear = new Date().getFullYear()
  const previousYears = Array.from({ length: 4 }, (_, index) => currentYear - index - 1)
  return (
    <div className={css.filterRow} role="group" aria-label={t('field.publishTime')}>
      <span className={css.rowLabel}>{t('field.publishTime')}</span>
      <div className={css.rowContent}>
        <div className={css.quickChoices}>
          {PUBLISH_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={css.quickChoice}
              aria-pressed={filters.publishPreset === option.value}
              onClick={() => { onChange('publishPreset', option.value) }}
            >
              {t(option.label)}
            </button>
          ))}
          <select
            className={css.yearSelect}
            aria-label={t('publish.priorYears')}
            value={filters.publishPreset === 'year' ? String(filters.publishYear ?? '') : ''}
            onChange={event => {
              if (event.target.value === '') return
              onChange('publishYear', Number(event.target.value))
              onChange('publishPreset', 'year')
            }}
          >
            <option value="">{t('publish.priorYears')}</option>
            {previousYears.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        {filters.publishPreset === 'custom' && (
          <div className={css.inlineDateRange}>
            <label><span>{t('field.customStart')}</span><input className={css.compactInput} type="date" value={filters.startDate ?? ''} onChange={event => { onChange('startDate', event.target.value === '' ? undefined : event.target.value) }} /></label>
            <span aria-hidden="true">—</span>
            <label><span>{t('field.customEnd')}</span><input className={css.compactInput} type="date" value={filters.endDate ?? ''} onChange={event => { onChange('endDate', event.target.value === '' ? undefined : event.target.value) }} /></label>
          </div>
        )}
      </div>
    </div>
  )
}
