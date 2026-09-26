// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Site tools in the worker: which pages offer tools, telling the server about
 * the shared ones, and running the calls it sends.
 */
import { getServerUrl, originPattern } from './settings.js'
import { listShares, reconcile, refused, remember } from './shares.js'
import { createSocket } from './socket.js'
import { createTabs } from './tabs.js'

export const ALL_SITES = ['https://*/*', 'http://*/*']
export const TOOL_WAIT = 20_000
const MATCHES = ['https://*/*', 'http://localhost/*']
const SCRIPT_IDS = ['agentrq-bridge', 'agentrq-observer']

export function installSites(chrome, { run, log, fetchImpl, WebSocketImpl, timers }) {
  const tabs = createTabs(chrome, timers)

  const announce = (origin, share) => {
    const live = tabs.entry(tabs.bestTab(origin))
    const { url: lastUrl, tools } = live ?? { url: share.lastUrl, tools: share.tools ?? [] }
    socket.send({ type: 'announce', origin, workspaceId: share.workspaceId, lastUrl, tools })
  }

  const runCall = async ({ callId, origin, tool, arguments: args }) => {
    let result
    try {
      let tabId = tabs.bestTab(origin, tool)
      if (tabId === null) {
        const share = (await listShares(chrome))[origin]
        await chrome.tabs.create({ url: share?.lastUrl || origin, active: false })
        tabId = await tabs.waitForTool(origin, tool, TOOL_WAIT)
      }
      const answer = tabs.expect(callId, tabId)
      chrome.tabs
        .sendMessage(tabId, { type: 'site-call', callId, tool, arguments: args })
        .catch((err) => tabs.deliver(callId, tabId, { error: err.message }))
      result = await answer
    } catch (err) {
      result = { error: err.message }
    }
    socket.send(result.error ? { type: 'result', callId, error: result.error } : { type: 'result', callId, text: result.text ?? '' })
  }

  const onFrame = (frame) => {
    if (frame.type === 'shares') run(() => reconcile(chrome, frame.shares))
    else if (frame.type === 'call') run(() => runCall(frame))
    else if (frame.type === 'refused') {
      log.error(`AgentRQ: the server refused ${frame.origin}: ${frame.error}`)
      run(() => refused(chrome, frame.origin))
    }
  }

  // Every open re-announces every share: after a worker restart or a reconnect
  // the server's record names another socket, or none.
  const onOpen = () =>
    run(async () => {
      for (const [origin, share] of Object.entries(await listShares(chrome))) announce(origin, share)
    })

  const socket = createSocket({ chrome, fetchImpl, WebSocketImpl, timers, log, onFrame, onOpen, getServer: () => getServerUrl(chrome) })

  const onSiteTools = async (tabId, url, tools) => {
    const origin = new URL(url).origin
    tabs.set(tabId, origin, url, tools)
    if (!(await remember(chrome, origin, url, tools))) return
    announce(origin, (await listShares(chrome))[origin])
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab?.id
    if (tabId === undefined || sender.frameId !== 0) return
    if (message?.type === 'site-tools') run(() => onSiteTools(tabId, sender.url, message.tools ?? []))
    else if (message?.type === 'site-result') tabs.deliver(message.callId, tabId, { text: message.text, error: message.error })
  })
  chrome.tabs.onActivated.addListener(({ tabId }) => tabs.touch(tabId))
  chrome.tabs.onRemoved.addListener((tabId) => tabs.remove(tabId))

  // A share added, moved or removed, from the popup or by reconcile.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.serverUrl) run(syncScripts)
    if (area !== 'local' || !changes.shares) return
    const before = changes.shares.oldValue ?? {}
    const after = changes.shares.newValue ?? {}
    for (const origin of Object.keys(before)) if (!after[origin]) socket.send({ type: 'withdraw', origin })
    for (const [origin, share] of Object.entries(after)) {
      if (before[origin]?.workspaceId !== share.workspaceId) announce(origin, share)
    }
    if (Object.keys(after).length === 0) socket.close()
    else run(socket.ensure)
  })

  // The observer and its bridge run on every site, and so only while the
  // all-sites access is granted. Bridge first: Chrome orders them by id.
  let scripts = Promise.resolve()
  const syncScripts = () =>
    // One at a time, and one failure does not stop the next.
    (scripts = scripts.catch(() => {}).then(async () => {
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS })
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS })
      if (!(await chrome.permissions.contains({ origins: ALL_SITES }))) return
      // The server's own app is AgentRQ's WebMCP, not a site to share.
      const excludeMatches = [originPattern(await getServerUrl(chrome))]
      const script = (id, file, world) => ({ id, js: [file], matches: MATCHES, excludeMatches, runAt: 'document_start', allFrames: false, world })
      await chrome.scripting.registerContentScripts([
        script(SCRIPT_IDS[0], 'src/bridge.js', 'ISOLATED'),
        script(SCRIPT_IDS[1], 'src/observer.js', 'MAIN'),
      ])
    }))
  chrome.permissions.onAdded.addListener(() => run(syncScripts))
  chrome.permissions.onRemoved.addListener(() => run(syncScripts))

  run(syncScripts)
  run(socket.ensure)
  return { tabs, socket }
}
