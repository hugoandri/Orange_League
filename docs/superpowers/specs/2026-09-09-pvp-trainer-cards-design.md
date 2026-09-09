# Trainer Cards in PVP — Design

Date: 2026-09-09
Status: Approved by user, pending implementation plan
Depends on: `2026-09-09-partykit-pvp-migration-design.md` (the PartyKit
transport this builds on — `party/index.js`'s `runAction`, the
`{type:'action', reqId, action}` / `{type:'match', public, myHand}` /
`{type:'ack'}` / `{type:'error'}` protocol, and `redactedFor`'s redaction
pattern are all extended here, not replaced).
Supersedes: the client-side guard added right after that migration
(`ui.js`'s Trainer-card click handler currently blocks every Trainer play
in PVP with "Los Entrenadores todavía no están disponibles en el PVP.") —
this spec removes that block and replaces it with real support.

## 1. Purpose

PVP's live-action support (from the PartyKit migration) only covers the
generic turn loop — placing/evolving Pokémon, attaching Energy, retreating,
ending a turn, taking a prize, a vanilla attack. Trainer cards were never
implemented server-side, in the old Firestore-based PVP or the new
PartyKit one — the client had no guard against playing one anyway, which
surfaced as a real bug during live testing: a Trainer card ran its effect
against the client's own **reconstructed** `gameState` (whose deck array
is placeholder `{}` objects in PVP, since real deck contents never reach
either client) producing visibly broken results (e.g. "undefined" drawn
cards) and never telling the server or the opponent anything happened at
all. That specific corruption was patched with a same-day guard that
blocks every Trainer play in PVP with a clear message — safe, but Trainer
cards genuinely don't work there.

This spec makes them work for real: every one of the 25 Trainer cards in
`card-effects.js`'s `TRAINER_EFFECTS` table becomes playable in PVP,
applied server-authoritatively (same trust model as every other action),
with the same full-screen "card played" reveal both sides already see
against the CPU, shown to **both** players regardless of who played it.

## 2. Goals

- All 25 `TRAINER_EFFECTS` entries work in PVP, with the exact same
  legality rules and effects local-vs-CPU play already has (these
  functions are reused verbatim, not reimplemented).
- Every Trainer play is server-authoritative: the client can never apply
  one to its own state without the server agreeing first, same guarantee
  the generic turn-loop actions already have.
- Both players see a full-screen reveal of whichever card was just played
  (reusing `showTrainerPlayedOverlay`/`showTrainerPlaysSequence`,
  already built for local play), including — for the 2 cards that search
  the deck for a specific card (Computer Search, Pokémon Trader) — the
  card that was found, the same way the real game reveals it.
- The 3 cards that need to search or reorder the player's own hidden deck
  (Computer Search, Pokémon Trader, Pokédex) keep the exact same visual
  picker UI local play already has, fed with the player's real deck
  contents — revealed only to that one player, never to the opponent.
- `ui.js`'s existing Trainer-card selection flows (menus, multi-step
  picks, modals) are reused as-is for both local and PVP play — this
  spec changes where the final effect gets *applied*, not how the player
  *chooses* what to play.

## 3. Non-Goals

- Pokémon Powers (Habilidades) and special-effect attacks — still
  rejected server-side exactly as today; unrelated to Trainer cards.
- Turn-clock/timeout enforcement, rematch, spectating — unchanged scope
  carried over from the PartyKit migration spec.
- Redesigning any of `ui.js`'s existing Trainer-card selection UI — every
  modal, menu, and multi-step flow stays pixel-for-pixel what local play
  already has.

## 4. Architecture: one generic action, plus one read-only peek

Every `TRAINER_EFFECTS[name]` function already shares the signature
`(state, playerId, handId, ...extraArgs)` — the same shape as the
already-ported `evolve`/`attachEnergy`/etc. — and already validates
legality *before* mutating anything, returning `{legal: false, reason}`
on failure with zero side effects. This means the 25 cards don't need 25
server-side cases: `party/index.js`'s `runAction` gains **one** new case,
`'playTrainer'`, whose action payload is
`{type: 'playTrainer', trainerName, handId, args: [...extraArgs]}`:

```javascript
case 'playTrainer': {
  const fn = TRAINER_EFFECTS[action.trainerName];
  if (!fn) { throw new Error('Carta de Entrenador desconocida.'); }
  const result = fn.apply(null, [this.state, side, action.handId].concat(action.args || []));
  if (!result.legal) { throw new Error(result.reason); }
  this.trainerRound = (this.trainerRound || 0) + 1;
  this.lastTrainerPlay = { side, cardName: action.trainerName, targetName: result.targetName || null, round: this.trainerRound };
  break;
}
```

(`this.lastTrainerPlay`/`this.trainerRound` feed the reveal broadcast —
Section 6 — same per-room counter shape `rpsRound` already uses inside
`this.state`, kept on the `Server` instance itself here since Trainer
plays, unlike RPS, only ever happen during `'playing'` phase, well after
`this.state` already exists.)

Three cards — Computer Search, Pokémon Trader (search the whole deck for
a card), and Pokédex (reorders the top 5) — need the player to *see*
deck contents they don't otherwise have access to in PVP. For these, the
client first sends a read-only `{type: 'peekOwnDeck', reqId}` request;
the room answers **only that connection** (never broadcast) with
`{type: 'deckPeek', reqId, cards: [...]}` — that side's real, current
`this.state.players[side].deck` (id + name per card, same shape hand
cards already use). Read-only, no state mutation, so it carries no
legality/turn-gating concerns; the actual play still gets validated
normally once the player picks and the real `playTrainer` action fires.

## 5. Client wiring

Today, every Trainer-card branch in `ui.js`'s hand-card click handler
(~15 call sites: no-target cards, Computer Search, Energy Retrieval,
Item Finder, Maintenance, Pokémon Trader, Pokémon Flute, Revive, Pokédex,
Pokémon Breeder, Super Potion, Energy Removal, Super Energy Removal, plus
the single-target ones sharing the board-click handler) ends by calling
`TRAINER_EFFECTS[name](gameState, 'player', handId, ...args)` directly
and re-rendering. This spec replaces every one of those call sites with a
single shared helper:

```javascript
function applyOrSubmitTrainerEffect(trainerName, handId, args) {
  if (pvpMode) {
    submitMatchActionCloud(pvpActiveMatchId, { type: 'playTrainer', trainerName: trainerName, handId: handId, args: args || [] })
      .catch(function (err) { alert(err.message || 'Jugada inválida.'); });
    return;
  }
  var result = TRAINER_EFFECTS[trainerName].apply(null, [gameState, 'player', handId].concat(args || []));
  if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
  selectedHandId = null;
  renderBoard();
}
```

Every intermediate selection step (which cards to discard, which board
Pokémon to target, which deck card was picked) is unchanged — those steps
only ever collect the player's clicks into local JS variables; they never
touch `gameState` until this one final call, so they're already
PVP-agnostic. Only the ~15 call sites where `TRAINER_EFFECTS[name](...)`
is invoked directly change, to `applyOrSubmitTrainerEffect(name, handId,
[...args])` — mechanical, one shared implementation, not 15 bespoke ones.

For the 3 deck-searching cards, the one extra step: where local play
today opens `openDeckSearchModal(gameState.players.player.deck, onPick)`
directly, the PVP path first awaits a new `peekOwnDeckCloud()` (mirrors
`submitMatchActionCloud`'s reqId-correlated promise pattern, reusing the
same `pvpPendingActions` map) and opens the modal with *that* real data
instead — `onPick` still ends by calling `applyOrSubmitTrainerEffect` like
every other card.

## 6. The reveal

`redactedFor`'s public payload gains `lastTrainerPlay: {side, cardName,
targetName, round}`, incremented each time a `'playTrainer'` action
succeeds — the exact same shape and round-counter pattern
`rpsLastResult`/`rpsRound` already use. `ui.js` gets a sibling to the
existing `pvpRpsRevealTimer` gate (`pvpTrainerRevealedRound`/
`pvpTrainerRevealTimer`/`pvpTrainerLatestMatchData`): when
`pub.lastTrainerPlay.round` advances past what's already been shown, it
calls the existing `showTrainerPlayedOverlay`/`showTrainerPlaysSequence`
(unmodified — same ~1.5s hold+fade this already uses for local play) for
**both** players regardless of which side's `lastTrainerPlay.side` played
it, then applies the deferred board update once the reveal finishes — the
same defer-then-apply shape the RPS-reveal gate already uses in
production.

`targetName` (Section 4) is what makes Computer Search/Pokémon Trader show
the found card, via `cpuActionLabel`'s existing fallback case (`'→ sale '
+ translateCardName(play.targetName)`) — already wired, already correct,
once the field is populated. It isn't today, in local play either: fixing
this doubles as a small local-play correctness fix. `TRAINER_EFFECTS['Computer
Search']` and `['Pokémon Trader']` each get one line changed, from
`return { legal: true };` to `return { legal: true, targetName: found.name };`
— everything else in either function is untouched. No other card sets
`targetName` today and none needs to for this spec (Pokédex reorders, it
doesn't reveal a found card).

## 7. Testing

Same WebSocket-driven pattern `party/test/match.test.js` already
establishes. New scenarios: a no-target card (Bill) — both sides receive
the reveal, the acting side's hand updates with real card names (not
`undefined`), the round counter advances; a multi-arg card (Maintenance)
— all gathered args reach the server intact; the `peekOwnDeck` flow for
one deck-searching card (Computer Search) — the requesting side gets
their real deck back, the *other* side never receives a `deckPeek`
message for it, and the resulting play's `lastTrainerPlay.targetName`
matches the card that was actually found.

`node run-tests.js` (739 tests) stays green — this spec adds new
`TRAINER_EFFECTS` return-value fields and new `party/index.js`/`ui.js`
wiring, but changes no existing function's legality/effect logic.

## 8. Open questions / explicitly deferred

- Exact wording/timing tuning for the reveal overlay when it's the
  *rival's* play vs. the player's own — `cpuActionLabel` already
  distinguishes these (`mine` check), reused as-is; no new copy to write
  unless testing surfaces something specific.
- Whether `peekOwnDeck` needs any deck-size cap or pagination for a
  worst-case near-full deck — implementation-plan detail, not a design
  decision (existing local-play `openDeckSearchModal` already renders a
  full deck's worth of cards today with no such cap).
