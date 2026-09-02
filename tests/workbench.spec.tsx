// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_STAGES,
  createEmptyTenderWorkflowProjection,
} from '../src/contracts/workflow.ts'
import { en, zh, type TenderKey } from '../src/client/locales.ts'
import { TenderWorkbenchTab, TenderWorkbenchView } from '../src/client/workbench/TenderWorkbench.tsx'
import { createTenderWorkbenchRevealController } from '../src/client/better-sidebar-adapter.ts'
import type { TenderProjectionPort, TenderProjectionRead } from '../src/client/tender-projection-port.ts'
import { TenderDataDetails, type TenderRowsLoader } from '../src/client/workbench/TenderDataViews.tsx'
import {
  TENDER_WORKBENCH_PHASES,
  createTenderWorkbenchNavigationController,
  tenderWorkbenchPhaseProgress,
} from '../src/client/workbench/navigation-controller.ts'
import { tenderWorkbenchDisplayStatus } from '../src/client/workbench/workbench-status.ts'

const t = ((key: TenderKey, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}) as TranslateNS<'tenderFilter'>

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderWorkbench(
  projection: TenderProjectionRead = { status: 'empty' },
  sendIntent = vi.fn(async (_intent: unknown) => {}),
  loadRows?: TenderRowsLoader,
  createCommandId = () => 'command-1',
) {
  const navigation = createTenderWorkbenchNavigationController()
  const result = render(
    <TenderWorkbenchView
      sessionId={'session-1' as never}
      projection={projection}
      navigation={navigation}
      sendIntent={sendIntent}
      createCommandId={createCommandId}
      {...(loadRows === undefined ? {} : { loadRows })}
      t={t}
    />,
  )
  return { ...result, navigation, sendIntent }
}

function expectWriteProgress(action: string, phase: string, label: string): HTMLElement {
  const progress = document.querySelector<HTMLElement>(
    `[data-write-action="${action}"][data-write-phase="${phase}"]`,
  )
  expect(progress).toBeTruthy()
  expect(progress?.textContent).toContain(label)
  return progress!
}

describe('TenderWorkbench S1a shell', () => {
  it('defines the four business phases and all seven internal nodes in one configuration', () => {
    expect(TENDER_WORKBENCH_PHASES.map(phase => phase.id)).toEqual([
      'opportunity', 'screening', 'decision', 'delivery',
    ])
    expect(TENDER_WORKBENCH_PHASES.map(phase => phase.icon)).toEqual([
      'search', 'screening', 'decision', 'delivery',
    ])
    expect(TENDER_WORKBENCH_PHASES.map(phase => phase.implemented)).toEqual([
      true, true, false, false,
    ])
    const configuredNodes = TENDER_WORKBENCH_PHASES.flatMap(phase => [...phase.nodes])
    expect(configuredNodes).toEqual(WORKFLOW_STAGES)
    expect(new Set(configuredNodes).size).toBe(WORKFLOW_STAGES.length)
    expect(TENDER_WORKBENCH_PHASES.map(phase => zh[phase.labelKey])).toEqual([
      '找机会', '筛候选', '人工定案', '形成交付',
    ])
  })

  it('renders only four navigable business phases over the internal workflow graph', () => {
    const state = createEmptyTenderWorkflowProjection()
    renderWorkbench({ status: 'ready', projection: state })
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(4)
    expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual([
      zh['workbench.phase.opportunity'], zh['workbench.phase.screening'],
      zh['workbench.phase.decision'], zh['workbench.phase.delivery'],
    ])
    expect(screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] }).getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('tab', { name: zh['workbench.phase.decision'] }).getAttribute('data-phase-status')).toBe('unavailable')
    expect(screen.getByRole('tab', { name: zh['workbench.phase.delivery'] }).getAttribute('data-phase-status')).toBe('unavailable')

    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.delivery'] }))
    expect(screen.getByRole('heading', { name: zh['workbench.phase.delivery'] })).toBeTruthy()
    expect(screen.getByRole('heading', { name: zh['workbench.phase.unavailableTitle'] })).toBeTruthy()
    expect(state.currentStage).toBe('query')
    expect(state.stages.report.status).toBe('not-started')
    expect(tabs.every(tab => !tab.hasAttribute('disabled'))).toBe(true)
  })

  it('renders the S1a visual shell hierarchy without fabricating later-stage content', () => {
    const { container } = renderWorkbench()
    expect(container.querySelector('[data-visual-shell="s3"]')).toBeTruthy()
    expect(screen.getByText(zh['workbench.subtitle'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.query.eyebrow'])).toBeTruthy()
    expect(screen.getByRole('form', { name: zh['workbench.query.formTitle'] })).toBeTruthy()
    expect(screen.getByText(zh['workbench.query.editHint'])).toBeTruthy()
    expect(screen.getByText('query.start')).toBeTruthy()
    expect(screen.getByText(zh['workbench.query.planTitle'])).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(screen.getByRole('heading', { name: zh['workbench.phase.emptyTitle'] })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/示例数据|假数据/u)).toBeNull()
  })

  it('uses tab semantics and keyboard navigation without step or ordinal gating', () => {
    renderWorkbench()
    const opportunity = screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] })
    expect(opportunity.getAttribute('aria-current')).toBe('step')
    opportunity.focus()
    fireEvent.keyDown(opportunity, { key: 'ArrowRight' })
    const screening = screen.getByRole('tab', { name: zh['workbench.phase.screening'] })
    expect(screening.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screening)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screening.id)

    fireEvent.keyDown(screening, { key: 'End' })
    const delivery = screen.getByRole('tab', { name: zh['workbench.phase.delivery'] })
    expect(delivery.getAttribute('aria-selected')).toBe('true')
    expect(delivery.hasAttribute('aria-current')).toBe(false)
  })

  it('single-flights rapid query click and form-submit races before React rerenders', async () => {
    let releaseSend: (() => void) | undefined
    let commandCount = 0
    const sendIntent = vi.fn((_intent: unknown) => new Promise<void>((resolve) => { releaseSend = resolve }))
    const { container } = renderWorkbench(
      { status: 'empty' },
      sendIntent,
      undefined,
      () => `command-${++commandCount}`,
    )
    expect(sendIntent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] }))
    expect(sendIntent).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(zh['workbench.query.target']), {
      target: { value: '查找云平台项目' },
    })
    fireEvent.change(screen.getByLabelText(zh['field.keywords']), {
      target: { value: '云平台 数据治理' },
    })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.query.scope.combined'] }))
    const submit = screen.getByRole('button', { name: zh['workbench.query.submit'] })
    const form = screen.getByRole('form', { name: zh['workbench.query.formTitle'] })
    fireEvent.click(submit)
    fireEvent.click(submit)
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(commandCount).toBe(1)
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 1,
      commandId: 'command-1',
      kind: 'query.start',
      scope: 'combined',
      tender: { keywords: ['云平台', '数据治理'] },
      proposed: { keywords: ['云平台', '数据治理'] },
    })
    const currentButton = container.querySelector('[data-write-button="query"]')
    expect(currentButton?.hasAttribute('disabled')).toBe(true)
    expect(currentButton?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('[data-write-action="query"][data-write-phase="sending"]')).toBeTruthy()
    expect(container.querySelector('[data-write-button="query"] span[aria-hidden="true"]')).toBeTruthy()
    expect((screen.getByLabelText(zh['workbench.query.target']) as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] }))
    releaseSend?.()
    await waitFor(() => {
      expectWriteProgress('query', 'waiting-agent', zh['workbench.write.query.waiting'])
    })
    fireEvent.submit(screen.getByRole('form', { name: zh['workbench.query.formTitle'] }))
    expect(sendIntent).toHaveBeenCalledTimes(1)
  })

  it('retries a transport failure with the original command id', async () => {
    let commandCount = 0
    let attempt = 0
    const sendIntent = vi.fn(async (_intent: unknown) => {
      attempt += 1
      if (attempt === 1) throw new Error('transport unavailable')
    })
    renderWorkbench({ status: 'empty' }, sendIntent, undefined, () => `command-${++commandCount}`)
    fireEvent.change(screen.getByLabelText(zh['workbench.query.target']), { target: { value: '查找数据项目' } })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.query.submit'] }))
    expect(await screen.findByText(zh['workbench.write.query.failed'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.write.transportFailed'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.write.retry'] }))
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(2) })
    expect(commandCount).toBe(1)
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({ commandId: 'command-1' })
    expect(sendIntent.mock.calls[1]?.[0]).toMatchObject({ commandId: 'command-1' })
    await waitFor(() => {
      expectWriteProgress('query', 'waiting-agent', zh['workbench.write.query.waiting'])
    })
  })

  it('isolates transient locks by Session and disposes them on unmount', async () => {
    const releases: Array<() => void> = []
    let commandCount = 0
    const sendIntent = vi.fn((_intent: unknown) => new Promise<void>((resolve) => { releases.push(resolve) }))
    const navigation = createTenderWorkbenchNavigationController()
    const props = {
      projection: { status: 'empty' } as TenderProjectionRead,
      navigation,
      sendIntent,
      createCommandId: () => `command-${++commandCount}`,
      t,
    }
    const view = render(<TenderWorkbenchView {...props} sessionId={'session-1' as never} />)
    fireEvent.change(screen.getByLabelText(zh['workbench.query.target']), { target: { value: '查找数据项目' } })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.query.submit'] }))
    expect(sendIntent).toHaveBeenCalledTimes(1)

    view.rerender(<TenderWorkbenchView {...props} sessionId={'session-2' as never} />)
    const secondSessionButton = screen.getByRole('button', { name: zh['workbench.query.submit'] })
    expect(secondSessionButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(secondSessionButton)
    expect(sendIntent).toHaveBeenCalledTimes(2)
    expect(sendIntent.mock.calls.map(call => (call[0] as { commandId: string }).commandId)).toEqual(['command-1', 'command-2'])
    releases[0]?.()
    await waitFor(() => {
      expect((document.querySelector('[data-write-button="query"]') as HTMLButtonElement).disabled).toBe(true)
    })

    view.unmount()
    render(<TenderWorkbenchView {...props} sessionId={'session-2' as never} />)
    expect(screen.getByRole('button', { name: zh['workbench.query.submit'] }).hasAttribute('disabled')).toBe(false)
  })

  it('associates query validation feedback with the field that needs recovery', () => {
    const { sendIntent } = renderWorkbench()
    const target = screen.getByLabelText(zh['workbench.query.target'])
    const keywords = screen.getByLabelText(zh['field.keywords'])
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.query.submit'] }))
    expect(target.getAttribute('aria-invalid')).toBe('true')
    expect(target.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)

    fireEvent.change(target, { target: { value: '查找数据项目' } })
    fireEvent.change(keywords, { target: { value: '一 二 三 四 五 六 七 八 九 十 十一' } })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.query.submit'] }))
    expect(keywords.getAttribute('aria-invalid')).toBe('true')
    expect(keywords.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
    expect(sendIntent).not.toHaveBeenCalled()
  })

  it('shows capability missing and blocks submit when the Host Projection is absent', () => {
    renderWorkbench({ status: 'unavailable' })
    expect(screen.getByRole('alert').textContent).toContain(zh['workbench.capability.missing'])
    expect(screen.getByRole('button', { name: zh['workbench.query.submit'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(zh['workbench.query.disabled.capability'])).toBeTruthy()
  })

  it('renders running and failed Projection states without inventing result data', () => {
    const base = createEmptyTenderWorkflowProjection()
    const running = {
      ...base,
      activeOperation: {
        callId: 'call-1', commandId: 'command-1', command: 'tender_workbench_query' as const, stage: 'query' as const,
      },
      stages: { ...base.stages, query: { status: 'running' as const } },
    }
    const { rerender, navigation, sendIntent } = renderWorkbench({ status: 'ready', projection: running })
    expectWriteProgress('query', 'running', zh['workbench.write.query.running'])
    expect(tenderWorkbenchDisplayStatus({ status: 'ready', projection: running })).toBe('running')

    const failed = {
      ...base,
      stages: {
        ...base.stages,
        query: { status: 'failed' as const, errorCode: 'tool-failed', errorMessage: '连接器不可用' },
      },
    }
    rerender(
      <TenderWorkbenchView
        sessionId={'session-1' as never}
        projection={{ status: 'ready', projection: failed }}
        navigation={navigation}
        sendIntent={sendIntent}
        createCommandId={() => 'command-1'}
        t={t}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('连接器不可用')
    expect(document.querySelector('[data-workbench-feedback="error"]')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('restores a Projection waiting-for-Agent state without requiring local submit state', () => {
    const base = createEmptyTenderWorkflowProjection()
    const waiting = {
      ...base,
      stages: { ...base.stages, query: { status: 'waiting-agent' as const } },
    }
    renderWorkbench({ status: 'ready', projection: waiting })
    expectWriteProgress('query', 'waiting-agent', zh['workbench.write.query.waiting'])
    expect(tenderWorkbenchDisplayStatus({ status: 'ready', projection: waiting })).toBe('waiting-agent')
  })

  it('keeps navigation requests isolated by Session', () => {
    const navigation = createTenderWorkbenchNavigationController()
    const first = vi.fn()
    const second = vi.fn()
    navigation.attach('one', first)
    navigation.attach('two', second)
    navigation.request('two', 'delivery')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('delivery')
  })

  it('allows a non-prefix internal node to succeed without unlocking by ordinal position', () => {
    const base = createEmptyTenderWorkflowProjection()
    const nonPrefix = {
      ...base,
      currentStage: 'analysis' as const,
      stages: { ...base.stages, analysis: { status: 'succeeded' as const } },
    }
    expect(tenderWorkbenchPhaseProgress(nonPrefix, 'opportunity')).toBe('not-started')
    expect(tenderWorkbenchPhaseProgress(nonPrefix, 'screening')).toBe('progress')
    renderWorkbench({ status: 'ready', projection: nonPrefix })
    expect(screen.getAllByRole('tab').every(tab => !tab.hasAttribute('disabled'))).toBe(true)
    expect(nonPrefix.stages.query.status).toBe('not-started')
    expect(nonPrefix.stages.rules.status).toBe('not-started')
  })

  it('treats query and overview completion as a normal lightweight outcome', () => {
    const base = createEmptyTenderWorkflowProjection()
    const queryComplete = {
      ...base,
      revision: 1,
      currentStage: 'overview' as const,
      stages: {
        ...base.stages,
        query: { status: 'succeeded' as const },
        overview: { status: 'succeeded' as const },
      },
    }
    renderWorkbench({ status: 'ready', projection: queryComplete })
    expect(screen.getByText(zh['workbench.query.complete'])).toBeTruthy()
    expect(document.querySelector('[data-workbench-feedback="success"]')).toBeTruthy()
    expect(zh['workbench.query.complete']).toContain('查询完成，可继续分析')
    expect(en['workbench.query.complete']).toContain('Query complete; you can continue analysis')
    expect(document.body.textContent).not.toContain('2/7')
    expect(document.body.textContent).not.toContain('工作流未完成')
    expect(screen.getByRole('tab', { name: zh['workbench.phase.delivery'] })
      .hasAttribute('disabled')).toBe(false)
  })

  it('keeps a completed lightweight query ready when an optional later node fails', () => {
    const base = createEmptyTenderWorkflowProjection()
    const laterFailure = {
      ...base,
      revision: 4,
      currentStage: 'analysis' as const,
      stages: {
        ...base.stages,
        query: { status: 'succeeded' as const },
        overview: { status: 'succeeded' as const },
        analysis: { status: 'failed' as const, errorCode: 'partial', errorMessage: '单批分析失败' },
      },
    }
    renderWorkbench({ status: 'ready', projection: laterFailure })
    expect(tenderWorkbenchDisplayStatus({ status: 'ready', projection: laterFailure })).toBe('ready')
    expect(screen.getByText(zh['workbench.query.complete'])).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh['workbench.phase.screening'] })
      .getAttribute('data-phase-status')).toBe('failed')
  })

  it('does not expose decision, probability, or preselected-mode wording in the S1a shell', () => {
    renderWorkbench()
    expect(document.body.textContent).not.toMatch(/最终商机|投标决定|中标概率|轻量模式|完整模式/u)
  })

  it('renders real S2 data overview, partial source status, paged rows, and basic filters', async () => {
    const base = createEmptyTenderWorkflowProjection()
    const createdAt = '2026-09-01T00:00:00.000Z'
    const querySpec = { id: 'query-spec', kind: 'query-spec' as const, fileName: 'query.json', mediaType: 'application/json', createdAt, accessToken: 'query-token' }
    const normalizedData = { id: 'normalized-data', kind: 'normalized-data' as const, fileName: 'dataset.json', mediaType: 'application/json', rowCount: 2, createdAt, accessToken: 'dataset-token' }
    const projection = {
      ...base,
      revision: 1,
      currentStage: 'overview' as const,
      stages: {
        ...base.stages,
        query: { status: 'succeeded' as const, updatedAt: createdAt },
        overview: { status: 'succeeded' as const, updatedAt: createdAt },
      },
      query: {
        scope: 'combined' as const,
        targetSummary: '查找数据项目',
        querySpec,
        sources: {
          tender: { status: 'succeeded' as const, loaded: 2 },
          proposed: { status: 'failed' as const, loaded: 0, errorMessage: '拟建来源不可用' },
        },
        normalizedData,
        sourceRecordCount: 2,
        total: 2,
        duplicateCount: 0,
        invalidCount: 0,
        missingFieldCount: 1,
        unparseableFieldCount: 0,
      },
    }
    const row = {
      schemaVersion: 1 as const,
      recordId: 'row-1', source: 'tender' as const, sourceId: 't-1', title: '数据治理平台项目', lifecycle: 'active-procurement' as const, dataDisposition: 'normalized' as const,
      stage: { original: '招标', value: '招标', status: 'normalized' as const },
      projectNumber: { original: 'T-1', value: 'T-1', status: 'normalized' as const },
      region: { original: '江苏省', value: '江苏省', parts: ['江苏省'], status: 'normalized' as const },
      counterparty: { original: '某银行', value: '某银行', status: 'normalized' as const },
      amount: { original: '1000000', type: 'budget' as const, minCny: 1_000_000, maxCny: 1_000_000, parseStatus: 'exact' as const, display: '1000000' },
      publishedAt: { original: '2026-08-29', value: '2026-08-29', precision: 'date' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'normalized' as const },
      deadline: { original: '', precision: 'unknown' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'missing' as const },
      announcements: [{
        sourceRecordId: 't-1', title: '数据治理平台项目', lifecycle: 'active-procurement' as const,
        stage: { original: '招标', value: '招标', status: 'normalized' as const },
        projectNumber: { original: 'T-1', value: 'T-1', status: 'normalized' as const },
        region: { original: '江苏省', value: '江苏省', parts: ['江苏省'], status: 'normalized' as const },
        amount: { original: '1000000', type: 'budget' as const, minCny: 1_000_000, maxCny: 1_000_000, parseStatus: 'exact' as const, display: '1000000' },
        publishedAt: { original: '2026-08-29', value: '2026-08-29', precision: 'date' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'normalized' as const },
        deadline: { original: '', precision: 'unknown' as const, timeZone: 'Asia/Shanghai' as const, parseStatus: 'missing' as const },
        parties: [{ id: 'e-1', name: '某银行' }],
        sourceLink: 'https://example.test/tender/t-1',
      }],
      disclosure: { missingFields: ['投标截止时间'], unparseableFields: [] },
    }
    const loadRows = vi.fn<TenderRowsLoader>(async (_sessionId, artifact, filter) => ({
      schemaVersion: 1,
      artifactId: artifact.id,
      page: filter.page,
      pageSize: filter.pageSize,
      total: 51,
      rows: [row],
    }))
    renderWorkbench({ status: 'ready', projection }, undefined, loadRows)
    expect(screen.getByRole('heading', { name: zh['workbench.data.completeTitle'] })).toBeTruthy()
    expect(screen.getByText(zh['workbench.data.partialTitle'])).toBeTruthy()
    expect(screen.getByText('拟建来源不可用')).toBeTruthy()
    expect(screen.getByText('招投标 2 · 拟建 0')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.openDetails'] }))
    expect(await screen.findByRole('heading', { name: zh['workbench.data.details'] })).toBeTruthy()
    expect(await screen.findByText('数据治理平台项目')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.openRowDetail'] }))
    expect(screen.getByRole('link', { name: /打开来源记录/u }).getAttribute('href')).toBe('https://example.test/tender/t-1')
    expect(screen.getByText(zh['workbench.data.detail.sourceRegion'])).toBeTruthy()
    expect(loadRows).toHaveBeenCalledWith('session-1', normalizedData, expect.objectContaining({ page: 1, pageSize: 50 }), expect.any(AbortSignal))
    fireEvent.change(screen.getByLabelText(zh['workbench.data.filterSource']), { target: { value: 'tender' } })
    await waitFor(() => { expect(loadRows).toHaveBeenLastCalledWith('session-1', normalizedData, expect.objectContaining({ source: 'tender' }), expect.any(AbortSignal)) })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.next'] }))
    await waitFor(() => { expect(loadRows).toHaveBeenLastCalledWith('session-1', normalizedData, expect.objectContaining({ page: 2 }), expect.any(AbortSignal)) })
  })

  it('shows replacement semantics only when active data or downstream results exist', () => {
    const base = createEmptyTenderWorkflowProjection()
    const createdAt = '2026-09-01T00:00:00.000Z'
    const withData = {
      ...base,
      revision: 1,
      query: {
        scope: 'tender' as const,
        targetSummary: '旧查询',
        querySpec: { id: 'query', kind: 'query-spec' as const, fileName: 'query.json', mediaType: 'application/json', createdAt, accessToken: 'q' },
        sources: { tender: { status: 'succeeded' as const, loaded: 1 } },
        normalizedData: { id: 'data', kind: 'normalized-data' as const, fileName: 'data.json', mediaType: 'application/json', rowCount: 1, createdAt, accessToken: 'd' },
        total: 1, duplicateCount: 0, invalidCount: 0,
      },
    }
    renderWorkbench({ status: 'ready', projection: withData })
    expect(screen.queryByText(zh['workbench.query.replacementWarning'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.requery'] }))
    expect(screen.getByText(zh['workbench.query.replacementWarning'])).toBeTruthy()
    expect(zh['workbench.query.replacementWarning']).toBe('新查询成功后替换当前活动数据，不追加或合并旧结果；旧下游结果退出活动链路，历史产物仍保留追溯。')

    cleanup()
    renderWorkbench({ status: 'empty' })
    expect(screen.queryByText(zh['workbench.query.replacementWarning'])).toBeNull()
  })

  it('keeps data-detail failures local and offers an explicit retry into an empty result', async () => {
    let attempt = 0
    const createdAt = '2026-09-01T00:00:00.000Z'
    const artifact = { id: 'data', kind: 'normalized-data' as const, fileName: 'data.json', mediaType: 'application/json', rowCount: 0, createdAt, accessToken: 'token' }
    const loadRows = vi.fn<TenderRowsLoader>(async (_sessionId, ref, filter) => {
      attempt += 1
      if (attempt === 1) throw new Error('temporary')
      return { schemaVersion: 1, artifactId: ref.id, page: filter.page, pageSize: filter.pageSize, total: 0, rows: [] }
    })
    render(<TenderDataDetails sessionId={'session-1' as never} artifact={artifact} loadRows={loadRows} onBack={() => {}} t={t} />)
    expect(await screen.findByText(zh['workbench.data.loadFailedTitle'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.retry'] }))
    expect(await screen.findByText(zh['workbench.data.emptyTitle'])).toBeTruthy()
    expect(loadRows).toHaveBeenCalledTimes(2)
  })

  it('remounts all transient view state when the Better Sidebar Session scope changes', async () => {
    const createdAt = '2026-09-01T00:00:00.000Z'
    const snapshotFor = (sessionId: string): TenderProjectionRead => {
      const base = createEmptyTenderWorkflowProjection()
      return {
        status: 'ready',
        projection: {
          ...base,
          revision: 1,
          currentStage: 'overview',
          stages: { ...base.stages, query: { status: 'succeeded' }, overview: { status: 'succeeded' } },
          query: {
            scope: 'tender', targetSummary: sessionId,
            querySpec: { id: `query-${sessionId}`, kind: 'query-spec', fileName: 'query.json', mediaType: 'application/json', createdAt, accessToken: 'query-token' },
            sources: { tender: { status: 'succeeded', loaded: 1 } },
            normalizedData: { id: `data-${sessionId}`, kind: 'normalized-data', fileName: 'data.json', mediaType: 'application/json', rowCount: 1, createdAt, accessToken: 'data-token' },
            total: 1, duplicateCount: 0, invalidCount: 0,
          },
        },
      }
    }
    const projectionPort: TenderProjectionPort = {
      source(sessionId) {
        const snapshot = snapshotFor(String(sessionId))
        return { getSnapshot: () => snapshot, subscribe: () => () => {} }
      },
    }
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const navigation = createTenderWorkbenchNavigationController()
    const reveal = createTenderWorkbenchRevealController()
    const store = {} as unknown as TabComponentProps['store']
    const tab = { id: 'tender', type: 'dsh-tender-workbench:agent', title: '招投标' }
    const props = {
      ctx: {} as TabComponentProps['ctx'], store, tab, visible: true,
      projectionPort, reveal, navigation,
      sendIntent: vi.fn(async () => {}), t,
    }
    const view = render(<TenderWorkbenchTab {...props} scope={{ sessionId: 'session-one' }} />)
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.data.openDetails'] }))
    expect(screen.getByRole('heading', { name: zh['workbench.data.details'] })).toBeTruthy()

    view.rerender(<TenderWorkbenchTab {...props} scope={{ sessionId: 'session-two' }} />)
    expect(await screen.findByRole('heading', { name: zh['workbench.data.completeTitle'] })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: zh['workbench.data.details'] })).toBeNull()
  })
})
