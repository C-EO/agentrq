// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { listWorkspaces } from '../src/workspaces.js'

const SERVER = 'https://app.agentrq.com'
const list = { workspaces: [{ id: 'b', name: 'beta', mcpToken: 'secret' }, { id: 'a', name: 'Alpha' }] }

// A server answering each request with the next status in its list.
function server(statuses) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push([init.method ?? 'GET', url.replace(SERVER, ''), init.credentials])
    const status = statuses.shift()
    return { status, ok: status < 300, json: async () => list }
  }
  return { calls, fetchImpl }
}

test('the workspaces come back by name, with only their id and name', async () => {
  const s = server([200])
  assert.deepEqual(await listWorkspaces(s.fetchImpl, SERVER), [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'beta' },
  ])
  assert.deepEqual(s.calls, [['GET', '/api/v1/workspaces', 'include']])
})

test('an expired token is refreshed once, as the web app does', async () => {
  const s = server([401, 200, 200])
  assert.equal((await listWorkspaces(s.fetchImpl, SERVER)).length, 2)
  assert.deepEqual(
    s.calls.map(([method, path]) => `${method} ${path}`),
    ['GET /api/v1/workspaces', 'POST /api/v1/auth/refresh', 'GET /api/v1/workspaces'],
  )
})

test('signed out, or a server error, is an error', async () => {
  await assert.rejects(listWorkspaces(server([401, 401]).fetchImpl, SERVER), /answered 401/)
  await assert.rejects(listWorkspaces(server([502]).fetchImpl, SERVER), /answered 502/)
})

test('a server with no workspaces field lists none', async () => {
  const fetchImpl = async () => ({ status: 200, ok: true, json: async () => ({}) })
  assert.deepEqual(await listWorkspaces(fetchImpl, SERVER), [])
})
