# PVP Trainer Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 25 `TRAINER_EFFECTS` cards playable in real PVP matches,
server-authoritative, with a full-screen reveal shown to both players —
replacing today's client-side block on every Trainer-card play in PVP.

**Architecture:** One generic `playTrainer` action added to
`party/index.js`'s `runAction` (reusing every `TRAINER_EFFECTS[name]`
function verbatim — they already share rules-engine.js's
`(state, playerId, handId, ...args)` shape and self-validate before
mutating). A new read-only `peekOwnDeck` request/response for the 3 cards
that search the player's own hidden deck. A `lastTrainerPlay` field on the
match broadcast, gated on the client exactly like the already-shipped
RPS-reveal mechanism, driving the existing local-play reveal UI
(`showTrainerPlayedOverlay`) for both sides.

**Tech Stack:** Same as the PartyKit migration this extends — plain
JavaScript, PartyKit (Cloudflare Workers/Durable Objects), Node 22 native
`WebSocket`/`fetch`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-pvp-trainer-cards-design.md`

## Global Constraints

- Every `TRAINER_EFFECTS[name]` function is reused **verbatim** — same
  legality checks, same effects, same error messages local-vs-CPU play
  already has. This plan changes transport and client wiring, never card
  rules (2 lines added to 2 functions' *return values* only — Task 1 —
  nothing about their legality/mutation logic changes).
- Every Trainer play is server-authoritative: the client can never apply
  one to its own state without the server agreeing first.
- `node run-tests.js` (739 tests) must stay green through every task.
- No new npm dependency, client or server — native `WebSocket`/`fetch`
  only, matching the PartyKit migration's own constraint.
- Every one of `ui.js`'s existing Trainer-card selection flows (menus,
  multi-step picks, modals) is reused exactly as-is — only where the
  *final* effect gets applied changes, never how the player chooses what
  to play.

---

### Task 1: Reveal the found card for Computer Search and Pokémon Trader

**Files:**
- Modify: `card-effects.js`

**Interfaces:**
- Produces: `TRAINER_EFFECTS['Computer Search']` and
  `TRAINER_EFFECTS['Pokémon Trader']` now return
  `{legal: true, targetName: <found card's real name>}` on success
  (previously bare `{legal: true}`) — consumed by Task 2's `runAction`
  case (which forwards `result.targetName` into `lastTrainerPlay`) and,
  for local play, already-existing `cpuActionLabel`
  (`ui.js`, unmodified) which renders `'→ sale ' + targetName` whenever
  the field is present.

This is a real, small local-play correctness fix on its own (today even
against the CPU, playing either card shows no hint of what was found) —
independent of everything else in this plan, and lands first so Task 2/4
can rely on `targetName` already being populated.

- [ ] **Step 1: Find the two exact current return statements**

Run: `grep -n "return { legal: true };" card-effects.js`

Confirm which of the matches sit inside `TRAINER_EFFECTS['Computer
Search']` and `TRAINER_EFFECTS['Pokémon Trader']` (both functions are
fully shown in this plan's own Task 2/4 context below — `found` is
already a local variable in each, holding the card that was moved into
hand).

- [ ] **Step 2: Change Computer Search's return**

In `TRAINER_EFFECTS['Computer Search']`, change:
```javascript
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Computer Search') + ' y busca ' + translateCardName(found.name), playerId);
  return { legal: true };
```
to:
```javascript
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Computer Search') + ' y busca ' + translateCardName(found.name), playerId);
  return { legal: true, targetName: found.name };
```

- [ ] **Step 3: Change Pokémon Trader's return**

In `TRAINER_EFFECTS['Pokémon Trader']`, change:
```javascript
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokémon Trader') + ' y busca ' + translateCardName(found.name), playerId);
  return { legal: true };
```
to:
```javascript
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokémon Trader') + ' y busca ' + translateCardName(found.name), playerId);
  return { legal: true, targetName: found.name };
```

- [ ] **Step 4: Verify nothing else broke**

Run: `node run-tests.js`
Expected: 739/739 PASS (this is a return-value addition; nothing reads
`result.legal`/`result.targetName` in the existing test suite in a way
that a new, additional field could break — the test suite doesn't
special-case these two cards' return shape).

- [ ] **Step 5: Manually confirm the local-play reveal picks it up**

Run: `grep -n "cpuActionLabel" ui.js | head -3` to confirm the function
that renders it is still exactly where Section 6 of the spec expects
(`play.targetName ? (' → sale ' + translateCardName(play.targetName)) :
''` in its `default` case) — no code change needed there, this step is
just confirming the wiring this task depends on is really in place
before moving on.

- [ ] **Step 6: Commit**

```bash
git add card-effects.js
git commit -m "Reveal the found card when Computer Search or Pokémon Trader is played"
```

---

### Task 2: `playTrainer` action and `peekOwnDeck` in `party/index.js`

**Files:**
- Modify: `party/index.js`
- Test: `party/test/trainer.test.js` (create)

**Interfaces:**
- Consumes: `TRAINER_EFFECTS` (already `globalThis`-bound and destructured
  at the top of `party/index.js` — `TRAINER_EFFECTS` itself, not
  individually destructured, since `runAction` looks up cards by name at
  runtime); `result.targetName` (Task 1).
- Produces: `runAction` accepts `{type: 'playTrainer', trainerName,
  handId, args: [...]}` action payloads; `redactedFor(side)`'s returned
  `public` object gains `lastTrainerPlay: {side, cardName, targetName,
  round} | null`; `onMessage` accepts `{type: 'peekOwnDeck', reqId}` and
  responds (to the requesting connection only) with `{type: 'deckPeek',
  reqId, cards: [{id, name}, ...]}`. Task 3's `economy.js` and Task 4's
  `ui.js` both consume this exact message shape.

- [ ] **Step 1: Write the failing test**

Create `party/test/trainer.test.js` (same stub-identity harness pattern
as `party/test/match.test.js` — copy its `IDENTITIES`/`stub`/`connect`/
`nextMessage`/`nextMatchMessage`/`sendAction` helpers verbatim, on stub
port `8793` and room code `TRAINER01` to avoid colliding with other test
files if run back-to-back without a state reset in between):

```javascript
const assert = require('assert');
const http = require('http');

const IDENTITIES = {
  'host-token': { uid: 'host-uid', username: 'Host', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'guest-token': { uid: 'guest-uid', username: 'Guest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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
function sendPeek(ws) {
  const reqId = ++reqCounter;
  ws.send(JSON.stringify({ type: 'peekOwnDeck', reqId: reqId }));
  return reqId;
}

async function playToTurn1(roomCode) {
  const host = connect(roomCode, 'host-token', 'create');
  const hostNext = makeQueue(host);
  await hostNext(); // room, waiting
  const guest = connect(roomCode, 'guest-token', 'join');
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

  // CARD_STATS isn't available in this plain Node test process (it's the
  // browser/party-only data table) -- both starter decks' opening hands
  // are guaranteed at least one Basic Pokémon by the mulligan rule, and
  // this fixed list of every real Base Set Basic (same approach
  // match.test.js already established) finds one without needing
  // CARD_STATS at all.
  const KNOWN_BASICS = ['Charmander', 'Squirtle', 'Bulbasaur', 'Caterpie', 'Weedle', 'Pidgey', 'Rattata', 'Machop', 'Meowth', 'Psyduck', 'Magikarp', 'Poliwag', 'Abra', 'Gastly', 'Voltorb', 'Diglett', 'Growlithe', 'Ponyta', 'Vulpix', 'Onix', 'Drowzee', 'Sandshrew', 'Doduo', 'Krabby', 'Horsea', 'Goldeen', 'Staryu', 'Eevee', 'Dratini', 'Porygon', 'Pikachu', 'Clefairy', 'Jigglypuff', 'Zubat', 'Oddish', 'Paras', 'Venonat', 'Ekans'];
  function firstBasic(hand) { return hand.find((c) => KNOWN_BASICS.indexOf(c.name) !== -1); }

  const hostBasic = firstBasic(hostAfterRps.myHand);
  sendAction(host, { type: 'placeActive', handCardId: hostBasic.id });
  await nextOfType(hostNext, 'match');
  const guestAfterRps = await nextOfType(guestNext, 'match');
  const guestBasic = firstBasic(guestAfterRps.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestBasic.id });
  await nextOfType(guestNext, 'match');
  sendAction(host, { type: 'confirmSetup' });
  await nextOfType(hostNext, 'match');
  sendAction(guest, { type: 'confirmSetup' });
  let hostPlaying = await nextOfType(hostNext, 'match');
  while (hostPlaying.public.phase !== 'playing') { hostPlaying = await nextOfType(hostNext, 'match'); }
  const guestPlaying = await nextOfType(guestNext, 'match');

  return { host, guest, hostNext, guestNext, hostState: hostPlaying, guestState: guestPlaying };
}

async function main() {
  await new Promise((resolve) => stub.listen(8793, resolve));

  // Overgrowth (the host's deck, per IDENTITIES) carries exactly 2 copies
  // of Bill in 60 cards -- nothing in the WebSocket protocol can seed the
  // server's real Math.random() shuffle (createGame, party/index.js,
  // always calls it unseeded), so a single opening 7-card hand only has
  // roughly a 1-in-5 chance of containing it. Retrying with a FRESH room
  // code each time (a new room = a new independent shuffle) converges
  // fast: 30 independent attempts at ~22% each leaves under a 0.1% chance
  // of never finding it, which is the trade-off this makes instead of
  // trying to draw deeper into one shuffle (the deck is too large
  // relative to Bill's 2 copies for that to converge quickly either).
  let host, guest, hostNext, guestNext, hostState, guestState, bill;
  for (let attempt = 0; attempt < 30 && !bill; attempt++) {
    if (host) { host.close(); guest.close(); }
    const result = await playToTurn1('TRAINER' + attempt);
    host = result.host; guest = result.guest;
    hostNext = result.hostNext; guestNext = result.guestNext;
    hostState = result.hostState; guestState = result.guestState;
    // Host always wins RPS in this test (rock beats scissors, both sides'
    // choices are hardcoded above) -- host is always activePlayerId
    // 'player1' here, so its hand is always what needs checking.
    bill = hostState.myHand.find((c) => c.name === 'Bill');
  }
  assert.ok(bill, 'expected Bill in the host\'s opening hand within 30 independent shuffles (2/60 copies -- see comment above)');

  const activeWs = host;
  const activeNext = hostNext;
  const otherNext = guestNext;
  const activeHand = hostState.myHand;

  const beforeHandLen = activeHand.length;
  sendAction(activeWs, { type: 'playTrainer', trainerName: 'Bill', handId: bill.id, args: [] });
  const activeAfter = await nextOfType(activeNext, 'match');
  const otherAfter = await nextOfType(otherNext, 'match');
  assert.strictEqual(activeAfter.myHand.length, beforeHandLen + 1); // -1 Bill, +2 drawn
  assert.ok(activeAfter.myHand.every((c) => c.name !== undefined));
  console.log('PASS: Bill draws 2 real cards, no undefined');

  assert.strictEqual(activeAfter.public.lastTrainerPlay.cardName, 'Bill');
  assert.strictEqual(otherAfter.public.lastTrainerPlay.cardName, 'Bill');
  assert.strictEqual(otherAfter.public.lastTrainerPlay.round, activeAfter.public.lastTrainerPlay.round);
  console.log('PASS: both sides receive the same lastTrainerPlay reveal data');

  const badReqId = ++reqCounter;
  activeWs.send(JSON.stringify({ type: 'action', reqId: badReqId, action: { type: 'playTrainer', trainerName: 'Bill', handId: 'not-a-real-id', args: [] } }));
  const errMsg = await nextOfType(activeNext, 'error');
  assert.strictEqual(errMsg.reqId, badReqId);
  console.log('PASS: an illegal playTrainer is rejected with a clean error, not a crash');

  const peekReqId = sendPeek(activeWs);
  const peekResult = await nextOfType(activeNext, 'deckPeek');
  assert.strictEqual(peekResult.reqId, peekReqId);
  assert.ok(Array.isArray(peekResult.cards) && peekResult.cards.length > 0);
  assert.ok(peekResult.cards.every((c) => typeof c.name === 'string'));
  console.log('PASS: peekOwnDeck returns real deck contents to the requester');

  // The OTHER side must never receive a deckPeek for someone else's peek.
  const raced = await Promise.race([
    nextOfType(otherNext, 'deckPeek').then(() => 'leaked'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))
  ]);
  assert.strictEqual(raced, 'timeout');
  console.log('PASS: the peek is never sent to the other connection');

  host.close(); guest.close();
  stub.close();
  console.log('ALL PVP TRAINER TESTS PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Restart `partykit dev` first (kill any stale one:
`pkill -f "partykit dev"`, clear persisted state:
`rm -rf party/.partykit`), then start it pointed at this test's stub:
```bash
cd party && npx partykit dev --var RESOLVE_IDENTITY_URL=http://127.0.0.1:8793
```
Run (in another terminal, from the repo root):
```bash
node party/test/trainer.test.js
```
Expected: FAIL — `'playTrainer'` isn't a known action type yet, so the
first `sendAction` gets an `{type:'error', message:'Tipo de acción
desconocido: playTrainer'}` instead of a `'match'` message, and
`nextOfType` never resolves the way the test expects (or the test hangs
on the missing `'match'`/`'deckPeek'` response — either way, it does not
print `ALL PVP TRAINER TESTS PASSED`).

- [ ] **Step 3: Implement `playTrainer` and `peekOwnDeck`**

In `party/index.js`, add the new case to `runAction`'s switch (right
before the existing `default:` case):

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
```

`redactedFor` gains the reveal field, right alongside the existing
`hostCardBackId`/`guestCardBackId` carry-through:

```javascript
    redacted.public.hostCardBackId = this.info.hostCardBackId || 'clasico';
    redacted.public.guestCardBackId = this.info.guestCardBackId || 'clasico';
    redacted.public.lastTrainerPlay = this.lastTrainerPlay || null;
```

`onMessage` gains the `'peekOwnDeck'` branch, right after the existing
`'setReady'` branch and before the `'action'` branch:

```javascript
    if (data.type === 'peekOwnDeck') {
      const side = sender.id === this.info.hostConnId ? 'player' : 'cpu';
      const cards = this.state.players[side].deck.map((c) => ({ id: c.id, name: c.name }));
      sender.send(JSON.stringify({ type: 'deckPeek', reqId: data.reqId, cards: cards }));
      return;
    }
```

(Read-only, no `persistState()`/`broadcastMatch()` call — nothing about
match state changed.)

- [ ] **Step 4: Run it to verify it passes**

Restart the dev server (`pkill -f "partykit dev"`, `rm -rf
party/.partykit`, re-run the same `npx partykit dev --var
RESOLVE_IDENTITY_URL=...` command from Step 2), then:
```bash
node party/test/trainer.test.js
```
Expected: `ALL PVP TRAINER TESTS PASSED`.

- [ ] **Step 5: Confirm the existing test suites still pass**

Restart the dev server once more (fresh state), then run both:
```bash
node party/test/room.test.js
node party/test/match.test.js
```
(Each needs the dev server started with its own matching
`RESOLVE_IDENTITY_URL` — `8791` for `room.test.js`, `8792` for
`match.test.js` — restart between them, same as this plan's earlier
migration required.)
Expected: both still print their own `ALL ... TESTS PASSED`.

Run: `node run-tests.js`
Expected: 739/739 PASS.

- [ ] **Step 6: Commit**

```bash
git add party/index.js party/test/trainer.test.js
git commit -m "Add playTrainer action and peekOwnDeck to the PartyKit room"
```

---

### Task 3: `peekOwnDeckCloud` in `economy.js`

**Files:**
- Modify: `economy.js`

**Interfaces:**
- Consumes: `pvpSocket`, `pvpPendingActions`, `pvpReqCounter`,
  `dispatchPvpMessage` (all existing, from the PartyKit migration).
- Produces: `peekOwnDeckCloud()` → `Promise<Array<{id, name}>>`, resolving
  with the real deck cards `party/index.js`'s new `'deckPeek'` response
  carries. Task 4's `ui.js` calls this directly for the 3 deck-searching
  cards.

- [ ] **Step 1: Add the new dispatch branch**

In `economy.js`'s `dispatchPvpMessage`, add a `'deckPeek'` branch
alongside the existing `'ack'`/`'error'` ones (same
`pvpPendingActions[reqId]` correlation pattern):

```javascript
  if (data.type === 'deckPeek') {
    var pendingPeek = pvpPendingActions[data.reqId];
    if (pendingPeek) { delete pvpPendingActions[data.reqId]; pendingPeek.resolve(data.cards); }
    return;
  }
```

- [ ] **Step 2: Add `peekOwnDeckCloud`**

Right after `submitMatchActionCloud`:

```javascript
function peekOwnDeckCloud() {
  return new Promise(function (resolve, reject) {
    var reqId = ++pvpReqCounter;
    pvpPendingActions[reqId] = { resolve: resolve, reject: reject };
    pvpSocket.send(JSON.stringify({ type: 'peekOwnDeck', reqId: reqId }));
  });
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check economy.js`
Expected: OK.

- [ ] **Step 4: Verify nothing else broke**

Run: `node run-tests.js`
Expected: 739/739 PASS (this task never touches `rules-engine.js` or any
local-play code path).

- [ ] **Step 5: Commit**

```bash
git add economy.js
git commit -m "Add peekOwnDeckCloud to the PVP client transport"
```

---

### Task 4: Wire real Trainer-card play into `ui.js`

**Files:**
- Modify: `ui.js`

**Interfaces:**
- Consumes: `submitMatchActionCloud` (existing), `peekOwnDeckCloud`
  (Task 3), `pvpMode`/`pvpActiveMatchId`/`pvpMySide` (existing globals).
- Produces: `applyOrSubmitTrainerEffect(trainerName, handId, args)` — the
  one new shared helper every Trainer-card call site routes through.

This is the largest task: 15 existing `TRAINER_EFFECTS[name](gameState,
'player', ...)` call sites get replaced with calls to one new shared
helper, the early PVP block is removed, and a `pvpTrainerReveal*` gate
(mirroring the existing `pvpRpsReveal*` one) is added.

- [ ] **Step 1: Remove the early block**

Delete this whole block (currently right after `if (stats.supertype ===
'Trainer') {`):

```javascript
        // Real reported bug: this whole block runs straight against the
        // local `gameState` (TRAINER_EFFECTS mutates it directly) with no
        // pvpMode check at all -- in a real PVP match `gameState` is a
        // reconstructed snapshot whose own deck array is just placeholder
        // {} objects (its real order is never sent client-side, see
        // buildPvpGameState), so "drawing" from it produced literal
        // undefined cards, and since nothing here ever calls
        // submitMatchActionCloud, the server (and the rival) never found
        // out the card was played at all. Trainer cards were always
        // out of scope for PVP (same as special-effect attacks, which
        // already get an equivalent server-side rejection) -- this just
        // stops the client from ever pretending otherwise. Real support
        // is a separate, larger project (porting TRAINER_EFFECTS
        // server-side to party/index.js), not a quick fix.
        if (pvpMode) {
          alert('Los Entrenadores todavía no están disponibles en el PVP.');
          return;
        }
```

- [ ] **Step 2: Add the shared helper**

Right before the `handButtons.forEach(function (btn) {` block (so it's
in scope for every call site inside it):

```javascript
  // Every TRAINER_EFFECTS[name] function shares rules-engine.js's
  // (state, playerId, handId, ...args) shape and already validates
  // legality before mutating (see card-effects.js) -- in PVP that exact
  // same call just needs to happen on the SERVER's real state instead of
  // this client's reconstructed one, which is why this can be one
  // generic helper instead of a bespoke branch per card. Every one of
  // this file's ~15 Trainer-card call sites routes through this.
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

- [ ] **Step 3: Replace the 6 no-target call sites**

Change:
```javascript
          if (isNoTargetTrainer) {
            var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', handId);
            if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
            selectedHandId = null;
            renderBoard();
          } else if (handCard.name === 'Computer Search') {
```
to:
```javascript
          if (isNoTargetTrainer) {
            applyOrSubmitTrainerEffect(handCard.name, handId, []);
          } else if (handCard.name === 'Computer Search') {
```

- [ ] **Step 4: Wire Computer Search's peek + replace its call site**

Change:
```javascript
            openHandDiscardModal(otherHandCards, 2, function (discardHandIds) {
              openDeckSearchModal(p.deck.slice(), function (deckCardId) {
                var result = TRAINER_EFFECTS['Computer Search'](gameState, 'player', handId, deckCardId, discardHandIds);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
            });
```
to:
```javascript
            openHandDiscardModal(otherHandCards, 2, function (discardHandIds) {
              (pvpMode ? peekOwnDeckCloud() : Promise.resolve(p.deck.slice())).then(function (deckCards) {
                openDeckSearchModal(deckCards, function (deckCardId) {
                  applyOrSubmitTrainerEffect('Computer Search', handId, [deckCardId, discardHandIds]);
                });
              }).catch(function (err) { alert(err.message || 'No se pudo consultar el mazo.'); });
            });
```

- [ ] **Step 5: Replace Energy Retrieval's call site**

Change:
```javascript
              openEnergyRetrievalModal(basicEnergyInDiscard, function (retrieveIds) {
                var result = TRAINER_EFFECTS['Energy Retrieval'](gameState, 'player', handId, tradeIds[0], retrieveIds);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
```
to:
```javascript
              openEnergyRetrievalModal(basicEnergyInDiscard, function (retrieveIds) {
                applyOrSubmitTrainerEffect('Energy Retrieval', handId, [tradeIds[0], retrieveIds]);
              });
```

- [ ] **Step 6: Replace Item Finder's call site**

Change:
```javascript
              openDeckSearchModal(trainersInDiscard, function (discardCardId) {
                var result = TRAINER_EFFECTS['Item Finder'](gameState, 'player', handId, discardHandIds, discardCardId);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
```
to:
```javascript
              openDeckSearchModal(trainersInDiscard, function (discardCardId) {
                applyOrSubmitTrainerEffect('Item Finder', handId, [discardHandIds, discardCardId]);
              });
```

(`trainersInDiscard` is the player's own discard pile — already fully
known client-side in PVP, same as `p.hand`, no peek needed.)

- [ ] **Step 7: Replace Maintenance's call site**

Change:
```javascript
            openHandDiscardModal(otherHandCardsForMaintenance, 2, function (shuffleHandIds) {
              var result = TRAINER_EFFECTS['Maintenance'](gameState, 'player', handId, shuffleHandIds);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
```
to:
```javascript
            openHandDiscardModal(otherHandCardsForMaintenance, 2, function (shuffleHandIds) {
              applyOrSubmitTrainerEffect('Maintenance', handId, [shuffleHandIds]);
            });
```

- [ ] **Step 8: Wire Pokémon Trader's peek + replace its call site**

Change:
```javascript
            openDeckSearchModal(pokemonInHandForTrader, function (tradeHandId) {
              var pokemonInDeck = p.deck.filter(function (c) { return CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Pokémon'; });
              openDeckSearchModal(pokemonInDeck, function (deckCardId) {
                var result = TRAINER_EFFECTS['Pokémon Trader'](gameState, 'player', handId, tradeHandId, deckCardId);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
            });
```
to:
```javascript
            openDeckSearchModal(pokemonInHandForTrader, function (tradeHandId) {
              (pvpMode ? peekOwnDeckCloud() : Promise.resolve(p.deck.slice())).then(function (deckCards) {
                var pokemonInDeck = deckCards.filter(function (c) { return CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Pokémon'; });
                openDeckSearchModal(pokemonInDeck, function (deckCardId) {
                  applyOrSubmitTrainerEffect('Pokémon Trader', handId, [tradeHandId, deckCardId]);
                });
              }).catch(function (err) { alert(err.message || 'No se pudo consultar el mazo.'); });
            });
```

(`CARD_STATS` is already a client-global data table, not PVP-hidden data
— filtering peeked `{id, name}` cards by it works identically to
filtering `p.deck` today.)

- [ ] **Step 9: Replace Pokémon Flute's call site**

Change:
```javascript
            openDeckSearchModal(opBasicsInDiscard, function (opponentDiscardCardId) {
              var result = TRAINER_EFFECTS['Pokémon Flute'](gameState, 'player', handId, opponentDiscardCardId);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
```
to:
```javascript
            openDeckSearchModal(opBasicsInDiscard, function (opponentDiscardCardId) {
              applyOrSubmitTrainerEffect('Pokémon Flute', handId, [opponentDiscardCardId]);
            });
```

(The opponent's discard pile is already fully public in PVP — it's part
of the normal redacted board state, no peek needed.)

- [ ] **Step 10: Replace Revive's call site**

Change:
```javascript
            openDeckSearchModal(basicsInOwnDiscard, function (discardCardId) {
              var result = TRAINER_EFFECTS['Revive'](gameState, 'player', handId, discardCardId);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
```
to:
```javascript
            openDeckSearchModal(basicsInOwnDiscard, function (discardCardId) {
              applyOrSubmitTrainerEffect('Revive', handId, [discardCardId]);
            });
```

- [ ] **Step 11: Wire Pokédex's peek + replace its call site**

Change:
```javascript
          } else if (handCard.name === 'Pokédex') {
            var topOfDeck = p.deck.slice(0, Math.min(5, p.deck.length));
            openPokedexModal(topOfDeck, function (orderedIds) {
              var result = TRAINER_EFFECTS['Pokédex'](gameState, 'player', handId, orderedIds);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
```
to:
```javascript
          } else if (handCard.name === 'Pokédex') {
            (pvpMode ? peekOwnDeckCloud() : Promise.resolve(p.deck.slice())).then(function (deckCards) {
              var topOfDeck = deckCards.slice(0, Math.min(5, deckCards.length));
              openPokedexModal(topOfDeck, function (orderedIds) {
                applyOrSubmitTrainerEffect('Pokédex', handId, [orderedIds]);
              });
            }).catch(function (err) { alert(err.message || 'No se pudo consultar el mazo.'); });
```

- [ ] **Step 12: Update the now-stale comment above the single-target fallback**

The `else` branch right after Step 11's block (the one arming
`selectedHandId` for a later board click) currently has no PVP-specific
comment of its own to update — leave its code exactly as-is; Steps 13-16
below are what actually complete those flows once a board Pokémon is
clicked.

- [ ] **Step 13: Replace Pokémon Breeder's board-click completion**

In the board-click handler (`document.querySelectorAll('.shell-board-bench-card,
.shell-board-active-card').forEach(...)`), change:

```javascript
      if (pendingPokemonBreeder) {
        var pb = pendingPokemonBreeder;
        pendingPokemonBreeder = null;
        var breederResult = TRAINER_EFFECTS['Pokémon Breeder'](gameState, 'player', pb.handId, pb.evolutionHandId, instanceId);
        if (breederResult && !breederResult.legal) { logEvent(gameState, breederResult.reason, 'player'); }
        selectedHandId = null;
        renderBoard();
        return;
      }
```
to:
```javascript
      if (pendingPokemonBreeder) {
        var pb = pendingPokemonBreeder;
        pendingPokemonBreeder = null;
        applyOrSubmitTrainerEffect('Pokémon Breeder', pb.handId, [pb.evolutionHandId, instanceId]);
        return;
      }
```

- [ ] **Step 14: Update the stale "Trainer cards stay unguarded" comment**

Right before the existing `if (pvpMode) { var pvpBoardClickAction = null;
...` block in this same handler, change:

```javascript
      // C2 (final-review fix): this click-to-select-then-click-target
      // fallback for placeBench/evolve/attachEnergy bypassed the server
      // entirely in PVP -- only the drag-and-drop equivalent (resolveHandDrop)
      // was guarded. Only intercept+return when one of these 3 vanilla
      // actions actually matches -- anything else (Trainer-card effects)
      // falls through to the existing logic below unchanged, since Trainer
      // cards stay an accepted, unguarded Fase-2-scope gap in PVP (same as
      // every other Trainer-effect path in this file), not something this
      // finding asked to fix.
```
to:
```javascript
      // C2 (final-review fix, historical): this click-to-select-then-
      // click-target fallback for placeBench/evolve/attachEnergy bypassed
      // the server entirely in PVP -- only the drag-and-drop equivalent
      // (resolveHandDrop) was guarded. Only intercept+return when one of
      // these 3 vanilla actions actually matches -- Trainer-card effects
      // (Super Potion, Energy Removal, Super Energy Removal, and the
      // generic single-target fallback below) now route through
      // applyOrSubmitTrainerEffect themselves, each at their own call
      // site further down, so nothing about THIS specific pvpMode check
      // needs to also handle them.
```

- [ ] **Step 15: Replace Super Potion's board-click completion**

Change:
```javascript
        openEnergyDiscardModal(superPotionTarget.attachedEnergy.slice(), 1, function (indices) {
          var result = TRAINER_EFFECTS['Super Potion'](gameState, 'player', superPotionHandId, instanceId, indices[0]);
          if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
          renderBoard();
        });
        return;
```
(the one inside the `else if (superPotionTarget && ...)` branch) to:
```javascript
        openEnergyDiscardModal(superPotionTarget.attachedEnergy.slice(), 1, function (indices) {
          applyOrSubmitTrainerEffect('Super Potion', superPotionHandId, [instanceId, indices[0]]);
        });
        return;
```

- [ ] **Step 16: Replace Energy Removal's board-click completion**

Change:
```javascript
        openEnergyDiscardModal(energyRemovalTarget.attachedEnergy.slice(), 1, function (indices) {
          var result = TRAINER_EFFECTS['Energy Removal'](gameState, 'player', energyRemovalHandId, instanceId, indices[0]);
          if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
          renderBoard();
        });
        return;
```
(the one inside the `else if (energyRemovalTarget && ...)` branch) to:
```javascript
        openEnergyDiscardModal(energyRemovalTarget.attachedEnergy.slice(), 1, function (indices) {
          applyOrSubmitTrainerEffect('Energy Removal', energyRemovalHandId, [instanceId, indices[0]]);
        });
        return;
```

- [ ] **Step 17: Replace Super Energy Removal's two board-click completions**

Change:
```javascript
          openEnergyDiscardModal(cpuTarget.attachedEnergy.slice(), countToDiscard, function (indices) {
            var removalResult = TRAINER_EFFECTS['Super Energy Removal'](gameState, 'player', pendingRemoval.handId, pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex, indices);
            if (removalResult && !removalResult.legal) { logEvent(gameState, removalResult.reason, 'player'); }
            renderBoard();
          });
          return;
        } else {
          var removalResult = TRAINER_EFFECTS['Super Energy Removal'](gameState, 'player', pendingRemoval.handId, pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex, [0]);
          if (removalResult && !removalResult.legal) { logEvent(gameState, removalResult.reason, 'player'); }
        }
```
to:
```javascript
          openEnergyDiscardModal(cpuTarget.attachedEnergy.slice(), countToDiscard, function (indices) {
            applyOrSubmitTrainerEffect('Super Energy Removal', pendingRemoval.handId, [pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex, indices]);
          });
          return;
        } else {
          applyOrSubmitTrainerEffect('Super Energy Removal', pendingRemoval.handId, [pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex, [0]]);
        }
```

- [ ] **Step 18: Replace the generic single-target fallback's call site**

Change:
```javascript
      } else if (TRAINER_EFFECTS[handCard.name]) {
        var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', selectedHandId, instanceId);
        if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
      }
      selectedHandId = null;
      renderBoard();
    });
```
to:
```javascript
      } else if (TRAINER_EFFECTS[handCard.name]) {
        applyOrSubmitTrainerEffect(handCard.name, selectedHandId, [instanceId]);
        return;
      }
      selectedHandId = null;
      renderBoard();
    });
```

(This one needs an explicit `return` where the others in this same
handler already have one implicitly via their own early returns —
without it, `applyOrSubmitTrainerEffect`'s own `selectedHandId =
null; renderBoard();` for the local-play path would run, then this outer
scope would ALSO immediately re-run `selectedHandId = null; renderBoard();`
right after — harmless but redundant; the `return` keeps this call site
consistent with the others in this same handler, all of which already
`return` right after their own modal-opening call.)

- [ ] **Step 19: Add the trainer-reveal gate**

Add the new state right next to the existing `pvpRpsRevealedRound`/
`pvpRpsRevealTimer`/`pvpRpsLatestMatchData` declarations:

```javascript
// Sibling to the RPS-reveal gate above, same shape -- lastTrainerPlay.round
// (party/index.js) increments every successful playTrainer action; this
// tracks the last round already shown so a re-delivered snapshot (e.g. on
// reconnect) never replays a reveal that already happened.
var pvpTrainerRevealedRound = 0;
```

In `enterPvpMatch`'s listener callback, add the gate right after the
existing RPS-reveal block (`if (pub.rpsLastResult && pub.rpsRound >
pvpRpsRevealedRound) { ... return; }` / `if (pvpRpsRevealTimer) {
return; }`) and before the `pvpEndTurnConfirmPending` check:

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
```

(Reuses `pvpRpsLatestMatchData` — already kept up to date by the very
top of this same callback, `pvpRpsLatestMatchData = data;`, regardless of
which gate below it ends up firing — as the "apply once the reveal
finishes" payload, exactly the same way the RPS gate already does.
`showTrainerPlayedOverlay` (unmodified, `ui.js`) owns its own ~1.5s
hold+fade timing internally and calls `onDone` once, so no separate
`setTimeout` is needed here the way the RPS gate uses one.)

- [ ] **Step 20: Reset the new state on match entry/exit**

In `enterPvpMatch`, alongside the existing `pvpRpsRevealedRound = 0;`
line, add: `pvpTrainerRevealedRound = 0;`

In `resetPvpMatchState`, alongside the existing `pvpRpsRevealedRound =
0;` line, add: `pvpTrainerRevealedRound = 0;`

- [ ] **Step 21: Verify syntax and the untouched suite**

Run: `node --check ui.js`
Expected: OK.

Run: `node run-tests.js`
Expected: 739/739 PASS (this task never touches `rules-engine.js`).

- [ ] **Step 22: Commit**

```bash
git add ui.js
git commit -m "Wire real Trainer-card play into the PVP client"
```

---

### Task 5: Deploy and smoke-test end to end

**Files:** none (operational task)

- [ ] **Step 1: Deploy the PartyKit project**

```bash
cd party && npx partykit deploy
```
Expected: `Deployed ./index.js to https://tcg-simulador-pvp.hugoandri.partykit.dev`
(same host as before — this task only changes `party/index.js`'s
content, not its deployment target).

- [ ] **Step 2: Deploy hosting**

```bash
firebase deploy --project default --only hosting
```
Expected: `Deploy complete!` (no Cloud Functions or Firestore rules
changed by this plan, so `--only hosting` is sufficient — unlike the
PartyKit migration, this plan never touches `functions/` or
`firestore.rules`).

- [ ] **Step 3: Manual end-to-end smoke test**

Two browser sessions, same setup as the PartyKit migration's own smoke
test (two accounts, one creates a room, the other joins, both ready up,
place Actives, confirm setup):

1. Once in the `'playing'` phase, whoever's turn it is plays a no-target
   Trainer card (Bill or Professor Oak) — confirm BOTH sessions see the
   full-screen reveal, and the acting side's hand updates with real card
   names (not "undefined").
2. Play a single-target Trainer (Potion, if either side has a damaged
   Pokémon, or PlusPower otherwise) — confirm the board-click flow works
   identically to local-vs-CPU play, and both sides see the reveal.
3. Play Computer Search or Pokémon Trader — confirm the deck-search modal
   shows real card names/art (not blank/undefined), and that the reveal
   on BOTH sides shows which card was found (the "→ sale X" line).
4. Play Pokédex — confirm the top-5 reorder modal shows real cards, and
   that reordering actually changes draw order on subsequent turns.
5. Try an illegal play (e.g. clicking "USAR" on a Trainer with no valid
   target available) — confirm it fails cleanly with a message, not a
   crash or a silently-corrupted hand.

- [ ] **Step 4: No commit needed**

This task is deploy + manual verification only — Tasks 1-4's commits are
already the complete, reviewed change; nothing new to commit here unless
the smoke test surfaces a real bug, in which case fix it the same way the
PartyKit migration's own Task 8 handled its smoke-test findings (fix,
re-verify, redeploy, new commit).

---

## Self-Review Notes

- **Spec coverage:** Section 4 (architecture) → Task 2. Section 5 (client
  wiring) → Task 4, Steps 1-18. Section 6 (reveal, including the
  `targetName` fix) → Task 1 + Task 4 Steps 19-20. Section 7 (testing) →
  each task's own test steps + Task 5's manual smoke test. Section 3
  (Non-Goals: Pokémon Powers/attacks stay rejected, no UI redesign) —
  nothing in this plan touches `habilidadBtn`'s guard or any modal's
  markup, confirmed by Task 4's steps only ever changing which function a
  callback invokes, never a modal's own structure.
- **Type/shape consistency:** `{type:'playTrainer', trainerName, handId,
  args}` (Task 2's `runAction` case) matches exactly what
  `applyOrSubmitTrainerEffect` (Task 4) sends. `{type:'peekOwnDeck',
  reqId}` → `{type:'deckPeek', reqId, cards}` (Task 2) matches exactly
  what `peekOwnDeckCloud` (Task 3) sends/expects. `lastTrainerPlay:
  {side, cardName, targetName, round}` (Task 2) matches exactly what
  Task 4 Step 19's reveal gate reads.
- **No placeholders:** every step shows the real before/after code for
  its exact call site, taken directly from this worktree's current
  `ui.js`/`party/index.js`/`economy.js`/`card-effects.js` — none of it is
  illustrative pseudocode.
