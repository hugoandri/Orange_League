const assert = require('assert');
const http = require('http');
// Brief-code fix: dealOpeningHand (rules-engine.js) only guarantees the
// dealt hand CONTAINS at least one Basic Pokemon somewhere (that's what
// the mulligan loop checks) -- it never guarantees hand[0] specifically
// is one. The brief's own test blindly used myHand[0].id for placeActive,
// which is genuinely flaky: on a real run the shuffled hand's first card
// is often an Energy/Trainer/evolution card, and canPlayBasic legitimately
// (and correctly) rejects it, hanging the test on a nextMatchMessage that
// never arrives (the 'error' response goes to a listener that only
// resolves on {type:'match'}). Reproduced this directly against the local
// dev server before applying this fix. CARD_STATS is the same table
// rules-engine.js's own isBasicPokemon (line ~22) checks against.
const { CARD_STATS } = require('../../data-cards.js');
function findBasicId(hand) {
  const card = hand.find((c) => {
    const stats = CARD_STATS[c.name];
    return !!stats && stats.supertype === 'Pokémon' && !stats.evolvesFrom;
  });
  assert.ok(card, 'hand should contain at least one Basic Pokemon (mulligan guarantee)');
  return card.id;
}

const IDENTITIES = {
  'host-token': { uid: 'host-uid', username: 'Host', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'guest-token': { uid: 'guest-uid', username: 'Guest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'protector_messi', collectionHolo: {}, collectionSecret: {} }
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

// Brief-code fix: the brief's original nextMessage/nextMatchMessage
// registered a fresh one-shot 'message' listener on every await, removing
// it as soon as it resolved. That's a real race against this test's own
// later steps, which fire TWO actions back-to-back (e.g. both sides'
// submitRpsChoice) before awaiting again -- if the corresponding broadcast
// arrives in the window between one listener resolving/removing and the
// next await registering a new one, that message is silently dropped
// forever, since nothing is listening at the instant it arrives. Confirmed
// this directly against the local dev server: the host's RPS-resolution
// loop sometimes captured only the first of two match broadcasts and hung
// forever waiting for a second that had already arrived and been missed
// (party/index.js's own state transitions were correct in every
// repro -- this is purely a client-side listener-timing bug). Fixed by
// attaching ONE persistent listener per socket at connect() time that
// queues every incoming message, with nextMessage/nextMatchMessage pulling
// (or waiting on) that queue instead of racing to attach in time.
function connect(room, token, intent) {
  const ws = new WebSocket('ws://127.0.0.1:1999/parties/main/' + room +
    '?token=' + token + '&deckId=x&cardBackId=clasico&intent=' + intent);
  ws._queue = [];
  ws._waiters = [];
  ws.addEventListener('message', function (e) {
    const data = JSON.parse(e.data);
    if (ws._waiters.length) { ws._waiters.shift()(data); }
    else { ws._queue.push(data); }
  });
  return ws;
}
function nextMessage(ws) {
  return new Promise((resolve) => {
    if (ws._queue.length) { resolve(ws._queue.shift()); return; }
    ws._waiters.push(resolve);
  });
}
async function nextMatchMessage(ws) {
  while (true) {
    const data = await nextMessage(ws);
    if (data.type === 'match') { return data; }
  }
}
// Brief-code fix: broadcastMatch() fans a 'match' broadcast out to BOTH
// sockets on every successful action, not just the sender's own -- so a
// socket that never sent the action a given assertion cares about can
// still have unrelated 'match' broadcasts queued ahead of the specific
// ack/error response that action produced (e.g. host's own confirmSetup
// broadcasts an intermediate 'match' to guest too, even though guest never
// asked for it). Rather than hand-count exactly how many stray messages to
// drain at each step (fragile, and easy to get wrong -- see this file's
// git history for a first attempt that was), filter directly by reqId,
// which only ever appears on the 'ack'/'error' response to that specific
// action -- skipping any number of unrelated 'match'/'room' messages ahead
// of it.
async function nextReqResult(ws, reqId) {
  while (true) {
    const data = await nextMessage(ws);
    if (data.reqId === reqId) { return data; }
  }
}
let reqCounter = 0;
function sendAction(ws, action) {
  const reqId = ++reqCounter;
  ws.send(JSON.stringify({ type: 'action', reqId: reqId, action: action }));
  return reqId;
}

async function main() {
  await new Promise((resolve) => stub.listen(8792, resolve));
  const roomCode = 'MATCH01';
  const host = connect(roomCode, 'host-token', 'create');
  await nextMessage(host); // room, waiting
  const guest = connect(roomCode, 'guest-token', 'join');
  await nextMessage(host); await nextMessage(guest); // room, guest joined

  host.send(JSON.stringify({ type: 'setReady' }));
  await nextMessage(host);
  guest.send(JSON.stringify({ type: 'setReady' }));
  const hostMatch1 = await nextMatchMessage(host);
  const guestMatch1 = await nextMatchMessage(guest);
  assert.strictEqual(hostMatch1.public.phase, 'rps');
  assert.strictEqual(guestMatch1.public.phase, 'rps');
  console.log('PASS: both sides readying up starts the match in rps phase');

  // Real reported bug: redactedFor forgot to carry hostCardBackId/
  // guestCardBackId through into the match-phase payload (only the
  // room-phase payload never needed them in the first place, since the
  // opponent's real protector is a match-lifetime concept) -- neither
  // side ever saw the other's real equipped protector as a result.
  assert.strictEqual(hostMatch1.public.hostCardBackId, 'clasico');
  assert.strictEqual(hostMatch1.public.guestCardBackId, 'protector_messi');
  assert.strictEqual(guestMatch1.public.guestCardBackId, 'protector_messi');
  console.log('PASS: hostCardBackId/guestCardBackId reach both sides in the match payload');

  // Brief-code fix: checking whether the guest's hand[0] card NAME appears
  // anywhere in the host's payload is unsound -- card names aren't unique
  // per instance (e.g. "Water Energy"/"Fighting Energy" appear in both the
  // 'overgrowth' and 'blackout' precon decks), so this could spuriously
  // fail whenever the host's OWN hand happens to contain a card with the
  // same name as the guest's, which isn't a leak at all. Reproduced this
  // directly (both decks do share generic Energy names). Instance IDs
  // (rules-engine.js's nextId(), a single monotonic counter shared across
  // both decks) are actually unique per card instance game-wide, so
  // checking for the guest's real hand card's ID is the sound version of
  // this same check.
  assert.ok(!JSON.stringify(hostMatch1).includes('"' + guestMatch1.myHand[0].id + '"'));
  console.log('PASS: the host\'s payload never contains the guest\'s real hand card names');

  sendAction(host, { type: 'submitRpsChoice', choice: 'rock' });
  sendAction(guest, { type: 'submitRpsChoice', choice: 'scissors' });
  let hostMatch2 = await nextMatchMessage(host);
  while (hostMatch2.public.phase === 'rps' && !hostMatch2.public.rpsLastResult) { hostMatch2 = await nextMatchMessage(host); }
  assert.strictEqual(hostMatch2.public.phase, 'setup');
  assert.strictEqual(hostMatch2.public.rpsLastResult.winner, 'player1');
  console.log('PASS: rock beats scissors -- host (player1) is recorded as the RPS winner, phase moves to setup');

  const hostHandCardId = findBasicId(hostMatch2.myHand);
  sendAction(host, { type: 'placeActive', handCardId: hostHandCardId });
  const hostMatch3 = await nextMatchMessage(host);
  assert.ok(hostMatch3.public.board.player1.active);
  console.log('PASS: placeActive puts the named card onto the board');

  const guestHandCardId = findBasicId(guestMatch1.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestHandCardId });
  await nextMatchMessage(guest);
  sendAction(host, { type: 'confirmSetup' });
  await nextMatchMessage(host);
  const guestConfirmReqId = sendAction(guest, { type: 'confirmSetup' });
  await nextReqResult(guest, guestConfirmReqId); // drain guest's own ack for this action
  let hostMatch4 = await nextMatchMessage(host);
  while (hostMatch4.public.phase !== 'playing') { hostMatch4 = await nextMatchMessage(host); }
  assert.strictEqual(hostMatch4.public.activePlayerId, 'player1');
  console.log('PASS: confirmSetup from both sides starts the match -- host (RPS winner) goes first');

  const badReqId = sendAction(guest, { type: 'endTurn' });
  const guestErr = await nextReqResult(guest, badReqId);
  assert.strictEqual(guestErr.type, 'error');
  assert.strictEqual(guestErr.reqId, badReqId);
  console.log('PASS: an out-of-turn action is rejected with the matching reqId');

  host.close(); guest.close();
  stub.close();
  console.log('ALL PVP MATCH (PartyKit) TESTS PASSED');
  // Same Node-native-WebSocket-vs-workerd hang as room.test.js (Task 4) --
  // see that file's comment for the full diagnosis. All assertions above
  // have already run by this point.
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
