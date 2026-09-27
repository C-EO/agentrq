// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, createApp, h, nextTick, watch } from 'vue'

const workers = []

vi.mock('../src/workers/whisperWorker.js?worker', () => ({
  default: class FakeWhisperWorker {
    constructor() { workers.push(this) }
    postMessage() {}
  },
}))

vi.mock('../src/api', () => ({
  recordTelemetry: () => {},
  TELEMETRY_LOCAL_AI_RECORDING_END: 'local_ai_recording_end',
}))

const { useSpeechToText } = await import('../src/composables/useSpeechToText')

class FakeRecorder {
  static isTypeSupported() { return true }
  constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm' }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable({ data: new Blob(['x']) })
    this.onstop()
  }
}

class FakeAudioContext {
  constructor() { this.state = 'running' }
  decodeAudioData() { return Promise.resolve({ duration: 1 }) }
  close() { return Promise.resolve() }
}

class FakeOfflineContext {
  createBufferSource() { return { connect() {}, start() {} } }
  startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(4) }) }
}

const apps = []
// Records, stops and has the worker answer with `transcript`.
const dictate = async (body, input, transcript) => {
  let stt
  const app = createApp({ setup() { stt = useSpeechToText(body, 'ws1', input); return () => h('div') } })
  app.mount(document.createElement('div'))
  apps.push(app)
  stt.toggleRecording()
  await vi.waitFor(() => expect(stt.isRecording.value).toBe(true))
  stt.toggleRecording()
  await vi.waitFor(() => expect(workers.length).toBe(1))
  workers[0].onmessage({ data: { status: 'complete', text: transcript } })
  await nextTick()
}

beforeEach(() => {
  workers.length = 0
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
  })
  vi.stubGlobal('Worker', class {})
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext)
})

afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  vi.unstubAllGlobals()
})

describe('useSpeechToText', () => {
  it('puts the transcript at the cursor and leaves the cursor after it', async () => {
    const body = ref('fix login page')
    const el = document.createElement('textarea')
    document.body.appendChild(el)
    el.value = body.value
    el.setSelectionRange(3, 3)
    // Stands in for v-model, whose update sends the cursor to the end.
    const stop = watch(body, (v) => { el.value = v })

    await dictate(body, ref(el), 'the')

    expect(body.value).toBe('fix the login page')
    expect(el.value).toBe('fix the login page')
    expect([el.selectionStart, el.selectionEnd]).toEqual([7, 7])
    stop()
    el.remove()
  })

  it('appends when it is given no field', async () => {
    const body = ref('fix')
    await dictate(body, undefined, 'login')
    expect(body.value).toBe('fix login')
  })
})
