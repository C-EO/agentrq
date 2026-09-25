// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { openFullSize } from '../src/fullsize.js'
import { fakeChrome } from './fake-chrome.js'

const browser = { type: 'normal', url: 'https://example.com' }

test('full size is a tab in the window being used', async () => {
  const chrome = fakeChrome({ windows: [browser, { ...browser, focused: true }] })
  const focused = [...chrome.all.values()].find((w) => w.focused).id
  await openFullSize(chrome)
  assert.deepEqual(chrome.calls, [
    ['tabs.create', { windowId: focused, url: 'https://app.agentrq.com', active: true }],
    ['windows.update', focused, { focused: true }],
  ])
})

test('with no window focused any browser window will do, and a popup-type one will not', async () => {
  const chrome = fakeChrome({ windows: [{ type: 'popup', focused: true }, browser] })
  const normal = [...chrome.all.values()].find((w) => w.type === 'normal').id
  await openFullSize(chrome, 'https://agentrq.example.com/login')
  assert.deepEqual(chrome.calls[0], ['tabs.create', { windowId: normal, url: 'https://agentrq.example.com/login', active: true }])
})

test('with no browser window it opens one, maximized', async () => {
  const chrome = fakeChrome()
  chrome.storage.sync.data.serverUrl = 'https://agentrq.example.com'
  await openFullSize(chrome)
  assert.deepEqual(chrome.calls, [['windows.create', { url: 'https://agentrq.example.com', type: 'normal', state: 'maximized' }]])
})
