# CoreMCP, and the supervisor workspace

> `backend/internal/handler/coremcp/` — the account-wide MCP server, distinct
> from the per-workspace one in `backend/internal/controller/mcp/` (that one
> has its own note, [mcp-and-tasks.md](mcp-and-tasks.md)).

Every account gets a "supervisor" workspace auto-created on signup
(`internal/controller/crud/user.go`, `FindOrCreateUser`). Its `.mcp.json`
carries a *second* server entry, named `agentrq`, pointing at coremcp
(`/mcp`, no workspace id) alongside its own normal per-workspace one — wired in
`frontend/src/composables/useWorkspaceSettings.js` (`buildSupervisorMcpUrl`,
`buildMcpServers`). That is the only wiring a coremcp addition needs; nothing
per-workspace has to change for it to be reachable.

**Adding or renaming a *tool*** here means updating `SUPERVISOR_MCP_TOOLS`
(`frontend/src/composables/useWorkspaceSettings.js`) and `SUPERVISOR_TOOLS`
(`desktop/src/main/extensions/servers.js`) — both are regex-compared against
every non-test `.go` file in this package by
`frontend/test/workspaceSettings.test.js` and
`desktop/test/extensions/servers.test.js`, so a mismatch fails `npm test`. The
two Claude plugin docs (`plugins/claude/agentrq/README.md` and its `SKILL.md`)
need a table row too — `plugin_docs_test.go` checks those.

**Adding a *resource* or *prompt* trips none of the above.** Those parity
tests match only `mcp.AddTool(s.server, &mcp.Tool{Name: "..."` — an
`AddResource`/`AddPrompt` call is invisible to them. Cover a new one with its
own test (list it, read/get it) the way `resources_test.go`/`prompts_test.go`
do; nothing else needs to be told it exists.

**A new tool, resource or prompt here needs a telemetry line too** — see
[telemetry.md](telemetry.md)'s MCP section; `emitTelemetry` is on
`WorkspaceServer` in `server.go`, first line of the handler, same as the
per-workspace server.

**Don't put install/enrol prose in a resource.** The agentrqd install steps
already live in three places kept in sync by hand — see
[machines-and-daemon.md](machines-and-daemon.md), "Installation is answered in
three places, and they must agree". A coremcp resource that needs them should
template the live values it actually has (this server's own `baseURL`, for an
enrol command) and point at the docs URL for the rest, rather than adding a
fourth copy of the same steps.
