// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * What the composer does with a message written while the agent is working.
 *
 * The rules of the queue itself are tested in `queuedMessages.test.js`, and
 * when a turn is running in `agentTurn.test.js`. This is the join between
 * them, and it is the whole point of the feature: the promise made to someone
 * typing mid-turn is that **nothing is sent yet**. A wiring mistake that posts
 * the message anyway keeps every unit test green while breaking the only thing
 * the feature claims — the gateway would chain it behind the running turn,
 * where it can no longer be read back or changed.
 *
 * Mounted with plain `createApp` into the jsdom the suite already runs in, the
 * same way `machineDetailView.test.js` does, so it costs no new dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'ws1', taskId: 't1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

// The page opens a live stream on mount. The events are pushed by hand below,
// and a real EventSource in jsdom is a connection that never resolves.
const events = ref([])
vi.mock('../src/useEventBus', () => ({
  useEventBus: () => ({ connect() {}, disconnect() {}, events }),
}))

// Transformers.js behind the mic is a model download, and nothing here is
// about speech.
vi.mock('../src/composables/useSpeechToText', () => ({
  useSpeechToText: () => ({
    isRecording: ref(false),
    isTranscribing: ref(false),
    isModelLoading: ref(false),
    modelProgress: ref(0),
    error: ref(null),
    isSupported: ref(false),
    toggleRecording: vi.fn(),
  }),
}))

// IndexedDB is absent in jsdom, and the local copy is not what is being read.
vi.mock('../src/composables/useCachedTasks', () => ({
  cacheTask: vi.fn(),
  cacheTaskUpdate: (_cache, current, payload) => ({ ...current, ...payload }),
  sharedCache: () => null,
}))

const WORKSPACE = { id: 'ws1', name: 'Ops', agentConnected: true, agentSupportsStop: true }

const fromHuman = (id) => ({ id, sender: 'human', text: 'do the thing', createdAt: '2026-09-22T07:00:00Z' })
const usageFooter = (id) => ({
  id,
  sender: 'agent',
  text: '',
  metadata: { type: 'agent_usage' },
  createdAt: '2026-09-22T07:01:00Z',
})

/** A task whose agent is mid-turn: somebody spoke, and no footer has landed. */
const workingTask = () => ({
  id: 't1',
  title: 'Ship it',
  status: 'ongoing',
  assignee: 'agent',
  body: '',
  messages: [fromHuman('h1')],
  toolCalls: [],
})

const respondToTask = vi.fn(() => Promise.resolve({ task: workingTask() }))

vi.mock('../src/api', () => ({
  getWorkspace: () => Promise.resolve({ workspace: WORKSPACE }),
  getTask: () => Promise.resolve({ task: workingTask() }),
  fetchUser: () => Promise.resolve({ id: 'u1', name: 'Dev' }),
  fetchTasks: () => Promise.resolve({ tasks: [] }),
  respondToTask: (...args) => respondToTask(...args),
  getAttachmentUrl: () => '',
  getWorkspaceToken: vi.fn(),
  archiveWorkspace: vi.fn(),
  unarchiveWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskAssignee: vi.fn(),
  sendPermissionVerdict: vi.fn(),
  respondToElicitation: vi.fn(),
  stopTask: vi.fn(),
  updateTaskAllowAllCommands: vi.fn(),
  TELEMETRY_UI_COPY_MARKDOWN: 'ui.copy_markdown',
  TELEMETRY_UI_SHORTCUT_USE: 'ui.shortcut_use',
  TELEMETRY_UI_TRAJECTORY_VIEW: 'ui.trajectory_view',
  API_BASE_URL: '/api/v1',
}))

const { default: TaskDetailView } = await import('../src/views/TaskDetailView.vue')

/** Let the page's own load() and any delivery resolve. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

/**
 * Every page mounted in this file, so each test starts with one.
 *
 * Left mounted, an earlier page is still listening to `events` and still
 * holding its own queue, so ending the turn once would deliver once per test
 * that had run so far.
 */
const mounted = []

async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({ render: () => h(TaskDetailView) })
  mounted.push(app)
  app.use(createPinia())
  app.component('RouterLink', {
    props: ['to'],
    setup: (p, { slots }) => () => h('a', {}, slots.default?.()),
  })
  // Registered by `app.js` in the real application, which this mount bypasses.
  app.directive('click-outside', {})
  app.mount(el)
  await settle()

  const composer = () => el.querySelector('textarea')
  const buttonsSaying = (label) =>
    [...el.querySelectorAll('button')].filter((b) => b.textContent.trim() === label)

  /** Type into the composer and submit, the way the send button does. */
  const send = async (text) => {
    const box = composer()
    box.value = text
    box.dispatchEvent(new Event('input'))
    await settle()
    el.querySelector('form').dispatchEvent(new Event('submit'))
    await settle()
  }

  const click = async (label, index = 0) => {
    buttonsSaying(label)[index].click()
    await settle()
  }

  /** One per queued message, found by the label only a queued bubble wears. */
  const queuedBubbles = () =>
    [...el.querySelectorAll('span')].filter((s) => s.textContent.trim().startsWith('Queued ·'))

  /** What the turn ending looks like from the server. */
  const endTheTurn = async () => {
    events.value = [
      ...events.value,
      {
        type: 'task.updated',
        payload: { ...workingTask(), messages: [fromHuman('h1'), usageFooter('u1')] },
      },
    ]
    await settle()
  }

  return { el, composer, send, click, queuedBubbles, endTheTurn, buttonsSaying,
    text: () => el.textContent.replace(/\s+/g, ' ').trim() }
}

beforeEach(() => {
  while (mounted.length) mounted.pop().unmount()
  document.body.innerHTML = ''
  // The queue is kept on disk on purpose, so it outlives a test as readily as
  // it outlives a reload.
  localStorage.clear()
  events.value = []
  respondToTask.mockClear()
})

describe('the composer while the agent is working', () => {
  it('takes the message instead of refusing it', async () => {
    const { composer } = await mount()
    expect(composer().disabled).toBe(false)
  })

  // The promise the whole feature makes. Posted now, the gateway chains it
  // behind the running turn, unseen and no longer editable.
  it('sends nothing to the server', async () => {
    const { send } = await mount()
    await send('actually, do it the other way')
    expect(respondToTask).not.toHaveBeenCalled()
  })

  it('shows the message in the thread, marked as queued', async () => {
    const { send, text } = await mount()
    await send('actually, do it the other way')
    expect(text()).toContain('actually, do it the other way')
    expect(text()).toMatch(/Queued/)
  })

  it('empties the composer, so the message is in one place only', async () => {
    const { send, composer } = await mount()
    await send('actually, do it the other way')
    expect(composer().value).toBe('')
  })

  it('offers the stop as well as the send', async () => {
    const { el } = await mount()
    expect(el.querySelector('button[title^="Stop the agent"]')).not.toBeNull()
    expect(el.querySelector('button[type="submit"]')).not.toBeNull()
  })

  it('queues a second message rather than replacing the first', async () => {
    const { send, queuedBubbles } = await mount()
    await send('first thought')
    await send('second thought')
    expect(queuedBubbles()).toHaveLength(2)
  })

  it('offers every queued message its own edit', async () => {
    const { send, buttonsSaying } = await mount()
    await send('first thought')
    await send('second thought')
    expect(buttonsSaying('Edit')).toHaveLength(2)
  })
})

describe('changing a queued message', () => {
  it('rewrites it in place', async () => {
    const { el, send, click, text } = await mount()
    await send('first thought')
    await click('Edit')

    const box = [...el.querySelectorAll('textarea')].find((t) => t.value === 'first thought')
    box.value = 'better thought'
    box.dispatchEvent(new Event('input'))
    await click('Save')

    expect(text()).toContain('better thought')
    expect(text()).not.toContain('first thought')
  })

  it('leaves it alone when the edit is abandoned', async () => {
    const { el, send, click, text } = await mount()
    await send('first thought')
    await click('Edit')

    const box = [...el.querySelectorAll('textarea')].find((t) => t.value === 'first thought')
    box.value = 'never mind'
    box.dispatchEvent(new Event('input'))
    await click('Cancel')

    expect(text()).toContain('first thought')
  })

  it('edits the one asked for, not the first in the queue', async () => {
    const { el, send, click, text } = await mount()
    await send('first thought')
    await send('second thought')
    await click('Edit', 1)

    const box = [...el.querySelectorAll('textarea')].find((t) => t.value === 'second thought')
    box.value = 'revised second'
    box.dispatchEvent(new Event('input'))
    await click('Save')

    expect(text()).toContain('first thought')
    expect(text()).toContain('revised second')
  })

  it('drops the one deleted and keeps the rest', async () => {
    const { send, click, text } = await mount()
    await send('first thought')
    await send('second thought')
    await click('Delete', 0)

    expect(text()).not.toContain('first thought')
    expect(text()).toContain('second thought')
  })
})

describe('when the turn ends', () => {
  // One per turn, not all at once. Sending the rest now would chain them
  // behind the turn this one starts — the thing the queue exists to prevent —
  // and take away the chance to change them.
  it('sends only the first, and leaves the rest queued', async () => {
    const { send, endTheTurn, queuedBubbles } = await mount()
    await send('first thought')
    await send('second thought')
    await endTheTurn()

    expect(respondToTask).toHaveBeenCalledTimes(1)
    expect(respondToTask.mock.calls[0][3]).toBe('first thought')
    expect(queuedBubbles()).toHaveLength(1)
  })

  it('sends the next one when the next turn ends', async () => {
    const { send, endTheTurn } = await mount()
    await send('first thought')
    await send('second thought')
    await endTheTurn()
    await endTheTurn()

    expect(respondToTask.mock.calls.map((c) => c[3])).toEqual(['first thought', 'second thought'])
  })

  // The whole reason for one at a time: what is still queued is still yours.
  it('sends a message rewritten after the one before it had gone', async () => {
    const { el, send, click, endTheTurn } = await mount()
    await send('first thought')
    await send('second thought')
    await endTheTurn()

    await click('Edit')
    const box = [...el.querySelectorAll('textarea')].find((t) => t.value === 'second thought')
    box.value = 'on reflection, this instead'
    box.dispatchEvent(new Event('input'))
    await click('Save')
    await endTheTurn()

    expect(respondToTask.mock.calls[1][3]).toBe('on reflection, this instead')
  })

  it('sends it to the task it was written in', async () => {
    const { send, endTheTurn } = await mount()
    await send('first thought')
    await endTheTurn()

    expect(respondToTask.mock.calls[0].slice(0, 3)).toEqual(['ws1', 't1', 'text'])
  })

  it('sends the edited text rather than what was first typed', async () => {
    const { el, send, click, endTheTurn } = await mount()
    await send('first thought')
    await click('Edit')

    const box = [...el.querySelectorAll('textarea')].find((t) => t.value === 'first thought')
    box.value = 'better thought'
    box.dispatchEvent(new Event('input'))
    await click('Save')
    await endTheTurn()

    expect(respondToTask.mock.calls[0][3]).toBe('better thought')
  })

  it('leaves nothing queued behind', async () => {
    const { send, endTheTurn, queuedBubbles } = await mount()
    await send('first thought')
    await endTheTurn()

    expect(queuedBubbles()).toHaveLength(0)
  })

  it('sends nothing when nothing was queued', async () => {
    const { endTheTurn } = await mount()
    await endTheTurn()

    expect(respondToTask).not.toHaveBeenCalled()
  })
})
