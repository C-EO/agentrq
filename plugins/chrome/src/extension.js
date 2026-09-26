// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * The service worker's half. The toolbar button opens the popup by itself;
 * what is left here is the way out to full size (the button's right-click menu
 * and a keyboard shortcut) and the site tools.
 */
import { openFullSize } from './fullsize.js'
import { installSites } from './sites.js'

export const FULL_SIZE = 'open-full-size'

export function install(chrome, log = console, { fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, timers = globalThis } = {}) {
  // A listener's rejection is otherwise an unhandled one in a worker nobody is
  // looking at; logging it at least puts it on the extension's error page.
  const run = (action) => {
    Promise.resolve()
      .then(action)
      .catch((err) => log.error('AgentRQ:', err))
  }

  chrome.runtime.onInstalled.addListener(() =>
    run(async () => {
      await chrome.contextMenus.removeAll()
      chrome.contextMenus.create({ id: FULL_SIZE, title: 'Open full size', contexts: ['action'] })
    }),
  )
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === FULL_SIZE) run(() => openFullSize(chrome))
  })
  chrome.commands.onCommand.addListener((command) => {
    if (command === FULL_SIZE) run(() => openFullSize(chrome))
  })
  return installSites(chrome, { run, log, fetchImpl, WebSocketImpl, timers })
}
