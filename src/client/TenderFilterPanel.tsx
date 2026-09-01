import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TenderTranslate } from './fields/field-props.ts'
import { AdvancedFields } from './fields/AdvancedFields.tsx'
import { KeywordField } from './fields/KeywordField.tsx'
import { RegionField } from './fields/RegionField.tsx'
import { PublishTimeField } from './fields/PublishTimeField.tsx'
import { SearchTypeField } from './fields/SearchTypeField.tsx'
import { StageField } from './fields/StageField.tsx'
import type { TenderFilters } from './types.ts'
import { validateTenderFilters, type TenderValidationErrors } from './validation.ts'
import css from './tender-filter.module.css'

export interface TenderFilterPanelProps {
  readonly filters: TenderFilters
  readonly onChange: <K extends keyof TenderFilters>(key: K, value: TenderFilters[K]) => void
  readonly onReset: () => void
  readonly onCancel: () => void
  readonly onConfirm: () => boolean
  readonly writeError: boolean
  readonly t: TenderTranslate
}

function dateError(errors: TenderValidationErrors, t: TenderTranslate): string | undefined {
  if (errors.dates === 'required') return t('error.customDateRequired')
  if (errors.dates === 'order') return t('error.dateOrder')
  return undefined
}

function amountError(errors: TenderValidationErrors, t: TenderTranslate): string | undefined {
  if (errors.amount === 'invalid') return t('error.amountInvalid')
  if (errors.amount === 'order') return t('error.amountOrder')
  return undefined
}

function keywordError(errors: TenderValidationErrors, t: TenderTranslate): string | undefined {
  return errors.keywords === 'limit' ? t('error.keywordLimit') : undefined
}

function regionError(errors: TenderValidationErrors, t: TenderTranslate): string | undefined {
  if (errors.regions === 'limit') return t('error.regionLimit')
  if (errors.regions === 'unsupported') return t('error.regionUnsupported')
  return undefined
}

/** Portal-backed modal drawer containing all tender filter controls. */
export function TenderFilterPanel({
  filters, onChange, onReset, onCancel, onConfirm, writeError, t,
}: TenderFilterPanelProps) {
  const titleId = useId()
  const descriptionId = useId()
  const firstControlRef = useRef<HTMLButtonElement>(null)
  const lastControlRef = useRef<HTMLButtonElement>(null)
  const [errors, setErrors] = useState<TenderValidationErrors>({})

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstControlRef.current?.focus()
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => { setErrors({}) }, [filters])

  const handleConfirm = (): void => {
    const nextErrors = validateTenderFilters(filters)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length !== 0) return
    onConfirm()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    if (event.shiftKey && document.activeElement === firstControlRef.current) {
      event.preventDefault()
      lastControlRef.current?.focus()
    } else if (!event.shiftKey && document.activeElement === lastControlRef.current) {
      event.preventDefault()
      firstControlRef.current?.focus()
    }
  }

  const currentDateError = dateError(errors, t)
  const currentAmountError = amountError(errors, t)
  const currentKeywordError = keywordError(errors, t)
  const currentRegionError = regionError(errors, t)
  return createPortal(
    <div
      className={css.backdrop}
      data-dsh-plugin="tender-workbench"
      data-dsh-part="backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}
    >
      <div
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-dsh-part="panel"
        onKeyDown={handleKeyDown}
      >
        <header className={css.header}>
          <div>
            <h2 className={css.title} id={titleId}>{t('dialog.title')}</h2>
            <p className={css.description} id={descriptionId}>{t('dialog.description')}</p>
          </div>
          <button type="button" className={css.iconButton} aria-label={t('dialog.close')} onClick={onCancel}>
            <IconCloseOutline16 size={18} />
          </button>
        </header>

        <div className={css.body}>
          <section className={css.modeBar} aria-labelledby={`${titleId}-mode`}>
            <h3 className={css.visuallyHidden} id={`${titleId}-mode`}>{t('section.searchMode')}</h3>
            <SearchTypeField filters={filters} onChange={onChange} t={t} firstControlRef={firstControlRef} />
          </section>

          <section className={css.filterCanvas} aria-label={t('dialog.description')}>
            <KeywordField filters={filters} onChange={onChange} t={t} />
            {currentKeywordError !== undefined && <p className={css.error} role="alert">{currentKeywordError}</p>}
            <PublishTimeField filters={filters} onChange={onChange} t={t} />
            {currentDateError !== undefined && <p className={css.error} role="alert">{currentDateError}</p>}
            <RegionField filters={filters} onChange={onChange} t={t} />
            {currentRegionError !== undefined && <p className={css.error} role="alert">{currentRegionError}</p>}
            <StageField filters={filters} onChange={onChange} t={t} />
            <div className={css.filterRow}>
              <span className={css.rowLabel}>{t('section.advanced')}</span>
              <div className={css.rowContent}><AdvancedFields filters={filters} onChange={onChange} t={t} /></div>
            </div>
            {currentAmountError !== undefined && <p className={css.error} role="alert">{currentAmountError}</p>}
            {errors.supported !== undefined && <p className={css.error} role="alert">{t('error.noSupportedFilter')}</p>}
            {errors.request !== undefined && <p className={css.error} role="alert">{t('error.request')}</p>}
          </section>

          {writeError && <p className={css.writeError} role="alert">{t('error.writeDraft')}</p>}
        </div>

        <footer className={css.footer}>
          <button type="button" className={css.secondaryButton} onClick={onReset}>{t('action.reset')}</button>
          <div className={css.footerActions}>
            <button type="button" className={css.secondaryButton} onClick={onCancel}>{t('action.cancel')}</button>
            <button ref={lastControlRef} type="button" className={css.primaryButton} onClick={handleConfirm}>{t('action.confirm')}</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
