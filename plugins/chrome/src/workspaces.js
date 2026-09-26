// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * The signed-in account's workspaces, by name: the ones a site can be shared
 * with. Asked the way the web app asks, refreshing an expired token once.
 */
export async function listWorkspaces(fetchImpl, server) {
  const get = () => fetchImpl(`${server}/api/v1/workspaces`, { credentials: 'include' })
  let res = await get()
  if (res.status === 401 && (await fetchImpl(`${server}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })).ok) {
    res = await get()
  }
  if (!res.ok) throw new Error(`The server answered ${res.status}.`)
  const { workspaces = [] } = await res.json()
  return workspaces.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}
