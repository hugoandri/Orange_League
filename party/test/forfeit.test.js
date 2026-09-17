const assert = require('assert');
const http = require('http');

// forfeit-host-token/forfeit-guest-token: plain identities for the 3
// scenarios that only need to reach the 'rps' phase (registration on match
// start, forfeit-during-rps for both sides). pending-attacker-token/
// pending-attacker-guest-token (Weedle + Grass Energy, same customDeckCards
// shape as attack.test.js's own weedle-token/weedle-guest-token) are only
// used by testForfeitDuringTurnEndPendingConfirmation, which needs a real
// legal attack to actually land turnEndPendingSide on a real side -- that
// state only exists after a real 'attack' action succeeds (canAttack
// requires a Basic placed and, for Poison Sting, 1 Grass Energy attached),
// so it can't be faked or skipped.
const IDENTITIES = {
  'forfeit-host-token': { uid: 'forfeit-host-uid', username: 'ForfeitHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'forfeit-guest-token': { uid: 'forfeit-guest-uid', username: 'ForfeitGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'pending-attacker-token': { uid: 'pending-attacker-uid', username: 'PendingAttacker', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Weedle', count: 10 }, { name: 'Grass Energy', count: 20 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'pending-attacker-guest-token': { uid: 'pending-attacker-guest-uid', username: 'PendingAttackerGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
};

// In-memory fake of the activeMatches Firestore collection Task 1 defines
// -- registerActiveMatch/clearActiveMatch (below) write directly into this
// object instead of touching real Firestore, so the whole directory flow
// is testable without the Firebase Emulator Suite (that's Task 1's own
// functions/test/activeMatch.test.js's job -- this file only proves
// party/index.js calls these two endpoints correctly, with the right
// uid/roomCode/secret, at the right moments).
const activeMatchDirectory = {};
const TEST_SECRET = 'test-secret';

const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const data = body ? JSON.parse(body) : {};
    if (req.url === '/registerActiveMatch') {
      assert.strictEqual(data.secret, TEST_SECRET, 'registerActiveMatch must send the configured secret');
      activeMatchDirectory[data.uid] = data.roomCode;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/clearActiveMatch') {
      assert.strictEqual(data.secret, TEST_SECRET, 'clearActiveMatch must send the configured secret');
      delete activeMatchDirectory[data.uid];
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    // Default (no path match): identity resolution, same as every other
    // party/test/*.test.js's stub -- RESOLVE_IDENTITY_URL points at this
    // server's root, no path appended.
    const identity = IDENTITIES[data.idToken];
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

async function connectBothToFreshMatch(roomCode, hostToken, guestToken) {
  const host = connect(roomCode, hostToken || 'forfeit-host-token', 'create');
  const hostNext = makeQueue(host);
  await hostNext(); // room, waiting
  const guest = connect(roomCode, guestToken || 'forfeit-guest-token', 'join');
  const guestNext = makeQueue(guest);
  await hostNext(); await guestNext(); // room, guest joined

  host.send(JSON.stringify({ type: 'setReady' }));
  await hostNext();
  guest.send(JSON.stringify({ type: 'setReady' }));
  await nextOfType(hostNext, 'match');
  await nextOfType(guestNext, 'match');
  return { host, hostNext, guest, guestNext };
}

async function testRegistersBothOnMatchStart() {
  const { host, guest } = await connectBothToFreshMatch('FORFEIT1');
  await new Promise((r) => setTimeout(r, 200)); // let the fire-and-forget registerActiveMatch calls land
  assert.strictEqual(activeMatchDirectory['forfeit-host-uid'], 'FORFEIT1');
  assert.strictEqual(activeMatchDirectory['forfeit-guest-uid'], 'FORFEIT1');
  console.log('PASS: starting a match registers both uids in the directory');
  host.close(); guest.close();
}

async function testHostForfeitDuringRps() {
  const { host, hostNext, guest, guestNext } = await connectBothToFreshMatch('FORFEIT2');
  sendAction(host, { type: 'forfeit' });
  const hostView = await nextOfType(hostNext, 'match');
  const guestView = await nextOfType(guestNext, 'match');
  assert.strictEqual(hostView.public.winner, 'player2');
  assert.strictEqual(guestView.public.winner, 'player2');
  assert.strictEqual(hostView.public.forfeitedBy, 'player1');
  assert.strictEqual(guestView.public.forfeitedBy, 'player1');
  console.log('PASS: the host forfeiting during RPS immediately gives the guest the win, both sides agree');
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(activeMatchDirectory['forfeit-host-uid'], undefined);
  assert.strictEqual(activeMatchDirectory['forfeit-guest-uid'], undefined);
  console.log('PASS: a forfeit clears the directory for both uids');
  host.close(); guest.close();
}

async function testGuestForfeitIsAlsoAlwaysLegal() {
  const { host, hostNext, guest, guestNext } = await connectBothToFreshMatch('FORFEIT3');
  sendAction(guest, { type: 'forfeit' });
  const hostView = await nextOfType(hostNext, 'match');
  assert.strictEqual(hostView.public.winner, 'player1');
  assert.strictEqual(hostView.public.forfeitedBy, 'player2');
  console.log('PASS: the guest forfeiting gives the host the win');
  host.close(); guest.close();
}

// Same fixed Basic list attack.test.js/match.test.js/trainer.test.js already
// established (CARD_STATS isn't available in this plain Node process).
const KNOWN_BASICS = ['Charmander', 'Squirtle', 'Bulbasaur', 'Caterpie', 'Weedle', 'Pidgey', 'Rattata', 'Machop', 'Meowth', 'Psyduck', 'Magikarp', 'Poliwag', 'Abra', 'Gastly', 'Voltorb', 'Diglett', 'Growlithe', 'Ponyta', 'Vulpix', 'Onix', 'Drowzee', 'Sandshrew', 'Doduo', 'Krabby', 'Horsea', 'Goldeen', 'Staryu', 'Eevee', 'Dratini', 'Porygon', 'Pikachu', 'Clefairy', 'Jigglypuff', 'Zubat', 'Oddish', 'Paras', 'Venonat', 'Ekans', 'Hitmonchan', "Farfetch'd"];
function firstBasic(hand) { return hand.find((c) => KNOWN_BASICS.indexOf(c.name) !== -1); }

// Gets both sides through RPS + setup + confirmSetup, host always winning
// RPS (same hardcoded rock-beats-scissors as attack.test.js/trainer.test.js/
// match.test.js) so activePlayerId is always 'player1' (host) once
// 'playing' starts.
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
  await nextOfType(hostNext, 'match'); // rps phase, no active player yet
  await nextOfType(guestNext, 'match');

  sendAction(host, { type: 'submitRpsChoice', choice: 'rock' });
  sendAction(guest, { type: 'submitRpsChoice', choice: 'scissors' });
  let hostAfterRps = await nextOfType(hostNext, 'match');
  while (hostAfterRps.public.phase !== 'setup') { hostAfterRps = await nextOfType(hostNext, 'match'); }

  const hostBasic = firstBasic(hostAfterRps.myHand);
  assert.ok(hostBasic, 'expected a Basic in the host\'s opening hand');
  sendAction(host, { type: 'placeActive', handCardId: hostBasic.id });
  const hostMatch3 = await nextOfType(hostNext, 'match');
  const guestAfterRps = await nextOfType(guestNext, 'match');
  const guestBasic = firstBasic(guestAfterRps.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestBasic.id });
  await nextOfType(guestNext, 'match');
  sendAction(host, { type: 'confirmSetup' });
  await nextOfType(hostNext, 'match');
  sendAction(guest, { type: 'confirmSetup' });
  await nextOfType(guestNext, 'match'); // guest's own ack-equivalent match broadcast
  let hostPlaying = await nextOfType(hostNext, 'match');
  while (hostPlaying.public.phase !== 'playing') { hostPlaying = await nextOfType(hostNext, 'match'); }
  let guestPlaying = await nextOfType(guestNext, 'match');
  while (guestPlaying.public.phase !== 'playing') { guestPlaying = await nextOfType(guestNext, 'match'); }

  return { host, guest, hostNext, guestNext, hostState: hostPlaying, hostActiveId: hostMatch3.public.board.player1.active.id };
}

// Option (a) from the task-2 brief's own coverage note: builds a REAL
// turnEndPendingSide-pending state (the brief's original draft only faked
// "not this side's turn", already covered by testGuestForfeitIsAlsoAlwaysLegal
// above) -- gets a legal Poison Sting attack off (same setup as
// attack.test.js's testWeedlePoisonSting), which sets turnEndPendingSide to
// the attacker's own side (party/index.js's 'attack' case), then has that
// SAME side send 'forfeit' before ever sending 'confirmEndTurn'. If Step 7's
// exemption (['confirmEndTurn', 'takePrize', 'chooseActive', 'claimTimeout',
// 'forfeit']) were missing 'forfeit', this would come back as a {type:
// 'error', message: 'Debes confirmar el fin de tu turno primero.'} instead
// of a real match snapshot with a winner.
async function testForfeitDuringTurnEndPendingConfirmation() {
  const { host, guest, hostNext, guestNext, hostState, hostActiveId } =
    await playToTurn1('FORFEIT4', 'pending-attacker-token', 'pending-attacker-guest-token');
  const energyCard = hostState.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(energyCard, 'expected a Grass Energy in the host\'s opening hand (20/30 copies)');
  sendAction(host, { type: 'attachEnergy', handCardId: energyCard.id, targetInstanceId: hostActiveId });
  await nextOfType(hostNext, 'match');
  await nextOfType(guestNext, 'match');

  sendAction(host, { type: 'attack', attackName: 'Poison Sting' });
  await nextOfType(hostNext, 'match');
  await nextOfType(guestNext, 'match');
  // turnEndPendingSide is now 'player' (the host, who just attacked) --
  // confirmed indirectly below: if the exemption were missing, the
  // forfeit itself would come back as an 'error', not a 'match' snapshot.

  sendAction(host, { type: 'forfeit' });
  const hostView = await nextOfType(hostNext, 'match');
  const guestView = await nextOfType(guestNext, 'match');
  assert.strictEqual(hostView.public.winner, 'player2');
  assert.strictEqual(guestView.public.winner, 'player2');
  assert.strictEqual(hostView.public.forfeitedBy, 'player1');
  console.log('PASS: forfeit is not blocked by the turnEndPendingSide guard, even from the pending side itself, with a real pending confirmation on the board');

  host.close(); guest.close();
}

async function main() {
  stub.listen(8799, async () => {
    try {
      await testRegistersBothOnMatchStart();
      await testHostForfeitDuringRps();
      await testGuestForfeitIsAlsoAlwaysLegal();
      await testForfeitDuringTurnEndPendingConfirmation();
      console.log('ALL forfeit (PartyKit) TESTS PASSED');
      stub.close();
      process.exit(0);
    } catch (err) {
      console.error(err);
      stub.close();
      process.exit(1);
    }
  });
}

main();
