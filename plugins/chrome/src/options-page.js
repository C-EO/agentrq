// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// The options page's entry point. Everything it does is in options.js.
import { initOptions } from './options.js'

initOptions(globalThis.document, globalThis.chrome, (...args) => globalThis.fetch(...args))
