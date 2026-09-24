// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const manifest = json('manifest.json')

test('the manifest and package agree on the version', () => {
  assert.equal(manifest.version, json('package.json').version)
})

test('every file the manifest names is in the package', () => {
  const paths = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.background.service_worker,
    manifest.options_ui.page,
    manifest.action.default_popup,
  ]
  for (const path of paths) assert.ok(existsSync(new URL(path, root)), path)
})

// Each permission is a line on Chrome's install prompt. The one site it may
// read is the hosted server, which the popup cannot show signed in without; a
// self-hosted one is asked for only when somebody saves it.
test('the extension asks for nothing it does not use', () => {
  assert.deepEqual(manifest.permissions.sort(), ['contextMenus', 'storage'])
  assert.deepEqual(manifest.host_permissions, ['https://app.agentrq.com/*'])
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*'])
  assert.equal(manifest.manifest_version, 3)
})
