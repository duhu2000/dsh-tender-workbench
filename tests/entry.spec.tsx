// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import {
  TenderHeroTitleBridge,
  TenderSidebarEntry,
  TenderSessionHeaderEntry,
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
    expect(sidebar.firstElementChild).toBe(dataCleaning)
    expect(mount?.nextElementSibling).toBe(workspaces)
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
    expect(sidebar.firstElementChild).toBe(mcp)
    expect(mount?.nextElementSibling).toBe(workspaces)

    const dataCleaning = document.createElement('div')
    dataCleaning.dataset.dataCleaningTopMount = 'true'
    sidebar.insertBefore(dataCleaning, mcp)

    await waitFor(() => {
      expect(sidebar.firstElementChild).toBe(dataCleaning)
      expect(mount?.nextElementSibling).toBe(workspaces)
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

  it('brands only the owned session, preserves native chrome and restores it on exit', () => {
    const hero = document.createElement('div')
    hero.dataset.phase = 'hero'
    hero.innerHTML = '<div class="headlineRow"><span class="fishHitbox">native fish</span><span class="headlineText">探索未至之境</span><span>预览版</span></div><div data-composer-seat><div data-testid="dock"></div><div data-composer-card>native input</div></div>'
    document.body.append(hero)
    const row = hero.querySelector<HTMLElement>('.headlineRow')!
    const dock = hero.querySelector<HTMLElement>('[data-testid="dock"]')!
    const native = row.innerHTML
    const props = {
      sessionId: `${TENDER_ENTRY_SESSION_ID_PREFIX}12345678-1234-4234-8234-123456789abc`,
      t, openPhase: vi.fn(() => true),
      useSession: (selector: (value: { composerPhase: string }) => unknown) => selector({ composerPhase: 'blank' }),
    } as unknown as TenderHeroTitleBridgeProps
    const view = render(<TenderHeroTitleBridge {...props} />, { container: dock })
    expect(screen.getByRole('heading', { name: '招投标智能体' })).toBeTruthy()
    expect(row.style.display).toBe('none')
    expect(row.innerHTML).toBe(native)
    const card = hero.querySelector('[data-composer-card]')!
    expect(card.nextElementSibling?.getAttribute('data-dsh-tender-shortcuts')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /规则筛选/ }))
    expect(props.openPhase).toHaveBeenCalledWith('screening')
    view.rerender(<TenderHeroTitleBridge {...props} sessionId="ordinary-session" />)
    expect(row.style.display).toBe('')
    expect(row.innerHTML).toBe(native)
    expect(hero.querySelector('[data-dsh-tender-hero]')).toBeNull()
    expect(hero.querySelector('[data-dsh-tender-shortcuts]')).toBeNull()
    expect(screen.queryByRole('heading', { name: '招投标智能体' })).toBeNull()
    view.unmount()
  })

  it('leaves an unrecognized host hero intact', () => {
    const hero = document.createElement('div')
    hero.dataset.phase = 'hero'
    hero.innerHTML = '<span>Other plugin</span><div></div>'
    document.body.append(hero)
    const props = { sessionId: `${TENDER_ENTRY_SESSION_ID_PREFIX}12345678-1234-4234-8234-123456789abc`,
      t, openPhase: vi.fn(), useSession: () => true } as unknown as TenderHeroTitleBridgeProps
    const view = render(<TenderHeroTitleBridge {...props} />, { container: hero.lastElementChild as HTMLElement })
    expect(hero.firstElementChild?.textContent).toBe('Other plugin')
    expect(hero.querySelector('[data-dsh-tender-hero]')).toBeNull()
    view.unmount()
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
      sessionId: TENDER_ENTRY_SESSION_ID_PREFIX + '12345678-1234-4234-8234-123456789abc',
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
