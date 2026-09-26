// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// The bridge: ISOLATED world, document_start, top frame. It relays between the
// page observer and the service worker.
//
// The channel is a DOM event whose type is a nonce the observer takes before any
// page script runs, so the page can neither listen to it nor forge it. Chrome
// runs document_start scripts in the order of their ids, not of registration,
// so this one's id must sort before the observer's.
;(() => {
  const nonce = crypto.randomUUID()
  document.documentElement.dataset.agentrqNonce = nonce

  // To the service worker. Nobody listening, or an extension reloaded under the
  // page, is not the page's problem.
  const send = (message) => {
    try {
      chrome.runtime.sendMessage(message).catch(() => {})
    } catch {}
  }

  const relayed = new Map([
    ['tools', ({ tools }) => ({ type: 'site-tools', tools })],
    ['result', ({ callId, text, error }) => ({ type: 'site-result', callId, text, error })],
  ])

  document.addEventListener(nonce, (event) => {
    let message
    try {
      message = JSON.parse(event.detail)
    } catch {
      return
    }
    const relay = message?.source === 'agentrq-observer' && relayed.get(message.type)
    if (relay) send(relay(message))
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'site-call') return
    const { callId, tool, arguments: args } = message
    const detail = JSON.stringify({ source: 'agentrq-bridge', type: 'call', callId, tool, arguments: args })
    document.dispatchEvent(new CustomEvent(nonce, { detail }))
  })
})()
