// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { createRequire } from 'node:module'

/**
 * The CLI's version, read from its own package.json.
 *
 * This package rides the repository's release tags rather than carrying a
 * version of its own, so the manifest is the single place the number appears —
 * hard-coding it here as well is how the two drift apart by one release.
 */
export const VERSION = createRequire(import.meta.url)('../package.json').version
