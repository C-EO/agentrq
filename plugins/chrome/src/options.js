// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { ALL_SITES, DEFAULT_SERVER_URL, getServerUrl, normalizeServerUrl, originPattern, setServerUrl } from './settings.js'
import { listShares, unshare } from './shares.js'
import { listWorkspaces } from './workspaces.js'

/** The options page: which server the popup shows, and the site tools. */
export async function initOptions(doc, chrome, fetchImpl) {
  const input = doc.getElementById('server')
  const status = doc.getElementById('status')
  const say = (text, error = false) => {
    status.textContent = text
    status.className = error ? 'error' : ''
  }

  // The permission is asked for before anything else is awaited: Chrome only
  // shows its prompt from inside the click that asked.
  const save = async (value) => {
    let serverUrl
    try {
      serverUrl = normalizeServerUrl(value)
    } catch (err) {
      return say(err.message, true)
    }
    if (!(await chrome.permissions.request({ origins: [originPattern(serverUrl)] }))) {
      return say(`Without access to ${new URL(serverUrl).host} the popup cannot show you signed in, so nothing was saved.`, true)
    }
    const before = await getServerUrl(chrome)
    input.value = await setServerUrl(chrome, serverUrl)
    // A self-hosted server's access is given back when it is no longer used.
    // The hosted one's is part of the install and cannot be.
    if (before !== serverUrl && before !== DEFAULT_SERVER_URL && originPattern(before) !== originPattern(serverUrl)) {
      await chrome.permissions.remove({ origins: [originPattern(before)] })
    }
    say('Saved. The popup now shows this server.')
  }

  input.value = await getServerUrl(chrome)
  doc.getElementById('form').addEventListener('submit', (event) => {
    event.preventDefault()
    return save(input.value)
  })
  doc.getElementById('reset').addEventListener('click', () => save(DEFAULT_SERVER_URL))

  // Detection is the all-sites access; asked for from the click, like the server's.
  const detect = doc.getElementById('detect')
  const syncDetect = async () => {
    detect.checked = await chrome.permissions.contains({ origins: ALL_SITES })
  }
  detect.addEventListener('change', () =>
    (detect.checked ? chrome.permissions.request({ origins: ALL_SITES }) : chrome.permissions.remove({ origins: ALL_SITES }).then(() => false)).then(
      (on) => (detect.checked = on),
    ),
  )
  chrome.permissions.onAdded.addListener(syncDetect)
  chrome.permissions.onRemoved.addListener(syncDetect)
  await syncDetect()

  // The shared websites, with the name of the workspace each is shared with.
  const list = doc.getElementById('shares')
  let names = new Map()
  const item = (tag, props) => Object.assign(doc.createElement(tag), props)
  const showShares = async () => {
    const shares = Object.entries(await listShares(chrome))
    doc.getElementById('none').hidden = shares.length > 0
    list.replaceChildren(
      ...shares.map(([origin, { workspaceId }]) => {
        const stop = item('button', { type: 'button', textContent: 'Stop' })
        stop.addEventListener('click', () => unshare(chrome, origin))
        const li = item('li')
        li.append(item('span', { textContent: origin }), item('span', { textContent: names.get(workspaceId) ?? 'a workspace' }), stop)
        return li
      }),
    )
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shares) showShares()
  })
  await showShares()
  // Signed out, the list still shows, and still stops; it just has no names.
  listWorkspaces(fetchImpl, await getServerUrl(chrome)).then(
    (workspaces) => {
      names = new Map(workspaces.map((w) => [w.id, w.name]))
      return showShares()
    },
    () => {},
  )
}
