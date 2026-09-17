// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
//
// A stand-in for the workspace MCP server: enough of streamable HTTP to drive
// the client for real, including the SSE framing the actual server uses.

/** Build a Response-like object without depending on the runtime's fetch. */
export function response(body, { status = 200, headers = {} } = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower.get(String(name).toLowerCase()) ?? null },
    text: async () => body,
  }
}

/** Wrap a JSON-RPC payload in the single `data:` SSE frame the server sends. */
export function sse(payload) {
  return response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

/**
 * A fetch implementation that speaks MCP.
 *
 * `onCall(name, args)` returns either a string (text content), an object with
 * {text, isError}, or throws to simulate a transport failure.
 */
export function fakeFetch({ onCall = () => 'ok', tools = [], sessionId = 'session-1', onRequest } = {}) {
  const calls = []
  const impl = async (url, options = {}) => {
    const record = { url, method: options.method || 'POST', headers: options.headers || {} }
    if (options.body) record.body = JSON.parse(options.body)
    calls.push(record)

    if (onRequest) {
      const override = await onRequest(record, calls)
      if (override) return override
    }

    if (record.method === 'DELETE') return response('', { status: 200 })

    const { id, method, params } = record.body || {}
    if (method === 'initialize') {
      return sse({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1' } },
      })
    }
    if (method === 'notifications/initialized') return response('', { status: 202 })
    if (method === 'tools/list') return sse({ jsonrpc: '2.0', id, result: { tools } })
    if (method === 'tools/call') {
      const outcome = await onCall(params.name, params.arguments || {})
      const { text, isError } = typeof outcome === 'string' ? { text: outcome, isError: false } : outcome
      return sse({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: Boolean(isError) } })
    }
    return sse({ jsonrpc: '2.0', id, error: { code: -32601, message: `no such method ${method}` } })
  }
  impl.calls = calls
  impl.sessionId = sessionId
  return impl
}

/** Attach the session header to whatever the inner fetch returns. */
export function withSession(impl, sessionId = 'session-1') {
  return async (url, options) => {
    const res = await impl(url, options)
    const original = res.headers.get.bind(res.headers)
    res.headers.get = (name) =>
      String(name).toLowerCase() === 'mcp-session-id' ? sessionId : original(name)
    return res
  }
}

/** A writable stream that keeps what was written. */
export function collect() {
  const chunks = []
  return {
    write(text) {
      chunks.push(text)
      return true
    },
    get text() {
      return chunks.join('')
    },
  }
}

/** An async iterable standing in for stdin. */
export function stdinOf(text) {
  return (async function* gen() {
    yield Buffer.from(text)
  })()
}
