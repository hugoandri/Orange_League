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
  // Brief-code fix: the brief's original list omitted 'Hitmonchan' and
  // "Farfetch'd" -- both real Basic Pokémon, and both present specifically
  // in the guest's 'blackout' precon deck (see IDENTITIES above). The
  // guest's dealt hand can satisfy the mulligan rule via one of those two
  // cards while containing none of the other listed basics, which made
  // firstBasic(guestAfterRps.myHand) return undefined and crash on
  // guestBasic.id below. Reproduced directly against the local dev server.
  const KNOWN_BASICS = ['Charmander', 'Squirtle', 'Bulbasaur', 'Caterpie', 'Weedle', 'Pidgey', 'Rattata', 'Machop', 'Meowth', 'Psyduck', 'Magikarp', 'Poliwag', 'Abra', 'Gastly', 'Voltorb', 'Diglett', 'Growlithe', 'Ponyta', 'Vulpix', 'Onix', 'Drowzee', 'Sandshrew', 'Doduo', 'Krabby', 'Horsea', 'Goldeen', 'Staryu', 'Eevee', 'Dratini', 'Porygon', 'Pikachu', 'Clefairy', 'Jigglypuff', 'Zubat', 'Oddish', 'Paras', 'Venonat', 'Ekans', 'Hitmonchan', "Farfetch'd"];
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
  // Brief-code fix: guestNext receives TWO 'match' broadcasts during this
  // confirmSetup exchange (broadcastMatch() fans out to BOTH connections on
  // every action, so host's own confirmSetup above already queued one 'setup'
  // -phase message here, on top of the 'playing'-phase one guest's own
  // confirmSetup triggers) -- a single un-looped nextOfType(guestNext,
  // 'match') silently returns the stale 'setup'-phase one and leaves the
  // real 'playing'-phase broadcast sitting unconsumed in the queue. That
  // leftover message then gets mistaken for the FIRST post-playTrainer
  // broadcast later in main(), which is how this was caught: otherAfter's
  // lastTrainerPlay came back null even though playTrainer had legitimately
  // succeeded, because otherAfter was actually this stale pre-Bill snapshot.
  // Mirrors hostPlaying's own while loop just above.
  let guestPlaying = await nextOfType(guestNext, 'match');
  while (guestPlaying.public.phase !== 'playing') { guestPlaying = await nextOfType(guestNext, 'match'); }

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
  // Same Node-native-WebSocket-vs-workerd hang as room.test.js/match.test.js
  // (both established this same fix) -- Node's native WebSocket#close()
  // against PartyKit's local dev server (workerd) never completes the close
  // handshake, so the process would otherwise hang forever waiting for the
  // sockets to fully tear down. All assertions above have already run by
  // this point, so exit explicitly once they pass. (Brief-code fix: the
  // brief's own test listing omitted this call, unlike its two sibling
  // test files which both needed it for the same underlying reason.)
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
