// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { DEFAULT_SERVER_URL, getServerUrl, normalizeServerUrl, originPattern, setServerUrl } from './settings.js'

/** The options page: which server the popup shows. */
export async function initOptions(doc, chrome) {
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
}
