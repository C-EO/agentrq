# A turn ends at the usage footer, not at a reply

> Read before changing the task composer, the ACP gateway turn handling, or anything that decides whether an agent is busy.

The ACP gateway gives a task one session and a session one turn at a time, and
chains a second delivery behind the first (`runTurnForTask` in the gateway).
A message sent while the agent is working is therefore queued, not read — so
the composer offers Stop instead of Send while a turn is running, and refuses
input until the turn ends.

Which makes "when does a turn end" load-bearing, and the obvious answer is
wrong. **A reply does not end a turn.** The server's own instructions tell
agents to report progress with `reply` every few steps, so a reply arriving is
usually the agent talking while it works; unlocking on one hands the composer
back mid-turn and queues the next message, which is the bug this exists to fix.

What ends a turn is the **usage footer**. The gateway flushes it from
`flushReply`, which runs when the ACP prompt resolves — "the last usage
snapshot of the turn", one per turn, including a turn cancelled by the Stop
button, since a cancel resolves the prompt too. That is what makes the composer
come back on its own after a stop.

The footer is only sent when the agent reported usage at all, so for a task
that has never seen one — and only then — a plain reply is taken as the end
instead. Worse, but the old behaviour rather than a composer that never
unlocks. The rule lives in `useAgentTurn.js`, with the cases as tests.

Everything is gated on `agentSupportsStop`: Claude Code speaking MCP directly
does not chain turns and cannot be stopped, so taking its Send away would leave
no way to say anything at all.

