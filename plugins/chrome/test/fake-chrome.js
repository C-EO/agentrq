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

function makeArea() {
  const data = {}
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (values) => void Object.assign(data, values),
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
  const chrome = {
    calls,
    all,
    storage: { sync: makeArea(), local: makeArea(), session: makeArea(), onChanged: makeEvent() },
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
      // Chrome sends a message as JSON, so undefined fields do not arrive.
      sendMessage: async (message) => void calls.push(['runtime.sendMessage', JSON.parse(JSON.stringify(message))]),
    },
  }
  return chrome
}

/** Let the listeners' un-awaited work finish. */
export async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}
