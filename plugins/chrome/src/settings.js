// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Which AgentRQ server the extension opens, and how that choice is stored.
 *
 * The extension renders nothing of its own: it opens the server's web app, so
 * the page is first-party there and its `at` cookie, SSE and terminal socket
 * all work as they do in any tab.
 */

// The hosted instance, the same default as the desktop app.
export const DEFAULT_SERVER_URL = 'https://app.agentrq.com'

// Every site: what noticing a website's tools needs, and only while it is on.
export const ALL_SITES = ['https://*/*', 'http://*/*']

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/

// The host of a bare address, without its port: `[::1]:3000` is `[::1]`.
const isLocal = (raw) => LOCAL_HOST.test(raw.match(/^(\[[^\]]*\]|[^/:]*)/)[0])

/**
 * Turn what somebody typed into the server URL to open, or throw saying why not.
 *
 * A bare host is https, except a local one, which is where plain http is
 * normal. Anything but http(s) is refused, so a stored value cannot smuggle in
 * `javascript:` or `file:`.
 */
export function normalizeServerUrl(input) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('Enter the address of your AgentRQ server.')

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${isLocal(raw) ? 'http' : 'https'}://${raw}`

  let url
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`"${raw}" is not a web address.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The address has to start with https:// or http://.')
  }
  if (url.username || url.password) {
    throw new Error('Leave the user name and password out of the address; sign in on the page instead.')
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path}`
}

/** The server to open: the stored one if it is still valid, else the default. */
export async function getServerUrl(chrome) {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl')
  try {
    return normalizeServerUrl(serverUrl)
  } catch {
    return DEFAULT_SERVER_URL
  }
}

/** Store a new server, normalized, and return what was stored. */
export async function setServerUrl(chrome, input) {
  const serverUrl = normalizeServerUrl(input)
  await chrome.storage.sync.set({ serverUrl })
  return serverUrl
}

/**
 * The host permission a server needs. Without it Chrome treats the page inside
 * the popup as a third party, withholds the sign-in cookie, and the app shows
 * as signed out however signed in the browser is.
 */
export const originPattern = (serverUrl) => `${new URL(serverUrl).origin}/*`
