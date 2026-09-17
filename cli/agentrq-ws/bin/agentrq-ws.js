#!/usr/bin/env node
// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { run } from '../src/cli.js'

// `agentrq-ws tools | head -1` closes the pipe while we are still writing to
// it, and an unhandled EPIPE turns an ordinary shell idiom into a stack trace
// and a failed exit. Piping into something that stops reading is the reader's
// decision, not an error here.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') process.exit(0)
    throw err
  })
}

process.exitCode = await run({ argv: process.argv.slice(2) })
