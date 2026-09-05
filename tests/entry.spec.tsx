// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import {
  TenderHeroBrandMark,
  TenderHeroTitleBridge,
  TenderSidebarEntry,
  TenderSessionHeaderEntry,
  type TenderHeroBrandMarkProps,
  type TenderHeroTitleBridgeProps,
  type TenderHeaderEntryProps,
  type TenderSidebarEntryProps,
} from '../src/client/TenderEntry.tsx'
import { zh, type TenderKey } from '../src/client/locales.ts'
import { TENDER_ENTRY_SESSION_ID_PREFIX } from '../src/client/tender-session-entry.ts'

const t = ((key: TenderKey) => zh[key]) as TranslateNS<'tenderFilter'>

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('S1a tender entries', () => {
  it('prepends the sidebar launcher without depending on third-party entries and removes it on unload', () => {
    const sidebar = document.createElement('div')
    const dataCleaning = document.createElement('div')
    dataCleaning.dataset.dataCleaningTopMount = 'true'
    const mcp = document.createElement('div')
    mcp.dataset.testid = 'mcp-entry'
    const workspaces = document.createElement('div')
    workspaces.dataset.slot = 'sidebar.workspaces'
    sidebar.append(dataCleaning, mcp, workspaces)
    document.body.append(sidebar)

    const startTenderSession = vi.fn(async () => {})
    const props = {
      startTenderSession,
      t,
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as Omit<TenderSidebarEntryProps, 'wide'>
    const view = render(<TenderSidebarEntry {...props} wide />)
    const mount = sidebar.querySelector<HTMLElement>('[data-dsh-tender-top-mount="true"]')

    expect(mount).toBeTruthy()
    expect(sidebar.firstElementChild).toBe(mount)
    expect(mount?.nextElementSibling).toBe(dataCleaning)
    expect(screen.getByText(zh['sidebar.label'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['sidebar.aria'] }))
    expect(startTenderSession).toHaveBeenCalledTimes(1)

    view.rerender(<TenderSidebarEntry {...props} wide={false} />)
    expect(screen.queryByText(zh['sidebar.label'])).toBeNull()
    expect(screen.getByRole('button', { name: zh['sidebar.aria'] })).toBeTruthy()

    view.unmount()
    expect(sidebar.querySelector('[data-dsh-tender-top-mount="true"]')).toBeNull()
  })

  it('does not reorder the sidebar launcher when Data Cleaning mounts later', async () => {
    const sidebar = document.createElement('div')
    const mcp = document.createElement('div')
    const workspaces = document.createElement('div')
    workspaces.dataset.slot = 'sidebar.workspaces'
    sidebar.append(mcp, workspaces)
    document.body.append(sidebar)

    const props = {
      startTenderSession: vi.fn(async () => {}),
      t,
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as Omit<TenderSidebarEntryProps, 'wide'>
    render(<TenderSidebarEntry {...props} wide />)
    const mount = sidebar.querySelector<HTMLElement>('[data-dsh-tender-top-mount="true"]')
    expect(sidebar.firstElementChild).toBe(mount)
    expect(mount?.nextElementSibling).toBe(mcp)

    const dataCleaning = document.createElement('div')
    dataCleaning.dataset.dataCleaningTopMount = 'true'
    sidebar.insertBefore(dataCleaning, mcp)

    await waitFor(() => {
      expect(sidebar.firstElementChild).toBe(mount)
      expect(mount?.nextElementSibling).toBe(dataCleaning)
      expect(dataCleaning.nextElementSibling).toBe(mcp)
      expect(sidebar.querySelectorAll('[data-dsh-tender-top-mount="true"]')).toHaveLength(1)
    })
  })

  it('single-flights Session creation and shows a bounded failure', async () => {
    const sidebar = document.createElement('div')
    const workspaces = document.createElement('div')
    workspaces.dataset.slot = 'sidebar.workspaces'
    sidebar.append(workspaces)
    document.body.append(sidebar)
    let reject!: (reason: Error) => void
    const startTenderSession = vi.fn(() => new Promise<void>((_resolve, nextReject) => { reject = nextReject }))
    const props = {
      startTenderSession,
      t,
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as Omit<TenderSidebarEntryProps, 'wide'>
    render(<TenderSidebarEntry {...props} wide />)

    const launcher = screen.getByRole('button', { name: zh['sidebar.aria'] })
    fireEvent.click(launcher)
    fireEvent.click(launcher)
    expect(startTenderSession).toHaveBeenCalledTimes(1)
    expect(launcher.getAttribute('aria-busy')).toBe('true')

    reject(new Error('当前 DSH 不支持新建招投标专属会话。'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('当前 DSH 不支持新建招投标专属会话。')
      expect(launcher.getAttribute('aria-busy')).toBe('false')
    })
  })

  it('uses the tender mark and headline only for Sessions created by the tender entry', async () => {
    const useSessions = (selector: (value: { current?: string }) => unknown) => selector({ current: 'ordinary-session' })
    const ordinaryProps = {
      size: 34,
      className: 'brand',
      useSessions,
      useWorkspaces: vi.fn(),
    } as unknown as TenderHeroBrandMarkProps
    const ordinary = render(<TenderHeroBrandMark {...ordinaryProps} />)
    const nativeMark = ordinary.container.innerHTML
    ordinary.unmount()

    const tenderUseSessions = (selector: (value: { current?: string }) => unknown) => selector({
      current: `${TENDER_ENTRY_SESSION_ID_PREFIX}12345678-1234-4234-8234-123456789abc`,
    })
    const tenderProps = {
      ...ordinaryProps,
      useSessions: tenderUseSessions,
    } as unknown as TenderHeroBrandMarkProps
    const tender = render(<TenderHeroBrandMark {...tenderProps} />)
    expect(tender.container.innerHTML).not.toBe(nativeMark)
    tender.unmount()

    const hero = document.createElement('div')
    hero.dataset.phase = 'hero'
    const headline = document.createElement('span')
    headline.textContent = '探索未至之境'
    const overlay = document.createElement('div')
    hero.append(headline, overlay)
    document.body.append(hero)
    const bridgeProps = {
      sessionId: `${TENDER_ENTRY_SESSION_ID_PREFIX}12345678-1234-4234-8234-123456789abc`,
      t,
      useSession: (selector: (value: { composerPhase: string }) => unknown) => selector({ composerPhase: 'blank' }),
      useProjection: vi.fn(),
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as TenderHeroTitleBridgeProps
    const bridge = render(<TenderHeroTitleBridge {...bridgeProps} />, { container: overlay })
    expect(headline.textContent).toBe('招投标')
    headline.textContent = '访前尽调智能体'
    await waitFor(() => { expect(headline.textContent).toBe('招投标') })
    bridge.unmount()
    // 单一会话所有权 + 有界同步后，桥不再把其它插件随后写入的标题重新捕获为「要恢复的原始值」；
    // 卸载时恢复的是挂载时刻的原始标题，而不是访前插件在观察期内的短暂写入。
    expect(headline.textContent).toBe('探索未至之境')

    headline.textContent = '探索未至之境'
    const ordinaryOverlay = document.createElement('div')
    hero.append(ordinaryOverlay)
    const ordinaryBridge = render(<TenderHeroTitleBridge
      {...bridgeProps}
      sessionId="ordinary-session"
    />, { container: ordinaryOverlay })
    expect(headline.textContent).toBe('探索未至之境')
    ordinaryBridge.unmount()
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
