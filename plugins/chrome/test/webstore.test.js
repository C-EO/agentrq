// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { API, main, publish } from '../scripts/webstore.js'

// A store answering each endpoint with the next body in its list.
function store(answers) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method ?? 'GET', url.replace(`${API}/`, ''), init.headers, init.body])
    const endpoint = url.split(':').pop()
    const [status, body] = answers[endpoint].shift()
    return { ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) }
  }
  return { calls, fetchImpl }
}

const base = { token: 'tok', publisherId: 'pub', itemId: 'item', version: '1.0.0', zip: 'ZIP', sleep: async () => {} }

test('a package is uploaded, then submitted for review', async () => {
  const s = store({ upload: [[200, { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' }]], publish: [[200, { state: 'PENDING_REVIEW' }]] })
  const logged = []
  assert.equal(await publish({ ...base, fetchImpl: s.fetchImpl, log: (l) => logged.push(l) }), 'PENDING_REVIEW')
  assert.deepEqual(s.calls, [
    ['POST', 'upload/v2/publishers/pub/items/item:upload', { authorization: 'Bearer tok', 'content-type': 'application/zip' }, 'ZIP'],
    ['POST', 'v2/publishers/pub/items/item:publish', { authorization: 'Bearer tok', 'content-type': 'application/json' }, '{}'],
  ])
  assert.deepEqual(logged, ['upload: SUCCEEDED', 'submission: PENDING_REVIEW'])
})

test('an upload still being processed is waited for', async () => {
  const s = store({
    upload: [[200, { uploadState: 'IN_PROGRESS' }]],
    fetchStatus: [[200, { lastAsyncUploadState: 'IN_PROGRESS' }], [200, { lastAsyncUploadState: 'SUCCEEDED' }]],
    publish: [[200, { state: 'PUBLISHED' }]],
  })
  let slept = 0
  assert.equal(await publish({ ...base, fetchImpl: s.fetchImpl, sleep: async () => slept++ }), 'PUBLISHED')
  assert.equal(slept, 2)
  assert.deepEqual(s.calls[1].slice(0, 2), ['GET', 'v2/publishers/pub/items/item:fetchStatus'])
})

test('it gives up on an upload that never finishes', async () => {
  const s = store({ upload: [[200, { uploadState: 'IN_PROGRESS' }]], fetchStatus: [[200, { lastAsyncUploadState: 'IN_PROGRESS' }]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl, polls: 1 }), /still IN_PROGRESS after 1 checks/)
})

test('a refused package, a wrong version or a refused submission fails the release', async () => {
  let s = store({ upload: [[200, { uploadState: 'FAILED' }]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl }), /refused the package/)

  s = store({ upload: [[200, { uploadState: 'SUCCEEDED', crxVersion: '0.9.0' }]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl }), /package is version 0\.9\.0, but 1\.0\.0/)

  s = store({ upload: [[200, { uploadState: 'SUCCEEDED' }]], publish: [[200, { state: 'REJECTED' }]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl }), /submission was rejected/)
})

test('an HTTP error names the step and what the store said', async () => {
  let s = store({ upload: [[401, { error: { message: 'bad token' } }]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl }), /Upload failed: HTTP 401 .*bad token/)
  s = store({ upload: [[200, { uploadState: 'SUCCEEDED' }]], publish: [[403, undefined]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl }), /^Error: Publish failed: HTTP 403$/)
  s = store({ upload: [[200, undefined]], fetchStatus: [[500, undefined]] })
  await assert.rejects(publish({ ...base, fetchImpl: s.fetchImpl }), /Status check failed: HTTP 500/)
})

test('the release job reads its settings from the environment', async () => {
  const s = store({ upload: [[200, { uploadState: 'SUCCEEDED' }]], publish: [[200, { state: 'PENDING_REVIEW' }]] })
  const env = { CWS_TOKEN: 't', CWS_PUBLISHER_ID: 'p', CWS_EXTENSION_ID: 'i', VERSION: '1.0.0', ZIP: 'a.zip' }
  const read = []
  const state = await main(env, { fetchImpl: s.fetchImpl, readFile: async (p) => (read.push(p), 'BYTES'), sleep: async () => {} })
  assert.equal(state, 'PENDING_REVIEW')
  assert.deepEqual(read, ['a.zip'])
  assert.equal(s.calls[0][1], 'upload/v2/publishers/p/items/i:upload')
  assert.equal(s.calls[0][3], 'BYTES')

  await assert.rejects(main({ VERSION: '1.0.0' }, {}), /Not set: CWS_TOKEN, CWS_PUBLISHER_ID, CWS_EXTENSION_ID, ZIP\. See plugins\/chrome\/PUBLISHING\.md/)
})
