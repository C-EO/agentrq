// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { channel, fakeModelContext, fakePage, runScript, settle } from './fake-page.js'

const NONCE = 'the-nonce'

/** A tab whose bridge has left NONCE, with the observer installed. */
function observed({ context = fakeModelContext(), where = 'document', nonce = NONCE } = {}) {
  const page = fakePage({ [where]: { modelContext: context } })
  if (nonce) page.document.documentElement.dataset.agentrqNonce = nonce
  const bridge = channel(page, NONCE, 'agentrq-observer')
  runScript('observer.js', page)
  const call = (id, tool, args = {}) => bridge.send({ source: 'agentrq-bridge', type: 'call', callId: id, tool, arguments: args })
  const results = () => bridge.received.filter((m) => m.type === 'result')
  const lastTools = () => bridge.received.filter((m) => m.type === 'tools').at(-1)?.tools
  return { page, context, bridge, call, results, lastTools }
}

const tool = (name, execute = async () => 'ok', extra = {}) => ({
  name,
  description: `${name} things`,
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  execute,
  ...extra,
})

test('a page with no modelContext is left alone: the extension never provides one', async () => {
  const page = fakePage()
  page.document.documentElement.dataset.agentrqNonce = NONCE
  const bridge = channel(page, NONCE, 'agentrq-observer')
  runScript('observer.js', page)
  await settle()
  assert.equal(page.document.modelContext, undefined)
  assert.equal(page.navigator.modelContext, undefined)
  assert.deepEqual(bridge.received, [])
})

test('the nonce is gone from the page before any page script could read it', () => {
  const { page } = observed()
  assert.equal('agentrqNonce' in page.document.documentElement.dataset, false)
  const bare = fakePage()
  bare.document.documentElement.dataset.agentrqNonce = NONCE
  runScript('observer.js', bare)
  assert.equal('agentrqNonce' in bare.document.documentElement.dataset, false)
})

test('without a nonce it refuses to install, so the page’s registerTool stays native', () => {
  const context = fakeModelContext()
  const native = context.registerTool
  observed({ context, nonce: null })
  assert.equal(context.registerTool, native)
})

test('a registration reaches the native API and posts the tool, without its execute', async () => {
  const { context, lastTools } = observed()
  const options = { signal: new AbortController().signal }
  const registering = tool('search')
  assert.equal(await context.registerTool(registering, options), undefined)
  assert.deepEqual(context.registered, [[registering, options]])
  assert.deepEqual(lastTools(), [
    { name: 'search', description: 'search things', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  ])
})

test('the deprecated navigator.modelContext is wrapped too', async () => {
  const { context, lastTools } = observed({ where: 'navigator' })
  await context.registerTool(tool('search'))
  assert.deepEqual(lastTools().map((t) => t.name), ['search'])
})

test('one context under both names is wrapped once', async () => {
  const context = fakeModelContext()
  const page = fakePage({ document: { modelContext: context }, navigator: { modelContext: context } })
  page.document.documentElement.dataset.agentrqNonce = NONCE
  const bridge = channel(page, NONCE, 'agentrq-observer')
  runScript('observer.js', page)
  await context.registerTool(tool('search'))
  assert.equal(bridge.received.length, 1)
})

test('a modelContext that cannot register tools is left alone', async () => {
  const context = { registerTool: 'not a function' }
  observed({ context })
  assert.equal(context.registerTool, 'not a function')
})

test('a refused registration is recorded nowhere and still rejects for the page', async () => {
  const refuse = new Error('Duplicate tool name')
  const { context, bridge } = observed({ context: fakeModelContext({ refuse }) })
  await assert.rejects(context.registerTool(tool('search')), refuse)
  assert.deepEqual(bridge.received, [])
})

for (const returned of [undefined, 'sync']) {
  test(`a registerTool that returns no promise (${returned}) is served as it is`, async () => {
    const context = { registerTool: () => returned }
    const { lastTools } = observed({ context })
    assert.equal(context.registerTool(tool('search')), returned)
    assert.deepEqual(lastTools().map((t) => t.name), ['search'])
  })
}

test('a tool that cannot be described is registered but not offered', async () => {
  const { context, bridge } = observed()
  const cyclic = { type: 'object' }
  cyclic.self = cyclic
  await context.registerTool(tool('loop', undefined, { inputSchema: cyclic }))
  assert.equal(context.registered.length, 1)
  assert.deepEqual(bridge.received, [])
})

test('the description is a snapshot: the page changing the object later changes nothing', async () => {
  const { context, lastTools } = observed()
  const registering = tool('search')
  await context.registerTool(registering)
  registering.inputSchema.type = 'string'
  await context.registerTool(tool('other'))
  assert.equal(lastTools()[0].inputSchema.type, 'object')
})

test('aborting withdraws the tool', async () => {
  const { context, lastTools } = observed()
  const controller = new AbortController()
  await context.registerTool(tool('search'), { signal: controller.signal })
  await context.registerTool(tool('open'))
  controller.abort()
  assert.deepEqual(lastTools().map((t) => t.name), ['open'])
})

test('a signal aborted before the native promise settles records nothing', async () => {
  const { context, bridge } = observed()
  const controller = new AbortController()
  const registering = context.registerTool(tool('search'), { signal: controller.signal })
  controller.abort()
  await registering
  assert.deepEqual(bridge.received, [])
})

test('a same-name re-registration replaces the tool and survives the old abort', async () => {
  const { context, call, results, lastTools } = observed()
  const first = new AbortController()
  await context.registerTool(tool('search', async () => 'old'), { signal: first.signal })
  await context.registerTool(tool('search', async () => 'new', { description: 'newer' }), { signal: new AbortController().signal })
  first.abort()
  assert.deepEqual(lastTools().map((t) => t.description), ['newer'])
  call('c1', 'search')
  await settle()
  assert.deepEqual(results(), [{ source: 'agentrq-observer', type: 'result', callId: 'c1', text: 'new' }])
})

test('a call runs execute with the arguments, as a method of the tool', async () => {
  const { context, call, results } = observed()
  const registering = tool('echo', async function (args) {
    return `${this.name}:${args.q}`
  })
  await context.registerTool(registering)
  call('c1', 'echo', { q: 'hi' })
  await settle()
  assert.equal(results()[0].text, 'echo:hi')
})

for (const [kind, returned, text] of [
  ['a string passes through as it is', '{"raw":1}', '{"raw":1}'],
  ['text content is joined', { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, 'a\nb'],
  ['content with more than text is JSON', { content: [{ type: 'image', data: 'x' }] }, '{"content":[{"type":"image","data":"x"}]}'],
  ['an object is JSON', { n: 1 }, '{"n":1}'],
  ['nothing is empty', undefined, ''],
]) {
  test(`a result: ${kind}`, async () => {
    const { context, call, results } = observed()
    await context.registerTool(tool('t', async () => returned))
    call('c1', 't')
    await settle()
    assert.deepEqual(results(), [{ source: 'agentrq-observer', type: 'result', callId: 'c1', text }])
  })
}

test('content marked isError is an error', async () => {
  const { context, call, results } = observed()
  await context.registerTool(tool('t', async () => ({ isError: true, content: [{ type: 'text', text: 'no such repo' }] })))
  call('c1', 't')
  await settle()
  assert.deepEqual(results(), [{ source: 'agentrq-observer', type: 'result', callId: 'c1', error: 'no such repo' }])
})

for (const [kind, thrown, error] of [
  ['an Error gives its message', new Error('signed out'), 'signed out'],
  ['anything else is spelled out', 'plain', 'plain'],
]) {
  test(`a throwing execute posts an error: ${kind}`, async () => {
    const { context, call, results } = observed()
    await context.registerTool(
      tool('t', async () => {
        throw thrown
      }),
    )
    call('c1', 't')
    await settle()
    assert.deepEqual(results(), [{ source: 'agentrq-observer', type: 'result', callId: 'c1', error }])
  })
}

test('a call for a tool the page withdrew says so', async () => {
  const { context, call, results } = observed()
  const controller = new AbortController()
  await context.registerTool(tool('search'), { signal: controller.signal })
  controller.abort()
  call('c1', 'search')
  await settle()
  assert.deepEqual(results(), [{ source: 'agentrq-observer', type: 'result', callId: 'c1', error: 'the page withdrew search' }])
})

test('withdrawing a tool mid-call fails the call at once, and its late answer is dropped', async () => {
  const { context, call, results } = observed()
  const controller = new AbortController()
  let finish
  await context.registerTool(tool('slow', () => new Promise((resolve) => (finish = resolve))), { signal: controller.signal })
  call('c1', 'slow')
  await settle()
  controller.abort()
  assert.deepEqual(results(), [{ source: 'agentrq-observer', type: 'result', callId: 'c1', error: 'the page withdrew slow' }])
  finish('too late')
  await settle()
  assert.equal(results().length, 1)
})

test('messages under another nonce, from another source, or not a call are ignored', async () => {
  const { page, context, bridge, call, results } = observed()
  let ran = 0
  await context.registerTool(tool('t', async () => ran++))
  bridge.send({ source: 'agentrq-bridge', type: 'call', callId: 'c1', tool: 't' }, 'wrong-nonce')
  bridge.send({ source: 'the-page', type: 'call', callId: 'c2', tool: 't' })
  bridge.send({ source: 'agentrq-bridge', type: 'tools', callId: 'c3', tool: 't' })
  page.document.dispatchEvent(new CustomEvent(NONCE, { detail: 'not json' }))
  await settle()
  assert.equal(ran, 0)
  assert.deepEqual(results(), [])
  call('c4', 't')
  await settle()
  assert.equal(ran, 1)
})
