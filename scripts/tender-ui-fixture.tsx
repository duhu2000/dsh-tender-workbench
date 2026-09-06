// Isolated host-shaped fixture; no real sessions, QCC calls, or installed bundles.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TenderHeroTitleBridge, TenderSidebarEntry } from '../src/client/TenderEntry.tsx'
import { TenderPromptEntry } from '../src/client/TenderPrompt.tsx'
import { initialTenderPrompt, type TenderPromptMemory } from '../src/client/tender-prompt.ts'
import { TenderWorkbenchView } from '../src/client/workbench/TenderWorkbench.tsx'
import { createTenderWorkbenchNavigationController, type WorkbenchPhase } from '../src/client/workbench/navigation-controller.ts'
import { zh } from '../src/client/locales.ts'
import { TENDER_ENTRY_SESSION_ID_PREFIX } from '../src/client/tender-session-entry.ts'
const tenderId = TENDER_ENTRY_SESSION_ID_PREFIX + '12345678-1234-4234-8234-123456789abc'
const navigation = createTenderWorkbenchNavigationController()
const memory: TenderPromptMemory = { draft: initialTenderPrompt() }
const t = ((key: keyof typeof zh, params = {}) => Object.entries(params).reduce((v, [k, value]) => v.replaceAll('{'+k+'}', String(value)), zh[key])) as never
function App() {
  const [owned, setOwned] = useState(true)
  const [bench, setBench] = useState(false)
  const [draft, setDraft] = useState('')
  const sessionId = owned ? tenderId : 'ordinary'
  const openPhase = (phase: WorkbenchPhase) => { setBench(true); setTimeout(() => navigation.request(tenderId, phase), 0); return true }
  return <>
    <div className="fixtureToolbar"><button id="ordinary" onClick={() => { setOwned(false); setBench(false) }}>普通新会话</button><span>隔离 UI 验证 · 不连接 DSH / MCP</span></div>
    <div className="fixtureLayout">
      <aside className="fixtureSidebar"><button>新会话</button><div data-slot="sidebar.workspaces">工作区</div>
        <TenderSidebarEntry {...{ wide: true, t, useSessions: () => sessionId, startTenderSession: async () => { setOwned(true); setBench(true) } } as never} />
      </aside>
      <main><div data-phase="hero" data-composer-seat>
        <div className="nativeHeadline"><span className="fishHitbox">◇</span><span className="headlineText">探索未至之境</span><span className="preview">预览版</span></div>
        <div className="stack">
          <div data-slot="conversation.input.dock"><TenderHeroTitleBridge {...{ sessionId, t, useSession: () => true, openPhase } as never} /></div>
          <div id="inputBranch"><div data-composer-card>
            <TenderPromptEntry {...{ sessionId, memory, draftPort: { read: () => draft, write: setDraft } } as never} />
            <textarea id="nativeInput" aria-label="原生输入框" value={draft} onChange={e => setDraft(e.target.value)} placeholder="描述你想要寻找的项目机会" />
            <div className="nativeTools"><span>＋　Workspace Write　　deepseek-v4-pro</span><button id="send">发送</button></div>
          </div></div>
        </div>
      </div></main>
      {bench && owned && <aside className="fixtureWorkbench">
        <div className="fixtureBenchChrome"><span>招投标</span><button id="closeBench" onClick={() => setBench(false)}>收起工作台</button></div>
        <TenderWorkbenchView sessionId={tenderId} projection={{ status: 'empty' }} navigation={navigation} t={t} sendIntent={async () => { throw Error('UI fixture must not execute tools') }} />
      </aside>}
    </div>
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
