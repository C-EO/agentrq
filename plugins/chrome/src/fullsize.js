// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * AgentRQ full size: an ordinary browser tab, in the window the person is
 * using, or a maximized window when there is none.
 */
import { getServerUrl } from './settings.js'

export async function openFullSize(chrome, url) {
  const target = url ?? (await getServerUrl(chrome))
  const normal = await chrome.windows.getAll({ windowTypes: ['normal'] })
  const win = normal.find((w) => w.focused) ?? normal[0]
  if (!win) return chrome.windows.create({ url: target, type: 'normal', state: 'maximized' })
  await chrome.tabs.create({ windowId: win.id, url: target, active: true })
  return chrome.windows.update(win.id, { focused: true })
}
