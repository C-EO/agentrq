// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { readFileSync } from 'node:fs'
import { dirname, join, parse as parsePath, resolve } from 'node:path'

import { UserError } from './errors.js'

export const CONFIG_FILENAME = '.mcp.json'

/**
 * Walk up from `startDir` looking for a `.mcp.json`.
 *
 * The CLI is meant to be run from inside a workspace checkout the way `git` is,
 * and an agent's working directory is often a subdirectory of the one holding
 * the config, so stopping at the first level would refuse to work from exactly
 * the places people run it from.
 *
 * Returns the absolute path, or null when no ancestor has one.
 */
export function findConfigFile(startDir, { readFile = readFileSync } = {}) {
  let dir = resolve(startDir)
  const { root } = parsePath(dir)
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME)
    try {
      readFile(candidate)
      return candidate
    } catch {
      // Not here — keep walking.
    }
    if (dir === root) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Pick which server in an `.mcp.json` is the workspace.
 *
 * A config with one entry is unambiguous. With several, an `agentrq` name is
 * the strong hint, and anything still ambiguous is an error that lists the
 * names rather than a guess — connecting to the wrong server would act on the
 * wrong workspace, which is not something to be quietly wrong about.
 */
export function selectServer(servers, requested) {
  const names = Object.keys(servers || {})
  if (names.length === 0) {
    throw new UserError(`no servers defined in ${CONFIG_FILENAME}`)
  }
  if (requested) {
    if (!servers[requested]) {
      throw new UserError(
        `no server named "${requested}" in ${CONFIG_FILENAME} (have: ${names.join(', ')})`,
      )
    }
    return requested
  }
  if (names.length === 1) return names[0]

  const agentrq = names.filter((n) => /agentrq/i.test(n))
  if (agentrq.length === 1) return agentrq[0]

  throw new UserError(
    `${CONFIG_FILENAME} defines several servers (${names.join(', ')}); ` +
      'choose one with --server <name>',
  )
}

/**
 * Resolve the workspace endpoint the CLI should talk to.
 *
 * `AGENTRQ_WS_URL` wins outright so the CLI can be pointed somewhere without a
 * config file at all (CI, a one-off script). Otherwise the workspace's own
 * `.mcp.json` is the source of the URL and its embedded token.
 */
export function resolveServer({
  cwd = process.cwd(),
  configPath,
  serverName,
  env = process.env,
  readFile = readFileSync,
} = {}) {
  if (env.AGENTRQ_WS_URL) {
    return { name: serverName || 'env', url: env.AGENTRQ_WS_URL, headers: {}, source: 'AGENTRQ_WS_URL' }
  }

  const path = configPath ? resolve(cwd, configPath) : findConfigFile(cwd, { readFile })
  if (!path) {
    throw new UserError(
      `no ${CONFIG_FILENAME} found in ${resolve(cwd)} or any parent directory.\n` +
        'Run agentrq-ws from a workspace directory, or set AGENTRQ_WS_URL.',
    )
  }

  let raw
  try {
    raw = readFile(path, 'utf8')
  } catch (err) {
    throw new UserError(`cannot read ${path}: ${err.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(String(raw))
  } catch (err) {
    throw new UserError(`${path} is not valid JSON: ${err.message}`)
  }

  const name = selectServer(parsed.mcpServers, serverName || env.AGENTRQ_WS_SERVER)
  const entry = parsed.mcpServers[name] || {}
  if (!entry.url) {
    throw new UserError(
      `server "${name}" in ${path} has no url. ` +
        'agentrq-ws speaks HTTP to a workspace server; stdio servers are not supported.',
    )
  }
  return { name, url: entry.url, headers: entry.headers || {}, source: path }
}
