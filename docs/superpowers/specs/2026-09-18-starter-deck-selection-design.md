# Starter Deck Selection — Design Spec

## Problem

Today, every account (new or existing) can freely play with any of the 4
preconstructed decks (`overgrowth`, `blackout`, `zap`, `brushfire`, defined
in `data-decks.js`'s `DECKLISTS`/`PRECON_DECK_KEYS`), with zero connection to
that account's real card collection (`users/{uid}.collection` in Firestore).
A brand-new account starts with `coins: 150, collection: {}` and can
immediately play ranked/local matches with any precon, never owning a single
one of those cards.

Separately, a full custom-deck-building system already exists and already
works correctly: up to 4 saved custom decks (`econState.customDecks`,
Firestore-persisted), built from cards the player actually owns
(`econState.collection`), enforced both client-side (`ui.js`'s deck builder)
and server-side (`functions/index.js`'s `saveCustomDeck`, via
`functions/lib/pureEconomy.js`'s `ownedCountsByName`/`validateCustomDeck`).
Nothing about that system needs to change.

## Goal

New accounts must choose exactly one of the 4 preconstructed decks as their
starter deck, once, the first time they create an account. That choice:

- Is permanent — once made, it can never be changed to a different precon.
- Grants the chosen deck's exact 60 cards as real, owned collection entries
  (not just permission to play a fixed preset) — from that point on, the
  player builds/customizes further using the existing booster-pack/deck-
  builder system, same as any other owned card.
- Does not affect existing accounts (created before this feature ships).
  They keep playing exactly as they do today, with free access to all 4
  precons and no forced choice.

## Non-Goals

- No changes to the existing custom-deck-building system (already correctly
  ownership-gated).
- No changes to booster-pack economics, pricing, or odds.
- No retroactive migration of existing accounts' `collection` or
  `activeDeck`.
- No ability to ever change the chosen starter deck later (no "reset" or
  "re-roll" flow in this scope).

## Data Model

One new field on `users/{uid}`:

- `starterDeckChosen`: `string | null | <absent>`
  - `null` — account was created after this feature shipped, has not yet
    chosen a starter deck. The mandatory choice screen gates the menu.
  - one of `PRECON_DECK_KEYS` (`'overgrowth' | 'blackout' | 'zap' |
    'brushfire'`) — the account has chosen and it's locked in.
  - **absent** (field never set) — the account was created *before* this
    feature shipped. Grandfathered: never gated, keeps today's free-access
    behavior indefinitely. No migration touches these documents.

No other new fields. `collection` and `activeDeck` are reused as-is.

## Backend

### `createAccount` (functions/index.js, existing function)

The `batch.set(db.collection('users').doc(uid), {...})` call gains one new
field: `starterDeckChosen: null`. This is the *only* change to this
function — it marks every account created from this point forward as
"owes a starter deck choice."

### `chooseStarterDeck` (functions/index.js, new `onCall` function)

Request: `{ deckKey: string }`.

1. Requires auth (`request.auth`), same as every other `onCall` in this
   file.
2. Validates `deckKey` is one of `PRECON_DECK_KEYS` (mirrored server-side,
   see below) — `HttpsError('invalid-argument', ...)` otherwise.
3. Inside a Firestore transaction on `users/{uid}`:
   - Reads the current doc. If `starterDeckChosen` is **not exactly
     `null`** (i.e. it's absent — grandfathered account — or it's already a
     string — already chosen), throw
     `HttpsError('failed-precondition', 'Ya elegiste tu mazo inicial.')`.
     This is the single source of truth for "can this account still
     choose" — the client-side gate (below) is a UX convenience, not the
     real enforcement.
   - Computes the card grants for `deckKey` (see "Server-side starter
     decklists" below): a set of `{ collectionKey: 'base-<num>', count }`
     entries.
   - Merges those into the existing `collection` map (adds to existing
     counts, in case — defensively — the account already owns some of
     these prints from elsewhere; in practice a brand-new account's
     collection is always `{}` at this point, but the merge is additive
     and safe either way).
   - Sets `starterDeckChosen: deckKey` and `activeDeck: deckKey`.
4. Returns `{ collection: <the updated map> }` so the client can update
   `econState` without waiting for the next `onSnapshot` tick.

### Server-side starter decklists (`functions/lib/starterDecks.js`, new file)

A server-only mirror of `data-decks.js`'s `DECKLISTS`, restricted to the 4
precon keys (same 60-card lists, by name+count — copy-pasted from
`data-decks.js`, not `require()`'d from it, since that file is a browser
global script with no `module.exports` and mixing browser/Node loading
conventions is out of scope here). Never trust a client-supplied card list
for a grant — this file is the single server-side source of truth for what
"choosing deck X" actually grants, mirroring how `openBooster` already
computes its own grants entirely server-side from `CARD_CATALOG`.

A new pure function in `functions/lib/pureEconomy.js`,
`starterDeckGrants(deckKey, cardCatalogBase)`, converts a decklist's
`{name, count}` entries into `{'base-<num>': count}` collection deltas by
looking up each name in the Base set's catalog (`CARD_CATALOG.base`) —
mirrors the name→print lookup `ownedCountsByName` already does in reverse.
This function is pure (no Firestore access) and independently testable.

`PRECON_DECK_KEYS` also gets mirrored into `functions/lib/pureEconomy.js`
(currently only exists client-side in `data-decks.js`) for
`chooseStarterDeck`'s own validation.

## Client

### `economy.js`

`econState`'s shape gains `starterDeckChosen: data.starterDeckChosen` (no
default — deliberately `undefined` when absent from Firestore, distinct
from `null`, so the client can tell "grandfathered" apart from "must
choose" the same way the server does).

New wrapper `chooseStarterDeckCloud(deckKey)`, following the exact pattern
of every other `*Cloud` wrapper in this file (thin call to
`firebase.functions().httpsCallable('chooseStarterDeck')({ deckKey: deckKey
})`).

### New mandatory screen (`ui.js` + `index.html`)

A new screen, `starterDeckScreen`, shown instead of the main menu when
`econState.starterDeckChosen === null` (checked at the same point
`auth-ui.js`'s `onAuthStateChanged` currently does
`document.getElementById('menuScreen').classList.remove('hidden')` — that
call becomes conditional). Cannot be dismissed without choosing — no close
button, no backdrop-click-to-close (unlike every other modal in this app,
which is deliberate here).

Visually: reuses the same 4 deck-preview cards already rendered on the
Decks screen (`renderDeckDetail`'s existing card-list preview, the same
`Mazos/<key>.png` box art already shown at `index.html`'s deck-selector
grid) in a simpler single-purpose layout — one clear "ELEGIR" action per
deck, a confirmation step ("¿Seguro? No podrás cambiarlo después") before
the actual `chooseStarterDeckCloud` call, since this is irreversible.

On success: merges the returned `collection` into `econState`, sets
`econState.starterDeckChosen` and `econState.activeDeck` to the chosen key,
hides `starterDeckScreen`, shows the normal menu.

On failure (network error, or the `failed-precondition` case if this
somehow double-fires): shows the error inline, lets the player retry — does
not advance past the screen.

### Decks screen lock (`ui.js`, existing `selectDeckCard`/deck-list
rendering)

Once `econState.starterDeckChosen` is a real deckKey (not `null`/absent),
any precon `.shell-deck-card` element whose `data-deck` is in
`PRECON_DECK_KEYS` but **isn't** the chosen key gets a new `locked` state:
visible (box art, name, card count all still shown, same as today) but its
click handler no longer calls `selectDeckCard` — instead it shows a short
explanatory message (reusing `showTargetHintModal`-style inline text, e.g.
"Ya elegiste tu mazo inicial") and does not change `activeDeck`. The chosen
precon and all 4 custom-deck slots behave exactly as they do today, fully
selectable.

Grandfathered accounts (`starterDeckChosen === undefined`) see zero change
— every precon stays freely selectable, exactly like today.

## Error Handling

- **Double-submit / two tabs racing**: the server-side transaction is the
  only real guard — `starterDeckChosen !== null` check inside the
  transaction rejects a second attempt cleanly with a Spanish error
  message. The client also disables its own "ELEGIR" buttons the instant
  one is pressed, purely as UX polish, not as the actual safeguard.
- **Grandfathered account somehow calls `chooseStarterDeck` anyway** (e.g.
  a modified client): rejected the same way, since `starterDeckChosen` is
  `undefined` (not `null`) on their doc — same `failed-precondition`
  branch handles both "already chosen" and "never eligible" without
  needing to distinguish them for the client.
- **Network failure mid-call**: the mandatory screen stays up, shows a
  retry-able error, never silently lets the player reach the menu without
  a confirmed successful choice.

## Testing

- New pure-function unit tests in `functions/test/` (mirroring this
  project's existing `functions/test/*.test.js` pattern) for
  `starterDeckGrants(deckKey, CARD_CATALOG.base)`: correct card→print
  mapping and counts for all 4 decks, total grant sums to exactly 60 cards
  each (cross-checked against `data-decks.js`'s own documented per-deck
  totals in its header comment).
- New tests for `chooseStarterDeck`'s transactional rules: a fresh account
  (`starterDeckChosen: null`) can choose once and succeeds; a second call
  from the same account fails with `failed-precondition`; an account with
  no `starterDeckChosen` field at all (grandfathered) fails the same way;
  an invalid `deckKey` fails with `invalid-argument`.
- `node run-tests.js` must stay green (this feature doesn't touch
  `rules-engine.js` or anything else that suite covers) — run once at the
  end as a regression check, same as every other plan this session.
- The new mandatory screen and the Decks-screen lock are verified manually
  (this project has no existing UI test harness) — a written checklist:
  create a brand-new account, confirm the screen blocks the menu, choose a
  deck, confirm the other 3 precons show locked afterward, confirm the
  chosen deck's cards actually appear in the collection/deck builder,
  confirm an existing (pre-feature) account sees no change at all.
