import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  RuleDraftArtifactV1Schema,
  RulePreviewArtifactV1Schema,
  type ClassifiedRecordV1,
  type ClassifiedRowsFilterV1,
  type ClassifiedRowsPageV1,
  type RuleArtifactContentV1,
  type RulePreviewArtifactV1,
  ruleDraftFingerprint,
} from '../../contracts/screening.ts'
import {
  TenderRuleSetV1Schema,
  type ArtifactRefV1,
  type TenderRuleV1,
  type TenderWorkflowProjectionV1,
} from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  createConfirmRulesIntent,
  createPreviewRulesIntent,
} from '../intents/screening-intent.ts'
import type { SessionWriteFlight } from './session-write-flight.ts'
import {
  SessionWriteButtonLabel,
  SessionWriteProgress,
  sessionWriteProgressText,
} from './SessionWriteProgress.tsx'
import {
  MetricCard,
  PageHeader,
  StatePanel,
  StatusPill,
  SurfaceHeader,
} from './WorkbenchPrimitives.tsx'
import css from './tender-workbench.module.css'

export type RuleContentLoader = (
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  signal?: AbortSignal,
) => Promise<RuleArtifactContentV1>

export type ClassifiedRowsLoader = (
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  filter: ClassifiedRowsFilterV1,
  signal?: AbortSignal,
) => Promise<ClassifiedRowsPageV1>

interface RulesViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly loadContent: RuleContentLoader
  readonly write: SessionWriteFlight
  readonly onRequestProposal: () => void
  readonly footerTarget: HTMLElement | null
  readonly t: TenderTranslate
}

function terms(value: string): string[] {
  return [...new Set(value.split(/[\n,，、]+/u).map(item => item.trim()).filter(Boolean))]
}

function fieldStatus(row: ClassifiedRecordV1): 'normalized' | 'missing' | 'unparseable' {
  if (row.project.disclosure.unparseableFields.length > 0) return 'unparseable'
  if (row.project.disclosure.missingFields.length > 0) return 'missing'
  return 'normalized'
}

function sourceLink(row: ClassifiedRecordV1): string | undefined {
  const candidate = row.project.announcements.find(announcement => announcement.sourceLink !== undefined)?.sourceLink
  if (candidate === undefined) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function PreviewSample({
  sample,
  t,
}: {
  readonly sample: RulePreviewArtifactV1['samples'][number]
  readonly t: TenderTranslate
}) {
  return (
    <article className={css.sampleCard} data-sample-kind={sample.kind}>
      <strong>{sample.title}</strong>
      <small>{t(`workbench.data.source.${sample.source}`)} · {t(`workbench.classification.${sample.classification}`)}</small>
      <span>{t(`workbench.rules.sample.${sample.kind}`)}</span>
    </article>
  )
}

function RuleTermsEditor({ values, label, placeholder, disabled, onChange, t }: {
  readonly values: readonly string[]
  readonly label: string
  readonly placeholder: string
  readonly disabled: boolean
  readonly onChange: (values: readonly string[]) => void
  readonly t: TenderTranslate
}) {
  const [pending, setPending] = useState('')
  const commit = (): void => {
    const additions = terms(pending)
    if (additions.length === 0) return
    onChange([...new Set([...values, ...additions])].slice(0, 50))
    setPending('')
  }
  return (
    <div className={css.ruleKeywordBox}>
      {values.map(value => <span key={value}>{value}<button type="button" disabled={disabled} aria-label={t('workbench.rules.removeTerm', { term: value })} onClick={() => { onChange(values.filter(item => item !== value)) }}>×</button></span>)}
      <input
        type="text"
        disabled={disabled || values.length >= 50}
        aria-label={label}
        placeholder={placeholder}
        value={pending}
        onChange={event => { setPending(event.target.value) }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ',' && event.key !== '，') return
          event.preventDefault()
          commit()
        }}
      />
    </div>
  )
}

function RulesFooter({ target, children }: { readonly target: HTMLElement | null, readonly children: ReactNode }) {
  return target === null ? null : createPortal(children, target)
}

function RulePreview({ preview, rules, selectedRuleId, status, t }: {
  readonly preview: RulePreviewArtifactV1
  readonly rules: readonly TenderRuleV1[]
  readonly selectedRuleId: string
  readonly status: 'current' | 'accepted' | 'stale'
  readonly t: TenderTranslate
}) {
  const nameOf = (ruleId: string) => rules.find(rule => rule.id === ruleId)?.name ?? ruleId
  const exceptionCount = preview.ruleImpacts.reduce((sum, impact) => sum + impact.exceptionCount, 0)
  const kindOrder = { conflict: 0, exception: 1, boundary: 2, match: 3 } as const
  const samples = [...preview.samples]
    .filter(sample => sample.finalRuleId === selectedRuleId || sample.matchedRuleIds.includes(selectedRuleId))
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind])
  const featuredSamples = samples.slice(0, 3)
  const selectedRule = rules.find(rule => rule.id === selectedRuleId)
  const conflictingRules = preview.ruleImpacts.filter(impact => impact.conflictCount > 0).slice(0, 4)
  return (
    <div className={css.rulePreviewGrid} data-rule-preview-grid aria-label={t('workbench.rules.dryRunResults')}>
        <section className={css.rulePreviewPane} aria-label={t('workbench.rules.previewSamples')}>
          <SurfaceHeader
            title={t('workbench.rules.selectedSamples', { name: selectedRule?.name ?? selectedRuleId })}
            description={t('workbench.rules.previewSamplesDescription')}
            action={<StatusPill tone={status === 'stale' ? 'warning' : status === 'accepted' ? 'success' : 'brand'}>{t(status === 'current' ? 'workbench.rules.previewCurrent' : status === 'accepted' ? 'workbench.rules.previewAccepted' : 'workbench.rules.previewExpired')}</StatusPill>}
          />
          <div className={css.rulePreviewBody}>
            {featuredSamples.length === 0 ? <p className={css.dataEmpty}>{t('workbench.classification.none')}</p> : <div className={css.sampleList} data-preview-samples="featured">{featuredSamples.map((sample, index) => <PreviewSample key={`${sample.kind}:${sample.recordId}:${index}`} sample={sample} t={t} />)}</div>}
          </div>
        </section>
        <section className={css.rulePreviewPane} aria-label={t('workbench.rules.globalImpact')}>
          <SurfaceHeader title={t('workbench.rules.globalImpact')} description={t('workbench.rules.globalImpactDescription')} />
          <div className={css.rulePreviewBody}>
            <div className={css.previewLegend}>
              {([
                ['include', preview.counts.include],
                ['observe', preview.counts.observe],
                ['manual-review', preview.counts.manualReview],
                ['exclude', preview.counts.exclude],
              ] as const).map(([value, count]) => <div key={value} data-classification={value}><i /><span>{t(`workbench.classification.${value}`)}</span><strong>{count}</strong></div>)}
            </div>
            <div className={css.previewFacts}>
              <span>{t('workbench.rules.covered', { covered: preview.covered, total: preview.total })}</span>
              <span data-emphasis={preview.conflicts > 0 ? 'warning' : 'muted'}>{t('workbench.rules.conflicts', { count: preview.conflicts })}</span>
              <span data-emphasis={exceptionCount > 0 ? 'warning' : 'muted'}>{t('workbench.rules.previewExceptions', { count: exceptionCount })}</span>
              <span>{t('workbench.classification.unmatched')} {preview.counts.unmatched}</span>
            </div>
            <div className={css.conflictList} data-preview-impacts>
              {conflictingRules.length === 0 ? <p>{t('workbench.rules.noConflicts')}</p> : conflictingRules.map(impact => (
                <article key={impact.ruleId}>
                  <strong>{nameOf(impact.ruleId)} · {t('workbench.rules.conflicts', { count: impact.conflictCount })}</strong>
                  <span>{t('workbench.rules.conflictImpact', { raw: impact.rawMatchCount, final: impact.finalCount, exceptions: impact.exceptionCount })}</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
  )
}

export function TenderRulesView({
  sessionId,
  workflow,
  loadContent,
  write,
  onRequestProposal,
  footerTarget,
  t,
}: RulesViewProps) {
  const writeReasonId = useId()
  const dataset = workflow.query?.normalizedData
  const [draft, setDraft] = useState<readonly TenderRuleV1[]>()
  const [selectedId, setSelectedId] = useState<string>()
  const [preview, setPreview] = useState<RulePreviewArtifactV1>()
  const [dirty, setDirty] = useState(false)
  const [validated, setValidated] = useState(false)
  const [error, setError] = useState<string>()
  const writeDisabledReason = write.busy
    ? t('workbench.write.busyReason', {
      action: sessionWriteProgressText(t, write.state) ?? t('workbench.rules.waitingAgent'),
    })
    : undefined

  useEffect(() => {
    setDraft(undefined)
    setSelectedId(undefined)
    setPreview(undefined)
    setDirty(false)
    setValidated(false)
    setError(undefined)
  }, [dataset?.id, sessionId])

  useEffect(() => {
    const artifact = workflow.rules?.draft
    if (artifact === undefined) return
    const abort = new AbortController()
    void loadContent(sessionId, artifact, abort.signal).then((content) => {
      const parsed = RuleDraftArtifactV1Schema.safeParse(content)
      if (!parsed.success || parsed.data.activeDatasetId !== dataset?.id) return
      const copied = parsed.data.rules.map(rule => ({ ...rule, sources: [...rule.sources], keywords: [...rule.keywords], exceptions: [...rule.exceptions] }))
      setDraft(copied)
      setSelectedId(current => copied.some(rule => rule.id === current) ? current : copied[0]?.id)
      setDirty(false)
      setValidated(false)
    }, () => { if (!abort.signal.aborted) setError(t('workbench.rules.loadFailed')) })
    return () => { abort.abort() }
  }, [dataset?.id, loadContent, sessionId, t, workflow.rules?.draft?.id])

  useEffect(() => {
    const artifact = workflow.rules?.preview
    if (artifact === undefined) return
    const abort = new AbortController()
    void loadContent(sessionId, artifact, abort.signal).then((content) => {
      const parsed = RulePreviewArtifactV1Schema.safeParse(content)
      if (parsed.success && parsed.data.activeDatasetId === dataset?.id) {
        setPreview(parsed.data)
        const currentDraft = TenderRuleSetV1Schema.safeParse(draft)
        if (workflow.rules?.draftOrigin === 'user' && currentDraft.success && parsed.data.draftFingerprint === ruleDraftFingerprint(currentDraft.data)) setDirty(false)
      }
    }, () => { if (!abort.signal.aborted) setError(t('workbench.rules.loadFailed')) })
    return () => { abort.abort() }
  }, [dataset?.id, draft, loadContent, sessionId, t, workflow.rules?.draftOrigin, workflow.rules?.preview?.id])

  if (dataset === undefined) return <div className={css.emptyState}><p>{t('workbench.rules.requiresData')}</p></div>
  if (draft === undefined) {
    return (
      <section className={css.dataView} aria-label={t('workbench.rules.title')}>
        <PageHeader eyebrow={t('workbench.rules.eyebrow')} title={t('workbench.rules.startTitle')} description={t('workbench.rules.startDescription')} />
        {workflow.rules?.draft === undefined ? (
          <form className={css.nextSuggestion} onSubmit={(event) => { event.preventDefault(); onRequestProposal() }}>
            <div><strong>{t('workbench.rules.explicitTitle')}</strong><p>{t('workbench.rules.explicitDescription')}</p></div>
            <button
              type="submit"
              className={css.primary}
              data-write-button="rules.propose"
              disabled={write.busy}
              aria-busy={write.state.action === 'rules.propose' && write.busy}
              aria-describedby={write.busy ? writeReasonId : undefined}
              title={writeDisabledReason}
              onClick={onRequestProposal}
            >
              <SessionWriteButtonLabel action="rules.propose" idle={t('workbench.data.continue')} t={t} write={write} />
            </button>
          </form>
        ) : <p className={css.dataLoading} role="status">{t('workbench.rules.loading')}</p>}
        <SessionWriteProgress id={writeReasonId} t={t} write={write} />
        <RulesFooter target={footerTarget}><div className={css.footerCopy}><span className={css.footerHint}>{t('workbench.rules.footerWaiting')}</span></div></RulesFooter>
      </section>
    )
  }

  const selected = draft.find(rule => rule.id === selectedId) ?? draft[0]
  const updateSelected = (change: Partial<TenderRuleV1>): void => {
    if (selected === undefined) return
    setDraft(draft.map(rule => rule.id === selected.id ? { ...rule, ...change } : rule))
    setDirty(true)
    setValidated(false)
    setError(undefined)
  }
  const parsedDisplayedRules = TenderRuleSetV1Schema.safeParse(draft)
  const fingerprint = parsedDisplayedRules.success ? ruleDraftFingerprint(parsedDisplayedRules.data) : undefined
  const previewMatchesCurrentState = preview !== undefined
    && fingerprint === preview.draftFingerprint
    && preview.activeDatasetId === dataset.id
    && preview.stateRevision === workflow.revision
    && workflow.rules?.preview?.id !== undefined
    && workflow.rules.previewRevision === workflow.revision
  const previewFresh = previewMatchesCurrentState && !dirty
  const previewMatchesConfirmedVersion = preview !== undefined
    && fingerprint === preview.draftFingerprint
    && preview.activeDatasetId === dataset.id
    && workflow.rules?.ruleSetVersion !== undefined
    && workflow.classification?.activeDatasetId === dataset.id
    && !dirty
  const confirmDisabledReason = write.busy
    ? t('workbench.rules.confirmDisabledRunning')
    : !previewFresh
      ? t('workbench.rules.confirmDisabledStale')
      : undefined
  const previewAccepted = previewMatchesConfirmedVersion
  const previewPresentationStatus = previewAccepted
    ? 'accepted'
    : previewFresh
      ? 'current'
      : 'stale'
  const previewRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    if (!parsed.success) { setError(t('workbench.rules.invalid')); return }
    setError(undefined)
    setValidated(true)
    write.start('rules.preview', commandId => createPreviewRulesIntent({
      commandId, activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, rules: parsed.data,
    }))
  }
  const validateRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    if (!parsed.success) { setValidated(false); setError(t('workbench.rules.invalid')); return }
    setError(undefined)
    setValidated(true)
  }
  const confirmRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    const previewArtifact = workflow.rules?.preview
    if (!parsed.success || !previewFresh || previewArtifact === undefined) { setError(t('workbench.rules.previewStale')); return }
    setError(undefined)
    write.start('rules.confirm', commandId => createConfirmRulesIntent({
      commandId, activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, previewArtifactId: previewArtifact.id, rules: parsed.data,
    }))
  }
  const taskState = previewAccepted ? 'accepted' : previewFresh ? 'confirm' : 'preview'
  const confirmAction = (
    <button
      type="button"
      className={css.primary}
      data-write-button="rules.confirm"
      disabled={confirmDisabledReason !== undefined}
      aria-busy={write.state.action === 'rules.confirm' && write.busy}
      aria-describedby={write.busy ? writeReasonId : undefined}
      title={confirmDisabledReason}
      onClick={confirmRules}
    >
      <SessionWriteButtonLabel action="rules.confirm" idle={t('workbench.rules.confirm')} t={t} write={write} />
    </button>
  )
  const dryRunAction = (
    <button type="button" className={css.primary} data-write-button="rules.preview" disabled={write.busy} aria-busy={write.state.action === 'rules.preview' && write.busy} aria-describedby={write.busy ? writeReasonId : undefined} title={writeDisabledReason} onClick={previewRules}>
      <SessionWriteButtonLabel action="rules.preview" idle={t('workbench.rules.saveAndDryRun')} t={t} write={write} />
    </button>
  )

  return (
    <section className={css.dataView} aria-label={t('workbench.rules.title')} aria-busy={write.busy}>
      <PageHeader
        eyebrow={t('workbench.rules.eyebrow')}
        title={t('workbench.rules.pageTitle')}
        description={t('workbench.rules.description')}
        aside={<div className={css.summaryInline}><StatusPill>{t('workbench.rules.draftChip')}</StatusPill><StatusPill>{dataset.rowCount ?? workflow.query?.total ?? 0} {t('workbench.data.records')}</StatusPill><StatusPill>{t('workbench.rules.enabledCount', { count: draft.filter(rule => rule.enabled).length })}</StatusPill><StatusPill tone={taskState === 'accepted' || taskState === 'confirm' ? 'success' : dirty ? 'warning' : 'brand'}>{t(`workbench.rules.taskStatus.${taskState}`)}</StatusPill></div>}
      />

      <StatePanel
        tone="brand"
        title={t('workbench.rules.noDefaultTitle')}
        description={t('workbench.rules.noDefaultDescription')}
      />

      {selected !== undefined && (
        <div className={css.rulesLayout} data-rule-workspace>
          <section className={css.ruleListPanel} aria-label={t('workbench.rules.list')}>
            <header><div><strong>{t('workbench.rules.list')}</strong><small>{t('workbench.rules.listHint')}</small></div><button type="button" className={css.ghostButton} disabled={write.busy} onClick={() => {
              const ids = new Set(draft.map(rule => rule.id))
              let index = draft.length + 1
              while (ids.has(`local-rule-${index}`)) index += 1
              const next: TenderRuleV1 = { id: `local-rule-${index}`, name: t('workbench.rules.newRuleName'), enabled: true, action: 'observe', sources: ['tender', 'proposed'], scope: 'title', keywords: [], priority: 0, exceptions: [], reason: t('workbench.rules.newRuleReason') }
              setDraft([...draft, next]); setSelectedId(next.id); setDirty(true); setValidated(false); setError(undefined)
            }}>+ {t('workbench.rules.add')}</button></header>
            <div className={css.ruleList}>
            {draft.map((rule) => (
              <article key={rule.id} className={rule.id === selected.id ? `${css.ruleItem} ${css.ruleSelected}` : css.ruleItem} data-rule-card>
                <button type="button" className={css.ruleSelectButton} aria-pressed={rule.id === selected.id} onClick={() => { setSelectedId(rule.id) }}>
                  <span className={css.ruleCardCopy}>
                    <strong>{rule.name}</strong>
                    <p>{rule.reason}</p>
                    <small><span data-classification={rule.action}>{t(`workbench.classification.${rule.action}`)}</span><span>{rule.sources.map(source => t(`workbench.data.source.${source}`)).join(' / ')}</span><span>{t('workbench.rules.priority')} {rule.priority}</span></small>
                    {(() => { const impact = preview?.ruleImpacts.find(value => value.ruleId === rule.id); return impact === undefined ? null : <em>{t('workbench.rules.ruleImpactCompact', { raw: impact.rawMatchCount, final: impact.finalCount })}</em> })()}
                  </span>
                </button>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={write.busy}
                  aria-label={t('workbench.rules.enabled', { name: rule.name })}
                  onChange={event => { setDraft(draft.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item)); setDirty(true); setValidated(false) }}
                />
              </article>
            ))}
            </div>
          </section>
          <section className={css.ruleEditor} data-rule-editor aria-label={t('workbench.rules.editor')}>
            <header className={css.editorHeader}>
              <div><strong>{t('workbench.rules.editor')}</strong><span>{t(dirty ? 'workbench.rules.localChangesPending' : 'workbench.rules.localDraft')}</span></div>
              <div className={css.editorHeaderActions}><span className={css.stageState} data-draft-state={dirty ? 'changed' : 'draft'}>{t(dirty ? 'workbench.rules.state.changed' : 'workbench.rules.state.editable')}</span><button type="button" className={css.iconButton} disabled={write.busy || draft.length <= 1} title={draft.length <= 1 ? t('workbench.rules.keepOne') : undefined} aria-label={t('workbench.rules.delete', { name: selected.name })} onClick={() => {
                const remaining = draft.filter(rule => rule.id !== selected.id)
                setDraft(remaining); setSelectedId(remaining[0]?.id); setDirty(true); setValidated(false); setError(undefined)
              }}>×</button></div>
            </header>
            <div className={css.editorGrid}>
              <label><span>{t('workbench.rules.name')}</span><input disabled={write.busy} value={selected.name} maxLength={128} onChange={event => { updateSelected({ name: event.target.value }) }} /></label>
              <label><span>{t('workbench.rules.action')}</span><select disabled={write.busy} value={selected.action} onChange={event => { updateSelected({ action: event.target.value as TenderRuleV1['action'] }) }}><option value="include">{t('workbench.classification.include')}</option><option value="observe">{t('workbench.classification.observe')}</option><option value="manual-review">{t('workbench.classification.manual-review')}</option><option value="exclude">{t('workbench.classification.exclude')}</option></select></label>
              <label><span>{t('workbench.rules.sources')}</span><select disabled={write.busy} value={selected.sources.length === 2 ? 'all' : selected.sources[0]} onChange={event => { updateSelected({ sources: event.target.value === 'all' ? ['tender', 'proposed'] : [event.target.value as 'tender' | 'proposed'] }) }}><option value="all">{t('workbench.rules.source.all')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select></label>
              <section className={`${css.editorWide} ${css.ruleConditionEditor}`}><header><div><strong>{t('workbench.rules.conditionGroup')}</strong><span>{t('workbench.rules.conditionHint')}</span></div></header><div className={css.ruleConditionRow}><label><span>{t('workbench.rules.scope')}</span><select disabled={write.busy} value={selected.scope} onChange={event => { updateSelected({ scope: event.target.value as TenderRuleV1['scope'] }) }}><option value="title">{t('workbench.rules.scope.title')}</option><option value="purchaser">{t('workbench.rules.scope.purchaser')}</option><option value="all">{t('workbench.rules.scope.all')}</option></select></label><div className={css.ruleOperator}><span>{t('workbench.rules.operator')}</span><strong>{t('workbench.rules.operatorAny')}</strong></div><label><span>{t('workbench.rules.keywords')}</span><RuleTermsEditor key={`keywords:${selected.id}`} values={selected.keywords} label={t('workbench.rules.keywords')} placeholder={t('workbench.rules.keywordPlaceholder')} disabled={write.busy} onChange={values => { updateSelected({ keywords: [...values] }) }} t={t} /></label></div></section>
              <section className={`${css.editorWide} ${css.ruleExceptionEditor}`}><header><strong>{t('workbench.rules.exceptions')}</strong><small>{t('workbench.rules.exceptionHint')}</small></header><RuleTermsEditor key={`exceptions:${selected.id}`} values={selected.exceptions} label={t('workbench.rules.exceptions')} placeholder={t('workbench.rules.exceptionPlaceholder')} disabled={write.busy} onChange={values => { updateSelected({ exceptions: [...values] }) }} t={t} /></section>
              <label><span>{t('workbench.rules.priority')}</span><input disabled={write.busy} type="number" min={-1000} max={1000} value={selected.priority} onChange={event => { updateSelected({ priority: Number(event.target.value) }) }} /></label>
              <label className={css.editorWide}><span>{t('workbench.rules.reason')}</span><textarea disabled={write.busy} maxLength={512} value={selected.reason} onChange={event => { updateSelected({ reason: event.target.value }) }} /></label>
            </div>
            <footer className={css.ruleEditorFooter}><span role="status">{t(validated ? 'workbench.rules.validationPassed' : dirty ? 'workbench.rules.localChangesPending' : 'workbench.rules.localDraft')}</span><button type="button" className={css.secondary} disabled={write.busy} onClick={validateRules}>{t('workbench.rules.validate')}</button>{dryRunAction}</footer>
          </section>
        </div>
      )}

      {selected !== undefined && preview !== undefined && <section className={css.selectedRuleImpact} data-selected-rule-impact={selected.id} data-preview-status={previewPresentationStatus} aria-label={t('workbench.rules.selectedImpact')}>{(() => { const impact = preview.ruleImpacts.find(value => value.ruleId === selected.id); return <dl><div><dt>{t('workbench.rules.previewMetricRaw')}</dt><dd>{impact?.rawMatchCount ?? 0}</dd></div><div><dt>{t('workbench.rules.previewMetricFinal')}</dt><dd>{impact?.finalCount ?? 0}</dd></div><div><dt>{t('workbench.classification.column.conflict')}</dt><dd>{impact?.conflictCount ?? 0}</dd></div><div><dt>{t('workbench.rules.selectedCoverage')}</dt><dd>{preview.total === 0 ? '0%' : `${(((impact?.rawMatchCount ?? 0) / preview.total) * 100).toFixed(1)}%`}</dd></div></dl> })()}</section>}

      <SessionWriteProgress id={writeReasonId} t={t} write={write} />
      {(workflow.stages.rules.errorMessage ?? workflow.stages.classification.errorMessage) !== undefined && (
        <StatePanel tone="danger" role="alert" title={t('workbench.status.failed')} description={workflow.stages.rules.errorMessage ?? workflow.stages.classification.errorMessage} />
      )}
      {error !== undefined && <StatePanel tone="danger" role="alert" title={t('workbench.status.failed')} description={error} />}
      {preview !== undefined && !previewFresh && !previewAccepted && (dirty || workflow.classification === undefined) && <p className={css.staleNotice} role="alert"><strong>{t('workbench.rules.previewExpired')}</strong> {t('workbench.rules.previewStale')}</p>}
      {preview !== undefined && selected !== undefined && <RulePreview preview={preview} rules={draft} selectedRuleId={selected.id} status={previewPresentationStatus} t={t} />}
      <RulesFooter target={footerTarget}>
        <div className={css.footerCopy}><span className={css.footerHint}>{t(taskState === 'accepted' ? 'workbench.rules.footerAccepted' : 'workbench.rules.footerNote')}</span>{taskState === 'accepted' || confirmDisabledReason === undefined ? null : <span className={css.disabledReason}>{confirmDisabledReason}</span>}</div>
        {taskState === 'accepted' ? null : confirmAction}
      </RulesFooter>
    </section>
  )
}

interface ClassificationViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly loadRows: ClassifiedRowsLoader
  readonly loadContent: RuleContentLoader
  readonly write: SessionWriteFlight
  readonly onOpenAnalysis: () => void
  readonly onOpenReview: () => void
  readonly footerTarget: HTMLElement | null
  readonly t: TenderTranslate
}

export function TenderClassificationView({
  sessionId,
  workflow,
  loadRows,
  loadContent,
  write,
  onOpenAnalysis,
  onOpenReview,
  footerTarget,
  t,
}: ClassificationViewProps) {
  const classification = workflow.classification
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<ClassifiedRowsFilterV1['source']>()
  const [category, setCategory] = useState<ClassifiedRowsFilterV1['classification']>()
  const [ruleId, setRuleId] = useState<string>()
  const [conflict, setConflict] = useState<boolean>()
  const [fieldFilter, setFieldFilter] = useState<ClassifiedRowsFilterV1['fieldStatus']>()
  const [data, setData] = useState<ClassifiedRowsPageV1>()
  const [rules, setRules] = useState<readonly TenderRuleV1[]>([])
  const [selected, setSelected] = useState<ClassifiedRecordV1>()
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rulesFailed, setRulesFailed] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const traceRef = useRef<HTMLElement>(null)
  const filter = useMemo<ClassifiedRowsFilterV1>(() => ({
    page, pageSize: 50,
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(source === undefined ? {} : { source }),
    ...(category === undefined ? {} : { classification: category }),
    ...(ruleId === undefined ? {} : { ruleId }),
    ...(conflict === undefined ? {} : { conflict }),
    ...(fieldFilter === undefined ? {} : { fieldStatus: fieldFilter }),
  }), [category, conflict, fieldFilter, page, query, ruleId, source])

  useEffect(() => {
    if (classification === undefined) return
    const abort = new AbortController()
    setFailed(false)
    setLoading(true)
    void loadRows(sessionId, classification.data, filter, abort.signal).then((result) => {
      if (!abort.signal.aborted) {
        setData(result)
        setLoading(false)
      }
    }, () => {
      if (!abort.signal.aborted) {
        setFailed(true)
        setLoading(false)
      }
    })
    return () => { abort.abort() }
  }, [classification, filter, loadRows, requestVersion, sessionId])

  useEffect(() => {
    const artifact = workflow.rules?.confirmed
    if (artifact === undefined) return
    const abort = new AbortController()
    setRulesFailed(false)
    void loadContent(sessionId, artifact, abort.signal).then((content) => {
      if ('rules' in content && !('origin' in content)) setRules(content.rules)
    }, () => { if (!abort.signal.aborted) setRulesFailed(true) })
    return () => { abort.abort() }
  }, [loadContent, sessionId, workflow.rules?.confirmed?.id])

  if (classification === undefined) return null
  const maximumPage = Math.max(1, Math.ceil((data?.total ?? 0) / 50))
  const reset = () => { setPage(1); setSelected(undefined) }
  const ruleName = (id: string | undefined) => rules.find(rule => rule.id === id)?.name ?? id ?? t('workbench.classification.none')
  const selectedSourceLink = selected === undefined ? undefined : sourceLink(selected)
  useEffect(() => { if (selected !== undefined) traceRef.current?.focus() }, [selected])
  return (
    <section className={css.dataView} aria-label={t('workbench.classification.title')}>
      {detailsOpen && <button type="button" className={css.backButton} onClick={() => { setDetailsOpen(false); setSelected(undefined) }}>← {t('workbench.classification.backOverview')}</button>}
      <PageHeader
        eyebrow={t('workbench.classification.eyebrow')}
        title={t(detailsOpen ? 'workbench.classification.detailsTitle' : 'workbench.classification.title')}
        description={t(detailsOpen ? 'workbench.classification.detailsDescription' : 'workbench.classification.description')}
        aside={<div className={css.summaryInline}><StatusPill>{classification.ruleSetVersion}</StatusPill><StatusPill>{classification.data.rowCount ?? workflow.query?.total ?? 0} {t('workbench.data.records')}</StatusPill><StatusPill tone="success">{t('workbench.phaseStatus.completed')}</StatusPill></div>}
      />
      <p className={css.scopeNotice}>{t('workbench.classification.boundary')}</p>
      {!detailsOpen && <div className={css.classificationGrid} data-classification-overview>
        {([
          ['include', classification.include], ['observe', classification.observe],
          ['manual-review', classification.manualReview], ['exclude', classification.exclude],
          ['unmatched', classification.unmatched],
        ] as const).map(([value, count]) => (
          <button
            key={value}
            type="button"
            className={css.classificationMetric}
            data-classification={value}
            aria-pressed={category === value}
            onClick={() => { setCategory(value); reset(); setDetailsOpen(true) }}
          >
            <span>{t(`workbench.classification.${value}`)}</span><strong>{count}</strong><small>{t('workbench.classification.openDetails')}</small>
          </button>
        ))}
      </div>}
      {!detailsOpen && <div className={css.classificationOverview}>
        <section className={css.summarySurface}>
          <SurfaceHeader title={t('workbench.classification.coverageTitle')} description={t('workbench.classification.coverageDescription')} action={<button type="button" className={css.secondary} onClick={() => { setDetailsOpen(true) }}>{t('workbench.classification.openDetails')}</button>} />
          <div className={css.classificationFunnel} data-classification-funnel>
            {([
              [t('workbench.classification.rawRecords'), workflow.query?.sourceRecordCount ?? workflow.query?.total ?? 0],
              [t('workbench.classification.auditNormalized'), workflow.query?.total ?? classification.data.rowCount ?? 0],
              [t('workbench.classification.coveredRecords'), classification.covered],
              [t('workbench.classification.include'), classification.include],
            ] as const).map(([label, value], index) => <div key={label}><span>{label}</span><i style={{ width: `${Math.max(12, 100 - index * 18)}%` }} /><strong>{value}</strong></div>)}
          </div>
        </section>
        <aside className={css.summarySurface}>
          <SurfaceHeader title={t('workbench.classification.auditTitle')} description={t('workbench.classification.auditDescription')} />
          <dl className={css.auditList}>
            <div><dt>{t('workbench.classification.auditNormalized')}</dt><dd>{workflow.query?.total ?? classification.data.rowCount ?? 0}</dd></div>
            <div data-tone={classification.conflicts > 0 ? 'warning' : 'neutral'}><dt>{t('workbench.classification.column.conflict')}</dt><dd>{classification.conflicts}</dd></div>
            <div><dt>{t('workbench.rules.rawMatches', { count: classification.covered })}</dt><dd>{workflow.rules?.rawMatches ?? classification.covered}</dd></div>
          </dl>
        </aside>
      </div>}
      {!detailsOpen && data !== undefined && data.rows.length > 0 && <section className={css.screenCard} data-classification-samples><SurfaceHeader title={t('workbench.classification.sampleTitle')} description={t('workbench.classification.sampleDescription')} action={<button type="button" className={css.primary} onClick={() => { setDetailsOpen(true) }}>{t('workbench.classification.openAll', { count: data.total })}</button>} /><div className={css.dataTableWrap}><table className={css.dataTable}><thead><tr><th>{t('workbench.classification.column.classification')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.classification.column.finalRule')}</th><th>{t('workbench.classification.column.conflict')}</th><th>{t('workbench.data.column.source')}</th><th>{t('workbench.data.column.action')}</th></tr></thead><tbody>{data.rows.slice(0, 4).map(row => <tr key={row.project.recordId}><td><span className={css.sourceTag} data-classification={row.classification}>{t(`workbench.classification.${row.classification}`)}</span></td><td><strong>{row.project.title}</strong></td><td>{ruleName(row.finalRuleId)}</td><td>{row.conflictRuleIds.length > 0 ? t('workbench.classification.hasConflict') : '—'}</td><td>{t(`workbench.data.source.${row.project.source}`)}</td><td><button type="button" className={css.rowAction} onClick={() => { setSelected(row); setDetailsOpen(true) }}>{t('workbench.classification.trace')}</button></td></tr>)}</tbody></table></div></section>}
      {rulesFailed && <p className={css.staleNotice} role="status">{t('workbench.classification.rulesLoadFailed')}</p>}
      {detailsOpen && <div className={selected === undefined ? css.classificationWorkspace : `${css.classificationWorkspace} ${css.classificationWorkspaceOpen}`} data-classification-details>
      <section className={css.screenCard} aria-busy={loading}>
        <SurfaceHeader title={t('workbench.classification.detailsTitle')} description={t('workbench.classification.detailsDescription')} />
        <div className={css.detailToolbar}>
          <input type="search" aria-label={t('workbench.classification.search')} value={query} placeholder={t('workbench.classification.searchPlaceholder')} onChange={event => { setQuery(event.target.value); reset() }} />
          <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={event => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); reset() }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
          <select aria-label={t('workbench.classification.filter')} value={category ?? ''} onChange={event => { setCategory(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof category>); reset() }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
          <select aria-label={t('workbench.classification.ruleFilter')} value={ruleId ?? ''} onChange={event => { setRuleId(event.target.value || undefined); reset() }}><option value="">{t('workbench.classification.ruleAll')}</option>{rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select>
          <select aria-label={t('workbench.classification.conflictFilter')} value={conflict === undefined ? '' : String(conflict)} onChange={event => { setConflict(event.target.value === '' ? undefined : event.target.value === 'true'); reset() }}><option value="">{t('workbench.classification.conflictAll')}</option><option value="true">{t('workbench.classification.conflictOnly')}</option><option value="false">{t('workbench.classification.noConflict')}</option></select>
          <select aria-label={t('workbench.data.filterStatus')} value={fieldFilter ?? ''} onChange={event => { setFieldFilter(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof fieldFilter>); reset() }}><option value="">{t('workbench.data.filterStatusAll')}</option><option value="normalized">{t('workbench.data.status.normalized')}</option><option value="missing">{t('workbench.data.status.missing')}</option><option value="unparseable">{t('workbench.data.status.unparseable')}</option></select>
        </div>
        {failed ? (
          <div className={css.dataError} role="alert">
            <strong>{t('workbench.classification.loadFailedTitle')}</strong>
            <span>{t('workbench.classification.loadFailed')}</span>
            <button type="button" className={css.secondary} onClick={() => { setRequestVersion(value => value + 1) }}>{t('workbench.data.retry')}</button>
          </div>
        ) : data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.classification.loading')}</p> : data.rows.length === 0 ? (
          <div className={css.dataEmpty} role="status"><strong>{t('workbench.classification.emptyTitle')}</strong><span>{t('workbench.classification.emptyDescription')}</span></div>
        ) : (
          <>
            {loading && <div className={css.inlineLoading} role="status">{t('workbench.classification.loading')}</div>}
            <div className={css.dataTableWrap}><table className={css.dataTable}><thead><tr><th>{t('workbench.classification.column.classification')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.classification.column.finalRule')}</th><th>{t('workbench.classification.column.matches')}</th><th>{t('workbench.classification.column.conflict')}</th><th>{t('workbench.data.column.source')}</th><th>{t('workbench.data.column.status')}</th><th>{t('workbench.data.column.action')}</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.project.recordId}><td><span className={css.sourceTag} data-classification={row.classification}>{t(`workbench.classification.${row.classification}`)}</span></td><td><strong>{row.project.title}</strong><small>{row.project.sourceId}</small></td><td>{ruleName(row.finalRuleId)}</td><td>{row.rawMatches.map(match => ruleName(match.ruleId)).join(t('workbench.classification.matchSeparator')) || '—'}</td><td>{row.conflictRuleIds.length > 0 ? t('workbench.classification.hasConflict') : '—'}</td><td>{t(`workbench.data.source.${row.project.source}`)}</td><td><span className={css.fieldStatus} data-field-status={fieldStatus(row)}>{t(`workbench.data.status.${fieldStatus(row)}`)}</span></td><td><button type="button" className={css.rowAction} aria-expanded={selected?.project.recordId === row.project.recordId} onClick={() => { setSelected(row) }}>{t('workbench.classification.trace')}</button></td></tr>)}</tbody></table></div>
            <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: data.page, pages: maximumPage, total: data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div></footer>
          </>
        )}
      </section>
      {selected !== undefined && (
        <section ref={traceRef} className={css.traceCard} tabIndex={-1} aria-label={t('workbench.classification.traceTitle')}>
          <header><div><StatusPill tone={selected.conflictRuleIds.length > 0 ? 'warning' : 'success'}>{t(`workbench.classification.${selected.classification}`)}</StatusPill><strong>{selected.project.title}</strong><p>{t('workbench.classification.tracePath')}</p></div><button type="button" className={css.iconButton} aria-label={t('action.cancel')} onClick={() => { setSelected(undefined) }}>×</button></header>
          <ol>
            <li><strong>{t('workbench.classification.traceSource')}</strong><span>{t(`workbench.data.source.${selected.project.source}`)} · {selected.project.sourceId}</span></li>
            <li><strong>{t('workbench.classification.traceSnapshot')}</strong><span>{t('workbench.classification.traceSnapshotValue', { snapshot: classification.activeDatasetId, version: classification.ruleSetVersion })}</span></li>
            <li><strong>{t('workbench.classification.traceNormalized')}</strong><span>{selected.project.title} · {selected.project.counterparty.value ?? t('workbench.data.value.missing')} · {t('workbench.data.status.normalized')}</span></li>
            <li><strong>{t('workbench.classification.traceMatches')}</strong><span>{selected.rawMatches.map(match => `${ruleName(match.ruleId)} [${match.matchedKeywords.join('、')}]${match.eligible ? '' : ` (${t('workbench.classification.exception')}: ${match.exceptionKeywords.join('、')})`}`).join('；') || t('workbench.classification.none')}</span></li>
            <li><strong>{t('workbench.classification.traceDecision')}</strong><span>{t(`workbench.classification.decision.${selected.decision.kind}`)} · {ruleName(selected.finalRuleId)} · {t(`workbench.classification.${selected.classification}`)}</span></li>
          </ol>
          {selectedSourceLink !== undefined && <a className={css.sourceLink} href={selectedSourceLink} target="_blank" rel="noreferrer">{t('workbench.data.openSource')} ↗</a>}
        </section>
      )}
      </div>}
      <RulesFooter target={footerTarget}>
        <div className={css.footerCopy}><span className={css.footerHint}>{t('workbench.classification.footerNote')}</span></div>
        <div className={css.footerActions}>
          <button type="button" className={css.secondary} disabled={write.busy} onClick={onOpenReview}>{t('workbench.classification.openReview')}</button>
          <button type="button" className={css.primary} data-write-button="analysis.request" disabled={write.busy} aria-busy={write.state.action === 'analysis.request' && write.busy} onClick={onOpenAnalysis}><SessionWriteButtonLabel action="analysis.request" idle={t('workbench.classification.openAnalysis')} t={t} write={write} /></button>
        </div>
      </RulesFooter>
    </section>
  )
}
