// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initPopup } from '../src/popup.js'
import { fakeChrome, settle } from './fake-chrome.js'
import { fakeDocument } from './fake-document.js'

const IDS = ['app', 'message', 'text', 'action', 'options', 'full', 'strip', 'strip-text', 'strip-workspace', 'strip-action']
const answer = (status) => async () => ({ status, ok: status < 300 })

// The popup's window: it only listens for messages, which `post` delivers.
function fakeWindow() {
  const listeners = []
  return { addEventListener: (type, fn) => type === 'message' && listeners.push(fn), post: (event) => Promise.all(listeners.map((fn) => fn(event))) }
}

async function open({ status = 200, chrome = fakeChrome({ windows: [{ type: 'normal', focused: true }] }), fetchImpl } = {}) {
  const doc = fakeDocument(IDS)
  doc.elements.app.contentWindow = { frame: 'app' }
  const win = fakeWindow()
  let closed = 0
  await initPopup({ doc, win, chrome, fetchImpl: fetchImpl ?? answer(status), close: () => closed++ })
  return { doc, win, chrome, el: doc.elements, closed: () => closed }
}

const click = (el, event = { preventDefault() {} }) => el.events.click(event)

test('signed in, the popup shows the app', async () => {
  const { el } = await open()
  assert.equal(el.app.src, 'https://app.agentrq.com')
  assert.equal(el.app.hidden, false)
  assert.equal(el.message.hidden, true)
})

test('full size opens the app in a tab and closes the popup', async () => {
  const { el, chrome, closed } = await open()
  await click(el.full)
  assert.ok(chrome.calls.some(([name, props]) => name === 'tabs.create' && props.url === 'https://app.agentrq.com'))
  assert.equal(closed(), 1)
})

test('signed out, it offers sign-in in a tab instead of a login it cannot finish', async () => {
  const { el, chrome, closed } = await open({ status: 401 })
  assert.equal(el.app.hidden, true)
  assert.equal(el.app.src, '')
  assert.match(el.text.textContent, /Sign in to AgentRQ in a tab/)
  assert.equal(el.options.hidden, false)
  await click(el.action)
  assert.ok(chrome.calls.some(([name, props]) => name === 'tabs.create' && props.url === 'https://app.agentrq.com/login'))
  assert.equal(closed(), 1)
})

test('an unreachable server can be tried again', async () => {
  let status = 502
  const { el } = await open({ fetchImpl: async () => ({ status, ok: status < 300 }) })
  assert.match(el.text.textContent, /Could not reach app\.agentrq\.com/)
  assert.equal(el.action.textContent, 'Try again')
  status = 200
  await click(el.action)
  assert.equal(el.app.src, 'https://app.agentrq.com')
})

test('without access to the server it sends you to Options rather than show you signed out', async () => {
  const chrome = fakeChrome({ granted: [] })
  chrome.storage.sync.data.serverUrl = 'https://agentrq.example.com'
  let fetched = false
  const { el, closed } = await open({ chrome, fetchImpl: async () => (fetched = true) })
  assert.equal(fetched, false)
  assert.match(el.text.textContent, /needs access to agentrq\.example\.com/)
  assert.equal(el.options.hidden, true, 'no second way to the same place')
  await click(el.action)
  assert.deepEqual(chrome.calls.at(-1), ['runtime.openOptionsPage'])
  assert.equal(closed(), 1)
})

test('the Options link opens Options', async () => {
  const { el, chrome, closed } = await open({ status: 401 })
  let prevented = false
  await click(el.options, { preventDefault: () => (prevented = true) })
  assert.ok(prevented)
  assert.deepEqual(chrome.calls.at(-1), ['runtime.openOptionsPage'])
  assert.equal(closed(), 1)
})

test('the popup sets itself up from its entry point', async () => {
  const doc = fakeDocument(IDS)
  const saved = { document: globalThis.document, chrome: globalThis.chrome, fetch: globalThis.fetch, close: globalThis.close }
  let closed = 0
  saved.addEventListener = globalThis.addEventListener
  Object.assign(globalThis, { document: doc, chrome: fakeChrome({ windows: [{ type: 'normal' }] }), fetch: answer(200), close: () => closed++, addEventListener() {} })
  try {
    await import('../src/popup-page.js')
    await settle()
    assert.equal(doc.elements.app.src, 'https://app.agentrq.com')
    await click(doc.elements.full)
    assert.equal(closed, 1)
  } finally {
    Object.assign(globalThis, saved)
  }
})

test('the site-tools strip sits above the app', async () => {
  const { el } = await open()
  assert.equal(el.app.hidden, false)
  assert.equal(el.strip.hidden, false)
  assert.equal(el['strip-action'].textContent, 'Turn on')
})

const APP = 'https://app.agentrq.com'
const route = (el, path, extra = {}) => ({ source: el.app.contentWindow, origin: APP, data: { type: 'agentrq-route', path }, ...extra })

test('the popup reopens on the page the app last reported, and full size opens it too', async () => {
  const first = await open()
  await first.win.post(route(first.el, '/workspaces/w1/board?filter=ongoing'))
  assert.deepEqual(first.chrome.storage.local.data.popupPage, { server: APP, path: '/workspaces/w1/board?filter=ongoing' })
  await click(first.el.full)
  assert.ok(first.chrome.calls.some(([name, props]) => name === 'tabs.create' && props.url === `${APP}/workspaces/w1/board?filter=ongoing`))

  const again = await open({ chrome: first.chrome })
  assert.equal(again.el.app.src, `${APP}/workspaces/w1/board?filter=ongoing`)
})

test('a page kept for another server is not opened on this one', async () => {
  const chrome = fakeChrome({ windows: [{ type: 'normal', focused: true }] })
  chrome.storage.local.data.popupPage = { server: 'https://agentrq.example.com', path: '/events' }
  const { el } = await open({ chrome })
  assert.equal(el.app.src, APP)
})

test('only the frame, from the server, naming an in-app page, is listened to', async () => {
  const { el, win, chrome } = await open()
  for (const event of [
    route(el, '/a', { source: { frame: 'another' } }),
    route(el, '/a', { origin: 'https://evil.example' }),
    route(el, '/a', { data: { type: 'something-else', path: '/a' } }),
    route(el, '/a', { data: null }),
    route(el, 'https://evil.example/'),
    route(el, '//evil.example/'),
    route(el, 42),
  ]) {
    await win.post(event)
  }
  assert.equal(chrome.storage.local.data.popupPage, undefined)
})
