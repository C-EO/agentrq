// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_SERVER_URL, getServerUrl, normalizeServerUrl, setServerUrl } from '../src/settings.js'
import { fakeChrome } from './fake-chrome.js'

test('a typed address becomes the server to open', () => {
  for (const [typed, want] of [
    ['app.agentrq.com', 'https://app.agentrq.com'],
    ['  https://app.agentrq.com/  ', 'https://app.agentrq.com'],
    ['HTTPS://Agentrq.Example.com/team/', 'https://agentrq.example.com/team'],
    ['localhost:3000', 'http://localhost:3000'],
    ['127.0.0.1:5173/', 'http://127.0.0.1:5173'],
    ['[::1]:3000', 'http://[::1]:3000'],
    ['http://192.168.1.20:3000', 'http://192.168.1.20:3000'],
  ]) {
    assert.equal(normalizeServerUrl(typed), want, typed)
  }
})

test('an address that is not a web server is refused, saying why', () => {
  for (const [typed, why] of [
    ['', /Enter the address/],
    [undefined, /Enter the address/],
    ['https://', /not a web address/],
    ['javascript://alert(1)', /https:\/\/ or http:\/\//],
    ['ftp://files.example.com', /https:\/\/ or http:\/\//],
    ['https://me:secret@app.agentrq.com', /user name and password/],
  ]) {
    assert.throws(() => normalizeServerUrl(typed), why, String(typed))
  }
})

test('the stored server is opened, and the hosted one when there is none', async () => {
  const chrome = fakeChrome()
  assert.equal(await getServerUrl(chrome), DEFAULT_SERVER_URL)

  chrome.storage.sync.data.serverUrl = 'javascript:alert(1)'
  assert.equal(await getServerUrl(chrome), DEFAULT_SERVER_URL, 'a bad stored value is not opened')

  assert.equal(await setServerUrl(chrome, 'agentrq.example.com/'), 'https://agentrq.example.com')
  assert.equal(chrome.storage.sync.data.serverUrl, 'https://agentrq.example.com')
  assert.equal(await getServerUrl(chrome), 'https://agentrq.example.com')

  await assert.rejects(setServerUrl(chrome, 'ftp://x'))
  assert.equal(chrome.storage.sync.data.serverUrl, 'https://agentrq.example.com', 'a refused value is not stored')
})
