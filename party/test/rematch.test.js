const assert = require('assert');
const http = require('http');

// Real reported bug: "VOLVER A JUGAR" after a PVP match used to disconnect
// the player from PVP entirely and start a LOCAL match vs CPU instead (see
// ui.js's matchEndReplayBtn). testTimeBankMs (same mechanism clock.test.js
// uses) forces a fast, deterministic win via claimTimeout so these
// scenarios don't need to actually play a full match out first.
const IDENTITIES = {
  'rematch-host-token': { uid: 'rematch-host-uid', username: 'RematchHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, testTimeBankMs: 300, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'rematch-guest-token': { uid: 'rematch-guest-uid', username: 'RematchGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  // Weedle's Poison Sting costs exactly 1 Grass Energy -- same deterministic
  // one-attach-then-attack setup attack.test.js's own weedle-token uses.
  'rematch-attack-host-token': { uid: 'rematch-attack-host-uid', username: 'RematchAttackHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Weedle', count: 10 }, { name: 'Grass Energy', count: 20 }], testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'rematch-attack-guest-token': { uid: 'rematch-attack-guest-uid', username: 'RematchAttackGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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

// Host is always the RPS winner/first active player in this test setup, and
// rematch-host-token started with a 300ms time bank -- so claimTimeout
// reliably ends the match with the guest as winner, fast.
async function playToFinishedMatch(roomCode) {
  const { host, guest, hostNext, guestNext } = await playToTurn1(roomCode, 'rematch-host-token', 'rematch-guest-token');
  await new Promise((resolve) => setTimeout(resolve, 400));
  sendAction(guest, { type: 'claimTimeout' });
  const afterClaim = await nextOfType(guestNext, 'match');
  assert.strictEqual(afterClaim.public.winner, 'player2', 'expected the guest to win via timeout');
  await nextOfType(hostNext, 'match'); // host's own copy of the same finishing snapshot
  return { host, guest, hostNext, guestNext };
}

async function testRematchBothSidesReadyStartsAFreshMatch() {
  const { host, guest, hostNext, guestNext } = await playToFinishedMatch('REMATCH1');

  host.send(JSON.stringify({ type: 'rematch' }));
  const roomAfterHostRematch = await nextOfType(hostNext, 'room');
  assert.strictEqual(roomAfterHostRematch.status, 'waiting', 'expected the room to drop back to waiting after the first rematch request');
  assert.strictEqual(roomAfterHostRematch.matchId, null, 'no matchId while waiting for the other side to also rematch');
  assert.strictEqual(roomAfterHostRematch.hostReady, true, 'the presser is marked ready immediately');
  assert.strictEqual(roomAfterHostRematch.guestReady, false, 'the other side\'s readiness must reset, not carry over from before the LAST match');
  await nextOfType(guestNext, 'room'); // guest's own copy of the same broadcast
  console.log('PASS: the first rematch request drops the room back to waiting, presser ready, other side reset');

  guest.send(JSON.stringify({ type: 'rematch' }));
  const roomAfterBothRematch = await nextOfType(hostNext, 'room');
  assert.strictEqual(roomAfterBothRematch.status, 'started', 'expected a fresh match to start once both sides have sent rematch');
  assert.strictEqual(roomAfterBothRematch.matchId, 'REMATCH1', 'expected the SAME room code to be reused, not a new room');
  const freshHostMatch = await nextOfType(hostNext, 'match');
  const freshGuestMatch = await nextOfType(guestNext, 'match');
  assert.strictEqual(freshHostMatch.public.phase, 'rps', 'expected a genuinely fresh match (back to the rps phase), not a continuation of the finished one');
  assert.strictEqual(freshHostMatch.public.winner, null, 'the new match must not still report the OLD match\'s winner');
  assert.strictEqual(freshGuestMatch.public.phase, 'rps');
  console.log('PASS: once both sides rematch, a genuinely fresh match starts in the same room');

  host.close(); guest.close();
}

async function testLeaveRoomFlagsCarryOnTheRoomBroadcast() {
  const { host, guest, hostNext, guestNext } = await playToFinishedMatch('REMATCH2');

  // Real reported bug: the guest leaving used to only ever set guestLeft --
  // the host, staying behind and pressing "VOLVER A JUGAR", got stuck
  // forever because guestUid/guestConnId were never actually cleared, so
  // no new rival could ever join this room code again. Now the slot is
  // genuinely vacated: status drops back to 'waiting', guestUid is null,
  // and guestLeft resets to false (nothing is "left" any more -- the slot
  // is just empty, the same as a room nobody ever joined).
  host.send(JSON.stringify({ type: 'rematch' })); // host stays and wants a rematch
  await nextOfType(hostNext, 'room');
  guest.send(JSON.stringify({ type: 'leaveRoom' }));
  const roomAfterGuestLeft = await nextOfType(hostNext, 'room');
  assert.strictEqual(roomAfterGuestLeft.status, 'waiting', 'expected the room to be open again, not stuck showing the departed guest');
  assert.strictEqual(roomAfterGuestLeft.guestUid, null, 'expected the guest slot to be genuinely vacated, not just flagged');
  assert.strictEqual(roomAfterGuestLeft.guestLeft, false, 'nothing is "left" any more once the slot is actually empty');
  assert.strictEqual(roomAfterGuestLeft.hostLeft, false, 'the host itself never left');
  console.log('PASS: the guest leaving actually vacates their slot instead of just flagging it -- the host is never stuck');

  // A brand new rival (or the same one, doesn't matter -- the server has
  // no way to tell) can now join this exact room code.
  const newGuest = connect('REMATCH2', 'rematch-guest-token', 'join');
  const newGuestNext = makeQueue(newGuest);
  await nextOfType(newGuestNext, 'room');
  const roomAfterNewJoin = await nextOfType(hostNext, 'room');
  assert.strictEqual(roomAfterNewJoin.guestUsername, 'RematchGuest', 'expected a fresh join to succeed and fill the vacated slot');
  console.log('PASS: a new rival can join the same room code once the departed guest\'s slot is vacated');

  host.close(); guest.close(); newGuest.close();
}

async function testLeaveRoomFromHostFlagsForTheGuest() {
  const { host, guest, hostNext, guestNext } = await playToFinishedMatch('REMATCH3');

  host.send(JSON.stringify({ type: 'leaveRoom' }));
  const roomAfterHostLeft = await nextOfType(guestNext, 'room');
  assert.strictEqual(roomAfterHostLeft.hostLeft, true, 'expected the guest to learn the host left');
  console.log('PASS: leaveRoom from the host is visible to the guest as hostLeft:true (the scenario ui.js uses to become the new room owner)');

  host.close(); guest.close();
}

// Real reported bug: after attacking without ever confirming the end of
// that turn, rematching both sides used to carry turnEndPendingSide/
// lastAttackResult straight from the OLD match's Server instance into the
// fresh one (these live on `this`, not `this.state`, which startMatch's
// own createGame(...) call replaces fresh) -- wrongly blocking the WINNER's
// very first action in the new match ('submitRpsChoice' isn't in
// runAction's own turnEndPendingSide exemption list, so pressing rock/
// paper/scissors threw "Debes confirmar el fin de tu turno primero"), and
// risking a stale attack-overlay replay during the new match's opening
// RPS/setup phase (lastAttackResult/lastTrainerPlay are broadcast on every
// snapshot unconditionally, via redactedFor).
async function testRematchResetsStaleTurnEndPendingAndAttackState() {
  const { host, guest, hostNext, guestNext, hostState } = await playToTurn1('REMATCH4', 'rematch-attack-host-token', 'rematch-attack-guest-token');

  const grassEnergy = hostState.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy, 'expected a Grass Energy in the opening hand');
  const hostActiveId = hostState.public.board.player1.active.id;
  sendAction(host, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: hostActiveId });
  await nextOfType(hostNext, 'match');
  await nextOfType(guestNext, 'match'); // guest's own copy of the same broadcast

  // Deliberately never confirms the end of this turn -- exactly the state
  // a match that ends via this same attack's own KO would be left in (no
  // more turn left to confirm once the match is already decided).
  sendAction(host, { type: 'attack', attackName: 'Poison Sting' });
  const afterAttack = await nextOfType(hostNext, 'match');
  assert.ok(afterAttack.public.lastAttackResult, 'expected a real lastAttackResult right after the attack');
  await nextOfType(guestNext, 'match'); // guest's own copy

  host.send(JSON.stringify({ type: 'rematch' }));
  await nextOfType(hostNext, 'room');
  await nextOfType(guestNext, 'room');
  guest.send(JSON.stringify({ type: 'rematch' }));
  const roomStarted = await nextOfType(hostNext, 'room');
  assert.strictEqual(roomStarted.status, 'started', 'expected the rematch to actually start a fresh match');
  await nextOfType(guestNext, 'room');

  const freshHostMatch = await nextOfType(hostNext, 'match');
  const freshGuestMatch = await nextOfType(guestNext, 'match');
  assert.strictEqual(freshHostMatch.public.phase, 'rps', 'expected a genuinely fresh match');
  assert.strictEqual(freshHostMatch.public.lastAttackResult, null, 'expected the OLD match\'s lastAttackResult to be cleared, not carried into the fresh match');
  assert.strictEqual(freshGuestMatch.public.lastAttackResult, null);
  console.log('PASS: a rematch clears the previous match\'s stale lastAttackResult instead of carrying it into the fresh match');

  sendAction(host, { type: 'submitRpsChoice', choice: 'rock' });
  const hostImmediate = await hostNext();
  assert.notStrictEqual(hostImmediate.type, 'error', 'submitRpsChoice was wrongly rejected: ' + (hostImmediate.message || ''));
  sendAction(guest, { type: 'submitRpsChoice', choice: 'scissors' });
  const guestImmediate = await guestNext();
  assert.notStrictEqual(guestImmediate.type, 'error', 'submitRpsChoice was wrongly rejected: ' + (guestImmediate.message || ''));
  let hostAfterRps = await nextOfType(hostNext, 'match');
  while (hostAfterRps.public.phase !== 'setup') { hostAfterRps = await nextOfType(hostNext, 'match'); }
  assert.strictEqual(hostAfterRps.public.phase, 'setup', 'expected RPS to resolve normally into setup');
  console.log('PASS: submitRpsChoice is no longer blocked by the previous match\'s stale turnEndPendingSide');

  host.close(); guest.close();
}

async function main() {
  await new Promise((resolve) => stub.listen(8796, resolve));
  await testRematchBothSidesReadyStartsAFreshMatch();
  await testLeaveRoomFlagsCarryOnTheRoomBroadcast();
  await testLeaveRoomFromHostFlagsForTheGuest();
  await testRematchResetsStaleTurnEndPendingAndAttackState();
  stub.close();
  console.log('ALL PVP REMATCH (PartyKit) TESTS PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
