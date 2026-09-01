// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_STAGES,
  createEmptyTenderWorkflowProjection,
} from '../src/contracts/workflow.ts'
import { en, zh, type TenderKey } from '../src/client/locales.ts'
import { TenderWorkbenchView } from '../src/client/workbench/TenderWorkbench.tsx'
import {
  TENDER_WORKBENCH_PHASES,
  createTenderWorkbenchNavigationController,
  tenderWorkbenchPhaseProgress,
} from '../src/client/workbench/navigation-controller.ts'
import { tenderWorkbenchDisplayStatus } from '../src/client/workbench/workbench-status.ts'
import type { TenderProjectionRead } from '../src/client/tender-projection-port.ts'

const t = ((key: TenderKey, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}) as TranslateNS<'tenderFilter'>

afterEach(() => { cleanup() })

function renderWorkbench(
  projection: TenderProjectionRead = { status: 'empty' },
  sendIntent = vi.fn(async (_intent: unknown) => {}),
) {
  const navigation = createTenderWorkbenchNavigationController()
  const result = render(
    <TenderWorkbenchView
      sessionId={'session-1' as never}
      projection={projection}
      navigation={navigation}
      sendIntent={sendIntent}
      createCommandId={() => 'command-1'}
      t={t}
    />,
  )
  return { ...result, navigation, sendIntent }
}

describe('TenderWorkbench S1a shell', () => {
  it('defines the four business phases and all seven internal nodes in one configuration', () => {
    expect(TENDER_WORKBENCH_PHASES.map(phase => phase.id)).toEqual([
      'opportunity', 'screening', 'decision', 'delivery',
    ])
    expect(TENDER_WORKBENCH_PHASES.map(phase => phase.icon)).toEqual([
      'search', 'screening', 'decision', 'delivery',
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

    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.delivery'] }))
    expect(screen.getByRole('heading', { name: zh['workbench.phase.delivery'] })).toBeTruthy()
    expect(state.currentStage).toBe('query')
    expect(state.stages.report.status).toBe('not-started')
    expect(tabs.every(tab => !tab.hasAttribute('disabled'))).toBe(true)
  })

  it('renders the S1a visual shell hierarchy without fabricating later-stage content', () => {
    const { container } = renderWorkbench()
    expect(container.querySelector('[data-visual-shell="s1a"]')).toBeTruthy()
    expect(screen.getByText(zh['workbench.subtitle'])).toBeTruthy()
    expect(screen.getByText(zh['workbench.query.eyebrow'])).toBeTruthy()
    expect(screen.getByRole('form', { name: zh['workbench.query.formTitle'] })).toBeTruthy()
    expect(screen.getByText(zh['workbench.query.editHint'])).toBeTruthy()
    expect(screen.getByText('query.start')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: zh['workbench.phase.screening'] }))
    expect(screen.getByRole('heading', { name: zh['workbench.phase.emptyTitle'] })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/示例数据|假数据/u)).toBeNull()
  })

  it('uses tab semantics and keyboard navigation without step or ordinal gating', () => {
    renderWorkbench()
    const opportunity = screen.getByRole('tab', { name: zh['workbench.phase.opportunity'] })
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

  it('sends one typed Intent only after explicit submit and shows waiting for Agent', async () => {
    const sendIntent = vi.fn(async (_intent: unknown) => {})
    renderWorkbench({ status: 'empty' }, sendIntent)
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
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.query.submit'] }))
    await waitFor(() => { expect(sendIntent).toHaveBeenCalledTimes(1) })
    expect(sendIntent.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 1,
      commandId: 'command-1',
      kind: 'query.start',
      scope: 'combined',
      tender: { keywords: ['云平台', '数据治理'] },
      proposed: { keywords: ['云平台', '数据治理'] },
    })
    expect(await screen.findByText(zh['workbench.waitingAgent'])).toBeTruthy()
    expect(document.querySelector('[data-workbench-feedback="notice"]')).toBeTruthy()
  })

  it('shows capability missing and blocks submit when the Host Projection is absent', () => {
    renderWorkbench({ status: 'unavailable' })
    expect(screen.getByRole('alert').textContent).toContain(zh['workbench.capability.missing'])
    expect(screen.getByRole('button', { name: zh['workbench.query.submit'] }).hasAttribute('disabled')).toBe(true)
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
    expect(screen.getByText(zh['workbench.running'])).toBeTruthy()
    expect(document.querySelector('[data-workbench-feedback="progress"]')).toBeTruthy()
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
    expect(screen.getByText(zh['workbench.waitingAgent'])).toBeTruthy()
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
})
