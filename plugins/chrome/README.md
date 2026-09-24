# AgentRQ for Chrome

AgentRQ in the toolbar popup at mobile width (440px, an iPhone 17 Pro Max), or
opened full size in a tab when you want the room.

## Install

1. Download `agentrq-chrome-extension.zip` from the latest
   [Chrome Plugin workflow run](https://github.com/agentrq/agentrq/actions/workflows/plugin-chrome.yml)
   and unzip it, or use this `plugins/chrome/` folder from a checkout.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and pick the folder.
3. Pin AgentRQ to the toolbar.

## Use

| To | Do |
|---|---|
| Open AgentRQ | Click the toolbar button, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> |
| Open full size, in a tab | **Full size** in the header, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>, or right-click the button → **Open full size** |
| Use a self-hosted server | Right-click → **Options** |

Chrome stops a popup at 800×600 and closes it when you click elsewhere, so the
popup is 440×600; full size is the way to more.

**Signing in happens in a tab.** Google and GitHub will not show their sign-in
inside another page, so a signed-out popup offers **Sign in**, which opens a
tab. Once signed in there, the popup is signed in too.

## How it works

The popup frames your server's own web app, so everything the web app does
works here, with the same session as your browser tabs.

The web app is not bundled into the extension because it would then run on the
extension's own origin, where the `at` sign-in cookie never goes: the problem
the desktop app needs its `app://` proxy for.

**Why it asks to read app.agentrq.com.** Inside the popup the app is a frame in
an extension page, and Chrome sends it the sign-in cookie only when the
extension has access to that site. Without it the app shows as signed out
however signed in the browser is. A self-hosted server's access is asked for
when you save it in Options, and given back when you switch away. The other
permissions are `contextMenus` for the right-click menu and `storage` for your
settings.

## Develop

```sh
npm test         # node:test, no dependencies
npm run test:ci  # the same, with the 100% coverage gate CI enforces
```

After editing, click the reload arrow on the extension's card in
`chrome://extensions`. Right-click inside the popup → **Inspect** for its
DevTools.
