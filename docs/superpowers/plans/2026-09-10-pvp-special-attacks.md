# PVP Special-Effect Attacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every attack with a registered `ATTACK_EFFECTS` entry (coin
flips, Special Conditions, self-damage, shields, Ninetales' Lure,
Metronome, etc.) work in PVP, server-authoritative like every other
action, and add the full-screen attack reveal PVP is currently missing
even for vanilla attacks.

**Architecture:** Extend the existing `'attack'` case in `party/index.js`'s
`runAction` (no new action type needed — remove its `ATTACK_EFFECTS`
guard, forward `action.targetInstanceId`, capture `attack()`'s own
`state.lastAttackResult` into a round-counted `redactedFor` field). Wire
`ui.js`'s two attacks that need player-chosen targeting (Lure, Metronome)
through `submitMatchActionCloud` instead of their current PVP block, and
add a `pvpAttackRevealedRound` gate mirroring the already-shipped
`pvpTrainerRevealedRound` one, reusing `showAttackOverlay` verbatim.

**Tech Stack:** Same as the PartyKit migration and Trainer-cards plan this
extends — plain JavaScript, PartyKit (Cloudflare Workers/Durable Objects),
Node 22 native `WebSocket`/`fetch`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-pvp-special-attacks-design.md`

## Global Constraints

- `ATTACK_EFFECTS`/`attack()` (rules-engine.js, card-effects.js) are reused
  **verbatim** — this plan changes only `party/index.js`'s guard/argument
  forwarding and `ui.js`'s client wiring, never any attack's legality or
  effect logic.
- Every attack stays server-authoritative: the client can never apply one
  to its own state without the server agreeing first.
- `node run-tests.js` (739 tests) must stay green through every task.
- No new npm dependency, client or server — native `WebSocket`/`fetch`
  only.
- Neither Lure's nor Metronome's existing local-play modal/click flow
  changes at all — only where their final effect gets *applied* in PVP
  changes (server, via `submitMatchActionCloud`, instead of local
  `gameState`).

---

### Task 1: Server — remove the guard, forward targeting, add the reveal field

**Files:**
- Modify: `party/index.js:391-397` (the `'attack'` case), `party/index.js`
  (the `redactedFor` method, currently ending around line 313 with
  `redacted.public.guestPhoto = ...`)
- Create: `party/test/attack.test.js`

**Interfaces:**
- Consumes: `attack(state, playerId, attackName, targetInstanceId)`
  (rules-engine.js, already exists, already accepts a 4th
  `targetInstanceId` parameter used by Ninetares' Lure and reused by
  Metronome as its "attack name to copy" argument), `ATTACK_EFFECTS`
  (card-effects.js, already exists), `this.state.lastAttackResult`
  (already set by `attack()` internally — `{attackerName, defenderName,
  damage, newStatuses, severePoison, missed, selfDamage}` — whenever
  something reveal-worthy happened).
- Produces: `redacted.public.lastAttackResult` —
  `{attackerName, defenderName, damage, newStatuses, severePoison, missed,
  selfDamage, round}` or `null` — Task 3's `ui.js` reveal gate reads this.
  `{type:'action', reqId, action:{type:'attack', attackName,
  targetInstanceId}}` — the (already-existing) action shape, now with a
  meaningful `targetInstanceId` — Task 2's client sends this.

- [ ] **Step 1: Update the `'attack'` case**

In `party/index.js`, replace the current case (lines 391-397):

```javascript
      case 'attack': {
        if (!canAttack(this.state, side, action.attackName)) { throw new Error('No puedes usar ese ataque ahora.'); }
        const attackerName = this.state.players[side].active.name;
        if (ATTACK_EFFECTS[attackerName] && ATTACK_EFFECTS[attackerName][action.attackName]) { throw new Error('Ese ataque todavía no está disponible en PVP (Fase 2).'); }
        attack(this.state, side, action.attackName);
        break;
      }
```

with:

```javascript
      case 'attack': {
        if (!canAttack(this.state, side, action.attackName)) { throw new Error('No puedes usar ese ataque ahora.'); }
        attack(this.state, side, action.attackName, action.targetInstanceId);
        this.attackRound = (this.attackRound || 0) + 1;
        this.lastAttackResult = this.state.lastAttackResult
          ? Object.assign({}, this.state.lastAttackResult, { round: this.attackRound })
          : null;
        this.state.lastAttackResult = null; // never let a stale result leak into a later attack's own check
        break;
      }
```

- [ ] **Step 2: Add the reveal field to `redactedFor`**

In `party/index.js`, right after the existing
`redacted.public.guestPhoto = this.info.guestPhoto || null;` line (the
last line `redactedFor` adds before its `const uid = ...` closing logic),
add:

```javascript
    redacted.public.lastAttackResult = this.lastAttackResult || null;
```

- [ ] **Step 3: Verify syntax**

Run: `node --check party/index.js`
Expected: OK.

- [ ] **Step 4: Write `party/test/attack.test.js`**

This mirrors `party/test/trainer.test.js`'s own structure (a local HTTP
stub standing in for `resolvePvpIdentity`, real WebSocket clients, the
same `connect`/`makeQueue`/`nextOfType`/`sendAction` helpers). Three
scenarios, each using a dedicated `customDeckCards` identity (the same
mechanism `trainer.test.js` already established for guaranteeing a
specific card, honored by `party/index.js`'s `onConnect`, which overwrites
`DECKLISTS[deckKey]` with it before dealing):

```javascript
const assert = require('assert');
const http = require('http');

// Real Base Set data (data-cards.js): Weedle's Poison Sting costs exactly
// 1 Grass Energy (single-turn attack, no multi-turn energy buildup
// needed) and has a registered ATTACK_EFFECTS entry (10 damage + a
// coin-flip chance of Poisoned) -- exactly the category party/index.js's
// old guard used to reject outright. Pikachu's Thunder Jolt deals a FIXED
// 30 damage (the coin flip only ever adds optional self-damage, never
// changes whether the defender is hit) against Magikarp's exactly-30 HP,
// making a one-hit KO deterministic regardless of that coin's outcome --
// needed to test that a special-effect attack's KO still opens
// pendingPrizeChoice correctly. Vulpix/Ninetales/Fire Energy is Ninetales'
// Lure -- the one real Base Set attack needing a chosen target (also the
// parameter Metronome reuses as its "attack name to copy" argument, so
// this one scenario already exercises that shared server-side forwarding
// path; a second, separate Metronome-specific test would only re-cover
// Metronome's own already-existing, unchanged local-play effect logic --
// not worth its own multi-turn setup on top of this one).
const IDENTITIES = {
  'weedle-token': { uid: 'weedle-uid', username: 'WeedleAttacker', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Weedle', count: 10 }, { name: 'Grass Energy', count: 20 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'weedle-guest-token': { uid: 'weedle-guest-uid', username: 'WeedleDefender', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'pika-token': { uid: 'pika-uid', username: 'PikaAttacker', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Pikachu', count: 10 }, { name: 'Lightning Energy', count: 20 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'pika-guest-token': { uid: 'pika-guest-uid', username: 'PikaDefender', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: [{ name: 'Magikarp', count: 10 }, { name: 'Water Energy', count: 20 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'lure-token': { uid: 'lure-uid', username: 'LureAttacker', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Vulpix', count: 10 }, { name: 'Ninetales', count: 10 }, { name: 'Fire Energy', count: 10 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'lure-guest-token': { uid: 'lure-guest-uid', username: 'LureDefender', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: [{ name: 'Magikarp', count: 6 }, { name: 'Rattata', count: 6 }, { name: 'Water Energy', count: 18 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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

// Every Base Set Basic Pokémon, same fixed list match.test.js/
// trainer.test.js already established (CARD_STATS isn't available in this
// plain Node process, it's the browser/party-only data table).
const KNOWN_BASICS = ['Charmander', 'Squirtle', 'Bulbasaur', 'Caterpie', 'Weedle', 'Pidgey', 'Rattata', 'Machop', 'Meowth', 'Psyduck', 'Magikarp', 'Poliwag', 'Abra', 'Gastly', 'Voltorb', 'Diglett', 'Growlithe', 'Ponyta', 'Vulpix', 'Onix', 'Drowzee', 'Sandshrew', 'Doduo', 'Krabby', 'Horsea', 'Goldeen', 'Staryu', 'Eevee', 'Dratini', 'Porygon', 'Pikachu', 'Clefairy', 'Jigglypuff', 'Zubat', 'Oddish', 'Paras', 'Venonat', 'Ekans', 'Hitmonchan', "Farfetch'd"];
function firstBasic(hand) { return hand.find((c) => KNOWN_BASICS.indexOf(c.name) !== -1); }

// Gets both sides through RPS + setup + confirmSetup, host always winning
// RPS (same hardcoded rock-beats-scissors as trainer.test.js/match.test.js)
// so activePlayerId is always 'player1' (host) once 'playing' starts.
// hostActiveName lets the host place a SPECIFIC card (not just any Basic)
// when its deck has more than one Basic in it (Lure's deck has both Vulpix
// and Ninetales' evolution card, but only Vulpix is itself Basic and
// placeable).
async function playToTurn1(roomCode, hostToken, guestToken, hostActiveName) {
  const host = connect(roomCode, hostToken, 'create');
  const hostNext = makeQueue(host);
  await hostNext(); // room, waiting
  const guest = connect(roomCode, guestToken, 'join');
  const guestNext = makeQueue(guest);
  await hostNext(); await guestNext(); // room, guest joined

  host.send(JSON.stringify({ type: 'setReady' }));
  await hostNext();
  guest.send(JSON.stringify({ type: 'setReady' }));
  await nextOfType(hostNext, 'match'); // rps phase, no active player yet
  await nextOfType(guestNext, 'match');

  sendAction(host, { type: 'submitRpsChoice', choice: 'rock' });
  sendAction(guest, { type: 'submitRpsChoice', choice: 'scissors' });
  let hostAfterRps = await nextOfType(hostNext, 'match');
  while (hostAfterRps.public.phase !== 'setup') { hostAfterRps = await nextOfType(hostNext, 'match'); }

  const hostBasic = hostActiveName
    ? hostAfterRps.myHand.find((c) => c.name === hostActiveName)
    : firstBasic(hostAfterRps.myHand);
  assert.ok(hostBasic, 'expected ' + (hostActiveName || 'a Basic') + ' in the host\'s opening hand');
  sendAction(host, { type: 'placeActive', handCardId: hostBasic.id });
  const hostMatch3 = await nextOfType(hostNext, 'match');
  const guestAfterRps = await nextOfType(guestNext, 'match');
  const guestBasic = firstBasic(guestAfterRps.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestBasic.id });
  await nextOfType(guestNext, 'match');
  sendAction(host, { type: 'confirmSetup' });
  await nextOfType(hostNext, 'match');
  const guestConfirmReqId = sendAction(guest, { type: 'confirmSetup' });
  await nextOfType(guestNext, 'match'); // guest's own ack-equivalent match broadcast
  let hostPlaying = await nextOfType(hostNext, 'match');
  while (hostPlaying.public.phase !== 'playing') { hostPlaying = await nextOfType(hostNext, 'match'); }
  let guestPlaying = await nextOfType(guestNext, 'match');
  while (guestPlaying.public.phase !== 'playing') { guestPlaying = await nextOfType(guestNext, 'match'); }

  return { host, guest, hostNext, guestNext, hostState: hostPlaying, guestState: guestPlaying, hostActiveId: hostMatch3.public.board.player1.active.id };
}

async function testWeedlePoisonSting() {
  const { host, guest, hostNext, guestNext, hostState, hostActiveId } = await playToTurn1('ATKW1', 'weedle-token', 'weedle-guest-token');
  const energyCard = hostState.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(energyCard, 'expected a Grass Energy in the host\'s opening hand (20/30 copies)');
  sendAction(host, { type: 'attachEnergy', handCardId: energyCard.id, targetInstanceId: hostActiveId });
  await nextOfType(hostNext, 'match');

  const beforeDefenderDamage = 0; // freshly placed Active, never hit yet
  sendAction(host, { type: 'attack', attackName: 'Poison Sting' });
  const hostAfterAttack = await nextOfType(hostNext, 'match');
  const guestAfterAttack = await nextOfType(guestNext, 'match');
  const defender = guestAfterAttack.public.board.player2.active;
  assert.strictEqual(defender.damage - beforeDefenderDamage, 10);
  console.log('PASS: Poison Sting (a coin-flip special attack, previously rejected with "(Fase 2)") deals its real 10 damage');

  assert.ok(hostAfterAttack.public.lastAttackResult);
  assert.strictEqual(hostAfterAttack.public.lastAttackResult.attackerName, 'Weedle');
  assert.strictEqual(hostAfterAttack.public.lastAttackResult.damage, 10);
  assert.ok(hostAfterAttack.public.lastAttackResult.newStatuses.length === 0 || hostAfterAttack.public.lastAttackResult.newStatuses[0] === 'Poisoned');
  assert.strictEqual(guestAfterAttack.public.lastAttackResult.round, hostAfterAttack.public.lastAttackResult.round);
  assert.strictEqual(guestAfterAttack.public.lastAttackResult.attackerName, hostAfterAttack.public.lastAttackResult.attackerName);
  console.log('PASS: both sides receive the same lastAttackResult reveal data');

  host.close(); guest.close();
}

async function testPikachuKnocksOutMagikarp() {
  const { host, guest, hostNext, guestNext, hostState, hostActiveId } = await playToTurn1('ATKP1', 'pika-token', 'pika-guest-token');
  const energy1 = hostState.myHand.find((c) => c.name === 'Lightning Energy');
  assert.ok(energy1, 'expected a Lightning Energy in the host\'s opening hand (20/30 copies)');
  sendAction(host, { type: 'attachEnergy', handCardId: energy1.id, targetInstanceId: hostActiveId });
  await nextOfType(hostNext, 'match');
  sendAction(host, { type: 'endTurn' });
  const hostAfterEndTurn = await nextOfType(hostNext, 'match');
  let guestPlaying = hostAfterEndTurn; // not used directly, just draining below
  const guestTurn = await nextOfType(guestNext, 'match');
  sendAction(guest, { type: 'endTurn' });
  let hostTurn3 = await nextOfType(hostNext, 'match');
  while (hostTurn3.public.activePlayerId !== 'player1') { hostTurn3 = await nextOfType(hostNext, 'match'); }

  const energy2 = hostTurn3.myHand.find((c) => c.name === 'Lightning Energy');
  assert.ok(energy2, 'expected a second Lightning Energy drawn by the host\'s second turn');
  sendAction(host, { type: 'attachEnergy', handCardId: energy2.id, targetInstanceId: hostActiveId });
  await nextOfType(hostNext, 'match');

  sendAction(host, { type: 'attack', attackName: 'Thunder Jolt' });
  const hostAfterKo = await nextOfType(hostNext, 'match');
  assert.strictEqual(hostAfterKo.public.lastAttackResult.attackerName, 'Pikachu');
  assert.strictEqual(hostAfterKo.public.lastAttackResult.damage, 30);
  assert.ok(hostAfterKo.public.pendingPrizeChoice && hostAfterKo.public.pendingPrizeChoice.side === 'player1');
  console.log('PASS: a special-effect attack (Thunder Jolt) that knocks out the defender still opens pendingPrizeChoice correctly');

  host.close(); guest.close();
}

async function testNinetalesLure() {
  // Bounded retry, same reasoning as trainer.test.js's Bill loop: Vulpix
  // needs to land in the host's 7-card opening hand (10/30 copies), and
  // Ninetales needs to have been drawn by the host's SECOND turn (10/30
  // copies, ~9 cards seen by then) -- both individually likely, retried
  // together with fresh room codes to make the combination overwhelmingly
  // likely across a few attempts.
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await playToTurn1('ATKL' + attempt, 'lure-token', 'lure-guest-token', 'Vulpix');
    const { host, guest, hostNext, guestNext, guestState } = result;
    let hostActiveId = result.hostActiveId;

    const energy1 = result.hostState.myHand.find((c) => c.name === 'Fire Energy');
    if (!energy1) { host.close(); guest.close(); continue; }
    sendAction(host, { type: 'attachEnergy', handCardId: energy1.id, targetInstanceId: hostActiveId });
    await nextOfType(hostNext, 'match');
    sendAction(host, { type: 'endTurn' });
    await nextOfType(hostNext, 'match');
    await nextOfType(guestNext, 'match');
    sendAction(guest, { type: 'endTurn' });
    let hostTurn3 = await nextOfType(hostNext, 'match');
    while (hostTurn3.public.activePlayerId !== 'player1') { hostTurn3 = await nextOfType(hostNext, 'match'); }

    const ninetalesCard = hostTurn3.myHand.find((c) => c.name === 'Ninetales');
    if (!ninetalesCard) { host.close(); guest.close(); continue; }
    sendAction(host, { type: 'evolve', handCardId: ninetalesCard.id, targetInstanceId: hostActiveId });
    await nextOfType(hostNext, 'match');
    const energy2 = hostTurn3.myHand.find((c) => c.name === 'Fire Energy');
    assert.ok(energy2, 'expected a second Fire Energy drawn by the host\'s second turn');
    sendAction(host, { type: 'attachEnergy', handCardId: energy2.id, targetInstanceId: hostActiveId });
    await nextOfType(hostNext, 'match');

    // guestState.myHand.length -- 1 (Active already placed) is what's left
    // on the guest's Bench; guestState.public.board.player2.bench is empty
    // at this point (guest never placed a Bench Pokémon in playToTurn1),
    // so a real Lure target needs one placed first.
    const guestBenchCardId = guestState.myHand.find((c) => c.name === 'Magikarp' || c.name === 'Rattata').id;
    sendAction(guest, { type: 'placeBench', handCardId: guestBenchCardId, benchIndex: 0 });
    const guestAfterBench = await nextOfType(guestNext, 'match');
    const benchInstanceId = guestAfterBench.public.board.player2.bench[0].id;
    const guestActiveNameBefore = guestAfterBench.public.board.player2.active.name;

    sendAction(host, { type: 'attack', attackName: 'Lure', targetInstanceId: benchInstanceId });
    const hostAfterLure = await nextOfType(hostNext, 'match');
    assert.strictEqual(hostAfterLure.public.lastAttackResult.attackerName, 'Ninetales');
    assert.notStrictEqual(hostAfterLure.public.board.player2.active.name, guestActiveNameBefore);
    console.log('PASS: Ninetales\' Lure with a real chosen target actually swaps in the named Bench Pokémon');

    host.close(); guest.close();
    return;
  }
  throw new Error('expected Vulpix + a drawn Ninetales within 5 independent attempts');
}

async function main() {
  await new Promise((resolve) => stub.listen(8794, resolve));
  await testWeedlePoisonSting();
  await testPikachuKnocksOutMagikarp();
  await testNinetalesLure();
  stub.close();
  console.log('ALL PVP ATTACK (PartyKit) TESTS PASSED');
  // Same Node-native-WebSocket-vs-workerd hang as room.test.js/match.test.js/
  // trainer.test.js -- see room.test.js's own comment for the full diagnosis.
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 5: Run the test against a local dev server**

```bash
cd party && npx partykit dev --var RESOLVE_IDENTITY_URL=http://127.0.0.1:8794 &
sleep 6
node test/attack.test.js
```
Expected: `ALL PVP ATTACK (PartyKit) TESTS PASSED`. Kill the dev server
afterward (`pkill -f "partykit dev"`).

- [ ] **Step 6: Run the full suite**

Run: `node run-tests.js`
Expected: 739/739 PASS (this task never touches `rules-engine.js` or any
local-play code path).

- [ ] **Step 7: Commit**

```bash
git add party/index.js party/test/attack.test.js
git commit -m "Allow special-effect attacks in PVP and add lastAttackResult reveal data"
```

---

### Task 2: Client — wire Lure and Metronome through the server in PVP

**Files:**
- Modify: `ui.js:682-701` (the Lure block), `ui.js:702-728` (the Metronome
  block), `ui.js:2751-2761` (the Bench-click handler's Lure completion)

**Interfaces:**
- Consumes: `submitMatchActionCloud` (existing), `pvpMode`/
  `pvpActiveMatchId`/`pvpAttackEndedMyTurn` (existing globals).
- Produces: nothing new — this task only changes where Lure's/Metronome's
  already-chosen target reaches the server, not how the player picks it.

- [ ] **Step 1: Remove Lure's PVP block, arm target-selection either way**

Change:
```javascript
        if (atkName === 'Lure') {
          // I8 (final-review fix): Lure has a real ATTACK_EFFECTS entry (it's
          // the one Base Set attack needing a chosen target), so it's Fase-2
          // territory same as every other special attack -- but unlike a
          // normal special attack, this button never reaches the pvpMode
          // check/submitMatchActionCloud call below at all (it arms local-only
          // target-selection mode instead), so the server-side rejection
          // (submitMatchAction's own ATTACK_EFFECTS check, see I5) never gets
          // a chance to run. Guarded here explicitly instead.
          if (pvpMode) {
            alert('Este ataque especial todavía no está disponible en PVP (próximamente).');
            return;
          }
          // Needs a chosen rival Bench Pokémon -- arm target-selection
          // mode instead of firing immediately (see the Bench/Active
          // click handler in wireBoardButtons for the other half of this).
          pendingAttackNeedingTarget = atkName;
          showTargetHintModal('Elige un Pokémon de la Banca del Rival');
          return;
        }
```
to:
```javascript
        if (atkName === 'Lure') {
          // Needs a chosen rival Bench Pokémon -- arm target-selection
          // mode instead of firing immediately (see the Bench/Active
          // click handler in wireBoardButtons for the other half of this).
          // Works identically in PVP now: the Bench click below submits
          // the real chosen target to the server instead of applying it
          // locally.
          pendingAttackNeedingTarget = atkName;
          showTargetHintModal('Elige un Pokémon de la Banca del Rival');
          return;
        }
```

- [ ] **Step 2: Route Lure's chosen target through the server in PVP**

Change:
```javascript
      if (pendingAttackNeedingTarget === 'Lure') {
        var onCpuBenchForLure = gameState.players.cpu.bench.some(function (b) { return b && b.id === instanceId; });
        if (!onCpuBenchForLure) {
          logEvent(gameState, 'Elige un Pokémon de la Banca del Rival', 'player');
          renderBoard();
          return;
        }
        pendingAttackNeedingTarget = null;
        executePlayerAttack('Lure', instanceId);
        return;
      }
```
to:
```javascript
      if (pendingAttackNeedingTarget === 'Lure') {
        var onCpuBenchForLure = gameState.players.cpu.bench.some(function (b) { return b && b.id === instanceId; });
        if (!onCpuBenchForLure) {
          logEvent(gameState, 'Elige un Pokémon de la Banca del Rival', 'player');
          renderBoard();
          return;
        }
        pendingAttackNeedingTarget = null;
        if (pvpMode) {
          pvpAttackEndedMyTurn = true;
          submitMatchActionCloud(pvpActiveMatchId, { type: 'attack', attackName: 'Lure', targetInstanceId: instanceId })
            .catch(function (err) { pvpAttackEndedMyTurn = false; alert(err.message || 'No se pudo atacar.'); });
          return;
        }
        executePlayerAttack('Lure', instanceId);
        return;
      }
```

- [ ] **Step 3: Remove Metronome's PVP block, route its choice through the server**

Change:
```javascript
        if (atkName === 'Metronome') {
          if (pvpMode) {
            alert('Este ataque especial todavía no está disponible en PVP (próximamente).');
            return;
          }
          var op = gameState.players[opponentOf('player')];
          var defender = op && op.active;
          var defStats = defender && CARD_STATS[defender.name];
          var rivalAttacks = (defStats && defStats.attacks) || [];
          if (rivalAttacks.length > 1) {
            var options = rivalAttacks.map(function (atk) {
              var dmgText = (atk.damage && atk.damage !== '0') ? ' (' + atk.damage + ' daño)' : '';
              var nameEs = (typeof translateAttackName === 'function') ? translateAttackName(atk.name) : atk.name;
              return {
                id: atk.name,
                label: nameEs.toUpperCase() + dmgText
              };
            });
            openChoicePickerModal('Elige 1 de los ataques de ' + (defender.name || 'rival') + ' para copiar con Metrónomo:', options, function (chosenAtkName) {
              executePlayerAttack('Metronome', chosenAtkName);
            });
            return;
          } else if (rivalAttacks.length === 1) {
            executePlayerAttack('Metronome', rivalAttacks[0].name);
            return;
          }
        }
```
to:
```javascript
        if (atkName === 'Metronome') {
          var op = gameState.players[opponentOf('player')];
          var defender = op && op.active;
          var defStats = defender && CARD_STATS[defender.name];
          var rivalAttacks = (defStats && defStats.attacks) || [];
          // Same submit-or-apply split every other targeted attack/Trainer
          // uses -- the modal/auto-pick logic above is identical for PVP
          // and local play, only the final call differs.
          function submitOrApplyMetronome(copiedAtkName) {
            if (pvpMode) {
              pvpAttackEndedMyTurn = true;
              submitMatchActionCloud(pvpActiveMatchId, { type: 'attack', attackName: 'Metronome', targetInstanceId: copiedAtkName })
                .catch(function (err) { pvpAttackEndedMyTurn = false; alert(err.message || 'No se pudo atacar.'); });
              return;
            }
            executePlayerAttack('Metronome', copiedAtkName);
          }
          if (rivalAttacks.length > 1) {
            var options = rivalAttacks.map(function (atk) {
              var dmgText = (atk.damage && atk.damage !== '0') ? ' (' + atk.damage + ' daño)' : '';
              var nameEs = (typeof translateAttackName === 'function') ? translateAttackName(atk.name) : atk.name;
              return {
                id: atk.name,
                label: nameEs.toUpperCase() + dmgText
              };
            });
            openChoicePickerModal('Elige 1 de los ataques de ' + (defender.name || 'rival') + ' para copiar con Metrónomo:', options, submitOrApplyMetronome);
            return;
          } else if (rivalAttacks.length === 1) {
            submitOrApplyMetronome(rivalAttacks[0].name);
            return;
          }
        }
```

- [ ] **Step 4: Verify syntax and the untouched suite**

Run: `node --check ui.js`
Expected: OK.

Run: `node run-tests.js`
Expected: 739/739 PASS (this task never touches any local-play code path
— `executePlayerAttack` itself is unchanged).

- [ ] **Step 5: Commit**

```bash
git add ui.js
git commit -m "Route Lure and Metronome through the server in PVP"
```

---

### Task 3: Client — the attack reveal gate

**Files:**
- Modify: `ui.js:4744` (`pvpTrainerRevealedRound` declaration), `ui.js`
  (the two `pvpTrainerRevealedRound = 0;` reset lines, currently at line
  4800 inside `resetPvpMatchState` and line 4914 inside `enterPvpMatch`),
  `ui.js:4938-5003` (`enterPvpMatch`'s listener callback)

**Interfaces:**
- Consumes: `showAttackOverlay(result, onDone)` (existing, unmodified —
  `result` shape already matches `lastAttackResult` field-for-field, no
  reshaping needed unlike the Trainer-card reveal's own `play` object),
  `pub.lastAttackResult` (Task 1).
- Produces: nothing later tasks depend on — this is the final task before
  deploy.

- [ ] **Step 1: Declare the new round-tracking variable**

Right next to the existing declaration:
```javascript
var pvpTrainerRevealedRound = 0;
```
add:
```javascript
// Sibling to pvpTrainerRevealedRound above, same shape -- lastAttackResult.round
// (party/index.js) increments every successful attack action (special-
// effect or vanilla); this tracks the last round already shown so a
// re-delivered snapshot (e.g. on reconnect) never replays a reveal that
// already happened.
var pvpAttackRevealedRound = 0;
```

- [ ] **Step 2: Reset it in both places `pvpTrainerRevealedRound` resets**

In `resetPvpMatchState`, right next to its `pvpTrainerRevealedRound = 0;`
line, add `pvpAttackRevealedRound = 0;`.

In `enterPvpMatch`, right next to its own `pvpTrainerRevealedRound = 0;`
line, add `pvpAttackRevealedRound = 0;`.

- [ ] **Step 3: Extract the shared post-snapshot effects helper**

Change (inside `enterPvpMatch`'s listener callback, the tail end after the
Trainer-reveal gate):
```javascript
    if (pvpEndTurnConfirmPending) { pvpEndTurnLatestData = data; return; }

    // See pvpAttackEndedMyTurn's own comment above -- tracks whether a
    // prize choice of MINE is (or just was) open, so the check right below
    // can tell "my own attack just finished awarding me a prize" apart from
    // a plain attack that never opened one.
    if (pub.pendingPrizeChoice && pub.pendingPrizeChoice.side === pvpMySide) {
      pvpMyPrizeChoiceSeen = true;
    }
    processPvpMatchSnapshot(data);
    // pendingActiveChoice !== pvpMySide guards against stacking this on top
    // of my OWN still-open "choose new Active" modal -- a simultaneous KO
    // (my own Active also fell, e.g. to a checkup) leaves that one blocking
    // first; this waits for it to clear like everything else does.
    // !pub.winner guards against stacking this on top of the win/loss modal
    // processPvpMatchSnapshot just showed -- taking the LAST prize of the
    // match ends the duel, not just the turn.
    if (!pub.winner && pvpAttackEndedMyTurn && pvpMyPrizeChoiceSeen && !pub.pendingPrizeChoice &&
        pub.activePlayerId !== pvpMySide && pub.pendingActiveChoice !== pvpMySide) {
      pvpAttackEndedMyTurn = false;
      pvpMyPrizeChoiceSeen = false;
      pvpEndTurnConfirmPending = true;
      renderEndTurnConfirm();
    }
  });
  showBoardScreen();
}
```
to (moving the prize/end-turn-confirm block into its own function, called
from the direct path, and adding the new attack-reveal gate right before
the `pvpEndTurnConfirmPending` check):
```javascript
    // Real reported bug (attack-reveal gate below): an attack, unlike a
    // Trainer play or an RPS round, can knock out a Pokémon and open the
    // prize-choice/end-turn-confirm flow -- this used to run inline here,
    // right after processPvpMatchSnapshot(data), which only ever happens
    // on the DIRECT (non-reveal) path. Extracted so the attack-reveal
    // gate's own deferred completion can call it too, on whichever
    // snapshot is current by the time the reveal finishes.
    function applyPvpSnapshotEffects(matchData) {
      var mpub = matchData.public;
      // See pvpAttackEndedMyTurn's own comment above -- tracks whether a
      // prize choice of MINE is (or just was) open, so the check right
      // below can tell "my own attack just finished awarding me a prize"
      // apart from a plain attack that never opened one.
      if (mpub.pendingPrizeChoice && mpub.pendingPrizeChoice.side === pvpMySide) {
        pvpMyPrizeChoiceSeen = true;
      }
      processPvpMatchSnapshot(matchData);
      // pendingActiveChoice !== pvpMySide guards against stacking this on
      // top of my OWN still-open "choose new Active" modal -- a
      // simultaneous KO (my own Active also fell, e.g. to a checkup)
      // leaves that one blocking first; this waits for it to clear like
      // everything else does. !mpub.winner guards against stacking this
      // on top of the win/loss modal processPvpMatchSnapshot just showed
      // -- taking the LAST prize of the match ends the duel, not just the
      // turn.
      if (!mpub.winner && pvpAttackEndedMyTurn && pvpMyPrizeChoiceSeen && !mpub.pendingPrizeChoice &&
          mpub.activePlayerId !== pvpMySide && mpub.pendingActiveChoice !== pvpMySide) {
        pvpAttackEndedMyTurn = false;
        pvpMyPrizeChoiceSeen = false;
        pvpEndTurnConfirmPending = true;
        renderEndTurnConfirm();
      }
    }

    if (pub.lastAttackResult && pub.lastAttackResult.round > pvpAttackRevealedRound) {
      pvpAttackRevealedRound = pub.lastAttackResult.round;
      showAttackOverlay(pub.lastAttackResult, function () {
        applyPvpSnapshotEffects(pvpRpsLatestMatchData);
      });
      return;
    }

    if (pvpEndTurnConfirmPending) { pvpEndTurnLatestData = data; return; }

    applyPvpSnapshotEffects(data);
  });
  showBoardScreen();
}
```

(`applyPvpSnapshotEffects` is declared fresh on every listener invocation,
same closure-per-callback pattern the rest of this listener already uses
for its other inner variables — no different from how `play`/`options`
etc. are declared inline above it.)

- [ ] **Step 4: Verify syntax and the untouched suite**

Run: `node --check ui.js`
Expected: OK.

Run: `node run-tests.js`
Expected: 739/739 PASS.

- [ ] **Step 5: Commit**

```bash
git add ui.js
git commit -m "Add the PVP attack reveal gate, mirroring the Trainer-card one"
```

---

### Task 4: Deploy and smoke-test end to end

**Files:** none (operational task)

- [ ] **Step 1: Deploy the PartyKit project**

```bash
cd party && npx partykit deploy
```
Expected: `Deployed ./index.js to https://tcg-simulador-pvp.hugoandri.partykit.dev`

- [ ] **Step 2: Deploy hosting**

```bash
firebase deploy --project default --only hosting
```
Expected: `Deploy complete!`

- [ ] **Step 3: Manual end-to-end smoke test**

Two browser sessions, same setup as prior PVP smoke tests (two accounts,
one creates a room, the other joins, both ready up, place Actives, confirm
setup):

1. Attack with a coin-flip status attack (e.g. Weedle's Poison Sting, or
   whatever Basic either deck actually has available) — confirm BOTH
   sessions see the full-screen reveal (both cards, damage number, any new
   Special Condition badge), not just a silent board update.
2. Attack with a self-damage/recoil attack if either side's deck has one
   (e.g. Pikachu's Thunder Jolt) — confirm the self-damage badge shows on
   the attacker's own card in the reveal.
3. If either deck has Ninetales (evolved from Vulpix) or Clefairy, use
   Lure or Metronome — confirm the target-selection/attack-choice modal
   works identically to local-vs-CPU play, and the real chosen
   target/attack reaches the rival's screen too.
4. Attack for a real knockout — confirm the prize-choice modal still opens
   correctly (for the attacking side) even with the new reveal animation
   playing first.
5. Confirm a *vanilla* (no special effect) attack still shows the reveal
   too — this plan's reveal gate applies to every PVP attack, not just
   special ones.

- [ ] **Step 4: No commit needed**

This task is deploy + manual verification only — Tasks 1-3's commits are
already the complete, reviewed change; nothing new to commit here unless
the smoke test surfaces a real bug, in which case fix it, re-verify,
redeploy, and commit the fix.

---

## Self-Review Notes

- **Spec coverage:** Section 4 (architecture: remove the guard, forward
  `targetInstanceId`, capture `lastAttackResult`) → Task 1. Section 5
  (client wiring for Lure/Metronome) → Task 2. Section 6 (the reveal,
  including the extracted post-snapshot-effects fix) → Task 3. Section 7
  (testing) → Task 1's `attack.test.js` + Task 4's manual smoke test.
- **Type/shape consistency:** `{type:'attack', attackName, targetInstanceId}`
  (Task 1's `runAction` case) matches exactly what Task 2's two call sites
  send. `lastAttackResult: {attackerName, defenderName, damage,
  newStatuses, severePoison, missed, selfDamage, round}` (Task 1) matches
  exactly what Task 3's reveal gate reads and what `showAttackOverlay`
  (unmodified) already expects.
- **No placeholders:** every step shows the real before/after code for its
  exact call site, taken directly from this worktree's current
  `party/index.js`/`ui.js` — none of it is illustrative pseudocode.
- **Scope check:** Metronome's own targeted-attack test is deliberately
  not duplicated as a separate `attack.test.js` scenario (Task 1, Step 4's
  own comment) — Lure's test already exercises the identical, non-attack-
  specific `action.targetInstanceId` forwarding path at the server level;
  a second test would only re-cover Metronome's own pre-existing,
  unchanged local-play effect logic, not this plan's actual change.
