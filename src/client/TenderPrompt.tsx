import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { isTenderEntrySessionId } from './tender-session-entry.ts'
import { formatTenderPromptDraft, planTenderDraftFill, type TenderDraftPort, type TenderPromptMemory } from './tender-prompt.ts'
import theme from './qcc-theme.module.css'
import css from './workbench-entry.module.css'

// rc.2 exposes this session/list slot at runtime but omits it from SlotMap.
// Verified against ui-conversation/lib/client.js (renderSlot overlay with {}).
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.input.overlay': { kind: 'list'; scope: 'session'; owner: object }
  }
}

export interface TenderPromptInjected {
  draftPort: TenderDraftPort
  memory: TenderPromptMemory
}
export type TenderPromptProps = PropsRuntime<'conversation.input.overlay'> & InjectFace<TenderPromptInjected>

export function TenderPromptEntry(props: TenderPromptProps) {
  if (!isTenderEntrySessionId(props.sessionId)) return null
  return <TenderPrompt key={props.sessionId} {...props} />
}

function TenderPrompt({ draftPort, memory }: TenderPromptInjected) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(memory.draft)
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState('')
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => { memory.draft = draft }, [draft, memory])
  useEffect(() => {
    if (!open || !panel.current) return
    const dialog = panel.current
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
    )]
    focusables()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      if (event.key !== 'Tab') return
      const nodes = focusables(), first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    dialog.addEventListener('keydown', keydown)
    return () => {
      dialog.removeEventListener('keydown', keydown)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  const fill = (mode?: 'replace' | 'append') => {
    if (!draft.keywords.trim()) { setMessage('请填写至少一个查询关键词。'); return }
    try {
      const generated = formatTenderPromptDraft(draft)
      const current = draftPort.read()
      const planned = mode === 'replace' ? generated : mode === 'append'
        ? [current.trimEnd(), generated].filter(Boolean).join('\n\n')
        : planTenderDraftFill(current, generated, memory.lastGenerated)
      if (planned === undefined) { setConflict(true); return }
      draftPort.write(planned)
      memory.lastGenerated = generated
      setConflict(false); setOpen(false); setMessage('已回填输入框，可修改后手动发送。')
    } catch {
      setMessage('当前会话输入框暂不可用，未修改草稿。请关闭向导后重试。')
    }
  }
  return <div className={`${theme.scope} ${css.promptEntry}`} data-dsh-tender-prompt="true">
    <button ref={trigger} type="button" className={css.promptTrigger} onClick={() => { setMessage(''); setConflict(false); setOpen(true) }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 20 12-12 4 4L8 24M14 3v4M12 5h4M4 4v6M1 7h6" transform="translate(1 -2)" /></svg>
      提示词生成
    </button>
    {!open && message && <span role="status" className={css.promptNotice}>{message}</span>}
    {open && createPortal(<div className={`${theme.scope} ${css.backdrop}`}>
      <section ref={panel} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className={css.dialogHeader}>
          <div><h2 id={titleId}>生成招投标查询任务</h2><p>整理查询条件，回填后仍可修改；不会自动发送或调用企查查。</p></div>
          <button type="button" className={css.closeButton} aria-label="关闭提示词向导" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className={css.dialogBody}>
          <fieldset><legend>查询范围</legend><div className={css.scopeGrid}>
            {([['combined', '组合查询'], ['tender', '仅招投标'], ['proposed', '仅拟建项目']] as const).map(([value, label]) =>
              <label key={value} data-selected={draft.scope === value}><input type="radio" name={titleId} checked={draft.scope === value} onChange={() => setDraft({ ...draft, scope: value })} />{label}</label>)}
          </div></fieldset>
          <label className={css.formField}>关键词 <span>必填</span><input value={draft.keywords} maxLength={400} placeholder="例如：大数据、智慧园区" onChange={e => setDraft({ ...draft, keywords: e.target.value })} /></label>
          <div className={css.fieldGrid}>
            <label className={css.formField}>发布时间<select value={draft.period} onChange={e => setDraft({ ...draft, period: e.target.value as typeof draft.period })}>
              {(['近3个月', '近1个月', '近7天', '不限时间'] as const).map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label className={css.formField}>地区<input value={draft.region} placeholder="不限地区，例如江苏省" maxLength={200} onChange={e => setDraft({ ...draft, region: e.target.value })} /></label>
          </div>
          <label className={css.formField}>业务目标与筛选关注<textarea rows={3} value={draft.target} maxLength={2000} placeholder="例如：寻找适合数据服务的项目，关注预算与报名截止时间" onChange={e => setDraft({ ...draft, target: e.target.value })} /></label>
          <details className={css.promptPreview}><summary>查看将回填的任务描述</summary><pre>{formatTenderPromptDraft(draft)}</pre></details>
          <p className={css.formHint}>本向导只整理描述。精确地区、金额与阶段参数可在右侧工作台配置；真实查询使用你连接的企查查 MCP 账号与额度。</p>
          {message && <p role="alert">{message}</p>}
        </div>
        <footer className={css.dialogFooter}>
          {conflict ? <><p role="status">输入框已有或修改过内容，请选择如何回填。</p><div className={css.dialogActions}>
            <button type="button" onClick={() => setConflict(false)}>取消</button>
            <button type="button" onClick={() => fill('append')}>追加</button>
            <button type="button" className={css.action} onClick={() => fill('replace')}>替换已有内容</button>
          </div></> : <><span>关闭保留本会话的向导草稿。</span><button type="button" className={css.action} onClick={() => fill()}>回填输入框</button></>}
        </footer>
      </section>
    </div>, document.body)}
  </div>
}
