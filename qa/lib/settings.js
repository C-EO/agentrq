// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

// Read by the Playwright config, which starts the servers, and by the tests,
// which sign in to them, so both always agree.
export const apiPort = Number(process.env.QA_API_PORT || 3911)
export const webPort = Number(process.env.QA_WEB_PORT || 5912)
export const rootToken = process.env.QA_ROOT_TOKEN || 'agentrq-qa'
