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
  // Brief-code fix, same class of bug as playToTurn1's own guestPlaying/
  // hostPlaying while-loops above (see trainer.test.js's identical comment
  // on its own playToTurn1): broadcastMatch() unconditionally sends a
  // 'match' message to BOTH sides for every action, including this
  // attachEnergy one -- only draining hostNext here left that broadcast
  // sitting unread in guestNext's queue, so the later "const guestAfterAttack
  // = await nextOfType(guestNext, 'match')" picked up THIS stale pre-attack
  // snapshot instead of the fresh post-attack one (0 damage instead of the
  // real delta). Draining it here keeps guestNext aligned with the actual
  // sequence of events.
  await nextOfType(guestNext, 'match');

  const beforeDefenderDamage = 0; // freshly placed Active, never hit yet
  sendAction(host, { type: 'attack', attackName: 'Poison Sting' });
  const hostAfterAttack = await nextOfType(hostNext, 'match');
  const guestAfterAttack = await nextOfType(guestNext, 'match');
  const defender = guestAfterAttack.public.board.player2.active;
  const damageDealt = defender.damage - beforeDefenderDamage;
  // weedle-guest-token's deck (blackout) isn't customDeckCards-pinned, so
  // the guest's random opening hand decides which of blackout's 5 Basics
  // (Farfetch'd/Squirtle/Staryu/Sandshrew/Machop) becomes its Active --
  // Sandshrew alone (data-cards.js) is weak to Grass, doubling Poison
  // Sting's flat 10 to 20. Tolerating both keeps this deterministic-enough
  // without needing to pin the guest's exact Active.
  assert.ok(damageDealt === 10 || damageDealt === 20, 'expected Poison Sting to deal 10 (or 20 if the guest\'s Active is weak to Grass) damage, got ' + damageDealt);
  console.log('PASS: Poison Sting (a coin-flip special attack, previously rejected with "(Fase 2)") deals its real damage');

  assert.ok(hostAfterAttack.public.lastAttackResult);
  assert.strictEqual(hostAfterAttack.public.lastAttackResult.attackerName, 'Weedle');
  assert.strictEqual(hostAfterAttack.public.lastAttackResult.damage, damageDealt);
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
  // Magikarp (data-cards.js) is weak to Lightning (x2), so Thunder Jolt's
  // flat 30 actually lands as 60 here, not 30 -- still comfortably a
  // one-hit KO on Magikarp's exactly-30 HP either way, which is the part
  // this scenario actually needs to be deterministic.
  assert.strictEqual(hostAfterKo.public.lastAttackResult.damage, 60);
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

    // Brief-code fix: placeBench is in party/index.js's TURN_GATED_ACTIONS
    // (same real rule as placeActive/attachEnergy/etc. -- a Bench Pokémon
    // can only be placed on your own turn), so this has to happen here,
    // during the guest's own first turn, and NOT later after control has
    // already passed back to the host for its second turn (where the
    // brief's original ordering placed it, and party/index.js correctly
    // rejected it with "No puedes jugar, aún no es tu turno."). Same
    // bounded-retry guard already used above for energy1/ninetalesCard:
    // lure-guest-token's deck is only Magikarp(6)/Rattata(6)/Water
    // Energy(18), one Basic copy already spent on its opening Active, so
    // it's possible (if unlikely) for this specific opening+draws to leave
    // neither Basic in the remaining hand -- retry with a fresh room
    // rather than crashing on a null find().
    const guestBenchCard = guestState.myHand.find((c) => c.name === 'Magikarp' || c.name === 'Rattata');
    if (!guestBenchCard) { host.close(); guest.close(); continue; }
    sendAction(guest, { type: 'placeBench', handCardId: guestBenchCard.id, benchIndex: 0 });
    let guestAfterBench = await nextOfType(guestNext, 'match');
    while (!guestAfterBench.public.board.player2.bench[0]) { guestAfterBench = await nextOfType(guestNext, 'match'); }
    const benchInstanceId = guestAfterBench.public.board.player2.bench[0].id;
    const guestActiveNameBefore = guestAfterBench.public.board.player2.active.name;

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

    sendAction(host, { type: 'attack', attackName: 'Lure', targetInstanceId: benchInstanceId });
    const hostAfterLure = await nextOfType(hostNext, 'match');
    // Brief-code fix: attack()'s own generic lastAttackResult logic
    // (rules-engine.js) only ever sets it when damage was dealt, a new
    // status appeared, the attack missed, or there was self-damage -- none
    // of which apply to Lure (it does 0 damage and just swaps who's
    // Active), so unlike Poison Sting/Thunder Jolt above, lastAttackResult
    // correctly stays null here. The real, meaningful assertion for Lure is
    // that the swap itself actually happened.
    assert.strictEqual(hostAfterLure.public.lastAttackResult, null);
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
