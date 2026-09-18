# Special-Effect Attacks in PVP — Design

Date: 2026-09-10
Status: Approved by user, pending implementation plan
Depends on: `2026-09-09-partykit-pvp-migration-design.md` (the PartyKit
transport this builds on — `party/index.js`'s `runAction`'s existing
`'attack'` case, the `{type:'action', reqId, action}` / `{type:'match',
public, myHand}` protocol, and `redactedFor`'s redaction pattern are all
extended here, not replaced) and `2026-09-09-pvp-trainer-cards-design.md`
(the reveal-gate pattern this reuses).
Supersedes: `party/index.js`'s current guard in the `'attack'` case that
rejects any attack whose attacker has a registered `ATTACK_EFFECTS`
special-effect function with "Ese ataque todavía no está disponible en
PVP (Fase 2)." — this spec removes that guard and makes those attacks
work for real, plus adds the full-screen attack reveal PVP is currently
missing even for vanilla attacks.

## 1. Purpose

PVP's `'attack'` action already calls `attack()` (rules-engine.js) — the
exact same function local-vs-CPU play uses — but `party/index.js`
pre-emptively rejects any attack whose attacker has a registered
`ATTACK_EFFECTS[attackerName][attackName]` entry (coin flips, conditional/
extra damage, Special Conditions, self-damage, shields, etc.), long before
any of that logic was verified safe for PVP's redacted-state model. Only
plain fixed-damage attacks (no registered effect) currently work.

Separately — and true for vanilla attacks too — PVP never shows the
full-screen "both cards in the foreground, damage number, new Special
Condition" reveal (`showAttackOverlay`) that local-vs-CPU play always
shows on every attack. The board just silently updates; the only
indication anything happened is a text log line and the HP bar moving.

This spec makes special-effect attacks work in PVP, server-authoritative
like every other action, AND adds the missing full-screen attack reveal
for every PVP attack (special or vanilla) — matching local-vs-CPU play's
UX exactly, the same standard already set for the RPS and Trainer-card
reveals.

## 2. Goals

- Every attack with a registered `ATTACK_EFFECTS` entry works in PVP, with
  the exact same legality rules and effects local-vs-CPU play already has
  (`attack()`/`ATTACK_EFFECTS` reused verbatim, not reimplemented).
- Ninetales' Lure (the one Base Set attack needing a chosen target) works
  in PVP: the player picks a real opposing Bench Pokémon, same modal/click
  flow local play already has, and the server receives and honors that
  real choice instead of always getting an empty target.
- Metronome (Clefairy) works in PVP: the player's chosen "attack to copy"
  (same modal local play already has) reaches the server and is honored.
- Both players see a full-screen reveal of every attack in a PVP match —
  attacker card, defender card, real final damage, any new Special
  Condition, a self-damage badge, or "MISS" — reusing `showAttackOverlay`
  verbatim, the same ~2s hold+fade local play already uses.
- An attack that knocks out the opponent's Active still correctly opens
  the prize-choice/end-turn-confirm flow in PVP, even with the new reveal
  animation now sitting in between the snapshot arriving and the board
  updating.

## 3. Non-Goals

- Pokémon Powers (Habilidades), real forfeit/surrender, and chess-clock
  sync are separate, already-identified follow-up projects — untouched
  here.
- No change to `ATTACK_EFFECTS`' legality/effect logic itself — every
  function in `card-effects.js` is reused exactly as it already exists for
  local play.
- No new UI for choosing Metronome's copied attack or Lure's target — both
  reuse the exact modals/click flows local play already has pixel-for-
  pixel; this spec only changes where the final effect gets *applied* in
  PVP (server, via `submitMatchActionCloud`, instead of local `gameState`).

## 4. Architecture: extend the existing `'attack'` case, no new action type

Unlike Trainer cards (which needed a brand-new `playTrainer` action),
attacks already have a working `'attack'` case in `party/index.js`'s
`runAction`:

```javascript
case 'attack': {
  if (!canAttack(this.state, side, action.attackName)) { throw new Error('No puedes usar ese ataque ahora.'); }
  const attackerName = this.state.players[side].active.name;
  if (ATTACK_EFFECTS[attackerName] && ATTACK_EFFECTS[attackerName][action.attackName]) { throw new Error('Ese ataque todavía no está disponible en PVP (Fase 2).'); }
  attack(this.state, side, action.attackName);
  break;
}
```

This spec removes the `ATTACK_EFFECTS` guard entirely, forwards
`action.targetInstanceId` (needed by Lure and by Metronome, which
overloads the same parameter as its "attack name to copy" argument — see
`card-effects.js`'s own `ATTACK_EFFECTS['Metronome']`), and captures
whatever `attack()` leaves in `this.state.lastAttackResult` into a
per-room round-counted field, the same shape `lastTrainerPlay`/
`trainerRound` already use:

```javascript
case 'attack': {
  if (!canAttack(this.state, side, action.attackName)) { throw new Error('No puedes usar ese ataque ahora.'); }
  attack(this.state, side, action.attackName, action.targetInstanceId);
  this.attackRound = (this.attackRound || 0) + 1;
  this.lastAttackResult = this.state.lastAttackResult
    ? Object.assign({}, this.state.lastAttackResult, { round: this.attackRound })
    : null;
  this.state.lastAttackResult = null; // never leak a stale result into a later attack's own check
  break;
}
```

(`this.state.lastAttackResult` is already the exact shape
`showAttackOverlay` expects —
`{attackerName, defenderName, damage, newStatuses, severePoison, missed,
selfDamage}` — set by `attack()` itself, rules-engine.js, only when
something reveal-worthy happened. `redactMatchState` never included it in
its own `publicView`, since it has no identity/PVP concept at all —
`redactedFor` below is where it's added, same as `lastTrainerPlay`.)

Ninetales' Lure silently no-ops on a missing/invalid `targetInstanceId`
(`card-effects.js`'s own documented fallback: "no such Benched Pokémon —
real card just does nothing then") — no crash risk either way, so no
extra server-side validation is needed beyond what `attack()` already
does internally. Metronome (`card-effects.js`) already auto-picks the
defender's highest-damage attack whenever no `targetInstanceId`/chosen-
attack-name is given — an existing, documented simplification shared with
local play — so it degrades safely too, though the client (Section 5)
still forwards the real player choice when one was made.

`redactedFor` gains one line, mirroring `lastTrainerPlay`:

```javascript
redacted.public.lastAttackResult = this.lastAttackResult || null;
```

## 5. Client wiring

**Attacks with no target** (the vast majority): already correctly routed
through `submitMatchActionCloud(pvpActiveMatchId, {type:'attack',
attackName: atkName})` in `ui.js`'s attack-button handler — no changes.

**Lure (Ninetales) and Metronome (Clefairy)** are today special-cased with
their own explicit `pvpMode` block that just shows "todavía no está
disponible" and returns, because their local-play flow arms a pending
target-selection mode (`pendingAttackNeedingTarget`/`openChoicePickerModal`)
instead of ever reaching the generic attack-button handler above. Both
blocks are removed; instead, the point where local play currently calls
`executePlayerAttack('Lure', instanceId)` (the Bench-click handler) and
`executePlayerAttack('Metronome', chosenAtkName)` (the choice-picker's
callback) each gain a `pvpMode` branch that calls
`submitMatchActionCloud(pvpActiveMatchId, {type:'attack', attackName:
'Lure' | 'Metronome', targetInstanceId: instanceId | chosenAtkName})`
instead — same pattern `applyOrSubmitTrainerEffect` already established
for Trainer cards, applied inline at these two call sites since there are
only two and their surrounding arming logic (the modal/click flow) stays
local-only either way.

## 6. The reveal

`ui.js` gets a sibling to the existing `pvpTrainerRevealedRound` gate
(`pvpAttackRevealedRound`, reset alongside it in both `enterPvpMatch` and
`resetPvpMatchState`): when `pub.lastAttackResult.round` advances past
what's already been shown, it calls `showAttackOverlay` (unmodified — same
~2s hold+fade already used for local play) with `pub.lastAttackResult`
directly (its fields already match what `showAttackOverlay` expects,
verbatim — no reshaping needed, unlike the Trainer-card reveal's `play`
object), for **both** players regardless of which side attacked, then
applies the deferred board update once the reveal finishes — the same
defer-then-apply shape the RPS/Trainer reveal gates already use.

One real difference from those two gates: an attack, unlike a Trainer play
or an RPS round, can knock out a Pokémon and open the prize-choice/end-
turn-confirm flow — logic that currently only runs on the *direct*
(non-deferred) path in `enterPvpMatch`'s listener, right after its own
`processPvpMatchSnapshot(data)` call. Neither the RPS nor Trainer gates
needed this (neither can ever KO anything), but the attack gate does. That
trailing logic (updating `pvpMyPrizeChoiceSeen`, calling
`processPvpMatchSnapshot`, and the `pvpAttackEndedMyTurn`-gated
`renderEndTurnConfirm()` check) is extracted into one shared function,
called both from the existing direct path and from the attack-reveal
gate's own `onDone` callback (using `pvpRpsLatestMatchData`, the same
always-current cache the other two gates already rely on) — so a KO'ing
attack still correctly opens the prize/end-turn flow whether or not a
reveal animation happened to be in the way.

## 7. Testing

Same WebSocket-driven pattern `party/test/trainer.test.js` already
establishes, in a new `party/test/attack.test.js`. New scenarios: a
special-effect attack with a coin-flip-gated status (e.g. Weedle's Poison
Sting) — both sides receive the same `lastAttackResult` reveal data, the
round counter advances, and a heads flip actually leaves the defender
Poisoned in the server's real state; Ninetales' Lure with a real
`targetInstanceId` — the named Bench Pokémon is actually swapped in, and a
missing/invalid target is confirmed to safely no-op rather than crash;
Metronome copying a real chosen rival attack; an attack that knocks out
the defender — confirms `pendingPrizeChoice` opens correctly server-side
(this is what the client's extracted-helper fix, Section 6, exists to
consume correctly, but the *server*-side pendingPrizeChoice behavior itself
needs its own test coverage here since attack.test.js can't drive a
browser).

`node run-tests.js` (739 tests) stays green — this spec adds one new
`redactedFor` field and forwards one new action parameter, but changes no
existing function's legality/effect logic.

## 8. Open questions / explicitly deferred

- Pokémon Powers, real forfeit, and chess-clock sync are separate planned
  follow-up projects (see the brainstorming conversation this spec came
  from) — not in scope here.
- Whether a *missed* Lure/Metronome target selection (player backs out of
  the modal without picking) needs any special PVP handling — no, since
  neither local-play flow ever reaches `submitMatchActionCloud`/
  `executePlayerAttack` at all until a choice is actually made; backing out
  just closes the modal, same in PVP as local play, already true today
  with no code changes needed.
