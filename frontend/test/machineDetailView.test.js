// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * What the machine page does after you start an agent on it.
 *
 * The rules of the launch itself are tested in `agentLaunch.test.js`, and
 * where a terminal lives in `terminalView.test.js`. This is the join between
 * them, and it is the whole point of the page: an agent's first minute is when
 * it asks the questions that stop it dead — trust this folder, allow this
 * tool, paste a key — and a pseudo-terminal is the only place those appear.
 * Launching and staying put leaves somebody watching a row say "starting"
 * while the agent waits for an answer to a question nobody can see it asking.
 *
 * Mounted with plain `createApp` into the jsdom the suite already runs in,
 * the same way `startAgentPanel.test.js` does, so it costs no new dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'm1' } }),
  useRouter: () => ({ push }),
}))

// The page opens a live stream on mount. Nothing here is about the stream, and
// a real EventSource in jsdom is a connection that never resolves.
vi.mock('../src/useEventBus', () => ({
  useEventBus: () => ({ connect() {}, disconnect() {}, onEvent() {} }),
}))

const MACHINE = {
  id: 'm1',
  name: 'workshop-pi',
  enabled: true,
  online: true,
  os: 'linux',
  arch: 'arm64',
  version: '0.7.1',
}
const WORKSPACE = { id: 'ws1', name: 'Ops', agentConnected: false, workingDirectory: '/srv/app' }

let launchResult = { session: { id: 'sess-9', kind: 'claude-code', status: 'starting' } }
const launchAgent = vi.fn(() => Promise.resolve(launchResult))

vi.mock('../src/api', () => ({
  getMachine: () => Promise.resolve({ machine: MACHINE }),
  fetchMachineSessions: () => Promise.resolve({ sessions: [] }),
  fetchWorkspaces: () => Promise.resolve({ workspaces: [WORKSPACE] }),
  launchAgent: (...args) => launchAgent(...args),
  updateMachine: vi.fn(),
  deleteMachine: vi.fn(),
  killSession: vi.fn(),
  approveMachineUpdate: vi.fn(),
  API_BASE_URL: '/api/v1',
}))

const { default: MachineDetailView } = await import('../src/views/MachineDetailView.vue')
// Not mocked: the toast store is module-level state, so the one the page
// writes to is the one read here. It is the only place a refused launch is
// said out loud, since this page renders no error of its own.
const { useToasts } = await import('../src/composables/useToasts')

/** Let the page's own load() and the launch resolve. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({ render: () => h(MachineDetailView) })
  // A blocker renders its fix as a link; the real router is mocked away.
  app.component('RouterLink', {
    props: ['to'],
    setup: (p, { slots }) => () => h('a', {}, slots.default?.()),
  })
  app.mount(el)
  await settle()

  /** Pick a value in a `<select>` the way a person would. */
  const choose = async (id, value) => {
    const select = el.querySelector(`#${id}`)
    select.value = value
    select.dispatchEvent(new Event('change'))
    await settle()
  }

  const clickStart = async () => {
    const button = [...el.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Start agent'
    )
    button.click()
    await settle()
  }

  return { el, choose, clickStart }
}

describe('MachineDetailView: starting an agent', () => {
  beforeEach(() => {
    push.mockClear()
    launchAgent.mockClear()
    launchResult = { session: { id: 'sess-9', kind: 'claude-code', status: 'starting' } }
  })

  it('opens the terminal of the Claude Code session it just started', async () => {
    const { choose, clickStart } = await mount()
    await choose('launch-workspace', 'ws1')
    await clickStart()

    expect(launchAgent).toHaveBeenCalledWith('ws1', expect.objectContaining({ kind: 'claude-code' }))
    expect(push).toHaveBeenCalledWith('/sessions/sess-9')
  })

  it('does the same for a gateway, which asks its own questions on the way up', async () => {
    launchResult = { session: { id: 'sess-10', kind: 'acp-gateway', status: 'starting' } }
    const { choose, clickStart } = await mount()
    await choose('launch-workspace', 'ws1')
    await choose('launch-kind', 'acp-gateway')
    await clickStart()

    expect(launchAgent).toHaveBeenCalledWith('ws1', expect.objectContaining({ kind: 'acp-gateway' }))
    expect(push).toHaveBeenCalledWith('/sessions/sess-10')
  })

  it('stays put when the launch was refused', async () => {
    launchAgent.mockRejectedValueOnce(new Error('that workspace already has an agent'))
    const { choose, clickStart } = await mount()
    await choose('launch-workspace', 'ws1')
    await clickStart()

    expect(push).not.toHaveBeenCalled()
    // And the refusal is said, not swallowed.
    const { toasts } = useToasts()
    expect(toasts.value.at(-1)).toMatchObject({
      type: 'error',
      message: 'that workspace already has an agent',
    })
  })

  it('stays put when the server names no session, rather than opening a dead page', async () => {
    // `/sessions/undefined` resolves, loads, finds nothing and reports that
    // the agent has ended — which is a lie, and worse than staying here.
    launchResult = { session: {} }
    const { choose, clickStart } = await mount()
    await choose('launch-workspace', 'ws1')
    await clickStart()

    expect(launchAgent).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})
