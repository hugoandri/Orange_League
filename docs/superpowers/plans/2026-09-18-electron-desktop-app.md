# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package `tcg-simulador` as an installable native desktop app for macOS, Linux, and Windows, with all game assets bundled locally instead of fetched from Firebase Hosting.

**Architecture:** Electron wraps the existing, unmodified web app — a main process opens a `BrowserWindow` that loads `index.html` from the packaged app's own files via `file://` instead of `https://`. Every remote call the game already makes (Firebase Auth/Firestore/Functions, the PartyKit WebSocket) is an absolute URL to a different origin and works identically either way. `electron-builder` packages everything `firebase.json` already serves (mirroring its own `hosting.ignore` list) into `.dmg`/`.exe`/`.AppImage` installers, built unsigned on a 3-platform GitHub Actions matrix.

**Tech Stack:** Electron 44.4.2, electron-builder 26.15.3, electron-icon-builder 2.0.1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-electron-desktop-app-design.md`

## Global Constraints

- No offline mode — login, PVP, shop, and collection keep requiring the live internet backend; only static assets (card images, sounds, deck/type/profile art) bundle locally.
- Electron, not Tauri (locked decision — do not revisit).
- Unsigned installers for v1 — no code-signing/notarization config of any kind.
- No auto-update — no `electron-updater`, no update feed.
- `contextIsolation: true`, `nodeIntegration: false` on the `BrowserWindow` — none of this game's existing scripts use `require()`/Node APIs, so nothing needs to change for them to keep working.
- Native OS window chrome (no custom/frameless window).
- App name: "Orange League". App id: `com.orangeleague.tcgsimulador`.
- `node run-tests.js` (739 tests) must stay exactly 739/739 — this plan only adds new files, never touches game logic.
- This repo has zero existing build tooling (no root `package.json` before this plan) — every task in this plan is genuinely new infrastructure, not an extension of an existing pattern.

---

### Task 1: App icon

**Files:**
- Already present: `build/icon-source.png` (640×640 PNG, an "OL" monogram badge — committed in this worktree already; a landscape wordmark, `Perfil/Logo.png`, turned out unsuitable and was rejected during design, see the spec's §6)
- Create: `build/icons/mac/icon.icns`, `build/icons/win/icon.ico`, `build/icons/png/16x16.png` through `build/icons/png/1024x1024.png` (generated, not hand-authored)

**Interfaces:**
- Consumes: `build/icon-source.png` (already committed)
- Produces: `build/icons/mac/icon.icns`, `build/icons/win/icon.ico`, `build/icons/png/` (a directory of PNGs) — Task 2's `package.json` `build.mac.icon`/`build.win.icon`/`build.linux.icon` config references these exact paths.

- [ ] **Step 1: Install electron-icon-builder as a dev tool (temporary, global-less invocation via npx)**

No `package.json` exists yet (Task 2 creates it) — run the generator directly via `npx`, which fetches and runs it without needing a project file first:

```bash
npx --yes electron-icon-builder@2.0.1 --input=./build/icon-source.png --output=./build --flatten
```

- [ ] **Step 2: Verify the expected output files exist**

Run:
```bash
ls build/icons/mac/icon.icns build/icons/win/icon.ico
ls build/icons/png/ | head -5
```
Expected: `build/icons/mac/icon.icns` and `build/icons/win/icon.ico` both exist (non-zero size); `build/icons/png/` contains multiple PNG files (e.g. `16x16.png`, `32x32.png`, ... up to `1024x1024.png`).

If `electron-icon-builder` instead produced a different directory layout than `build/icons/mac/`, `build/icons/win/`, `build/icons/png/` (tool versions can shift their exact output structure), adjust Task 2's icon config paths to match whatever the real output layout is — do not force the file layout to match this plan's assumption; ground Task 2's config in what Step 2 here actually finds on disk.

- [ ] **Step 3: Commit**

```bash
git add build/icons/
git commit -m "Generate app icons (.icns/.ico/PNG set) from build/icon-source.png"
```

---

### Task 2: Core Electron app (package.json + main.js)

**Files:**
- Create: `package.json` (repo root — none exists today)
- Create: `electron/main.js`
- Modify: `.gitignore` (add `node_modules/` and `dist/` at the repo root — this repo's current `.gitignore` only excludes `functions/node_modules/`, since `functions/` was the only place `npm install` had ever run before this plan)

**Interfaces:**
- Consumes: Task 1's icon files at `build/icons/mac/icon.icns`, `build/icons/win/icon.ico`, `build/icons/png/`.
- Produces: `npm run start` (launches the app locally via Electron for manual testing), `npm run dist` (runs `electron-builder` to produce installers for whatever platform the command runs on) — Task 3's GitHub Actions workflow and Task 4's manual verification both invoke these exact script names.

- [ ] **Step 1: Update `.gitignore`**

Current full file (`.gitignore`, 8 lines):
```
functions/node_modules/
.firebase/
.superpowers/
firebase-debug.log
firestore-debug.log
ui-debug.log
*-debug.log
.DS_Store
```

Replace with:
```
functions/node_modules/
node_modules/
dist/
.firebase/
.superpowers/
firebase-debug.log
firestore-debug.log
ui-debug.log
*-debug.log
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "orange-league-tcg-simulador",
  "version": "1.0.0",
  "private": true,
  "description": "Orange League Pokémon TCG Simulator — desktop app",
  "main": "electron/main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder"
  },
  "devDependencies": {
    "electron": "44.4.2",
    "electron-builder": "26.15.3"
  },
  "build": {
    "appId": "com.orangeleague.tcgsimulador",
    "productName": "Orange League",
    "directories": {
      "output": "dist"
    },
    "files": [
      "**/*",
      "!functions/**",
      "!party/**",
      "!docs/**",
      "!design_handoff_shell_juego_final/**",
      "!README.md",
      "!PROGRESS.md",
      "!tests.html",
      "!tests.js",
      "!run-tests.js",
      "!firestore.rules",
      "!firestore.indexes.json",
      "!firebase.json",
      "!.firebaserc",
      "!node_modules/**",
      "!dist/**",
      "!electron/**/*.md",
      "!build/icon-source.png",
      "!**/.*"
    ],
    "extraMetadata": {
      "main": "electron/main.js"
    },
    "mac": {
      "icon": "build/icons/mac/icon.icns",
      "target": "dmg",
      "category": "public.app-category.games"
    },
    "win": {
      "icon": "build/icons/win/icon.ico",
      "target": "nsis"
    },
    "linux": {
      "icon": "build/icons/png",
      "target": "AppImage",
      "category": "Game"
    }
  }
}
```

This mirrors `firebase.json`'s own `hosting.ignore` list (`functions/**`, `docs/**`, `design_handoff_shell_juego_final/**`, `README.md`, `PROGRESS.md`, `tests.html`, `tests.js`, `run-tests.js`, `firestore.rules`, `firestore.indexes.json`, `**/.*`) as the boundary between "the game" and "everything else" — plus this repo's own build/dev-only additions (`party/` — this game's separate PartyKit server, not part of the served site; `node_modules/`, `dist/`; `firebase.json`/`.firebaserc` themselves, since they configure a deploy target the desktop app has no use for; `build/icon-source.png`, the *source* image Task 1 generated icons from, not needed at runtime).

No signing configuration of any kind is present — this is `electron-builder`'s own documented default (unsigned output; it only signs when given explicit certificate configuration, e.g. `mac.identity`/`win.certificateFile`, neither of which appears here), matching the plan's "unsigned for v1" constraint without inventing a flag to explicitly disable something that's already off by default.

- [ ] **Step 3: Create `electron/main.js`**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Orange League',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // macOS convention: re-open a window when the dock icon is clicked and
  // no windows are currently open (the app itself stays running after all
  // windows close, see the 'window-all-closed' handler below).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
  });
});

// macOS convention: apps stay running (visible in the dock) after their
// last window closes, until the user explicitly quits (Cmd+Q) -- only
// Windows/Linux quit outright when the last window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit(); }
});
```

- [ ] **Step 4: Install dependencies and verify the app launches**

```bash
npm install
npm run start
```

Expected: an Electron window titled "Orange League" opens and shows the game's real login screen (`index.html`'s `#authScreen`) — the same screen you'd see visiting the hosted site, now loaded from local files. Close the window (or Cmd+Q / Ctrl+Q) to exit.

If it fails to launch, read the actual terminal error before guessing a fix — a missing/incorrectly-pathed `main.js` (`package.json`'s own `"main"` field, or `main.js`'s own `loadFile` path) is the most likely culprit for a blank/error window at this stage.

- [ ] **Step 5: Commit**

```bash
git add package.json electron/main.js .gitignore
git commit -m "Add the Electron app shell (package.json, main.js) wrapping the existing game"
```

Also commit `package-lock.json` (`git add package-lock.json` too) — it's created by `npm install` in Step 4 and must be committed for reproducible builds across the 3 CI runners in Task 3.

---

### Task 3: GitHub Actions build matrix

**Files:**
- Create: `.github/workflows/build-desktop.yml`

**Interfaces:**
- Consumes: Task 2's `npm run dist` script (via `package.json`).
- Produces: nothing further tasks consume programmatically — this is the plan's distribution mechanism, its own deliverable is the 3 uploaded artifacts.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Build Desktop App

on:
  workflow_dispatch: {}
  push:
    tags:
      - 'desktop-v*'

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm install

      - name: Build installer
        run: npm run dist

      - name: Upload installer artifact
        uses: actions/upload-artifact@v4
        with:
          name: orange-league-${{ matrix.os }}
          path: |
            dist/*.dmg
            dist/*.exe
            dist/*.AppImage
          if-no-files-found: ignore
```

`if-no-files-found: ignore` on the upload step is deliberate: each OS in the matrix only ever produces ONE of the three installer types (a `.dmg` on macOS, an `.exe` on Windows, an `.AppImage` on Linux) — the other two glob patterns genuinely match nothing on that runner, which is expected, not an error.

Triggered manually (`workflow_dispatch`, matching the "manual distribution, no auto-update" decision — someone presses "Run workflow" in the GitHub Actions UI) or by pushing a `desktop-v*` tag (e.g. `desktop-v1.0.0`), whichever is more convenient when a new build is actually wanted.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build-desktop.yml
git commit -m "Add the 3-platform desktop build workflow (macOS/Windows/Linux)"
```

- [ ] **Step 3: Push the branch and trigger the workflow once, for real**

```bash
git push -u origin worktree-desktop-electron-packaging
gh workflow run build-desktop.yml --ref worktree-desktop-electron-packaging
```

Wait for it to complete (`gh run watch`, or `gh run list --workflow=build-desktop.yml --limit=1` polled until the status is no longer `in_progress`), then confirm all 3 jobs succeeded:

```bash
gh run list --workflow=build-desktop.yml --limit=1
```

Expected: the most recent run shows `success` for all 3 matrix jobs (`macos-latest`, `windows-latest`, `ubuntu-latest`). If any job failed, read its real log (`gh run view --log-failed`) before attempting a fix — do not guess at a fix for a platform you can't directly run yourself; the log is the only evidence you have for what actually went wrong on that runner.

Download the 3 artifacts to confirm they're real, non-empty files (this does not require actually running the Windows/Linux binaries, which Task 4 covers separately for whichever platform is actually available to test on):

```bash
gh run download --dir /tmp/desktop-build-artifacts
ls -la /tmp/desktop-build-artifacts/*/
```

Expected: 3 subdirectories, each containing exactly one installer file, all with a real, non-trivial size (hundreds of MB, given the ~390MB of bundled assets).

---

### Task 4: Local build, manual verification, and final test confirmation

**Files:** None created or modified — this task is entirely verification.

**Interfaces:**
- Consumes: Task 2's `npm run dist` script, Task 3's CI-built artifacts (already confirmed to exist and be non-empty in Task 3 Step 3).

- [ ] **Step 1: Build a real installer on this machine's own platform**

```bash
npm run dist
```

Expected: `electron-builder` completes without error and produces a real installer file under `dist/` matching this machine's OS (a `.dmg` on macOS). This is the SAME command Task 3's CI runs — running it locally too catches anything environment-specific before relying on CI alone.

- [ ] **Step 2: Install and launch the locally-built app, following this exact checklist**

macOS: open the `.dmg` under `dist/`, drag "Orange League" to Applications, launch it from there (launching directly out of the mounted `.dmg` is not a representative test — always install first). Since this build is unsigned, macOS Gatekeeper will likely refuse to open it via a normal double-click ("Orange League is damaged and can't be opened" or "cannot be opened because the developer cannot be verified") — right-click the app in Applications and choose "Open" instead, then confirm "Open" on the dialog that follows; this bypass is expected and matches the plan's "unsigned for v1" decision, not a bug to fix.

Once the app is actually open, work through this checklist in order, noting a real ✅/❌ for each — do not report this task done on a summary impression, use the actual results:

1. The window opens and shows the real login screen (`#authScreen`), titled "Orange League".
2. Open the OS's dev tools for this window (macOS: the app must be launched with `--inspect` or dev tools enabled — if `main.js`'s `BrowserWindow` doesn't already expose a way to open DevTools, temporarily add `win.webContents.openDevTools();` right after `win.loadFile(...)` in `electron/main.js` for this verification pass only, then remove it again afterward, since shipping v1 with DevTools force-opened on every launch isn't part of this plan's scope) — check the Network tab: reload the page and confirm requests for local assets (anything under `Cartas/`, `Songs/`, `Sobres/`, `Perfil/`, `Mazos/`, `Tipos/`, `Tablero/`) resolve via `file://`, not `https://`, and none show as failed/red.
3. Log in with a real account (email + password) — confirm the login actually completes and the main menu appears (this proves Firebase Auth, loaded from `gstatic.com`, works correctly from inside the packaged app despite the page itself loading via `file://`).
4. From the main menu, start a local match against the CPU. Confirm card art, board art, and at least one sound/music cue all load and play correctly (proves the bundled local assets are being found and served correctly, not just "not erroring").
5. Start or join a real PVP match (needs a second account/device, or the same live-smoke-test pattern used for every other PVP feature this project has shipped this session) — confirm the WebSocket connects and the match actually plays (proves outbound WebSocket connections work unchanged from inside the packaged app).

- [ ] **Step 3: Confirm the game's own test suite is untouched**

```bash
node run-tests.js
```

Expected: exactly `739 PASS`, `0 FAIL`, exit code 0 — identical to before this plan's work started, proving none of it touched game logic.

- [ ] **Step 4: Note what could not be verified directly, if anything**

If this development machine is not Windows or Linux, Steps 1-2 above were only ever run for macOS directly — Task 3's CI already confirmed the Windows/Linux builds *succeed*, but actually launching and clicking through those two installers still needs a real Windows/Linux machine (or VM) to do the same Step 2 checklist. Say so plainly in this task's own report rather than claiming full 3-platform verification happened when it didn't; the coordinator/user can decide whether that's acceptable for v1 or worth arranging a VM for before wider distribution.
