# WebMCP (`frontend/src/webmcp/`)

> Read before adding a function to `frontend/src/api.js` — the WebMCP catalogue mirrors it function for function, and a test fails if it does not.

The interface offers itself to a browser agent as WebMCP tools — 71 of them,
registered on sign-in and withdrawn on sign-out. That count drifts every time a
tool is added; don't trust it, count `createToolCatalogue(...)`'s length.

- `modelContext.js` is the browser seam (finds `document.modelContext`, falling
  back to the deprecated `navigator.modelContext`); `tools.js` is the pure
  catalogue; `composables/useWebMCP.js` is the only Vue-aware part.
- **The catalogue mirrors `frontend/src/api.js` function for function.** That is
  what makes "anything the UI can do" checkable, and
  `frontend/test/webmcpTools.test.js` enforces it: add an API function without a
  tool and it fails. Exemptions live in that test with a reason.
- **Every tool must fit the limits a shared site is held to** (description
  ≤1 KiB, schema ≤32 KiB, ≤128 tools; `sitetools/limits.go`). Over any one, the
  server refuses the whole announcement and the app cannot be shared, while the
  popup still says "Shared". The catalogue test checks them.
- **Every write tool declares the page it acts on** (`screen: before(...)` or
  `after(...)` in `tools.js`); `withScreen` moves the person there and toasts.
  `after` is only for a page the result creates. A draft in any text field holds
  the move and the toast offers "Show" — never navigate over unsaved input. A
  test fails for a write tool without one.
- Tools act as the signed-in user with their cookie, so they inherit exactly the
  user's permissions. The registration is withdrawn on logout because the page
  is not reloaded in between.
- **A view that loads on mount must also `onWebMCPChange(reload)`**
  (`composables/useWebMCPChanges.js`), unless SSE already keeps it current:
  otherwise an agent's change stays invisible until the person leaves the page.
  Reload quietly, without the loading state, and never over unsaved input.
- User-facing documentation is `docs/WEBMCP.md`; `cd desktop && npm run
  verify:webmcp` drives the whole path in a real browser with no backend.

