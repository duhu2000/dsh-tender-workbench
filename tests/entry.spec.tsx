// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import {
  TenderDockEntry,
  TenderDockEntryView,
  TenderSidebarEntry,
  TenderSessionHeaderEntry,
  type TenderDockEntryProps,
  type TenderHeaderEntryProps,
  type TenderSidebarEntryProps,
} from '../src/client/TenderEntry.tsx'
import { zh, type TenderKey } from '../src/client/locales.ts'
import type { WorkbenchPhase } from '../src/client/workbench/navigation-controller.ts'

const t = ((key: TenderKey) => zh[key]) as TranslateNS<'tenderFilter'>

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('S1a tender entries', () => {
  it('maps the composer launcher group to the four existing workbench phases', () => {
    const openWorkbench = vi.fn((_phase: WorkbenchPhase) => true)
    render(<TenderDockEntryView openWorkbench={openWorkbench} projection={null} t={t} />)

    expect(screen.getByRole('group', { name: zh['workbench.phases'] })).toBeTruthy()
    expect(screen.getByText(zh['sidebar.label'])).toBeTruthy()
    for (const label of [
      zh['workbench.phase.opportunity'],
      zh['workbench.phase.screening'],
      zh['workbench.phase.decision'],
      zh['workbench.phase.delivery'],
    ]) fireEvent.click(screen.getByRole('button', { name: label }))

    expect(openWorkbench.mock.calls.map(([phase]) => phase)).toEqual([
      'opportunity', 'screening', 'decision', 'delivery',
    ])
  })

  it('portals the sidebar launcher after Data Cleaning and removes its mount on unload', () => {
    const sidebar = document.createElement('div')
    const dataCleaning = document.createElement('div')
    dataCleaning.dataset.dataCleaningTopMount = 'true'
    const mcp = document.createElement('div')
    mcp.dataset.testid = 'mcp-entry'
    const workspaces = document.createElement('div')
    workspaces.dataset.slot = 'sidebar.workspaces'
    sidebar.append(dataCleaning, mcp, workspaces)
    document.body.append(sidebar)

    const openCurrentWorkbench = vi.fn(() => true)
    const props = {
      openCurrentWorkbench,
      t,
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as Omit<TenderSidebarEntryProps, 'wide'>
    const view = render(<TenderSidebarEntry {...props} wide />)
    const mount = sidebar.querySelector<HTMLElement>('[data-dsh-tender-top-mount="true"]')

    expect(mount).toBeTruthy()
    expect(dataCleaning.nextElementSibling).toBe(mount)
    expect(mount?.nextElementSibling).toBe(mcp)
    expect(screen.getByText(zh['sidebar.label'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['sidebar.aria'] }))
    expect(openCurrentWorkbench).toHaveBeenCalledTimes(1)

    view.rerender(<TenderSidebarEntry {...props} wide={false} />)
    expect(screen.queryByText(zh['sidebar.label'])).toBeNull()
    expect(screen.getByRole('button', { name: zh['sidebar.aria'] })).toBeTruthy()

    view.unmount()
    expect(sidebar.querySelector('[data-dsh-tender-top-mount="true"]')).toBeNull()
  })

  it('repositions the sidebar launcher when Data Cleaning mounts later', async () => {
    const sidebar = document.createElement('div')
    const mcp = document.createElement('div')
    const workspaces = document.createElement('div')
    workspaces.dataset.slot = 'sidebar.workspaces'
    sidebar.append(mcp, workspaces)
    document.body.append(sidebar)

    const props = {
      openCurrentWorkbench: vi.fn(() => true),
      t,
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as Omit<TenderSidebarEntryProps, 'wide'>
    render(<TenderSidebarEntry {...props} wide />)
    const mount = sidebar.querySelector<HTMLElement>('[data-dsh-tender-top-mount="true"]')
    expect(mount?.nextElementSibling).toBe(workspaces)

    const dataCleaning = document.createElement('div')
    dataCleaning.dataset.dataCleaningTopMount = 'true'
    sidebar.insertBefore(dataCleaning, mcp)

    await waitFor(() => {
      expect(dataCleaning.nextElementSibling).toBe(mount)
      expect(sidebar.querySelectorAll('[data-dsh-tender-top-mount="true"]')).toHaveLength(1)
    })
  })

  it('appends the composer launcher after an existing Previsit mode host and disposes it', () => {
    const composerStack = document.createElement('div')
    composerStack.className = 'host-composerStack_hash'
    const inputDock = document.createElement('div')
    const previsitHost = document.createElement('div')
    previsitHost.className = 'qccModesHost'
    composerStack.append(inputDock, previsitHost)
    document.body.append(composerStack)

    const props = {
      sessionId: 'session-1',
      openWorkbench: vi.fn(() => true),
      t,
      useProjection: vi.fn(() => null),
    } as unknown as TenderDockEntryProps
    const view = render(<TenderDockEntry {...props} />, { container: inputDock })
    const dockHost = composerStack.querySelector<HTMLElement>('[data-dsh-tender-dock-host="true"]')

    expect(dockHost).toBeTruthy()
    expect(previsitHost.nextElementSibling).toBe(dockHost)
    expect(screen.getByRole('group', { name: zh['workbench.phases'] })).toBeTruthy()

    view.unmount()
    expect(composerStack.querySelector('[data-dsh-tender-dock-host="true"]')).toBeNull()
  })

  it('keeps the Header reopen status usable when only an optional later node failed', () => {
    const base = createEmptyTenderWorkflowProjection()
    const projection = {
      ...base,
      currentStage: 'analysis' as const,
      stages: {
        ...base.stages,
        query: { status: 'succeeded' as const },
        overview: { status: 'succeeded' as const },
        analysis: { status: 'failed' as const, errorCode: 'partial', errorMessage: '分析失败' },
      },
    }
    const props = {
      openWorkbench: vi.fn(() => true),
      t,
      useProjection: vi.fn(() => projection),
    } as unknown as TenderHeaderEntryProps
    render(<TenderSessionHeaderEntry {...props} />)
    const reopen = screen.getByRole('button', { name: zh['header.reopen'] })
    expect(reopen.getAttribute('data-workbench-status')).toBe('ready')
    expect(reopen.getAttribute('title')).toBe(zh['workbench.status.ready'])
  })
})
