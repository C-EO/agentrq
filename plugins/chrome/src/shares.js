// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * The sites shared with a workspace, in chrome.storage.local under `shares`:
 * { [origin]: { workspaceId, lastUrl, tools, alwaysAllow, pending } }.
 *
 * `tools` is the last list announced, so a worker restarted with no tab of the
 * site open can re-announce it rather than erase it on the server. `pending`
 * marks a share the server has not listed yet: its snapshot on connect is
 * taken before it reads our announce, so without the mark reconcile would drop
 * every share made while offline.
 */

const read = async (chrome) => (await chrome.storage.local.get('shares')).shares ?? {}
const write = (chrome, shares) => chrome.storage.local.set({ shares })

export const listShares = read

export async function share(chrome, origin, workspaceId, lastUrl, tools = []) {
  const shares = await read(chrome)
  shares[origin] = { workspaceId, lastUrl, tools, alwaysAllow: [], pending: true }
  await write(chrome, shares)
}

export async function unshare(chrome, origin) {
  const shares = await read(chrome)
  if (!(origin in shares)) return
  delete shares[origin]
  await write(chrome, shares)
}

/** Record a shared site's latest page and tools; false when it is not shared. */
export async function remember(chrome, origin, lastUrl, tools) {
  const shares = await read(chrome)
  if (!shares[origin]) return false
  Object.assign(shares[origin], { lastUrl, tools })
  await write(chrome, shares)
  return true
}

/** The server refused an announce: a share it never had is not a share. */
export async function refused(chrome, origin) {
  const shares = await read(chrome)
  if (!shares[origin]?.pending) return
  delete shares[origin]
  await write(chrome, shares)
}

/** This browser's id on the server, made once. */
export async function browserId(chrome) {
  const stored = (await chrome.storage.local.get('browserId')).browserId
  if (stored) return stored
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ browserId: id })
  return id
}

/**
 * Bring the local shares in line with the server's list: drop what it no
 * longer has (a deleted workspace takes its shares with it), and take its
 * workspace and always-allowed tools for the rest. Pending shares keep ours.
 */
export async function reconcile(chrome, serverShares = []) {
  const server = new Map(serverShares.map((s) => [s.origin, s]))
  const shares = await read(chrome)
  for (const [origin, local] of Object.entries(shares)) {
    const remote = server.get(origin)
    if (remote && (!local.pending || remote.workspaceId === local.workspaceId)) {
      shares[origin] = { ...local, workspaceId: remote.workspaceId, alwaysAllow: remote.alwaysAllow ?? [], pending: false }
    } else if (!local.pending) {
      delete shares[origin]
    }
  }
  await write(chrome, shares)
}
