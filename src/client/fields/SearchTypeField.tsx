import type { Ref } from 'react'
import type { TenderFieldProps } from './field-props.ts'
import css from '../tender-filter.module.css'

interface SearchTypeFieldProps extends TenderFieldProps {
  readonly firstControlRef: Ref<HTMLButtonElement>
}

/** Required first-step selector for the top-level search mode and tender branch. */
export function SearchTypeField({ filters, onChange, t, firstControlRef }: SearchTypeFieldProps) {
  const selectNoticeType = (value: 'all' | 'ifb' | 'wtb'): void => {
    if (filters.noticeType === value) return
    onChange('noticeType', value)
  }
  return (
    <div className={css.modeFields}>
      <div className={css.modeGroup} role="group" aria-label={t('field.searchMode')}>
        <span className={css.modeLabel}>{t('field.searchMode')}</span>
        <div className={css.segmentedControl}>
          <button ref={firstControlRef} type="button" className={css.segmentedButton} aria-pressed={filters.searchMode === 'tender'} onClick={() => { onChange('searchMode', 'tender') }}>
            {t('searchMode.tender')}
          </button>
          <button type="button" className={css.segmentedButton} aria-pressed={filters.searchMode === 'proposed'} onClick={() => { onChange('searchMode', 'proposed') }}>
            {t('searchMode.proposed')}
          </button>
        </div>
      </div>

      {filters.searchMode === 'tender' && (
        <div className={css.modeGroup} role="group" aria-label={t('field.noticeType')}>
          <span className={css.modeLabel}>{t('field.noticeType')}</span>
          <div className={css.segmentedControl}>
            <button type="button" className={css.segmentedButton} aria-pressed={filters.noticeType === 'all'} onClick={() => { selectNoticeType('all') }}>{t('notice.all')}</button>
            <button type="button" className={css.segmentedButton} aria-pressed={filters.noticeType === 'ifb'} onClick={() => { selectNoticeType('ifb') }}>{t('notice.ifb')}</button>
            <button type="button" className={css.segmentedButton} aria-pressed={filters.noticeType === 'wtb'} onClick={() => { selectNoticeType('wtb') }}>{t('notice.wtb')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
