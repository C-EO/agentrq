// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Restarting and updating a machine's daemon from its page, which only a
 * daemon of 0.9.3 or newer can be asked to do.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'm1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../src/useEventBus', () => ({
  useEventBus: () => ({ connect() {}, disconnect() {}, onEvent() {} }),
}))

let machine
const restartMachine = vi.fn()
const approveMachineUpdate = vi.fn()

vi.mock('../src/api', () => ({
  getMachine: () => Promise.resolve({ machine }),
  fetchMachineSessions: () => Promise.resolve({ sessions: [] }),
  fetchWorkspaces: () => Promise.resolve({ workspaces: [] }),
  launchAgent: vi.fn(),
  fetchAcpAgents: () => Promise.resolve({ agents: [] }),
  fetchAcpModels: () => Promise.resolve({ agent: '', models: [] }),
  updateMachine: vi.fn(),
  deleteMachine: vi.fn(),
  killSession: vi.fn(),
  approveMachineUpdate: (...args) => approveMachineUpdate(...args),
  restartMachine: (...args) => restartMachine(...args),
  API_BASE_URL: '/api/v1',
}))

const { default: MachineDetailView } = await import('../src/views/MachineDetailView.vue')
const { useToasts } = await import('../src/composables/useToasts')

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

let app
async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  app = createApp({ render: () => h(MachineDetailView) })
  app.component('RouterLink', { props: ['to'], setup: (p, { slots }) => () => h('a', {}, slots.default?.()) })
  app.mount(el)
  await settle()
  const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  const click = async (label) => {
    button(label).click()
    await settle()
  }
  return { el, button, click }
}

const lastToast = () => useToasts().toasts.value.at(-1)

beforeEach(() => {
  machine = { id: 'm1', name: 'pi', enabled: true, online: true, os: 'linux', arch: 'arm64', version: '0.9.3' }
  restartMachine.mockReset().mockResolvedValue(true)
  approveMachineUpdate.mockReset().mockResolvedValue(true)
})
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})

describe('MachineDetailView: restarting the daemon', () => {
  it('asks, and says so, after a confirm that names what it stops', async () => {
    const page = await mount()
    await page.click('Settings')
    await page.click('Restart')

    expect(document.body.textContent).toContain('Restart agentrqd')
    expect(document.body.textContent).toContain('Nothing is running on it')
    expect(restartMachine).not.toHaveBeenCalled()

    // The confirm button, which says what it does rather than "Delete".
    const confirm = [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Restart').at(-1)
    confirm.click()
    await settle()

    expect(restartMachine).toHaveBeenCalledWith('m1')
    expect(lastToast().message).toContain('restarting')
  })

  it('says why when the machine refused', async () => {
    restartMachine.mockRejectedValue(new Error('that machine is not connected'))
    const page = await mount()
    await page.click('Settings')
    await page.click('Restart')
    ;[...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Restart').at(-1).click()
    await settle()

    expect(lastToast().message).toBe('that machine is not connected')
  })

  it('cannot be pressed while the machine is offline', async () => {
    machine.online = false
    const page = await mount()
    await page.click('Settings')
    expect(page.button('Restart').disabled).toBe(true)
  })

  it('tells an older daemon to be updated by hand instead', async () => {
    machine.version = '0.9.2'
    machine.availableVersion = '0.9.3'
    const page = await mount()
    await page.click('Settings')

    expect(page.button('Restart')).toBe(undefined)
    expect(page.button('Update and restart')).toBe(undefined)
    expect(page.el.textContent).toContain('by hand to 0.9.3 or newer')
  })
})

describe('MachineDetailView: updating the daemon', () => {
  it('installs the offered version after a confirm', async () => {
    machine.availableVersion = '0.9.4'
    const page = await mount()
    await page.click('Update and restart')
    await page.click('Update')

    expect(approveMachineUpdate).toHaveBeenCalledWith('m1', '0.9.4')
    expect(lastToast().message).toContain('updating')
  })

  it('says why when the update was refused', async () => {
    machine.availableVersion = '0.9.4'
    approveMachineUpdate.mockRejectedValue(new Error('that machine has not offered that update'))
    const page = await mount()
    await page.click('Update and restart')
    await page.click('Update')

    expect(lastToast().message).toBe('that machine has not offered that update')
  })
})
