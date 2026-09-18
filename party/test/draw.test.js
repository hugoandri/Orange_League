const assert = require('assert');
const http = require('http');

// Real reported bug (severe): the host stopped drawing cards at the start
// of their own turns partway through a PVP match, while the guest kept
// drawing fine. Root cause: runAction's turn-start-draw compensation
// (party/index.js) excluded the 'player' engine slot -- and since
// redactMatchState's mapping is FIXED (host is always engine slot
// 'player'), nothing else ever drew for the host past turn 1.
const IDENTITIES = {
  'draw-host-token': { uid: 'draw-host-uid', username: 'DrawHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'draw-guest-token': { uid: 'draw-guest-uid', username: 'DrawGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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

async function testBothSidesKeepDrawingAcrossMultipleTurns() {
  const { host, guest, hostNext, guestNext, hostState, guestState } = await playToTurn1('DRAW2', 'draw-host-token', 'draw-guest-token');

  // Host (RPS winner) goes first -- their hand already includes turn 1's
  // draw (rules-engine.js's startMatch draws for whoever's active on turn
  // 1 unconditionally, so this isn't the part that was ever broken).
  const hostHandAfterTurn1Draw = hostState.myHand.length;

  // Turn 1 -> 2: host ends their turn, guest becomes active. The guest's
  // own compensation draw was NEVER broken (only 'player' was excluded) --
  // sanity-checked here so a future regression on the guest's side would
  // also be caught by this same test.
  sendAction(host, { type: 'endTurn' });
  const guestAfterOwnTurnStart = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestAfterOwnTurnStart.public.activePlayerId, 'player2', 'expected the guest to be active for turn 2');
  assert.strictEqual(guestAfterOwnTurnStart.myHand.length, guestState.myHand.length + 1, 'expected the guest to have drawn 1 card at the start of turn 2');
  await nextOfType(hostNext, 'match'); // drain the host's own copy of this same broadcast
  console.log('PASS: the guest still draws correctly at the start of their own turn (no regression)');

  // Turn 2 -> 3: guest ends their turn, HOST becomes active again. This is
  // the exact turn the reported bug silenced -- before the fix, the host's
  // hand would stay flat here instead of growing by 1.
  sendAction(guest, { type: 'endTurn' });
  const hostAfterTurn3Start = await nextOfType(hostNext, 'match');
  assert.strictEqual(hostAfterTurn3Start.public.activePlayerId, 'player1', 'expected the host to be active again for turn 3');
  assert.strictEqual(hostAfterTurn3Start.myHand.length, hostHandAfterTurn1Draw + 1, 'expected the host to have drawn 1 card at the start of turn 3 -- this is the exact case the reported bug silenced');
  console.log('PASS: the host now draws correctly at the start of their SECOND turn (turn 3) -- the reported bug is fixed');

  host.close(); guest.close();
}

async function main() {
  await new Promise((resolve) => stub.listen(8797, resolve));
  await testBothSidesKeepDrawingAcrossMultipleTurns();
  stub.close();
  console.log('ALL PVP DRAW-COMPENSATION (PartyKit) TESTS PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
