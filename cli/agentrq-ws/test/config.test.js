// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { CONFIG_FILENAME, findConfigFile, resolveServer, selectServer } from '../src/config.js'
import { UserError } from '../src/errors.js'

const WORKSPACE_URL = 'https://example.mcp.agentrq.com?token=abc'

function workspaceDir(config = { mcpServers: { 'agentrq-workspace': { url: WORKSPACE_URL } } }) {
  const dir = mkdtempSync(join(tmpdir(), 'agentrq-ws-test-'))
  if (config) writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify(config))
  return dir
}

test('findConfigFile finds a config in the directory itself', () => {
  const dir = workspaceDir()
  assert.equal(findConfigFile(dir), join(dir, CONFIG_FILENAME))
})

test('findConfigFile walks up to an ancestor', () => {
  // An agent's cwd is routinely below the directory holding the config.
  const dir = workspaceDir()
  const nested = join(dir, 'backend', 'internal')
  mkdirSync(nested, { recursive: true })
  assert.equal(findConfigFile(nested), join(dir, CONFIG_FILENAME))
})

test('findConfigFile returns null when no ancestor has one', () => {
  const dir = workspaceDir(null)
  assert.equal(findConfigFile(dir), null)
})

test('findConfigFile stops when the parent stops changing', () => {
  // Guards the loop's second exit: a readFile that always throws must not spin.
  const readFile = () => {
    throw new Error('nope')
  }
  assert.equal(findConfigFile('/', { readFile }), null)
})

test('selectServer refuses a config with no servers', () => {
  assert.throws(() => selectServer({}), UserError)
  assert.throws(() => selectServer(undefined), /no servers defined/)
})

test('selectServer honours an explicit name', () => {
  assert.equal(selectServer({ a: {}, b: {} }, 'b'), 'b')
})

test('selectServer names the alternatives when the request is missing', () => {
  assert.throws(() => selectServer({ a: {}, b: {} }, 'c'), /have: a, b/)
})

test('selectServer takes the only server', () => {
  assert.equal(selectServer({ solo: {} }), 'solo')
})

test('selectServer prefers the agentrq server among several', () => {
  assert.equal(selectServer({ postgres: {}, 'agentrq-workspace': {} }), 'agentrq-workspace')
})

test('selectServer refuses to guess between equally plausible servers', () => {
  // Connecting to the wrong workspace would act on the wrong data, so this is
  // an error that lists the options rather than a coin flip.
  assert.throws(() => selectServer({ 'agentrq-a': {}, 'agentrq-b': {} }), /choose one with --server/)
  assert.throws(() => selectServer({ postgres: {}, github: {} }), /defines several servers/)
})

test('resolveServer prefers AGENTRQ_WS_URL over any config file', () => {
  const server = resolveServer({ cwd: workspaceDir(), env: { AGENTRQ_WS_URL: 'https://override' } })
  assert.equal(server.url, 'https://override')
  assert.equal(server.source, 'AGENTRQ_WS_URL')
})

test('resolveServer reads the nearest config file', () => {
  const dir = workspaceDir()
  const server = resolveServer({ cwd: dir, env: {} })
  assert.equal(server.url, WORKSPACE_URL)
  assert.equal(server.name, 'agentrq-workspace')
  assert.deepEqual(server.headers, {})
})

test('resolveServer accepts an explicit config path', () => {
  const dir = workspaceDir()
  const server = resolveServer({ cwd: dir, configPath: CONFIG_FILENAME, env: {} })
  assert.equal(server.url, WORKSPACE_URL)
})

test('resolveServer carries custom headers through', () => {
  const dir = workspaceDir({
    mcpServers: { only: { url: WORKSPACE_URL, headers: { authorization: 'Bearer x' } } },
  })
  assert.deepEqual(resolveServer({ cwd: dir, env: {} }).headers, { authorization: 'Bearer x' })
})

test('resolveServer reads the server name from the environment', () => {
  const dir = workspaceDir({ mcpServers: { one: { url: 'https://one' }, two: { url: 'https://two' } } })
  assert.equal(resolveServer({ cwd: dir, env: { AGENTRQ_WS_SERVER: 'two' } }).url, 'https://two')
})

test('resolveServer explains a missing config rather than failing obscurely', () => {
  assert.throws(() => resolveServer({ cwd: workspaceDir(null), env: {} }), /no \.mcp\.json found/)
})

test('resolveServer reports an unreadable config', () => {
  const readFile = () => {
    throw new Error('EACCES')
  }
  assert.throws(
    () => resolveServer({ cwd: '/tmp', configPath: 'x.json', env: {}, readFile }),
    /cannot read .*EACCES/,
  )
})

test('resolveServer reports invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentrq-ws-test-'))
  writeFileSync(join(dir, CONFIG_FILENAME), '{ not json')
  assert.throws(() => resolveServer({ cwd: dir, env: {} }), /is not valid JSON/)
})

test('resolveServer refuses a stdio server', () => {
  // The CLI speaks HTTP; a command-based server has no URL to talk to.
  const dir = workspaceDir({ mcpServers: { local: { command: 'npx', args: ['thing'] } } })
  assert.throws(() => resolveServer({ cwd: dir, env: {} }), /stdio servers are not supported/)
})
