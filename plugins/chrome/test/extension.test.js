// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { FULL_SIZE, install } from '../src/extension.js'
import { fakeChrome, settle } from './fake-chrome.js'

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))

const installed = () => {
  const chrome = fakeChrome()
  const errors = []
  install(chrome, { error: (...args) => errors.push(args) })
  return { chrome, errors, opened: () => chrome.calls.filter(([name]) => name === 'windows.create').length }
}

test('installing puts full size on the toolbar button’s right-click menu', async () => {
  const { chrome } = installed()
  chrome.contextMenus.items.push({ id: 'left over from the last version' })
  chrome.runtime.onInstalled.fire()
  await settle()
  assert.deepEqual(chrome.contextMenus.items, [{ id: FULL_SIZE, title: 'Open full size', contexts: ['action'] }])
})

test('the menu item and the shortcut open full size, and nothing else does', async () => {
  const { chrome, opened } = installed()
  chrome.contextMenus.onClicked.fire({ menuItemId: FULL_SIZE })
  chrome.commands.onCommand.fire(FULL_SIZE)
  chrome.contextMenus.onClicked.fire({ menuItemId: 'somebody else’s' })
  chrome.commands.onCommand.fire('not-ours')
  await settle()
  assert.equal(opened(), 2)
})

test('the shortcut the manifest declares is the one handled', () => {
  assert.deepEqual(Object.keys(manifest.commands).sort(), ['_execute_action', FULL_SIZE])
})

test('a failure is logged rather than lost', async () => {
  const { chrome, errors } = installed()
  chrome.windows.getAll = async () => {
    throw new Error('no windows')
  }
  chrome.commands.onCommand.fire(FULL_SIZE)
  await settle()
  assert.equal(errors.length, 1)
  assert.match(String(errors[0][1]), /no windows/)
})

test('the service worker installs itself on the real chrome object', async () => {
  const chrome = fakeChrome()
  globalThis.chrome = chrome
  try {
    await import('../src/background.js')
  } finally {
    delete globalThis.chrome
  }
  assert.equal(chrome.commands.onCommand.listeners.length, 1)
})
