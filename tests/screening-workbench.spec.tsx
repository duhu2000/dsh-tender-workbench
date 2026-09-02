// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedProjectV1 } from '../src/contracts/dataset.ts'
import {
  ruleDraftFingerprint,
  type ClassifiedRecordV1,
  type RuleArtifactContentV1,
  type RulePreviewArtifactV1,
} from '../src/contracts/screening.ts'
import type { TenderRuleV1, TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
import type { TenderWorkbenchIntentV1 } from '../src/contracts/screening-intents.ts'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import { zh, type TenderKey } from '../src/client/locales.ts'
import type { TenderProjectionRead } from '../src/client/tender-projection-port.ts'
import { TenderWorkbenchView } from '../src/client/workbench/TenderWorkbench.tsx'
import { createTenderWorkbenchNavigationController } from '../src/client/workbench/navigation-controller.ts'
import type { ClassifiedRowsLoader, RuleContentLoader } from '../src/client/workbench/TenderScreeningViews.tsx'

const t = ((key: TenderKey, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as TranslateNS<'tenderFilter'>

afterEach(() => { cleanup() })

const createdAt = '2026-09-01T00:00:00.000Z'
const querySpec = { id: 'query-spec', kind: 'query-spec' as const, fileName: 'query.json', mediaType: 'application/json', createdAt, accessToken: 'query-token' }
const dataset = { id: 'active-data', kind: 'normalized-data' as const, fileName: 'data.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'data-token' }
const draftRef = { id: 'rule-draft', kind: 'rule-draft' as const, fileName: 'draft.json', mediaType: 'application/json', createdAt, accessToken: 'draft-token' }
const previewRef = { id: 'rule-preview', kind: 'rule-preview' as const, fileName: 'preview.json', mediaType: 'application/json', createdAt, accessToken: 'preview-token' }

const draftRules: readonly TenderRuleV1[] = [{
  id: 'r-data', name: '数据方向', enabled: true, action: 'include', sources: ['tender'], scope: 'title',
  keywords: ['数据'], priority: 100, exceptions: ['培训'], reason: '当前查询目标关注数据项目',
}]
const fingerprint = ruleDraftFingerprint(draftRules)

function queryProjection(revision = 1): TenderWorkflowProjectionV1 {
  const base = createEmptyTenderWorkflowProjection()
  return {
    ...base,
    revision,
    currentStage: 'overview',
    stages: { ...base.stages, query: { status: 'succeeded', updatedAt: createdAt }, overview: { status: 'succeeded', updatedAt: createdAt } },
    query: {
      scope: 'tender', targetSummary: '寻找数据项目', querySpec,
      sources: { tender: { status: 'succeeded', loaded: 2 } }, normalizedData: dataset,
      sourceRecordCount: 2, total: 2, duplicateCount: 0, invalidCount: 0, missingFieldCount: 1, unparseableFieldCount: 0,
    },
  }
}

function previewArtifact(origin: 'agent' | 'user' = 'agent', revision = 2, rules = draftRules): RulePreviewArtifactV1 {
  return {
    schemaVersion: 1,
    activeDatasetId: dataset.id,
    basedOnRevision: revision - 1,
    stateRevision: revision,
    draftFingerprint: ruleDraftFingerprint(rules),
    origin,
    counts: { include: 1, observe: 0, manualReview: 0, exclude: 0, unmatched: 1 },
    total: 2, covered: 1, conflicts: 0, rawMatches: 1,
    ruleImpacts: [{ ruleId: rules[0]?.id ?? 'r-data', rawMatchCount: 1, exceptionCount: 0, conflictCount: 0, finalCount: 1 }],
    samples: [{ kind: 'match', recordId: 'row-1', title: '数据治理平台', source: 'tender', classification: 'include', matchedRuleIds: [rules[0]?.id ?? 'r-data'], finalRuleId: rules[0]?.id ?? 'r-data' }],
  }
}

function draftProjection(origin: 'agent' | 'user' = 'agent', rules = draftRules, revision = 2): TenderWorkflowProjectionV1 {
  const base = queryProjection(revision)
  return {
    ...base,
    currentStage: 'rules',
    stages: { ...base.stages, rules: { status: 'succeeded', updatedAt: createdAt } },
    rules: {
      draft: draftRef, draftOrigin: origin, draftFingerprint: ruleDraftFingerprint(rules),
      preview: previewRef, previewRevision: revision, activeDatasetId: dataset.id,
      ruleCount: rules.length, rawMatches: 1, covered: 1, conflicts: 0,
    },
  }
}

function renderWorkbench(input: {
  readonly projection?: TenderProjectionRead
  readonly sendIntent?: ReturnType<typeof vi.fn<(intent: TenderWorkbenchIntentV1) => Promise<void>>>
  readonly loadContent?: RuleContentLoader
  readonly loadClassifiedRows?: ClassifiedRowsLoader
  readonly sessionId?: string
}) {
  let sequence = 0
  const sendIntent = input.sendIntent ?? vi.fn(async (_intent: TenderWorkbenchIntentV1) => {})
  const result = render(<TenderWorkbenchView
    sessionId={(input.sessionId ?? 'session-1') as never}
    projection={input.projection ?? { status: 'ready', projection: queryProjection() }}
    navigation={createTenderWorkbenchNavigationController()}
    sendIntent={sendIntent}
    createCommandId={() => `command-${++sequence}`}
    {...(input.loadContent === undefined ? {} : { loadRuleContent: input.loadContent })}
    {...(input.loadClassifiedRows === undefined ? {} : { loadClassifiedRows: input.loadClassifiedRows })}
    t={t}
  />)
  return { ...result, sendIntent, getCommandCount: () => sequence }
}

function expectWriteProgress(action: string, phase: string, label: string): HTMLElement {
  const progress = document.querySelector<HTMLElement>(
    `[data-write-action="${action}"][data-write-phase="${phase}"]`,
  )
  expect(progress).toBeTruthy()
  expect(progress?.textContent).toContain(label)
  return progress!
}

describe('S3 screening workbench', () => {
  it('does not enter S3 after query completion and sends rules.propose only after explicit continue', async () => {
    let releaseSend: (() => void) | undefined
    const sendIntent = vi.fn((_intent: TenderWorkbenchIntentV1) => new Promise<void>((resolve) => { releaseSend = resolve }))
    const view = renderWorkbench({ sendIntent })
    expect(sendIntent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(sendIntent).not.toHaveBeenCalled()
    const continueButton = screen.getByRole('button', { name: zh['workbench.data.continue'] })
    const continueForm = continueButton.closest('form')
    fireEvent.click(continueButton)
    fireEvent.click(continueButton)
    if (continueForm !== null) {
      fireEvent.submit(continueForm)
      fireEvent.submit(continueForm)
    }
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(view.getCommandCount()).toBe(1)
    expect(sendIntent.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1, commandId: 'command-1', kind: 'rules.propose', activeDatasetRef: dataset.id, projectionRevision: 1,
    })
    expectWriteProgress('rules.propose', 'sending', zh['workbench.write.propose.sending'])
    releaseSend?.()
    await waitFor(() => {
      expectWriteProgress('rules.propose', 'waiting-agent', zh['workbench.write.propose.waiting'])
    })
    expect((document.querySelector('[data-write-button="rules.propose"]') as HTMLButtonElement).disabled).toBe(true)
    expect(sendIntent).toHaveBeenCalledTimes(1)
  })

  it('requires applying an Agent structured suggestion before local editing and never persists local edits by itself', async () => {
    const adjustedRules = [{ ...draftRules[0]!, name: '调整后的数据方向', sources: ['tender', 'proposed'] as ('tender' | 'proposed')[] }]
    let currentRules = draftRules
    const loadContent = vi.fn<RuleContentLoader>(async (_session, artifact): Promise<RuleArtifactContentV1> => {
      if (artifact.kind === 'rule-preview') return previewArtifact('agent', 2, currentRules)
      return { schemaVersion: 1, activeDatasetId: dataset.id, basedOnRevision: 1, draftFingerprint: ruleDraftFingerprint(currentRules), origin: 'agent', rules: [...currentRules] }
    })
    const sendIntent = vi.fn(async (_intent: TenderWorkbenchIntentV1) => {})
    const view = renderWorkbench({ projection: { status: 'ready', projection: draftProjection() }, sendIntent, loadContent })
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(await screen.findByText(zh['workbench.rules.agentSuggestion'])).toBeTruthy()
    expect(await screen.findByText(zh['workbench.rules.previewSuggested'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.rules.previewSuggestedBindingDescription'])).toBeTruthy()
    expect(screen.queryByText(zh['workbench.rules.previewStale'])).toBeNull()
    expect(screen.queryByDisplayValue('数据方向')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.rules.applySuggestion'] }))
    const name = await screen.findByDisplayValue('数据方向')
    expect(screen.getByRole('button', { name: /数据方向/u }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(name, { target: { value: '用户本地编辑' } })
    expect(sendIntent).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText(zh['workbench.rules.adjustPlaceholder']), { target: { value: '扩展到拟建来源' } })
    expect(screen.queryByRole('button', { name: zh['workbench.rules.confirm'] })).toBeNull()
    const adjustButton = screen.getByRole('button', { name: zh['workbench.rules.askAgent'] })
    expect(document.querySelectorAll('[data-write-button]')).toHaveLength(1)
    const adjustForm = adjustButton.closest('form')
    fireEvent.click(adjustButton)
    fireEvent.click(adjustButton)
    if (adjustForm !== null) {
      fireEvent.submit(adjustForm)
      fireEvent.submit(adjustForm)
    }
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(view.getCommandCount()).toBe(1)
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({ commandId: 'command-1', kind: 'rules.adjust', instruction: '扩展到拟建来源', rules: [{ name: '用户本地编辑' }] })
    expect((screen.getByDisplayValue('用户本地编辑') as HTMLInputElement).disabled).toBe(true)
    await waitFor(() => {
      const progress = expectWriteProgress('rules.adjust', 'waiting-agent', zh['workbench.write.adjust.waiting'])
      expect(document.querySelector('[data-write-button="rules.adjust"]')?.getAttribute('aria-describedby')).toBe(progress.id)
    })
    expect((screen.getByRole('button', { name: /用户本地编辑/u }) as HTMLButtonElement).disabled).toBe(false)

    const runningAdjustment = {
      ...draftProjection(),
      activeOperation: {
        callId: 'call-adjust', commandId: 'command-1',
        command: 'tender_workbench_preview_rules' as const, stage: 'rules' as const,
      },
      stages: { ...draftProjection().stages, rules: { status: 'running' as const } },
    }
    view.rerender(<TenderWorkbenchView
      sessionId={'session-1' as never}
      projection={{ status: 'ready', projection: runningAdjustment }}
      navigation={createTenderWorkbenchNavigationController()}
      sendIntent={sendIntent}
      createCommandId={() => 'command-next'}
      loadRuleContent={loadContent}
      t={t}
    />)
    await waitFor(() => {
      expectWriteProgress('rules.adjust', 'running', zh['workbench.write.adjust.running'])
    })
    currentRules = adjustedRules
    view.rerender(<TenderWorkbenchView
      sessionId={'session-1' as never}
      projection={{ status: 'ready', projection: { ...draftProjection('agent', adjustedRules, 3), rules: { ...draftProjection('agent', adjustedRules, 3).rules!, draft: { ...draftRef, id: 'adjusted-draft' }, preview: { ...previewRef, id: 'adjusted-preview' } } } }}
      navigation={createTenderWorkbenchNavigationController()}
      sendIntent={sendIntent}
      createCommandId={() => 'command-next'}
      loadRuleContent={loadContent}
      t={t}
    />)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(await screen.findByText(zh['workbench.rules.agentSuggestion'])).toBeTruthy()
    expect(screen.getByDisplayValue('用户本地编辑')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.rules.applySuggestion'] }))
    expect(await screen.findByDisplayValue('调整后的数据方向')).toBeTruthy()
  })

  it('marks previews stale after a local edit, blocks confirmation, and previews only on explicit action', async () => {
    const content = vi.fn<RuleContentLoader>(async (_session, artifact) => artifact.kind === 'rule-preview'
      ? previewArtifact('user')
      : { schemaVersion: 1, activeDatasetId: dataset.id, basedOnRevision: 1, draftFingerprint: fingerprint, origin: 'user', rules: [...draftRules] })
    const sendIntent = vi.fn(async (_intent: TenderWorkbenchIntentV1) => {})
    const view = renderWorkbench({ projection: { status: 'ready', projection: draftProjection('user') }, sendIntent, loadContent: content })
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    const confirm = await screen.findByRole('button', { name: zh['workbench.rules.confirm'] })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    expect(screen.getAllByText(zh['workbench.technicalDetails']).length).toBeGreaterThan(0)
    expect(screen.getByText(zh['workbench.rules.previewSummary'])).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('数据方向'), { target: { value: '已修改名称' } })
    expect(await screen.findByText(zh['workbench.rules.previewStale'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['workbench.rules.confirm'] })).toBeNull()
    const previewButton = screen.getByRole('button', { name: zh['workbench.rules.runPreview'] })
    expect(document.querySelectorAll('[data-write-button]')).toHaveLength(1)
    const previewForm = previewButton.closest('form')
    fireEvent.click(previewButton)
    fireEvent.click(previewButton)
    if (previewForm !== null) {
      fireEvent.submit(previewForm)
      fireEvent.submit(previewForm)
    }
    await waitFor(() => { expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({ commandId: 'command-1', kind: 'rules.preview', rules: [{ name: '已修改名称' }] }) })
    expect(sendIntent).toHaveBeenCalledTimes(1)
    expect(view.getCommandCount()).toBe(1)
    await waitFor(() => {
      const progress = expectWriteProgress('rules.preview', 'waiting-agent', zh['workbench.write.preview.waiting'])
      const previewWrite = document.querySelector('[data-write-button="rules.preview"]')
      expect(previewWrite?.getAttribute('aria-busy')).toBe('true')
      expect(previewWrite?.getAttribute('aria-describedby')).toBe(progress.id)
    })

    view.rerender(<TenderWorkbenchView
      sessionId={'session-2' as never}
      projection={{ status: 'ready', projection: { ...queryProjection(), query: { ...queryProjection().query!, normalizedData: { ...dataset, id: 'session-2-data' } } } }}
      navigation={createTenderWorkbenchNavigationController()}
      sendIntent={sendIntent}
      createCommandId={() => 'session-2-command'}
      loadRuleContent={content}
      t={t}
    />)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(screen.queryByDisplayValue('已修改名称')).toBeNull()
  })

  it('single-flights confirmation through waiting/running and unlocks only on explicit failure or success', async () => {
    let sequence = 0
    const content = vi.fn<RuleContentLoader>(async (_session, artifact) => artifact.kind === 'rule-preview'
      ? previewArtifact('user')
      : { schemaVersion: 1, activeDatasetId: dataset.id, basedOnRevision: 1, draftFingerprint: fingerprint, origin: 'user', rules: [...draftRules] })
    const sendIntent = vi.fn(async (_intent: TenderWorkbenchIntentV1) => {})
    const loadRows = vi.fn<ClassifiedRowsLoader>(async (_session, artifact, filter) => ({
      schemaVersion: 1, artifactId: artifact.id, page: filter.page, pageSize: filter.pageSize, total: 0, rows: [],
    }))
    const initial = draftProjection('user')
    const view = render(<TenderWorkbenchView
      sessionId={'session-1' as never}
      projection={{ status: 'ready', projection: initial }}
      navigation={createTenderWorkbenchNavigationController()}
      sendIntent={sendIntent}
      createCommandId={() => `command-${++sequence}`}
      loadRuleContent={content}
      loadClassifiedRows={loadRows}
      t={t}
    />)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    const confirm = await screen.findByRole('button', { name: zh['workbench.rules.confirm'] })
    const confirmForm = confirm.closest('form')
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    if (confirmForm !== null) {
      fireEvent.submit(confirmForm)
      fireEvent.submit(confirmForm)
    }
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(sequence).toBe(1)
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({ commandId: 'command-1', kind: 'rules.confirm' })
    expect(sequence).toBe(1)
    await waitFor(() => {
      expectWriteProgress('rules.confirm', 'waiting-agent', zh['workbench.write.confirm.waiting'])
    })
    expect((screen.getByDisplayValue('数据方向') as HTMLInputElement).disabled).toBe(true)

    const running: TenderWorkflowProjectionV1 = {
      ...initial,
      currentStage: 'classification',
      activeOperation: {
        callId: 'call-confirm-1', commandId: 'command-1', command: 'tender_workbench_confirm_rules', stage: 'classification',
      },
      stages: { ...initial.stages, classification: { status: 'running' } },
    }
    view.rerender(<TenderWorkbenchView sessionId={'session-1' as never} projection={{ status: 'ready', projection: running }} navigation={createTenderWorkbenchNavigationController()} sendIntent={sendIntent} createCommandId={() => `command-${++sequence}`} loadRuleContent={content} loadClassifiedRows={loadRows} t={t} />)
    await waitFor(() => {
      expectWriteProgress('rules.confirm', 'running', zh['workbench.write.confirm.running'])
    })
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] }))
    expect(screen.getByRole('heading', { name: zh['workbench.data.completeTitle'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))

    const failed: TenderWorkflowProjectionV1 = {
      ...initial,
      currentStage: 'classification',
      stages: { ...initial.stages, classification: { status: 'failed', updatedAt: '2026-09-01T00:01:00.000Z', errorCode: 'tool-failed', errorMessage: '分类执行失败' } },
      lastFailure: { command: 'tender_workbench_confirm_rules', code: 'tool-failed', message: '分类执行失败' },
    }
    view.rerender(<TenderWorkbenchView sessionId={'session-1' as never} projection={{ status: 'ready', projection: failed }} navigation={createTenderWorkbenchNavigationController()} sendIntent={sendIntent} createCommandId={() => `command-${++sequence}`} loadRuleContent={content} loadClassifiedRows={loadRows} t={t} />)
    expect(await screen.findByText(zh['workbench.write.confirm.failed'])).toBeTruthy()
    const retryAsNewCommand = screen.getByRole('button', { name: zh['workbench.rules.confirm'] })
    expect(retryAsNewCommand.hasAttribute('disabled')).toBe(false)
    fireEvent.click(retryAsNewCommand)
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(2) })
    expect(sendIntent.mock.calls[1]?.[0]).toMatchObject({ commandId: 'command-2', kind: 'rules.confirm' })

    const runningAgain: TenderWorkflowProjectionV1 = {
      ...running,
      activeOperation: { ...running.activeOperation!, callId: 'call-confirm-2', commandId: 'command-2' },
    }
    view.rerender(<TenderWorkbenchView sessionId={'session-1' as never} projection={{ status: 'ready', projection: runningAgain }} navigation={createTenderWorkbenchNavigationController()} sendIntent={sendIntent} createCommandId={() => `command-${++sequence}`} loadRuleContent={content} loadClassifiedRows={loadRows} t={t} />)
    const classifiedRef = { id: 'classified-success', kind: 'classified-data' as const, fileName: 'classified.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'classified-token' }
    const succeeded: TenderWorkflowProjectionV1 = {
      ...draftProjection('user', draftRules, 3),
      currentStage: 'classification',
      stages: { ...initial.stages, rules: { status: 'succeeded', updatedAt: createdAt }, classification: { status: 'succeeded', updatedAt: '2026-09-01T00:02:00.000Z' } },
      classification: { data: classifiedRef, include: 1, observe: 0, manualReview: 0, exclude: 0, unmatched: 1, covered: 1, conflicts: 0, ruleSetVersion: 'rsv-success', activeDatasetId: dataset.id },
    }
    view.rerender(<TenderWorkbenchView sessionId={'session-1' as never} projection={{ status: 'ready', projection: succeeded }} navigation={createTenderWorkbenchNavigationController()} sendIntent={sendIntent} createCommandId={() => `command-${++sequence}`} loadRuleContent={content} loadClassifiedRows={loadRows} t={t} />)
    await waitFor(() => { expect(document.querySelector('[data-write-phase="running"]')).toBeNull() })
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.requery'] }))
    expect(screen.getByRole('button', { name: zh['workbench.query.submit'] }).hasAttribute('disabled')).toBe(false)
  })

  it('puts preview conclusions before bounded, collapsed samples and weakens zero values', async () => {
    const baseSample = previewArtifact('user').samples[0]!
    const emphasizedPreview: RulePreviewArtifactV1 = {
      ...previewArtifact('user'),
      counts: { include: 2, observe: 0, manualReview: 1, exclude: 0, unmatched: 2 },
      total: 5,
      covered: 3,
      conflicts: 1,
      rawMatches: 6,
      ruleImpacts: [{ ruleId: 'r-data', rawMatchCount: 6, exceptionCount: 1, conflictCount: 1, finalCount: 3 }],
      samples: [
        { ...baseSample, kind: 'match', recordId: 'sample-1', title: '命中样本' },
        { ...baseSample, kind: 'boundary', recordId: 'sample-2', title: '边界样本' },
        { ...baseSample, kind: 'conflict', recordId: 'sample-3', title: '冲突样本' },
        { ...baseSample, kind: 'exception', recordId: 'sample-4', title: '例外样本' },
        { ...baseSample, kind: 'match', recordId: 'sample-5', title: '补充样本一' },
        { ...baseSample, kind: 'boundary', recordId: 'sample-6', title: '补充样本二' },
      ],
    }
    const content = vi.fn<RuleContentLoader>(async (_session, artifact) => artifact.kind === 'rule-preview'
      ? emphasizedPreview
      : { schemaVersion: 1, activeDatasetId: dataset.id, basedOnRevision: 1, draftFingerprint: fingerprint, origin: 'user', rules: [...draftRules] })
    renderWorkbench({ projection: { status: 'ready', projection: draftProjection('user') }, loadContent: content })
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))

    expect(await screen.findByText(zh['workbench.rules.previewSummary'])).toBeTruthy()
    expect(screen.getAllByText(zh['workbench.classification.column.conflict']).some(node => node.closest('span')?.getAttribute('data-emphasis') === 'warning')).toBe(true)
    expect(screen.getAllByText(zh['workbench.classification.exception']).some(node => node.closest('span')?.getAttribute('data-emphasis') === 'warning')).toBe(true)
    expect(document.querySelector('[data-classification="observe"]')?.getAttribute('data-zero')).toBe('true')
    expect(document.querySelector('[data-classification="manual-review"]')?.getAttribute('data-zero')).toBe('false')
    expect(screen.getByText(zh['workbench.rules.previewDefinitionRaw'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.rules.previewDefinitionFinal'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.rules.previewDefinitionConflict'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.rules.previewDefinitionException'])).toBeTruthy()

    const featured = document.querySelector('[data-preview-samples="featured"]')
    const remaining = document.querySelector<HTMLDetailsElement>('[data-preview-samples="remaining"]')
    const byRule = document.querySelector<HTMLDetailsElement>('[data-preview-samples="rule"]')
    expect(featured?.querySelectorAll('[data-sample-kind]')).toHaveLength(4)
    expect(remaining?.querySelectorAll('[data-sample-kind]')).toHaveLength(2)
    expect(remaining?.open).toBe(false)
    expect(byRule?.open).toBe(false)
    expect(screen.getAllByText(zh['workbench.technicalDetails']).every(node => !(node.closest('details') as HTMLDetailsElement).open)).toBe(true)
    expect(document.querySelectorAll('[data-write-button]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: zh['workbench.rules.confirm'] })).toBeTruthy()
  })

  it('renders classification totals, filters real classified rows, and traces source through stable decision without S4 results', async () => {
    const project: NormalizedProjectV1 = {
      schemaVersion: 1, recordId: 'row-1', source: 'tender', sourceId: 't-1', title: '数据治理平台', lifecycle: 'active-procurement', dataDisposition: 'normalized',
      stage: { original: '招标', value: '招标', status: 'normalized' }, projectNumber: { original: 'T-1', value: 'T-1', status: 'normalized' },
      region: { original: '江苏', value: '江苏', parts: ['江苏'], status: 'normalized' }, counterparty: { original: '某银行', value: '某银行', status: 'normalized' },
      amount: { original: '', type: 'budget', parseStatus: 'missing', display: '未披露' }, publishedAt: { original: '2026-08-29', value: '2026-08-29', precision: 'date', timeZone: 'Asia/Shanghai', parseStatus: 'normalized' },
      announcements: [{ sourceRecordId: 't-1', title: '数据治理平台', lifecycle: 'active-procurement', stage: { original: '招标', value: '招标', status: 'normalized' }, projectNumber: { original: 'T-1', value: 'T-1', status: 'normalized' }, region: { original: '江苏', value: '江苏', parts: ['江苏'], status: 'normalized' }, amount: { original: '', type: 'budget', parseStatus: 'missing', display: '未披露' }, publishedAt: { original: '2026-08-29', value: '2026-08-29', precision: 'date', timeZone: 'Asia/Shanghai', parseStatus: 'normalized' }, parties: [{ id: 'e-1', name: '某银行' }], sourceLink: 'https://example.test/tender/t-1' }],
      disclosure: { missingFields: ['金额'], unparseableFields: [] },
    }
    const classifiedRow: ClassifiedRecordV1 = {
      schemaVersion: 1, project, classification: 'include',
      rawMatches: [{ ruleId: 'r-data', ruleIndex: 0, action: 'include', priority: 100, matchedKeywords: ['数据'], exceptionKeywords: [], eligible: true }],
      conflictRuleIds: [], finalRuleId: 'r-data', decision: { kind: 'single-action', winningPriority: 100 },
    }
    const classifiedRef = { id: 'classified', kind: 'classified-data' as const, fileName: 'classified.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'classified-token' }
    const confirmedRef = { id: 'rule-set', kind: 'rule-set' as const, fileName: 'rules.json', mediaType: 'application/json', createdAt, accessToken: 'rules-token' }
    const base = draftProjection('user', draftRules, 3)
    const projection: TenderWorkflowProjectionV1 = {
      ...base, currentStage: 'classification',
      stages: { ...base.stages, classification: { status: 'succeeded', updatedAt: createdAt } },
      rules: { ...base.rules!, confirmed: confirmedRef, ruleSetVersion: 'rsv-3-test' },
      classification: { data: classifiedRef, include: 1, observe: 0, manualReview: 0, exclude: 0, unmatched: 1, covered: 1, conflicts: 0, ruleSetVersion: 'rsv-3-test', activeDatasetId: dataset.id },
    }
    const loadRows = vi.fn<ClassifiedRowsLoader>(async (_session, artifact, filter) => ({ schemaVersion: 1, artifactId: artifact.id, page: filter.page, pageSize: filter.pageSize, total: 1, rows: [classifiedRow] }))
    const loadContent = vi.fn<RuleContentLoader>(async () => ({ schemaVersion: 1, ruleSetVersion: 'rsv-3-test', activeDatasetId: dataset.id, previewArtifactId: previewRef.id, confirmedAt: createdAt, commandId: 'confirm', draftFingerprint: fingerprint, rules: [...draftRules] }))
    renderWorkbench({ projection: { status: 'ready', projection }, loadClassifiedRows: loadRows, loadContent })
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(await screen.findByText('数据治理平台')).toBeTruthy()
    const classificationTab = screen.getByRole('tab', { name: zh['workbench.classification.title'] })
    classificationTab.focus()
    fireEvent.keyDown(classificationTab, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: zh['workbench.rules.title'] }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: zh['workbench.rules.title'] }), { key: 'ArrowRight' })
    expect(classificationTab.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(zh['workbench.classification.s4Unavailable'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.classification.boundary'])).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/建议重点复核|确认候选商机|用户已排除/u)
    const includeCard = await screen.findByRole('button', { name: /初选.*1/u })
    expect(includeCard.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(includeCard)
    expect(includeCard.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(includeCard)
    expect(includeCard.getAttribute('aria-pressed')).toBe('false')
    fireEvent.change(screen.getByLabelText(zh['workbench.classification.conflictFilter']), { target: { value: 'false' } })
    await waitFor(() => { expect(loadRows).toHaveBeenLastCalledWith('session-1', classifiedRef, expect.objectContaining({ conflict: false }), expect.any(AbortSignal)) })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.classification.trace'] }))
    expect(screen.getByText(zh['workbench.classification.tracePath'])).toBeTruthy()
    expect(screen.queryByText(/dataDisposition=/u)).toBeNull()
    expect(screen.getByText(zh['workbench.classification.traceSnapshot'])).toBeTruthy()
    expect(screen.getByText(t('workbench.classification.traceSnapshotValue', { snapshot: dataset.id, version: 'rsv-3-test' }))).toBeTruthy()
    expect(screen.getByRole('link', { name: /打开来源记录/u }).getAttribute('href')).toBe('https://example.test/tender/t-1')
    expect(screen.getByText(/同一动作内/u)).toBeTruthy()
  })
})
