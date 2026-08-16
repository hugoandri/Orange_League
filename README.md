# Pokémon TCG Simulador

A single-player, browser-based simulator of the original (1998-99) Pokémon
Trading Card Game rules. You play the **Overgrowth** Base Set theme deck
against a CPU opponent playing **Blackout**.

## How to play

No install, no build step, no server. Just open `index.html` in a browser
(double-click it, or `open index.html` on macOS).

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
- Coins and your collection persist across sessions in the browser's
  `localStorage`, under the key `tcg_economy`. In-progress matches are
  *not* persisted — starting the page fresh always starts a new match,
  but keeps your coins/collection.

## Architecture

Plain `<script>` tags (no ES modules — those get blocked by CORS when
opening a page via `file://`), loaded in dependency order:

```
data-*.js       static card/deck/set data
rules-engine.js game state + pure action functions (DOM-free)
card-effects.js attack-name -> effect fn, trainer-name -> effect fn
ai.js           CPU heuristic decision logic
economy.js      coins, booster purchase, collection (localStorage)
ui.js           the only file that touches the DOM
```

This is a personal local project, not a published package — no `npm`,
no CI, no external dependencies.
