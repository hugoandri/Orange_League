# Orange League — Project & Release Handoff

Written for another AI agent picking up this repo cold. Covers three things:
how the project is organized, how the desktop app gets released on GitHub,
and how the installers are built. Everything below was verified by actually
running it (multiple full release cycles), not guessed from config files.

## What this project actually is

Three separately-deployed pieces sharing one repo:

1. **The web game** (`index.html` + the root `.js`/`.css` files) — a
   single-player/PVP Pokémon TCG simulator, Firebase-hosted at
   `https://pokemon-tcg-simulador.web.app`. Firebase project id:
   `pokemon-tcg-simulador` (see `.firebaserc`).
2. **The Electron desktop wrapper** (`electron/`) — packages the same web
   game into Mac/Windows/Linux installers, distributed as **GitHub
   Releases** on `hugoandri/Orange_League` (this repo's own `origin`). Has
   an in-app updater (`electron-updater`) that checks those Releases.
   **This is the piece "release" means below** — the web game deploys via
   `firebase deploy`, not a GitHub Release, and isn't covered further here.
3. **The PVP server** (`party/`) — a PartyKit worker for realtime PVP
   matches. Deployed separately via `partykit deploy` from inside `party/`.
   Not touched by the desktop-release process below.

## Project layout

```
index.html            Single-page web app shell (all screens live in here,
                       toggled by JS, not separate HTML files)
rules-engine.js        Pure game engine: state shape, turn/attack/retreat/
                       evolve logic, PVP state redaction. No DOM.
card-effects.js        ATTACK_EFFECTS / TRAINER_EFFECTS / POKEMON_POWER_EFFECTS
                       — one entry per card with a non-trivial effect.
data-cards.js          Real printed stats (HP, attacks, weakness/resistance,
                       retreat cost) for every card used by a theme deck.
data-decks.js          The theme decklists (Overgrowth/Blackout precons).
data-sets.js           Booster-pack pool data for the shop (Base/Jungle/Fossil).
ai.js                  CPU opponent logic (easy/normal/hard difficulty).
economy.js             Coins, packs, collection tracking (client-side helpers;
                       server is the source of truth via Cloud Functions).
shell-layout.js        Pixel-font digit/badge rendering helpers.
ui.js                  Everything else: rendering, DOM wiring, modals,
                       animations, PVP client glue. Largest file by far.
auth-ui.js              Login/signup, profile, and the Electron-only menu
                       wiring (SALIR button, update checker, version label).
admin.html             Standalone admin panel (own page, not part of the
                       game's own screen-toggling in index.html) — serves at
                       the /admin route (see firebase.json's rewrites).
                       Gated client-side by a hardcoded ADMIN_UID check on
                       firebase.auth().onAuthStateChanged, but every actual
                       mutation is re-checked server-side (functions/
                       index.js also hardcodes the same ADMIN_UID and
                       rejects any other request.auth.uid) -- the client
                       check is just UX, not the real security boundary.
                       Manages: novedades (news items shown in-game),
                       users list, rare-card pull odds per set, custom
                       booster packs, gift/redeem codes, and shop pricing
                       (packs, card-back protectors, Telegram-Stars orb
                       bundles) -- all via httpsCallable Cloud Functions
                       (publishNews/listUsers/setRareOdds/saveCustomPack/
                       saveGiftCode/setEconomyConfig etc.), never direct
                       Firestore writes from the browser.
tests.js / run-tests.js Plain console.assert-style tests for the engine
                       (rules-engine.js/card-effects.js/ai.js). Run with
                       `node run-tests.js`. tests.html runs the same file
                       against real <script> tags in a browser.

electron/
  main.js              Electron main process: window creation, IPC handlers
                       (quit, get-app-version, check/install updates).
  preload.js           contextBridge surface exposed to the renderer as
                       window.electronAPI (only place the renderer can touch
                       anything Electron/Node-related).

functions/             Firebase Cloud Functions (Node). All coin/collection/
                       match-reward mutations go through here — the client
                       never writes those directly. `firebase deploy
                       --only functions` to ship changes.
party/                 PartyKit PVP server. Requires rules-engine.js/
                       data-cards.js/card-effects.js directly from the repo
                       root (relative `require('../...')`) — those files'
                       exports (`module.exports = {...}` at the bottom of
                       each) are what make that possible; don't remove them.

build/icons/           Pre-generated app icons (all sizes + .icns/.ico) —
                       electron-builder reads these directly, nothing
                       generates them at build time.
.github/workflows/
  build-desktop.yml    Exists but is NOT the real release path (see
                       "What NOT to use" below) — don't rely on it.
```

## Desktop release process (verified, step by step)

**Standing rule**: every push to `main` that changes anything the desktop
app ships (engine, UI, `electron/`) should become a published GitHub
Release, not just a commit — the in-app updater only ever sees *published,
non-draft* Releases newer than the installed version. A plain commit does
nothing for users already running the app.

### 1. Make the code change, commit, push

Two separate commits per release, in this order:
1. The actual fix/feature (with tests updated/added and `node run-tests.js`
   passing — 776 tests as of this writing, 0 failures expected).
2. A version bump in `package.json`'s `"version"` field (patch bump for a
   fix, minor/major as warranted), its own commit, e.g. "Bump version to
   1.0.11 for the X fix". Push both.

### 2. Build all 6 targets in ONE combined invocation

```bash
rm -rf dist
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --win --linux --x64 --arm64
```

- **Must** be one single invocation covering every platform/arch together —
  building them in separate passes produces separate `latest*.yml` update-
  metadata files that don't merge correctly, breaking the in-app updater.
- **`CSC_IDENTITY_AUTO_DISCOVERY=false`** is required on Mac: without it,
  electron-builder attempts ad-hoc code signing, which hangs indefinitely
  contacting Apple's timestamp server (observed hanging 8+ minutes then
  never completing, especially on repeated same-day attempts). All Mac
  builds in this project ship **unsigned** — no paid Apple Developer ID —
  so Gatekeeper shows a first-launch warning, and Mac's in-app update
  checker deliberately never tries to self-install (see below).
- Produces (in `dist/`): `Orange League-X.Y.Z.dmg` + `-arm64.dmg`,
  `-mac.zip` + `-arm64-mac.zip`, `Orange League Setup X.Y.Z.exe` (universal,
  contains both x64 and arm64 — this makes it ~2x the size of a single-arch
  build, ~1GB vs ~540MB; that's expected, not a bug), `Orange League-X.Y.Z.AppImage`
  + `-arm64.AppImage`, plus `latest.yml` (Windows), `latest-mac.yml`,
  `latest-linux.yml`, `latest-linux-arm64.yml` (the update-metadata files).
- Takes several minutes; runs `@electron/rebuild` and downloads Electron
  per platform/arch pair.

### 3. (Recommended) Smoke-test the packaged build before publishing

Don't just trust the build succeeded — launch the actual packaged binary
and check the renderer isn't broken (this caught a real regression once:
v1.0.5 shipped a preload.js change that silently crashed the entire
`window.electronAPI` bridge):

```bash
"dist/mac-arm64/Orange League.app/Contents/MacOS/Orange League" --remote-debugging-port=9999 &
sleep 5
curl -s http://localhost:9999/json   # get the page's webSocketDebuggerUrl
```

Then connect a plain Node `WebSocket` to that URL and send a
`Runtime.evaluate` CDP command checking e.g. `window.electronAPI.appVersion`
matches, `window.electronAPI` has all its expected keys, etc. This works
without macOS Accessibility permissions and without a real user account.
Kill the process (`pkill -f "Orange League"`) when done.

### 4. Rename to hyphenated filenames matching the .yml metadata

electron-builder's local output filenames have **spaces**
(`Orange League-1.0.11.dmg`), but the generated `latest*.yml` files
reference electron-builder's own **hyphenated** sanitized names
(`Orange-League-1.0.11.dmg`) — that's what the shipped app's updater
actually requests. `gh release upload`/`gh release create` do **not** do
this sanitization themselves; GitHub's own upload API turns spaces into
**dots** instead (`Orange.League-1.0.11.dmg`), silently mismatching what
the yml expects. Always rename locally to hyphens first:

```bash
mkdir -p dist/release-assets
for f in "Orange League-X.Y.Z-mac.zip" "Orange League-X.Y.Z-arm64-mac.zip" \
         "Orange League-X.Y.Z.dmg" "Orange League-X.Y.Z-arm64.dmg" \
         "Orange League Setup X.Y.Z.exe" "Orange League-X.Y.Z.AppImage" \
         "Orange League-X.Y.Z-arm64.AppImage"; do
  cp "dist/$f" "dist/release-assets/$(echo "$f" | sed 's/ /-/g')"
done
cp dist/latest.yml dist/latest-mac.yml dist/latest-linux.yml dist/latest-linux-arm64.yml dist/release-assets/
```

### 5. Publish with `gh release create` (not electron-builder's own `--publish`)

```bash
gh release create vX.Y.Z dist/release-assets/* \
  --title "Orange League vX.Y.Z" \
  --notes "..."
```

- `gh release create` publishes **live** immediately (no draft step needed)
  — this is why it's preferred over electron-builder's own
  `--publish always`, which (a) creates the release as a **draft** by
  default, requiring a separate `gh release edit vX.Y.Z --draft=false` to
  make it visible to the updater, and (b) has been observed dying silently
  mid-upload (once got only 1 of 16 assets through).
- Large uploads (~4GB total across all assets) can take several minutes —
  consider running in the background and polling `gh release view vX.Y.Z`
  rather than blocking.
- Verify after: `gh release view vX.Y.Z --json isDraft,isPrerelease,assets`
  should show `isDraft: false` and all 11 expected assets (7 installers +
  4 yml files).

### 6. Copy friendly-named installers to `~/Downloads`

Unless told otherwise, also copy the original space-named installers
(not the release-assets copies) to `~/Downloads` for the human to grab
directly without going through GitHub:

```bash
cp "dist/Orange League-X.Y.Z.dmg" "dist/Orange League-X.Y.Z-arm64.dmg" \
   "dist/Orange League-X.Y.Z.AppImage" "dist/Orange League-X.Y.Z-arm64.AppImage" \
   "dist/Orange League Setup X.Y.Z.exe" ~/Downloads/
```

## Mac-specific quirks worth knowing

- **Unsigned app** → Squirrel.Mac (the native updater `electron-updater`
  wraps on Mac) rejects the downloaded update's code signature on
  `quitAndInstall()`. This fails **silently** — no error event, nothing
  JS-catchable, only visible in the macOS unified log (`/usr/bin/log show`,
  not the zsh `log` builtin). As of v1.0.11, the in-app update button on
  Mac doesn't even attempt a check — it immediately tells the user
  in-app updating isn't supported there, and they grab the new DMG from
  the Releases page by hand instead.
- **electron-updater's GitHub provider needs a *public* repo** when
  unauthenticated (no token embedded) — it reads the public
  `releases.atom` feed, which 404s on a private repo. This repo is public;
  if it's ever made private again, in-app update-checking breaks entirely
  for Windows/Linux too.
- `electron-builder`'s automatic "which node_modules are actually needed
  at runtime" detection can silently return zero modules. This project
  works around it by explicitly whitelisting the exact runtime dependency
  tree for `electron-updater` in `package.json`'s `build.files` array
  (found via `npm ls --omit=dev --all --parseable`) — if a new dependency
  is ever added that needs to ship in the packaged app, it likely needs
  the same explicit whitelisting, not just adding it to `dependencies`.

## What NOT to use

`.github/workflows/build-desktop.yml` exists in this repo but is **not**
the verified release path — every release described above was built and
published manually from a local machine. That workflow: builds per-OS on
separate GitHub-hosted runners (not one combined invocation, so it likely
produces the same broken split-metadata problem step 2 above warns about),
uses `--publish=never` (never creates or updates a GitHub Release at all,
just CI artifacts), and doesn't set `CSC_IDENTITY_AUTO_DISCOVERY=false` (Mac
runner could hang signing). Treat it as dormant/unverified rather than
extending it, unless explicitly asked to fix and adopt it as the real path.

## Testing before any release

```bash
node run-tests.js
```

Should print only `PASS` lines and exit 0. Add tests alongside any engine
change in `tests.js` — the existing suite is the main regression guard for
`rules-engine.js`/`card-effects.js`/`ai.js`, none of which have any other
automated coverage.
