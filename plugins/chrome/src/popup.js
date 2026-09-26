// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * The toolbar popup: the server's own web app in a frame at mobile width,
 * with the way out to full size in its header and the site-tools strip under it.
 */
import { openFullSize } from './fullsize.js'
import { isSignedIn } from './session.js'
import { getServerUrl, originPattern } from './settings.js'
import { initStrip } from './strip.js'

export async function initPopup({ doc, chrome, fetchImpl, close }) {
  const $ = (id) => doc.getElementById(id)
  const frame = $('app')
  const message = $('message')
  // Set by say(); the button is hidden until then.
  let onAction

  const openOptions = () => chrome.runtime.openOptionsPage().then(close)
  const say = (text, label, action) => {
    frame.hidden = true
    message.hidden = false
    $('text').textContent = text
    $('action').textContent = label
    // The link would only repeat a button that already opens Options.
    $('options').hidden = action === openOptions
    onAction = action
  }

  const server = await getServerUrl(chrome)
  const fullSize = (url) => openFullSize(chrome, url).then(close)

  $('full').addEventListener('click', () => fullSize(server))
  $('action').addEventListener('click', () => onAction())
  $('options').addEventListener('click', (event) => {
    event.preventDefault()
    return openOptions()
  })

  const host = new URL(server).host
  async function show() {
    if (!(await chrome.permissions.contains({ origins: [originPattern(server)] }))) {
      return say(`AgentRQ needs access to ${host} to show you signed in.`, 'Allow in Options', openOptions)
    }
    let signedIn
    try {
      signedIn = await isSignedIn(fetchImpl, server)
    } catch {
      return say(`Could not reach ${host}.`, 'Try again', show)
    }
    if (!signedIn) {
      // Google and GitHub will not show their sign-in inside another page.
      return say('Sign in to AgentRQ in a tab, then open this again.', 'Sign in', () => fullSize(`${server}/login`))
    }
    message.hidden = true
    frame.hidden = false
    frame.src = server
  }
  await Promise.all([show(), initStrip({ doc, chrome, fetchImpl, server })])
}
