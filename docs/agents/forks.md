# Workspace forks

> A fork is a workspace row with `ForkOfID` set: `controller/crud/workspace_fork.go`,
> `repository/base` (`MergeForkIntoParent`), `controller/forkmerge`, the daemon's
> `supervisor.PrepareForkDir`, and `useWorkspaceForks.js`. Read this before changing any of them.

- **Settings are copied and propagated, never read through.** `model.Workspace.ForkSettings()` is the one list. A parent save writes it to every fork in the same transaction, and a fork refuses edits to it. If you read the parent's settings instead, every place that reads the row directly quietly gets the fork's stale copy.
- **Memory, skills, site shares and attachment blobs are keyed under `Workspace.ContentID()`** (the parent, for a fork). Key one under the fork and it disappears when the merge deletes the fork row. An attachment moved back to the parent would also stop opening.
- **Merging is `forkmerge.Merger`, for REST and CoreMCP alike.** It stops the fork's agent before the tasks move. The unfinished-task check runs again inside the merge transaction. Skipping the stop leaves the agent working, with its token on disk, for a workspace that no longer exists.
- **A fork has no delete or archive, and a parent with forks cannot be deleted or archived either (409).** Otherwise a fork's tasks could be lost, or a fork left with a `ForkOfID` that points at nothing. One level only: a fork of a fork, or of `supervisor`, is refused (422).
- **Never start a fork on a daemon without the `fork` capability, or older than `wire.MinForkVersion` (0.9.3).** Both must pass. An old agentrqd ignores the fork field, so it runs in the parent's folder and connects to the parent; a dev build can say the capability early. A version that is no release (`dev`, empty, `-rc`) is refused. A UI copy of the number must be parity-tested against it.
- **A fork's folder must never keep a workspace entry that points elsewhere.** The daemon compares endpoints, not whether an entry exists. A worktree of a repo that commits `.mcp.json` would otherwise point the fork at its parent. Refusing every existing entry breaks each relaunch, because the fork's first launch wrote one.
