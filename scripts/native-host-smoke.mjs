// Real DSH + untouched npm tarball; the separate diagnostic plugin is test-only.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'

const root = process.cwd(), bin = resolve(process.env.TENDER_DSH_BIN || '')
assert.ok(process.env.TENDER_DSH_BIN, 'Provide an explicit DSH 0.1.2-rc.1 bin; never bootstrap a production profile')
const { chromium } = await import(pathToFileURL(process.env.TENDER_PLAYWRIGHT).href)
const home = await mkdtemp(join(tmpdir(), 'tender-native-'))
const profile = join(home, 'profiles/web'), workspace = join(home, 'synthetic-workspace')
const npmCache = process.env.TENDER_NPM_CACHE || join(home, 'npm-cache')
await mkdir(profile, { recursive: true }); await mkdir(workspace)
const env = { PATH: process.env.PATH, HOME: home, DSH_HOME: home, TMPDIR: tmpdir(), NO_COLOR: '1' }
const hostVersion = execFileSync(process.execPath, [bin, '--version'], { cwd: workspace, env, encoding: 'utf8' }).trim()
assert.equal(hostVersion, '0.1.2-rc.1')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', home, '--cache', join(home, 'npm-cache')], { cwd: root, stdio: 'pipe' })
const tarball = join(home, pkg.name + '-' + pkg.version + '.tgz')
const tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
const probe = join(home, 'probe')
await mkdir(probe)
await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'tender-isolated-probe', version: '0.0.0', type: 'module', main: 'index.js', exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' }, dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [] } } }))
await writeFile(join(probe, 'index.js'), 'export function apply() {}')
await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - name: tender-isolated-probe\n')
await writeFile(join(probe, 'client.js'), 'window.__ModuleLoader__.load({id:"tender-isolated-probe",factory:()=>({inject:["uiConversation","sessions","workspaces","modules","betterSidebar"],apply(ctx){window.__tenderNativeProbe=ctx;}})});')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'tender-isolated-profile', version: '0.0.0', private: true, type: 'module',
  dependencies: { [pkg.name]: 'file:' + tarball, 'dsh-better-sidebar': '0.18.1', 'tender-isolated-probe': 'file:' + probe, ...(process.env.TENDER_TEST_CONTEXT === '1' ? { 'dsh-context': '0.48.0' } : {}) },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-better-sidebar', pkg.name, 'tender-isolated-probe', ...(process.env.TENDER_TEST_CONTEXT === '1' ? ['dsh-context'] : [])] } } }))
execFileSync('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--cache', npmCache], { cwd: profile, env, stdio: 'pipe' })
const installed = await readFile(join(profile, 'node_modules', pkg.name, 'lib/client.js'), 'utf8')
assert.ok(!installed.includes('@deepseek-ai/dsh-client-runtime/client'), 'Packed code contains removed module')
assert.ok(!installed.includes('conversationEvents'), 'Packed code contains removed service')
const reservation = createServer()
await new Promise(ok => reservation.listen(0, '127.0.0.1', ok))
const port = reservation.address().port
await new Promise(ok => reservation.close(ok))
assert.notEqual(port, 3080)
const origin = 'http://127.0.0.1:' + port
const child = spawn(process.execPath, [bin, '--profile', 'web', '--port', String(port), '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser, phase = 'startup'
child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
const report = { package: pkg.name, version: pkg.version, hostVersion, sidebar: '0.18.1', context: process.env.TENDER_TEST_CONTEXT === '1' ? '0.48.0' : 'absent', node: process.version, home, port, tarball, tarballSha256, productionProfileUsed: false, realMcp: 'NOT_TESTED' }
try {
  let ready = false
  for (let i = 0; i < 160; i++) {
    try { ready = (await fetch(origin)).status < 500 } catch {}
    if (ready || child.exitCode !== null) break
    await new Promise(ok => setTimeout(ok, 250))
  }
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
  await page.evaluate(path => window.__tenderNativeProbe.workspaces.create({ path }), workspace)
  phase = 'entry'
  await page.getByRole('button', { name: '新建招投标会话', exact: true }).click()
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor()
  const session = await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().current)
  const sessionIdsBefore = await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().ids)
  assert.ok(session.startsWith('session-dsh-tender-workbench-'))
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
  phase = 'five-flows'
  for (const label of ['找机会', '筛候选', '人工定案', '形成交付', '任务历史']) {
    const button = page.getByRole('navigation', { name: '招投标快捷导航' }).getByRole('button', { name: label, exact: true })
    await button.click(); await button.click()
    await page.waitForFunction(() => !!window.__tenderNativeProbe.betterSidebar.getSnapshot().state)
    if (label === '任务历史') await page.getByRole('heading', { name: label, exact: true }).waitFor()
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
  phase = 'ordinary-session'
  assert.deepEqual(await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().ids), sessionIdsBefore, 'Navigation must not create Sessions')
  await page.getByRole('button', { name: /新会话|新建会话/ }).first().click()
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor({ state: 'hidden' })
  const ordinary = await page.evaluate(() => window.__tenderNativeProbe.sessions.list.getSnapshot().current)
  assert.notEqual(ordinary, session)
  await page.evaluate(id => window.__tenderNativeProbe.sessions.open(id), session)
  await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  report.status = 'PASS'; report.nativeEntry = 'PASS'; report.ordinaryAndRestore = 'PASS'
  console.log(JSON.stringify(report, null, 2))
  await writeFile(join(home, 'result.json'), JSON.stringify(report, null, 2))
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0]
    if (page) { console.log('Synthetic UI labels:', await page.locator('button,h1,h2').allTextContents()); await page.screenshot({ path: join(home, 'failure.png') }) }
  }
  throw new Error('Isolated smoke failed at ' + phase + ': ' + error.message.replace(/https?:\/\/\S+/g, '[url]') + '; isolated home=' + home)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  if (child.exitCode === null) await Promise.race([new Promise(ok => child.once('exit', ok)), new Promise(ok => setTimeout(ok, 3000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
