# Pokémon TCG Simulador

A single-player, browser-based simulator of the original (1998-99) Pokémon
Trading Card Game rules. You play the **Overgrowth** Base Set theme deck
against a CPU opponent playing **Blackout**.

## How to play

Needs a Firebase account now (see "Accounts & cloud economy" below) —
double-clicking `index.html` directly no longer works because Firebase
Auth requires the page to be served over http(s), not `file://`. For
local development, run `firebase emulators:start` and open
`http://127.0.0.1:5000`; the live version is hosted at
https://pokemon-tcg-simulador.web.app.

- **Jugar** tab: play a match against the CPU. Play Basics to your bench,
  evolve, attach one Energy per turn, play Trainer cards, retreat, and
  attack — the usual 1998-99 Base Set rules (Special Conditions clear on
  leaving Active, weakness ×2 / resistance −30, etc).
- **Colección** tab: spend coins on virtual booster packs (Base, Jungle, or
  Fossil, your choice) and track your collection checklist.

## Running tests

Tests are plain `console.assert`-style checks in `tests.js`, runnable two
ways:

- **Node (headless):** `node run-tests.js` — loads the game scripts in a
  Node `vm` sandbox and prints PASS/FAIL lines plus an exit code (0 = all
  passed). This is the dev-loop way to check nothing broke.
- **Browser:** open `tests.html` — loads the same `tests.js` against the
  same scripts as real `<script>` tags, for a sanity check that whatever
  passes in Node also behaves the same way in an actual browser.

## Economy

- Start balance: **150 coins**.
- Win a match: **+75 coins**. Lose: **+0**.
- A booster pack costs **100 coins** and contains **11 cards** (1
  Rare/Rare Holo + 3 Uncommon + 7 Common) drawn from whichever set you
  pick (Base, Jungle, or Fossil).
- Coins and your collection persist per-account in the cloud (see below) —
  they follow you across devices/browsers, not just one browser's
  `localStorage`. In-progress matches are *not* persisted — starting the
  page fresh always starts a new match, but keeps your coins/collection.

## Accounts & cloud economy

Coins and collection live per-account in Firestore — login is required to
play. Accounts, purchases, and match rewards are all served by Firebase
Cloud Functions, so the client never writes coins/collection directly. See
`docs/superpowers/specs/2026-08-18-cuentas-firebase-design.md` for the full
design (data model, Cloud Functions, security rules) and
`docs/superpowers/plans/2026-08-18-cuentas-firebase.md` for how it was
built.

**Login is by email + password**, not username — you pick a username at
signup (for the profile widget/board display) and can change it any time
from the profile widget (top-right of the main menu), but it never affects
how you log in. This also means there's no `resolveLoginEmail`-style lookup
function: the client already has the email, so login/forgot-password call
Firebase Auth directly.

To develop locally against the Firebase Emulator Suite instead of the real
project, uncomment the three `useEmulator(...)` lines in `firebase-init.js`,
then run `firebase emulators:start --project demo-test` and open
`http://127.0.0.1:5000`.

Tests:
- `node run-tests.js` — the game's own test suite (unchanged).
- `node functions/test/pureEconomy.test.js` — pure reward/booster-draw logic.
- `firebase emulators:exec --project demo-test --only firestore "node functions/test/rules.test.js"` — Firestore security rules.
- `firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/callable.test.js"` — the 5 Cloud Functions end-to-end (`createAccount`, `updateProfile`, `awardMatchResult`, `openBooster`, plus auth checks).

Deploy: `firebase deploy --project default`.

## Card images

All 228 Base Set/Jungle/Fossil card images live locally in `Cartas/`
(mirroring `images.pokemontcg.io`'s own path structure), and the card back
lives in `Cartas/Cardback.jpg` — both were originally hotlinked from
external hosts, then downloaded after a content blocker was found to
silently strip the card-back image for some players. `data-sets.js` is the
source of truth for card image paths; `functions/lib/cardCatalog.js` is a
deliberate duplicate of it for the Cloud Functions side (no bundler on the
client, Node on the server) — if `data-sets.js` ever changes, re-sync it:

```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('data-sets.js', 'utf8');
fs.writeFileSync('functions/lib/cardCatalog.js', src + '\nmodule.exports = CARD_CATALOG;\n');
"
```

## Shell redesign

The interface shell (menus, board frame, panels, HUD) is being re-skinned
screen-by-screen to a 32-bit-console visual design from a client handoff —
see `docs/superpowers/specs/2026-08-19-shell-redesign-design.md` for the
adaptation decisions and phase order. So far: the main menu only. Every
other screen still uses the original look until its own phase lands.

## Architecture

Plain `<script>` tags (no ES modules — those get blocked by CORS when
opening a page via `file://`), loaded in dependency order:

```
data-*.js       static card/deck/set data
rules-engine.js game state + pure action functions (DOM-free)
card-effects.js attack-name -> effect fn, trainer-name -> effect fn
ai.js           CPU heuristic decision logic
firebase-init.js initializes the Firebase app (client SDK config)
economy.js      Firestore listener + Cloud Function callers (coins, collection, profile)
auth-ui.js      login/signup/forgot-password flow, auth gating, profile edit modal
ui.js           the only file that touches the DOM
shell-layout.js DOM-free math for the shell redesign (stage scale/position, collection progress)
shell-theme.css shell redesign's design tokens + component styles (currently: main menu only)
functions/      Cloud Functions: createAccount, updateProfile,
                awardMatchResult, openBooster — the only code allowed to
                write coins/collection/username/photo
```

This started as a personal local project with no `npm`/CI/external
dependencies for the game itself — that's still true for everything above.
`functions/` is the one part of the repo with its own `package.json` and
`node_modules` (Cloud Functions require Node.js).
