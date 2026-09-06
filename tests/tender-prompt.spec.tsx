// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TenderPromptEntry, type TenderPromptProps } from '../src/client/TenderPrompt.tsx'
import { formatTenderPromptDraft, initialTenderPrompt, planTenderDraftFill } from '../src/client/tender-prompt.ts'
import { TENDER_ENTRY_SESSION_ID_PREFIX } from '../src/client/tender-session-entry.ts'

afterEach(cleanup)
function harness(text = '') {
  let value = text
  const memory = { draft: initialTenderPrompt() }
  const write = vi.fn((next: string) => { value = next })
  const props = { sessionId: TENDER_ENTRY_SESSION_ID_PREFIX + '12345678-1234-4234-8234-123456789abc',
    memory, draftPort: { read: () => value, write } } as unknown as TenderPromptProps
  return { props, write, value: () => value }
}
describe('tender prompt wizard', () => {
  it('never mounts on ordinary sessions', () => {
    const test = harness()
    render(<TenderPromptEntry {...test.props} sessionId="ordinary" />)
    expect(screen.queryByText('提示词生成')).toBeNull()
    expect(test.write).not.toHaveBeenCalled()
  })
  it('retains the draft on close, traps focus, handles IME, fills but does not send', () => {
    const test = harness()
    render(<TenderPromptEntry {...test.props} />)
    const trigger = screen.getByRole('button', { name: '提示词生成' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: '关闭提示词向导' })
    const fill = screen.getByRole('button', { name: '回填输入框' })
    fireEvent.change(screen.getByLabelText(/关键词/), { target: { value: '智慧园区' } })
    fill.focus(); fireEvent.keyDown(fill, { key: 'Tab' }); expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(fill)
    fireEvent.keyDown(dialog, { key: 'Escape', isComposing: true }); expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    expect((screen.getByLabelText(/关键词/) as HTMLInputElement).value).toBe('智慧园区')
    fireEvent.click(screen.getByRole('button', { name: '回填输入框' }))
    expect(test.write).toHaveBeenCalledTimes(1)
    expect(test.value()).toContain('智慧园区')
    expect(test.value()).not.toContain('intentId')
    expect(screen.getByRole('status').textContent).toContain('手动发送')
  })
  it('does not overwrite manual input without a choice; updated generated blocks are not duplicated', () => {
    const test = harness('请保留我的备注')
    render(<TenderPromptEntry {...test.props} />)
    const open = () => fireEvent.click(screen.getByRole('button', { name: '提示词生成' }))
    open()
    fireEvent.change(screen.getByLabelText(/关键词/), { target: { value: '数据' } })
    fireEvent.click(screen.getByRole('button', { name: '回填输入框' }))
    expect(test.write).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(test.value()).toBe('请保留我的备注')
    fireEvent.click(screen.getByRole('button', { name: '回填输入框' }))
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(test.value()).toMatch(/^请保留我的备注\n\n/)
    open()
    fireEvent.change(screen.getByLabelText(/关键词/), { target: { value: '软件' } })
    fireEvent.click(screen.getByRole('button', { name: '回填输入框' }))
    expect(test.value()).toContain('关键词：软件')
    expect(test.value()).not.toContain('关键词：数据')
    expect(test.value().match(/请帮我开展/g)).toHaveLength(1)
  })
  it('cleans an open modal on a switch and never copies wizard state to another session', () => {
    const test = harness(), other = harness()
    const view = render(<TenderPromptEntry {...test.props} />)
    fireEvent.click(screen.getByText('提示词生成'))
    fireEvent.change(screen.getByLabelText(/关键词/), { target: { value: '招标' } })
    view.rerender(<TenderPromptEntry {...other.props} sessionId={other.props.sessionId.slice(0, -1) + '2'} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('提示词生成'))
    expect((screen.getByLabelText(/关键词/) as HTMLInputElement).value).toBe('')
  })
  it('keeps edited generated text pending explicit confirmation and reports unavailable input', () => {
    expect(planTenderDraftFill('手动修改后的查询', '新查询', '旧查询')).toBeUndefined()
    const test = harness()
    test.props.memory.draft.keywords = '数据'
    test.props.draftPort.read = () => { throw new Error('unavailable') }
    render(<TenderPromptEntry {...test.props} />)
    fireEvent.click(screen.getByText('提示词生成'))
    fireEvent.click(screen.getByRole('button', { name: '回填输入框' }))
    expect(screen.getByRole('alert').textContent).toContain('未修改草稿')
    expect(test.write).not.toHaveBeenCalled()
    expect(formatTenderPromptDraft(initialTenderPrompt())).toContain('不限地区')
  })
})
