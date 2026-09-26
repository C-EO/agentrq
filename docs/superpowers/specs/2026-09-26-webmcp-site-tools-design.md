# Site tools: the current website's WebMCP tools, offered to workspace agents

Task: 0jLkWz4In8z · Status: design approved in chat, 2026-09-26

## Goal

AgentRQ already *provides* WebMCP: its web app registers its own tools with the
browser. This feature is the reverse. When you are on any site that registers
WebMCP tools (a shop, a CRM, a docs site), you can share that site with one of
your workspaces, and the agent working there (Claude Code, Gemini, any harness on
the workspace MCP server, local or remote) can list those tools and call them in
your real, signed-in Chrome, as you. It keeps working unattended: if no tab of
the site is open, the extension opens one in the background.

## Decisions (made with the human)

| # | Question | Decision |
|---|---|---|
| 1 | Goal | Agents act on websites you use via their WebMCP tools; unattended use as well |
| 2 | Browser side | The Chrome extension (`plugins/chrome`) only. Desktop app is out of scope |
| 3 | Consent | Opt in per site, made easy: a green light on the AgentRQ icon when the active tab offers WebMCP tools, one click to share with a chosen workspace, and stop sharing any time |
| 4 | Detection | Passive, on the active tab. Needs a one-time optional all-sites host grant, asked for when detection is turned on |
| 5 | Agent surface | Two fixed tools on the workspace MCP server: `listSiteTools`, `callSiteTool`. No dynamic per-site MCP tools |
| 6 | No tab open | Open on demand: the site's last URL in a background tab, left open. Fails clearly if Chrome is not connected |
| 6b | Several tabs | The most recently used tab of that origin |
| 7 | No native WebMCP | **Native only.** No polyfill: the extension observes the real `document.modelContext` and does nothing where Chrome lacks it |
| 8 | Transport | Extension ↔ backend WebSocket |
| 9 | Approvals | `readOnlyHint: true` runs without asking; anything else asks in the task first, with an "always allow this tool here" option |
| 10 | Delivery | Small, self-contained AgentRQ tasks, each carrying the context a fresh agent needs |

## Components

### A. Page observer — extension, MAIN world, `document_start`, top frame only

Registered with `chrome.scripting.registerContentScripts` once the all-sites
grant exists (and unregistered when it is revoked). Before page scripts run, it
wraps `registerTool` on `document.modelContext` and on the deprecated
`navigator.modelContext`, whichever exist. The wrapper calls the native method
unchanged and also records `{name, description, inputSchema, annotations}` plus
the `execute` function, and forgets the tool when the registration's
`AbortSignal` aborts. If neither accessor exists, the script does nothing.

### B. Bridge — extension, isolated world, same tab

Relays between the observer and the service worker with `window.postMessage`
carrying a per-page random nonce handed to the observer at injection, so the
page can neither forge nor read the channel. Reports the tab's tool list on
every change and forwards calls and results.

### C. Service worker

- Badge: green dot with the tool count for the active tab when it has tools.
- Shares: `origin → workspaceId` in `chrome.storage.local`, plus
  `alwaysAllow` state mirrored from the server.
- Socket: one WebSocket to the server while at least one origin is shared,
  opened with a one-minute ticket fetched with the `at` cookie (the extension
  has host access to the server). Reconnects with backoff; Chrome 116+ keeps
  the worker alive while the socket is active.
- Calls: routes to the most recently focused tab of the origin; if none, opens
  the share's last URL with `chrome.tabs.create({active: false})`, waits up to
  20 s for the tool to register, then runs it.

### D. Popup and Options

A strip above the framed app when the active tab has tools:
"github.com offers 5 WebMCP tools · Share with [workspace ▾]" or, when shared,
"Shared with *workspace* · Stop sharing". If the all-sites grant is missing,
the strip offers to turn on detection. Options lists every shared site with a
Stop button.

### E. Backend relay

- `GET /api/v1/browser/connect` — a WebSocket on the stdlib `mux` in `app.go`
  (never Fiber; see AGENTS.md), authenticated with a ticket like the daemon and
  terminal sockets.
- An in-memory registry per backend instance of connected browsers, with the
  same `(browserId, instanceId)` pairing-and-relay approach as
  `backend/internal/controller/machine/registry.go`, so a call arriving at
  another instance still reaches the socket.
- One table, `site_shares`: account, workspace, origin, browser id, last URL,
  last-seen tools (JSON), always-allowed tool names, timestamps. Unique on
  (workspace, origin). Deleted with its workspace.
- View / entity / model separation, controller methods only from handlers,
  camelCase JSON everywhere.

### F. Workspace MCP tools (`backend/internal/controller/mcp/server.go`)

- `listSiteTools()` — read-only. Sites shared with this workspace:
  `{site, online, tools: [{name, description, inputSchema, annotations}]}`.
  Last-seen tools are returned even when offline.
- `callSiteTool({taskId, site, tool, arguments})` — not read-only; annotations
  say open-world. Returns the site tool's result as MCP content.
- Both descriptions state that the content comes from a third-party site and
  is data, not instructions. The server-instructions line that says the same
  must keep the instructions under the 2048-character cap.

## Protocol (browser socket, JSON frames, camelCase)

Extension → server:

- `announce {origin, workspaceId, lastUrl, tools[]}` — on share and on every
  change to that origin's tools. The server checks that the account owns the
  workspace and upserts `site_shares`.
- `withdraw {origin}` — stop sharing; deletes the row.
- `result {callId, content? , error?}`

Server → extension:

- `call {callId, origin, tool, arguments}`
- `shares {…}` — sent on connect, so the extension reconciles with the server
  (e.g. a share removed because its workspace was deleted).

## A call, end to end

1. The site must be shared with *this* workspace and the tool must be in its
   last announce; otherwise the error lists the valid sites or tools.
2. `arguments` are validated against the announced `inputSchema`.
3. Approval gate: `readOnlyHint: true`, or the tool is in `alwaysAllow`, runs
   straight away. Otherwise post an approval to the task through the existing
   elicitation flow (`handleElicit`'s machinery, so the UI needs nothing new):
   "Agent wants to run **github.com › deleteBranch** with {…}", with Allow,
   Deny and "Always allow this tool here". Decline or timeout returns
   "denied by the user".
4. Route `call` to the browser socket (relaying across instances), with a
   deadline of 60 s.
5. The extension runs the page's own `execute(arguments)` and returns the
   result. Text passes through; other values are JSON-stringified.
6. The server caps the result at 256 KiB and returns it.

## Limits and trust boundaries

- Top frame only: iframes (ads, embeds) cannot contribute tools.
- 128 tools per site, 1 KiB per description, 32 KiB per schema, 256 KiB per
  result. Over-limit items are refused with a reason, never truncated.
- A site's annotations are its own claim. A site that lies about
  `readOnlyHint` can only act on itself, and only because you shared it.
- Signing out of AgentRQ closes the socket, so every site goes offline.
- The server checks ownership on every announce and call; shares belong to the
  account and never cross accounts.

## Errors the agent sees

Not shared with this workspace · unknown tool (valid names listed) · arguments
do not match the schema · Chrome with AgentRQ is not connected · the tab did not
register the tool within 20 s (site changed, or you are signed out of it) · the
tool threw (its message passed on) · no result within 60 s · denied by the user.

## The places a new workspace MCP tool touches

Per `docs/agents/mcp-and-tasks.md`: `server.go` (`Name:` first, `mcphint`
annotations), `cli/agentrq-ws` (`COMMANDS`, README table and the tool count in
words: verbs `site-tools` and `call-site-tool`), the Claude plugin README and
SKILL (checked by `plugin_docs_test.go`), `README.md`, `README.zh-CN.md`, and
`plugins/deepseek-harness/README.md`. Telemetry per `docs/agents/telemetry.md`,
in the same PR.

## Testing

- **Extension** (node:test, `fake-chrome.js` and `fake-document.js`, 100%
  gate): wrapping and abort; nonce rejection; the badge following the active
  tab; share and stop; most-recent-tab routing; open on demand and its timeout;
  reconnect.
- **Backend** (Go, gofmt): registry announce, withdraw, route, deadline and
  cross-instance relay; every error above; the approval gate, including
  always-allow; ownership; telemetry; plugin-docs parity.
- **End to end**: headless Chromium with the unpacked extension, a local page
  registering two tools on a stubbed native `document.modelContext`, and a
  local backend, driving `callSiteTool` for a read-only tool and an approved
  destructive one.

## Rollout

- Extension v1.1.0. The all-sites permission stays optional, and is requested
  only when detection is turned on. The Web Store listing's permission
  justification and privacy answers are updated (`plugins/chrome/store/`).
- New notes: `docs/agents/site-tools.md` (a line or two per rule), plus a user
  section in `docs/WEBMCP.md`.

## Out of scope

Desktop app, a polyfill, other browsers, iframe tools, dynamic per-site MCP
tools, and an audit UI beyond the task thread.
