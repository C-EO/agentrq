// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// The page observer: MAIN world, document_start, top frame. It wraps the
// browser's own registerTool to learn the page's WebMCP tools, and runs them
// for the bridge. It never provides a modelContext.
//
// A classic script, not a module: content scripts cannot `export`. The IIFE
// keeps it from leaving globals in the page.
;(() => {
  // The bridge left the nonce; take it before any page script can read it.
  const dataset = document.documentElement.dataset
  const nonce = dataset.agentrqNonce
  delete dataset.agentrqNonce
  if (!nonce) return

  const contexts = new Set([document.modelContext, navigator.modelContext].filter((c) => typeof c?.registerTool === 'function'))
  if (contexts.size === 0) return

  // Captured now, so a page script patching them later cannot see the nonce.
  const dispatch = EventTarget.prototype.dispatchEvent.bind(document)
  const Event = CustomEvent
  const { parse, stringify } = JSON
  const post = (message) => dispatch(new Event(nonce, { detail: stringify({ source: 'agentrq-observer', ...message }) }))

  const tools = new Map()
  const announce = () => post({ type: 'tools', tools: [...tools.values()].map((entry) => entry.descriptor) })

  function record(tool, signal) {
    if (signal?.aborted) return
    let descriptor
    try {
      const { name, description, inputSchema, annotations } = tool
      descriptor = parse(stringify({ name, description, inputSchema, annotations }))
    } catch {
      return // not JSON, so no agent could be told how to call it
    }
    const entry = { descriptor, tool, execute: tool.execute, pending: new Set() }
    tools.set(descriptor.name, entry)
    signal?.addEventListener('abort', () => withdraw(entry), { once: true })
    announce()
  }

  function withdraw(entry) {
    // A later registration of the same name owns it now.
    if (tools.get(entry.descriptor.name) !== entry) return
    tools.delete(entry.descriptor.name)
    for (const callId of entry.pending) post({ type: 'result', callId, error: `the page withdrew ${entry.descriptor.name}` })
    entry.pending.clear()
    announce()
  }

  for (const context of contexts) {
    const native = context.registerTool
    context.registerTool = function registerTool(tool, options) {
      const signal = options?.signal
      const registered = native.call(this, tool, options)
      if (typeof registered?.then !== 'function') {
        record(tool, signal)
        return registered
      }
      return registered.then((value) => {
        record(tool, signal)
        return value
      })
    }
  }

  function textOf(result) {
    if (typeof result === 'string') return result
    const content = result?.content
    if (Array.isArray(content) && content.every((item) => item?.type === 'text')) return content.map((item) => item.text).join('\n')
    return stringify(result) ?? ''
  }

  async function call({ callId, tool, arguments: args }) {
    const entry = tools.get(tool)
    if (!entry) return post({ type: 'result', callId, error: `the page withdrew ${tool}` })
    entry.pending.add(callId)
    let reply
    try {
      const result = await entry.execute.call(entry.tool, args)
      reply = result?.isError === true ? { error: textOf(result) } : { text: textOf(result) }
    } catch (err) {
      reply = { error: err?.message || String(err) }
    }
    // Withdrawn meanwhile, and already answered for.
    if (entry.pending.delete(callId)) post({ type: 'result', callId, ...reply })
  }

  document.addEventListener(nonce, (event) => {
    let message
    try {
      message = parse(event.detail)
    } catch {
      return
    }
    if (message?.source === 'agentrq-bridge' && message.type === 'call') call(message)
  })
})()
