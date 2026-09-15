// Real DSH + untouched npm tarball; the separate diagnostic plugin is test-only.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { assessCompatibility, inspectInstallation } from './check-host-compatibility.mjs'

const root = process.cwd(), bin = resolve(process.env.TENDER_DSH_BIN || '')
const initialDraftText = '请帮我查找并评估招投标机会。请填写行业、地区、时间范围和筛选条件，也可点击左上角「提示词生成」整理查询口径。例如：查找近 30 天【地区】软件和数据服务相关招标项目，排除已截止项目，形成候选清单。'
const sidebarMode = process.env.TENDER_TEST_SIDEBAR || 'compatible'
assert.ok(['absent', 'compatible', 'incompatible'].includes(sidebarMode))
const sidebarVersion = sidebarMode === 'absent' ? undefined : sidebarMode === 'incompatible' ? '0.17.1' : '0.18.1'
const products = process.env.TENDER_TEST_PRODUCTS === '1' ? { 'dsh-data-cleaning-agent': '0.9.15', 'dsh-pre-duediligence': '0.1.35', 'dsh-form-fill-agent': '0.2.30' } : {}
assert.ok(process.env.TENDER_DSH_BIN, 'Provide an explicit DSH 0.1.2-rc.1 bin; never bootstrap a production profile')
const { chromium } = await import(pathToFileURL(process.env.TENDER_PLAYWRIGHT).href)
const home = await mkdtemp(join(tmpdir(), 'tender-native-'))
const profile = join(home, 'profiles/web'), workspace = join(home, 'synthetic-workspace')
await mkdir(profile, { recursive: true }); await mkdir(workspace)
await mkdir(join(home, 'first-workspace'))
const env = { PATH: process.env.PATH, HOME: home, DSH_HOME: home, TMPDIR: tmpdir(), NO_COLOR: '1' }
env.TENDER_FIXTURE_HOME = home
const hostVersion = execFileSync(process.execPath, [bin, '--version'], { cwd: workspace, env, encoding: 'utf8' }).trim()
assert.equal(hostVersion, '0.1.2-rc.1')
// Use the host's own Profile template, not an empty generic npm project.
// DSH explicitly uses nodeLinker: hoisted / autoInstallPeers: false because
// core peers come from its installation-owned runtime. Do not emulate/override it.
const { initProfile } = await import(pathToFileURL(resolve(bin, '../../node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')).href)
initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' })
execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', home, '--cache', join(home, 'npm-cache')], { cwd: root, stdio: 'pipe' })
const tarball = join(home, pkg.name + '-' + pkg.version + '.tgz')
const tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
const probe = join(home, 'probe')
await mkdir(probe)
await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'tender-isolated-probe', version: '0.0.0', type: 'module', main: 'index.js', exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' }, dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [] } } }))
await writeFile(join(probe, 'business-fixture.mjs'), await readFile(join(root, 'scripts/native-business-fixture.mjs')))
await writeFile(join(probe, 'index.js'), `import { runBusinessFixture } from './business-fixture.mjs';
export const inject = ['tools', 'agents', 'sessions', 'sessionProjections', 'webServer'];
export function apply(ctx) { ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/tender-isolated-fixture', async handler(req, res) {
  if (req.method !== 'POST' || req.headers.origin !== 'http://127.0.0.1:' + req.socket.localPort) { res.writeHead(403); res.end(); return }
  try { const url = new URL(req.url, 'http://localhost'); const id = url.searchParams.get('session'); const result = url.searchParams.has('events') ? ctx.agents.get(id).session.snapshotEvents().map(e => e.type) : url.searchParams.has('state') ? ctx.sessionProjections.stateOf(ctx.agents.get(id).session, 'dshTenderWorkflow') : await runBusinessFixture(ctx, id); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result)); }
  catch(e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({error:e.message})); }
} })); }`)
await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - name: tender-isolated-probe\n')
await writeFile(join(probe, 'client.js'), `window.__ModuleLoader__.load({id:"tender-isolated-probe",factory:()=>({inject:${JSON.stringify(['uiConversation', 'conversation', 'sessions', 'workspaces', 'modules', ...(sidebarVersion ? ['betterSidebar'] : [])])},apply(ctx){window.__tenderNativeProbe=ctx;}})});`)
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'tender-isolated-profile', version: '0.0.0', private: true, type: 'module',
  dependencies: { ...products, [pkg.name]: 'file:' + tarball, ...(sidebarVersion ? { 'dsh-better-sidebar': sidebarVersion } : {}), 'tender-isolated-probe': 'file:' + probe, ...(process.env.TENDER_TEST_CONTEXT === '1' ? { 'dsh-context': '0.48.0' } : {}) },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...(sidebarVersion ? ['dsh-better-sidebar'] : []), ...Object.keys(products), pkg.name, 'tender-isolated-probe', ...(process.env.TENDER_TEST_CONTEXT === '1' ? ['dsh-context'] : [])] } } }))
try {
  execFileSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'install', '--ignore-scripts', '--store-dir', process.env.TENDER_PNPM_STORE || join(home, 'pnpm-store')], { cwd: workspace, env, stdio: 'pipe' })
} catch (error) { throw new Error('Isolated dependency installation failed: ' + String(error.stdout).slice(-3000)) }
if (!sidebarVersion) await assert.rejects(access(join(profile, 'node_modules/dsh-better-sidebar')), 'Official DSH install must not auto-install Sidebar')
const preflight = assessCompatibility(inspectInstallation(resolve(bin, '../..'), profile))
if (sidebarMode === 'incompatible') assert.ok(preflight.errors.some(e => e.includes('settingsNamespace')))
else assert.deepEqual(preflight.errors, [])
const installed = await readFile(join(profile, 'node_modules', pkg.name, 'lib/client.js'), 'utf8')
assert.ok(!installed.includes('@deepseek-ai/dsh-client-runtime/client'), 'Packed code contains removed module')
assert.ok(!installed.includes('conversationEvents'), 'Packed code contains removed service')
const reservation = createServer()
await new Promise(ok => reservation.listen(0, '127.0.0.1', ok))
const port = reservation.address().port
await new Promise(ok => reservation.close(ok))
assert.notEqual(port, 3080)
const origin = 'http://127.0.0.1:' + port
let child = spawn(process.execPath, [bin, '--profile', 'web', '--port', String(port), '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser, phase = 'startup'
child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
const report = { package: pkg.name, version: pkg.version, hostVersion, sidebar: sidebarVersion ?? 'absent', preflight, install: 'official DSH Profile template + dsh plugin install; core peers provided by host', context: process.env.TENDER_TEST_CONTEXT === '1' ? '0.48.0' : 'absent', node: process.version, home, port, tarball, tarballSha256, productionProfileUsed: false, realMcp: 'NOT_TESTED' }
try {
  let ready = false
  for (let i = 0; i < 160; i++) {
    try { ready = (await fetch(origin)).status < 500 } catch {}
    if ((sidebarMode === 'incompatible' ? /settingsNamespace/.test(output) : ready) || child.exitCode !== null) break
    await new Promise(ok => setTimeout(ok, 250))
  }
  if (sidebarMode === 'incompatible') {
    assert.match(output, /settingsNamespace/)
    report.status = 'EXPECTED_STARTUP_FAILURE'; report.preflightBlocked = true
    report.observedError = output.split('\n').find(line => line.includes('settingsNamespace'))?.replace(/https?:\/\/\S+/g, '[url]')
    console.log(JSON.stringify(report, null, 2)); await writeFile(join(home, 'result.json'), JSON.stringify(report, null, 2))
  } else {
  assert.ok(ready, 'Host failed: ' + output.replace(/https?:\/\/\S+/g, '[url]').slice(-6000))
  browser = await chromium.launch({ headless: true, executablePath: process.env.TENDER_CHROME })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const urls = output.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s\x1b]*/g) || []
  const launch = urls.find(u => new URL(u).port === String(port) && u.includes('?')) || origin
  await page.goto(launch)
  await page.addLocatorHandler(page.getByRole('button', { name: '继续', exact: true }), l => l.click())
  await page.addLocatorHandler(page.getByRole('button', { name: '稍后配置', exact: true }), l => l.click())
  phase = 'services'
  await page.waitForFunction(() => window.__tenderNativeProbe?.uiConversation.events.entries().some(x => x.kind === 'tender-search'))
  const services = await page.evaluate(() => {
    const ctx = window.__tenderNativeProbe
    return { registered: ctx.uiConversation.events.entries().filter(x => x.kind === 'tender-search').length,
      loaded: [...ctx.modules.loadCache.keys()].filter(x => x.includes('tender') || x.includes('sidebar') || x.includes('runtime')) }
  })
  assert.equal(services.registered, 1)
  assert.ok(!services.loaded.some(x => x.includes('dsh-client-runtime')))
  report.services = services
  phase = 'official-assembler'
  report.resultsReplay = await page.evaluate(() => {
    const ctx = window.__tenderNativeProbe
    const api = ctx.modules.loadCache.get('@deepseek-ai/dsh-client-ui-conversation').exports
    const definition = ctx.uiConversation.events.entries().find(x => x.kind === 'tender-search')
    const view = { target: 'tender-smoke', create: () => ({ empty: null, replace: ({ timeline }) => timeline, apply: ({ timeline }) => timeline }) }
    const create = () => { const a = new api.ConversationNodeAssembler({ entries: () => [definition], fallbackEntry: () => undefined }, { entries: () => [view] }); a.activateTarget('tender-smoke'); return a }
    const payload = { '查询摘要': { '命中总数': 0, '结果说明': '隔离空结果', '生效筛选': {} }, '标讯列表': [] }
    const ev = (seq, type, data, surfaceOp) => ({ type: 'event', event: { seq, time: seq, type, data, ...(surfaceOp ? { surfaceOp } : {}) } })
    const rows = [ev(1, 'turn/start', { turn: 1 }), ev(2, 'tool/call', { turn: 1, step: 1, callId: 'fixture', name: 'mcp__qcc-tender__search_tenders', arguments: '{}' }),
      ev(3, 'tool/result', { turn: 1, step: 1, message: { source: { type: 'tool-result', callId: 'fixture' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify(payload) }] }] } }, 'append'),
      ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } })]
    const replay = create(); replay.replaceWindow(rows, false); replay.flush()
    const live = create(); for (const row of rows) { live.append(row); live.flush() }
    const read = a => a.snapshot('tender-smoke').turns.get(1).data.get('tender-search')
    const a = read(replay), b = read(live)
    if (a.calls[0].status !== 'success' || JSON.stringify(a) !== JSON.stringify(b)) throw Error('Official assembler replay differs')
    return { status: 'PASS', data: a, scope: 'synthetic event stream through real host assembler; no MCP call' }
  })
  const workspaceSetup = await page.evaluate(async ({ first, selected }) => {
    const ctx = window.__tenderNativeProbe
    await ctx.workspaces.create({ path: first })
    const target = await ctx.workspaces.create({ path: selected })
    const seed = await ctx.sessions.create({ workspaceId: target.workspaceId })
    ctx.sessions.open(seed)
    return { workspaceId: target.workspaceId, seed }
  }, { first: join(home, 'first-workspace'), selected: workspace })
  const selectedWorkspace = workspaceSetup.workspaceId
  await page.evaluate(() => {
    const hub = window.__tenderNativeProbe.conversation.input
    const original = hub.shell.bind(hub), wrapped = new WeakSet()
    window.__ux49Writes = []
    hub.shell = id => {
      const shell = original(id)
      if (!wrapped.has(shell)) {
        wrapped.add(shell)
        const set = shell.setDraft.bind(shell)
        shell.setDraft = text => {
          const before = document.activeElement
          set(text)
          if (text.startsWith('请帮我查找并评估招投标机会。')) {
            const record = { id, sameFocus: before === document.activeElement }
            window.__ux49Writes.push(record)
            queueMicrotask(() => { record.sameFocusAfterCommit = before === document.activeElement })
          }
        }
      }
      return shell
    }
  })
  phase = 'entry'
  await page.getByRole('button', { name: '新建招投标会话', exact: true }).click()
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor()
  const session = await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().current)
  phase = 'ux49-native-initial-draft'
  await page.waitForFunction(({ session, text }) => window.__tenderNativeProbe.conversation.input.shell(session).state.getSnapshot().draft === text, { session, text: initialDraftText })
  const initialWrites = await page.evaluate(() => window.__ux49Writes)
  assert.equal(initialWrites.length, 1)
  assert.ok(initialWrites[0].sameFocus && initialWrites[0].sameFocusAfterCommit, 'Native initialization must not steal focus')
  const emptyProjection = await page.evaluate(async id => {
    const response = await fetch('/tender-isolated-fixture?state&session=' + encodeURIComponent(id), { method: 'POST' })
    if (!response.ok) throw Error('initial state probe failed')
    return response.json()
  }, session)
  assert.equal(emptyProjection, null, 'Initial draft must not create a Projection')
  const initialEvents = await page.evaluate(async id => {
    const r = await fetch('/tender-isolated-fixture?events&session=' + encodeURIComponent(id), { method: 'POST' })
    if (!r.ok) throw Error('initial events probe failed')
    return r.json()
  }, session)
  assert.ok(!initialEvents.some(type => ['user/message', 'turn/start', 'tool/call'].includes(type)), 'Initialization must produce zero sends, turns, or tool calls')
  // Real native editable, not a DOM placeholder; clearing is a user action.
  const nativeEditor = page.locator('[contenteditable="true"]').first()
  assert.equal(await nativeEditor.innerText(), initialDraftText)
  await nativeEditor.fill('')
  await page.reload()
  await page.waitForFunction(() => window.__tenderNativeProbe?.sessions)
  await page.evaluate(async id => { const c = window.__tenderNativeProbe; await c.sessions.refresh(); c.sessions.open(id) }, session)
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor()
  assert.equal(await page.evaluate(id => window.__tenderNativeProbe.conversation.input.shell(id).state.getSnapshot().draft, session), '')
  report.initialDraft = { status: 'PASS', nativeEditable: true, oneWrite: true, noFocusSteal: true,
    noProjection: true, zeroSendAndToolEvents: true, userClearAndReloadNotRefilled: true, templateFingerprint: 'sha256:f2bf291eec74a12873fb6178362b61ed032f50389186bc82eec9462fd0e745ed' }
  // Leave only the blank business Session reusable in this Workspace, so the
  // later native New Session click necessarily exercises the ordinary guard.
  await page.evaluate(id => window.__tenderNativeProbe.workspaces.archiveSession(id), workspaceSetup.seed)
  await page.waitForFunction(id => window.__tenderNativeProbe.workspaces.list.getSnapshot().archivedSessionIds.includes(id), workspaceSetup.seed)
  const sessionIdsBefore = await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().ids)
  assert.ok(session.startsWith('session-dsh-tender-workbench-'))
  await page.waitForFunction(({ session, workspaceId }) => window.__tenderNativeProbe.workspaces.list.getSnapshot().items.some(w => w.workspaceId === workspaceId && w.sessionIds.includes(session)), { session, workspaceId: selectedWorkspace })
  const memberships = await page.evaluate(id => window.__tenderNativeProbe.workspaces.list.getSnapshot().items.filter(w => w.sessionIds.includes(id)).map(w => w.workspaceId), session)
  assert.deepEqual(memberships, [selectedWorkspace], 'Entry must attach to selected Workspace, not first or ungrouped')
  if (sidebarMode === 'compatible') {
    await page.waitForFunction(id => window.__tenderNativeProbe.betterSidebar.getSnapshot().sessionId === id, session)
    const initial = await page.evaluate(() => window.__tenderNativeProbe.betterSidebar.getSnapshot().state)
    assert.ok(!initial?.panelOpen && !initial?.bottomOpen, 'Entry must not reveal any workbench panel')
    assert.equal(JSON.stringify(initial ?? {}).includes('dsh-tender-workbench:agent'), false, 'Entry must not create a business Tab')
  }
  report.workspaceOwnership = { status: 'PASS', workspaceId: selectedWorkspace, memberships, entryPanelClosed: true }
  await page.screenshot({ path: join(home, 'workspace-entry.png') })
  phase = 'native-skill-catalog'
  const skills = await page.evaluate(async sessionId => {
    const result = await window.__tenderNativeProbe.get('remote.skills').list({ sessionId })
    if (!result.ok) throw Error('Skill directory failed: ' + result.error.code)
    return result.value.skills.filter(s => s.name.startsWith('tender-workbench-')).map(s => ({ name: s.name, description: s.description }))
  }, session)
  for (const name of ['query', 'screening', 'analysis', 'review', 'report']) {
    assert.ok(skills.some(s => s.name === 'tender-workbench-' + name), 'Missing native action Skill: ' + name)
  }
  report.nativeSkillCatalog = { status: 'PASS', names: skills.map(s => s.name), scope: 'real read-only Host RPC, no model submission' }
  if (sidebarMode === 'absent') {
    assert.ok(!services.loaded.includes('dsh-better-sidebar'))
    await page.evaluate(id => { const c = window.__tenderNativeProbe; c.conversation.input.for(c.sessions.scope(id)).setDraft('隔离未发送原生草稿') }, session)
    for (const label of ['找机会', '筛候选', '人工定案', '形成交付', '任务历史']) {
      const button = page.getByRole('navigation', { name: '招投标快捷导航' }).getByRole('button', { name: label, exact: true })
      await button.click(); await button.click()
      assert.match(await page.getByRole('alert').last().textContent(), /当前输入和业务记录未改变/)
    }
    const draft = await page.evaluate(id => { const c = window.__tenderNativeProbe; return c.conversation.input.for(c.sessions.scope(id)).state.getSnapshot().draft }, session)
    assert.equal(draft, '隔离未发送原生草稿')
    await page.getByRole('button', { name: '提示词生成', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '生成招投标查询任务' })
    await dialog.getByLabel('关键词', { exact: false }).fill('隔离向导关键词')
    await dialog.getByRole('button', { name: '回填输入框', exact: true }).click()
    await dialog.getByRole('button', { name: '追加', exact: true }).click()
    const generated = await page.evaluate(id => { const c = window.__tenderNativeProbe; return c.conversation.input.for(c.sessions.scope(id)).state.getSnapshot().draft }, session)
    assert.ok(generated.includes('隔离未发送原生草稿') && generated.includes('隔离向导关键词'))
    assert.deepEqual(await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().ids), sessionIdsBefore)
    assert.equal(await page.getByRole('tab', { name: '找机会', exact: true }).count(), 0)
    report.absentSidebar = { officialInstallerDidNotInstall: true, clientLoaded: true, repeatedShortcutsPreserveDraft: true, promptBuilderAppend: true, noExtraSessionsOrWorkbench: true }
  } else {
  phase = 'five-flows'
  for (const label of ['找机会', '筛候选', '人工定案', '形成交付', '任务历史']) {
    const button = page.getByRole('navigation', { name: '招投标快捷导航' }).getByRole('button', { name: label, exact: true })
    await button.click(); await button.click()
    await page.waitForFunction(() => !!window.__tenderNativeProbe.betterSidebar.getSnapshot().state)
    if (label === '任务历史') await page.getByRole('heading', { name: '任务历史 · 当前 Profile', exact: true }).waitFor()
    else assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true')
    const count = await page.evaluate(() => {
      const state = window.__tenderNativeProbe.betterSidebar.getSnapshot().state
      const tabs = n => n.kind === 'leaf' ? n.tabs : n.children.flatMap(tabs)
      return [...tabs(state.splits), ...tabs(state.bottomSplits), ...state.floats.map(f => f.tab)].filter(t => t.type === 'dsh-tender-workbench:agent').length
    })
    assert.equal(count, 1, 'Repeated navigation must keep one native business Tab')
  }
  report.sidebarSnapshot = await page.evaluate(() => {
    const { state } = window.__tenderNativeProbe.betterSidebar.getSnapshot()
    return state
  })
  phase = 'tab-close-and-draft'
  const shortcuts = page.getByRole('navigation', { name: '招投标快捷导航' })
  await shortcuts.getByRole('button', { name: '找机会', exact: true }).click()
  await page.getByLabel('本次分析目标', { exact: true }).fill('隔离未提交草稿')
  await page.locator('[title="招投标"]').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByLabel('本次分析目标', { exact: true }).waitFor({ state: 'hidden' })
  await shortcuts.getByRole('button', { name: '找机会', exact: true }).click()
  assert.equal(await page.getByLabel('本次分析目标', { exact: true }).inputValue(), '隔离未提交草稿')
  await page.locator('[title="Files"]').click()
  await page.getByLabel('本次分析目标', { exact: true }).waitFor({ state: 'hidden' })
  await shortcuts.getByRole('button', { name: '找机会', exact: true }).click()
  assert.equal(await page.getByLabel('本次分析目标', { exact: true }).inputValue(), '隔离未提交草稿')
  report.tabCloseFilesAndDraft = 'PASS'
  phase = 'host-collapse-and-restore'
  const beforeCollapse = await page.evaluate(() => window.__tenderNativeProbe.betterSidebar.getSnapshot().state)
  await page.getByRole('button', { name: '折叠侧边栏', exact: true }).click()
  await page.waitForFunction(() => window.__tenderNativeProbe.betterSidebar.getSnapshot().state.panelOpen === false)
  const collapsed = await page.evaluate(() => window.__tenderNativeProbe.betterSidebar.getSnapshot().state)
  assert.deepEqual(collapsed.splits, beforeCollapse.splits, 'Host collapse must retain Tabs')
  assert.equal(collapsed.width, beforeCollapse.width)
  await shortcuts.getByRole('button', { name: '找机会', exact: true }).click()
  await page.waitForFunction(() => window.__tenderNativeProbe.betterSidebar.getSnapshot().state.panelOpen === true)
  assert.equal(await page.getByLabel('本次分析目标', { exact: true }).inputValue(), '隔离未提交草稿')
  report.hostCollapseAndRestore = 'PASS'
  }
  phase = 'ordinary-session'
  const eligibleBlanks = await page.evaluate(workspaceId => {
    const ctx = window.__tenderNativeProbe, ws = ctx.workspaces.list.getSnapshot()
    const target = ws.items.find(w => w.workspaceId === workspaceId)
    const list = ctx.sessions.list.getSnapshot()
    return list.ids.filter(id => list.byId[id]?.blank && list.byId[id]?.cwd === target.path && target.sessionIds.includes(id) && !ws.archivedSessionIds.includes(id))
  }, selectedWorkspace)
  assert.deepEqual(eligibleBlanks, [session], 'Fixture must prove the sole blank candidate is the business Session')
  assert.deepEqual(await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().ids), sessionIdsBefore, 'Navigation must not create Sessions')
  await page.getByRole('button', { name: /新会话|新建会话/ }).first().click()
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor({ state: 'hidden' })
  const ordinary = await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().current)
  assert.notEqual(ordinary, session)
  assert.ok(!ordinary.startsWith('session-dsh-'), 'Ordinary New Session must not reuse any business Session')
  await page.waitForFunction(({ ordinary, business, workspaceId }) => {
    const target = window.__tenderNativeProbe.workspaces.list.getSnapshot().items.find(w => w.workspaceId === workspaceId)
    return target?.sessionIds.includes(ordinary) && target.sessionIds.includes(business)
  }, { ordinary, business: session, workspaceId: selectedWorkspace })
  report.ordinaryKeepsBusinessMembership = 'PASS'
  await page.evaluate(id => window.__tenderNativeProbe.sessions.open(id), session)
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor()
  phase = 'real-host-business-fixture'
  report.business = await page.evaluate(async id => { const response = await fetch('/tender-isolated-fixture?session=' + encodeURIComponent(id), { method: 'POST' }); const result = await response.json(); if (!response.ok) throw Error(result.error); return result }, session)
  assert.equal(report.business.status, 'PASS')
  phase = 'artifact-downloads'
  report.downloads = await page.evaluate(async ({ sessionId, artifacts }) => {
    const results = {}
    for (const [format, artifact] of Object.entries(artifacts)) {
      const response = await fetch('/dsh-tender-workbench/api/v1/artifacts/' + artifact.id + '/download', {
        headers: { 'x-dsh-tender-session': sessionId, 'x-dsh-tender-artifact-token': artifact.accessToken },
      })
      if (!response.ok) throw Error(format + ' download HTTP ' + response.status)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const signature = String.fromCharCode(...bytes.slice(0, format === 'excel' ? 2 : 5))
      if (bytes.length < 1000 || signature !== (format === 'excel' ? 'PK' : '%PDF-')) throw Error(format + ' invalid artifact')
      results[format] = { status: 'PASS', bytes: bytes.length, signature }
    }
    return results
  }, { sessionId: session, artifacts: { excel: report.business.report.excel.artifact, pdf: report.business.report.pdf.artifact } })
  // Even synthetic artifact capabilities should not be printed or retained in evidence.
  report.business = JSON.parse(JSON.stringify(report.business, (key, value) => key === 'accessToken' ? '[redacted]' : value))
  phase = 'navigation-preserves-completed-business'
  const readState = () => page.evaluate(async id => {
    const response = await fetch('/tender-isolated-fixture?state=1&session=' + encodeURIComponent(id), { method: 'POST' })
    if (!response.ok) throw Error('State read HTTP ' + response.status)
    return response.text()
  }, session)
  const beforeNavigation = await readState()
  for (const label of ['找机会', '筛候选', '人工定案', '形成交付', '任务历史']) {
    const button = page.getByRole('navigation', { name: '招投标快捷导航' }).getByRole('button', { name: label, exact: true })
    await button.click(); await button.click()
  }
  assert.equal(await readState(), beforeNavigation, 'Navigation must preserve the complete real workflow projection')
  report.navigationPreservesCompletedBusiness = 'PASS'
  phase = 'profile-history-and-progress'
  const readHistory = id => page.evaluate(async sessionId => {
    const response = await fetch('/dsh-tender-workbench/api/v1/history', { headers: { 'X-Dsh-Tender-Session': sessionId } })
    if (!response.ok) throw Error('History HTTP ' + response.status)
    return response.json()
  }, id)
  const history = await readHistory(session)
  assert.equal(history.scope, 'profile'); assert.equal(history.total, 1)
  assert.equal(history.entries[0].originSessionId, session)
  assert.equal(history.entries[0].originWorkspaceId, selectedWorkspace)
  assert.deepEqual(history.entries[0].deliverables, ['excel', 'pdf'])
  assert.ok(!JSON.stringify(history).includes('accessToken'))
  const execution = JSON.parse(beforeNavigation).execution
  assert.equal(execution.status, 'succeeded'); assert.equal(execution.counts.succeeded, 2)
  assert.equal(execution.counts.queried, 1); assert.equal(execution.providers.tender, 'data')
  if (sidebarVersion) {
    await page.getByRole('heading', { name: '任务历史 · 当前 Profile' }).waitFor()
    await page.getByRole('button', { name: '打开来源会话', exact: true }).waitFor()
  }
  await page.evaluate(id => window.__tenderNativeProbe.sessions.open(id), ordinary)
  const backgroundGeometry = sidebarVersion ? await page.evaluate(() => JSON.stringify(window.__tenderNativeProbe.betterSidebar.getSnapshot().state)) : null
  assert.deepEqual(await readHistory(ordinary), history, 'B reads metadata without rebinding A projection')
  if (sidebarVersion) assert.equal(await page.evaluate(() => JSON.stringify(window.__tenderNativeProbe.betterSidebar.getSnapshot().state)), backgroundGeometry)
  assert.equal(await readState(), beforeNavigation)
  report.profileHistoryAndRealProgress = 'PASS'
  if (Object.keys(products).length) {
    phase = 'four-product-navigation'
    report.fourProductNavigation = { status: 'IN_PROGRESS', products, passedEntries: [] }
    for (const [name, prefix, role] of [['数据清洗补全', 'session-dsh-data-cleaning', 'button'], ['访前尽调', 'session-dsh-pre-duediligence-', 'button'], ['AI 填表', 'session-dsh-form-fill', 'link']]) {
      const entry = page.getByRole(role, { name, exact: true })
      if (role === 'link') assert.equal(await entry.getAttribute('href'), '/form-fill/', 'Verify the public entry target, not any same-label link')
      await entry.click()
      await page.waitForFunction(prefix => window.__tenderNativeProbe.sessions.list.getSnapshot().current?.startsWith(prefix), prefix)
      await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor({ state: 'hidden' })
      const coexist = await page.evaluate(label => {
        const c = window.__tenderNativeProbe, id = c.sessions.list.getSnapshot().current
        const shell = c.conversation.input.shell(id)
        const initial = shell.state.getSnapshot().draft
        if (initial.startsWith('请帮我查找并评估招投标机会。')) throw Error('Tender draft leaked into ' + label)
        const sentinel = 'UX49 跨产品用户草稿 ' + label
        shell.setDraft(sentinel)
        return { id, initial, sentinel }
      }, name)
      await page.evaluate(async ({ id, sentinel, tender }) => {
        const c = window.__tenderNativeProbe
        c.sessions.open(tender)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        c.sessions.open(id)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        if (c.conversation.input.shell(id).state.getSnapshot().draft !== sentinel) throw Error('Late callback overwrote other-product draft')
      }, { ...coexist, tender: session })
      report.fourProductNavigation.passedEntries.push(name)
    }
    assert.equal(await readState(), beforeNavigation)
    await page.getByRole('button', { name: '新建招投标会话', exact: true }).click()
    await page.waitForFunction(() => window.__tenderNativeProbe.sessions.list.getSnapshot().current?.startsWith('session-dsh-tender-workbench-'))
    await page.getByRole('navigation', { name: '招投标快捷导航' }).getByRole('button', { name: '任务历史', exact: true }).click()
    await page.getByRole('button', { name: '打开来源会话', exact: true }).click()
    await page.waitForFunction(id => window.__tenderNativeProbe.sessions.list.getSnapshot().current === id, session)
    assert.equal(await readState(), beforeNavigation, 'Explicit history navigation must not restore/rebind a projection')
    report.fourProductNavigation.status = 'PASS'
    report.fourProductNavigation.scope = 'public button/link entries, cross-product Session switch, explicit history origin navigation and unchanged tender projection; other products business is not tested'
  }
  phase = 'restart-durable-history'
  await page.close()
  child.kill('SIGTERM')
  if (child.exitCode === null) await Promise.race([new Promise(ok => child.once('exit', ok)), new Promise(ok => setTimeout(ok, 3000))])
  assert.notEqual(child.exitCode, null, 'Isolated host must stop before restart')
  output = ''
  child = spawn(process.execPath, [bin, '--profile', 'web', '--port', String(port), '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(origin)).status < 500) break } catch {}
    await new Promise(ok => setTimeout(ok, 250))
  }
  const restartPage = await browser.newPage()
  restartPage.on('pageerror', e => errors.push(e.message))
  await restartPage.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const restartUrls = output.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s\x1b]*/g) || []
  const restartLaunch = restartUrls.find(u => new URL(u).port === String(port) && u.includes('?')) || origin
  await restartPage.goto(restartLaunch)
  await restartPage.waitForFunction(() => window.__tenderNativeProbe?.sessions)
  await restartPage.evaluate(async id => { const ctx = window.__tenderNativeProbe; await ctx.sessions.refresh(); ctx.sessions.open(id) }, ordinary)
  await restartPage.waitForFunction(id => window.__tenderNativeProbe.sessions.list.getSnapshot().current === id, ordinary)
  const recovered = await restartPage.evaluate(async id => {
    const response = await fetch('/dsh-tender-workbench/api/v1/history', { headers: { 'X-Dsh-Tender-Session': id } })
    if (!response.ok) throw Error('Restart history HTTP ' + response.status)
    return response.json()
  }, ordinary)
  assert.deepEqual(recovered, history, 'Profile metadata survives real host restart before reopening business A')
  report.restartDurableHistory = 'PASS'
  await restartPage.evaluate(id => window.__tenderNativeProbe.sessions.open(id), session)
  await restartPage.waitForFunction(id => window.__tenderNativeProbe.sessions.list.getSnapshot().current === id, session)
  assert.equal(await restartPage.evaluate(id => window.__tenderNativeProbe.conversation.input.shell(id).state.getSnapshot().draft, session), '', 'Host restart must not refill a cleared old business Session')
  report.initialDraft.restartNotRefilled = true
  assert.deepEqual(errors, [])
  report.status = 'PASS'; report.nativeEntry = 'PASS'; report.ordinaryAndRestore = 'PASS'
  console.log(JSON.stringify(report, null, 2))
  await writeFile(join(home, 'result.json'), JSON.stringify(report, null, 2))
  }
} catch (error) {
  report.status = 'FAIL'; report.phase = phase; report.error = error.message.replace(/https?:\/\/\S+/g, '[url]')
  await writeFile(join(home, 'result.json'), JSON.stringify(report, null, 2))
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0]
    if (page) { console.log('Synthetic UI labels:', await page.locator('button,a[aria-label],h1,h2').allTextContents()); await page.screenshot({ path: join(home, 'failure.png') }) }
  }
  throw new Error('Isolated smoke failed at ' + phase + ': ' + error.message.replace(/https?:\/\/\S+/g, '[url]') + '; isolated home=' + home)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  if (child.exitCode === null) await Promise.race([new Promise(ok => child.once('exit', ok)), new Promise(ok => setTimeout(ok, 3000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
