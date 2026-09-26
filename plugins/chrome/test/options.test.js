// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initOptions } from '../src/options.js'
import { ALL_SITES } from '../src/settings.js'
import { fakeChrome, settle } from './fake-chrome.js'
import { fakeDocument } from './fake-document.js'

const IDS = ['server', 'status', 'form', 'reset', 'detect', 'shares', 'none']
const submit = (el) => el.form.events.submit({ preventDefault() {} })
const workspaces = async () => ({ status: 200, ok: true, json: async () => ({ workspaces: [{ id: 'ws1', name: 'Alpha' }] }) })

async function page(chrome = fakeChrome(), fetchImpl = workspaces) {
  const doc = fakeDocument(IDS)
  await initOptions(doc, chrome, fetchImpl)
  await settle()
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
  const saved = globalThis.fetch
  globalThis.document = doc
  globalThis.chrome = fakeChrome()
  globalThis.fetch = workspaces
  try {
    await import('../src/options-page.js')
    await settle()
  } finally {
    delete globalThis.document
    delete globalThis.chrome
    globalThis.fetch = saved
  }
  assert.equal(typeof doc.elements.form.events.submit, 'function')
  assert.equal(doc.elements.server.value, 'https://app.agentrq.com')
})

const share = (workspaceId) => ({ workspaceId, lastUrl: 'https://x/', tools: [], alwaysAllow: [], pending: false })

test('shared websites are listed with their workspace, and Stop stops one', async () => {
  const chrome = fakeChrome()
  await chrome.storage.local.set({ shares: { 'https://github.com': share('ws1'), 'https://b.com': share('gone') } })
  const { el } = await page(chrome)
  const rows = () => el.shares.children.map((li) => li.children.map((c) => c.textContent))
  assert.equal(el.none.hidden, true)
  assert.deepEqual(rows(), [
    ['https://github.com', 'Alpha', 'Stop'],
    ['https://b.com', 'a workspace', 'Stop'],
  ])
  assert.equal(el.shares.children[0].children[2].type, 'button')

  el.shares.children[0].children[2].events.click()
  await settle()
  assert.deepEqual(Object.keys(chrome.storage.local.data.shares), ['https://b.com'])
  assert.deepEqual(rows(), [['https://b.com', 'a workspace', 'Stop']])

  // A share dropped elsewhere, by the popup or a reconcile, leaves the list too.
  await chrome.storage.local.set({ shares: {} })
  await chrome.storage.sync.set({ other: 1 })
  assert.deepEqual(rows(), [])
  assert.equal(el.none.hidden, false)
})

test('signed out, shares still list, without their workspace’s name', async () => {
  const chrome = fakeChrome()
  await chrome.storage.local.set({ shares: { 'https://github.com': share('ws1') } })
  const { el } = await page(chrome, async () => ({ status: 401, ok: false }))
  assert.equal(el.shares.children[0].children[1].textContent, 'a workspace')
})

test('the detection toggle asks for every site in the click, and gives it back', async () => {
  const { el, chrome } = await page()
  assert.equal(el.detect.checked, false)

  el.detect.checked = true
  const asked = el.detect.events.change()
  assert.deepEqual(chrome.calls.at(-1), ['permissions.request', ALL_SITES], 'asked before anything is awaited')
  await asked
  assert.equal(el.detect.checked, true)

  el.detect.checked = false
  await el.detect.events.change()
  assert.deepEqual(chrome.calls.at(-1), ['permissions.remove', ALL_SITES])
  assert.equal(el.detect.checked, false)
})

test('a refused grant unticks the toggle, and a grant from the popup ticks it', async () => {
  const chrome = fakeChrome({ allow: false })
  const { el } = await page(chrome)
  el.detect.checked = true
  await el.detect.events.change()
  assert.equal(el.detect.checked, false)

  for (const o of ALL_SITES) chrome.permissions.granted.add(o)
  chrome.permissions.onAdded.fire({ origins: ALL_SITES })
  await settle()
  assert.equal(el.detect.checked, true)
  for (const o of ALL_SITES) chrome.permissions.granted.delete(o)
  chrome.permissions.onRemoved.fire({ origins: ALL_SITES })
  await settle()
  assert.equal(el.detect.checked, false)
})
