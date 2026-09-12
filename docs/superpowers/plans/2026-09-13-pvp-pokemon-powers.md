# Pokémon Powers (Habilidades) in PVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 5 activatable Pokémon Powers (Damage Swap, Rain Dance,
Energy Burn, Energy Trans, Buzzap) work in PVP, server-authoritative like
every other PVP action, with the same full-screen reveal treatment
attacks and Trainer cards already have — and verify Machamp's passive
Strikes Back (already handled inside `attack()` unconditionally) already
works correctly in PVP with zero code changes.

**Architecture:** One new `party/index.js` `runAction` case, `'usePower'`,
calling `rules-engine.js`'s existing `usePokemonPower()` (the same
validated single entry point local play already uses — not
reimplemented). A new `lastPowerUse` field on `redactedFor`, broadcast
unconditionally on every snapshot exactly like `lastAttackResult`/
`lastTrainerPlay`. Client-side: remove `ui.js`'s single `pvpMode` guard on
the HABILIDAD button, branch the 4 `usePokemonPower()` call sites to
`submitMatchActionCloud` in PVP, and add a `pvpPowerRevealedRound`
reveal-gate reusing the existing `showTrainerPlayedOverlay` component (a
small `'power'` case added to `cpuActionLabel` gives it the right text).

**Tech Stack:** Vanilla JS (browser client + Node/PartyKit server), same
stack as every other file this plan touches.

**Spec:** `docs/superpowers/specs/2026-09-13-pvp-pokemon-powers-design.md`

## Global Constraints

- New action shape: `{ type: 'usePower', ownerInstanceId, params }` —
  `params` is passed straight through to `usePokemonPower()` unchanged
  (`{}` for Energy Burn, `{fromInstanceId, toInstanceId}` for Damage
  Swap/Energy Trans, `{handEnergyId, targetInstanceId}` for Rain Dance,
  `{chosenType, targetInstanceId}` for Buzzap).
- `'usePower'` is **not** added to `TURN_GATED_ACTIONS` and **not** added
  to `turnEndPendingSide`'s exemption array
  (`['confirmEndTurn', 'takePrize', 'chooseActive', 'claimTimeout']`) —
  `usePokemonPower()` already self-enforces `activePlayerId === playerId`
  (same precedent as `playTrainer`/`TRAINER_EFFECTS`), and leaving it out
  of the exemption array correctly blocks using a Power after an
  unconfirmed attack, matching the real card text ("before your attack").
- `this.lastPowerUse` shape: `{ side: 'player1'|'player2', ownerName,
  powerName, targetName: string|null, round }` — `round` from a new
  `this.powerRound` counter, same pattern as `this.attackRound`/
  `this.trainerRound`.
- `redactedFor` broadcasts it as `redacted.public.lastPowerUse =
  this.lastPowerUse || null;`.
- `startMatch()` resets `this.powerRound = 0; this.lastPowerUse = null;`
  alongside the 6 existing per-instance resets it already has
  (`turnEndPendingSide`, `turnStartedAt`, `attackRound`, `trainerRound`,
  `lastAttackResult`, `lastTrainerPlay`) — same rematch-safety reasoning,
  added to the same list.
- `node run-tests.js` (739 tests) must stay exactly 739/739 — this plan
  only adds an export and a new redacted field to `rules-engine.js`,
  touching no existing game-rule logic.

---

### Task 1: Server — `usePower` action, `lastPowerUse`, rematch reset

**Files:**
- Modify: `rules-engine.js:1428-1475` (the `module.exports` object)
- Modify: `party/index.js:19-47` (the destructured `require('../rules-engine.js')` list)
- Modify: `party/index.js:417-453` (`startMatch()`)
- Modify: `party/index.js:460-489` (`redactedFor(side)`)
- Modify: `party/index.js:508-703` (`runAction`'s `switch (action.type)` — add a new case)
- Test: `party/test/power.test.js` (created in Task 3, not this one — this
  task's own verification is a throwaway Node script, see Step 6 below)

**Interfaces:**
- Consumes: `usePokemonPower(state, playerId, ownerInstanceId, params)`
  (`rules-engine.js`, already exists, unchanged) — returns `{legal: true}`
  or `{legal: false, reason}`.
- Produces: the `'usePower'` action type other tasks (Task 2's client,
  Task 3's tests) submit as `{ type: 'usePower', ownerInstanceId, params }`;
  `this.lastPowerUse` / `redacted.public.lastPowerUse`, shape `{side,
  ownerName, powerName, targetName, round}`, that Task 2's client reveal-
  gate reads.

- [ ] **Step 1: Export `usePokemonPower` from `rules-engine.js`**

Current tail of `rules-engine.js`'s `module.exports` (lines 1473-1475):

```javascript
    dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName
  };
}
```

Change to:

```javascript
    dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName,
    // party/index.js's new 'usePower' runAction case calls this directly
    // (not as a bare globalThis identifier) -- the same validated single
    // entry point local play already uses for all 5 activatable Pokémon
    // Powers (usablePokemonPowers, the button's own enabled/disabled
    // check, was already exported above).
    usePokemonPower
  };
}
```

- [ ] **Step 2: Destructure `usePokemonPower` in `party/index.js`**

Current end of the destructured require (lines 46-47):

```javascript
  dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName,
  // Real reported bug found while testing the Energy Retrieval fix: its own
  // effect (card-effects.js) references this as a bare identifier too, the
  // same class of gap as the block above -- never exercised against the
  // local dev server before, so it sat undiscovered. Left unbound,
  // retrieving any energy threw "ENERGY_TYPE_BY_CARD_NAME is not defined".
  ENERGY_TYPE_BY_CARD_NAME
} = require('../rules-engine.js');
```

Change to:

```javascript
  dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName,
  // Real reported bug found while testing the Energy Retrieval fix: its own
  // effect (card-effects.js) references this as a bare identifier too, the
  // same class of gap as the block above -- never exercised against the
  // local dev server before, so it sat undiscovered. Left unbound,
  // retrieving any energy threw "ENERGY_TYPE_BY_CARD_NAME is not defined".
  ENERGY_TYPE_BY_CARD_NAME,
  // party/index.js's new 'usePower' runAction case calls this directly --
  // the same validated single entry point (own-turn check, owner-belongs-
  // to-caller check, Power-exists check, Asleep/Confused/Paralyzed check)
  // local play's own HABILIDAD button already relies on.
  usePokemonPower
} = require('../rules-engine.js');
```

(No `globalThis.usePokemonPower = ...` line needed — unlike
`ENERGY_TYPE_BY_CARD_NAME`/`dealDamage`/etc., which `card-effects.js`
calls as *bare* identifiers, `party/index.js` calls `usePokemonPower`
directly as a real destructured import, the same way it already calls
`attack`/`endTurn`/`applyEndOfTurnCheckup`.)

- [ ] **Step 3: Add the `'usePower'` case to `runAction`**

Current `'playTrainer'` case, immediately before the `default:` (lines
693-701) — add the new case right after it:

```javascript
      case 'playTrainer': {
        const fn = TRAINER_EFFECTS[action.trainerName];
        if (!fn) { throw new Error('Carta de Entrenador desconocida.'); }
        const result = fn.apply(null, [this.state, side, action.handId].concat(action.args || []));
        if (!result.legal) { throw new Error(result.reason); }
        this.trainerRound = (this.trainerRound || 0) + 1;
        this.lastTrainerPlay = { side: side === 'player' ? 'player1' : 'player2', cardName: action.trainerName, targetName: result.targetName || null, round: this.trainerRound };
        break;
      }
      case 'usePower': {
        // Captured BEFORE the effect runs, not after: Buzzap knocks its
        // OWN owner out of play (findInstance would return undefined
        // afterward, since knockOutIfNeeded clears the slot) --
        // ownerBefore/powerBefore are plain values by the time they're
        // actually used below, so the owner leaving play doesn't matter.
        const ownerBefore = findInstance(this.state.players[side], action.ownerInstanceId);
        const powerBefore = ownerBefore && CARD_STATS[ownerBefore.name] && CARD_STATS[ownerBefore.name].pokemonPower;
        const result = usePokemonPower(this.state, side, action.ownerInstanceId, action.params || {});
        if (!result.legal) { throw new Error(result.reason); }
        this.powerRound = (this.powerRound || 0) + 1;
        // params.toInstanceId (Damage Swap/Energy Trans) or
        // params.targetInstanceId (Rain Dance/Buzzap) -- Energy Burn has
        // neither, so targetName stays null. Safe to resolve AFTER the
        // effect ran (unlike ownerBefore above): none of the 5 effects
        // ever remove the TARGET Pokémon from play, only Buzzap removes
        // its own OWNER.
        const targetId = (action.params && (action.params.toInstanceId || action.params.targetInstanceId)) || null;
        const targetInstance = targetId ? findInstance(this.state.players[side], targetId) : null;
        this.lastPowerUse = {
          side: side === 'player' ? 'player1' : 'player2',
          ownerName: ownerBefore.name,
          powerName: powerBefore.name,
          targetName: targetInstance ? targetInstance.name : null,
          round: this.powerRound
        };
        break;
      }
      default:
        throw new Error('Tipo de acción desconocido: ' + action.type);
```

- [ ] **Step 4: Broadcast `lastPowerUse` in `redactedFor`**

Current lines 484-486:

```javascript
    redacted.public.lastAttackResult = this.lastAttackResult || null;
    redacted.public.turnStartedAt = this.turnStartedAt || null;
```

Change to:

```javascript
    redacted.public.lastAttackResult = this.lastAttackResult || null;
    redacted.public.lastPowerUse = this.lastPowerUse || null;
    redacted.public.turnStartedAt = this.turnStartedAt || null;
```

- [ ] **Step 5: Reset `powerRound`/`lastPowerUse` in `startMatch()`**

Current lines 446-452:

```javascript
    this.turnEndPendingSide = null;
    this.turnStartedAt = null;
    this.attackRound = 0;
    this.trainerRound = 0;
    this.lastAttackResult = null;
    this.lastTrainerPlay = null;
    this.persistState();
```

Change to:

```javascript
    this.turnEndPendingSide = null;
    this.turnStartedAt = null;
    this.attackRound = 0;
    this.trainerRound = 0;
    this.lastAttackResult = null;
    this.lastTrainerPlay = null;
    this.powerRound = 0;
    this.lastPowerUse = null;
    this.persistState();
```

- [ ] **Step 6: Verify with a throwaway direct-require script (no server needed yet)**

`node --check rules-engine.js` and `node --check party/index.js` first,
then confirm `usePokemonPower` round-trips correctly through the export
without touching a real server (Task 3 covers the real WebSocket path):

```bash
node -e "
const re = require('./rules-engine.js');
if (typeof re.usePokemonPower !== 'function') { throw new Error('usePokemonPower not exported'); }
global.CARD_STATS = require('./data-cards.js').CARD_STATS;
global.ATTACK_EFFECTS = {};
global.TRAINER_EFFECTS = {};
global.POKEMON_POWER_EFFECTS = require('./card-effects.js').POKEMON_POWER_EFFECTS;
['findInstance','opponentOf','translatePlayer','translateCardName','logEvent','drawCard','basicFormName','isBasicPokemon','benchCount','evolutionTimingAllowed','makeFreshInstance','shuffle','discardedEnergyCard','discardedEvolutionCard','allInstances','dealDamage','coinFlip','addStatus','knockOutIfNeeded','translateAttackName'].forEach((k) => { global[k] = re[k]; });
const state = {
  turnCounter: 5, activePlayerId: 'player', phase: 'playing', log: [],
  players: {
    player: { active: re.makeFreshInstance('a1', 'Charizard', 5), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    cpu: { active: re.makeFreshInstance('a2', 'Squirtle', 1), bench: [], hand: [], deck: [], discard: [], prizes: [] }
  }
};
const result = re.usePokemonPower(state, 'player', 'a1', {});
if (!result.legal) { throw new Error('expected Energy Burn to be legal: ' + result.reason); }
if (!state.players.player.active.energyBurnActive) { throw new Error('expected energyBurnActive to be set'); }
console.log('PASS: usePokemonPower is exported and dispatches correctly');
"
```

Expected output: `PASS: usePokemonPower is exported and dispatches correctly`

- [ ] **Step 7: Run the full suite**

```bash
node run-tests.js
```

Expected: exit code 0, 739 `PASS` lines, 0 `FAIL` lines (unchanged from
before this task — no existing game-rule logic was touched).

- [ ] **Step 8: Commit**

```bash
git add rules-engine.js party/index.js
git commit -m "Add server-authoritative usePower action for PVP Pokémon Powers"
```

---

### Task 2: Client — unlock the button, branch the 4 call sites, reveal-gate

**Files:**
- Modify: `ui.js:2710-2778` (`startPowerFlow` + `habilidadBtn` click handler)
- Modify: `ui.js:2838-2877` (the `pendingPowerActivation` resolution block, inside the board-card click handler)
- Modify: `ui.js:852-867` (`cpuActionLabel`)
- Modify: `ui.js:4977-4988` (the reveal-round counter declarations)
- Modify: `ui.js:5063-5074` (`resetPvpMatchState`)
- Modify: `ui.js:5179-5189` (`enterPvpMatch`'s own reset block)
- Modify: `ui.js:5246-5258` (the reveal-gate chain inside `enterPvpMatch`'s match listener)

**Interfaces:**
- Consumes: `{ type: 'usePower', ownerInstanceId, params }` action shape
  and `pub.lastPowerUse` (Task 1). `submitMatchActionCloud(matchId, action)`
  (`economy.js`, already exists, unchanged). `showTrainerPlayedOverlay(play,
  onDone)` (`ui.js:881-901`, already exists) and `translatePowerName(name)`
  (`rules-engine.js`, already exists from the earlier card-viewer Power fix
  this session).
- Produces: nothing new consumed by later tasks — this is the last client
  task.

- [ ] **Step 1: Remove the `pvpMode` guard on `habilidadBtn`**

Current (lines 2752-2778):

```javascript
  var habilidadBtn = document.getElementById('habilidadBtn');
  if (habilidadBtn) {
    habilidadBtn.addEventListener('click', function () {
      // I8 (final-review fix): Pokémon Powers are Fase 2 scope -- every
      // usePokemonPower() call site (Damage Swap/Energy Trans/Rain Dance/
      // Buzzap resolution, all reached only via startPowerFlow below) is
      // unreachable in PVP once this single entry point is guarded.
      if (pvpMode) {
        alert('Los Poderes Pokémon todavía no están disponibles en PVP (próximamente).');
        return;
      }
      clearPendingFlows();
      var usable = usablePokemonPowers(gameState, 'player');
      if (usable.length === 0) { return; }
      if (usable.length === 1) {
        startPowerFlow(usable[0]);
      } else {
        var options = usable.map(function (instance) {
          return { id: instance.id, label: instance.name + ' (' + CARD_STATS[instance.name].pokemonPower.name + ')', imgUrl: CARD_IMAGE_BY_NAME[instance.name] };
        });
        openChoicePickerModal('Elige qué Poder Pokémon usar', options, function (chosenId) {
          var chosen = usable.find(function (instance) { return instance.id === chosenId; });
          if (chosen) { startPowerFlow(chosen); }
        });
      }
    });
  }
```

Change to:

```javascript
  var habilidadBtn = document.getElementById('habilidadBtn');
  if (habilidadBtn) {
    habilidadBtn.addEventListener('click', function () {
      // Real reported request: Pokémon Powers now work in PVP too --
      // usablePokemonPowers(gameState, 'player') already reads correctly
      // in either mode (gameState is rebuilt from the server's own
      // redacted snapshot in PVP, via buildPvpGameState), so the only
      // thing that ever needed to change is this guard.
      clearPendingFlows();
      var usable = usablePokemonPowers(gameState, 'player');
      if (usable.length === 0) { return; }
      if (usable.length === 1) {
        startPowerFlow(usable[0]);
      } else {
        var options = usable.map(function (instance) {
          return { id: instance.id, label: instance.name + ' (' + CARD_STATS[instance.name].pokemonPower.name + ')', imgUrl: CARD_IMAGE_BY_NAME[instance.name] };
        });
        openChoicePickerModal('Elige qué Poder Pokémon usar', options, function (chosenId) {
          var chosen = usable.find(function (instance) { return instance.id === chosenId; });
          if (chosen) { startPowerFlow(chosen); }
        });
      }
    });
  }
```

- [ ] **Step 2: Branch Energy Burn's immediate resolution (inside `startPowerFlow`)**

Current (lines 2710-2717):

```javascript
  function startPowerFlow(instance) {
    var powerName = CARD_STATS[instance.name].pokemonPower.name;
    if (powerName === 'Energy Burn') {
      var result = usePokemonPower(gameState, 'player', instance.id, {});
      if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
      renderBoard();
      return;
    }
```

Change to:

```javascript
  function startPowerFlow(instance) {
    var powerName = CARD_STATS[instance.name].pokemonPower.name;
    if (powerName === 'Energy Burn') {
      if (pvpMode) {
        submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: instance.id, params: {} })
          .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
        return;
      }
      var result = usePokemonPower(gameState, 'player', instance.id, {});
      if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
      renderBoard();
      return;
    }
```

- [ ] **Step 3: Branch the 3 `pendingPowerActivation` resolutions**

Current (lines 2849-2875, inside the board-card click handler's
`if (pendingPowerActivation) { ... }` block):

```javascript
        if (pa.powerName === 'Damage Swap' || pa.powerName === 'Energy Trans') {
          if (pa.step === 'from') {
            pa.fromInstanceId = instanceId;
            pa.step = 'to';
            showTargetHintModal(pa.powerName === 'Damage Swap' ? 'Elige el Pokémon que recibirá el daño' : 'Elige el Pokémon que recibirá la Energía');
            return;
          }
          pendingPowerActivation = null;
          var swapResult = usePokemonPower(gameState, 'player', pa.ownerId, { fromInstanceId: pa.fromInstanceId, toInstanceId: instanceId });
          if (swapResult && !swapResult.legal) { logEvent(gameState, swapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Rain Dance') {
          pendingPowerActivation = null;
          var rainResult = usePokemonPower(gameState, 'player', pa.ownerId, { handEnergyId: pa.handEnergyId, targetInstanceId: instanceId });
          if (rainResult && !rainResult.legal) { logEvent(gameState, rainResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Buzzap') {
          pendingPowerActivation = null;
          var buzzapResult = usePokemonPower(gameState, 'player', pa.ownerId, { chosenType: pa.chosenType, targetInstanceId: instanceId });
          if (buzzapResult && !buzzapResult.legal) { logEvent(gameState, buzzapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        return;
      }
```

Change to:

```javascript
        if (pa.powerName === 'Damage Swap' || pa.powerName === 'Energy Trans') {
          if (pa.step === 'from') {
            pa.fromInstanceId = instanceId;
            pa.step = 'to';
            showTargetHintModal(pa.powerName === 'Damage Swap' ? 'Elige el Pokémon que recibirá el daño' : 'Elige el Pokémon que recibirá la Energía');
            return;
          }
          pendingPowerActivation = null;
          var swapParams = { fromInstanceId: pa.fromInstanceId, toInstanceId: instanceId };
          if (pvpMode) {
            submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: pa.ownerId, params: swapParams })
              .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
            return;
          }
          var swapResult = usePokemonPower(gameState, 'player', pa.ownerId, swapParams);
          if (swapResult && !swapResult.legal) { logEvent(gameState, swapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Rain Dance') {
          pendingPowerActivation = null;
          var rainParams = { handEnergyId: pa.handEnergyId, targetInstanceId: instanceId };
          if (pvpMode) {
            submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: pa.ownerId, params: rainParams })
              .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
            return;
          }
          var rainResult = usePokemonPower(gameState, 'player', pa.ownerId, rainParams);
          if (rainResult && !rainResult.legal) { logEvent(gameState, rainResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Buzzap') {
          pendingPowerActivation = null;
          var buzzapParams = { chosenType: pa.chosenType, targetInstanceId: instanceId };
          if (pvpMode) {
            submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: pa.ownerId, params: buzzapParams })
              .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
            return;
          }
          var buzzapResult = usePokemonPower(gameState, 'player', pa.ownerId, buzzapParams);
          if (buzzapResult && !buzzapResult.legal) { logEvent(gameState, buzzapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        return;
      }
```

- [ ] **Step 4: Add a `'power'` case to `cpuActionLabel`**

`showTrainerPlayedOverlay` looks up `CARD_IMAGE_BY_NAME[play.name]` for
the card art and calls `cpuActionLabel(play)` for the caption — `play.name`
must be a real card name for the image to resolve. For a Power reveal,
`play.name` will be the OWNER Pokémon's name (e.g. `'Alakazam'`), not the
Power's own name (`'Damage Swap'` has no card art) — `cpuActionLabel`'s
existing `default` case ("Juegas X → sale Y") reads wrong for a Power
("Juegas Alakazam" implies playing the card, not using its Power), so
this needs its own case, not the default fallback.

Current (lines 852-867):

```javascript
function cpuActionLabel(play) {
  var mine = play.playerId === 'player';
  switch (play.kind) {
    case 'evolve':
      return (mine ? 'Evolucionas a ' : 'El rival evoluciona a ') + translateCardName(play.fromName) + ' → ' + translateCardName(play.name);
    case 'energy':
      return (mine ? 'Pones ' : 'El rival pone ') + translateCardName(play.name) + ' en ' + translateCardName(play.targetName);
    case 'basic':
      return (mine ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name) + ' de básico';
    case 'retreat':
      return (mine ? 'Retiras a ' : 'El rival retira a ') + translateCardName(play.outName) + ' → sale ' + translateCardName(play.name);
    default:
      return (mine ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name) +
        (play.targetName ? (' → sale ' + translateCardName(play.targetName)) : '');
  }
}
```

Change to:

```javascript
function cpuActionLabel(play) {
  var mine = play.playerId === 'player';
  switch (play.kind) {
    case 'evolve':
      return (mine ? 'Evolucionas a ' : 'El rival evoluciona a ') + translateCardName(play.fromName) + ' → ' + translateCardName(play.name);
    case 'energy':
      return (mine ? 'Pones ' : 'El rival pone ') + translateCardName(play.name) + ' en ' + translateCardName(play.targetName);
    case 'basic':
      return (mine ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name) + ' de básico';
    case 'retreat':
      return (mine ? 'Retiras a ' : 'El rival retira a ') + translateCardName(play.outName) + ' → sale ' + translateCardName(play.name);
    case 'power':
      return (mine ? 'Usas el Poder ' : 'El rival usa el Poder ') + translatePowerName(play.powerName) + ' de ' + translateCardName(play.name) +
        (play.targetName ? (' en ' + translateCardName(play.targetName)) : '');
    default:
      return (mine ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name) +
        (play.targetName ? (' → sale ' + translateCardName(play.targetName)) : '');
  }
}
```

- [ ] **Step 5: Add the `pvpPowerRevealedRound` counter**

Current (lines 4977-4988):

```javascript
// Sibling to the RPS-reveal gate above, same shape -- lastTrainerPlay.round
// (party/index.js) increments every successful playTrainer action; this
// tracks the last round already shown so a re-delivered snapshot (e.g. on
// reconnect) never replays a reveal that already happened.
var pvpTrainerRevealedRound = 0;

// Sibling to pvpTrainerRevealedRound above, same shape -- lastAttackResult.round
// (party/index.js) increments every successful attack action (special-
// effect or vanilla); this tracks the last round already shown so a
// re-delivered snapshot (e.g. on reconnect) never replays a reveal that
// already happened.
var pvpAttackRevealedRound = 0;
```

Change to:

```javascript
// Sibling to the RPS-reveal gate above, same shape -- lastTrainerPlay.round
// (party/index.js) increments every successful playTrainer action; this
// tracks the last round already shown so a re-delivered snapshot (e.g. on
// reconnect) never replays a reveal that already happened.
var pvpTrainerRevealedRound = 0;

// Sibling to pvpTrainerRevealedRound above, same shape -- lastPowerUse.round
// (party/index.js) increments every successful usePower action.
var pvpPowerRevealedRound = 0;

// Sibling to pvpTrainerRevealedRound above, same shape -- lastAttackResult.round
// (party/index.js) increments every successful attack action (special-
// effect or vanilla); this tracks the last round already shown so a
// re-delivered snapshot (e.g. on reconnect) never replays a reveal that
// already happened.
var pvpAttackRevealedRound = 0;
```

- [ ] **Step 6: Reset the new counter in both reset sites**

Current `resetPvpMatchState` (lines 5063-5074, only the relevant lines
shown):

```javascript
  pvpRpsRevealedRound = 0;
  pvpRpsLatestMatchData = null;
  pvpTrainerRevealedRound = 0;
  pvpAttackRevealedRound = 0;
```

Change to:

```javascript
  pvpRpsRevealedRound = 0;
  pvpRpsLatestMatchData = null;
  pvpTrainerRevealedRound = 0;
  pvpPowerRevealedRound = 0;
  pvpAttackRevealedRound = 0;
```

Current `enterPvpMatch` (lines 5179-5189, only the relevant lines shown):

```javascript
  pvpRpsRevealedRound = 0;
  if (pvpRpsRevealTimer) { clearTimeout(pvpRpsRevealTimer); pvpRpsRevealTimer = null; }
  pvpTrainerRevealedRound = 0;
  pvpAttackRevealedRound = 0;
```

Change to:

```javascript
  pvpRpsRevealedRound = 0;
  if (pvpRpsRevealTimer) { clearTimeout(pvpRpsRevealTimer); pvpRpsRevealTimer = null; }
  pvpTrainerRevealedRound = 0;
  pvpPowerRevealedRound = 0;
  pvpAttackRevealedRound = 0;
```

- [ ] **Step 7: Add the reveal-gate check**

Current (lines 5246-5258, inside `enterPvpMatch`'s match listener,
immediately after the Trainer-reveal-gate block and before the comment
introducing `applyPvpSnapshotEffects`):

```javascript
    if (pub.lastTrainerPlay && pub.lastTrainerPlay.round > pvpTrainerRevealedRound) {
      pvpTrainerRevealedRound = pub.lastTrainerPlay.round;
      var play = {
        kind: 'trainer',
        name: pub.lastTrainerPlay.cardName,
        playerId: pub.lastTrainerPlay.side === pvpMySide ? 'player' : 'cpu',
        targetName: pub.lastTrainerPlay.targetName
      };
      showTrainerPlayedOverlay(play, function () {
        processPvpMatchSnapshot(pvpRpsLatestMatchData);
      });
      return;
    }

    // Real reported bug (attack-reveal gate below): an attack, unlike a
```

Change to:

```javascript
    if (pub.lastTrainerPlay && pub.lastTrainerPlay.round > pvpTrainerRevealedRound) {
      pvpTrainerRevealedRound = pub.lastTrainerPlay.round;
      var play = {
        kind: 'trainer',
        name: pub.lastTrainerPlay.cardName,
        playerId: pub.lastTrainerPlay.side === pvpMySide ? 'player' : 'cpu',
        targetName: pub.lastTrainerPlay.targetName
      };
      showTrainerPlayedOverlay(play, function () {
        processPvpMatchSnapshot(pvpRpsLatestMatchData);
      });
      return;
    }

    if (pub.lastPowerUse && pub.lastPowerUse.round > pvpPowerRevealedRound) {
      pvpPowerRevealedRound = pub.lastPowerUse.round;
      var powerPlay = {
        kind: 'power',
        name: pub.lastPowerUse.ownerName,
        powerName: pub.lastPowerUse.powerName,
        playerId: pub.lastPowerUse.side === pvpMySide ? 'player' : 'cpu',
        targetName: pub.lastPowerUse.targetName
      };
      showTrainerPlayedOverlay(powerPlay, function () {
        processPvpMatchSnapshot(pvpRpsLatestMatchData);
      });
      return;
    }

    // Real reported bug (attack-reveal gate below): an attack, unlike a
```

- [ ] **Step 8: Verify with `node --check` and the full suite**

```bash
node --check ui.js
node run-tests.js
```

Expected: `node --check` prints nothing (success); `node run-tests.js`
still exits 0 with 739 `PASS` / 0 `FAIL` (this task touches only
`ui.js`, no `rules-engine.js` game-rule logic).

- [ ] **Step 9: Commit**

```bash
git add ui.js
git commit -m "Unlock Pokémon Powers in PVP and add their reveal overlay"
```

---

### Task 3: Tests — `party/test/power.test.js`

**Files:**
- Create: `party/test/power.test.js`

**Interfaces:**
- Consumes: the `'usePower'` action and `lastPowerUse` field (Task 1),
  exercised only through the real WebSocket action API (`{type:'action',
  reqId, action}` / `{type:'match', public, myHand}`), same as every
  other `party/test/*.test.js` file. No new interfaces produced.

This task's own scenarios need a Stage-2 (or Stage-1, for Electrode)
Pokémon on the board — none of the 6 Power-holding Pokémon are Basics, so
each scenario evolves one up from a customDeckCards-seeded Basic.
`evolutionTimingAllowed` (`rules-engine.js:347-350`) blocks evolving
before the owner's own turn 3 (a Basic placed during setup enters on
turn 1; `turnCounter <= 2` blocks both turn 1 and turn 2), and blocks the
second evolution before the owner's own turn 5 (same rule, now checked
against the Stage 1 form's own `turnEnteredCurrentForm`, set to the turn
it evolved) — a Stage-2 Power is usable starting the owner's OWN turn 5;
a Stage-1 Power (Electrode) starting turn 3. `evolve()` itself explicitly
leaves `damage`/`attachedEnergy` untouched (rules-engine.js:391), so
damage taken before an evolution correctly carries through it.

- [ ] **Step 1: Write the file's shared scaffolding**

```javascript
const assert = require('assert');
const http = require('http');

// None of the 6 Power-holding Pokémon are Basics -- every scenario below
// evolves one up from a customDeckCards-seeded Basic (see this file's own
// header comment for the exact turn-timing rule). power-guest-token is a
// bland, unremarkable deck reused by every scenario that doesn't need the
// guest to actually do anything but end their own turns; power-attacker-
// guest-token (Weedle/Grass Energy, same setup attack.test.js's own
// weedle-token already uses) is reused by the 2 scenarios that need the
// guest to deal REAL damage first (Damage Swap needs an already-damaged
// Pokémon to move damage FROM; the Strikes Back verification needs a real
// attack to trigger the counter-hit at all).
const IDENTITIES = {
  'power-guest-token': { uid: 'power-guest-uid', username: 'PowerGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'power-attacker-guest-token': { uid: 'power-attacker-guest-uid', username: 'PowerAttackerGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: [{ name: 'Weedle', count: 10 }, { name: 'Grass Energy', count: 20 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'damage-swap-host-token': { uid: 'damage-swap-host-uid', username: 'DamageSwapHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Abra', count: 6 }, { name: 'Kadabra', count: 6 }, { name: 'Alakazam', count: 6 }, { name: 'Bulbasaur', count: 4 }, { name: 'Psychic Energy', count: 8 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'rain-dance-host-token': { uid: 'rain-dance-host-uid', username: 'RainDanceHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Squirtle', count: 6 }, { name: 'Wartortle', count: 6 }, { name: 'Blastoise', count: 6 }, { name: 'Water Energy', count: 12 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'energy-burn-host-token': { uid: 'energy-burn-host-uid', username: 'EnergyBurnHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Charmander', count: 6 }, { name: 'Charmeleon', count: 6 }, { name: 'Charizard', count: 6 }, { name: 'Fire Energy', count: 12 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'energy-trans-host-token': { uid: 'energy-trans-host-uid', username: 'EnergyTransHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Bulbasaur', count: 6 }, { name: 'Ivysaur', count: 6 }, { name: 'Venusaur', count: 6 }, { name: 'Charmander', count: 4 }, { name: 'Grass Energy', count: 8 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'buzzap-host-token': { uid: 'buzzap-host-uid', username: 'BuzzapHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Voltorb', count: 6 }, { name: 'Electrode', count: 6 }, { name: 'Charmander', count: 4 }, { name: 'Fire Energy', count: 8 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'strikes-back-host-token': { uid: 'strikes-back-host-uid', username: 'StrikesBackHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Machop', count: 6 }, { name: 'Machoke', count: 6 }, { name: 'Machamp', count: 6 }, { name: 'Fighting Energy', count: 12 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
};
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const identity = IDENTITIES[JSON.parse(body).idToken];
    if (!identity) { res.writeHead(401).end(JSON.stringify({ error: 'bad token' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(identity));
  });
});

function connect(room, token, intent) {
  return new WebSocket('ws://127.0.0.1:1999/parties/main/' + room +
    '?token=' + token + '&deckId=x&cardBackId=clasico&intent=' + intent);
}
function makeQueue(ws) {
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);
    if (waiters.length) { waiters.shift()(data); } else { queue.push(data); }
  });
  return function next() {
    return new Promise((resolve) => {
      if (queue.length) { resolve(queue.shift()); } else { waiters.push(resolve); }
    });
  };
}
async function nextOfType(next, type) {
  let data = await next();
  while (data.type !== type) { data = await next(); }
  return data;
}
let reqCounter = 0;
function sendAction(ws, action) {
  const reqId = ++reqCounter;
  ws.send(JSON.stringify({ type: 'action', reqId: reqId, action: action }));
  return reqId;
}
const KNOWN_BASICS = ['Charmander', 'Squirtle', 'Bulbasaur', 'Caterpie', 'Weedle', 'Pidgey', 'Rattata', 'Machop', 'Meowth', 'Psyduck', 'Magikarp', 'Poliwag', 'Abra', 'Gastly', 'Voltorb', 'Diglett', 'Growlithe', 'Ponyta', 'Vulpix', 'Onix', 'Drowzee', 'Sandshrew', 'Doduo', 'Krabby', 'Horsea', 'Goldeen', 'Staryu', 'Eevee', 'Dratini', 'Porygon', 'Pikachu', 'Clefairy', 'Jigglypuff', 'Zubat', 'Oddish', 'Paras', 'Venonat', 'Ekans', 'Hitmonchan', "Farfetch'd"];
function firstBasic(hand) { return hand.find((c) => KNOWN_BASICS.indexOf(c.name) !== -1); }

async function playToTurn1(roomCode, hostToken, guestToken) {
  const host = connect(roomCode, hostToken, 'create');
  const hostNext = makeQueue(host);
  await hostNext(); // room, waiting
  const guest = connect(roomCode, guestToken, 'join');
  const guestNext = makeQueue(guest);
  await hostNext(); await guestNext(); // room, guest joined

  host.send(JSON.stringify({ type: 'setReady' }));
  await hostNext();
  guest.send(JSON.stringify({ type: 'setReady' }));
  await nextOfType(hostNext, 'match');
  await nextOfType(guestNext, 'match');

  sendAction(host, { type: 'submitRpsChoice', choice: 'rock' });
  sendAction(guest, { type: 'submitRpsChoice', choice: 'scissors' });
  let hostAfterRps = await nextOfType(hostNext, 'match');
  while (hostAfterRps.public.phase !== 'setup') { hostAfterRps = await nextOfType(hostNext, 'match'); }

  const hostBasic = firstBasic(hostAfterRps.myHand);
  sendAction(host, { type: 'placeActive', handCardId: hostBasic.id });
  await nextOfType(hostNext, 'match');
  const guestAfterRps = await nextOfType(guestNext, 'match');
  const guestBasic = firstBasic(guestAfterRps.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestBasic.id });
  await nextOfType(guestNext, 'match');
  await nextOfType(hostNext, 'match'); // host's own copy of the guest's placeActive broadcast
  sendAction(host, { type: 'confirmSetup' });
  await nextOfType(hostNext, 'match');
  sendAction(guest, { type: 'confirmSetup' });
  await nextOfType(guestNext, 'match');
  let hostPlaying = await nextOfType(hostNext, 'match');
  while (hostPlaying.public.phase !== 'playing') { hostPlaying = await nextOfType(hostNext, 'match'); }
  let guestPlaying = await nextOfType(guestNext, 'match');
  while (guestPlaying.public.phase !== 'playing') { guestPlaying = await nextOfType(guestNext, 'match'); }

  return { host, guest, hostNext, guestNext, hostState: hostPlaying, guestState: guestPlaying };
}
```

Damage Swap/Energy Trans/Buzzap each need a 2nd own Pokémon on the
bench (Rain Dance/Energy Burn only ever need the Active itself) — each of
those 3 scenarios below places it inline, right after evolving, since
`placeBench` doesn't depend on evolution timing the way `evolve` does; no
shared helper needed for a 2-line action + await.

- [ ] **Step 2: Write the shared "evolve the host to Stage 2 (or Stage 1) on schedule" helper**

```javascript
// Ends turns on both sides until the host reaches their OWN next turn --
// shared by the evolution helper below (2 uses: turn1->turn3, turn3->
// turn5) and the Strikes Back scenario (turn1->turn3, so the guest can
// attack on turn 2 first).
async function endTurnsUntilHostActive(host, guest, hostNext, guestNext) {
  sendAction(host, { type: 'endTurn' });
  await nextOfType(hostNext, 'match');
  let guestTurn = await nextOfType(guestNext, 'match');
  while (guestTurn.public.activePlayerId !== 'player2') { guestTurn = await nextOfType(guestNext, 'match'); }
  sendAction(guest, { type: 'endTurn' });
  let hostTurn = await nextOfType(hostNext, 'match');
  while (hostTurn.public.activePlayerId !== 'player1') { hostTurn = await nextOfType(hostNext, 'match'); }
  await nextOfType(guestNext, 'match'); // guest's own copy of this same handoff
  return hostTurn;
}

// Evolves the host's own Active from a Basic all the way to stage2Name
// (or, if stage2Name is null, only up to stage1Name -- Electrode's own
// Buzzap scenario is Stage 1) on the earliest turns evolutionTimingAllowed
// permits (host's own turn 3, then turn 5). Returns the same shape
// playToTurn1 does, plus `ownerId` (the evolved Pokémon's own instance id,
// unchanged by evolving -- see rules-engine.js's evolve(), which mutates
// the existing instance's .name in place rather than replacing it).
async function evolveHostActive(roomCode, hostToken, guestToken, stage1Name, stage2Name) {
  const setup = await playToTurn1(roomCode, hostToken, guestToken);
  const ownerId = setup.hostState.public.board.player1.active.id;
  const hostTurn3 = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
  const stage1Card = hostTurn3.myHand.find((c) => c.name === stage1Name);
  assert.ok(stage1Card, 'expected ' + stage1Name + ' in hand by turn 3');
  sendAction(setup.host, { type: 'evolve', handCardId: stage1Card.id, targetInstanceId: ownerId });
  let afterStage1 = await nextOfType(setup.hostNext, 'match');
  if (!stage2Name) {
    return Object.assign({}, setup, { hostState: afterStage1, ownerId: ownerId });
  }
  const hostTurn5 = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
  const stage2Card = hostTurn5.myHand.find((c) => c.name === stage2Name);
  assert.ok(stage2Card, 'expected ' + stage2Name + ' in hand by turn 5');
  sendAction(setup.host, { type: 'evolve', handCardId: stage2Card.id, targetInstanceId: ownerId });
  const afterStage2 = await nextOfType(setup.hostNext, 'match');
  return Object.assign({}, setup, { hostState: afterStage2, ownerId: ownerId });
}
```

- [ ] **Step 3: Damage Swap scenario**

Drives its own turn sequence directly rather than reusing
`evolveHostActive` — Damage Swap needs REAL damage already on the "from"
Pokémon before the swap, which means interleaving the host's own
evolution turns (3 and 5) with the guest actually attacking on turns 2
and 4, something `evolveHostActive` (which only ever sends plain
`endTurn`s for the guest) doesn't do:

```javascript
async function testDamageSwap() {
  const setup = await playToTurn1('POWER-DAMAGESWAP', 'damage-swap-host-token', 'power-attacker-guest-token');
  const ownerId = setup.hostState.public.board.player1.active.id; // Abra

  const benchCard = setup.hostState.myHand.find((c) => c.name === 'Bulbasaur');
  assert.ok(benchCard, 'expected Bulbasaur in hand to bench');
  sendAction(setup.host, { type: 'placeBench', handCardId: benchCard.id, benchIndex: 0 });
  const afterBench = await nextOfType(setup.hostNext, 'match');
  const benchId = afterBench.public.board.player1.bench[0].id;
  await nextOfType(setup.guestNext, 'match'); // guest's own copy

  // Turn 1 (host): evolving isn't legal yet -- just end the turn.
  sendAction(setup.host, { type: 'endTurn' });
  await nextOfType(setup.hostNext, 'match');

  // Turn 2 (guest): attach Grass Energy, ready to attack next turn.
  let guestTurn2 = await nextOfType(setup.guestNext, 'match');
  while (guestTurn2.public.activePlayerId !== 'player2') { guestTurn2 = await nextOfType(setup.guestNext, 'match'); }
  const grassEnergy = guestTurn2.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy, 'expected Grass Energy in the guest\'s opening hand');
  const guestActiveId = guestTurn2.public.board.player2.active.id;
  sendAction(setup.guest, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: guestActiveId });
  await nextOfType(setup.guestNext, 'match');
  sendAction(setup.guest, { type: 'endTurn' });
  await nextOfType(setup.guestNext, 'match');

  // Turn 3 (host): evolve Abra -> Kadabra.
  let hostTurn3 = await nextOfType(setup.hostNext, 'match');
  while (hostTurn3.public.activePlayerId !== 'player1') { hostTurn3 = await nextOfType(setup.hostNext, 'match'); }
  const kadabraCard = hostTurn3.myHand.find((c) => c.name === 'Kadabra');
  assert.ok(kadabraCard, 'expected Kadabra in hand by turn 3');
  sendAction(setup.host, { type: 'evolve', handCardId: kadabraCard.id, targetInstanceId: ownerId });
  await nextOfType(setup.hostNext, 'match');
  sendAction(setup.host, { type: 'endTurn' });
  await nextOfType(setup.hostNext, 'match');

  // Turn 4 (guest): attack the host's Kadabra for real damage.
  let guestTurn4 = await nextOfType(setup.guestNext, 'match');
  while (guestTurn4.public.activePlayerId !== 'player2') { guestTurn4 = await nextOfType(setup.guestNext, 'match'); }
  sendAction(setup.guest, { type: 'attack', attackName: 'Poison Sting' });
  const afterAttack = await nextOfType(setup.guestNext, 'match');
  assert.strictEqual(afterAttack.public.board.player1.active.damage, 10, 'expected the host\'s Kadabra to have taken 10 real damage');
  sendAction(setup.guest, { type: 'confirmEndTurn' });
  await nextOfType(setup.guestNext, 'match');

  // Turn 5 (host): evolve Kadabra -> Alakazam (damage carries through),
  // then use Damage Swap moving that same 10 damage onto the bench Bulbasaur.
  let hostTurn5 = await nextOfType(setup.hostNext, 'match');
  while (hostTurn5.public.activePlayerId !== 'player1') { hostTurn5 = await nextOfType(setup.hostNext, 'match'); }
  const alakazamCard = hostTurn5.myHand.find((c) => c.name === 'Alakazam');
  assert.ok(alakazamCard, 'expected Alakazam in hand by turn 5');
  sendAction(setup.host, { type: 'evolve', handCardId: alakazamCard.id, targetInstanceId: ownerId });
  const afterEvolve = await nextOfType(setup.hostNext, 'match');
  assert.strictEqual(afterEvolve.public.board.player1.active.damage, 10, 'expected the 10 damage to survive evolving into Alakazam');

  sendAction(setup.host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const afterSwap = await nextOfType(setup.hostNext, 'match');
  assert.strictEqual(afterSwap.public.board.player1.active.damage, 0, 'expected Alakazam\'s own damage to have moved away');
  assert.strictEqual(afterSwap.public.board.player1.bench[0].damage, 10, 'expected the bench Bulbasaur to have received the 10 damage');
  assert.ok(afterSwap.public.lastPowerUse, 'expected a lastPowerUse reveal');
  assert.strictEqual(afterSwap.public.lastPowerUse.powerName, 'Damage Swap');
  assert.strictEqual(afterSwap.public.lastPowerUse.ownerName, 'Alakazam');
  const guestSeesSwap = await nextOfType(setup.guestNext, 'match');
  assert.strictEqual(guestSeesSwap.public.lastPowerUse.round, afterSwap.public.lastPowerUse.round, 'expected both sides to receive the same lastPowerUse reveal');
  console.log('PASS: Damage Swap moves real damage between 2 of the host\'s own Pokémon and both sides see the same reveal');

  // Illegal attempt: moving from a Pokémon with 0 damage.
  sendAction(setup.host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const illegalReply = await setup.hostNext();
  assert.strictEqual(illegalReply.type, 'error', 'expected a 2nd Damage Swap with 0 damage on the source to be rejected');
  console.log('PASS: Damage Swap with no damage to move is rejected with a clean error, not a crash');

  setup.host.close(); setup.guest.close();
}
```

- [ ] **Step 4: Rain Dance scenario**

```javascript
async function testRainDance() {
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-RAINDANCE', 'rain-dance-host-token', 'power-guest-token', 'Wartortle', 'Blastoise');
  const waterEnergy = hostState.myHand.find((c) => c.name === 'Water Energy');
  assert.ok(waterEnergy, 'expected Water Energy in hand');

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { handEnergyId: waterEnergy.id, targetInstanceId: ownerId } });
  const afterRainDance = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterRainDance.public.board.player1.active.attachedEnergy.length, 1, 'expected 1 Water Energy attached to Blastoise');
  assert.strictEqual(afterRainDance.public.lastPowerUse.powerName, 'Rain Dance');
  assert.strictEqual(afterRainDance.myHand.filter((c) => c.name === 'Water Energy').length, hostState.myHand.filter((c) => c.name === 'Water Energy').length - 1, 'expected the played Water Energy to leave the hand');
  const guestSeesRainDance = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesRainDance.public.lastPowerUse.round, afterRainDance.public.lastPowerUse.round);
  console.log('PASS: Rain Dance attaches a real Water Energy to Blastoise without using the turn\'s normal energy attachment');

  // Illegal: targeting a non-Water Pokémon isn't possible here (Blastoise
  // is the only Pokémon in play), so instead verify a 2nd Rain Dance
  // still works ("as often as you like") using a 2nd Water Energy.
  const waterEnergy2 = afterRainDance.myHand.find((c) => c.name === 'Water Energy');
  assert.ok(waterEnergy2, 'expected a 2nd Water Energy in hand');
  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { handEnergyId: waterEnergy2.id, targetInstanceId: ownerId } });
  const afterSecond = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterSecond.public.board.player1.active.attachedEnergy.length, 2, 'expected Rain Dance to be usable more than once per turn');
  console.log('PASS: Rain Dance can be used more than once in the same turn, matching the real card text');

  host.close(); guest.close();
}
```

- [ ] **Step 5: Energy Burn scenario**

```javascript
async function testEnergyBurn() {
  const { host, guest, hostNext, guestNext, ownerId } = await evolveHostActive('POWER-ENERGYBURN', 'energy-burn-host-token', 'power-guest-token', 'Charmeleon', 'Charizard');

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: {} });
  const afterBurn = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterBurn.public.lastPowerUse.powerName, 'Energy Burn');
  assert.strictEqual(afterBurn.public.lastPowerUse.targetName, null, 'Energy Burn has no target');
  const guestSeesBurn = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesBurn.public.lastPowerUse.round, afterBurn.public.lastPowerUse.round);
  console.log('PASS: Energy Burn works with no target and both sides see the same reveal');

  // Illegal: a wrong owner (the guest's own Active, which the host never controls).
  const guestActiveId = afterBurn.public.board.player2.active.id;
  sendAction(host, { type: 'usePower', ownerInstanceId: guestActiveId, params: {} });
  const illegalReply = await hostNext();
  assert.strictEqual(illegalReply.type, 'error', 'expected using a Power on a Pokémon that isn\'t the caller\'s own to be rejected');
  console.log('PASS: using a Power on a Pokémon that isn\'t the caller\'s own is rejected with a clean error');

  host.close(); guest.close();
}
```

- [ ] **Step 6: Energy Trans scenario**

```javascript
async function testEnergyTrans() {
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-ENERGYTRANS', 'energy-trans-host-token', 'power-guest-token', 'Ivysaur', 'Venusaur');
  const benchCard = hostState.myHand.find((c) => c.name === 'Charmander');
  assert.ok(benchCard, 'expected Charmander in hand to bench');
  sendAction(host, { type: 'placeBench', handCardId: benchCard.id, benchIndex: 0 });
  const afterBench = await nextOfType(hostNext, 'match');
  const benchId = afterBench.public.board.player1.bench[0].id;
  await nextOfType(guestNext, 'match'); // guest's own copy

  const grassEnergy = afterBench.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy, 'expected Grass Energy in hand');
  sendAction(host, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: ownerId });
  const afterAttach = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterAttach.public.board.player1.active.attachedEnergy.length, 1);

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const afterTrans = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterTrans.public.board.player1.active.attachedEnergy.length, 0, 'expected the Grass Energy to have left Venusaur');
  assert.strictEqual(afterTrans.public.board.player1.bench[0].attachedEnergy.length, 1, 'expected the Grass Energy to have landed on the bench Charmander');
  assert.strictEqual(afterTrans.public.lastPowerUse.powerName, 'Energy Trans');
  const guestSeesTrans = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesTrans.public.lastPowerUse.round, afterTrans.public.lastPowerUse.round);
  console.log('PASS: Energy Trans moves a real Grass Energy card between 2 of the host\'s own Pokémon and both sides see the same reveal');

  // Illegal: moving from a Pokémon with no Grass Energy attached (the
  // bench Charmander now has it, Venusaur doesn't any more).
  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const illegalReply = await hostNext();
  assert.strictEqual(illegalReply.type, 'error', 'expected Energy Trans with no Grass Energy on the source to be rejected');
  console.log('PASS: Energy Trans with nothing to move is rejected with a clean error, not a crash');

  host.close(); guest.close();
}
```

- [ ] **Step 7: Buzzap scenario**

```javascript
async function testBuzzap() {
  // Electrode is Stage 1 (Voltorb only evolves once) -- usable starting
  // the host's own turn 3, so stage2Name is omitted (null).
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-BUZZAP', 'buzzap-host-token', 'power-guest-token', 'Electrode', null);
  const benchCard = hostState.myHand.find((c) => c.name === 'Charmander');
  assert.ok(benchCard, 'expected Charmander in hand to bench');
  sendAction(host, { type: 'placeBench', handCardId: benchCard.id, benchIndex: 0 });
  const afterBench = await nextOfType(hostNext, 'match');
  const benchId = afterBench.public.board.player1.bench[0].id;
  await nextOfType(guestNext, 'match'); // guest's own copy

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { chosenType: 'Fire', targetInstanceId: benchId } });
  const afterBuzzap = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterBuzzap.public.board.player1.active, null, 'expected Electrode to have knocked itself out');
  assert.strictEqual(afterBuzzap.public.board.player1.bench[0].attachedEnergy.length, 2, 'expected 2 Fire Energy on the bench Charmander');
  assert.strictEqual(afterBuzzap.public.lastPowerUse.powerName, 'Buzzap');
  assert.strictEqual(afterBuzzap.public.lastPowerUse.targetName, 'Charmander');
  const guestSeesBuzzap = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesBuzzap.public.lastPowerUse.round, afterBuzzap.public.lastPowerUse.round);
  console.log('PASS: Buzzap knocks out its own owner for real and attaches 2 real Energy of the chosen type to the target, both sides see the same reveal');

  host.close(); guest.close();
}
```

- [ ] **Step 8: Strikes Back verification (Machamp, passive, no code change expected)**

```javascript
async function testStrikesBackAlreadyWorksInPvp() {
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-STRIKESBACK', 'strikes-back-host-token', 'power-attacker-guest-token', 'Machoke', 'Machamp');

  // Guest attacks the host's real, live Machamp.
  sendAction(host, { type: 'endTurn' });
  await nextOfType(hostNext, 'match');
  let guestTurn = await nextOfType(guestNext, 'match');
  while (guestTurn.public.activePlayerId !== 'player2') { guestTurn = await nextOfType(guestNext, 'match'); }
  const grassEnergy = guestTurn.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy, 'expected Grass Energy in the guest\'s opening hand');
  const guestActiveId = guestTurn.public.board.player2.active.id;
  sendAction(guest, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: guestActiveId });
  await nextOfType(guestNext, 'match');
  sendAction(guest, { type: 'attack', attackName: 'Poison Sting' });
  const afterAttack = await nextOfType(guestNext, 'match');

  // Strikes Back: "does 10 damage to the attacking Pokémon" -- Weedle
  // (40 HP) took 10 from its own Poison Sting connecting, PLUS Machamp's
  // own automatic 10-damage counter-hit, entirely inside attack() itself,
  // unconditionally, in both local play and PVP -- no 'usePower' action
  // involved at all, this is a real reported passive effect this scenario
  // only verifies, not a new code path this plan built.
  assert.strictEqual(afterAttack.public.board.player2.active.damage, 10, 'expected Machamp\'s Strikes Back to have already dealt its 10 counter-damage to the attacking Weedle in PVP, unchanged');
  console.log('PASS: Machamp\'s Strikes Back (passive) already works correctly in PVP with no code changes');

  host.close(); guest.close();
}
```

- [ ] **Step 9: `main()` and run against a local dev server**

```javascript
async function main() {
  await new Promise((resolve) => stub.listen(8799, resolve));
  await testDamageSwap();
  await testRainDance();
  await testEnergyBurn();
  await testEnergyTrans();
  await testBuzzap();
  await testStrikesBackAlreadyWorksInPvp();
  stub.close();
  console.log('ALL PVP POWER (PartyKit) TESTS PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Run:

```bash
pkill -f "partykit dev"; lsof -ti:1999 | xargs -r kill -9; rm -rf party/.partykit
cd party && npx partykit dev --var RESOLVE_IDENTITY_URL=http://127.0.0.1:8799
# in a second terminal, once "Ready on http://0.0.0.0:1999" appears:
cd party && node test/power.test.js
```

Expected output:

```
PASS: Damage Swap moves real damage between 2 of the host's own Pokémon and both sides see the same reveal
PASS: Damage Swap with no damage to move is rejected with a clean error, not a crash
PASS: Rain Dance attaches a real Water Energy to Blastoise without using the turn's normal energy attachment
PASS: Rain Dance can be used more than once in the same turn, matching the real card text
PASS: Energy Burn works with no target and both sides see the same reveal
PASS: using a Power on a Pokémon that isn't the caller's own is rejected with a clean error
PASS: Energy Trans moves a real Grass Energy card between 2 of the host's own Pokémon and both sides see the same reveal
PASS: Energy Trans with nothing to move is rejected with a clean error, not a crash
PASS: Buzzap knocks out its own owner for real and attaches 2 real Energy of the chosen type to the target, both sides see the same reveal
PASS: Machamp's Strikes Back (passive) already works correctly in PVP with no code changes
ALL PVP POWER (PartyKit) TESTS PASSED
```

Kill the dev server afterward:
`pkill -f "partykit dev"; lsof -ti:1999 | xargs -r kill -9; rm -rf party/.partykit`

- [ ] **Step 10: Run the full suite once more**

```bash
node run-tests.js
```

Expected: exit code 0, 739 `PASS` lines, 0 `FAIL` lines.

- [ ] **Step 11: Commit**

```bash
git add party/test/power.test.js
git commit -m "Add PVP Pokémon Power tests, verify Strikes Back already works"
```

---

## Final Whole-Branch Review

Once all 3 tasks are done, dispatch a final whole-branch code review (per
`superpowers:subagent-driven-development`'s own process) covering the
full diff across `rules-engine.js`, `party/index.js`, `ui.js`, and
`party/test/power.test.js` together — the same final-review step every
prior PVP sub-project this session (special attacks, synced clock) went
through, since bugs spanning task boundaries (like the `startMatch()`
reset gap found for the synced-clock plan, or the Buzzap self-KO ordering
bug caught during this plan's own spec self-review) only ever show up
once the whole diff is read at once.
