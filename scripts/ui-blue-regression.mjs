// Real React/Chromium, isolated fixture. TENDER_UI_DEPS: react/react-dom/esbuild.
// TENDER_PLAYWRIGHT: playwright directory; TENDER_CHROME: optional executable.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const deps = resolve(process.env.TENDER_UI_DEPS || 'node_modules')
const { build } = await import(pathToFileURL(join(deps, 'esbuild/lib/main.js')))
const { chromium } = await import(pathToFileURL(join(resolve(process.env.TENDER_PLAYWRIGHT || join(deps, 'playwright')), 'index.mjs')))
const out = resolve('_scratch/ui-blue')
await mkdir(out, { recursive: true })
await build({ entryPoints: ['scripts/tender-ui-fixture.tsx'], bundle: true, outdir: out, format: 'iife',
  jsx: 'automatic', loader: { '.module.css': 'local-css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  alias: { react: join(deps, 'react'), 'react-dom': join(deps, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"development"' } })
const js = await readFile(join(out, 'tender-ui-fixture.js'), 'utf8')
const css = await readFile(join(out, 'tender-ui-fixture.css'), 'utf8')
const browser = await chromium.launch({ headless: true, ...(process.env.TENDER_CHROME ? { executablePath: process.env.TENDER_CHROME } : {}) })
const results = []
try {
  for (const scheme of ['light', 'dark']) for (const [width, height] of [[1440,900],[1024,768],[390,700],[900,500]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => { errors.push('unexpected network: '+route.request().url()); return route.abort() })
    await page.setContent(`<html style="color-scheme:${scheme}"><head><style>
      body{margin:0;font:14px/1.6 "PingFang SC",sans-serif;color:light-dark(#202c3b,#e7eef6);background:light-dark(#f6f8fa,#101820)}
      *{box-sizing:border-box}button{cursor:pointer;font:inherit} .fixtureToolbar{height:40px;display:flex;gap:20px;padding:4px 16px;font-size:12px}
      .fixtureLayout{display:flex;height:calc(100dvh - 40px)}.fixtureSidebar{width:180px;flex:none;padding:16px;border-right:1px solid #8884}
      main{flex:1;min-width:0;overflow:auto;padding:60px 24px}[data-composer-seat]{max-width:800px;margin:auto}
      .nativeHeadline{display:flex;justify-content:center;align-items:center;gap:12px;margin-bottom:32px;font-size:28px;font-weight:600}.preview{font-size:12px}
      [data-composer-card]{position:relative;border:1px solid #8885;border-radius:20px;padding:16px;background:light-dark(#fff,#18232e)}
      #nativeInput{width:100%;height:100px;resize:none;background:transparent;color:inherit;border:0;font:16px/1.6 inherit}
      .nativeTools{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#8993a0}.nativeTools button{background:#507fe8;color:#fff;border:0;border-radius:8px;padding:8px}
      .fixtureWorkbench{width:46%;min-width:360px;height:100%;display:grid;grid-template-rows:40px minmax(0,1fr);border-left:1px solid #8885}
      .fixtureBenchChrome{display:flex;justify-content:space-between;align-items:center;padding:4px 12px;background:light-dark(#fff,#18232e)}
      @media(max-width:700px){.fixtureSidebar{display:none}main{padding:48px 16px}.fixtureWorkbench{position:fixed;inset:40px 0 0;width:100%;min-width:0;height:calc(100dvh - 40px)}}
      ${css}</style></head><body><div id="root"></div></body></html>`)
    await page.addScriptTag({ content: js })
    await page.getByRole('heading', { name: '招投标智能体', exact: true }).waitFor()
    const logo = await page.locator('[data-dsh-tender-hero] svg').boundingBox()
    const heading = await page.getByRole('heading', { name: '招投标智能体', exact: true }).boundingBox()
    assert.ok(Math.abs(logo.y+logo.height/2-heading.y-heading.height/2)<2, 'icon/title same row')
    const card = await page.locator('[data-composer-card]').boundingBox()
    const menu = await page.getByRole('navigation', { name: '招投标快捷导航' }).boundingBox()
    assert.ok(menu.y>=card.y+card.height, 'navigation below native composer')
    assert.equal(await page.locator('.nativeHeadline').isVisible(), false)
    await page.screenshot({ path: join(out, `${scheme}-${width}x${height}-home.png`) })
    await page.getByRole('button', { name: '提示词生成', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    const box = await dialog.boundingBox()
    assert.ok(box.x>=0 && box.y>=0 && box.y+box.height<=height, 'dialog fits viewport')
    await page.getByLabel('关键词', { exact: false }).fill('智慧园区')
    await page.getByRole('button', { name: '回填输入框' }).focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭提示词向导')
    await page.screenshot({ path: join(out, `${scheme}-${width}x${height}-wizard.png`) })
    const action = await page.getByRole('button', { name: '回填输入框' }).evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
    assert.equal(action.background, scheme==='light' ? 'rgb(8, 117, 209)' : 'rgb(130, 195, 255)')
    await page.getByRole('button', { name: '回填输入框' }).click()
    assert.match(await page.locator('#nativeInput').inputValue(), /智慧园区/)
    assert.equal(await page.locator('#send').isEnabled(), true)
    await page.getByRole('button', { name: /规则筛选/ }).click()
    await page.getByRole('tab', { name: '筛候选', exact: true }).waitFor()
    assert.equal(await page.getByRole('tab', { name: '筛候选', exact: true }).getAttribute('aria-selected'), 'true')
    await page.getByRole('tab', { name: '找机会', exact: true }).click()
    await page.screenshot({ path: join(out, `${scheme}-${width}x${height}-workbench.png`) })
    const shell = await page.locator('[data-visual-shell]').evaluate(el => ({width:el.clientWidth, scroll:el.scrollWidth, background:getComputedStyle(el).backgroundColor}))
    assert.ok(shell.scroll<=shell.width+1, 'no workbench horizontal overflow')
    assert.equal(shell.background, scheme==='light' ? 'rgb(255, 255, 255)' : 'rgb(24, 35, 46)')
    await page.locator('#closeBench').click()
    await page.getByRole('button', { name: '提示词生成', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal(await dialog.count(), 0)
    await page.locator('#ordinary').click()
    assert.equal(await page.locator('.nativeHeadline').isVisible(), true)
    assert.equal(await page.locator('[data-dsh-tender-hero]').count(), 0)
    assert.equal(await page.getByRole('navigation', { name: '招投标快捷导航' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '提示词生成', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    results.push({ scheme, width, height, passed:true })
    await page.close()
    console.log('PASS', scheme, width, height)
  }
} finally {
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
assert.equal(results.length, 8)
