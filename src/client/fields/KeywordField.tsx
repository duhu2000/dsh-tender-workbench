import type { TenderFieldProps } from './field-props.ts'
import css from '../tender-filter.module.css'

/** Keyword editor for the generated tender query. */
export function KeywordField({ filters, onChange, t }: TenderFieldProps) {
  return (
    <div className={css.filterRow}>
      <label className={css.rowLabel} htmlFor="dsh-tender-keywords">{t('field.keywords')}</label>
      <div className={css.rowContent}>
        <input
          id="dsh-tender-keywords"
          className={css.keywordInput}
          name="keywords"
          type="text"
          value={filters.keywords}
          placeholder={t('field.keywords.placeholder')}
          onChange={event => { onChange('keywords', event.target.value) }}
        />
      </div>
    </div>
  )
}
