import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { TenderFieldProps, TenderTranslate } from './field-props.ts'
import {
  IFB_AMOUNT_OPTIONS,
  INDUSTRY_OPTIONS,
  PROCUREMENT_OPTIONS,
  PROCUREMENT_TYPE_OPTIONS,
  PROPOSED_INVESTMENT_OPTIONS,
  WTB_AMOUNT_OPTIONS,
} from './options.ts'
import css from '../tender-filter.module.css'

interface AdvancedItem {
  readonly id: string
  readonly label: string
  readonly summary: string
  readonly active: boolean
  readonly clear: () => void
  readonly content: ReactNode
}

function MultiChoiceControl({ values, options, onChange, dense = false }: {
  readonly values: readonly string[]
  readonly options: readonly string[]
  readonly onChange: (values: string[]) => void
  readonly dense?: boolean
}) {
  const toggle = (value: string): void => {
    onChange(values.includes(value) ? values.filter(candidate => candidate !== value) : [...values, value])
  }
  return (
    <div className={`${css.optionList} ${dense ? css.optionListDense : ''}`}>
      {options.map(option => {
        const checked = values.includes(option)
        return (
          <button key={option} type="button" className={css.optionRow} aria-pressed={checked} onClick={() => { toggle(option) }}>
            <span className={css.optionIndicator} aria-hidden="true">{checked ? '✓' : ''}</span>
            <span>{option}</span>
          </button>
        )
      })}
    </div>
  )
}

function AmountControl({ presets, preset, minimum, maximum, onPreset, onMinimum, onMaximum, t }: {
  readonly presets: readonly string[]
  readonly preset: string | undefined
  readonly minimum: string | undefined
  readonly maximum: string | undefined
  readonly onPreset: (value: string | undefined) => void
  readonly onMinimum: (value: string | undefined) => void
  readonly onMaximum: (value: string | undefined) => void
  readonly t: TenderTranslate
}) {
  const customActive = minimum !== undefined || maximum !== undefined
  const selectPreset = (value: string | undefined): void => {
    onPreset(value)
    onMinimum(undefined)
    onMaximum(undefined)
  }
  const changeCustom = (kind: 'minimum' | 'maximum', value: string): void => {
    onPreset(undefined)
    const normalized = value === '' ? undefined : value
    if (kind === 'minimum') onMinimum(normalized)
    else onMaximum(normalized)
  }
  return (
    <>
      <div className={css.quickChoices}>
        <button type="button" className={css.quickChoice} aria-pressed={preset === undefined && !customActive} onClick={() => { selectPreset(undefined) }}>{t('option.unlimited')}</button>
        {presets.map(option => (
          <button key={option} type="button" className={css.quickChoice} aria-pressed={preset === option} onClick={() => { selectPreset(option) }}>{option}</button>
        ))}
      </div>
      <div className={css.amountGrid}>
        <label className={css.field}>
          <span className={css.subLabel}>{t('field.amountMin')}</span>
          <span className={css.amountInputWrap}><input className={css.textInput} inputMode="decimal" type="number" min="0" step="any" value={minimum ?? ''} onChange={event => { changeCustom('minimum', event.target.value) }} /><span>{t('unit.tenThousand')}</span></span>
        </label>
        <label className={css.field}>
          <span className={css.subLabel}>{t('field.amountMax')}</span>
          <span className={css.amountInputWrap}><input className={css.textInput} inputMode="decimal" type="number" min="0" step="any" value={maximum ?? ''} onChange={event => { changeCustom('maximum', event.target.value) }} /><span>{t('unit.tenThousand')}</span></span>
        </label>
      </div>
    </>
  )
}

function listSummary(values: readonly string[], t: TenderTranslate): string {
  if (values.length === 0) return t('option.unlimited')
  if (values.length <= 2) return values.join('、')
  return `${values[0]}、${values[1]} +${values.length - 2}`
}

function amountSummary(preset: string | undefined, minimum: string | undefined, maximum: string | undefined, t: TenderTranslate): string {
  if (preset !== undefined) return preset
  if (minimum !== undefined && maximum !== undefined) return `${minimum}万-${maximum}万`
  if (minimum !== undefined) return `${minimum}万元以上`
  if (maximum !== undefined) return `${maximum}万元以下`
  return t('option.unlimited')
}

/** Compact triggers share one option surface, which closes on outside pointer or Escape. */
export function AdvancedFields({ filters, onChange, t }: TenderFieldProps) {
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [openField, setOpenField] = useState<string>()

  useEffect(() => { setOpenField(undefined) }, [filters.searchMode, filters.noticeType])
  useEffect(() => {
    if (openField === undefined) return undefined
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpenField(undefined)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [openField])
  useEffect(() => {
    const panel = panelRef.current
    if (openField !== undefined && panel !== null && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [openField])

  const items: AdvancedItem[] = []
  if (filters.searchMode === 'proposed') {
    const summary = amountSummary(filters.proposedInvestmentPreset, filters.proposedInvestmentMin, filters.proposedInvestmentMax, t)
    items.push({
      id: 'project-investment', label: t('field.projectInvestment'), summary, active: summary !== t('option.unlimited'),
      clear: () => { onChange('proposedInvestmentPreset', undefined); onChange('proposedInvestmentMin', undefined); onChange('proposedInvestmentMax', undefined) },
      content: <AmountControl presets={PROPOSED_INVESTMENT_OPTIONS} preset={filters.proposedInvestmentPreset} minimum={filters.proposedInvestmentMin} maximum={filters.proposedInvestmentMax} onPreset={value => { onChange('proposedInvestmentPreset', value) }} onMinimum={value => { onChange('proposedInvestmentMin', value) }} onMaximum={value => { onChange('proposedInvestmentMax', value) }} t={t} />,
    })
  } else {
    const budgetSummary = amountSummary(filters.tenderAmountPreset, filters.tenderAmountMin, filters.tenderAmountMax, t)
    const awardSummary = amountSummary(filters.awardAmountPreset, filters.awardAmountMin, filters.awardAmountMax, t)
    items.push(
      { id: 'procurement', label: t('field.procurementMethod'), summary: listSummary(filters.procurementMethods, t), active: filters.procurementMethods.length !== 0, clear: () => { onChange('procurementMethods', []) }, content: <MultiChoiceControl values={filters.procurementMethods} options={PROCUREMENT_OPTIONS} onChange={value => { onChange('procurementMethods', value) }} dense /> },
      { id: 'industry', label: t('field.industry'), summary: listSummary(filters.industries, t), active: filters.industries.length !== 0, clear: () => { onChange('industries', []) }, content: <MultiChoiceControl values={filters.industries} options={INDUSTRY_OPTIONS} onChange={value => { onChange('industries', value) }} dense /> },
      { id: 'procurement-type', label: t('field.procurementType'), summary: listSummary(filters.procurementTypes, t), active: filters.procurementTypes.length !== 0, clear: () => { onChange('procurementTypes', []) }, content: <MultiChoiceControl values={filters.procurementTypes} options={PROCUREMENT_TYPE_OPTIONS} onChange={value => { onChange('procurementTypes', value) }} /> },
    )
    if (filters.noticeType !== 'wtb') {
      items.push({ id: 'budget-amount', label: t('field.budgetAmount'), summary: budgetSummary, active: budgetSummary !== t('option.unlimited'), clear: () => { onChange('tenderAmountPreset', undefined); onChange('tenderAmountMin', undefined); onChange('tenderAmountMax', undefined) }, content: <AmountControl presets={IFB_AMOUNT_OPTIONS} preset={filters.tenderAmountPreset} minimum={filters.tenderAmountMin} maximum={filters.tenderAmountMax} onPreset={value => { onChange('tenderAmountPreset', value) }} onMinimum={value => { onChange('tenderAmountMin', value) }} onMaximum={value => { onChange('tenderAmountMax', value) }} t={t} /> })
    }
    if (filters.noticeType !== 'ifb') {
      items.push({ id: 'award-amount', label: t('field.awardAmount'), summary: awardSummary, active: awardSummary !== t('option.unlimited'), clear: () => { onChange('awardAmountPreset', undefined); onChange('awardAmountMin', undefined); onChange('awardAmountMax', undefined) }, content: <AmountControl presets={WTB_AMOUNT_OPTIONS} preset={filters.awardAmountPreset} minimum={filters.awardAmountMin} maximum={filters.awardAmountMax} onPreset={value => { onChange('awardAmountPreset', value) }} onMinimum={value => { onChange('awardAmountMin', value) }} onMaximum={value => { onChange('awardAmountMax', value) }} t={t} /> })
    }
  }

  const activeItem = items.find(item => item.id === openField)
  const selectedItems = items.filter(item => item.active)
  return (
    <div ref={rootRef} className={css.advancedFields} onKeyDown={event => {
      if (event.key === 'Escape' && openField !== undefined) {
        event.preventDefault()
        event.stopPropagation()
        setOpenField(undefined)
      }
    }}>
      <div className={css.advancedToolbar} data-dense={items.length > 3 || undefined}>
        {items.map(item => {
          const expanded = openField === item.id
          return (
            <button key={item.id} type="button" className={css.filterTrigger} aria-label={`${item.label} ${item.summary}`} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} data-selected={item.active || undefined} title={item.summary} onClick={() => { setOpenField(current => current === item.id ? undefined : item.id) }}>
              <span className={css.filterTriggerLabel}>{item.label}</span>
              {item.active && <span className={css.filterActiveDot} aria-hidden="true" />}
              <span className={css.filterChevron} aria-hidden="true">⌄</span>
            </button>
          )
        })}
      </div>
      {selectedItems.length !== 0 && activeItem === undefined && (
        <div className={css.selectedFilterStrip} aria-label={t('section.advanced')}>
          {selectedItems.map(item => <span key={item.id} className={css.selectedFilterChip} title={`${item.label}：${item.summary}`}><span>{item.label}</span><strong>{item.summary}</strong></span>)}
        </div>
      )}
      {activeItem !== undefined && (
        <div ref={panelRef} id={panelId} className={css.advancedPanel} role="group" aria-label={activeItem.label}>
          <div className={css.advancedPanelHeader}>
            <div><strong>{activeItem.label}</strong><span>{activeItem.summary}</span></div>
            <div className={css.advancedPanelActions}>
              {activeItem.active && <button type="button" onClick={activeItem.clear}>{t('region.clear')}</button>}
              <button type="button" aria-label={t('filter.close')} onClick={() => { setOpenField(undefined) }}>×</button>
            </div>
          </div>
          <div className={css.advancedPanelBody}>{activeItem.content}</div>
        </div>
      )}
    </div>
  )
}
