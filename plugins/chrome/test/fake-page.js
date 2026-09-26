// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// A tab for the content scripts. Each script runs in its own vm context, as
// the MAIN and ISOLATED worlds do, and the contexts share one document.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/** A native `modelContext`: registerTool resolves, or rejects with `refuse`. */
export function fakeModelContext({ refuse } = {}) {
  const context = {
    registered: [],
    registerTool: async (tool, options) => {
      if (refuse) throw refuse
      context.registered.push([tool, options])
    },
  }
  return context
}

export function fakePage({ document: props = {}, navigator = {} } = {}) {
  const document = Object.assign(new EventTarget(), { documentElement: { dataset: {} } }, props)
  return { document, navigator }
}

/** Run `src/<name>` in a fresh world of `page`, with `globals` as its own. */
export function runScript(name, page, globals = {}) {
  const filename = fileURLToPath(new URL(`../src/${name}`, import.meta.url))
  const world = vm.createContext({ document: page.document, navigator: page.navigator, CustomEvent, EventTarget, ...globals })
  vm.runInContext(readFileSync(filename, 'utf8'), world, { filename })
  return world
}

/** One end of the channel, listening under `nonce` for messages from `from`. */
export function channel(page, nonce, from) {
  const received = []
  page.document.addEventListener(nonce, (event) => {
    let message
    try {
      message = JSON.parse(event.detail)
    } catch {
      return // the garbage a test sent
    }
    if (message.source === from) received.push(message)
  })
  const send = (message, type = nonce) => page.document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(message) }))
  return { received, send }
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
