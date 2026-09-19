// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Where the terminal's padding is allowed to live.
 *
 * The fit addon measures the host's border-box height, so padding on the host
 * is counted but undrawable and the bottom row is clipped — measured at 75% of
 * window heights. jsdom does no layout, so this asserts the arrangement rather
 * than the pixels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h } from 'vue'

/** The element the terminal was opened on. */
let openedOn = null

// jsdom has no ResizeObserver; without this the mount throws.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor() {
      this.cols = 80
      this.rows = 24
    }
    loadAddon() {}
    open(el) {
      openedOn = el
    }
    onData() {}
    write() {}
    reset() {}
    focus() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 }
    }
    fit() {}
  },
}))

vi.mock('../src/api', () => ({
  terminalSocketUrl: () => Promise.resolve('ws://localhost/ignored'),
}))

vi.mock('../src/composables/useTerminalSession', () => ({
  VIEWER_SESSION: 0,
  useTerminalSession: () => ({
    open: () => {},
    close: () => {},
    sendInput: () => {},
    sendResize: () => {},
  }),
}))

const { default: SessionTerminal } = await import('../src/components/SessionTerminal.vue')

/** Mount it into the jsdom the suite already runs in. */
function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({
    render: () => h(SessionTerminal, { sessionId: 'abc123', ended: false }),
  })
  app.mount(el)
  return { app, el }
}

/** Tailwind padding classes, in any of the forms that would break this. */
const PADDING = /^(p|py|pt|pb)-/

describe('the terminal host', () => {
  beforeEach(() => {
    openedOn = null
    document.body.innerHTML = ''
  })

  it('is the element the terminal is opened on', () => {
    const { app } = mount()
    expect(openedOn).toBeTruthy()
    app.unmount()
  })

  it('carries no vertical padding of its own', () => {
    const { app } = mount()

    const offenders = [...openedOn.classList].filter((c) => PADDING.test(c))
    expect(offenders).toEqual([])

    app.unmount()
  })

  it('sits inside a wrapper that has the padding instead', () => {
    const { app } = mount()

    const wrapper = openedOn.parentElement
    const padding = [...wrapper.classList].filter((c) => PADDING.test(c))
    expect(padding.length).toBeGreaterThan(0)

    app.unmount()
  })

  it('keeps a height that does not come from its content', () => {
    const { app } = mount()

    expect([...openedOn.classList]).toContain('min-h-0')
    expect([...openedOn.classList]).toContain('flex-1')

    app.unmount()
  })
})
