# Jugar PVP — Fase 1 (salas + turno básico) — Design

Date: 2026-08-27
Status: Approved by user, pending implementation plan
Depends on: `2026-08-18-cuentas-firebase-design.md` (accounts/economy — unchanged)
Supersedes the "sub-project 2 — live PvP multiplayer" placeholder named
in that spec.

## 1. Purpose

Today the game is one human vs. a local, synchronous CPU
(`ai.js`/`cpuTakeTurn`). `rules-engine.js` and `card-effects.js` run
entirely client-side and mutate one shared `gameState` object that the
browser fully trusts — there is no concept of "the opponent's hidden
information" because the opponent is a bot with nothing to hide.

This spec adds real player-vs-player matches: two signed-in accounts
play a real game against each other, with Cloud Functions as the
authority over every move (so neither client can cheat by editing
local state), and with each player's hand/deck genuinely hidden from
the other's client — not just hidden in the UI, but never present in
any payload the other client can read.

This is Fase 1 of two. Fase 1 covers match setup (rooms) and the
**generic turn loop** — draw, play a Basic, evolve, attach Energy,
retreat, end turn, take a prize, choose a new Active, and "vanilla"
(no special-effect) attacks. A full match can be started, played, and
won or lost end to end. **Fase 2** (separate spec, out of scope here)
covers every attack/Trainer-card/Pokémon-Power effect currently
special-cased in `card-effects.js`'s `ATTACK_EFFECTS`/
`TRAINER_EFFECTS`/`POKEMON_POWER_EFFECTS` tables (~150+ entries) —
in Fase 1 an attack with a special-effect entry is simply rejected with
a clear "todavía no disponible en PVP" error.

## 2. Goals

- A "Jugar PVP" button on the main menu opens a modal with 3 options:
  **Buscar Rival** (matchmaking — disabled, grayed out, not built this
  phase), **Crear Sala** (generates a 6-character room code and waits
  for an opponent), **Buscar Sala** (type in a code to join).
- Two players can create/join a room, each pick a deck (same picker
  already used for CPU matches), ready up, and have the match actually
  start — server-side coin flip, real initial hands dealt.
- Every move (play a Basic, evolve, attach Energy, retreat, end turn,
  take a prize, choose a new Active, a non-special attack) is validated
  server-side by a Cloud Function that calls the exact same
  `rules-engine.js` functions `ui.js` already calls locally today. A
  client can never apply a move to its own view of the match without
  the server agreeing first.
- Neither player's hand contents, deck order, or un-taken prize card
  identities are ever present in anything the *other* client (or, for
  prizes, even the *owning* client) can read, matching real hidden-info
  rules.
- A match can reach a real winner (KO-driven prizes, no more Pokémon,
  or deck-out) using only Fase 1's generic mechanics + vanilla attacks.
- Existing local-vs-CPU play is completely unaffected — zero changes
  to `rules-engine.js`/`card-effects.js` behavior, zero regressions in
  the existing 633 client tests.

## 3. Non-Goals (this spec)

- Actual matchmaking ("Buscar Rival") — button exists, disabled.
- Any attack/Trainer/Power with a special effect (Fase 2).
- A public list of open rooms to browse ("Buscar Sala" is code-entry
  only).
- Disconnect/forfeit-by-timeout detection mid-match. Reconnection is
  *basic only*: reloading resubscribes to the same match by its
  remembered `matchId` and keeps working: If the opponent's tab closes
  and never comes back, the match just sits waiting for their next
  move — no timeout, no auto-forfeit.
- Rematch flow, spectating, chat, turn-clock parity with the local
  chess-clock feature (`timeBankMs` is not synced/enforced for PVP this
  phase).
- Explicit "cancelar sala" button for the host (rooms simply expire).

## 4. Sharing rules-engine.js/card-effects.js with Cloud Functions

`firebase.json`'s `functions[0].source` is `"functions"` — only that
directory's contents are ever packaged and deployed, so a
`require('../rules-engine.js')` reaching outside `functions/` works
under the emulator (same filesystem) but is **not** included in a real
`firebase deploy` artifact. The existing precedent in this repo
(`functions/lib/cardCatalog.js`, `functions/lib/pureEconomy.js`) is a
hand-maintained mirror copy — fine for a ~1800-line data table that
rarely changes, too risky to hand-sync for ~2550 lines of active game
logic.

Fase 1 adds a generated mirror instead of a hand-maintained one:

- `rules-engine.js` and `card-effects.js` stay at the repo root as the
  single edited source, loaded by the browser via `<script>` exactly as
  today — no change to their content or behavior.
- A new script, `functions/scripts/sync-shared-engine.js`, copies both
  files verbatim into `functions/lib/rulesEngine.js` and
  `functions/lib/cardEffects.js`, appending a small footer:
  ```js
  if (typeof module !== 'undefined') {
    module.exports = { attack, playBasic, evolve, attachEnergy, retreat,
      endTurn, getWinner, canAttack, canEvolve, canAttachEnergy,
      canRetreat, applyEndOfTurnCheckup, startMatch, /* ...every
      top-level function submitMatchAction needs to call */ };
  }
  ```
  (The exact export list is finalized in the implementation plan, once
  every function `submitMatchAction` needs is enumerated — this footer
  changes nothing about how the functions themselves run.)
- `firebase.json` gets a `"predeploy"` hook under the `functions`
  config running `node functions/scripts/sync-shared-engine.js` before
  every deploy, so the mirror is always regenerated fresh — never
  edited by hand, never allowed to drift.
- `functions/lib/rulesEngine.js`/`cardEffects.js` are gitignored inside
  `functions/` (generated artifacts, not source) — the sync script also
  runs once at the start of any local emulator test run that needs it.

## 5. Data model (Firestore)

### `rooms/{roomCode}`

Created/joined/updated only via Cloud Functions (`allow write: if
false`, same pattern as every other collection in this app).

```
{
  hostUid: string,
  hostDeckId: string,        // set at createRoom
  hostReady: boolean,
  guestUid: string | null,
  guestDeckId: string | null,
  guestReady: boolean,
  status: 'waiting' | 'started' | 'expired',
  matchId: string | null,    // set once both are ready and the match starts
  createdAt: Timestamp
}
```

`roomCode` is 6 characters, uppercase, from an alphabet excluding
visually ambiguous characters (`0/O`, `1/I`), generated server-side by
`createRoom` and checked for collision (retry on the rare clash) inside
a transaction — never client-supplied, so a player can't pick a
predictable/guessable code.

Rules: `allow read: if request.auth != null && (request.auth.uid ==
resource.data.hostUid || request.auth.uid == resource.data.guestUid);
allow write: if false;` A joining client never reads the room directly
before joining — `joinRoom` does the existence/status check
server-side and throws a friendly error (`not-found` / stale code)
instead.

### `matches/{matchId}` (public — both players read this directly)

```
{
  players: { player1: uid, player2: uid },
  deckIds: { player1: deckId, player2: deckId },
  activePlayerId: 'player1' | 'player2',
  turnCounter: number,
  phase: 'setup' | 'playing' | 'finished',
  winner: 'player1' | 'player2' | null,
  board: {
    player1: { active: PublicPokemonView | null, bench: PublicPokemonView[] },
    player2: { active: PublicPokemonView | null, bench: PublicPokemonView[] }
  },
  discard: { player1: CardRef[], player2: CardRef[] },  // always public in the real game
  prizesRemaining: { player1: number, player2: number }, // COUNT only, never contents
  deckCount: { player1: number, player2: number },
  handCount: { player1: number, player2: number },       // opponent's hand SIZE only
  lastAttackResult: {...} | null,     // same shape ui.js's showAttackOverlay already expects
  log: PublicLogEntry[],              // only events both players are entitled to see
  createdAt: Timestamp, updatedAt: Timestamp
}
```

`PublicPokemonView` = `{ name, damage, statusConditions, attachedEnergy:
CardRef[] }` — a Pokémon in play (active or benched) is public
information in the real game (attached Energy included), so this is
not redacted beyond just not being the *hand*.

Rules: `allow read: if request.auth != null && (request.auth.uid ==
resource.data.players.player1 || request.auth.uid ==
resource.data.players.player2); allow write: if false;`

### `matches/{matchId}/private/{uid}` (only its own owner reads it)

```
{ hand: CardRef[] }
```

That's the entire private view — deck order and un-taken prize
identities are not exposed even to their own owner, matching the real
rule that you don't know your own prizes until you take them (or your
own deck's order). Rules: `allow read: if request.auth != null &&
request.auth.uid == uid; allow write: if false;`

### `matches/{matchId}/serverOnly/state` (no client, ever)

The complete, un-redacted `gameState` object exactly as
`rules-engine.js` already shapes it locally today (both hands, both
decks in order, both prize piles with real card identities) — the
actual source of truth every Cloud Function reads and writes. Rules:
`allow read: if false; allow write: if false;` (Admin SDK bypasses
rules entirely; this entry exists purely as defense-in-depth, same
reasoning already used for `usernames/{username}`).

## 6. Room lifecycle

1. `createRoom({ deckId })` — auth required. Generates a unique
   `roomCode`, writes `rooms/{roomCode}` with `hostUid: request.auth.uid,
   hostDeckId: deckId, hostReady: false, guestUid: null, status:
   'waiting'`. Returns `{ roomCode }`.
2. The host's client starts an `onSnapshot` listener on
   `rooms/{roomCode}` and shows a "waiting for rival" screen with the
   code displayed large.
3. `joinRoom({ roomCode, deckId })` — auth required. Loads the room;
   throws `not-found` if missing, `failed-precondition` if
   `status !== 'waiting'` or if `request.auth.uid === hostUid` (can't
   join your own room), or if the room is older than the expiry window
   (see below, treated as `not-found` to the caller — an expired code
   simply "doesn't exist" from the joiner's point of view). On success,
   sets `guestUid`/`guestDeckId`, leaves `status: 'waiting'`. Returns
   `{ roomCode }`; the guest's client now starts its own listener on
   the same room doc (its own `guestUid` match now satisfies the read
   rule).
4. `setReady({ roomCode })` — auth required, caller must be
   `hostUid` or `guestUid` for that room. Sets that side's `*Ready:
   true`. If, after this write, BOTH `hostReady` and `guestReady` are
   true AND `status` is still `'waiting'` (both checked inside the same
   transaction, so two near-simultaneous calls can't both pass the
   check and create two matches for one room), this same call also:
   creates `matches/{matchId}` (new doc id), performs the coin flip and
   initial `rules-engine.js` setup (shuffles both decks, draws opening
   hands, places nothing yet — Active/Bench selection is itself the
   first `submitMatchAction` each player takes, unchanged from how
   local setup already works), writes the redacted public/private/
   serverOnly docs, and sets `rooms/{roomCode}.status = 'started'`,
   `matchId`. Both clients' room listeners see the flip to `'started'`
   and redirect into the match screen using `matchId`.
5. **Expiry**: a room in `'waiting'` status older than 20 minutes is
   treated as gone. `joinRoom` checks this lazily (belt-and-suspenders,
   same defensive style already used elsewhere in this codebase) and
   rejects with `not-found` even if cleanup hasn't run yet. A scheduled
   Cloud Function (`onSchedule`, every 15 minutes) deletes `'waiting'`
   rooms past that age so they don't accumulate forever.

## 7. Validated moves

`submitMatchAction({ matchId, action })` — auth required. `action` is
one of:

```
{ type: 'placeActive', handCardId }
{ type: 'placeBench', handCardId, benchIndex }
{ type: 'evolve', handCardId, targetInstanceId }
{ type: 'attachEnergy', handCardId, targetInstanceId }
{ type: 'retreat', targetInstanceId, discardEnergyIndices? }
{ type: 'attack', attackName }   // rejected if ATTACK_EFFECTS[attacker][attackName] exists — Fase 2.
                                 // Note: Ninetales' Lure (the one Base Set attack needing a chosen
                                 // target) has its own ATTACK_EFFECTS entry, so it falls under that
                                 // same Fase-2 rejection — no vanilla Fase-1 attack ever needs a target.
{ type: 'endTurn' }
{ type: 'takePrize', prizeIndex }
{ type: 'chooseActive', benchIndex }
```

The function: loads `serverOnly/state`; confirms `request.auth.uid` is
one of the match's two players and resolves which side (`player1`/
`player2`) they are; for actions that require it being their turn,
confirms `activePlayerId` matches; dispatches to the matching
`rules-engine.js` function (`playBasic`, `evolve`, `attachEnergy`,
`retreat`, `endTurn`, `attack`, the prize/active-choice equivalents —
the same functions `ui.js` already imports and calls today, unmodified);
recomputes `getWinner(state)`; and, inside one transaction, writes back
the updated `serverOnly/state` plus freshly-redacted `matches/{matchId}`
and both `private/{uid}` docs. An illegal move throws the same
`HttpsError` codes this codebase already uses elsewhere
(`failed-precondition`, `invalid-argument`) — the existing
`canAttack`/`canEvolve`/`canAttachEnergy`/`canRetreat` legality checks
in `rules-engine.js` are reused verbatim for this, exactly as `ui.js`
already calls them client-side before ever attempting a local action.

The redaction step (serverOnly state → public doc + two private docs)
is one pure function, `redactMatchState(state)`, added to
`rules-engine.js` itself (DOM-free, callable from both the client for
symmetry/tests and the Cloud Function) — it never needs to run
client-side in practice, but living in the shared file means Fase 2's
new action types don't need a second redaction implementation.

The function returns `{ ok: true }` on success — the calling client
does not read its own return value for the new state; it (like the
opponent) relies entirely on its own `matches/{matchId}` +
`private/{uid}` listeners for the authoritative update, the same
"snapshot is the source of truth" pattern `economy.js` already uses for
coins/collection.

## 8. Client integration

- **Menu**: new "Jugar PVP" button, same visual family as the existing
  menu buttons. Opens `#pvpModal`: **Buscar Rival** (disabled, grayed,
  a small "Próximamente" note), **Crear Sala**, **Buscar Sala** (a text
  input + "Unirse").
- **Crear Sala** flow: deck picker (reusing the existing component) →
  `createRoom` → waiting screen with the code shown large + a
  spinner + "Esperando rival…" → once the room listener reports
  `status: 'started'`, transition into the match screen.
- **Buscar Sala** flow: code input → deck picker → `joinRoom` →
  `setReady` is called automatically right after picking a deck for
  both flows (no separate "listo" button this phase — picking a deck
  and confirming IS readying up) → same room listener → transition.
- **Match screen**: a new PVP mode flag on the existing board screen.
  `wireBoardButtons`' handlers each gain a guard at their existing
  entry point: when in PVP mode, the handler calls the corresponding
  `submitMatchAction` and returns, instead of calling the local
  `rules-engine.js` function + mutating `gameState` directly. Two
  `onSnapshot` listeners (`matches/{matchId}`, `matches/{matchId}/
  private/{myUid}`) merge into the same locally-shaped `gameState`
  object `renderBoard()`/`showAttackOverlay()`/etc. already know how to
  render — the opponent's hand is represented as `handCount` empty
  placeholder cards, matching how the CPU's hand is already rendered
  face-down today. No changes to `renderBoard`, `showAttackOverlay`, or
  any other rendering function are needed for this to work.
- Local-vs-CPU play takes none of these new code paths — the PVP guard
  at the top of each handler is the only new branch point, and it's a
  no-op (falls through to existing behavior) whenever there's no active
  PVP match.

## 9. Testing

- `functions/test/pvpRoom.test.js` (new): `createRoom`/`joinRoom`
  auth/validation (own-room rejection, stale/nonexistent code,
  already-full room), `setReady` from both sides triggers match
  creation exactly once, room flips to `'started'` with a `matchId`.
- `functions/test/pvpMatch.test.js` (new): after a match starts,
  assert `matches/{matchId}` contains no hand-contents fields at all
  and `handCount` matches reality; assert each player's own
  `private/{uid}.hand` matches their real hand and the OTHER player's
  private doc is unreadable (permission-denied) to them; play through
  `placeActive`/`placeBench`/`attachEnergy`/`endTurn`/a vanilla
  `attack` for both sides and assert board state updates correctly;
  assert a special-effect attack (e.g. an attack with a real
  `ATTACK_EFFECTS` entry) is rejected; assert an out-of-turn or
  wrong-player action is rejected; play a contrived low-HP scenario
  through to a real KO → prize → winner.
- `node run-tests.js` (client, existing 633 tests): unaffected, run as
  a regression check — no `rules-engine.js`/`card-effects.js` behavior
  changes.
- The PVP client wiring (menu → modal → room → match-screen guard) is
  verified manually with two browser tabs signed in as two different
  test accounts against the emulator, the same way other UI-heavy
  features in this project have been verified without an automated DOM
  test harness.

## 10. Open questions / explicitly deferred

- Deciding whether Fase 2 also needs `timeBankMs` synced via server
  timestamps (today's local chess clock is wall-clock-per-tab, which
  doesn't make sense once two separate clients are involved) — left
  for Fase 2's own spec.
- Forfeit-by-disconnect and a rematch button are real gaps a friendly
  1v1 needs eventually, deferred per Section 3.
