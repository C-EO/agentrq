// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// The service worker's entry point. Everything it does is in extension.js.
import { install } from './extension.js'

install(globalThis.chrome)
