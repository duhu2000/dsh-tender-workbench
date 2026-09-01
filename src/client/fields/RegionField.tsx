import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AREA_OPTIONS, type AreaOption } from '../area-data.ts'
import {
  formatAreaPath, getAreaRecord, hasSelectedDescendant, isMcpSupportedAreaValue, searchAreas, toggleAreaSelection,
} from '../area-utils.ts'
import type { TenderFieldProps } from './field-props.ts'
import css from '../tender-filter.module.css'

const MCP_AREA_OPTIONS = AREA_OPTIONS.filter(option => isMcpSupportedAreaValue(option.value))

interface AreaRowProps {
  readonly option: AreaOption
  readonly selected: readonly string[]
  readonly active: boolean
  readonly onChoose: (option: AreaOption) => void
}

/** The complete row is the hit target: selecting a parent also opens its children. */
function AreaRow({ option, selected, active, onChoose }: AreaRowProps) {
  const checked = selected.includes(option.value)
  const partial = hasSelectedDescendant(selected, option.value)
  const hasChildren = option.children !== undefined && option.children.length !== 0
  return (
    <button
      type="button"
      className={css.areaRow}
      aria-pressed={checked}
      data-active={active || undefined}
      data-partial={partial || undefined}
      onClick={() => { onChoose(option) }}
    >
      <span className={css.areaIndicator} aria-hidden="true">{checked ? '✓' : partial ? '—' : ''}</span>
      <span className={css.areaRowLabel}>{option.label}</span>
      {hasChildren && <span className={css.areaRowArrow} aria-hidden="true">›</span>}
    </button>
  )
}

interface AreaColumnProps {
  readonly title: string
  readonly options: readonly AreaOption[]
  readonly selected: readonly string[]
  readonly activeValue?: string
  readonly onChoose: (option: AreaOption) => void
}

function AreaColumn({ title, options, selected, activeValue, onChoose }: AreaColumnProps) {
  return (
    <div className={css.areaColumn} role="group" aria-label={title}>
      <div className={css.areaColumnTitle}>{title}</div>
      <div className={css.areaColumnList}>
        {options.map(option => (
          <AreaRow key={option.value} option={option} selected={selected} active={activeValue === option.value} onChoose={onChoose} />
        ))}
      </div>
    </div>
  )
}

/** Searchable province → city → district cascader with full-row drill-down targets. */
export function RegionField({ filters, onChange, t }: TenderFieldProps) {
  const popupId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeProvinceValue, setActiveProvinceValue] = useState<string>()
  const [activeCityValue, setActiveCityValue] = useState<string>()

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  useEffect(() => {
    const columns = columnsRef.current
    if (columns === null || typeof columns.scrollTo !== 'function') return
    columns.scrollTo({ left: columns.scrollWidth, behavior: 'smooth' })
  }, [activeProvinceValue, activeCityValue])

  const activeProvince = MCP_AREA_OPTIONS.find(option => option.value === activeProvinceValue)
  const activeCity = activeProvince?.children?.find(option => option.value === activeCityValue)
  const results = useMemo(() => searchAreas(query), [query])
  const selectedRecords = filters.regionCodes.flatMap(value => {
    const record = getAreaRecord(value)
    return record === undefined ? [] : [record]
  })
  const summary = selectedRecords.length === 0
    ? t('region.unlimited')
    : selectedRecords.length <= 2
      ? selectedRecords.map(record => record.path.map(option => option.label).join('-')).join('、')
      : `${selectedRecords[0]?.option.label ?? ''} ${t('region.andMore')} ${selectedRecords.length}`

  const toggle = (value: string): void => {
    onChange('regionCodes', toggleAreaSelection(filters.regionCodes, value))
  }
  const chooseProvince = (option: AreaOption): void => {
    toggle(option.value)
    setActiveProvinceValue(option.value)
    setActiveCityValue(undefined)
  }
  const chooseCity = (option: AreaOption): void => {
    toggle(option.value)
    setActiveCityValue(option.value)
  }
  const openPopup = (): void => {
    if (!open && selectedRecords[0] !== undefined) {
      const [, city] = selectedRecords[0].path
      setActiveProvinceValue(selectedRecords[0].path[0]?.value)
      setActiveCityValue(city?.value)
    }
    setOpen(value => !value)
  }

  return (
    <div className={css.filterRow} role="group" aria-label={t('field.regions')}>
      <span className={css.rowLabel}>{t('field.regions')}</span>
      <div className={css.rowContent}>
        <div ref={rootRef} className={css.areaCascader} onKeyDown={event => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}>
          <button type="button" className={css.areaTrigger} aria-expanded={open} aria-controls={popupId} onClick={openPopup}>
            <span className={selectedRecords.length === 0 ? css.areaPlaceholder : undefined}>{summary}</span>
            <span className={css.areaTriggerHint}>{t('region.triggerHint')}</span>
            <span className={css.filterChevron} aria-hidden="true">⌄</span>
          </button>

          {open && (
            <div id={popupId} className={css.areaPopup} role="group" aria-label={t('region.cascader')}>
              <div className={css.areaSearchRow}>
                <input className={css.textInput} type="search" value={query} placeholder={t('region.search.placeholder')} onChange={event => { setQuery(event.target.value) }} />
                <span>{t('region.interactionHint')}</span>
              </div>
              {query.trim() !== '' ? (
                <div className={css.areaSearchResults}>
                  {results.map(record => {
                    const checked = filters.regionCodes.includes(record.option.value)
                    return (
                      <button key={record.option.value} type="button" className={css.areaSearchResult} aria-pressed={checked} onClick={() => { toggle(record.option.value) }}>
                        <span className={css.areaIndicator} aria-hidden="true">{checked ? '✓' : ''}</span>
                        <span>{record.path.map(option => option.label).join('-')}</span>
                      </button>
                    )
                  })}
                  {results.length === 0 && <p className={css.areaEmpty}>{t('region.noResults')}</p>}
                </div>
              ) : (
                <div ref={columnsRef} className={css.areaColumns}>
                  <AreaColumn title={t('region.level.province')} options={MCP_AREA_OPTIONS} selected={filters.regionCodes} activeValue={activeProvinceValue} onChoose={chooseProvince} />
                  {activeProvince?.children !== undefined && (
                    <AreaColumn title={t('region.level.city')} options={activeProvince.children} selected={filters.regionCodes} activeValue={activeCityValue} onChoose={chooseCity} />
                  )}
                  {activeCity?.children !== undefined && (
                    <AreaColumn title={t('region.level.district')} options={activeCity.children} selected={filters.regionCodes} onChoose={option => { toggle(option.value) }} />
                  )}
                </div>
              )}
              <div className={css.areaFooter}>
                <span>{filters.regionCodes.length} {t('region.selected')}</span>
                <div className={css.areaFooterActions}>
                  <button type="button" className={css.areaClear} disabled={filters.regionCodes.length === 0} onClick={() => { onChange('regionCodes', []) }}>{t('region.clear')}</button>
                  <button type="button" className={css.areaDone} onClick={() => { setOpen(false) }}>{t('region.done')}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {selectedRecords.length !== 0 && (
          <div className={css.areaTags}>
            {selectedRecords.map(record => {
              const label = formatAreaPath(record.option.value) ?? record.option.label
              return (
                <button key={record.option.value} type="button" className={css.areaTag} aria-label={`${t('region.remove')} ${label}`} onClick={() => { toggle(record.option.value) }}>
                  <span>{label}</span><span aria-hidden="true">×</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
