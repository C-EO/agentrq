// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from '../lib/fixtures.js'
import { nextResponse, watchTraffic } from '../lib/app.js'

// The skills settings: the list the page reads from the server, and an import
// the server refuses, whose reason the page shows as the server wrote it.
test('the skills tab lists the workspace\'s skills and shows why an import was refused', async ({ page, workspace }) => {
  const traffic = watchTraffic(page)
  const listed = nextResponse(page, 'GET', `/workspaces/${workspace.id}/skills`)
  await page.goto(`/workspaces/${workspace.id}/settings`)
  await page.getByRole('button', { name: 'Skills', exact: true }).click()
  expect((await listed).status(), 'the skills list request').toBe(200)
  await expect(page.getByText('No skills yet.'), 'a new workspace has no skills').toBeVisible()

  await page.getByLabel('Import from GitHub').fill('https://example.com/owner/repo')
  const refused = nextResponse(page, 'POST', `/workspaces/${workspace.id}/skills/import`)
  await page.getByTestId('skill-import').click()
  const res = await refused
  expect(res.status(), 'importing from a link that is not GitHub').toBeGreaterThanOrEqual(400)
  expect(res.status()).toBeLessThan(500)
  const { error } = await res.json()
  await expect(page.getByText(error.message), 'the refusal, as the server wrote it').toBeVisible()

  traffic.expectClean({ allow: [`${res.status()} /skills/import`] })
})
