// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSignedIn } from '../src/session.js'

// A server that answers each path with the next status in its list.
function server(answers) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push([url.replace('https://s', ''), init.method, init.credentials])
    const path = new URL(url).pathname.split('/').pop()
    return { status: answers[path].shift(), get ok() { return this.status < 300 } }
  }
  return { calls, fetchImpl }
}

test('signed in when the server knows the user', async () => {
  const s = server({ user: [200] })
  assert.equal(await isSignedIn(s.fetchImpl, 'https://s'), true)
  assert.deepEqual(s.calls, [['/api/v1/auth/user', 'GET', 'include']])
})

test('an expired token is refreshed once, as the web app does', async () => {
  const s = server({ user: [401, 200], refresh: [200] })
  assert.equal(await isSignedIn(s.fetchImpl, 'https://s'), true)
  assert.deepEqual(s.calls.map((c) => c.slice(0, 2)), [
    ['/api/v1/auth/user', 'GET'],
    ['/api/v1/auth/refresh', 'POST'],
    ['/api/v1/auth/user', 'GET'],
  ])
})

test('signed out when there is nothing to refresh, or the refresh does not take', async () => {
  assert.equal(await isSignedIn(server({ user: [401], refresh: [401] }).fetchImpl, 'https://s'), false)
  assert.equal(await isSignedIn(server({ user: [401, 401], refresh: [204] }).fetchImpl, 'https://s'), false)
})

test('any other answer is a failure, not a sign-out', async () => {
  await assert.rejects(isSignedIn(server({ user: [502] }).fetchImpl, 'https://s'), /502/)
})
