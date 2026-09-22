# A turn ends at the usage footer, not at a reply

> Read before changing the task composer, the ACP gateway turn handling, or anything that decides whether an agent is busy.

The ACP gateway gives a task one session and a session one turn at a time, and
chains a second delivery behind the first (`runTurnForTask` in the gateway).
A message posted while the agent is working is therefore queued in the gateway,
not read — so the composer does not post it. Mid-turn, Send holds the message
in the browser instead (`useQueuedMessages.js`, kept in `localStorage`), where
it stays editable, and Stop appears alongside Send rather than replacing it.

**The queue leaves as one message.** Delivering several would start a turn each
and chain them behind one another, which is the thing being avoided.

Which makes "when does a turn end" load-bearing — it is also when the queue is
sent — and the obvious answer is wrong. **A reply does not end a turn.** The
server's own instructions tell agents to report progress with `reply` every few
steps, so a reply arriving is usually the agent talking while it works; taking
one as the end posts the queue into the running turn, which is the bug this
exists to fix.

What ends a turn is the **usage footer**. The gateway flushes it from
`flushReply`, which runs when the ACP prompt resolves — "the last usage
snapshot of the turn", one per turn, including a turn cancelled by the Stop
button, since a cancel resolves the prompt too. That is what sends the queue on
its own after a stop.

The footer is only sent when the agent reported usage at all, so for a task
that has never seen one — and only then — a plain reply is taken as the end
instead. Worse, but the old behaviour rather than a queue that is never sent.
The rule lives in `useAgentTurn.js`, with the cases as tests.

A queue also has no turn-end to wait for if the turn finished while the page
was closed, so the task view sends it once after loading too.

Everything is gated on `agentSupportsStop`: Claude Code speaking MCP directly
does not chain turns and cannot be stopped, so there is nothing to queue
behind and Send posts immediately, as it always has.

