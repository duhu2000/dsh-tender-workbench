import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const port = Number(process.env.DSH_UI_CDP_PORT ?? 9224)
const command = process.argv[2] ?? 'state'
const args = process.argv.slice(3)

async function findPage() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`)
    return response.json()
  })
  const pages = targets.filter((target) => target.type === 'page')
  const page = pages.find((target) => target.url?.startsWith('http://127.0.0.1:')) ?? pages[0]
  if (!page?.webSocketDebuggerUrl) throw new Error('No reusable browser page was found')
  return page
}

async function connect(url) {
  const socket = new WebSocket(url)
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params)
      return
    }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
  })

  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  return {
    call(method, params = {}) {
      const id = nextId++
      return new Promise((resolveCall, reject) => {
        pending.set(id, { resolve: resolveCall, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    on(method, listener) {
      const current = listeners.get(method) ?? []
      current.push(listener)
      listeners.set(method, current)
    },
    close() {
      socket.close()
    },
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'Page evaluation failed')
  }
  return result.result.value
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const page = await findPage()
const cdp = await connect(page.webSocketDebuggerUrl)

try {
  if (command === 'state') {
    print(await evaluate(cdp, `(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      const describe = (element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().replace(/\\s+/g, ' '),
        ariaLabel: element.getAttribute('aria-label'),
        title: element.getAttribute('title'),
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
      })
      return {
        title: document.title,
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        text: document.body.innerText,
        controls: [...document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"]')]
          .filter(visible)
          .map(describe),
      }
    })()`))
  } else if (command === 'a11y') {
    const tree = await cdp.call('Accessibility.getFullAXTree')
    print(tree.nodes
      .filter((node) => node.name?.value || node.role?.value)
      .map((node) => ({ role: node.role?.value, name: node.name?.value, ignored: node.ignored })))
  } else if (command === 'click-text') {
    const text = args.join(' ').trim()
    if (!text) throw new Error('click-text requires visible control text')
    const value = JSON.stringify(text)
    print(await evaluate(cdp, `(() => {
      const wanted = ${value}
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      const controls = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')].filter(visible)
      const element = controls.find((candidate) =>
        (candidate.innerText || candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '')
          .trim().replace(/\\s+/g, ' ') === wanted)
      if (!element) return { clicked: false, candidates: controls.map((candidate) =>
        (candidate.innerText || candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '').trim().replace(/\\s+/g, ' ')) }
      element.click()
      return { clicked: true, tag: element.tagName.toLowerCase(), text: wanted }
    })()`))
    await new Promise((resolveWait) => setTimeout(resolveWait, 800))
  } else if (command === 'click-selector') {
    const selector = args[0]
    if (!selector) throw new Error('click-selector requires a selector')
    print(await evaluate(cdp, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!element) return { clicked: false }
      element.click()
      return { clicked: true, tag: element.tagName.toLowerCase(), text: (element.innerText || '').trim() }
    })()`))
    await new Promise((resolveWait) => setTimeout(resolveWait, 800))
  } else if (command === 'viewport') {
    const width = Number(args[0])
    const height = Number(args[1])
    if (!width || !height) throw new Error('viewport requires width and height')
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    print({ width, height })
  } else if (command === 'screenshot') {
    const output = resolve(args[0])
    const width = Number(args[1])
    const height = Number(args[2])
    if (!args[0] || !width || !height) throw new Error('screenshot requires path, width, and height')
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 700))
    const capture = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, Buffer.from(capture.data, 'base64'))
    print({ output, width, height })
  } else if (command === 'screenshot-selector') {
    const output = resolve(args[0])
    const selector = args[1]
    if (!args[0] || !selector) throw new Error('screenshot-selector requires a path and selector')
    const clip = await evaluate(cdp, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: Math.max(0, rect.y), width: rect.width, height: Math.min(rect.height, innerHeight - Math.max(0, rect.y)), scale: 1 }
    })()`)
    if (clip === null || clip.width <= 0 || clip.height <= 0) throw new Error(`No visible element matched ${selector}`)
    const capture = await cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip,
    })
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, Buffer.from(capture.data, 'base64'))
    print({ output, selector, width: clip.width, height: clip.height })
  } else if (command === 'navigate') {
    const url = args[0]
    if (!url) throw new Error('navigate requires a URL')
    await cdp.call('Page.navigate', { url })
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))
    print({ url })
  } else if (command === 'drag') {
    const fromX = Number(args[0])
    const fromY = Number(args[1])
    const toX = Number(args[2])
    const toY = Number(args[3])
    if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
      throw new Error('drag requires fromX, fromY, toX, and toY')
    }
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: fromX, y: fromY,
    })
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1,
    })
    for (let step = 1; step <= 8; step += 1) {
      const ratio = step / 8
      await cdp.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: fromX + ((toX - fromX) * ratio),
        y: fromY + ((toY - fromY) * ratio),
        button: 'left',
        buttons: 1,
      })
    }
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    print({ fromX, fromY, toX, toY })
  } else if (command === 'wheel') {
    const x = Number(args[0])
    const y = Number(args[1])
    const deltaY = Number(args[2])
    if (![x, y, deltaY].every(Number.isFinite)) throw new Error('wheel requires x, y, and deltaY')
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX: 0, deltaY,
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))
    print({ x, y, deltaY })
  } else if (command === 'watch-click-text') {
    const text = args[0]?.trim()
    const waitMs = Number(args[1] ?? 3000)
    if (!text || !Number.isFinite(waitMs)) throw new Error('watch-click-text requires text and optional waitMs')
    const events = []
    const relevant = (url) => url?.includes('/dsh-tender-workbench/api/')
    cdp.on('Network.requestWillBeSent', (event) => {
      if (relevant(event.request?.url)) events.push({ type: 'request', id: event.requestId, url: event.request.url })
    })
    cdp.on('Network.responseReceived', (event) => {
      if (relevant(event.response?.url)) events.push({ type: 'response', id: event.requestId, url: event.response.url, status: event.response.status })
    })
    cdp.on('Network.loadingFinished', (event) => {
      if (events.some(item => item.id === event.requestId)) events.push({ type: 'finished', id: event.requestId, bytes: event.encodedDataLength })
    })
    cdp.on('Network.loadingFailed', (event) => {
      if (events.some(item => item.id === event.requestId)) events.push({ type: 'failed', id: event.requestId, error: event.errorText, canceled: event.canceled })
    })
    await cdp.call('Network.enable')
    const click = await evaluate(cdp, `(() => {
      const wanted = ${JSON.stringify(text)}
      const controls = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
      const element = controls.find((candidate) =>
        (candidate.innerText || candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '')
          .trim().replace(/\\s+/g, ' ') === wanted)
      if (!element) return { clicked: false }
      element.click()
      return { clicked: true, tag: element.tagName.toLowerCase(), text: wanted }
    })()`)
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs))
    print({ click, events })
  } else if (command === 'evaluate') {
    const expression = args.join(' ')
    if (!expression) throw new Error('evaluate requires an expression')
    print(await evaluate(cdp, expression))
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
} finally {
  cdp.close()
}
