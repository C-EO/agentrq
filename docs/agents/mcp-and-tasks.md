# The MCP server, and tasks

> The workspace MCP server (`backend/internal/controller/mcp/`) and the task rules it shares with the REST API. Read before changing a tool, cron validation, or task status.

- `server.go` — all tool handlers (`handleCreateTask`, `handleReply`, etc.) and the `WorkspaceServer` struct
- Cron validation: `validateCronGranularity` enforces hourly-minimum granularity. Minute field must be a single fixed integer (0-59); wildcards/steps/ranges/comma-lists are rejected.
- Creating a task with `cron_schedule` sets `status="cron"` on the model.

## A tool on the server is a tool in five other places

The `mcp.AddTool(mcpSrv, …)` block in `server.go` is the source of truth for
what a workspace offers — 11 tools as of 2026-09-17. Every other list of them
in this repository is a copy, and the copies are what go stale.

**`cli/agentrq-ws` is the one that is easiest to forget**, because it is a
separate npm package and nothing in the backend mentions it. It is a
command-line client over exactly these tools — 14 commands for the 11 — so
**adding, renaming or removing a tool on the server is a change to the CLI
too**: `COMMANDS` in `cli/agentrq-ws/src/commands.js`, the command table in its
`README.md`, and the sentence there that spells the tool count out in words. A
renamed tool is worse than a missing one, because the verb stays in the help
output and fails at the server instead of at the parser.

Skipping it is survivable and that is the trap: the `call` escape hatch means a
tool added today is *reachable* today (`agentrq-ws call <tool> --args '{…}'`).
But reachable is not covered — `call` asks the person to write the JSON
envelope the CLI exists to spare them.

**The test there is not the safety net it looks like.**
`cli/agentrq-ws/test/commands.test.js` has a case called "the CLI covers every
tool the workspace server offers", and its list of tool names is a literal *in
the test file*; it never reads the Go source. Add a tool to the server and it
stays green. It catches only the reverse — a CLI verb that stops calling a tool
it used to.

The one test that really compares the two is
`frontend/test/workspaceSettings.test.js`: it regex-reads the `AddTool` block
out of the Go source and asserts order-for-order equality with
`WORKSPACE_MCP_TOOLS` in `frontend/src/composables/useWorkspaceSettings.js`,
the list the setup tab's `.claude/settings.local.json` snippet is generated
from. It also asserts a literal expected list, so **both** the composable and
that expectation need the new name. That place cannot be forgotten, and it is
the only one that cannot.

The remaining copies are documentation and fail silently: `README.md` (the
settings snippet, and the "Available MCP Tools" list), `README.zh-CN.md` (the
same list, translated), and `plugins/deepseek-harness/README.md`, whose table
and hard-coded count are **stale at seven today** — worth knowing because the
plugin filters nothing, so every server tool reaches the model whatever that
table says. This repo's own `.claude/settings.local.json` is gitignored, so it
can never ride along in a PR and has to be edited by hand.

**Why any of this matters:** the allow list exists to stop permission prompts,
and a list that is merely *mostly* complete fails silently — the agent works
until its first call to the one missing tool, then stalls waiting on a human
who is not watching.

## Workspace memory

`loadMemory` / `saveMemory` (`memory.go`) give agents notes that outlive a task.

- Stored in `memories`, keyed per **(workspace owner, workspace, name)** — it is
  the *workspace's* memory, so every agent working there shares it. Keying it to
  the connecting client would make it per-agent memory wearing a workspace's
  name.
- `memory.md` is the default for both tools and is meant to stay an index of the
  other named memories, linking them as `memory://<name>`. The server
  instructions tell connecting agents to load it first.
- **Names are canonicalised at the tool boundary**: trimmed, lowercased, and
  then required to match `^[a-z0-9]+(-[a-z0-9]+)*\.md$`. So `MEMORY.md`,
  `Memory.md` and `memory.md` are one memory rather than three. Folding here
  rather than in a query is deliberate — `=` is case-sensitive by default on
  both SQLite and Postgres and a `NOCASE` collation does not port between them,
  so one stored spelling is what makes the unique key behave the same on either.
  The strict shape is also what lets `memory://<name>` be parsed as a URL at
  all: a name with a space in it is not one.
- **Limits are enforced at the tool boundary, not in the repository**: 16 KiB of
  UTF-8 per memory and 32 characters per name, both refused rather than
  truncated — an agent told its memory is too large can split it, while one
  silently cut in half cannot know to.
- A `loadMemory` miss is **not** an error: every agent's first call on a fresh
  workspace misses, and answering with an error teaches agents to stop asking.

## CRUD task controller (`backend/internal/controller/crud/task.go`)

- Cron validation also lives here for the REST API path (same rules).
- `isValidTaskStatus` — valid statuses: `notstarted`, `ongoing`, `completed`, `rejected`, `cron`, `blocked`.

