# WebMCP (`frontend/src/webmcp/`)

> Read before adding a function to `frontend/src/api.js` — the WebMCP catalogue mirrors it function for function, and a test fails if it does not.

The interface offers itself to a browser agent as WebMCP tools — 53 of them,
registered on sign-in and withdrawn on sign-out.

- `modelContext.js` is the browser seam (finds `document.modelContext`, falling
  back to the deprecated `navigator.modelContext`); `tools.js` is the pure
  catalogue; `composables/useWebMCP.js` is the only Vue-aware part.
- **The catalogue mirrors `frontend/src/api.js` function for function.** That is
  what makes "anything the UI can do" checkable, and
  `frontend/test/webmcpTools.test.js` enforces it: add an API function without a
  tool and it fails. Exemptions live in that test with a reason.
- Tools act as the signed-in user with their cookie, so they inherit exactly the
  user's permissions. The registration is withdrawn on logout because the page
  is not reloaded in between.
- User-facing documentation is `docs/WEBMCP.md`; `cd desktop && npm run
  verify:webmcp` drives the whole path in a real browser with no backend.

