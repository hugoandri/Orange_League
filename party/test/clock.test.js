const assert = require('assert');
const http = require('http');

// clock-token's deck doesn't matter for these scenarios -- overgrowth is
// used purely because it's the same precon every other test file already
// uses, no customDeckCards needed here. testTimeBankMs is the only thing
// that matters: honored by party/index.js's onConnect (this task's own
// change), it overrides the real 10-minute DEFAULT_TIME_BANK_MS so the
// timeout scenario doesn't need to wait 10 real minutes.
const IDENTITIES = {
  'clock-host-token': { uid: 'clock-host-uid', username: 'ClockHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'clock-guest-token': { uid: 'clock-guest-uid', username: 'ClockGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'timeout-host-token': { uid: 'timeout-host-uid', username: 'TimeoutHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, testTimeBankMs: 300, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'timeout-guest-token': { uid: 'timeout-guest-uid', username: 'TimeoutGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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

async function testTimeBankVisibleAndCommitted() {
  const { host, guest, hostNext, guestNext, hostState, guestState } = await playToTurn1('CLOCK1', 'clock-host-token', 'clock-guest-token');

  // Host (RPS winner) always goes first -- their full time bank is still
  // untouched (nothing committed yet), the guest's is too.
  assert.strictEqual(hostState.public.timeBank.player1, 10 * 60 * 1000);
  assert.strictEqual(hostState.public.timeBank.player2, 10 * 60 * 1000);
  assert.strictEqual(guestState.public.timeBank.player1, 10 * 60 * 1000);
  assert.ok(hostState.public.turnStartedAt, 'expected turnStartedAt to be set once the match starts');
  assert.strictEqual(hostState.public.turnStartedAt, guestState.public.turnStartedAt, 'both sides must see the exact same turnStartedAt');
  console.log('PASS: both sides receive timeBank and turnStartedAt, both sides\' banks start full');

  await new Promise((resolve) => setTimeout(resolve, 300)); // let some real time genuinely pass
  sendAction(host, { type: 'endTurn' });
  const afterEndTurn = await nextOfType(hostNext, 'match');
  assert.ok(afterEndTurn.public.timeBank.player1 < 10 * 60 * 1000, 'expected the host\'s banked time to have actually decreased after ending their turn');
  assert.ok(afterEndTurn.public.timeBank.player1 >= 10 * 60 * 1000 - 2000, 'expected only a couple hundred ms to have been spent, not a huge chunk (sanity bound)');
  assert.strictEqual(afterEndTurn.public.timeBank.player2, 10 * 60 * 1000, 'the guest\'s own banked time must be completely untouched by the host\'s turn ending');
  assert.notStrictEqual(afterEndTurn.public.turnStartedAt, hostState.public.turnStartedAt, 'turnStartedAt must reset for the new active side');
  console.log('PASS: ending a turn commits real elapsed time into the ending side\'s own banked time only, and resets turnStartedAt');

  host.close(); guest.close();
}

async function testTimeoutEndsTheMatch() {
  const { host, guest, hostNext, guestNext } = await playToTurn1('CLOCK2', 'timeout-host-token', 'timeout-guest-token');
  // timeout-host-token started with a 300ms time bank (testTimeBankMs) --
  // host is always the RPS winner/first active player in this test setup,
  // so their clock is the one already ticking.
  await new Promise((resolve) => setTimeout(resolve, 400)); // safely past the 300ms bank

  // Nobody has sent anything since the match started -- exactly the "both
  // clients silent" gap the design calls out. The guest's own client
  // (whose local countdown for the HOST's side would also have reached
  // zero) is what sends this in real use; simulated directly here.
  sendAction(guest, { type: 'claimTimeout' });
  const afterClaim = await nextOfType(guestNext, 'match');
  assert.strictEqual(afterClaim.public.winner, 'player2', 'expected the guest (whose opponent ran out of time) to be declared the winner');
  assert.strictEqual(afterClaim.public.timeBank.player1, 0, 'expected the host\'s time bank to be reported as fully exhausted');
  console.log('PASS: claimTimeout correctly ends the match once a side\'s real elapsed time exceeds their banked time');

  host.close(); guest.close();
}

async function main() {
  await new Promise((resolve) => stub.listen(8795, resolve));
  await testTimeBankVisibleAndCommitted();
  await testTimeoutEndsTheMatch();
  stub.close();
  console.log('ALL PVP CLOCK (PartyKit) TESTS PASSED');
  // Same Node-native-WebSocket-vs-workerd hang as every other test file in
  // this directory -- see room.test.js's own comment for the full
  // diagnosis. All assertions above have already run by this point.
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
