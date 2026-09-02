import { useEffect, useId, useMemo, useState } from 'react'
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
  createAdjustRulesIntent,
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
  ProgressMeter,
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

function rulesEqual(left: TenderRuleV1, right: TenderRuleV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
      <span>{t(`workbench.rules.sample.${sample.kind}`)}</span>
      <strong>{sample.title}</strong>
      <small>{t(`workbench.data.source.${sample.source}`)} · {t(`workbench.classification.${sample.classification}`)}</small>
    </article>
  )
}

function RulePreview({ preview, rules, status, t }: {
  readonly preview: RulePreviewArtifactV1
  readonly rules: readonly TenderRuleV1[]
  readonly status: 'suggested' | 'current' | 'accepted' | 'stale'
  readonly t: TenderTranslate
}) {
  const nameOf = (ruleId: string) => rules.find(rule => rule.id === ruleId)?.name ?? ruleId
  const exceptionCount = preview.ruleImpacts.reduce((sum, impact) => sum + impact.exceptionCount, 0)
  const kindOrder = { conflict: 0, exception: 1, boundary: 2, match: 3 } as const
  const samples = [...preview.samples].sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind])
  const featuredSamples = samples.slice(0, 4)
  const remainingSamples = samples.slice(featuredSamples.length)
  return (
    <section className={css.screenCard} aria-label={t('workbench.rules.preview')}>
      <SurfaceHeader
        title={t('workbench.rules.preview')}
        description={t('workbench.rules.previewBoundary')}
        action={<StatusPill tone={status === 'stale' ? 'warning' : status === 'accepted' ? 'success' : 'brand'}>{t(status === 'suggested'
          ? 'workbench.rules.previewSuggested'
          : status === 'current'
            ? 'workbench.rules.previewCurrent'
            : status === 'accepted'
              ? 'workbench.rules.previewAccepted'
              : 'workbench.rules.previewExpired')}</StatusPill>}
      />
      <div className={css.previewSummaryHeading}>
        <div><strong>{t('workbench.rules.previewSummary')}</strong><p>{t('workbench.rules.previewSummaryDescription')}</p></div>
        <div className={css.previewHeadlineMetrics}>
          <span data-emphasis={preview.covered > 0 ? 'strong' : 'muted'}><small>{t('workbench.rules.previewCoverage')}</small><strong>{preview.covered} / {preview.total}</strong></span>
          <span data-emphasis={preview.conflicts > 0 ? 'warning' : 'muted'}><small>{t('workbench.classification.column.conflict')}</small><strong>{preview.conflicts}</strong></span>
          <span data-emphasis={exceptionCount > 0 ? 'warning' : 'muted'}><small>{t('workbench.classification.exception')}</small><strong>{exceptionCount}</strong></span>
        </div>
      </div>
      <div className={css.classificationGrid}>
        {([
          ['include', preview.counts.include],
          ['observe', preview.counts.observe],
          ['manual-review', preview.counts.manualReview],
          ['exclude', preview.counts.exclude],
          ['unmatched', preview.counts.unmatched],
        ] as const).map(([value, count]) => (
          <MetricCard
            key={value}
            label={t(`workbench.classification.${value}`)}
            value={count}
            tone={value === 'exclude' ? 'danger' : value === 'manual-review' ? 'purple' : value === 'observe' ? 'warning' : value === 'include' ? 'success' : 'neutral'}
            dataClassification={value}
            muted={count === 0}
          />
        ))}
      </div>
      <div className={css.impactSummary}>
        <span>{t('workbench.rules.covered', { covered: preview.covered, total: preview.total })}</span>
        <span data-emphasis={preview.conflicts > 0 ? 'warning' : 'muted'}>{t('workbench.rules.conflicts', { count: preview.conflicts })}</span>
        <span data-emphasis={exceptionCount > 0 ? 'warning' : 'muted'}>{t('workbench.rules.previewExceptions', { count: exceptionCount })}</span>
        <span>{t('workbench.rules.rawMatches', { count: preview.rawMatches })}</span>
      </div>
      <details className={css.previewDisclosure}>
        <summary>{t('workbench.rules.previewDefinitions')}</summary>
        <div className={css.previewDefinitions}>
          {(['Raw', 'Final', 'Conflict', 'Exception'] as const).map(key => (
            <p key={key}>{t(`workbench.rules.previewDefinition${key}`)}</p>
          ))}
        </div>
      </details>
      <details className={css.previewDisclosure} data-preview-impacts>
        <summary>{t('workbench.rules.previewRuleImpacts', { count: preview.ruleImpacts.length })}</summary>
        <div className={css.ruleImpactList}>
          {preview.ruleImpacts.map((impact) => {
            const ruleSamples = samples.filter(sample => sample.finalRuleId === impact.ruleId || sample.matchedRuleIds.includes(impact.ruleId))
            return (
              <article key={impact.ruleId} className={css.ruleImpactRow}>
                <header><strong>{nameOf(impact.ruleId)}</strong></header>
                <dl>
                  <div><dt>{t('workbench.rules.previewMetricRaw')}</dt><dd>{impact.rawMatchCount}</dd></div>
                  <div><dt>{t('workbench.rules.previewMetricFinal')}</dt><dd>{impact.finalCount}</dd></div>
                  <div data-emphasis={impact.conflictCount > 0 ? 'warning' : 'muted'}><dt>{t('workbench.classification.column.conflict')}</dt><dd>{impact.conflictCount}</dd></div>
                  <div data-emphasis={impact.exceptionCount > 0 ? 'warning' : 'muted'}><dt>{t('workbench.classification.exception')}</dt><dd>{impact.exceptionCount}</dd></div>
                </dl>
                {ruleSamples.length > 0 && (
                  <details className={css.ruleSamples} data-preview-samples="rule">
                    <summary>{t('workbench.rules.previewRuleSamples', { count: ruleSamples.length })}</summary>
                    <div className={css.sampleGrid}>{ruleSamples.map((sample, index) => <PreviewSample key={`${sample.kind}:${sample.recordId}:${index}`} sample={sample} t={t} />)}</div>
                  </details>
                )}
              </article>
            )
          })}
        </div>
      </details>
      {featuredSamples.length > 0 && (
        <details className={css.previewDisclosure} data-preview-samples="all">
          <summary>{t('workbench.rules.previewSamplesCount', { count: samples.length })}</summary>
          <section className={css.sampleSection} aria-label={t('workbench.rules.previewSamples')}>
            <header><strong>{t('workbench.rules.previewSamples')}</strong><p>{t('workbench.rules.previewSamplesDescription')}</p></header>
            <div className={css.sampleGrid} data-preview-samples="featured">{featuredSamples.map((sample, index) => <PreviewSample key={`${sample.kind}:${sample.recordId}:${index}`} sample={sample} t={t} />)}</div>
            {remainingSamples.length > 0 && (
              <details className={css.moreSamples} data-preview-samples="remaining">
                <summary>{t('workbench.rules.previewMoreSamples', { count: remainingSamples.length })}</summary>
                <div className={css.sampleGrid}>{remainingSamples.map((sample, index) => <PreviewSample key={`${sample.kind}:${sample.recordId}:${index}`} sample={sample} t={t} />)}</div>
              </details>
            )}
          </section>
        </details>
      )}
    </section>
  )
}

export function TenderRulesView({
  sessionId,
  workflow,
  loadContent,
  write,
  onRequestProposal,
  t,
}: RulesViewProps) {
  const writeReasonId = useId()
  const dataset = workflow.query?.normalizedData
  const [draft, setDraft] = useState<readonly TenderRuleV1[]>()
  const [suggestion, setSuggestion] = useState<readonly TenderRuleV1[]>()
  const [selectedId, setSelectedId] = useState<string>()
  const [preview, setPreview] = useState<RulePreviewArtifactV1>()
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState<string>()
  const writeDisabledReason = write.busy
    ? t('workbench.write.busyReason', {
      action: sessionWriteProgressText(t, write.state) ?? t('workbench.rules.waitingAgent'),
    })
    : undefined

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

  if (dataset === undefined) return <div className={css.emptyState}><p>{t('workbench.rules.requiresData')}</p></div>
  if (draft === undefined && suggestion === undefined) {
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
  const displayedRules = suggestion ?? draft
  const fingerprint = displayedRules === undefined ? undefined : ruleDraftFingerprint(displayedRules)
  const previewMatchesCurrentState = preview !== undefined
    && fingerprint === preview.draftFingerprint
    && preview.activeDatasetId === dataset.id
    && preview.stateRevision === workflow.revision
    && workflow.rules?.preview?.id !== undefined
    && workflow.rules.previewRevision === workflow.revision
  const previewFresh = draft !== undefined && previewMatchesCurrentState
  const suggestionPreviewFresh = draft === undefined && suggestion !== undefined && previewMatchesCurrentState
  const confirmDisabledReason = write.busy
    ? t('workbench.rules.confirmDisabledRunning')
    : !previewFresh
      ? t('workbench.rules.confirmDisabledStale')
      : undefined
  const previewAccepted = previewMatchesCurrentState
    && workflow.rules?.ruleSetVersion !== undefined
    && workflow.classification !== undefined
    && !dirty
  const hasInstruction = instruction.trim() !== ''
  const previewPresentationStatus = suggestionPreviewFresh
    ? 'suggested'
    : previewFresh
      ? 'current'
      : previewAccepted
        ? 'accepted'
        : 'stale'
  const previewRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    if (!parsed.success) { setError(t('workbench.rules.invalid')); return }
    setError(undefined)
    write.start('rules.preview', commandId => createPreviewRulesIntent({
      commandId, activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, rules: parsed.data,
    }))
  }
  const adjustRules = (): void => {
    const parsed = TenderRuleSetV1Schema.safeParse(draft)
    if (!parsed.success || instruction.trim() === '') { setError(t('workbench.rules.adjustRequired')); return }
    setError(undefined)
    write.start('rules.adjust', commandId => createAdjustRulesIntent({
      commandId, activeDatasetRef: dataset.id,
      projectionRevision: workflow.revision, instruction, rules: parsed.data,
    }))
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
  const taskState = suggestion !== undefined
    ? 'suggestion'
    : hasInstruction
      ? 'adjust'
      : previewFresh
        ? 'confirm'
        : 'preview'
  const taskAction = taskState === 'suggestion' ? (
    <button type="button" className={css.primary} disabled={write.busy} aria-describedby={write.busy ? writeReasonId : undefined} title={writeDisabledReason} onClick={applySuggestion}>{t('workbench.rules.applySuggestion')}</button>
  ) : taskState === 'adjust' ? (
    <button type="button" className={css.primary} data-write-button="rules.adjust" disabled={write.busy} aria-busy={write.state.action === 'rules.adjust' && write.busy} aria-describedby={write.busy ? writeReasonId : undefined} title={writeDisabledReason} onClick={adjustRules}>
      <SessionWriteButtonLabel action="rules.adjust" idle={t('workbench.rules.askAgent')} t={t} write={write} />
    </button>
  ) : taskState === 'confirm' ? (
    <button
      type="button"
      className={css.primary}
      data-write-button="rules.confirm"
      disabled={write.busy}
      aria-busy={write.state.action === 'rules.confirm' && write.busy}
      aria-describedby={write.busy ? writeReasonId : undefined}
      title={confirmDisabledReason}
      onClick={confirmRules}
    >
      <SessionWriteButtonLabel action="rules.confirm" idle={t('workbench.rules.confirm')} t={t} write={write} />
    </button>
  ) : (
    <button type="button" className={css.primary} data-write-button="rules.preview" disabled={write.busy} aria-busy={write.state.action === 'rules.preview' && write.busy} aria-describedby={write.busy ? writeReasonId : undefined} title={writeDisabledReason} onClick={previewRules}>
      <SessionWriteButtonLabel action="rules.preview" idle={t('workbench.rules.runPreview')} t={t} write={write} />
    </button>
  )

  return (
    <section className={css.dataView} aria-label={t('workbench.rules.title')} aria-busy={write.busy}>
      <PageHeader
        eyebrow={t('workbench.rules.eyebrow')}
        title={t('workbench.rules.pageTitle')}
        description={t('workbench.rules.description')}
        aside={<StatusPill tone={taskState === 'confirm' ? 'success' : taskState === 'preview' && dirty ? 'warning' : 'brand'}>{t(`workbench.rules.taskStatus.${taskState}`)}</StatusPill>}
      />

      <StatePanel
        tone={taskState === 'confirm' ? 'success' : taskState === 'preview' && dirty ? 'warning' : 'brand'}
        title={t(`workbench.rules.taskTitle.${taskState}`)}
        description={t(`workbench.rules.taskDescription.${taskState}`, {
          count: suggestion?.length ?? draft?.length ?? 0,
          covered: preview?.covered ?? 0,
          conflicts: preview?.conflicts ?? 0,
        })}
        action={taskAction}
      />

      {draft !== undefined && suggestion === undefined && (
        <section className={css.adjustCard} aria-label={t('workbench.rules.adjust')}>
          <div className={css.agentAvatar} aria-hidden="true">招</div>
          <label><span>{t('workbench.rules.adjust')}</span><textarea disabled={write.busy} value={instruction} maxLength={2048} placeholder={t('workbench.rules.adjustPlaceholder')} onChange={event => { setInstruction(event.target.value) }} /></label>
          <small>{t('workbench.rules.adjustHint')}</small>
        </section>
      )}

      {suggestion !== undefined && (
        <section className={css.agentSuggestion} role="status">
          <header>
            <div><strong>{t('workbench.rules.agentSuggestion')}</strong><p>{t('workbench.rules.agentSuggestionDescription', { count: suggestion.length })}</p></div>
          </header>
          <div className={css.suggestionDiff} aria-label={t('workbench.rules.suggestionDiff')}>
            {suggestion.map((rule) => {
              const previous = draft?.find(candidate => candidate.id === rule.id)
              const change = previous === undefined ? 'Added' : rulesEqual(previous, rule) ? 'Unchanged' : 'Changed'
              return (
                <article key={rule.id} data-change={change.toLowerCase()}>
                  <span>{t(`workbench.rules.suggestion${change}`)}</span>
                  <strong>{rule.name}</strong>
                  <small>{t('workbench.rules.suggestionMeta', { action: t(`workbench.classification.${rule.action}`), sources: rule.sources.map(source => t(`workbench.data.source.${source}`)).join(' / '), priority: rule.priority })}</small>
                </article>
              )
            })}
            {draft?.filter(rule => !suggestion.some(candidate => candidate.id === rule.id)).map(rule => (
              <article key={rule.id} data-change="removed"><span>{t('workbench.rules.suggestionRemoved')}</span><strong>{rule.name}</strong></article>
            ))}
          </div>
        </section>
      )}

      {draft !== undefined && selected !== undefined && (
        <div className={css.rulesLayout}>
          <section className={css.ruleList} aria-label={t('workbench.rules.list')}>
            {draft.map((rule) => (
              <div key={rule.id} className={rule.id === selected.id ? css.ruleSelected : css.ruleItem}>
                <button type="button" className={css.ruleSelectButton} aria-pressed={rule.id === selected.id} onClick={() => { setSelectedId(rule.id) }}>
                  <span>
                    <strong>{rule.name}</strong>
                    <small><span data-classification={rule.action}>{t(`workbench.classification.${rule.action}`)}</span><span>{t('workbench.rules.priority')} {rule.priority}</span><span>{t(rule.enabled ? 'workbench.rules.enabledShort' : 'workbench.rules.disabledShort')}</span></small>
                  </span>
                </button>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={write.busy}
                  aria-label={t('workbench.rules.enabled', { name: rule.name })}
                  onChange={event => { setDraft(draft.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item)); setDirty(true) }}
                />
              </div>
            ))}
          </section>
          <section className={css.ruleEditor} aria-label={t('workbench.rules.editor')}>
            <header className={css.editorHeader}>
              <div><strong>{t('workbench.rules.editor')}</strong><span>{t(dirty ? 'workbench.rules.localChangesPending' : 'workbench.rules.localDraft')}</span></div>
              <span className={css.stageState} data-draft-state={dirty ? 'changed' : 'draft'}>{t(dirty ? 'workbench.rules.state.changed' : 'workbench.rules.state.editable')}</span>
            </header>
            <div className={css.editorGrid}>
              <label><span>{t('workbench.rules.name')}</span><input disabled={write.busy} value={selected.name} maxLength={128} onChange={event => { updateSelected({ name: event.target.value }) }} /></label>
              <label><span>{t('workbench.rules.action')}</span><select disabled={write.busy} value={selected.action} onChange={event => { updateSelected({ action: event.target.value as TenderRuleV1['action'] }) }}><option value="include">{t('workbench.classification.include')}</option><option value="observe">{t('workbench.classification.observe')}</option><option value="manual-review">{t('workbench.classification.manual-review')}</option><option value="exclude">{t('workbench.classification.exclude')}</option></select></label>
              <label><span>{t('workbench.rules.sources')}</span><select disabled={write.busy} value={selected.sources.length === 2 ? 'all' : selected.sources[0]} onChange={event => { updateSelected({ sources: event.target.value === 'all' ? ['tender', 'proposed'] : [event.target.value as 'tender' | 'proposed'] }) }}><option value="all">{t('workbench.rules.source.all')}</option><option value="tender">{t('workbench.data.source.tender')}</option><option value="proposed">{t('workbench.data.source.proposed')}</option></select></label>
              <label><span>{t('workbench.rules.scope')}</span><select disabled={write.busy} value={selected.scope} onChange={event => { updateSelected({ scope: event.target.value as TenderRuleV1['scope'] }) }}><option value="title">{t('workbench.rules.scope.title')}</option><option value="purchaser">{t('workbench.rules.scope.purchaser')}</option><option value="all">{t('workbench.rules.scope.all')}</option></select></label>
              <label className={css.editorWide}><span>{t('workbench.rules.keywords')}</span><textarea disabled={write.busy} value={selected.keywords.join('，')} onChange={event => { updateSelected({ keywords: terms(event.target.value) }) }} /></label>
              <label className={css.editorWide}><span>{t('workbench.rules.exceptions')}</span><textarea disabled={write.busy} value={selected.exceptions.join('，')} onChange={event => { updateSelected({ exceptions: terms(event.target.value) }) }} /></label>
              <label><span>{t('workbench.rules.priority')}</span><input disabled={write.busy} type="number" min={-1000} max={1000} value={selected.priority} onChange={event => { updateSelected({ priority: Number(event.target.value) }) }} /></label>
              <label className={css.editorWide}><span>{t('workbench.rules.reason')}</span><textarea disabled={write.busy} maxLength={512} value={selected.reason} onChange={event => { updateSelected({ reason: event.target.value }) }} /></label>
            </div>
          </section>
        </div>
      )}

      <SessionWriteProgress id={writeReasonId} t={t} write={write} />
      {(workflow.stages.rules.errorMessage ?? workflow.stages.classification.errorMessage) !== undefined && (
        <StatePanel tone="danger" role="alert" title={t('workbench.status.failed')} description={workflow.stages.rules.errorMessage ?? workflow.stages.classification.errorMessage} />
      )}
      {error !== undefined && <StatePanel tone="danger" role="alert" title={t('workbench.status.failed')} description={error} />}
      {preview !== undefined && !previewFresh && !suggestionPreviewFresh && (dirty || workflow.classification === undefined) && <StatePanel tone="warning" role="alert" title={t('workbench.rules.previewExpired')} description={t('workbench.rules.previewStale')} />}
      {preview !== undefined && displayedRules !== undefined && previewMatchesCurrentState && <RulePreview preview={preview} rules={displayedRules} status={previewPresentationStatus} t={t} />}
    </section>
  )
}

interface ClassificationViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly loadRows: ClassifiedRowsLoader
  readonly loadContent: RuleContentLoader
  readonly onOpenAnalysis: () => void
  readonly onOpenReview: () => void
  readonly t: TenderTranslate
}

export function TenderClassificationView({
  sessionId,
  workflow,
  loadRows,
  loadContent,
  onOpenAnalysis,
  onOpenReview,
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
  return (
    <section className={css.dataView} aria-label={t('workbench.classification.title')}>
      <PageHeader
        eyebrow={t('workbench.classification.eyebrow')}
        title={t('workbench.classification.title')}
        description={t('workbench.classification.description')}
        aside={<StatusPill tone="success">{t('workbench.phaseStatus.completed')}</StatusPill>}
      />
      <p className={css.scopeNotice}>{t('workbench.classification.boundary')}</p>
      <div className={css.classificationGrid}>
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
            onClick={() => { setCategory(current => current === value ? undefined : value); reset() }}
          >
            <span>{t(`workbench.classification.${value}`)}</span><strong>{count}</strong><small>{t('workbench.classification.openDetails')}</small>
          </button>
        ))}
      </div>
      <div className={css.classificationOverview}>
        <section className={css.summarySurface}>
          <SurfaceHeader title={t('workbench.classification.coverageTitle')} description={t('workbench.classification.coverageDescription')} />
          <ProgressMeter value={classification.covered} max={classification.data.rowCount ?? workflow.query?.total ?? 0} label={t('workbench.classification.coveredRecords')} />
        </section>
        <aside className={css.summarySurface}>
          <SurfaceHeader title={t('workbench.classification.auditTitle')} description={t('workbench.classification.auditDescription')} />
          <dl className={css.auditList}>
            <div><dt>{t('workbench.classification.auditNormalized')}</dt><dd>{workflow.query?.total ?? classification.data.rowCount ?? 0}</dd></div>
            <div data-tone={classification.conflicts > 0 ? 'warning' : 'neutral'}><dt>{t('workbench.classification.column.conflict')}</dt><dd>{classification.conflicts}</dd></div>
            <div><dt>{t('workbench.rules.rawMatches', { count: classification.covered })}</dt><dd>{workflow.rules?.rawMatches ?? classification.covered}</dd></div>
          </dl>
        </aside>
      </div>
      {rulesFailed && <p className={css.staleNotice} role="status">{t('workbench.classification.rulesLoadFailed')}</p>}
      <div className={selected === undefined ? css.classificationWorkspace : `${css.classificationWorkspace} ${css.classificationWorkspaceOpen}`}>
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
        <section className={css.traceCard} aria-label={t('workbench.classification.traceTitle')}>
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
      </div>
      <section className={css.nextSuggestion}>
        <div><strong>{t('workbench.classification.nextTitle')}</strong><p>{t('workbench.classification.nextDescription')}</p></div>
        <div className={css.nextActions}>
          <button type="button" className={css.secondary} onClick={onOpenReview}>{t('workbench.classification.openReview')}</button>
          <button type="button" className={css.primary} onClick={onOpenAnalysis}>{t('workbench.classification.openAnalysis')}</button>
        </div>
      </section>
    </section>
  )
}
