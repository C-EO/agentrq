// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

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
  it('offers "View task" only when the toast links to one', async () => {
    const { addToast } = useToasts()
    addToast('no link', 'info', 'A')
    addToast('linked', 'info', 'B', 4000, { taskId: 't1', workspaceId: 'w1' })
    const el = await mount()
    const links = [...el.querySelectorAll('.toast')].map((t) => t.querySelector('.toast-link')?.textContent ?? null)
    expect(links).toEqual([null, 'View task'])
  })

  it('keeps the whole message on hover, since only two lines show', async () => {
    const long = 'word '.repeat(80).trim()
    useToasts().addToast(long, 'error', 'Error')
    const el = await mount()
    expect(el.querySelector('.toast-message').getAttribute('title')).toBe(long)
  })

  it('counts down for as long as the toast stays', async () => {
    const { addToast } = useToasts()
    addToast('short', 'success', 'Saved', 2500)
    addToast('sticky', 'info', 'Wait', 0)
    const el = await mount()
    const [short, sticky] = el.querySelectorAll('.toast')
    expect(short.querySelector('.toast-progress').style.animationDuration).toBe('2500ms')
    expect(sticky.querySelector('.toast-progress')).toBeNull()
  })
  it('shows no title unless given one, since the icon names the type', async () => {
    const { notifyError, notifySuccess, notifyInfo } = useToasts()
    notifyError('Could not save')
    notifySuccess('Saved')
    notifyInfo('Heads up')
    notifyInfo('Agent is waiting', 'Action Needed')
    const el = await mount()
    const titles = [...el.querySelectorAll('.toast')].map((t) => t.querySelector('.toast-title')?.textContent ?? null)
    expect(titles).toEqual([null, null, null, 'Action Needed'])
    expect(el.querySelectorAll('.toast-message.solo')).toHaveLength(3)
  })
  it('keeps an error up for 20 seconds and anything else for 4', async () => {
    vi.useFakeTimers()
    try {
      const { notifyError, notifySuccess, addToast, toasts } = useToasts()
      notifyError('Could not move the task')
      addToast('Model not available', 'error')
      notifySuccess('Saved')
      expect(toasts.value.map((t) => t.duration)).toEqual([20000, 20000, 4000])

      vi.advanceTimersByTime(4000)
      expect(toasts.value.map((t) => t.message)).toEqual(['Could not move the task', 'Model not available'])
      vi.advanceTimersByTime(16000)
      expect(toasts.value).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the task from anywhere on the card, not only "View task"', async () => {
    useToasts().notifyError('Agent crashed', 'Agent could not start', { taskId: 't9', workspaceId: 'w2' })
    const el = await mount()
    el.querySelector('.toast-message').click()
    expect(push).toHaveBeenCalledWith('/workspaces/w2/tasks/t9')
  })
})
