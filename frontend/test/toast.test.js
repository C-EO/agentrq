// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * A notification you can't act on is a dead end: the person has to go find
 * the task themselves. This is the other half of the fix in
 * useStreamToasts.toastFor — that decides *whether* a toast links to a task,
 * this is where clicking one actually goes there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

const { default: Toast } = await import('../src/components/Toast.vue')
const { useToasts } = await import('../src/composables/useToasts')

async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({ render: () => h(Toast) })
  app.mount(el)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return el
}

describe('Toast', () => {
  beforeEach(() => {
    push.mockClear()
    // The toast list is module-level state shared with useStreamToasts'
    // caller — clear it so one test's toast doesn't linger into the next.
    const { toasts } = useToasts()
    toasts.value = []
  })

  it('is not clickable with nowhere to link to', async () => {
    useToasts().notifyInfo('New reply on "Ship it"')
    const el = await mount()

    const toast = el.querySelector('.toast')
    expect(toast.classList.contains('clickable')).toBe(false)

    toast.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(push).not.toHaveBeenCalled()
  })

  it('navigates to the task on click, and dismisses itself', async () => {
    useToasts().notifyInfo('New reply on "Ship it"', 'Notice', { taskId: 't1', workspaceId: 'w1' })
    const el = await mount()

    const toast = el.querySelector('.toast')
    expect(toast.classList.contains('clickable')).toBe(true)

    toast.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(push).toHaveBeenCalledWith('/workspaces/w1/tasks/t1')
    expect(useToasts().toasts.value).toHaveLength(0)
  })

  it('stays put when only the workspace is known', async () => {
    useToasts().notifyInfo('Agent could not start', 'Error', { taskId: '', workspaceId: 'w1' })
    const el = await mount()

    expect(el.querySelector('.toast').classList.contains('clickable')).toBe(false)
  })

  it('dismisses without navigating when the close button is used', async () => {
    useToasts().notifyInfo('New reply on "Ship it"', 'Notice', { taskId: 't1', workspaceId: 'w1' })
    const el = await mount()

    el.querySelector('.toast-close').click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(push).not.toHaveBeenCalled()
    expect(useToasts().toasts.value).toHaveLength(0)
  })
})
