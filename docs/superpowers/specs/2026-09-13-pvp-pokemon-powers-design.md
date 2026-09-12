# Pokémon Powers (Habilidades) in PVP — Design

Date: 2026-09-13
Status: Approved by user, pending implementation plan
Depends on: `2026-09-09-partykit-pvp-migration-design.md` (the PartyKit
transport this builds on — `party/index.js`'s `runAction`, the
`{type:'action', reqId, action}` / `{type:'match', public, myHand}`
protocol, and `redactedFor`'s redaction pattern), `2026-09-09-pvp-trainer-
cards-design.md` (the `playTrainer` action and reveal-gate pattern this
directly mirrors), and `2026-09-10-pvp-special-attacks-design.md` (the
attack reveal-gate, same shape again here).
Supersedes: `ui.js`'s `habilidadBtn` click handler's current guard —
`if (pvpMode) { alert('Los Poderes Pokémon todavía no están disponibles
en PVP (próximamente).'); return; }` — which makes every activatable
Pokémon Power completely unreachable in PVP today.

## 1. Purpose

Local-vs-CPU play already has full Pokémon Power support: `rules-engine.js`'s
`usePokemonPower()` is a single validated entry point that dispatches to
`card-effects.js`'s `POKEMON_POWER_EFFECTS` table (Alakazam's Damage Swap,
Blastoise's Rain Dance, Charizard's Energy Burn, Venusaur's Energy Trans,
Electrode's Buzzap — 5 activatable powers), each already fully implemented
and working. PVP has zero server-side representation for using a Power at
all — the one guard above makes the entire feature dead code in PVP,
regardless of how well-tested it already is locally.

Separately, Machamp's Strikes Back (a passive power — "whenever your
opponent's attack damages Machamp, this power does 10 damage to the
attacking Pokémon") is NOT player-activated at all: it's handled entirely
inside `attack()` itself, unconditionally, for both local and PVP matches.
It very likely already works correctly in PVP today with zero code
changes — this spec includes verifying that with a real test, not
building anything new for it.

This spec makes the 5 activatable Powers work in PVP, server-authoritative
like every other action, with the same full-screen reveal treatment
attacks and Trainer cards already have.

## 2. Goals

- All 5 activatable Pokémon Powers work in PVP with the exact same
  legality rules and effects local-vs-CPU play already has
  (`usePokemonPower()`/`POKEMON_POWER_EFFECTS` reused verbatim, not
  reimplemented).
- Both players see a full-screen reveal whenever either side uses a Power,
  reusing the existing Trainer-play overlay (`showTrainerPlayedOverlay`) —
  no new overlay UI needed.
- The HABILIDAD button and its whole multi-step targeting flow
  (`startPowerFlow`, `pendingPowerActivation`, `showTargetHintModal`,
  `openHandDiscardModal`, `openChoicePickerModal`) work identically in PVP
  and local play — the only thing that changes between modes is where the
  final effect gets *applied* (server via `submitMatchActionCloud`, vs.
  local `gameState` directly), exactly the same split every other PVP
  action already makes.
- Machamp's Strikes Back is verified working in PVP via a real test (no
  code change expected).

## 3. Non-Goals

- No change to `POKEMON_POWER_EFFECTS`' legality/effect logic itself —
  every function in `card-effects.js` is reused exactly as it already
  exists for local play.
- No new targeting UI — every modal/click flow a Power's activation needs
  already exists in `ui.js` for local play; this spec only changes where
  the final `{ownerInstanceId, params}` gets submitted.
- Real forfeit/surrender is a separate, already-identified follow-up
  project — untouched here.

## 4. Architecture: one new action type, `usePower`

Unlike attacks (which already had a working `'attack'` case to extend),
Powers need a brand-new case, the same way Trainer cards did:

```javascript
case 'usePower': {
  // Captured BEFORE the effect runs, not after: Buzzap knocks its OWN
  // owner out of play (findInstance would return undefined afterward) --
  // ownerBefore/powerBefore are plain name strings by the time they're
  // actually used below, so the owner leaving play doesn't matter.
  const ownerBefore = findInstance(this.state.players[side], action.ownerInstanceId);
  const powerBefore = ownerBefore && CARD_STATS[ownerBefore.name] && CARD_STATS[ownerBefore.name].pokemonPower;
  const result = usePokemonPower(this.state, side, action.ownerInstanceId, action.params || {});
  if (!result.legal) { throw new Error(result.reason); }
  this.powerRound = (this.powerRound || 0) + 1;
  this.lastPowerUse = {
    side: side === 'player' ? 'player1' : 'player2',
    ownerName: ownerBefore.name,
    powerName: powerBefore.name,
    targetName: powerTargetName(this.state, side, action.params),
    round: this.powerRound
  };
  break;
}
```

`usePokemonPower(state, playerId, ownerInstanceId, params)`
(`rules-engine.js`) already validates everything a `runAction` case needs:
`activePlayerId === playerId` (own turn only — same self-check
`TRAINER_EFFECTS` functions already make, so `usePower` needs no entry in
`TURN_GATED_ACTIONS`, matching `playTrainer`'s own precedent), the owner
belongs to the caller, the named Power exists and has a registered effect,
and the owner isn't blocked by Asleep/Confused/Paralyzed. It is **not**
currently exported from `rules-engine.js` — add it to `module.exports`
alongside `redactMatchState`/`submitRpsChoice`/etc.

`turnEndPendingSide`'s existing exemption array
(`['confirmEndTurn', 'takePrize', 'chooseActive', 'claimTimeout']`) is
**not** changed — `usePower` deliberately stays outside it, so a player
who has already attacked and owes a turn-end confirmation cannot then use
a Power before confirming. This matches the real card text ("as often as
you like during your turn, **before your attack**") for free, as a side
effect of the existing guard, with no new code.

`powerTargetName(state, side, params)` is a small helper resolving
whichever of `params.toInstanceId` / `params.targetInstanceId` is present
(Damage Swap/Energy Trans use `toInstanceId`; Rain Dance/Buzzap use
`targetInstanceId`; Energy Burn has neither) to a real Pokémon name via
`findInstance(state.players[side], ...)`, for the reveal overlay's text —
`null` when there's no target (Energy Burn). Safe to resolve AFTER the
effect already ran, unlike `ownerBefore` above: none of the 5 effects ever
remove the TARGET Pokémon from play (only Buzzap removes its own owner).
This helper lives in `party/index.js` itself, not `card-effects.js` --
`POKEMON_POWER_EFFECTS` functions keep returning just `{legal, reason}`,
no contract change.

### `redactedFor`

Add `redacted.public.lastPowerUse = this.lastPowerUse || null;` right
alongside the existing `lastAttackResult`/`lastTrainerPlay` lines — same
"broadcast unconditionally on every snapshot, client tracks a revealed-
round watermark" shape both of those already use.

### A rematch resets `this.lastPowerUse`/`this.powerRound` too

`startMatch()` already resets `turnEndPendingSide`/`turnStartedAt`/
`attackRound`/`trainerRound`/`lastAttackResult`/`lastTrainerPlay` at the
top of every match (including a same-room rematch) — a real bug fixed
earlier this same PVP effort, where these per-instance fields survived
into a fresh match and caused a stale reveal replay. `lastPowerUse`/
`powerRound` join that same reset list from day one, so this class of bug
never gets a chance to reappear for Powers.

## 5. Client (`ui.js`)

### Unlock the button

`habilidadBtn`'s click handler drops its `if (pvpMode) { alert(...); }`
guard entirely — `usablePokemonPowers(gameState, 'player')` already reads
local `gameState` (which in PVP is already rebuilt from the server's own
redacted snapshot via `buildPvpGameState`), so the button's
enabled/disabled state and the "which Pokémon can use a Power right now"
picker both already work correctly in PVP with zero changes.

### The 4 activation call sites branch on `pvpMode`

Every place that currently calls `usePokemonPower(gameState, 'player',
ownerId, params)` directly and then `afterPlayerAction()` gets the same
"submit to server instead" branch every other PVP action already has:

- Energy Burn (`startPowerFlow`, immediate, no target) —
  `submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: instance.id, params: {} })`.
- Damage Swap / Energy Trans (2nd board-card click, `pendingPowerActivation`
  resolution) — `params: { fromInstanceId: pa.fromInstanceId, toInstanceId: instanceId }`.
- Rain Dance (board-card click after the hand-energy pick) —
  `params: { handEnergyId: pa.handEnergyId, targetInstanceId: instanceId }`.
- Buzzap (board-card click after the type pick) —
  `params: { chosenType: pa.chosenType, targetInstanceId: instanceId }`.

Each PVP branch's `.catch()` shows the server's rejection reason via
`alert()`, same as every other PVP action call site.

### Reveal-gate: reuse `showTrainerPlayedOverlay`, no new overlay

A new `pvpPowerRevealedRound` counter (reset to 0 in `enterPvpMatch`,
alongside `pvpTrainerRevealedRound`/`pvpAttackRevealedRound`) gates on
`pub.lastPowerUse.round`, the same "> revealed watermark" check the
Trainer and attack gates already use. On a new round, call the existing
`showTrainerPlayedOverlay` with `{kind: 'power', name: <Spanish power
name via translatePowerName>, playerId: <'player'|'cpu'>, targetName:
<translated target Pokémon name, or null>}` — reusing the exact same
overlay component Trainer plays already use, just with the Power's
translated name where a Trainer card's name would go. No new visual
component to build.

## 6. Testing

New `party/test/power.test.js` (same shape as `attack.test.js`/
`trainer.test.js`): one deterministic custom-deck scenario per activatable
Power (Damage Swap/Alakazam, Rain Dance/Blastoise, Energy Burn/Charizard,
Energy Trans/Venusaur, Buzzap/Electrode), each verifying over the real
WebSocket action API that:

- the effect actually applies to `this.state` (damage moved, energy moved,
  `energyBurnActive` set, Electrode actually knocked out with 2 energy
  landing on the target).
- both sides receive the same `lastPowerUse` reveal data.
- an illegal attempt (wrong owner, invalid target, blocked by a Special
  Condition) is rejected with a clean error, not a crash.

A 6th scenario (same file or a small addition to `attack.test.js`) attacks
a real Machamp and confirms the existing Strikes Back counter-damage
already fires correctly in PVP, unchanged.

`node run-tests.js` (739 tests) is expected to stay exactly 739/739 —
this only adds an export and a new redacted field to `rules-engine.js`,
touching no existing game-rule logic.
