# Shop Deck Purchases — Design Spec

## Problem

The game already ships a mandatory "starter deck selection" feature
(`docs/superpowers/specs/2026-09-18-starter-deck-selection-design.md`): a
new account permanently chooses exactly one of the 4 preconstructed decks
(`overgrowth`, `blackout`, `zap`, `brushfire`), granted as real, owned
collection cards. Every other place a deck can be selected — local play
(`updateActiveDeck`), the Decks screen, and PVP room creation/joining
(`validateDeckId`, `renderPvpDeckPicker`) — currently rejects any precon
that isn't the single `starterDeckChosen` value. There is no way today for
a player to legitimately acquire and use a second precon.

## Goal

Add a "MAZOS" tab to the Shop ("Tienda") selling the 4 preconstructed decks
for 1500 Orbes each. Buying a deck grants its real 60 cards to the player's
collection — the same grant `chooseStarterDeck` already performs for the
free starter choice — and a deck the player already owns (via the starter
choice or a previous purchase) shows as owned instead of offering a buy
button. Once bought, that deck becomes usable everywhere a deck can be
selected (local play, Decks screen, PVP), not just sitting in the
collection unused.

## Non-Goals

- No change to the existing starter-deck-choice flow itself (still free,
  still mandatory, still permanent as the player's very first deck).
- No discounts, bundles, or variable pricing beyond the single configurable
  flat price (mirrors how booster/protector prices already work).
- No way to buy back/refund a deck.
- No changes to custom-deck building (already correctly ownership-gated,
  untouched by this feature).

## Data Model

One new field on `users/{uid}`:

- `ownedPrecons`: `string[]` — every precon deckKey the player has ever
  acquired, via the starter choice AND/OR a Shop purchase. Seeded with
  `[deckKey]` at the exact moment `chooseStarterDeck` sets
  `starterDeckChosen`; `buyDeck` (new, below) appends to it. Absent/empty
  for a grandfathered account (never chose a starter deck) — this is
  intentional and load-bearing (see Gating Rule below).

`starterDeckChosen` is unchanged from the existing feature — still the
single "first choice" signal (`absent` = grandfathered, `null` = must
still choose, a deckKey string = has made the mandatory choice). It stays
authoritative for "has this account made its one mandatory choice," while
`ownedPrecons` is authoritative for "which decks can this account actually
use."

Config: `config/economy`'s existing document gains one more optional field,
`deckCosts: { overgrowth?: number, blackout?: number, zap?: number,
brushfire?: number }`, following the exact pattern `boosterCosts` and
`protectorCosts` already use — an admin-configurable override merged over
a flat 1500-Orbes-for-all-4 default when absent.

## Gating Rule (applies at all 4 existing lock points)

Every place that currently checks
`starterDeckChosen && starterDeckChosen !== deckKey` to reject a precon
changes to:

```
starterDeckChosen && ownedPrecons.indexOf(deckKey) === -1
```

This preserves the existing guarantee exactly: when `starterDeckChosen` is
falsy (grandfathered account, or the not-yet-chosen `null` state), the
check short-circuits to `false` and every precon stays fully open — zero
behavior change for those accounts, identical to today. Once
`starterDeckChosen` is a real string (the account has made its mandatory
choice), the account may use any precon in its own `ownedPrecons` array
(which always includes the starter choice itself, plus anything bought
since) instead of only the single starter-choice value.

The 4 call sites this rule applies to (all already exist, all already
enforce today's single-deck version of this same rule):
- `functions/index.js`'s `updateActiveDeck` (local play's activeDeck lock)
- `ui.js`'s Decks-screen precon click handler (the visible-but-locked UX)
- `functions/index.js`'s `validateDeckId` (PVP room creation/joining)
- `ui.js`'s `renderPvpDeckPicker` (the PVP deck-choice UI)

## Backend

### `buyDeck` (functions/index.js, new `onCall` function)

Request: `{ deckKey: string }`. Mirrors `buyCardBack`'s exact shape (the
closest existing precedent for "a flat-price, idempotent-if-already-owned
purchase into an array field") more closely than `openBooster`'s
random-pull shape, since this is a fixed, known, priced grant:

1. Requires auth.
2. Validates `deckKey` is one of the 4 real precons (`VALID_DECK_KEYS`,
   already defined) — `invalid-argument` otherwise.
3. Looks up the price via `fetchEconomyConfig()`'s new `deckCosts` (default
   1500 for any key not overridden).
4. Inside a transaction on `users/{uid}`:
   - If `deckKey` is already in `ownedPrecons`, return success immediately
     with no charge and no further writes (idempotent, matches
     `buyCardBack`'s exact early-return shape — a double-click or a stale
     "COMPRAR" button click never double-charges or errors).
   - Otherwise, if `coins < price`, throw `failed-precondition` ("No
     tienes suficientes Orbes.", matching `openBooster`'s existing
     message).
   - Otherwise: compute the grant via the EXISTING `starterDeckGrants
     (deckKey, CARD_CATALOG.base)` (no new grant logic — reuse verbatim),
     merge it additively into `collection` (same additive-merge pattern
     `chooseStarterDeck` already uses), append `deckKey` to `ownedPrecons`,
     deduct the price from `coins`, all in the same `tx.update`.
5. Returns `{ collection: <updated map>, ownedPrecons: <updated array>,
   coins: <updated balance> }`.

### The 4 lock-point updates

Each of the 4 existing call sites gets its single-value comparison widened
to an array-membership check per the Gating Rule above — no new logic
beyond that one-line change at each site, since all 4 already correctly
read `starterDeckChosen` from the same transaction/request context they'll
now also read `ownedPrecons` from.

### `createAccount` / `chooseStarterDeck`

`createAccount`'s existing `batch.set` gains `ownedPrecons: []` alongside
the existing `starterDeckChosen: null` (both start empty/null together for
a brand-new account). `chooseStarterDeck`'s existing transaction gains one
line: seed `ownedPrecons: [deckKey]` in the same `tx.update` that already
sets `starterDeckChosen` and merges the collection grant.

## Client

### `economy.js`

`econState` gains `ownedPrecons: data.ownedPrecons || []` (defaulted to an
empty array, unlike `starterDeckChosen`'s deliberate no-default — an
absent `ownedPrecons` on a grandfathered account safely means "nothing
purchased," which is already consistent with that account's `false`y
`starterDeckChosen` short-circuiting every gate open regardless).

New wrapper `buyDeckCloud(deckKey)`, following the same `.then(res =>
res.data)` pattern as `chooseStarterDeckCloud`.

### Shop "MAZOS" tab (`index.html` + `ui.js` + `shell-theme.css`)

A third `.shell-shop-tab[data-shop-tab="mazos"]` button alongside the
existing PACKS/PROTECTORES tabs, and a third `.shell-shop-panel` (
`shopDecksPanel`) following the exact same show/hide pattern
`showShopTab` already implements for the other two.

The panel's grid (`shopDecksGrid`) renders the 4 precons using the same
`.shell-shop-card` component styling Protectores already established (box
art via `Mazos/<key>.png`, name, `DECK_DISPLAY_NAME`, type badges reused
from the existing Decks-screen/starter-deck-screen markup), each card's
footer showing either `EN TU COLECCIÓN` (if `econState.ownedPrecons`
already contains that key) or a price + `COMPRAR` button (reading the
price from the same `globalEconomyConfig` the other tabs already listen
to via `initEconomyConfigListener`, falling back to 1500 if not yet
loaded/configured).

Buy button click: disables itself, calls `buyDeckCloud(deckKey)`, on
success merges the returned `collection`/`ownedPrecons`/`coins` into
`econState` and re-renders the grid (the bought card flips to `EN TU
COLECCIÓN` immediately) — on failure (insufficient Orbes, network error),
re-enables the button and shows the error inline, matching the existing
Protectores tab's own error handling exactly.

## Error Handling

- **Insufficient Orbes**: `failed-precondition` from the server, shown
  inline on the specific card's button area — same UX as every other
  purchase in this Shop already handles this.
- **Double-click / already-owned**: idempotent no-op on the server (no
  charge, no error) — the client-side re-render after a successful
  purchase also removes the buy button entirely, so this is a defense-in-
  depth case, not the primary UX path.
- **Network failure mid-purchase**: button re-enables, error shown, no
  partial state — the transaction either fully applies or doesn't, same
  guarantee every other purchase in this codebase already has.

## Testing

- New tests in `functions/test/` (mirroring `functions/test/starterDeck.
  test.js`'s exact emulator-based style) for `buyDeck`: a successful
  purchase grants exactly 60 cards and deducts exactly 1500 coins; a
  second purchase of the same deck is a no-op (no further charge, no
  error); insufficient coins fails with `failed-precondition`; an invalid
  deckKey fails with `invalid-argument`.
- New tests for each of the 4 updated lock points, extending the existing
  test coverage (`functions/test/starterDeck.test.js`,
  `functions/test/pvpDeckLock.test.js`) with a case where the account owns
  a SECOND deck (via `buyDeck`) and confirming it's now usable at that
  lock point, while a still-unowned third deck remains rejected.
- Explicit regression case: a grandfathered account (`starterDeckChosen`
  absent) remains completely unaffected by any of this — still freely uses
  any precon everywhere, `ownedPrecons` never consulted for it (since the
  gating rule's `starterDeckChosen &&` guard short-circuits first).
- `node run-tests.js` must stay 739 PASS / 0 FAIL / exit 0 (this feature
  touches none of the rules-engine logic that suite covers) — run once at
  the end as a regression check.
- The new Shop tab's UI is verified manually (matches this codebase's
  existing convention for every screen/modal): buy a deck, confirm it
  shows owned immediately, confirm it's now selectable on the Decks
  screen and in a PVP room's deck picker, confirm a still-unbought deck
  stays locked in both places.
