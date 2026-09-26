// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { browserId, listShares, reconcile, refused, remember, share, unshare } from '../src/shares.js'
import { fakeChrome } from './fake-chrome.js'

const GH = 'https://github.com'
const tool = { name: 'getGreeting', description: 'Say hi' }

test('nothing is shared at first', async () => {
  assert.deepEqual(await listShares(fakeChrome()), {})
})

test('a share is kept, pending until the server lists it, and can be stopped', async () => {
  const chrome = fakeChrome()
  await share(chrome, GH, 'ws1', `${GH}/a`, [tool])
  await share(chrome, 'https://example.com', 'ws2', 'https://example.com/')
  assert.deepEqual((await listShares(chrome))[GH], { workspaceId: 'ws1', lastUrl: `${GH}/a`, tools: [tool], alwaysAllow: [], pending: true })
  assert.deepEqual((await listShares(chrome))['https://example.com'].tools, [])

  await unshare(chrome, GH)
  await unshare(chrome, 'https://never.shared')
  assert.deepEqual(Object.keys(await listShares(chrome)), ['https://example.com'])
})

test('a shared site remembers its latest page and tools; another site is not shared by it', async () => {
  const chrome = fakeChrome()
  await share(chrome, GH, 'ws1', `${GH}/a`)
  assert.equal(await remember(chrome, GH, `${GH}/b`, [tool]), true)
  assert.equal(await remember(chrome, 'https://other.com', 'https://other.com/', [tool]), false)
  const shares = await listShares(chrome)
  assert.deepEqual([shares[GH].lastUrl, shares[GH].tools], [`${GH}/b`, [tool]])
  assert.deepEqual(Object.keys(shares), [GH])
})

test('the browser id is made once', async () => {
  const chrome = fakeChrome()
  const id = await browserId(chrome)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(await browserId(chrome), id)
})

// Review Focus 5: a workspace deleted while shared.
test('reconcile drops what the server no longer has, and takes its word for the rest', async () => {
  const chrome = fakeChrome()
  await share(chrome, GH, 'ws1', GH)
  await share(chrome, 'https://gone.com', 'ws-deleted', 'https://gone.com')
  await share(chrome, 'https://moved.com', 'ws1', 'https://moved.com')
  // Confirmed once, so none of them is pending any more.
  await reconcile(chrome, [
    { origin: GH, workspaceId: 'ws1', alwaysAllow: [] },
    { origin: 'https://gone.com', workspaceId: 'ws-deleted', alwaysAllow: [] },
    { origin: 'https://moved.com', workspaceId: 'ws1', alwaysAllow: [] },
  ])
  await reconcile(chrome, [
    { origin: GH, workspaceId: 'ws1', alwaysAllow: ['getGreeting'] },
    { origin: 'https://moved.com', workspaceId: 'ws2' },
  ])
  const shares = await listShares(chrome)
  assert.deepEqual(Object.keys(shares).sort(), [GH, 'https://moved.com'])
  assert.deepEqual(shares[GH], { workspaceId: 'ws1', lastUrl: GH, tools: [], alwaysAllow: ['getGreeting'], pending: false })
  assert.deepEqual([shares['https://moved.com'].workspaceId, shares['https://moved.com'].alwaysAllow], ['ws2', []])
})

// The server's list on connect is taken before it reads our announce.
test('reconcile keeps a share the server has not heard of yet, and ours wins over a stale one', async () => {
  const chrome = fakeChrome()
  await share(chrome, GH, 'ws-new', GH)
  await share(chrome, 'https://new.com', 'ws1', 'https://new.com')
  await reconcile(chrome, [{ origin: GH, workspaceId: 'ws-old', alwaysAllow: ['x'] }])
  await reconcile(chrome)
  const shares = await listShares(chrome)
  assert.deepEqual(Object.keys(shares).sort(), [GH, 'https://new.com'])
  assert.deepEqual([shares[GH].workspaceId, shares[GH].pending, shares[GH].alwaysAllow], ['ws-new', true, []])
})

test('a refusal drops a share the server never had, and only that', async () => {
  const chrome = fakeChrome()
  await share(chrome, GH, 'ws1', GH)
  await share(chrome, 'https://kept.com', 'ws1', 'https://kept.com')
  await reconcile(chrome, [{ origin: 'https://kept.com', workspaceId: 'ws1', alwaysAllow: [] }, { origin: GH, workspaceId: 'ws1' }])
  await share(chrome, 'https://new.com', 'ws1', 'https://new.com')

  await refused(chrome, 'https://new.com')
  await refused(chrome, 'https://kept.com')
  await refused(chrome, 'https://never.shared')
  assert.deepEqual(Object.keys(await listShares(chrome)).sort(), [GH, 'https://kept.com'])
})
