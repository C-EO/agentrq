// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// Upload the packaged extension to the Chrome Web Store and submit it for
// review. Everything it does is in webstore.js.
import { readFile } from 'node:fs/promises'

import { main } from './webstore.js'

const state = await main(process.env, {
  fetchImpl: fetch,
  readFile,
  sleep: () => new Promise((resolve) => setTimeout(resolve, 5000)),
  log: console.log,
})
console.log(`Submitted: ${state}`)
