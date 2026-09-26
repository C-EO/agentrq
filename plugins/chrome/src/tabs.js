// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * What each tab's page offers, which tab of a site was used last, and the calls
 * waiting on a tab. It lives in the worker's memory; after a restart a tab is
 * known again once its page announces its tools.
 */

export const BADGE_COLOR = '#16a34a'
export const CALL_WAIT = 60_000

export function createTabs(chrome, timers = globalThis) {
  const tabs = new Map() // tabId → { origin, url, tools, used }
  const calls = new Map() // callId → { tabId, settle }
  const waiters = new Set() // { origin, tool, resolve }
  let clock = 0

  const has = (entry, origin, tool) => entry.origin === origin && entry.tools.some((t) => t.name === tool)

  const badge = (tabId) => {
    const count = tabs.get(tabId)?.tools.length ?? 0
    chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' })
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR })
  }

  const set = (tabId, origin, url, tools) => {
    const used = tabs.get(tabId)?.used ?? 0
    const entry = { origin, url, tools, used }
    tabs.set(tabId, entry)
    badge(tabId)
    for (const w of waiters) if (has(entry, w.origin, w.tool)) w.resolve(tabId)
  }

  const touch = (tabId) => {
    const entry = tabs.get(tabId)
    if (entry) entry.used = ++clock
  }

  const remove = (tabId) => {
    const entry = tabs.get(tabId)
    if (!entry) return
    tabs.delete(tabId)
    for (const [callId, call] of calls) {
      if (call.tabId === tabId) call.settle({ error: `the ${entry.origin} tab was closed during the call` })
    }
  }

  const toolsFor = (tabId) => tabs.get(tabId)?.tools ?? []

  /** The most recently used tab of origin with tools, or with `tool` if named. */
  const bestTab = (origin, tool) => {
    let best = null
    for (const [tabId, entry] of tabs) {
      const fits = tool ? has(entry, origin, tool) : entry.origin === origin && entry.tools.length > 0
      if (fits && (best === null || entry.used > tabs.get(best).used)) best = tabId
    }
    return best
  }

  const waitForTool = (origin, tool, ms) => {
    const now = bestTab(origin, tool)
    if (now !== null) return Promise.resolve(now)
    return new Promise((resolve, reject) => {
      const waiter = { origin, tool }
      const timer = timers.setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error(`no ${origin} tab registered ${tool} within ${ms / 1000} seconds (the site may have changed, or you may be signed out of it)`))
      }, ms)
      waiter.resolve = (tabId) => {
        timers.clearTimeout(timer)
        waiters.delete(waiter)
        resolve(tabId)
      }
      waiters.add(waiter)
    })
  }

  /** A call sent to tabId: resolves to its { text } or { error }. */
  const expect = (callId, tabId) =>
    new Promise((resolve) => {
      const timer = timers.setTimeout(() => settle({ error: `no result within ${CALL_WAIT / 1000} seconds` }), CALL_WAIT)
      const settle = (result) => {
        timers.clearTimeout(timer)
        calls.delete(callId)
        resolve(result)
      }
      calls.set(callId, { tabId, settle })
    })

  /** A result from tabId; one from any other tab is not this call's. */
  const deliver = (callId, tabId, result) => {
    const call = calls.get(callId)
    if (call?.tabId === tabId) call.settle(result)
  }

  return { set, touch, remove, toolsFor, bestTab, waitForTool, expect, deliver, badge, entry: (tabId) => tabs.get(tabId) }
}
