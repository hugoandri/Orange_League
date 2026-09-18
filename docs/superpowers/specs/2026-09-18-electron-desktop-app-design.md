# Desktop App (Electron) — Design

Date: 2026-09-18
Status: Approved by user, pending implementation plan

## 1. Purpose

`tcg-simulador` is a Firebase-Hosting-served static web app (plain HTML/CSS/JS,
no build step) backed by Firebase Auth/Firestore/Cloud Functions (accounts,
economy, collections) and a PartyKit WebSocket server (real-time PVP). The
user wants an installable native desktop app for macOS, Linux, and Windows,
with the game's ~390MB of local assets (card images, sounds, deck/type/profile
art) bundled into the install instead of fetched over the network at runtime.

This is a packaging/distribution project, not a gameplay feature — no game
logic changes.

## 2. Scope

Confirmed with the user, in order of how much they constrain the design:

- **No offline mode.** Login, PVP, the shop, and the collection all keep
  requiring the same live internet backend this game already needs — the
  desktop app is a native window around the same online game, not an
  offline version of it. (Today, login is already mandatory before reaching
  *any* screen, including local vs-CPU play — `auth-ui.js`'s
  `onAuthStateChanged` shows the login screen and never reveals `#menuScreen`
  without a signed-in user — so "offline local play" was never on the table
  without also reworking that gate, which the user explicitly does not want.)
- **Assets bundle locally.** Card images (`Cartas/`, 264MB), music/sound
  (`Songs/`, 96MB), booster art (`Sobres/`, 18MB), profile art (`Perfil/`,
  9.5MB), deck art (`Mazos/`, 1.3MB), and type icons (`Tipos/`, 212KB) ship
  inside the installer and load from the local filesystem, not Firebase
  Hosting's CDN.
- **Electron**, not Tauri — this codebase is 100% standard web APIs (no
  build step today) and Electron guarantees the same Chromium engine on all
  3 platforms, eliminating the cross-engine compatibility risk Tauri's
  per-OS native webviews (WebKit/WebView2/WebKitGTK) would introduce for a
  codebase never tested outside Chrome/Chromium. Trade-off accepted: a
  larger install (~500-600MB+, Chromium + the 390MB of assets) instead of
  Tauri's smaller one.
- **Unsigned for v1.** No Apple Developer Program enrollment, no Windows
  code-signing certificate yet — users see (and must click through) OS
  warnings on first launch (macOS Gatekeeper may require right-click → Open;
  Windows SmartScreen shows an "unknown publisher" prompt). Signing can be
  added later without redoing the packaging setup.
- **No auto-update for v1.** New installers are built and distributed
  manually when there's a new version; no `electron-updater` wiring, no
  update feed. (Also avoids a real gap: without code signing, macOS
  auto-update doesn't work reliably anyway.)
- **New worktree/branch**, unrelated to the PVP work on
  `worktree-partykit-pvp-migration` (PR #1) — this lives on its own branch,
  `worktree-desktop-electron-packaging`, based on `main`, with its own PR.

## 3. Architecture

Electron wraps the existing web app unchanged. A main process (`electron/main.js`)
opens a `BrowserWindow` that loads `index.html` from the packaged app's own
files via `loadFile()` (a local `file://`-scheme load), instead of the browser
fetching it from `https://pokemon-tcg-simulador.web.app`. Every remote call
this app already makes — Firebase Auth/Firestore/Functions (loaded today from
`gstatic.com`, and the app's own calls to `*.cloudfunctions.net`), the
PartyKit WebSocket (`tcg-simulador-pvp.hugoandri.partykit.dev`) — is an
absolute URL to a different origin, so loading the page itself via `file://`
instead of `https://` changes nothing about how those calls work. No OAuth
popup/redirect flows are involved (this app's own login is email+password
only, per `auth-ui.js`), which is the one class of thing that can behave
differently under `file://` — so there's nothing here that needs it.

No changes to `ui.js`, `rules-engine.js`, `economy.js`, `auth-ui.js`, or any
other existing game file. The `telegram-web-app.js` script tag already
degrades harmlessly outside Telegram's own webview (true for every regular
browser visitor today too) — running inside Electron changes nothing about
that.

The `BrowserWindow` uses Electron's standard secure defaults
(`contextIsolation: true`, `nodeIntegration: false`) — the renderer (this
game's own page) never gets Node's `require()`/`fs`/etc. exposed to it
directly, matching how it already runs today in a regular browser tab with
zero Node access. This is safe for this codebase specifically because none
of its existing scripts (`ui.js`, `economy.js`, `rules-engine.js`, etc.) use
`require()` or any Node API at all — they're plain browser globals/`<script>`
tags today, so nothing needs to change for them to keep working exactly as
they do now.

## 4. What gets packaged

`firebase.json`'s own `hosting.ignore` list already draws the exact line
between "the static site" and "backend/tooling that isn't part of the
served app" (`functions/`, `firestore.rules`, `README.md`, etc.). The
Electron packaging config (`electron-builder`'s `files`/`extraResources`
patterns) mirrors that same boundary: everything `firebase.json` already
serves (all HTML/CSS/JS at the repo root, `Cartas/`, `Songs/`, `Sobres/`,
`Perfil/`, `Mazos/`, `Tipos/`, `data-*.js`, etc.) is included; `functions/`,
`party/`, `docs/`, test files, and this new `electron/` directory's own
dev-only tooling are excluded from the shipped app bundle (the `electron/`
*source* files needed to run the app — `main.js`, packaging config — are of
course included; only their own `node_modules`/build scratch is excluded).

## 5. Build & distribution

`electron-builder` produces:
- macOS: a `.dmg` (unsigned — Gatekeeper warning expected)
- Windows: an NSIS `.exe` installer (unsigned — SmartScreen warning expected)
- Linux: an `.AppImage`

Building Windows/Linux binaries by cross-compiling from macOS has real,
well-known gaps for anything beyond the simplest cases. Since this app has
zero native Node modules (no compiled dependencies), cross-building might
work, but a first release should be built and smoke-tested on its actual
target OS rather than trusted blind. A GitHub Actions workflow with a
3-runner matrix (`macos-latest`, `windows-latest`, `ubuntu-latest`) builds
each installer on its own real OS and uploads all three as workflow
artifacts (and/or attaches them to a GitHub Release) — manually triggered
or on a version tag, matching the "manual distribution, no auto-update"
decision above.

## 6. App identity & window

- App name: "Orange League" (the game's existing in-app branding).
- Icon: derived from `Perfil/Logo.png` (already in the repo), converted to
  each platform's required format (`.icns` for macOS, `.ico` for Windows,
  PNG set for Linux).
- Window chrome: the platform's native title bar/frame — the game already
  draws its own complete visual shell inside the page, so a custom
  (frameless) window adds cost without a clear benefit and isn't part of
  this scope.

## 7. Testing

No automated test coverage applies to the packaging layer itself (there's
no build tooling in this repo today, and Electron packaging isn't
meaningfully unit-testable). Verification is manual, once per platform,
against a real built installer: the app launches, reaches the login
screen, logs in, loads the main menu with all local assets visible
(no broken images/missing sounds), plays a local match against the CPU,
and connects to a real PVP match. `node run-tests.js` (the game's own
rules-engine test suite) is untouched by this work and must stay
739/739 exactly as it does today — packaging never touches game logic.

## 8. Non-Goals

- No offline mode (see Scope).
- No auto-update (see Scope).
- No code signing/notarization (see Scope) — both are real, callable
  follow-ups once the user has the accounts/certificates needed.
- No changes to the web-hosted version at `pokemon-tcg-simulador.web.app` —
  it keeps being deployed and updated exactly as it has been all session;
  the desktop app is an additional distribution channel, not a replacement.
- No mobile packaging (iOS/Android) — out of scope, not requested.
