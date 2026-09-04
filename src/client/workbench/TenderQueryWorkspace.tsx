import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { TenderQueryScope } from '../../contracts/query-schema.ts'
import type { QccProposedSearchArgs, QccTenderSearchArgs } from '../../contracts/query.ts'
import { AREA_OPTIONS, type AreaOption } from '../area-data.ts'
import { formatAreaPath, getAreaRecord, hasSelectedDescendant, isMcpSupportedAreaValue, searchAreas, toggleAreaSelection } from '../area-utils.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  APPROVAL_PROGRESS_OPTIONS, AWARD_STAGE_OPTIONS, IFB_AMOUNT_OPTIONS, INDUSTRY_OPTIONS,
  PROCUREMENT_OPTIONS, PROCUREMENT_TYPE_OPTIONS, PROPOSED_INVESTMENT_OPTIONS,
  PROPOSED_STAGE_OPTIONS, PUBLISH_OPTIONS, TENDER_STAGE_OPTIONS, WTB_AMOUNT_OPTIONS,
} from '../fields/options.ts'
import { toQccSearchRequest } from '../qcc-request.ts'
import type { PublishPreset, TenderFilters, TenderNoticeType } from '../types.ts'
import { validateTenderFilters, type TenderValidationErrors } from '../validation.ts'
import { PageHeader, StatusPill } from './WorkbenchPrimitives.tsx'
import css from './tender-workbench.module.css'

type QueryBranch = 'tender' | 'proposed'

interface TenderQueryWorkspaceProps {
  readonly formId: string
  readonly scope: TenderQueryScope
  readonly filters: TenderFilters
  readonly target: string
  readonly activeBranch: QueryBranch
  readonly busy: boolean
  readonly replacementRequired?: boolean
  readonly validationError?: string
  readonly validationField?: 'target' | 'keywords' | 'branch'
  readonly validationErrorId: string
  readonly feedback?: ReactNode
  readonly onScopeChange: (scope: TenderQueryScope) => void
  readonly onFiltersChange: <K extends keyof TenderFilters>(key: K, value: TenderFilters[K]) => void
  readonly onTargetChange: (target: string) => void
  readonly onBranchChange: (branch: QueryBranch) => void
  readonly onSubmit: () => void
  readonly t: TenderTranslate
}

interface BranchPlan {
  readonly args?: QccTenderSearchArgs | QccProposedSearchArgs
  readonly error?: TenderValidationErrors
}

const MCP_AREA_OPTIONS = AREA_OPTIONS.filter(option => isMcpSupportedAreaValue(option.value))

function errorKey(errors: TenderValidationErrors): Parameters<TenderTranslate>[0] {
  if (errors.dates === 'required') return 'error.customDateRequired'
  if (errors.dates === 'order') return 'error.dateOrder'
  if (errors.amount === 'invalid') return 'error.amountInvalid'
  if (errors.amount === 'order') return 'error.amountOrder'
  if (errors.keywords !== undefined) return 'error.keywordLimit'
  if (errors.regions === 'limit') return 'error.regionLimit'
  if (errors.regions === 'unsupported') return 'error.regionUnsupported'
  if (errors.supported !== undefined) return 'error.noSupportedFilter'
  return 'error.request'
}

function buildPlan(filters: TenderFilters, branch: QueryBranch, now: Date): BranchPlan {
  const branchFilters = { ...filters, searchMode: branch }
  const error = validateTenderFilters(branchFilters, now)
  if (Object.keys(error).length > 0) return { error }
  try {
    return { args: toQccSearchRequest(branchFilters, now).args }
  } catch {
    return { error: { request: 'invalid' } }
  }
}

function planValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('、')
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value)
  return String(value)
}

function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter(candidate => candidate !== value) : [...values, value]
}

function listSummary(values: readonly string[], t: TenderTranslate): string {
  if (values.length === 0) return t('option.unlimited')
  if (values.length <= 3) return values.join('、')
  return `${values.slice(0, 3).join('、')} +${values.length - 3}`
}

function amountSummary(preset: string | undefined, minimum: string | undefined, maximum: string | undefined, t: TenderTranslate): string {
  if (preset !== undefined) return preset
  if (minimum !== undefined && maximum !== undefined) return `${minimum}万-${maximum}万`
  if (minimum !== undefined) return `${minimum}万元以上`
  if (maximum !== undefined) return `${maximum}万元以下`
  return t('option.unlimited')
}

function ChoiceChips({ options, values, onChange, label }: {
  readonly options: readonly string[]
  readonly values: readonly string[]
  readonly onChange: (values: string[]) => void
  readonly label?: string
}) {
  return <div className={css.queryChoices} role="group" aria-label={label}>{options.map(option => <button key={option} type="button" className={css.queryChoice} aria-pressed={values.includes(option)} onClick={() => { onChange(toggleValue(values, option)) }}>{option}</button>)}</div>
}

function KeywordTokens({ filters, onChange, disabled, invalid, errorId, t }: {
  readonly filters: TenderFilters
  readonly onChange: (value: string) => void
  readonly disabled: boolean
  readonly invalid: boolean
  readonly errorId: string
  readonly t: TenderTranslate
}) {
  const [input, setInput] = useState('')
  const values = useMemo(() => [...new Set(filters.keywords.split(/\s+/u).map(value => value.trim()).filter(Boolean))], [filters.keywords])
  const commit = (raw = input): void => {
    const additions = raw.split(/[\s,，、]+/u).map(value => value.trim()).filter(Boolean)
    if (additions.length === 0) return
    onChange([...new Set([...values, ...additions])].join(' '))
    setInput('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === ',' || event.key === '，') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && input === '' && values.length > 0) {
      onChange(values.slice(0, -1).join(' '))
    }
  }
  return (
    <div className={`${css.queryFieldBlock} ${css.queryFieldFull}`}>
      <div className={css.queryFieldLabel}><span>{t('field.keywords')}</span><small>{t('workbench.query.keywordsHint')}</small></div>
      <div className={css.keywordTokens} data-keyword-count={values.length}>
        {values.map(value => <span key={value}>{value}<button type="button" disabled={disabled} aria-label={`${t('region.remove')} ${value}`} onClick={() => { onChange(values.filter(candidate => candidate !== value).join(' ')) }}>×</button></span>)}
        <input value={input} disabled={disabled || values.length >= 10} aria-label={t('field.keywords')} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} placeholder={values.length >= 10 ? t('error.keywordLimit') : t('field.keywords.placeholder')} onChange={event => { setInput(event.target.value) }} onKeyDown={onKeyDown} onBlur={() => { commit() }} />
      </div>
    </div>
  )
}

function PublishField({ filters, onChange, t }: {
  readonly filters: TenderFilters
  readonly onChange: TenderQueryWorkspaceProps['onFiltersChange']
  readonly t: TenderTranslate
}) {
  const currentYear = new Date().getFullYear()
  const previousYears = Array.from({ length: 4 }, (_, index) => currentYear - index - 1)
  const custom = PUBLISH_OPTIONS.find(option => option.value === 'custom')!
  const options = [...PUBLISH_OPTIONS.filter(option => option.value !== 'custom'), { value: 'year' as const, label: 'publish.priorYears' as const }, custom]
  const select = (value: PublishPreset): void => {
    if (value === 'year' && filters.publishYear === undefined) onChange('publishYear', currentYear - 1)
    onChange('publishPreset', value)
  }
  return (
    <div className={`${css.queryFieldBlock} ${css.queryFieldFull}`}>
      <div className={css.queryFieldLabel}><span>{t('field.publishTime')}</span><small>{t('workbench.query.publishHint')}</small></div>
      <div className={css.queryFieldControl}>
        <div className={css.queryChoices} role="group" aria-label={t('field.publishTime')}>{options.map(option => <button key={option.value} type="button" className={css.queryChoice} aria-pressed={filters.publishPreset === option.value} onClick={() => { select(option.value) }}>{t(option.label)}</button>)}</div>
        {filters.publishPreset === 'year' && <div className={css.queryInlineExtra} data-publish-extra="year"><label><span>{t('publish.priorYears')}</span><select value={filters.publishYear ?? currentYear - 1} onChange={event => { onChange('publishYear', Number(event.target.value)) }}>{previousYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label></div>}
        {filters.publishPreset === 'custom' && <div className={css.queryInlineExtra} data-publish-extra="custom"><label><span>{t('field.customStart')}</span><input type="date" value={filters.startDate ?? ''} onChange={event => { onChange('startDate', event.target.value === '' ? undefined : event.target.value) }} /></label><span aria-hidden="true">—</span><label><span>{t('field.customEnd')}</span><input type="date" value={filters.endDate ?? ''} onChange={event => { onChange('endDate', event.target.value === '' ? undefined : event.target.value) }} /></label></div>}
      </div>
    </div>
  )
}

function AreaColumn({ title, options, selected, activeValue, onChoose }: {
  readonly title: string
  readonly options: readonly AreaOption[]
  readonly selected: readonly string[]
  readonly activeValue?: string
  readonly onChoose: (option: AreaOption) => void
}) {
  return (
    <div className={css.queryRegionColumn} role="group" aria-label={title}>
      <strong>{title}</strong>
      <div>{options.map(option => {
        const checked = selected.includes(option.value)
        const partial = hasSelectedDescendant(selected, option.value)
        return <button key={option.value} type="button" aria-pressed={checked} data-active={activeValue === option.value || undefined} data-partial={partial || undefined} onClick={() => { onChoose(option) }}><span aria-hidden="true">{checked ? '✓' : partial ? '—' : ''}</span><span>{option.label}</span>{option.children !== undefined && option.children.length > 0 ? <i aria-hidden="true">›</i> : null}</button>
      })}</div>
    </div>
  )
}

function RegionField({ filters, onChange, t }: {
  readonly filters: TenderFilters
  readonly onChange: TenderQueryWorkspaceProps['onFiltersChange']
  readonly t: TenderTranslate
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeProvince, setActiveProvince] = useState<string>()
  const [activeCity, setActiveCity] = useState<string>()
  const selectedRecords = filters.regionCodes.flatMap(value => { const record = getAreaRecord(value); return record === undefined ? [] : [record] })
  const province = MCP_AREA_OPTIONS.find(option => option.value === activeProvince)
  const city = province?.children?.find(option => option.value === activeCity)
  const results = useMemo(() => searchAreas(query).filter(record => isMcpSupportedAreaValue(record.option.value)), [query])
  useEffect(() => {
    if (!open) return undefined
    searchRef.current?.focus()
    const closeOutside = (event: PointerEvent): void => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])
  const choose = (value: string): void => {
    if (!filters.regionCodes.includes(value) && filters.regionCodes.length >= 20) return
    onChange('regionCodes', toggleAreaSelection(filters.regionCodes, value))
  }
  const close = (): void => { setOpen(false); triggerRef.current?.focus() }
  return (
    <div className={`${css.queryFieldBlock} ${css.queryFieldFull}`}>
      <div className={css.queryFieldLabel}><span>{t('field.regions')}</span><small>{t('workbench.query.regionHint')}</small></div>
      <div ref={rootRef} className={css.queryRegionControl} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close() } }}>
        <div className={css.queryRegionSelected} aria-live="polite">{selectedRecords.length === 0 ? <span>{t('region.unlimited')}</span> : selectedRecords.map(record => { const label = formatAreaPath(record.option.value) ?? record.option.label; return <button key={record.option.value} type="button" data-region-token aria-label={`${t('region.remove')} ${label}`} onClick={() => { choose(record.option.value) }}>{label}<span aria-hidden="true">×</span></button> })}</div>
        <div className={css.queryRegionActions}><span>{t('workbench.query.regionActionHint')}</span><button ref={triggerRef} type="button" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>{t('region.triggerHint')}</button></div>
        {open && <div className={css.queryRegionPicker} data-region-picker role="dialog" aria-label={t('region.cascader')}>
          <div className={css.queryRegionSearch}><input ref={searchRef} type="search" value={query} aria-label={t('region.search.placeholder')} placeholder={t('region.search.placeholder')} onChange={event => { setQuery(event.target.value) }} /><span>{filters.regionCodes.length} / 20</span></div>
          {query.trim() !== '' ? <div className={css.queryRegionResults}>{results.length === 0 ? <p>{t('region.noResults')}</p> : results.map(record => <button key={record.option.value} type="button" aria-pressed={filters.regionCodes.includes(record.option.value)} onClick={() => { choose(record.option.value) }}><span aria-hidden="true">{filters.regionCodes.includes(record.option.value) ? '✓' : ''}</span>{record.path.map(option => option.label).join('-')}</button>)}</div> : <div className={css.queryRegionColumns}><AreaColumn title={t('region.level.province')} options={MCP_AREA_OPTIONS} selected={filters.regionCodes} activeValue={activeProvince} onChoose={option => { choose(option.value); setActiveProvince(option.value); setActiveCity(undefined) }} />{province?.children !== undefined && <AreaColumn title={t('region.level.city')} options={province.children} selected={filters.regionCodes} activeValue={activeCity} onChoose={option => { choose(option.value); setActiveCity(option.value) }} />}{city?.children !== undefined && <AreaColumn title={t('region.level.district')} options={city.children} selected={filters.regionCodes} onChoose={option => { choose(option.value) }} />}</div>}
          <footer><button type="button" disabled={filters.regionCodes.length === 0} onClick={() => { onChange('regionCodes', []) }}>{t('region.clear')}</button><button type="button" onClick={close}>{t('region.done')}</button></footer>
        </div>}
      </div>
    </div>
  )
}

function ScopeSelector({ scope, busy, onChange, t }: {
  readonly scope: TenderQueryScope
  readonly busy: boolean
  readonly onChange: (scope: TenderQueryScope) => void
  readonly t: TenderTranslate
}) {
  return <div className={css.scopeSurface}><div className={css.scopeCopy}><strong>{t('workbench.query.scope')}</strong><span>{t('workbench.query.scopeDescription')}</span></div><div className={css.scopeGroup} role="group" aria-label={t('workbench.query.scope')}>{(['tender', 'proposed', 'combined'] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={scope === value} className={css.scopeButton} onClick={() => { onChange(value) }}>{t(`workbench.query.scope.${value}`)}</button>)}</div></div>
}

function NoticeTypeSelector({ value, disabled, onChange, t }: {
  readonly value: TenderNoticeType
  readonly disabled: boolean
  readonly onChange: (value: TenderNoticeType) => void
  readonly t: TenderTranslate
}) {
  return <div className={css.queryRichRow}><div className={css.queryRichLabel}><strong>{t('field.noticeType')}</strong><span>{t('workbench.query.noticeTypeHint')}</span></div><div className={css.scopeGroup} role="group" aria-label={t('field.noticeType')}>{(['all', 'ifb', 'wtb'] as const).map(type => <button key={type} type="button" disabled={disabled} className={css.scopeButton} aria-pressed={value === type} onClick={() => { onChange(type) }}>{t(`notice.${type}`)}</button>)}</div></div>
}

function ChoiceRow({ label, hint, options, values, onChange }: { readonly label: string; readonly hint: string; readonly options: readonly string[]; readonly values: readonly string[]; readonly onChange: (values: string[]) => void }) {
  return <div className={css.queryRichRow}><div className={css.queryRichLabel}><strong>{label}</strong><span>{hint}</span></div><ChoiceChips options={options} values={values} onChange={onChange} label={label} /></div>
}

function FilterDisclosure({ id, label, summary, open = false, children }: { readonly id: string; readonly label: string; readonly summary: string; readonly open?: boolean; readonly children: ReactNode }) {
  return <details className={css.queryDisclosure} data-query-disclosure={id} open={open}><summary><strong>{label}</strong><span>{summary}</span></summary><div className={css.queryDisclosureBody}>{children}</div></details>
}

function AmountControl({ presets, preset, minimum, maximum, onPreset, onMinimum, onMaximum, t }: {
  readonly presets: readonly string[]; readonly preset: string | undefined; readonly minimum: string | undefined; readonly maximum: string | undefined
  readonly onPreset: (value: string | undefined) => void; readonly onMinimum: (value: string | undefined) => void; readonly onMaximum: (value: string | undefined) => void; readonly t: TenderTranslate
}) {
  const custom = minimum !== undefined || maximum !== undefined
  const selectPreset = (value: string | undefined): void => { onPreset(value); onMinimum(undefined); onMaximum(undefined) }
  const setCustom = (kind: 'min' | 'max', value: string): void => { onPreset(undefined); if (kind === 'min') onMinimum(value === '' ? undefined : value); else onMaximum(value === '' ? undefined : value) }
  return <><div className={css.queryChoices}><button type="button" className={css.queryChoice} aria-pressed={preset === undefined && !custom} onClick={() => { selectPreset(undefined) }}>{t('option.unlimited')}</button>{presets.map(option => <button key={option} type="button" className={css.queryChoice} aria-pressed={preset === option} onClick={() => { selectPreset(option) }}>{option}</button>)}</div><div className={css.queryAmountLine}><span>{t('workbench.query.orCustom')}</span><label><span>{t('field.amountMin')}</span><input type="number" min="0" step="any" value={minimum ?? ''} placeholder={t('field.amountMin')} onChange={event => { setCustom('min', event.target.value) }} /></label><span>{t('workbench.query.tenThousandShort')}</span><label><span>{t('field.amountMax')}</span><input type="number" min="0" step="any" value={maximum ?? ''} placeholder={t('field.amountMax')} onChange={event => { setCustom('max', event.target.value) }} /></label><span>{t('workbench.query.tenThousandShort')}</span></div></>
}

function ExecutionCall({ branch, index, plan, t }: { readonly branch: QueryBranch; readonly index: number; readonly plan: BranchPlan; readonly t: TenderTranslate }) {
  const tool = branch === 'tender' ? 'mcp__qcc-tender__search_tenders' : 'mcp__qcc-tender__search_proposed_projects'
  return <article className={css.executionCall} data-plan-source={branch} data-plan-status={plan.error === undefined ? 'valid' : 'invalid'}><header><span>{index}</span><strong>{tool}</strong></header>{plan.error === undefined && plan.args !== undefined ? <dl>{Object.entries(plan.args).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{planValue(value)}</dd></div>)}</dl> : <p role="status">{t(errorKey(plan.error ?? { request: 'invalid' }))}</p>}</article>
}

export function TenderQueryWorkspace({ formId, scope, filters, target, activeBranch, busy, replacementRequired = false, validationError, validationErrorId, feedback, validationField, onScopeChange, onFiltersChange, onTargetChange, onBranchChange, onSubmit, t }: TenderQueryWorkspaceProps) {
  const branchTabs = useRef<Partial<Record<QueryBranch, HTMLButtonElement | null>>>({})
  const now = new Date()
  const tenderPlan = buildPlan(filters, 'tender', now)
  const proposedPlan = buildPlan(filters, 'proposed', now)
  const activePlans = scope === 'tender' ? [tenderPlan] : scope === 'proposed' ? [proposedPlan] : [tenderPlan, proposedPlan]
  const plansValid = activePlans.every(plan => plan.error === undefined)
  const selectBranchFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'tender' : 'proposed'
    onBranchChange(next)
    branchTabs.current[next]?.focus()
  }
  return <>
    <PageHeader eyebrow={t('workbench.query.eyebrow')} title={t('workbench.query.title')} description={t('workbench.query.description')} aside={<div className={css.summaryInline}><StatusPill>{t('workbench.query.currentCovered')}</StatusPill><StatusPill>qcc-tender MCP</StatusPill><StatusPill>{t('workbench.query.currentSession')}</StatusPill></div>} />
    <form id={formId} className={css.queryCard} aria-label={t('workbench.query.formTitle')} aria-busy={busy} onSubmit={event => { event.preventDefault(); onSubmit() }}>
      <div className={css.queryLayout}>
        <fieldset className={css.queryMain} disabled={busy}>
          <legend>{t('workbench.query.title')}</legend>
          <ScopeSelector scope={scope} busy={busy} onChange={onScopeChange} t={t} />
          <section className={css.querySection}><div className={css.formSectionHeading}><div><h3>{t('workbench.query.formTitle')}</h3><p>{t('workbench.query.commonDescription')}</p></div><span>{t('workbench.query.editHint')}</span></div><div className={css.queryCommonFields}>
            <KeywordTokens filters={filters} onChange={value => { onFiltersChange('keywords', value) }} disabled={busy} invalid={validationField === 'keywords'} errorId={validationErrorId} t={t} />
            <PublishField filters={filters} onChange={onFiltersChange} t={t} />
            <RegionField filters={filters} onChange={onFiltersChange} t={t} />
            <label className={`${css.queryFieldBlock} ${css.queryFieldFull}`}><span className={css.queryFieldLabel}><span>{t('workbench.query.target')}</span><small>{t('workbench.query.targetHint')}</small></span><input className={css.queryGoalInput} maxLength={2_048} value={target} disabled={busy} aria-label={t('workbench.query.target')} aria-invalid={validationField === 'target'} aria-describedby={validationField === 'target' ? validationErrorId : undefined} placeholder={t('workbench.query.targetPlaceholder')} onChange={event => { onTargetChange(event.target.value) }} /></label>
          </div></section>
          <div className={css.queryBranchTabs} role="tablist" aria-label={t('workbench.query.branchConditions')}>
            <button ref={element => { branchTabs.current.tender = element }} type="button" role="tab" aria-label={t('workbench.query.tenderConditions')} aria-selected={activeBranch === 'tender'} tabIndex={activeBranch === 'tender' ? 0 : -1} onClick={() => { onBranchChange('tender') }} onKeyDown={selectBranchFromKeyboard}>{t('workbench.query.tenderConditions')} <span data-branch-count="7">7 {t('workbench.query.categoryUnit')}</span></button>
            <button ref={element => { branchTabs.current.proposed = element }} type="button" role="tab" aria-label={t('workbench.query.proposedConditions')} aria-selected={activeBranch === 'proposed'} tabIndex={activeBranch === 'proposed' ? 0 : -1} onClick={() => { onBranchChange('proposed') }} onKeyDown={selectBranchFromKeyboard}>{t('workbench.query.proposedConditions')} <span data-branch-count="3">3 {t('workbench.query.categoryUnit')}</span></button>
          </div>
          <section className={css.queryBranchPanel} role="tabpanel" aria-label={t(activeBranch === 'tender' ? 'workbench.query.tenderConditions' : 'workbench.query.proposedConditions')}>
            {activeBranch === 'tender' ? <div className={css.queryBranchBody}>
              <NoticeTypeSelector value={filters.noticeType} disabled={busy} onChange={value => { onFiltersChange('noticeType', value) }} t={t} />
              {filters.noticeType === 'ifb' && <ChoiceRow label={t('field.tenderStages')} hint={t('workbench.query.tenderStageHint')} options={TENDER_STAGE_OPTIONS} values={filters.tenderStages} onChange={value => { onFiltersChange('tenderStages', value) }} />}
              {filters.noticeType === 'wtb' && <ChoiceRow label={t('field.awardStages')} hint={t('workbench.query.awardStageHint')} options={AWARD_STAGE_OPTIONS} values={filters.awardStages} onChange={value => { onFiltersChange('awardStages', value) }} />}
              <FilterDisclosure id="procurement-method" label={t('field.procurementMethod')} summary={listSummary(filters.procurementMethods, t)} open><ChoiceChips label={t('field.procurementMethod')} options={PROCUREMENT_OPTIONS} values={filters.procurementMethods} onChange={value => { onFiltersChange('procurementMethods', value) }} /></FilterDisclosure>
              <FilterDisclosure id="industry" label={t('field.industry')} summary={listSummary(filters.industries, t)}><ChoiceChips label={t('field.industry')} options={INDUSTRY_OPTIONS} values={filters.industries} onChange={value => { onFiltersChange('industries', value) }} /></FilterDisclosure>
              <FilterDisclosure id="procurement-type" label={t('field.procurementType')} summary={listSummary(filters.procurementTypes, t)}><ChoiceChips label={t('field.procurementType')} options={PROCUREMENT_TYPE_OPTIONS} values={filters.procurementTypes} onChange={value => { onFiltersChange('procurementTypes', value) }} /></FilterDisclosure>
              {filters.noticeType !== 'wtb' && <FilterDisclosure id="budget-amount" label={t('field.budgetAmount')} summary={amountSummary(filters.tenderAmountPreset, filters.tenderAmountMin, filters.tenderAmountMax, t)}><AmountControl presets={IFB_AMOUNT_OPTIONS} preset={filters.tenderAmountPreset} minimum={filters.tenderAmountMin} maximum={filters.tenderAmountMax} onPreset={value => { onFiltersChange('tenderAmountPreset', value) }} onMinimum={value => { onFiltersChange('tenderAmountMin', value) }} onMaximum={value => { onFiltersChange('tenderAmountMax', value) }} t={t} /></FilterDisclosure>}
              {filters.noticeType !== 'ifb' && <FilterDisclosure id="award-amount" label={t('field.awardAmount')} summary={amountSummary(filters.awardAmountPreset, filters.awardAmountMin, filters.awardAmountMax, t)}><AmountControl presets={WTB_AMOUNT_OPTIONS} preset={filters.awardAmountPreset} minimum={filters.awardAmountMin} maximum={filters.awardAmountMax} onPreset={value => { onFiltersChange('awardAmountPreset', value) }} onMinimum={value => { onFiltersChange('awardAmountMin', value) }} onMaximum={value => { onFiltersChange('awardAmountMax', value) }} t={t} /></FilterDisclosure>}
            </div> : <div className={css.queryBranchBody}>
              <ChoiceRow label={t('field.proposedStages')} hint={t('workbench.query.proposedStageHint')} options={PROPOSED_STAGE_OPTIONS} values={filters.proposedStages} onChange={value => { onFiltersChange('proposedStages', value) }} />
              <ChoiceRow label={t('field.approvalProgress')} hint={t('workbench.query.approvalHint')} options={APPROVAL_PROGRESS_OPTIONS} values={filters.approvalProgress} onChange={value => { onFiltersChange('approvalProgress', value) }} />
              <FilterDisclosure id="project-investment" label={t('field.projectInvestment')} summary={amountSummary(filters.proposedInvestmentPreset, filters.proposedInvestmentMin, filters.proposedInvestmentMax, t)} open><AmountControl presets={PROPOSED_INVESTMENT_OPTIONS} preset={filters.proposedInvestmentPreset} minimum={filters.proposedInvestmentMin} maximum={filters.proposedInvestmentMax} onPreset={value => { onFiltersChange('proposedInvestmentPreset', value) }} onMinimum={value => { onFiltersChange('proposedInvestmentMin', value) }} onMaximum={value => { onFiltersChange('proposedInvestmentMax', value) }} t={t} /></FilterDisclosure>
            </div>}
          </section>
        </fieldset>
        <aside className={css.queryPlan} aria-label={t('workbench.query.planTitle')}>
          <div className={css.queryPlanHeading}><div><h3>{t('workbench.query.planTitle')}</h3><p>{t('workbench.query.planDescription')}</p></div><StatusPill tone={plansValid ? 'success' : 'warning'}>query.submit</StatusPill></div>
          <div className={css.queryPlanNotice} data-tone="brand"><strong>{scope === 'combined' ? t('workbench.query.combinedPlanTitle') : t('workbench.query.singlePlanTitle')}</strong><span>{t(scope === 'combined' ? 'workbench.query.combinedPlan' : 'workbench.query.singlePlan')}</span></div>
          {replacementRequired && <div className={css.queryPlanNotice} data-tone="warning"><strong>{t('workbench.query.replacementTitle')}</strong><span>{t('workbench.query.replacementWarning')}</span></div>}
          <div className={css.executionCalls}>{(scope === 'tender' || scope === 'combined') && <ExecutionCall branch="tender" index={1} plan={tenderPlan} t={t} />}{(scope === 'proposed' || scope === 'combined') && <ExecutionCall branch="proposed" index={scope === 'combined' ? 2 : 1} plan={proposedPlan} t={t} />}</div>
          <section className={css.planValidation} aria-label={t('workbench.query.validationTitle')}><h4>{t('workbench.query.validationTitle')}</h4><ul><li data-valid={filters.keywords.split(/\s+/u).filter(Boolean).length <= 10}>{t('workbench.query.validationCount')}</li><li data-valid={filters.publishPreset !== 'custom' || filters.startDate !== undefined || filters.endDate !== undefined}>{t('workbench.query.validationDates')}</li><li data-valid={plansValid}>{t('workbench.query.validationAmounts')}</li><li data-valid={plansValid}>{t('workbench.query.validationBranches')}</li></ul></section>
        </aside>
      </div>
      {validationError !== undefined && <p id={validationErrorId} className={css.fieldError} role="alert">{validationError}</p>}
      {feedback}
    </form>
  </>
}
