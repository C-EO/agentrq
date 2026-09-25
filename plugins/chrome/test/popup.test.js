// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initPopup } from '../src/popup.js'
import { fakeChrome, settle } from './fake-chrome.js'
import { fakeDocument } from './fake-document.js'

const IDS = ['app', 'message', 'text', 'action', 'options', 'full']
const answer = (status) => async () => ({ status, ok: status < 300 })

async function open({ status = 200, chrome = fakeChrome({ windows: [{ type: 'normal', focused: true }] }), fetchImpl } = {}) {
  const doc = fakeDocument(IDS)
  let closed = 0
  await initPopup({ doc, chrome, fetchImpl: fetchImpl ?? answer(status), close: () => closed++ })
  return { doc, chrome, el: doc.elements, closed: () => closed }
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
  Object.assign(globalThis, { document: doc, chrome: fakeChrome({ windows: [{ type: 'normal' }] }), fetch: answer(200), close: () => closed++ })
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
