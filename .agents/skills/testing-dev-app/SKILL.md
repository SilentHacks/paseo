---
name: testing-dev-app
description: How to run and drive the Paseo dev environment (web app, dev daemon, dev Electron) for end-to-end UI testing on this machine.
---

# Testing the Paseo dev app end-to-end

## Dev topology (this checkout)

- Dev daemon: `127.0.0.1:6768`, state in `.dev/paseo-home` (`projects/workspaces.json` lists workspaces; `npm run cli -- daemon status` reports serverId and provider availability — the `mock` provider is usually available even when real agents are not).
- Web app: `npm run dev:app` serves Metro on `http://localhost:8081`. Use Chrome.
- Desktop: `npm run dev:desktop` rebuilds the main bundle (`build:main`), picks a Metro port via get-port starting at `8082`, and launches Electron loading `EXPO_DEV_URL` with user-data at `.dev/user-data`. The desktop connects to the same `PASEO_DAEMON_ENDPOINT=localhost:6768` daemon, so workspaces/terminal sessions are shared between Chrome and Electron — but app settings are NOT (they persist per-client in AsyncStorage/localStorage).
- If you change `packages/desktop` main-process code, the running Electron does NOT pick it up — `dev.sh` rebuilds `packages/desktop/dist` and must be relaunched. Killing the dev-runner PID kills its child metro AND Electron (runner calls stopAll on any child exit), so just rerun `npm run dev:desktop`.

## Driving the UI

- Workspace URL: `/h/<serverId>/workspace/<workspaceId>` — get both IDs from `.dev/paseo-home/projects/workspaces.json` and `daemon status`. Settings: `/settings/<section>` (e.g. `/settings/appearance`).
- New terminal in a workspace: the `+` button in the tab bar (testID `workspace-new-tab-button`) opens the launcher with a "Terminal" row.
- macOS: in browser inputs select-all is `cmd+a` (`ctrl+a` does nothing). To make a top-of-page dropdown reachable while scrolled for scroll-jump tests, zoom in with `cmd+=` — it increases page height and keeps the row visible at a real scrollTop. `cmd+0` resets.
- To paste file contents into inputs: `pbcopy < file` then click field and `cmd+v`.
- Electron window has no URL bar — navigate via the sidebar/settings gear, or deep-link Chrome only. Electron detection in the app is `window.paseoDesktop` injected by preload; `getIsElectron()` gates desktop-only UI.
- Terminal settings (font/size/colors) are applied reactively via `useAppSettings` in `terminal-pane.tsx` — existing terminal sessions re-render on settings change with scrollback preserved (daemon owns the session).
- i18n uses i18next `{{key}}` double-brace interpolation — `{key}` single braces render literally.

## Creating a workspace without the UI

The "Add a project → open a folder" flow in the app creates the _project_ but lands on a `/new` workspace form that expects an agent submit. To get a usable workspace without starting an agent, create it via the dev CLI instead:

```bash
npm run cli -- workspace create --isolation local --path /abs/dir --project <projectId> --title Name --json
# then open  /h/<serverId>/workspace/<workspaceId>
```

`--isolation` is required (`local` for a plain directory). `serverId` comes from the `/new` URL or `npm run cli -- daemon status`.

## Explorer sidebar (file tree) controls

- `Cmd+E` toggles the right Explorer sidebar; `Cmd+Shift+E` opens the **Files** view inside it (sidebar defaults to the Changes view otherwise).
- Files-pane header icons left→right: new file, new folder, hidden-files eye, circular refresh arrow (rightmost, testID `files-refresh`). Do not confuse new file with refresh — the new-file icon opens an inline name input; press `Escape` to cancel.
- Clicking a directory row toggles expand/collapse; `expandedPaths` includes the root as `"."` by default.

## Verifying daemon feature flags

Features the app gates on `server_info.features.*` fail silently when absent. Probe the running dev daemon before trusting UI behavior (run from a package dir so `ws` resolves):

```js
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:6768/ws");
ws.on("open", () =>
  ws.send(
    JSON.stringify({ type: "hello", clientId: "probe", clientType: "cli", protocolVersion: 1 }),
  ),
);
ws.on("message", (d) => {
  const m = JSON.parse(d);
  const inner = m.type === "session" ? m.message : m;
  if (inner.type === "status") console.log(JSON.stringify(inner.payload.features));
});
```

## macOS pitfalls

- `cmd+l` does not always reach Chrome's omnibox when the app window isn't frontmost — typed text lands in the app's composer. Click the address bar explicitly, or `osascript -e 'tell application "Google Chrome" to activate'` first.
- macOS notification banners cover the top-right corner where the Explorer rail lives; dismiss them before clicking there, and avoid clicking the banner itself (opens the notifying app and steals focus).
