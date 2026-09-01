import { useEffect, useMemo, useState } from 'react'
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
import type { TenderWorkbenchIntentV1 } from '../../contracts/screening-intents.ts'
import {
  TenderRuleSetV1Schema,
  type ArtifactRefV1,
  type TenderRuleV1,
  type TenderWorkflowProjectionV1,
} from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import {
  createAdjustRulesIntent,
  createConfirmRulesIntent,
  createPreviewRulesIntent,
} from '../intents/screening-intent.ts'
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
  readonly sendIntent: (intent: TenderWorkbenchIntentV1) => Promise<void>
  readonly createCommandId: () => string
  readonly proposalPending: boolean
  readonly proposalFailed: boolean
  readonly onRequestProposal: () => void
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

function RulePreview({ preview, rules, t }: {
  readonly preview: RulePreviewArtifactV1
  readonly rules: readonly TenderRuleV1[]
  readonly t: TenderTranslate
}) {
  const nameOf = (ruleId: string) => rules.find(rule => rule.id === ruleId)?.name ?? ruleId
  return (
    <section className={css.screenCard} aria-label={t('workbench.rules.preview')}>
      <header className={css.screenCardHeader}>
        <div><h3>{t('workbench.rules.preview')}</h3><p>{t('workbench.rules.previewBoundary')}</p></div>
        <span className={css.stageState}>{t('workbench.rules.previewOnly')}</span>
      </header>
      <div className={css.classificationGrid}>
        {([
          ['include', preview.counts.include],
          ['observe', preview.counts.observe],
          ['manual-review', preview.counts.manualReview],
          ['exclude', preview.counts.exclude],
          ['unmatched', preview.counts.unmatched],
        ] as const).map(([value, count]) => (
          <article key={value} className={css.classificationMetric} data-classification={value}>
            <span>{t(`workbench.classification.${value}`)}</span><strong>{count}</strong>
          </article>
        ))}
      </div>
      <div className={css.impactSummary}>
        <span>{t('workbench.rules.covered', { covered: preview.covered, total: preview.total })}</span>
        <span>{t('workbench.rules.conflicts', { count: preview.conflicts })}</span>
        <span>{t('workbench.rules.rawMatches', { count: preview.rawMatches })}</span>
      </div>
      <div className={css.ruleImpactList}>
        {preview.ruleImpacts.map(impact => (
          <div key={impact.ruleId} className={css.ruleImpactRow}>
            <strong>{nameOf(impact.ruleId)}</strong>
            <span>{t('workbench.rules.ruleImpact', {
              raw: impact.rawMatchCount,
              final: impact.finalCount,
              conflicts: impact.conflictCount,
              exceptions: impact.exceptionCount,
            })}</span>
          </div>
        ))}
      </div>
      <div className={css.sampleGrid}>
        {preview.samples.map((sample, index) => (
          <article key={`${sample.kind}:${sample.recordId}:${index}`} className={css.sampleCard}>
            <span>{t(`workbench.rules.sample.${sample.kind}`)}</span>
            <strong>{sample.title}</strong>
            <small>{t(`workbench.data.source.${sample.source}`)} · {t(`workbench.classification.${sample.classification}`)}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

export function TenderRulesView({
  sessionId,
  workflow,
  loadContent,
  sendIntent,
  createCommandId,
  proposalPending,
  proposalFailed,
  onRequestProposal,
  t,
}: RulesViewProps) {
  const dataset = workflow.query?.normalizedData
  const [draft, setDraft] = useState<readonly TenderRuleV1[]>()
  const [suggestion, setSuggestion] = useState<readonly TenderRuleV1[]>()
  const [selectedId, setSelectedId] = useState<string>()
  const [preview, setPreview] = useState<RulePreviewArtifactV1>()
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)
  const [waitingRevision, setWaitingRevision] = useState<number>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    setDraft(undefined)
    setSuggestion(undefined)
    setSelectedId(undefined)
    setPreview(undefined)
    setInstruction('')
    setDirty(false)
    setError(undefined)
  }, [dataset?.id, sessionId])

  useEffect(() => {
    const artifact = workflow.rules?.draft
    if (artifact === undefined) return
    const abort = new AbortController()
    void loadContent(sessionId, artifact, abort.signal).then((content) => {
      const parsed = RuleDraftArtifactV1Schema.safeParse(content)
      if (!parsed.success || parsed.data.activeDatasetId !== dataset?.id) return
      if (parsed.data.origin === 'agent') {
        setSuggestion(parsed.data.rules)
      } else {
        setDraft(parsed.data.rules)
        setSelectedId(current => current ?? parsed.data.rules[0]?.id)
        setDirty(false)
      }
    }, () => { if (!abort.signal.aborted) setError(t('workbench.rules.loadFailed')) })
    return () => { abort.abort() }
  }, [dataset?.id, loadContent, sessionId, t, workflow.rules?.draft?.id])

  useEffect(() => {
    const artifact = workflow.rules?.preview
    if (artifact === undefined) return
    const abort = new AbortController()
    void loadContent(sessionId, artifact, abort.signal).then((content) => {
      const parsed = RulePreviewArtifactV1Schema.safeParse(content)
      if (parsed.success && parsed.data.activeDatasetId === dataset?.id) setPreview(parsed.data)
    }, () => { if (!abort.signal.aborted) setError(t('workbench.rules.loadFailed')) })
    return () => { abort.abort() }
  }, [dataset?.id, loadContent, sessionId, t, workflow.rules?.preview?.id])

  useEffect(() => {
    if (waitingRevision !== undefined && workflow.revision > waitingRevision) setWaitingRevision(undefined)
  }, [waitingRevision, workflow.revision])

  if (dataset === undefined) return <div className={css.emptyState}><p>{t('workbench.rules.requiresData')}</p></div>
  if (draft === undefined && suggestion === undefined) {
    return (
      <section className={css.dataView} aria-label={t('workbench.rules.title')}>
        <header className={css.pageHeading}>
          <div><p className={css.eyebrow}>{t('workbench.rules.eyebrow')}</p><h2>{t('workbench.rules.startTitle')}</h2><p>{t('workbench.rules.startDescription')}</p></div>
          <div className={css.contextChips}><span>{dataset.id}</span><span>rev {workflow.revision}</span></div>
        </header>
        <section className={css.nextSuggestion}>
          <div><strong>{t('workbench.rules.explicitTitle')}</strong><p>{t('workbench.rules.explicitDescription')}</p></div>
          <button type="button" className={css.primary} disabled={proposalPending} onClick={onRequestProposal}>
            {proposalPending ? t('workbench.rules.waitingAgent') : t('workbench.data.continue')}
          </button>
        </section>
        {proposalFailed && <p className={css.dataError} role="alert">{t('workbench.rules.sendFailed')}</p>}
      </section>
    )
  }

  const applySuggestion = (): void => {
    if (suggestion === undefined) return
    const copied = suggestion.map(rule => ({ ...rule, sources: [...rule.sources], keywords: [...rule.keywords], exceptions: [...rule.exceptions] }))
    setDraft(copied)
    setSelectedId(copied[0]?.id)
    setSuggestion(undefined)
    setDirty(false)
  }
  const selected = draft?.find(rule => rule.id === selectedId) ?? draft?.[0]
  const updateSelected = (change: Partial<TenderRuleV1>): void => {
    if (selected === undefined || draft === undefined) return
    setDraft(draft.map(rule => rule.id === selected.id ? { ...rule, ...change } : rule))
    setDirty(true)
    setError(undefined)
  }
  const fingerprint = draft === undefined ? undefined : ruleDraftFingerprint(draft)
  const previewFresh = preview !== undefined
    && fingerprint === preview.draftFingerprint
    && preview.activeDatasetId === dataset.id
    && preview.stateRevision === workflow.revision
    && workflow.rules?.preview?.id !== undefined
    && workflow.rules.previewRevision === workflow.revision

  const dispatch = async (intent: TenderWorkbenchIntentV1): Promise<void> => {
    setSending(true)
    setError(undefined)
    try {
      await sendIntent(intent)
      setWaitingRevision(workflow.revision)
    } catch {
      setError(t('workbench.rules.sendFailed'))
    } finally {
      setSending(false)
    }
  }
  const previewRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    if (!parsed.success) { setError(t('workbench.rules.invalid')); return }
    void dispatch(createPreviewRulesIntent({
      commandId: createCommandId(), activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, rules: parsed.data,
    }))
  }
  const adjustRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    if (!parsed.success || instruction.trim() === '') { setError(t('workbench.rules.adjustRequired')); return }
    void dispatch(createAdjustRulesIntent({
      commandId: createCommandId(), activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, instruction, rules: parsed.data,
    }))
  }
  const confirmRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    const previewArtifact = workflow.rules?.preview
    if (!parsed.success || !previewFresh || previewArtifact === undefined) { setError(t('workbench.rules.previewStale')); return }
    void dispatch(createConfirmRulesIntent({
      commandId: createCommandId(), activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, previewArtifactId: previewArtifact.id, rules: parsed.data,
    }))
  }

  return (
    <section className={css.dataView} aria-label={t('workbench.rules.title')}>
      <header className={css.pageHeading}>
        <div><p className={css.eyebrow}>{t('workbench.rules.eyebrow')}</p><h2>{t('workbench.rules.title')}</h2><p>{t('workbench.rules.description')}</p></div>
        <div className={css.contextChips}><span>{dataset.id}</span><span>rev {workflow.revision}</span></div>
      </header>

      {workflow.rules?.ruleSetVersion !== undefined && workflow.classification !== undefined && (
        <p className={css.scopeNotice}>{t('workbench.rules.confirmedVersion', { version: workflow.rules.ruleSetVersion })}</p>
      )}

      {suggestion !== undefined && (
        <section className={css.agentSuggestion} role="status">
          <div><strong>{t('workbench.rules.agentSuggestion')}</strong><p>{t('workbench.rules.agentSuggestionDescription', { count: suggestion.length })}</p></div>
          <button type="button" className={css.primary} onClick={applySuggestion}>{t('workbench.rules.applySuggestion')}</button>
        </section>
      )}

      {draft !== undefined && selected !== undefined && (
        <div className={css.rulesLayout}>
          <section className={css.ruleList} aria-label={t('workbench.rules.list')}>
            {draft.map((rule) => (
              <div key={rule.id} className={rule.id === selected.id ? css.ruleSelected : css.ruleItem}>
                <button type="button" className={css.ruleSelectButton} onClick={() => { setSelectedId(rule.id) }}>
                  <span><strong>{rule.name}</strong><small>{rule.id} · P{rule.priority}</small></span>
                </button>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  aria-label={t('workbench.rules.enabled', { name: rule.name })}
                  onChange={event => { setDraft(draft.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item)); setDirty(true) }}
                />
              </div>
            ))}
          </section>
          <section className={css.ruleEditor} aria-label={t('workbench.rules.editor')}>
            <div className={css.editorGrid}>
              <label><span>{t('workbench.rules.name')}</span><input value={selected.name} maxLength={128} onChange={event => { updateSelected({ name: event.target.value }) }} /></label>
              <label><span>{t('workbench.rules.action')}</span><select value={selected.action} onChange={event => { updateSelected({ action: event.target.value as TenderRuleV1['action'] }) }}><option value="include">{t('workbench.classification.include')}</option><option value="observe">{t('workbench.classification.observe')}</option><option value="manual-review">{t('workbench.classification.manual-review')}</option><option value="exclude">{t('workbench.classification.exclude')}</option></select></label>
              <label><span>{t('workbench.rules.sources')}</span><select value={selected.sources.length === 2 ? 'all' : selected.sources[0]} onChange={event => { updateSelected({ sources: event.target.value === 'all' ? ['tender', 'proposed'] : [event.target.value as 'tender' | 'proposed'] }) }}><option value="all">{t('workbench.rules.source.all')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select></label>
              <label><span>{t('workbench.rules.scope')}</span><select value={selected.scope} onChange={event => { updateSelected({ scope: event.target.value as TenderRuleV1['scope'] }) }}><option value="title">{t('workbench.rules.scope.title')}</option><option value="purchaser">{t('workbench.rules.scope.purchaser')}</option><option value="all">{t('workbench.rules.scope.all')}</option></select></label>
              <label><span>{t('workbench.rules.priority')}</span><input type="number" min={-1000} max={1000} value={selected.priority} onChange={event => { updateSelected({ priority: Number(event.target.value) }) }} /></label>
              <label className={css.editorWide}><span>{t('workbench.rules.keywords')}</span><textarea value={selected.keywords.join('，')} onChange={event => { updateSelected({ keywords: terms(event.target.value) }) }} /></label>
              <label className={css.editorWide}><span>{t('workbench.rules.exceptions')}</span><textarea value={selected.exceptions.join('，')} onChange={event => { updateSelected({ exceptions: terms(event.target.value) }) }} /></label>
              <label className={css.editorWide}><span>{t('workbench.rules.reason')}</span><textarea maxLength={512} value={selected.reason} onChange={event => { updateSelected({ reason: event.target.value }) }} /></label>
            </div>
            <p className={css.scopeNotice}>{t('workbench.rules.matchingSemantics')}</p>
          </section>
        </div>
      )}

      {draft !== undefined && (
        <section className={css.adjustCard}>
          <label><span>{t('workbench.rules.adjust')}</span><textarea value={instruction} maxLength={2048} placeholder={t('workbench.rules.adjustPlaceholder')} onChange={event => { setInstruction(event.target.value) }} /></label>
          <button type="button" className={css.secondary} disabled={sending} onClick={adjustRules}>{t('workbench.rules.askAgent')}</button>
          <button type="button" className={css.primary} disabled={sending} onClick={previewRules}>{t('workbench.rules.runPreview')}</button>
        </section>
      )}

      {(sending || waitingRevision !== undefined) && <p className={css.dataLoading} role="status">{t('workbench.rules.waitingAgent')}</p>}
      {(workflow.stages.rules.errorMessage ?? workflow.stages.classification.errorMessage) !== undefined && (
        <p className={css.dataError} role="alert">{workflow.stages.rules.errorMessage ?? workflow.stages.classification.errorMessage}</p>
      )}
      {error !== undefined && <p className={css.dataError} role="alert">{error}</p>}
      {preview !== undefined && draft !== undefined && <RulePreview preview={preview} rules={draft} t={t} />}
      {preview !== undefined && !previewFresh && (dirty || workflow.classification === undefined) && <p className={css.staleNotice} role="alert">{t('workbench.rules.previewStale')}</p>}

      {draft !== undefined && preview !== undefined && (dirty || previewFresh || workflow.classification === undefined) && (
        <section className={css.confirmCard}>
          <div>
            <strong>{t('workbench.rules.confirmTitle')}</strong>
            <p>{t('workbench.rules.confirmDescription', { snapshot: dataset.id, count: draft.length, covered: preview.covered, conflicts: preview.conflicts })}</p>
            <small>{t('workbench.rules.conflictPolicy')}</small>
          </div>
          <button type="button" className={css.primary} disabled={!previewFresh || sending} onClick={confirmRules}>{t('workbench.rules.confirm')}</button>
        </section>
      )}
    </section>
  )
}

interface ClassificationViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly loadRows: ClassifiedRowsLoader
  readonly loadContent: RuleContentLoader
  readonly t: TenderTranslate
}

export function TenderClassificationView({ sessionId, workflow, loadRows, loadContent, t }: ClassificationViewProps) {
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
    void loadRows(sessionId, classification.data, filter, abort.signal).then(setData, () => { if (!abort.signal.aborted) setFailed(true) })
    return () => { abort.abort() }
  }, [classification, filter, loadRows, sessionId])

  useEffect(() => {
    const artifact = workflow.rules?.confirmed
    if (artifact === undefined) return
    const abort = new AbortController()
    void loadContent(sessionId, artifact, abort.signal).then((content) => {
      if ('rules' in content && !('origin' in content)) setRules(content.rules)
    })
    return () => { abort.abort() }
  }, [loadContent, sessionId, workflow.rules?.confirmed?.id])

  if (classification === undefined) return null
  const maximumPage = Math.max(1, Math.ceil((data?.total ?? 0) / 50))
  const reset = () => { setPage(1); setSelected(undefined) }
  const ruleName = (id: string | undefined) => rules.find(rule => rule.id === id)?.name ?? id ?? t('workbench.classification.none')
  return (
    <section className={css.dataView} aria-label={t('workbench.classification.title')}>
      <header className={css.pageHeading}>
        <div><p className={css.eyebrow}>{t('workbench.classification.eyebrow')}</p><h2>{t('workbench.classification.title')}</h2><p>{t('workbench.classification.description')}</p></div>
        <div className={css.contextChips}><span>{classification.activeDatasetId}</span><span>{classification.ruleSetVersion}</span></div>
      </header>
      <div className={css.classificationGrid}>
        {([
          ['include', classification.include], ['observe', classification.observe],
          ['manual-review', classification.manualReview], ['exclude', classification.exclude],
          ['unmatched', classification.unmatched],
        ] as const).map(([value, count]) => (
          <button key={value} type="button" className={css.classificationMetric} data-classification={value} onClick={() => { setCategory(value); reset() }}>
            <span>{t(`workbench.classification.${value}`)}</span><strong>{count}</strong><small>{t('workbench.classification.openDetails')}</small>
          </button>
        ))}
      </div>
      <div className={css.impactSummary}><span>{t('workbench.rules.covered', { covered: classification.covered, total: classification.data.rowCount ?? 0 })}</span><span>{t('workbench.rules.conflicts', { count: classification.conflicts })}</span></div>
      <section className={css.screenCard}>
        <div className={css.detailToolbar}>
          <input type="search" aria-label={t('workbench.classification.search')} value={query} placeholder={t('workbench.classification.searchPlaceholder')} onChange={event => { setQuery(event.target.value); reset() }} />
          <select aria-label={t('workbench.data.filterSource')} value={source ?? ''} onChange={event => { setSource(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof source>); reset() }}><option value="">{t('workbench.data.filterSourceAll')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select>
          <select aria-label={t('workbench.classification.filter')} value={category ?? ''} onChange={event => { setCategory(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof category>); reset() }}><option value="">{t('workbench.classification.all')}</option>{(['include', 'observe', 'manual-review', 'exclude', 'unmatched'] as const).map(value => <option key={value} value={value}>{t(`workbench.classification.${value}`)}</option>)}</select>
          <select aria-label={t('workbench.classification.ruleFilter')} value={ruleId ?? ''} onChange={event => { setRuleId(event.target.value || undefined); reset() }}><option value="">{t('workbench.classification.ruleAll')}</option>{rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select>
          <select aria-label={t('workbench.classification.conflictFilter')} value={conflict === undefined ? '' : String(conflict)} onChange={event => { setConflict(event.target.value === '' ? undefined : event.target.value === 'true'); reset() }}><option value="">{t('workbench.classification.conflictAll')}</option><option value="true">{t('workbench.classification.conflictOnly')}</option><option value="false">{t('workbench.classification.noConflict')}</option></select>
          <select aria-label={t('workbench.data.filterStatus')} value={fieldFilter ?? ''} onChange={event => { setFieldFilter(event.target.value === '' ? undefined : event.target.value as NonNullable<typeof fieldFilter>); reset() }}><option value="">{t('workbench.data.filterStatusAll')}</option><option value="normalized">{t('workbench.data.status.normalized')}</option><option value="missing">{t('workbench.data.status.missing')}</option><option value="unparseable">{t('workbench.data.status.unparseable')}</option></select>
        </div>
        {failed ? <p className={css.dataError} role="alert">{t('workbench.data.loadFailed')}</p> : data === undefined ? <p className={css.dataLoading} role="status">{t('workbench.data.loading')}</p> : (
          <>
            <div className={css.dataTableWrap}><table className={css.dataTable}><thead><tr><th>{t('workbench.classification.column.classification')}</th><th>{t('workbench.data.column.project')}</th><th>{t('workbench.classification.column.finalRule')}</th><th>{t('workbench.classification.column.matches')}</th><th>{t('workbench.classification.column.conflict')}</th><th>{t('workbench.data.column.source')}</th><th>{t('workbench.data.column.status')}</th><th /></tr></thead><tbody>{data.rows.map(row => <tr key={row.project.recordId}><td><span className={css.sourceTag} data-source={row.classification}>{t(`workbench.classification.${row.classification}`)}</span></td><td><strong>{row.project.title}</strong><small>{row.project.sourceId}</small></td><td>{ruleName(row.finalRuleId)}</td><td>{row.rawMatches.map(match => ruleName(match.ruleId)).join('、') || '—'}</td><td>{row.conflictRuleIds.length > 0 ? t('workbench.classification.hasConflict') : '—'}</td><td>{t(`workbench.data.source.${row.project.source}`)}</td><td>{t(`workbench.data.status.${fieldStatus(row)}`)}</td><td><button type="button" className={css.backButton} onClick={() => { setSelected(row) }}>{t('workbench.classification.trace')}</button></td></tr>)}</tbody></table></div>
            <footer className={css.tableFooter}><span>{t('workbench.data.pageSummary', { page: data.page, pages: maximumPage, total: data.total })}</span><div><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('workbench.data.previous')}</button><button type="button" disabled={page >= maximumPage} onClick={() => { setPage(value => value + 1) }}>{t('workbench.data.next')}</button></div></footer>
          </>
        )}
      </section>
      {selected !== undefined && (
        <section className={css.traceCard} aria-label={t('workbench.classification.traceTitle')}>
          <header><div><strong>{selected.project.title}</strong><p>{t('workbench.classification.tracePath')}</p></div><button type="button" onClick={() => { setSelected(undefined) }}>{t('action.cancel')}</button></header>
          <ol>
            <li><strong>{t('workbench.classification.traceSource')}</strong><span>{t(`workbench.data.source.${selected.project.source}`)} · {selected.project.sourceId}</span></li>
            <li><strong>{t('workbench.classification.traceNormalized')}</strong><span>{selected.project.title} · {selected.project.counterparty.value ?? t('workbench.data.value.missing')} · dataDisposition={selected.project.dataDisposition}</span></li>
            <li><strong>{t('workbench.classification.traceMatches')}</strong><span>{selected.rawMatches.map(match => `${ruleName(match.ruleId)} [${match.matchedKeywords.join('、')}]${match.eligible ? '' : ` (${t('workbench.classification.exception')}: ${match.exceptionKeywords.join('、')})`}`).join('；') || t('workbench.classification.none')}</span></li>
            <li><strong>{t('workbench.classification.traceDecision')}</strong><span>{t(`workbench.classification.decision.${selected.decision.kind}`)} · {ruleName(selected.finalRuleId)} · {t(`workbench.classification.${selected.classification}`)}</span></li>
          </ol>
        </section>
      )}
      <section className={css.nextSuggestion}><div><strong>{t('workbench.classification.nextTitle')}</strong><p>{t('workbench.classification.nextDescription')}</p></div><span className={css.stageState}>{t('workbench.classification.s4Unavailable')}</span></section>
    </section>
  )
}
