// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { share } from '../src/shares.js'
import { BACKOFF, KEEPALIVE, createSocket } from '../src/socket.js'
import { fakeChrome, fakeTimers, fakeWebSocketClass, settle } from './fake-chrome.js'

const SERVER = 'https://app.agentrq.com'

// A server whose ticket endpoint answers from `statuses`, one per request,
// and 200 when they run out.
const fakeServer = (statuses = []) => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push([url.replace(SERVER, ''), init.method, init.credentials])
    const status = statuses.length ? statuses.shift() : 200
    return { status, ok: status < 300, json: async () => ({ ticket: 'tk t', expiresIn: 60 }) }
  }
  return { requests, fetchImpl }
}

const setup = async ({ shared = true, statuses, server = SERVER } = {}) => {
  const chrome = fakeChrome()
  if (shared) await share(chrome, 'https://github.com', 'ws1', 'https://github.com')
  await chrome.storage.local.set({ browserId: 'b-1' })
  const timers = fakeTimers()
  const WebSocketImpl = fakeWebSocketClass()
  const { requests, fetchImpl } = fakeServer(statuses)
  const frames = []
  const errors = []
  let opens = 0
  const socket = createSocket({
    chrome,
    fetchImpl,
    WebSocketImpl,
    timers,
    getServer: async () => server,
    onFrame: (f) => frames.push(f),
    onOpen: () => opens++,
    log: { error: (...args) => errors.push(args) },
  })
  return { chrome, timers, socket, sockets: WebSocketImpl.sockets, requests, frames, errors, opens: () => opens }
}

test('nothing shared, nothing opened', async () => {
  const { socket, sockets, requests } = await setup({ shared: false })
  await socket.ensure()
  assert.equal(sockets.length, 0)
  assert.equal(requests.length, 0)
  assert.equal(socket.send({ type: 'ping' }), false)
})

test('it opens with a ticket fetched with the cookie, once however often it is asked', async () => {
  const { socket, sockets, requests, opens } = await setup()
  await Promise.all([socket.ensure(), socket.ensure()])
  await socket.ensure()
  assert.deepEqual(requests, [['/api/v1/browser/ticket', 'POST', 'include']])
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].url, 'wss://app.agentrq.com/api/v1/browser/connect?ticket=tk%20t&browser=b-1')
  assert.equal(socket.send({ type: 'x' }), false)
  sockets[0].open()
  assert.equal(opens(), 1)
  assert.equal(socket.send({ type: 'announce' }), true)
  assert.deepEqual(sockets[0].sent, [{ type: 'announce' }])
})

test('a local server gets a plain ws:// socket', async () => {
  const { socket, sockets } = await setup({ server: 'http://localhost:3000' })
  await socket.ensure()
  assert.match(sockets[0].url, /^ws:\/\/localhost:3000\/api\/v1\/browser\/connect\?/)
})

test('an expired access token is refreshed once', async () => {
  const { socket, sockets, requests } = await setup({ statuses: [401, 200] })
  await socket.ensure()
  assert.deepEqual(
    requests.map(([path]) => path),
    ['/api/v1/browser/ticket', '/api/v1/auth/refresh', '/api/v1/browser/ticket'],
  )
  assert.equal(sockets.length, 1)
})

test('frames are handed on, and one that is not JSON is logged', async () => {
  const { socket, sockets, frames, errors } = await setup()
  await socket.ensure()
  sockets[0].receive({ type: 'shares', shares: [] })
  sockets[0].receive('not json')
  assert.deepEqual(frames, [{ type: 'shares', shares: [] }])
  assert.equal(errors.length, 1)
})

test('it reconnects with backoff 1, 2, 5, 15 and 30 seconds, then stays at 30', async () => {
  // Signed out: the refresh fails and so does every ticket after it.
  const { socket, sockets, timers, errors } = await setup({ statuses: Array(20).fill(401) })
  const delays = []
  await socket.ensure()
  for (let i = 0; i < 7; i++) {
    delays.push(timers.delays()[0])
    timers.advance(delays.at(-1))
    await settle()
  }
  assert.deepEqual(delays, [...BACKOFF, 30e3, 30e3])
  assert.equal(sockets.length, 0)
  assert.match(String(errors[0][1]), /refused a browser ticket \(401\)/)
  // A retry already waiting is not doubled by another ensure.
  await socket.ensure()
  assert.equal(timers.delays().length, 1)
})

test('a dropped socket reconnects, and an open one resets the backoff', async () => {
  const { socket, sockets, timers, opens } = await setup()
  await socket.ensure()
  sockets[0].drop()
  assert.deepEqual(timers.delays(), [1e3])
  timers.advance(1e3)
  await settle()
  sockets[1].drop()
  assert.deepEqual(timers.delays(), [2e3])
  timers.advance(2e3)
  await settle()
  sockets[2].open()
  sockets[2].drop()
  assert.deepEqual(timers.delays(), [1e3])
  assert.equal(opens(), 1)
})

test('it stops reconnecting once nothing is shared', async () => {
  const { chrome, socket, sockets, timers } = await setup()
  await socket.ensure()
  await chrome.storage.local.set({ shares: {} })
  sockets[0].drop()
  timers.advance(1e3)
  await settle()
  assert.equal(sockets.length, 1)
  assert.deepEqual(timers.delays(), [])
})

test('an open socket sends a keepalive so Chrome keeps the worker', async () => {
  const { socket, sockets, timers } = await setup()
  await socket.ensure()
  sockets[0].open()
  timers.advance(KEEPALIVE * 2)
  assert.deepEqual(sockets[0].sent, [{ type: 'ping' }, { type: 'ping' }])
  sockets[0].drop()
  timers.advance(KEEPALIVE)
  assert.equal(sockets[0].sent.length, 2)
})

test('close shuts the socket for good, and stops a connect under way', async () => {
  const { socket, sockets, timers } = await setup()
  await socket.ensure()
  sockets[0].open()
  socket.close()
  socket.close()
  assert.equal(sockets[0].closed, true)
  assert.deepEqual(timers.delays(), [])
  assert.equal(timers.pending.size, 0)

  const connecting = socket.ensure()
  socket.close()
  await connecting
  assert.equal(sockets.length, 1)
})

test('a failure after close does not schedule a retry', async () => {
  const { socket, timers } = await setup({ statuses: [500] })
  const connecting = socket.ensure()
  socket.close()
  await connecting
  assert.deepEqual(timers.delays(), [])
})
