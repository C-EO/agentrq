// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * The popup's strip above the app: turn on detection, share the front tab's
 * site with a workspace, or stop sharing it. With nothing to say it is hidden.
 */
import { ALL_SITES } from './settings.js'
import { share, unshare } from './shares.js'
import { listWorkspaces } from './workspaces.js'

export async function initStrip({ doc, chrome, fetchImpl, server }) {
  const $ = (id) => doc.getElementById(id)
  const strip = $('strip')
  const text = $('strip-text')
  const picker = $('strip-workspace')
  const action = $('strip-action')
  // Set by show(); the button is hidden until then.
  let onAction
  action.addEventListener('click', () => onAction())

  const show = (message, label, handler, workspaces) => {
    strip.hidden = false
    text.textContent = message
    action.hidden = !label
    action.textContent = label ?? ''
    onAction = handler
    picker.hidden = !workspaces
    if (workspaces) {
      picker.replaceChildren(
        ...workspaces.map(({ id, name }) => Object.assign(doc.createElement('option'), { value: id, textContent: name })),
      )
      picker.value = workspaces[0].id
    }
  }

  // Asked straight from the click, before anything is awaited: Chrome shows
  // its prompt only inside the gesture.
  const turnOn = () =>
    chrome.permissions
      .request({ origins: ALL_SITES })
      .then((granted) => (granted ? show('On. Websites that offer tools now light up the icon; reload one that is open.') : render()))

  async function render() {
    strip.hidden = true
    if (!(await chrome.permissions.contains({ origins: ALL_SITES }))) {
      return show('Let AgentRQ notice websites that offer tools to agents', 'Turn on', turnOn)
    }
    const state = await chrome.runtime.sendMessage({ type: 'popup-state' }).catch(() => null)
    if (!state?.toolCount) return
    // Signed out there is nothing to share with, but a share can still stop.
    const workspaces = await listWorkspaces(fetchImpl, server).catch(() => [])
    if (state.sharedWith) {
      const name = workspaces.find((w) => w.id === state.sharedWith)?.name ?? 'a workspace'
      return show(`Shared with ${name}`, 'Stop sharing', () => unshare(chrome, state.origin).then(render))
    }
    if (!workspaces.length) return
    const count = `${state.toolCount} WebMCP tool${state.toolCount === 1 ? '' : 's'}`
    show(
      `${new URL(state.origin).host} offers ${count} · Share with`,
      'Share',
      () => share(chrome, state.origin, picker.value, state.url, state.tools).then(render),
      workspaces,
    )
  }
  return render()
}
