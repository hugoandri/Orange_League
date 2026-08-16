# Pokémon TCG Simulator — MVP Design

Date: 2026-08-16
Status: Approved by user, pending implementation plan

## 1. Purpose

A single-player, browser-based simulator of the original (1998-1999)
Pokémon TCG rules, playable by opening a local HTML file (no server,
no build step). The player uses the **Overgrowth** preconstructed
Base Set theme deck against a fixed CPU opponent using the
**Blackout** preconstructed Base Set theme deck. Winning a match
awards virtual currency, which can be spent on virtual booster packs
(11 cards each, from Base Set, Jungle, or Fossil — player's choice)
whose contents are added to a persistent collection/checklist.

This is the first of several planned phases. Deck building from the
collection, additional playable/CPU decks, and more Trainer/Pokémon
effects are explicitly deferred (see §8).

## 2. Goals

- A rules engine that correctly implements 1998-99 Pokémon TCG core
  mechanics (see §5) for any card, not just the two decks in scope.
- Overgrowth vs. Blackout is fully playable start-to-finish with no
  unimplemented-effect dead ends.
- A CPU opponent that makes legal, reasonable (not necessarily
  optimal) moves every turn without crashing or stalling.
- A coins → boosters → collection loop that persists across browser
  sessions via `localStorage`.
- Runs by double-clicking `index.html`. No `npm install`, no dev
  server, no build step.

## 3. Non-goals (this phase)

- Deck building / editing from the collection.
- Any deck other than Overgrowth (player) and Blackout (CPU).
- Special conditions or Trainer effects not required by those two
  decks (the engine supports them structurally, but only the
  needed instances are implemented — see §6).
- Multiplayer, matchmaking, or any server/backend.
- Persisting an in-progress match across a page reload (only coins
  and the collection persist).
- Sound, animation polish beyond basic hover/transition states.

## 4. Architecture

New project at `/Users/hugoandrianoff/Pokemon/tcg-simulador/`, its own
local git repo (no remote). Plain `<script src>` tags, **not** ES
modules — module scripts are blocked by CORS when a page is opened via
`file://`, and preserving double-click-to-play matters more than
import/export syntax here.

```
tcg-simulador/
  index.html
  style.css
  data-cards.js      // static game-stat data for the ~50 unique cards
                      // used by Overgrowth + Blackout (HP, types,
                      // attacks incl. cost/damage/text, weakness,
                      // resistance, retreat cost, image URL)
  data-decks.js       // exact 60-card list (with quantities) for
                      // Overgrowth and Blackout
  data-sets.js        // the existing 228-card catalog (name, number,
                      // rarity, set, image) reused from the reference
                      // page's data-blob, needed for booster pools
  rules-engine.js      // game state + pure action functions
  card-effects.js      // attack-name -> effect fn, trainer-name -> effect fn
  ai.js                 // CPU decision logic
  economy.js            // coins, booster purchase, collection (localStorage)
  ui.js                  // rendering: board, hand, log, collection view
  tests.js + tests.html  // manual-assert smoke tests, opened separately
```

Load order in `index.html`: data files → rules-engine → card-effects →
ai → economy → ui (each later file depends only on earlier ones;
`ui.js` is the only file that touches the DOM).

### Data sourcing (not hardcoded from memory)

- Card game-stats (`attacks[]` with cost/damage/text, `hp`, `types`,
  `weaknesses`, `resistances`, `retreatCost`) come from the
  pokemontcg.io API (`set.id:base1` for Base Set), the same source
  already validated for the reference page — that page only captured
  name/number/rarity/image, so this is a follow-up fetch of the fuller
  card objects for the specific cards Overgrowth and Blackout use.
- The exact 60-card decklists (which cards, what quantities) for
  Overgrowth and Blackout are sourced from their Bulbapedia articles
  (`Overgrowth_(TCG)`, `Blackout_(TCG)`), the same articles already
  used to source deck box art and composition summaries. The
  previously-gathered composition counts (Overgrowth: 23 Pokémon / 9
  Trainer / 28 Energy; Blackout: 27 Pokémon / 5 Trainer / 28 Energy)
  must match the freshly-fetched decklist as a consistency check.
- No card name, damage value, or effect text is to be invented from
  memory — anything not confidently sourced gets flagged rather than
  guessed, same standard used for the reference page.

## 5. Rules engine (core, applies to any card)

**Setup:** shuffle 60-card deck, draw 7, mulligan-if-no-basic (reshuffle,
redraw 7, opponent draws +1 per mulligan on their next draw), 6 prizes
set aside face down, place 1 Basic active + up to 5 Basic on bench,
coin flip for who goes first.

**Turn phases** (per player, alternating):
1. **Draw** — skipped for the player who takes the very first turn of
   the game.
2. **Main phase** — any order, any number of times unless noted:
   play Basic to bench (max 5); evolve (max once per Pokémon per turn;
   not the turn that Pokémon entered play; not on the game's first
   turn at all); attach 1 energy card total this turn; play any number
   of Trainer cards (each card's own effect may impose its own
   once-per-turn-style limits, handled in `card-effects.js`, not the
   engine); retreat active ↔ bench once per turn, paying the retreat
   cost (blocked if active is Asleep/Paralyzed).
3. **Attack** — ends the turn; not available on the game's first turn
   for the starting player; requires the attack's energy cost to be
   attached; resolves damage, applies weakness (×2 damage) then
   resistance (−30, floor 0), then any attack-specific effect.
4. **Checkup** — apply between-turn effects (Poison −10/Burn −10
   damage with the burn coin-flip-to-heal check, Asleep coin flip to
   wake, Paralysis clears at the end of the paralyzed player's *next*
   turn), then check for knockouts → discard, damage counters
   removed, defeated player's opponent draws prize(s) (2 if the
   defending Pokémon was worth extra prizes — not applicable to any
   card in the base rarity tiers used here, so effectively always 1).

**Win conditions:** all 6 prizes taken; opponent has zero Pokémon in
play and none to place; opponent cannot draw at the start of their
turn (empty deck).

**Special conditions:** Asleep / Confused / Paralyzed are mutually
exclusive (applying one replaces any other of these three); Poisoned
and Burned can stack with each other and with one of the above three.
The engine implements the generic state machine for all five. Whether
Overgrowth's or Blackout's actual attack texts inflict any of these
is not yet confirmed (depends on the data fetched per §4) — see §10.
If it turns out neither deck triggers any special condition in play,
the mechanic still ships (tested via synthetic fixtures in
`tests.js`) rather than being deleted, since it's needed the moment
more cards are added in a later phase.

## 6. Card effects registry

Two lookup tables in `card-effects.js`:

```js
ATTACK_EFFECTS["Hitmonchan"]["Special Punch"] = function(state, attacker, defender) {
  // returns { damage, apply(state) } — apply() does anything beyond
  // flat damage (coin flips, extra effects)
}

TRAINER_EFFECTS["Professor Oak"] = function(state, player) {
  // mutates state directly (discard hand, draw 7); returns
  // { legal: bool, reason?: string } if it can't legally be played
}
```

The rules engine calls into these tables by name and never contains
card-specific logic itself — this keeps the engine reusable for future
decks without modification. Only the effects needed for Overgrowth's
9 trainer-card slots and Blackout's 5 trainer-card slots, plus every
distinct attack printed on the ~50 unique cards across both decks,
are implemented this phase. Anything else stays out of the two decks
by construction (the decklists only contain implemented cards), so
there's no unimplemented-effect dead end during play.

## 7. CPU AI (`ai.js`)

Deterministic heuristic, evaluated at the start of the CPU's main
phase and re-evaluated after each action (since playing a card can
unlock new legal actions):

1. If any bench Pokémon can evolve, evolve it; then the active.
2. If the active can't yet pay for its best-damage available attack
   and an energy card for that type is in hand, attach it.
3. Play a Basic to the bench if hand has one and bench has room.
4. Play a Trainer if it has an obviously-positive effect available
   this turn (Potion/Super Potion when active is damaged, Professor
   Oak when hand ≤ 2 cards, PlusPower/Super Energy Removal/Energy
   Removal only during/against an attack exchange as relevant).
5. If the active can legally attack, attack with whichever payable
   attack does the most damage.
6. Otherwise, if retreat is legal and a bench Pokémon is better
   positioned to attack next turn, retreat into it.
7. If none of the above apply, pass.

This is intentionally simple — not minimax, no lookahead beyond the
current turn. Documented as a known limitation, improvable later
without touching the rules engine (AI only calls the same action
functions the player's UI calls).

## 8. Economy & collection (`economy.js`)

- `localStorage` keys: `tcg_coins` (number), `tcg_collection`
  (map of `"{set}-{number}"` → owned count).
- Start balance: 150 coins. Win: +75. Loss: +0.
- Booster: 100 coins, player picks Base/Jungle/Fossil at purchase
  time, draws 11 cards from that set's real catalog (already in
  `data-sets.js`) weighted as 1 card from the Rare/Rare Holo pool + 3
  from Uncommon + 7 from Common (Common pool already includes basic
  Energy cards, since those carry rarity `Common` in the sourced
  data — no separate energy slot needed).
- Collection view: grid grouped by set (same visual language as the
  existing reference page), each card shows owned count, with a
  running "X / 228" checklist total.
- Match state (mid-game board) is *not* persisted; coins and
  collection are, and are re-read from `localStorage` on load.

## 9. Testing approach

No test framework/build step, consistent with the rest of the
project. `tests.html` loads the same scripts as `index.html` plus
`tests.js`, which runs plain `console.assert`-based checks against
`rules-engine.js` and `economy.js` (both DOM-free, pure-data modules,
so they're testable in isolation) and prints a pass/fail summary to
the page. Minimum coverage before calling the engine done:

- Energy-attach limited to 1/turn.
- Evolution blocked same-turn-played and blocked on game's first turn.
- Weakness doubles damage; resistance subtracts 30 with a floor of 0;
  both apply together correctly.
- KO removes the Pokémon, awards exactly 1 prize, clears damage
  counters from the discarded card.
- All three win conditions (prizes empty, opponent has no Pokémon,
  opponent decks out) each independently end the game correctly.
- Mulligan reshuffles and redraws 7, and gives the opponent the
  correct number of bonus draw cards.
- Booster purchase deducts coins correctly and refuses when balance
  is insufficient.
- A scripted CPU-vs-CPU run (Overgrowth AI vs Blackout AI, both
  seats driven by `ai.js`) completes N games without throwing and
  without exceeding a reasonable turn cap (guards against infinite
  loops in the AI or engine).

## 10. Open items carried into the implementation plan

- Fetching and cross-checking the exact Overgrowth/Blackout decklists
  and full card stat blocks (§4's data sourcing) is real work with
  real API/Bulbapedia calls — it happens during implementation, not
  during this spec, and any card the sources can't confirm gets
  flagged instead of guessed.
- Whether Poison/Burn/etc. actually get exercised by these two decks'
  real attack texts won't be known until that data is in hand (§5).
