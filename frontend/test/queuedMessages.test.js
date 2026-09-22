// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { describe, it, expect, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

import {
  mergeQueued,
  queueStorageKey,
  useQueuedMessages,
} from '../src/composables/useQueuedMessages'

/** A localStorage stand-in that can be inspected, and made to fail. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  }
}

const TASK_A = { workspaceId: 'ws1', taskId: 'task-a' }
const TASK_B = { workspaceId: 'ws1', taskId: 'task-b' }

const KEY_A = queueStorageKey(TASK_A.workspaceId, TASK_A.taskId)

let storage
let target
let queue

beforeEach(() => {
  storage = fakeStorage()
  target = ref(TASK_A)
  queue = useQueuedMessages({ target: () => target.value, storage })
})

describe('queueStorageKey', () => {
  it('names a key per task, not per workspace', () => {
    expect(queueStorageKey('ws1', 'task-a')).not.toBe(queueStorageKey('ws1', 'task-b'))
  })

  it('names no key without a workspace', () => {
    expect(queueStorageKey('', 'task-a')).toBeNull()
  })

  it('names no key without a task', () => {
    expect(queueStorageKey('ws1', '')).toBeNull()
  })
})

describe('mergeQueued', () => {
  it('returns null for nothing queued', () => {
    expect(mergeQueued([])).toBeNull()
  })

  it('leaves a single message exactly as it was written', () => {
    expect(mergeQueued([{ id: 1, text: 'only this', atts: [] }]).text).toBe('only this')
  })

  it('joins several messages with a blank line, in the order they were written', () => {
    const merged = mergeQueued([
      { id: 1, text: 'first', atts: [] },
      { id: 2, text: 'second', atts: [] },
    ])
    expect(merged.text).toBe('first\n\nsecond')
  })

  it('contributes no empty paragraph for a message that is only an attachment', () => {
    const merged = mergeQueued([
      { id: 1, text: 'look at this', atts: [] },
      { id: 2, text: '', atts: [{ filename: 'one.png' }] },
    ])
    expect(merged.text).toBe('look at this')
  })

  it('collects the attachments of every message it merges', () => {
    const merged = mergeQueued([
      { id: 1, text: 'a', atts: [{ filename: 'one.png' }] },
      { id: 2, text: 'b', atts: [{ filename: 'two.png' }] },
    ])
    expect(merged.atts.map((a) => a.filename)).toEqual(['one.png', 'two.png'])
  })
})

describe('queueing', () => {
  it('holds messages in the order they were written', () => {
    queue.enqueue({ text: 'first' })
    queue.enqueue({ text: 'second' })
    expect(queue.queued.value.map((m) => m.text)).toEqual(['first', 'second'])
  })

  it('gives each message an id of its own, so editing one cannot hit another', () => {
    queue.enqueue({ text: 'first' })
    queue.enqueue({ text: 'second' })
    const [a, b] = queue.queued.value
    expect(a.id).not.toBe(b.id)
  })

  it('defaults a message with no attachments to none rather than undefined', () => {
    queue.enqueue({ text: 'first' })
    expect(queue.queued.value[0].atts).toEqual([])
  })

  it('writes the queue to storage under its own task key', () => {
    queue.enqueue({ text: 'first' })
    expect(JSON.parse(storage.getItem(KEY_A))).toHaveLength(1)
  })
})

describe('editing a queued message', () => {
  it('changes only the message asked for', () => {
    queue.enqueue({ text: 'first' })
    queue.enqueue({ text: 'second' })
    queue.edit(queue.queued.value[0].id, 'rewritten')
    expect(queue.queued.value.map((m) => m.text)).toEqual(['rewritten', 'second'])
  })

  it('persists the rewritten text', () => {
    queue.enqueue({ text: 'first' })
    queue.edit(queue.queued.value[0].id, 'rewritten')
    expect(JSON.parse(storage.getItem(KEY_A))[0].text).toBe('rewritten')
  })

  it('ignores an id that is not queued', () => {
    queue.enqueue({ text: 'first' })
    queue.edit('nope', 'rewritten')
    expect(queue.queued.value[0].text).toBe('first')
  })

  it('drops a message edited down to nothing rather than sending an empty one', () => {
    queue.enqueue({ text: 'first' })
    queue.edit(queue.queued.value[0].id, '   ')
    expect(queue.queued.value).toHaveLength(0)
  })

  it('keeps a message emptied of text when it still carries an attachment', () => {
    queue.enqueue({ text: 'first', atts: [{ filename: 'one.png' }] })
    queue.edit(queue.queued.value[0].id, '')
    expect(queue.queued.value).toHaveLength(1)
  })
})

describe('removing a queued message', () => {
  it('drops just that one', () => {
    queue.enqueue({ text: 'first' })
    queue.enqueue({ text: 'second' })
    queue.remove(queue.queued.value[0].id)
    expect(queue.queued.value.map((m) => m.text)).toEqual(['second'])
  })

  it('forgets the stored copy once the last one is removed', () => {
    queue.enqueue({ text: 'first' })
    queue.remove(queue.queued.value[0].id)
    expect(storage.getItem(KEY_A)).toBeNull()
  })
})

describe('flushing', () => {
  it('hands back one merged message addressed to the task it was written in', () => {
    queue.enqueue({ text: 'first' })
    queue.enqueue({ text: 'second' })
    expect(queue.flush()).toEqual({
      text: 'first\n\nsecond',
      atts: [],
      target: TASK_A,
    })
  })

  it('empties the queue', () => {
    queue.enqueue({ text: 'first' })
    queue.flush()
    expect(queue.queued.value).toEqual([])
  })

  it('forgets the stored copy, so a reload does not send it twice', () => {
    queue.enqueue({ text: 'first' })
    queue.flush()
    expect(storage.getItem(KEY_A)).toBeNull()
  })

  it('hands back nothing when nothing is queued', () => {
    expect(queue.flush()).toBeNull()
  })

  it('addresses the flush to the task the queue was loaded for', async () => {
    queue.enqueue({ text: 'for A' })
    target.value = TASK_B
    await nextTick()
    queue.enqueue({ text: 'for B' })
    expect(queue.flush().target).toEqual(TASK_B)
  })
})

describe('surviving a reload', () => {
  it('loads what the last session left queued', () => {
    queue.enqueue({ text: 'from before' })
    const reopened = useQueuedMessages({ target: () => TASK_A, storage })
    expect(reopened.queued.value.map((m) => m.text)).toEqual(['from before'])
  })

  it('keeps ids unique across the reload', () => {
    queue.enqueue({ text: 'from before' })
    const reopened = useQueuedMessages({ target: () => TASK_A, storage })
    reopened.enqueue({ text: 'and now this' })
    const [a, b] = reopened.queued.value
    expect(a.id).not.toBe(b.id)
  })

  it('reads a queue it cannot parse as an empty one', () => {
    storage.setItem(KEY_A, 'not json')
    const reopened = useQueuedMessages({ target: () => TASK_A, storage })
    expect(reopened.queued.value).toEqual([])
  })

  it('reads a stored value that is not a list as an empty queue', () => {
    storage.setItem(KEY_A, '{"text":"a single message"}')
    const reopened = useQueuedMessages({ target: () => TASK_A, storage })
    expect(reopened.queued.value).toEqual([])
  })
})

describe('switching task', () => {
  it('shows the queue belonging to the task now open', async () => {
    queue.enqueue({ text: 'for A' })
    target.value = TASK_B
    await nextTick()
    expect(queue.queued.value).toEqual([])
  })

  it('leaves the other task\'s queue where it was', async () => {
    queue.enqueue({ text: 'for A' })
    target.value = TASK_B
    await nextTick()
    queue.enqueue({ text: 'for B' })
    target.value = TASK_A
    await nextTick()
    expect(queue.queued.value.map((m) => m.text)).toEqual(['for A'])
  })

  it('stores nothing while no task is open, having nowhere to key it', () => {
    const unopened = useQueuedMessages({ target: () => ({}), storage })
    unopened.enqueue({ text: 'nowhere to put this' })
    expect(storage.data.size).toBe(0)
  })
})

describe('a storage that will not cooperate', () => {
  it('still queues in memory when the write is refused', () => {
    const full = fakeStorage()
    full.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const overflowing = useQueuedMessages({ target: () => TASK_A, storage: full })
    overflowing.enqueue({ text: 'too big to keep' })
    expect(overflowing.queued.value.map((m) => m.text)).toEqual(['too big to keep'])
  })

  it('still queues in memory when there is no storage at all', () => {
    const privateWindow = useQueuedMessages({ target: () => TASK_A, storage: null })
    privateWindow.enqueue({ text: 'nothing to write to' })
    expect(privateWindow.queued.value.map((m) => m.text)).toEqual(['nothing to write to'])
  })

  it('reads an unreadable storage as an empty queue', () => {
    const locked = fakeStorage()
    locked.getItem = () => {
      throw new Error('SecurityError')
    }
    const blocked = useQueuedMessages({ target: () => TASK_A, storage: locked })
    expect(blocked.queued.value).toEqual([])
  })
})
