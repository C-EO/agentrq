// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Uploading a new version to the Chrome Web Store and submitting it for
 * review, through the store's v2 API. Run by plugin-chrome-release.yml; see
 * PUBLISHING.md for the one-time setup.
 */

export const API = 'https://chromewebstore.googleapis.com'

// Upload states that end the wait; anything else is still being processed.
const DONE = new Set(['SUCCEEDED', 'FAILED'])
// Submission states that mean the version will not go out.
const REFUSED = new Set(['REJECTED', 'CANCELLED'])

async function json(res, what) {
  const text = await res.text()
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${text}`.trim())
  return text ? JSON.parse(text) : {}
}

export async function publish({ fetchImpl, token, publisherId, itemId, version, zip, sleep, log = () => {}, polls = 60 }) {
  const name = `publishers/${publisherId}/items/${itemId}`
  const auth = { authorization: `Bearer ${token}` }

  const uploaded = await json(
    await fetchImpl(`${API}/upload/v2/${name}:upload`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/zip' },
      body: zip,
    }),
    'Upload',
  )
  let state = uploaded.uploadState
  log(`upload: ${state}`)
  for (let i = 0; !DONE.has(state); i++) {
    if (i === polls) throw new Error(`Upload still ${state} after ${polls} checks.`)
    await sleep()
    state = (await json(await fetchImpl(`${API}/v2/${name}:fetchStatus`, { headers: auth }), 'Status check'))
      .lastAsyncUploadState
    log(`upload: ${state}`)
  }
  if (state === 'FAILED') throw new Error('The store refused the package; its dashboard says why.')
  // The store reads the version from the manifest. A mismatch means the tag
  // and the package disagree about what is being released.
  if (uploaded.crxVersion && uploaded.crxVersion !== version) {
    throw new Error(`The package is version ${uploaded.crxVersion}, but ${version} is being released.`)
  }

  const submitted = await json(
    await fetchImpl(`${API}/v2/${name}:publish`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' }),
    'Publish',
  )
  log(`submission: ${submitted.state}`)
  if (REFUSED.has(submitted.state)) throw new Error(`The submission was ${submitted.state.toLowerCase()}.`)
  return submitted.state
}

/** The release job's entry point: settings from the environment, the package from disk. */
export async function main(env, { fetchImpl, readFile, sleep, log }) {
  const missing = ['CWS_TOKEN', 'CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'VERSION', 'ZIP'].filter((k) => !env[k])
  if (missing.length) throw new Error(`Not set: ${missing.join(', ')}. See plugins/chrome/PUBLISHING.md.`)
  return publish({
    fetchImpl,
    token: env.CWS_TOKEN,
    publisherId: env.CWS_PUBLISHER_ID,
    itemId: env.CWS_EXTENSION_ID,
    version: env.VERSION,
    zip: await readFile(env.ZIP),
    sleep,
    log,
  })
}
