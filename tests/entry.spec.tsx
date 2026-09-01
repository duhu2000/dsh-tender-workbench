// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyTenderWorkflowProjection } from '../src/contracts/workflow.ts'
import {
  TenderEntryView,
  TenderSidebarEntry,
  TenderSessionHeaderEntry,
  type TenderHeaderEntryProps,
  type TenderSidebarEntryProps,
} from '../src/client/TenderEntry.tsx'
import { zh, type TenderKey } from '../src/client/locales.ts'

const t = ((key: TenderKey) => zh[key]) as TranslateNS<'tenderFilter'>

afterEach(() => { cleanup() })

describe('S1a tender entries', () => {
  it('opens the shared workbench from the composer shortcut without mounting a filter drawer', () => {
    const openWorkbench = vi.fn(() => true)
    render(<TenderEntryView openWorkbench={openWorkbench} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['trigger.label'] }))
    expect(openWorkbench).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders a wide sidebar row and a compact accessible rail action', () => {
    const openCurrentWorkbench = vi.fn(() => true)
    const props = {
      openCurrentWorkbench,
      t,
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as Omit<TenderSidebarEntryProps, 'wide'>
    const { rerender } = render(<TenderSidebarEntry {...props} wide />)
    expect(screen.getByText(zh['sidebar.label'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['sidebar.aria'] }))
    expect(openCurrentWorkbench).toHaveBeenCalledTimes(1)

    rerender(<TenderSidebarEntry {...props} wide={false} />)
    expect(screen.queryByText(zh['sidebar.label'])).toBeNull()
    expect(screen.getByRole('button', { name: zh['sidebar.aria'] })).toBeTruthy()
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
