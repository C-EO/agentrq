// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Reaching the terminal of the agent working in this workspace.
 *
 * The workspace page already knows an agent is *connected* — that arrives over
 * the event stream and turns the header dot green — but a connection is not
 * something you can open. The terminal page is addressed by a session id, and
 * that is the one thing the page does not have.
 *
 * So this asks for it, and the asking is deliberately one request: the same
 * answer could be assembled from the machines list plus a session list per
 * machine, but that is one request per machine somebody owns to find at most
 * one row, on the page they sit on all day.
 */

import { computed, ref, watch } from 'vue'
import * as api from '../api'

/**
 * The agent kinds whose terminal is worth offering.
 *
 * Only Claude Code, and the reason is not that the gateway's terminal is
 * uninteresting — it is that the gateway is already driveable from the page.
 * Its turns arrive in the task composer, with a Stop button, because it speaks
 * ACP and the gateway chains a turn at a time. Claude Code speaks MCP straight
 * to the workspace: it cannot be stopped from here and takes no input from
 * here, so the terminal is the only place a person can actually reach it.
 *
 * A list rather than an equality check, because "which kinds can be watched"
 * is the question being answered, and the next kind added should be a line
 * here rather than an `||` somewhere.
 */
export const WATCHABLE_KINDS = ['claude-code']

/**
 * Whether a session is one this workspace should offer a terminal for.
 *
 * Exported and pure so the rule can be tested on its own — the interesting
 * cases are the ones that are nearly right: a gateway session, or a row with
 * no id, which is what a backend answering `{}` instead of `null` would look
 * like by the time it reaches here.
 */
export function isWatchable(session) {
  return !!session?.id && WATCHABLE_KINDS.includes(session?.kind)
}

/**
 * The terminal affordance for one workspace.
 *
 * @param {object} deps `workspaceId` and `agentConnected` (refs), plus, in
 *   tests, the API function.
 */
export function useWorkspaceTerminal(deps = {}) {
  const {
    workspaceId,
    agentConnected,
    fetchWorkspaceSession = api.fetchWorkspaceSession,
  } = deps

  const session = ref(null)
  const loading = ref(false)

  /** Whether to draw the button at all. */
  const offered = computed(() => isWatchable(session.value))

  /** Where it goes. Empty when there is nothing to go to. */
  const to = computed(() => (offered.value ? `/sessions/${session.value.id}` : ''))

  /**
   * What the button says it will show.
   *
   * A machine runs agents for several workspaces and most are the same kind,
   * so the kind alone is not an answer — but here the workspace is implied by
   * the page, and the status is the part somebody cannot otherwise see: a
   * session that is still starting is worth opening precisely because it might
   * be about to fail.
   */
  const label = computed(() =>
    offered.value
      ? session.value.status === 'starting'
        ? 'Agent terminal (starting)'
        : 'Agent terminal'
      : ''
  )

  /**
   * Ask which session is running here.
   *
   * A failure leaves no button rather than a broken one, and says nothing: the
   * person did not ask for this, so there is no news to report — an affordance
   * that cannot be offered should simply not be offered. The header dot still
   * tells them whether an agent is there.
   */
  async function load() {
    const id = workspaceId?.value
    if (!id) {
      session.value = null
      return
    }
    loading.value = true
    try {
      session.value = await fetchWorkspaceSession(id)
    } catch {
      session.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Re-ask when the workspace changes, and when an agent comes or goes.
   *
   * The second half is what keeps the button honest without polling and
   * without a second event stream: `agentConnected` already flips on this page
   * from the workspace's own stream, and it flipping is the one cheap signal
   * that the session table has probably changed. Both directions matter — one
   * brings the button, the other takes it away.
   *
   * Deliberately *not* gated on the agent being connected. A session in
   * `starting` has no agent attached yet, and that is exactly the moment
   * somebody wants to watch it.
   */
  watch(
    () => [workspaceId?.value, agentConnected?.value],
    () => {
      load()
    },
    { immediate: true }
  )

  return { session, loading, offered, to, label, load }
}
