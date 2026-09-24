// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initOptions } from '../src/options.js'
import { fakeChrome, settle } from './fake-chrome.js'
import { fakeDocument } from './fake-document.js'

const IDS = ['server', 'status', 'form', 'reset']
const submit = (el) => el.form.events.submit({ preventDefault() {} })

async function page(chrome = fakeChrome()) {
  const doc = fakeDocument(IDS)
  await initOptions(doc, chrome)
  return { el: doc.elements, chrome }
}

test('the page shows the server, and a new one is saved once access is given', async () => {
  const { el, chrome } = await page()
  assert.equal(el.server.value, 'https://app.agentrq.com')

  let prevented = false
  el.server.value = 'agentrq.example.com/'
  await el.form.events.submit({ preventDefault: () => (prevented = true) })
  assert.ok(prevented, 'the form does not navigate')
  assert.deepEqual(chrome.calls[0], ['permissions.request', ['https://agentrq.example.com/*']])
  assert.equal(el.server.value, 'https://agentrq.example.com', 'what was stored is shown')
  assert.equal(chrome.storage.sync.data.serverUrl, 'https://agentrq.example.com')
  assert.match(el.status.textContent, /Saved/)
  assert.equal(el.status.className, '')
  assert.ok(!chrome.calls.some(([name]) => name === 'permissions.remove'), 'the hosted server’s access is not given back')
})

test('moving between self-hosted servers gives the old one’s access back', async () => {
  const { el, chrome } = await page()
  el.server.value = 'https://one.example.com'
  await submit(el)
  el.server.value = 'https://one.example.com/team'
  await submit(el)
  assert.ok(!chrome.calls.some(([name]) => name === 'permissions.remove'), 'same origin, same access')
  el.server.value = 'https://two.example.com'
  await submit(el)
  assert.deepEqual(chrome.calls.at(-1), ['permissions.remove', ['https://one.example.com/*']])
  assert.ok(!chrome.permissions.granted.has('https://one.example.com/*'))

  await el.reset.events.click()
  assert.equal(chrome.storage.sync.data.serverUrl, 'https://app.agentrq.com')
  assert.deepEqual(chrome.calls.at(-1), ['permissions.remove', ['https://two.example.com/*']])
})

test('nothing is saved when the address is wrong or access is refused', async () => {
  const { el, chrome } = await page(fakeChrome({ allow: false }))
  el.server.value = 'ftp://x'
  await submit(el)
  assert.match(el.status.textContent, /https:\/\/ or http:\/\//)
  assert.equal(el.status.className, 'error')
  assert.deepEqual(chrome.calls, [], 'a bad address asks for nothing')

  el.server.value = 'https://agentrq.example.com'
  await submit(el)
  assert.match(el.status.textContent, /Without access to agentrq\.example\.com/)
  assert.equal(chrome.storage.sync.data.serverUrl, undefined)
})

test('the page sets itself up from its entry point', async () => {
  const doc = fakeDocument(IDS)
  globalThis.document = doc
  globalThis.chrome = fakeChrome()
  try {
    await import('../src/options-page.js')
    await settle()
  } finally {
    delete globalThis.document
    delete globalThis.chrome
  }
  assert.equal(typeof doc.elements.form.events.submit, 'function')
  assert.equal(doc.elements.server.value, 'https://app.agentrq.com')
})
