// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * The one socket to the server, open only while something is shared.
 *
 * It opens with a one-minute ticket fetched with the `at` cookie, because a
 * WebSocket from the worker carries no cookie of its own. Chrome keeps a worker
 * alive while its socket is busy, and a ping frame from the server does not
 * count, so the worker sends one of its own.
 */
import { browserId, listShares } from './shares.js'

export const BACKOFF = [1e3, 2e3, 5e3, 15e3, 30e3]
export const KEEPALIVE = 20e3

async function fetchTicket(fetchImpl, server) {
  const post = (path) => fetchImpl(`${server}/api/v1/${path}`, { method: 'POST', credentials: 'include' })
  let res = await post('browser/ticket')
  // The access token is short-lived; refresh it once, as the web app does.
  if (res.status === 401 && (await post('auth/refresh')).ok) res = await post('browser/ticket')
  if (!res.ok) throw new Error(`the server refused a browser ticket (${res.status})`)
  return (await res.json()).ticket
}

export function createSocket({ chrome, fetchImpl, WebSocketImpl, getServer, onFrame, onOpen, log = console, backoff = BACKOFF, timers = globalThis }) {
  let ws = null
  let connecting = false
  let retry = null
  let keepalive = null
  let attempt = 0
  // Cleared by close(), so a connect already under way does not open anyway.
  let wanted = false

  const stopKeepalive = () => {
    timers.clearInterval(keepalive)
    keepalive = null
  }

  const schedule = () => {
    const delay = backoff[Math.min(attempt++, backoff.length - 1)]
    retry = timers.setTimeout(() => {
      retry = null
      connect()
    }, delay)
  }

  async function connect() {
    connecting = true
    try {
      if (Object.keys(await listShares(chrome)).length === 0) {
        attempt = 0
        return
      }
      const server = await getServer()
      const ticket = await fetchTicket(fetchImpl, server)
      const id = await browserId(chrome)
      if (!wanted) return
      const url = `${server.replace(/^http/, 'ws')}/api/v1/browser/connect?ticket=${encodeURIComponent(ticket)}&browser=${encodeURIComponent(id)}`
      const socket = new WebSocketImpl(url)
      ws = socket
      socket.onopen = () => {
        attempt = 0
        keepalive = timers.setInterval(() => send({ type: 'ping' }), KEEPALIVE)
        onOpen()
      }
      socket.onmessage = (event) => {
        try {
          onFrame(JSON.parse(event.data))
        } catch (err) {
          log.error('AgentRQ: browser socket frame:', err)
        }
      }
      socket.onclose = () => {
        ws = null
        stopKeepalive()
        schedule()
      }
    } catch (err) {
      log.error('AgentRQ: browser socket:', err)
      if (wanted) schedule()
    } finally {
      connecting = false
    }
  }

  /** Open the socket if something is shared and it is not open or on its way. */
  const ensure = async () => {
    wanted = true
    if (ws || connecting || retry) return
    await connect()
  }

  const send = (frame) => {
    if (ws?.readyState !== 1) return false
    ws.send(JSON.stringify(frame))
    return true
  }

  const close = () => {
    wanted = false
    timers.clearTimeout(retry)
    retry = null
    stopKeepalive()
    attempt = 0
    if (!ws) return
    ws.onclose = null
    ws.close()
    ws = null
  }

  return { ensure, send, close }
}
