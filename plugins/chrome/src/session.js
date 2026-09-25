// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Whether the browser is signed in to the server, asked the way the web app
 * asks: the user, and on a 401 one refresh of the short-lived token.
 *
 * The popup needs to know before it shows the app, because a signed-out app
 * offers Google and GitHub sign-in, and both refuse to be shown inside another
 * page. Signing in has to happen in a tab.
 */
export async function isSignedIn(fetchImpl, serverUrl) {
  const call = (path, method = 'GET') =>
    fetchImpl(`${serverUrl}/api/v1/auth/${path}`, { method, credentials: 'include' })

  let res = await call('user')
  if (res.status === 401) {
    const refreshed = await call('refresh', 'POST')
    if (!refreshed.ok) return false
    res = await call('user')
  }
  if (res.status === 401) return false
  if (!res.ok) throw new Error(`The server answered ${res.status}.`)
  return true
}
