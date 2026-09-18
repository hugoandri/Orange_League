const assert = require('assert');
const http = require('http');

// Real reported bug: "usé energy retrieval, seleccioné las energías del
// descarte pero no llegaron a mi mano." Root cause: redactMatchState
// (rules-engine.js) stripped every discard card down to {name}, dropping
// its real id -- Energy Retrieval's own picker (ui.js) then submitted the
// literal string "undefined" for every choice (every option's DOM
// attribute collapsed onto the same value), which the server correctly
// rejected as "no existe en tu descarte" UNLESS the net selection happened
// to be empty (the shared "undefined" id made a 2nd click toggle the 1st
// one back OFF) -- in which case the card was still spent, nothing came
// back, and no error was ever shown. customDeckCards (honored by
// party/index.js's onConnect) builds a Bulbasaur/Energy Retrieval/Grass
// Energy-heavy deck: 2 Bulbasaur (Active + Bench, retreatCost 1 each) let
// a single turn's retreat discard exactly 1 Grass Energy at a time, so 2
// turns' worth of attach+retreat deterministically stock the discard pile
// with 2 real, distinct energy cards to retrieve.
const IDENTITIES = {
  'discard-host-token': {
    uid: 'discard-host-uid', username: 'DiscardHost', photo: null, deckKey: 'overgrowth', deckCoverName: null,
    customDeckCards: [
      { name: 'Bulbasaur', count: 10 }, { name: 'Energy Retrieval', count: 6 }, { name: 'Grass Energy', count: 14 }
    ],
    testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {}
  },
  'discard-guest-token': { uid: 'discard-guest-uid', username: 'DiscardGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, testTimeBankMs: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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

// Plays through RPS + setup only -- stops right as 'playing' begins,
// before either side has placed a single Bulbasaur, so the caller can
// inspect the host's real opening hand and decide whether to keep this
// attempt or retry with a fresh room code.
async function dealOnly(roomCode) {
  const host = connect(roomCode, 'discard-host-token', 'create');
  const hostNext = makeQueue(host);
  await hostNext(); // room, waiting
  const guest = connect(roomCode, 'discard-guest-token', 'join');
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
  await nextOfType(guestNext, 'match'); // guest's own copy of the same phase change

  return { host, guest, hostNext, guestNext, hostSetup: hostAfterRps };
}

async function testDiscardIdsSurviveRedactionAndEnergyRetrievalWorks() {
  // Host (RPS winner, always goes first in this test setup) needs at least
  // 2 Bulbasaur (Active + Bench, so a single turn's retreat can discard 1
  // Grass Energy each time) and 1 Energy Retrieval already in the OPENING
  // 7-card hand (setup happens before any turn draw) -- ~56% per attempt
  // with this deck's density (10/6/14 out of 30), so a handful of
  // independent reshuffles converges fast (same "fresh room = fresh
  // shuffle" retry pattern as trainer.test.js's own Bill loop).
  let host, guest, hostNext, guestNext, hostSetup;
  let bulbasaurs = [];
  for (let attempt = 0; attempt < 25; attempt++) {
    if (host) { host.close(); guest.close(); }
    const result = await dealOnly('DISCARDIDS' + attempt);
    host = result.host; guest = result.guest;
    hostNext = result.hostNext; guestNext = result.guestNext;
    hostSetup = result.hostSetup;
    bulbasaurs = hostSetup.myHand.filter((c) => c.name === 'Bulbasaur');
    const hasEnergyRetrieval = hostSetup.myHand.some((c) => c.name === 'Energy Retrieval');
    const hasGrassEnergy = hostSetup.myHand.some((c) => c.name === 'Grass Energy');
    if (bulbasaurs.length >= 2 && hasEnergyRetrieval && hasGrassEnergy) { break; }
    bulbasaurs = [];
  }
  assert.ok(bulbasaurs.length >= 2, 'expected 2 Bulbasaur + Energy Retrieval + Grass Energy in the host\'s opening hand within 25 independent shuffles');

  sendAction(host, { type: 'placeActive', handCardId: bulbasaurs[0].id });
  await nextOfType(hostNext, 'match');
  sendAction(host, { type: 'placeBench', handCardId: bulbasaurs[1].id, benchIndex: 0 });
  await nextOfType(hostNext, 'match');

  const guestSetup = await nextOfType(guestNext, 'match');
  const guestBasic = firstBasic(guestSetup.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestBasic.id });
  await nextOfType(guestNext, 'match');
  await nextOfType(hostNext, 'match'); // host's own copy of the guest's placeActive broadcast

  sendAction(host, { type: 'confirmSetup' });
  await nextOfType(hostNext, 'match');
  sendAction(guest, { type: 'confirmSetup' });
  await nextOfType(guestNext, 'match');
  let hostPlaying = await nextOfType(hostNext, 'match');
  while (hostPlaying.public.phase !== 'playing') { hostPlaying = await nextOfType(hostNext, 'match'); }

  const activeId = bulbasaurs[0].id;
  const benchId = bulbasaurs[1].id;

  // Turn 1 (host): attach 1 Grass Energy to the Active Bulbasaur, then
  // retreat to the Bench Bulbasaur -- discards that energy as the retreat
  // cost (Bulbasaur's printed retreatCost is 1).
  var grassEnergy1 = hostPlaying.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy1, 'expected a Grass Energy in the opening hand for turn 1');
  sendAction(host, { type: 'attachEnergy', handCardId: grassEnergy1.id, targetInstanceId: activeId });
  await nextOfType(hostNext, 'match');
  sendAction(host, { type: 'retreat', targetInstanceId: benchId });
  var afterFirstRetreat = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterFirstRetreat.public.discard.player1.length, 1, 'expected exactly 1 card (the Grass Energy) in the host discard after the first retreat');
  var firstDiscardedId = afterFirstRetreat.public.discard.player1[0].id;
  assert.ok(firstDiscardedId, 'expected the redacted discard entry to carry a real id, not undefined -- this is the exact bug reported');

  sendAction(host, { type: 'endTurn' });
  await nextOfType(hostNext, 'match');
  var guestTurn = await nextOfType(guestNext, 'match');
  while (guestTurn.public.activePlayerId !== 'player2') { guestTurn = await nextOfType(guestNext, 'match'); }
  sendAction(guest, { type: 'endTurn' });
  var hostTurn3 = await nextOfType(hostNext, 'match');
  while (hostTurn3.public.activePlayerId !== 'player1') { hostTurn3 = await nextOfType(hostNext, 'match'); }
  await nextOfType(guestNext, 'match'); // guest's own copy of this same handoff

  // Turn 3 (host again): attach a 2nd Grass Energy to whichever Bulbasaur
  // is now Active (the one retreated INTO on turn 1), retreat back to the
  // other one -- its own retreatCost (also 1) discards this 2nd energy
  // too. Now 2 real, distinct Grass Energy ids sit in the host's discard.
  var grassEnergy2 = hostTurn3.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy2, 'expected a 2nd Grass Energy in hand by turn 3 (drawn at either turn-start, or already in the opening hand)');
  sendAction(host, { type: 'attachEnergy', handCardId: grassEnergy2.id, targetInstanceId: benchId });
  await nextOfType(hostNext, 'match');
  sendAction(host, { type: 'retreat', targetInstanceId: activeId });
  var afterSecondRetreat = await nextOfType(hostNext, 'match');
  var discardEntries = afterSecondRetreat.public.discard.player1;
  assert.strictEqual(discardEntries.length, 2, 'expected 2 Grass Energy cards in the host discard by now');
  var discardIds = discardEntries.map((c) => c.id);
  assert.notStrictEqual(discardIds[0], discardIds[1], 'expected the 2 discarded Grass Energy cards to have DISTINCT real ids -- before the fix both were undefined, colliding');
  console.log('PASS: the public discard pile now carries real, distinct card ids instead of undefined');

  // Now play Energy Retrieval: trade the Energy Retrieval card's own cost
  // (any other hand card), retrieve both real discard ids.
  var myHand = afterSecondRetreat.myHand;
  var energyRetrievalCard = myHand.find((c) => c.name === 'Energy Retrieval');
  assert.ok(energyRetrievalCard, 'expected an Energy Retrieval card in hand');
  var tradeCard = myHand.find((c) => c.id !== energyRetrievalCard.id);
  assert.ok(tradeCard, 'expected at least 1 other hand card to pay Energy Retrieval\'s trade cost');

  sendAction(host, { type: 'playTrainer', trainerName: 'Energy Retrieval', handId: energyRetrievalCard.id, args: [tradeCard.id, discardIds] });
  var afterRetrieval = await nextOfType(hostNext, 'match');
  // By id, not by a total Grass Energy count -- this custom deck is heavy
  // enough in Grass Energy (needed for the opening-hand retry loop above)
  // that normal turn-start draws can easily have put OTHER Grass Energy
  // copies in hand too by now; what actually matters is that these 2
  // SPECIFIC discard ids landed back in hand, not merely that the hand
  // contains 2 Grass Energy cards total.
  var handIds = afterRetrieval.myHand.map((c) => c.id);
  discardIds.forEach((id) => {
    assert.ok(handIds.indexOf(id) !== -1, 'expected retrieved card ' + id + ' to actually land in hand -- this is the exact reported bug');
  });
  assert.strictEqual(afterRetrieval.public.discard.player1.length, 2, 'expected exactly 2 cards left in discard: the traded card + Energy Retrieval itself');
  console.log('PASS: Energy Retrieval, over the real PartyKit action API, now actually returns the chosen energies to hand');

  host.close(); guest.close();
}

async function main() {
  await new Promise((resolve) => stub.listen(8798, resolve));
  await testDiscardIdsSurviveRedactionAndEnergyRetrievalWorks();
  stub.close();
  console.log('ALL PVP DISCARD-ID (PartyKit) TESTS PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
