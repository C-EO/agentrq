// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The board's columns, mounted: the order they draw in and what a drop saves.
 *
 * The ordering rules are tested in `kanbanOrder.test.js`. This is the join
 * that decides which rule a column uses and which call a drop makes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'ws1' }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

const events = ref([])
vi.mock('../src/useEventBus', () => ({
  useEventBus: () => ({ connect() {}, disconnect() {}, events }),
}))

vi.mock('../src/composables/useCachedTasks', () => ({
  cacheTasks: () => {},
  sharedCache: () => null,
}))
vi.mock('../src/composables/useCachedReads', () => ({
  readCachedTasks: () => Promise.resolve([]),
  shouldPaintCache: () => false,
}))

let byStatus = {}
const updateTaskStatus = vi.fn()
const updateTaskOrder = vi.fn(() => Promise.resolve({}))

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchTasks: (_ws, { status }) => Promise.resolve({ tasks: byStatus[status] || [] }),
  updateTaskStatus: (...args) => updateTaskStatus(...args),
  updateTaskOrder: (...args) => updateTaskOrder(...args),
}))

const { default: KanbanBoardView } = await import('../src/views/KanbanBoardView.vue')

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

let app
async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  app = createApp({ render: () => h(KanbanBoardView) })
  app.use(createPinia())
  app.directive('click-outside', {})
  app.mount(el)
  await settle()

  const column = (title) =>
    [...el.querySelectorAll('h3')].find((n) => n.textContent.trim() === title).closest('.rounded-xl')
  const inColumn = (title, text) =>
    [...column(title).querySelectorAll('[draggable]')].some((c) => c.textContent.includes(text))
  const card = (text) => [...el.querySelectorAll('[draggable]')].find((c) => c.textContent.includes(text))

  const fire = (target, type) => {
    const e = new Event(type, { bubbles: true, cancelable: true })
    e.dataTransfer = { setData() {}, effectAllowed: '' }
    e.clientY = 0
    target.dispatchEvent(e)
  }
  /** Drag `text`'s card and drop it just above `beforeText`'s, or at the end of `colTitle`. */
  const drag = async (text, { before, into }) => {
    fire(card(text), 'dragstart')
    await settle()
    if (before) fire(card(before), 'dragover')
    else fire(column(into), 'dragover')
    await settle()
    fire(before ? card(before) : column(into), 'drop')
    await settle()
  }
  return { el, inColumn, drag }
}

const task = (id, status, extra = {}) => ({
  id,
  title: `Task ${id}`,
  status,
  assignee: 'agent',
  workspaceId: 'ws1',
  createdAt: '2026-09-20T10:00:00Z',
  messages: [],
  ...extra,
})

const order = (text, el) =>
  [...el.querySelectorAll('[draggable]')].map((c) => c.textContent).findIndex((t) => t.includes(text))

describe('KanbanBoardView', () => {
  beforeEach(() => {
    if (app) app.unmount()
    document.body.innerHTML = ''
    localStorage.clear()
    events.value = []
    updateTaskStatus.mockReset()
    updateTaskOrder.mockClear()
    byStatus = {
      notstarted: [
        task('n1', 'notstarted', { sortOrder: 100 }),
        task('n2', 'notstarted', { sortOrder: 200 }),
        task('n3', 'notstarted', { sortOrder: 300 }),
      ],
      ongoing: [task('o1', 'ongoing', { sortOrder: 50, updatedAt: '2026-09-27T09:00:00Z' })],
      'completed,rejected': [
        // Created (and so positioned) oldest first, finished in the other order.
        task('d1', 'completed', { sortOrder: 1, updatedAt: '2026-09-25T10:00:00Z' }),
        task('d2', 'rejected', { sortOrder: 2, updatedAt: '2026-09-26T10:00:00Z' }),
        task('d3', 'completed', { sortOrder: 3, updatedAt: '2026-09-27T10:00:00Z' }),
      ],
    }
  })

  it('lists Done with the most recently finished task first', async () => {
    const { el } = await mount()
    expect(order('Task d3', el)).toBeLessThan(order('Task d2', el))
    expect(order('Task d2', el)).toBeLessThan(order('Task d1', el))
  })

  it('saves the midpoint when a Not Started card is dragged between two others', async () => {
    const { el, drag } = await mount()
    await drag('Task n3', { before: 'Task n2' })

    expect(updateTaskOrder).toHaveBeenCalledWith('ws1', 'n3', 150)
    expect(updateTaskStatus).not.toHaveBeenCalled()
    expect(order('Task n3', el)).toBeLessThan(order('Task n2', el))
  })

  it('puts a card dropped into Done at the top, with the server’s timestamp', async () => {
    updateTaskStatus.mockResolvedValue({
      task: task('o1', 'completed', { sortOrder: 50, updatedAt: '2026-09-27T11:00:00Z' }),
    })
    const { el, drag } = await mount()
    await drag('Task o1', { into: 'Done' })

    expect(updateTaskStatus).toHaveBeenCalledWith('ws1', 'o1', 'completed')
    expect(updateTaskOrder).not.toHaveBeenCalled()
    expect(order('Task o1', el)).toBeLessThan(order('Task d3', el))
  })

  it('puts a card back where it was when the move into Done fails', async () => {
    updateTaskStatus.mockRejectedValue(new Error('nope'))
    const { inColumn, drag } = await mount()
    await drag('Task o1', { into: 'Done' })

    const { useToasts } = await import('../src/composables/useToasts')
    expect(useToasts().toasts.value.at(-1).message).toContain('nope')
    expect(inColumn('Ongoing', 'Task o1')).toBe(true)
    expect(inColumn('Done', 'Task o1')).toBe(false)
  })

  it('saves nothing for a drag within Done, which is not ordered by hand', async () => {
    const { el, drag } = await mount()
    await drag('Task d1', { before: 'Task d3' })

    expect(updateTaskOrder).not.toHaveBeenCalled()
    expect(updateTaskStatus).not.toHaveBeenCalled()
    expect(order('Task d3', el)).toBeLessThan(order('Task d1', el))
  })
})
