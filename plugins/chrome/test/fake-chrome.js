// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// Just enough of the chrome.* API for the extension's code, kept in memory.

export function makeEvent() {
  const listeners = []
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    fire: (...args) => listeners.map((fn) => fn(...args)),
  }
}

// Like Chrome, a write reaches onChanged as copies of the old and new values.
function makeArea(name, onChanged) {
  const data = {}
  return {
    data,
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (values) => {
      const changes = {}
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(value) }
        data[key] = structuredClone(value)
      }
      onChanged.fire(changes, name)
    },
    remove: async (key) => void delete data[key],
  }
}

/**
 * A fake browser. `granted` is the host access it starts with, and `allow`
 * whether it grants what is asked for.
 */
export function fakeChrome({ windows = [], granted = ['https://app.agentrq.com/*'], allow = true } = {}) {
  let nextId = 100
  const all = new Map()
  const calls = []

  const add = (props) => {
    const w = { id: nextId++, type: 'normal', state: 'normal', focused: false, left: 0, top: 0, width: 800, height: 600, ...props }
    w.tabs = (props.url ? [props.url] : []).map((url) => ({ id: nextId++, url }))
    all.set(w.id, w)
    return w
  }
  for (const w of windows) add(w)

  const clone = (w) => structuredClone(w)
  const onChanged = makeEvent()
  const chrome = {
    calls,
    all,
    storage: { onChanged },
    permissions: {
      granted: new Set(granted),
      contains: async ({ origins }) => origins.every((o) => chrome.permissions.granted.has(o)),
      request: async ({ origins }) => {
        calls.push(['permissions.request', origins])
        if (allow) for (const o of origins) chrome.permissions.granted.add(o)
        return allow
      },
      remove: async ({ origins }) => {
        calls.push(['permissions.remove', origins])
        for (const o of origins) chrome.permissions.granted.delete(o)
        return true
      },
      onAdded: makeEvent(),
      onRemoved: makeEvent(),
    },
    scripting: {
      registered: [],
      getRegisteredContentScripts: async ({ ids }) => chrome.scripting.registered.filter((s) => ids.includes(s.id)),
      registerContentScripts: async (scripts) => {
        calls.push(['scripting.register', scripts.map((s) => s.id)])
        for (const s of scripts) {
          if (chrome.scripting.registered.some((r) => r.id === s.id)) throw new Error(`Duplicate script ID '${s.id}'`)
        }
        chrome.scripting.registered.push(...scripts)
      },
      unregisterContentScripts: async ({ ids }) => {
        calls.push(['scripting.unregister', ids])
        chrome.scripting.registered = chrome.scripting.registered.filter((s) => !ids.includes(s.id))
      },
    },
    action: {
      badges: new Map(),
      setBadgeText: ({ tabId, text }) => void chrome.action.badges.set(tabId, { ...chrome.action.badges.get(tabId), text }),
      setBadgeBackgroundColor: ({ tabId, color }) =>
        void chrome.action.badges.set(tabId, { ...chrome.action.badges.get(tabId), color }),
    },
    windows: {
      create: async (props) => {
        calls.push(['windows.create', props])
        return clone(add(props))
      },
      getAll: async ({ windowTypes }) => [...all.values()].filter((w) => windowTypes.includes(w.type)).map(clone),
      update: async (id, props) => {
        calls.push(['windows.update', id, props])
        const w = all.get(id)
        Object.assign(w, props)
        return clone(w)
      },
    },
    tabs: {
      create: async (props) => {
        calls.push(['tabs.create', props])
        return { id: nextId++, ...props }
      },
      sent: [],
      sendMessage: async (tabId, message) => void chrome.tabs.sent.push([tabId, structuredClone(message)]),
      // The tab a test says is in front, if any.
      active: null,
      query: async () => (chrome.tabs.active ? [structuredClone(chrome.tabs.active)] : []),
      onActivated: makeEvent(),
      onRemoved: makeEvent(),
      onUpdated: makeEvent(),
    },
    contextMenus: {
      items: [],
      onClicked: makeEvent(),
      removeAll: async () => void (chrome.contextMenus.items.length = 0),
      create: (item) => void chrome.contextMenus.items.push(item),
    },
    commands: { onCommand: makeEvent() },
    runtime: {
      onInstalled: makeEvent(),
      onMessage: makeEvent(),
      openOptionsPage: async () => void calls.push(['runtime.openOptionsPage']),
      getURL: (path) => `chrome-extension://agentrq/${path}`,
      // Chrome sends a message as JSON, so undefined fields do not arrive. It
      // is sent from the popup's page; a listener answers by returning true and
      // calling sendResponse, and nobody answering is undefined.
      sendMessage: (message) => {
        const sent = JSON.parse(JSON.stringify(message))
        calls.push(['runtime.sendMessage', sent])
        const sender = { url: chrome.runtime.getURL('src/popup.html') }
        return new Promise((resolve) => {
          const answering = chrome.runtime.onMessage.listeners.map((fn) => fn(sent, sender, resolve))
          if (!answering.includes(true)) resolve(undefined)
        })
      },
    },
  }
  for (const area of ['sync', 'local', 'session']) chrome.storage[area] = makeArea(area, onChanged)
  return chrome
}

/**
 * Timers that run only when told to: `advance(ms)` fires what is due, in order.
 */
export function fakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map()
  const add = (fn, ms, every) => {
    const id = nextId++
    pending.set(id, { fn, at: now + ms, every })
    return id
  }
  const clear = (id) => void pending.delete(id)
  return {
    pending,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: clear,
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: clear,
    /** Delays of the timeouts waiting now, soonest first. */
    delays: () => [...pending.values()].filter((t) => !t.every).map((t) => t.at - now).sort((a, b) => a - b),
    advance(ms) {
      const until = now + ms
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, t] = due
        now = t.at
        if (t.every) t.at += t.every
        else pending.delete(id)
        t.fn()
      }
      now = until
    },
  }
}

/** A WebSocket that opens, receives and closes when a test says so. */
export function fakeWebSocketClass() {
  const sockets = []
  class FakeWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.sent = []
      sockets.push(this)
    }
    send(data) {
      this.sent.push(JSON.parse(data))
    }
    close() {
      this.readyState = 3
      this.closed = true
      this.onclose?.()
    }
    open() {
      this.readyState = 1
      this.onopen?.()
    }
    receive(frame) {
      this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
    }
    drop() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  FakeWebSocket.sockets = sockets
  return FakeWebSocket
}

/** Let the listeners' un-awaited work finish. */
export async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}
