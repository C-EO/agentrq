// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// The popup's entry point. Everything it does is in popup.js.
import { initPopup } from './popup.js'

initPopup({
  doc: globalThis.document,
  chrome: globalThis.chrome,
  fetchImpl: (...args) => globalThis.fetch(...args),
  close: () => globalThis.close(),
})
