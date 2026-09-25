# Chrome Web Store listing

Everything the Developer Dashboard asks for, ready to paste. The images are
beside this file.

## Store listing tab

**Name** — from the manifest: `AgentRQ`

**Summary** (from the manifest, at most 132 characters):

> Task manager for AI agents: orchestrate many agents at once and open Claude Code terminal right in the extension.

**Description:**

```
AgentRQ is a task manager for AI agents. Give your agents tasks, orchestrate many of them at once, and open the Claude Code terminal an agent is running in, all from a popup on your Chrome toolbar.

TASK MANAGER FOR AI AGENTS
• Create tasks and assign them to an agent or to yourself, one-off or on a schedule.
• See every task by status: not started, ongoing, blocked, done.
• Answer the questions agents are blocked on, and approve the steps they ask permission for.

AGENT ORCHESTRATION
• Run many agents at once, each in its own workspace, and see at a glance which are working and which are waiting on you.
• Chain work between agents: one workspace's finished task can start the next task in another.

CLAUDE CODE TERMINALS IN THE EXTENSION
• Open the live Claude Code terminal an agent is working in, right in the popup, to watch it or take over. Works for agents on any machine you have connected with agentrqd, AgentRQ's agent runner.

ONE CLICK FROM YOUR TOOLBAR
• A mobile-sized popup that is always there; "Full size" or Alt+Shift+F opens AgentRQ in a tab when you want the room.
• Uses your existing AgentRQ sign-in, in light or dark.
• Works with app.agentrq.com, or your own self-hosted AgentRQ server (set it in Options).

Keyboard shortcuts (change them at chrome://extensions/shortcuts):
• Alt+Shift+A: open AgentRQ
• Alt+Shift+F: open AgentRQ full size
```

**Category** — Productivity → Workflow & Planning

**Language** — English

**Graphic assets:**

| Field | File |
|---|---|
| Store icon (128×128) | `../icons/128.png` |
| Screenshots (1280×800) | `screenshot-1-popup.png`, `screenshot-2-dark.png`, `screenshot-3-full-size.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |

**Official URL** — `https://agentrq.com` (only offered once the domain is verified in Google Search Console for the publisher account; skip it otherwise)

**Homepage URL** — `https://agentrq.com`

**Support URL** — `https://github.com/agentrq/agentrq/issues`

## Privacy practices tab

**Single purpose:**

```
Shows the user's AgentRQ workspaces (their AI agents' tasks and conversations) in the toolbar popup, and opens AgentRQ full size in a tab.
```

**Permission justifications:**

`contextMenus`

```
Adds "Open full size" to the toolbar button's right-click menu, which opens AgentRQ in a tab.
```

`storage`

```
Remembers the address of the user's AgentRQ server, which they can change in Options.
```

Host permission `https://app.agentrq.com/*`

```
The popup shows the AgentRQ web app from app.agentrq.com in a frame. Chrome sends the user's existing AgentRQ sign-in cookie to that frame only when the extension has access to the site; without it the app would always appear signed out. The extension also asks the same site whether the user is signed in, so it can offer to sign in in a tab instead (Google and GitHub sign-in cannot be shown inside a frame). It reads nothing from any other site.
```

Optional host permissions `https://*/*` and `http://*/*`

```
AgentRQ can be self-hosted at any address. When a user enters their own server's address in Options, the extension asks for access to that one origin only, for the same reason as app.agentrq.com above, and gives it back when they switch to a different server. Nothing is requested unless the user saves an address, and only that address is requested.
```

**Are you using remote code?** — **No, I am not using remote code.**

```
All of the extension's JavaScript is in the package. The popup shows the AgentRQ website in an iframe, as a web page, and does not load or run any code in the extension's own context.
```

**Data usage** — tick nothing in the list of data types.

The extension's own code reads nothing about the user. It stores one setting,
the server address, in Chrome's storage. When it checks whether you are signed
in, it looks only at the HTTP status of the answer, never its body. The
AgentRQ web app inside the popup is a website like any other, and it is covered
by AgentRQ's privacy policy, not by the extension's disclosures.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** — `https://agentrq.com/privacy`

## Distribution tab

- **Payments** — Free
- **Visibility** — Public (or Unlisted to share it by link before announcing it)
- **Regions** — All regions
