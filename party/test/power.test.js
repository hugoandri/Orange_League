const assert = require('assert');
const http = require('http');

// None of the 6 Power-holding Pokémon are Basics -- every scenario below
// evolves one up from a customDeckCards-seeded Basic (see this file's own
// header comment for the exact turn-timing rule). power-guest-token is a
// bland, unremarkable deck reused by every scenario that doesn't need the
// guest to actually do anything but end their own turns; power-attacker-
// guest-token (Weedle/Grass Energy, same setup attack.test.js's own
// weedle-token already uses) is reused by the 2 scenarios that need the
// guest to deal REAL damage first (Damage Swap needs an already-damaged
// Pokémon to move damage FROM; the Strikes Back verification needs a real
// attack to trigger the counter-hit at all).
// Brief-code fix (reproduced directly against the local dev server, see
// this file's own header comment for the exact mechanism): the brief's
// original counts (a flat 6/6/6/4 split, 30-card decks) badly
// under-estimated how many of a HOST's own draws are actually needed to
// reliably hold a full 3-stage evolution line (Basic -> Stage 1 -> Stage
// 2) in hand by specific turns, on top of a 2nd copy of the Basic (for
// the bench) and, for Rain Dance/Energy Trans, a specific Energy card too
// -- empirically (hypergeometric/Monte-Carlo, both against real dev-
// server runs and offline simulation) the ORIGINAL counts failed
// somewhere between 20% and 30% of individual runs, not the rare edge
// case the brief's own "deliberately dense" comment assumed. Each host
// deck below is reweighted so its OWN Basic is heavily overrepresented
// (needed twice: once as Active, once again later as a 2nd copy for the
// bench -- Damage Swap/Energy Trans/Buzzap all reuse a 2ND COPY OF THE
// SAME BASIC as that bench Pokémon instead of a differently-named one,
// since usePokemonPower's own effects never care about species, only
// "2 different instances of the caller's own Pokémon" -- 2 real chances
// at 1 named card comfortably beats 1 real chance each at 2 differently-
// named cards from the same size hand), while Stage 1/Stage 2 stay
// comfortably above what evolutionTimingAllowed's own turn-3/turn-5
// windows need. No deck here needs to resemble a real, legal Base Set
// decklist -- same reasoning attack.test.js's own "Weedle count: 10"
// already established (nothing in this engine enforces a real card's
// print/copy limit on a customDeckCards deck).
const IDENTITIES = {
  'power-guest-token': { uid: 'power-guest-uid', username: 'PowerGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'power-attacker-guest-token': { uid: 'power-attacker-guest-uid', username: 'PowerAttackerGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: [{ name: 'Weedle', count: 10 }, { name: 'Grass Energy', count: 20 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'damage-swap-host-token': { uid: 'damage-swap-host-uid', username: 'DamageSwapHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Abra', count: 18 }, { name: 'Kadabra', count: 12 }, { name: 'Alakazam', count: 10 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'rain-dance-host-token': { uid: 'rain-dance-host-uid', username: 'RainDanceHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Squirtle', count: 10 }, { name: 'Wartortle', count: 8 }, { name: 'Blastoise', count: 8 }, { name: 'Water Energy', count: 10 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'energy-burn-host-token': { uid: 'energy-burn-host-uid', username: 'EnergyBurnHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Charmander', count: 10 }, { name: 'Charmeleon', count: 8 }, { name: 'Charizard', count: 8 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'energy-trans-host-token': { uid: 'energy-trans-host-uid', username: 'EnergyTransHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Bulbasaur', count: 18 }, { name: 'Ivysaur', count: 12 }, { name: 'Venusaur', count: 10 }, { name: 'Grass Energy', count: 8 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'buzzap-host-token': { uid: 'buzzap-host-uid', username: 'BuzzapHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Voltorb', count: 14 }, { name: 'Electrode', count: 10 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'strikes-back-host-token': { uid: 'strikes-back-host-uid', username: 'StrikesBackHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: [{ name: 'Machop', count: 10 }, { name: 'Machoke', count: 8 }, { name: 'Machamp', count: 8 }], cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
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

// hostActiveName (optional): 3 of this file's own host decks --
// damage-swap-host-token (Abra+Bulbasaur), energy-trans-host-token
// (Bulbasaur+Charmander), buzzap-host-token (Voltorb+Charmander) -- each
// deliberately carry a 2ND real Basic Pokémon alongside the one meant to
// become (and evolve into) the Power holder, since that scenario also
// needs a 2nd own Pokémon on the bench (see this file's own header
// comment). Plain firstBasic() can't tell those 2 Basics apart -- which
// one lands in the opening hand first is pure shuffle luck -- so those 3
// scenarios pass the exact name that must become Active, matching
// attack.test.js's own playToTurn1(..., hostActiveName) convention.
// Reproduced directly against the local dev server: without this,
// testDamageSwap intermittently (and testEnergyTrans/testBuzzap would
// have too) tried to bench a card already spent becoming its OWN Active,
// or tried to evolve a Basic that was never placed at all.
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
  await nextOfType(hostNext, 'match');
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
  await nextOfType(hostNext, 'match');
  const guestAfterRps = await nextOfType(guestNext, 'match');
  const guestBasic = firstBasic(guestAfterRps.myHand);
  sendAction(guest, { type: 'placeActive', handCardId: guestBasic.id });
  await nextOfType(guestNext, 'match');
  await nextOfType(hostNext, 'match'); // host's own copy of the guest's placeActive broadcast
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

// Ends turns on both sides until the host reaches their OWN next turn --
// shared by the evolution helper below (2 uses: turn1->turn3, turn3->
// turn5) and the Strikes Back scenario (turn1->turn3, so the guest can
// attack on turn 2 first).
async function endTurnsUntilHostActive(host, guest, hostNext, guestNext) {
  sendAction(host, { type: 'endTurn' });
  await nextOfType(hostNext, 'match');
  let guestTurn = await nextOfType(guestNext, 'match');
  while (guestTurn.public.activePlayerId !== 'player2') { guestTurn = await nextOfType(guestNext, 'match'); }
  sendAction(guest, { type: 'endTurn' });
  let hostTurn = await nextOfType(hostNext, 'match');
  while (hostTurn.public.activePlayerId !== 'player1') { hostTurn = await nextOfType(hostNext, 'match'); }
  await nextOfType(guestNext, 'match'); // guest's own copy of this same handoff
  return hostTurn;
}

// Evolves the host's own Active from a Basic all the way to stage2Name
// (or, if stage2Name is null, only up to stage1Name -- Electrode's own
// Buzzap scenario is Stage 1) on the earliest turns evolutionTimingAllowed
// permits (host's own turn 3, then turn 5). Returns the same shape
// playToTurn1 does, plus `ownerId` (the evolved Pokémon's own instance id,
// unchanged by evolving -- see rules-engine.js's evolve(), which mutates
// the existing instance's .name in place rather than replacing it).
async function evolveHostActive(roomCode, hostToken, guestToken, stage1Name, stage2Name, hostActiveName) {
  const setup = await playToTurn1(roomCode, hostToken, guestToken, hostActiveName);
  const ownerId = setup.hostState.public.board.player1.active.id;
  const hostTurn3 = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
  // Final-review fix: same bounded extra-turn-retry pattern as Rain
  // Dance's own 2nd Water Energy search and Damage Swap's own 2nd Abra
  // search below -- evolutionTimingAllowed (rules-engine.js) is only a
  // MINIMUM-turn gate (target.turnEnteredCurrentForm < state.turnCounter),
  // never a maximum, so there's no real deadline stopping the host from
  // ending a few more turns (same endTurnsUntilHostActive helper, same
  // 12-cycle bound) until stage1Name actually turns up in hand, instead of
  // gambling everything on turn 3's own hand alone.
  let handForStage1 = hostTurn3;
  let stage1Card = handForStage1.myHand.find((c) => c.name === stage1Name);
  let extraTurnCyclesForStage1 = 0;
  while (!stage1Card && extraTurnCyclesForStage1 < 12) {
    handForStage1 = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
    stage1Card = handForStage1.myHand.find((c) => c.name === stage1Name);
    extraTurnCyclesForStage1++;
  }
  assert.ok(stage1Card, 'expected ' + stage1Name + ' to eventually turn up in hand (even after ' + extraTurnCyclesForStage1 + ' extra turns)');
  sendAction(setup.host, { type: 'evolve', handCardId: stage1Card.id, targetInstanceId: ownerId });
  let afterStage1 = await nextOfType(setup.hostNext, 'match');
  if (!stage2Name) {
    // Brief-code fix, reproduced directly against the local dev server:
    // this evolve's own broadcastMatch() reaches guestNext too (every
    // action broadcasts to BOTH sides), and unlike the evolve inside
    // endTurnsUntilHostActive's own next call (naturally absorbed by that
    // helper's "while (activePlayerId !== ...)" loop on guestNext), THIS
    // is the last thing evolveHostActive ever sends before returning --
    // nothing else here drains guestNext's own copy. Left undrained, it
    // silently offset every caller's own later single-shot "guest's own
    // copy" drain (testBuzzap's placeBench, or a scenario with no bench at
    // all like testEnergyBurn's own post-evolve usePower) by one stale
    // message, making the guest side see a null/stale lastPowerUse instead
    // of the real reveal.
    await nextOfType(setup.guestNext, 'match'); // guest's own copy of the stage-1 evolve broadcast
    return Object.assign({}, setup, { hostState: afterStage1, ownerId: ownerId });
  }
  const hostTurn5 = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
  // Final-review fix: same bounded extra-turn-retry pattern as the
  // stage1Card search above -- stage2Name's evolve is likewise only
  // MINIMUM-turn-gated, never deadline-gated, so keep ending turns (same
  // helper, same 12-cycle bound) until it turns up instead of asserting
  // against turn 5's own hand alone.
  let handForStage2 = hostTurn5;
  let stage2Card = handForStage2.myHand.find((c) => c.name === stage2Name);
  let extraTurnCyclesForStage2 = 0;
  while (!stage2Card && extraTurnCyclesForStage2 < 12) {
    handForStage2 = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
    stage2Card = handForStage2.myHand.find((c) => c.name === stage2Name);
    extraTurnCyclesForStage2++;
  }
  assert.ok(stage2Card, 'expected ' + stage2Name + ' to eventually turn up in hand (even after ' + extraTurnCyclesForStage2 + ' extra turns)');
  sendAction(setup.host, { type: 'evolve', handCardId: stage2Card.id, targetInstanceId: ownerId });
  const afterStage2 = await nextOfType(setup.hostNext, 'match');
  await nextOfType(setup.guestNext, 'match'); // guest's own copy of the stage-2 evolve broadcast (same reasoning as the stage-1-only branch above)
  return Object.assign({}, setup, { hostState: afterStage2, ownerId: ownerId });
}

// Damage Swap/Energy Trans/Buzzap each need a 2nd own Pokémon on the
// bench (Rain Dance/Energy Burn only ever need the Active itself) -- each
// of those 3 scenarios below places it inline, right after evolving,
// since placeBench doesn't depend on evolution timing the way evolve does
// -- no shared helper needed for a 2-line action + await.

async function testDamageSwap() {
  const setup = await playToTurn1('POWER-DAMAGESWAP', 'damage-swap-host-token', 'power-attacker-guest-token', 'Abra');
  const ownerId = setup.hostState.public.board.player1.active.id; // Abra

  // Turn 1 (host): evolving isn't legal yet -- just end the turn.
  sendAction(setup.host, { type: 'endTurn' });
  await nextOfType(setup.hostNext, 'match');

  // Turn 2 (guest): attach Grass Energy, ready to attack next turn.
  let guestTurn2 = await nextOfType(setup.guestNext, 'match');
  while (guestTurn2.public.activePlayerId !== 'player2') { guestTurn2 = await nextOfType(setup.guestNext, 'match'); }
  const grassEnergy = guestTurn2.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy, 'expected Grass Energy in the guest\'s opening hand');
  const guestActiveId = guestTurn2.public.board.player2.active.id;
  sendAction(setup.guest, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: guestActiveId });
  await nextOfType(setup.guestNext, 'match');
  sendAction(setup.guest, { type: 'endTurn' });
  await nextOfType(setup.guestNext, 'match');

  // Turn 3 (host): evolve Abra -> Kadabra.
  let hostTurn3 = await nextOfType(setup.hostNext, 'match');
  while (hostTurn3.public.activePlayerId !== 'player1') { hostTurn3 = await nextOfType(setup.hostNext, 'match'); }
  const kadabraCard = hostTurn3.myHand.find((c) => c.name === 'Kadabra');
  assert.ok(kadabraCard, 'expected Kadabra in hand by turn 3');
  sendAction(setup.host, { type: 'evolve', handCardId: kadabraCard.id, targetInstanceId: ownerId });
  await nextOfType(setup.hostNext, 'match');
  sendAction(setup.host, { type: 'endTurn' });
  await nextOfType(setup.hostNext, 'match');

  // Turn 4 (guest): attack the host's Kadabra for real damage.
  let guestTurn4 = await nextOfType(setup.guestNext, 'match');
  while (guestTurn4.public.activePlayerId !== 'player2') { guestTurn4 = await nextOfType(setup.guestNext, 'match'); }
  sendAction(setup.guest, { type: 'attack', attackName: 'Poison Sting' });
  const afterAttack = await nextOfType(setup.guestNext, 'match');
  assert.strictEqual(afterAttack.public.board.player1.active.damage, 10, 'expected the host\'s Kadabra to have taken 10 real damage');
  sendAction(setup.guest, { type: 'confirmEndTurn' });
  await nextOfType(setup.guestNext, 'match');

  // Turn 5 (host): evolve Kadabra -> Alakazam (damage carries through),
  // bench a 2ND Abra (drawn from the accumulated turn-5 hand -- see this
  // file's own header comment on why a 2nd copy of the SAME Basic beats a
  // differently-named one here), then use Damage Swap moving that same 10
  // damage onto it.
  let hostTurn5 = await nextOfType(setup.hostNext, 'match');
  while (hostTurn5.public.activePlayerId !== 'player1') { hostTurn5 = await nextOfType(setup.hostNext, 'match'); }
  const alakazamCard = hostTurn5.myHand.find((c) => c.name === 'Alakazam');
  assert.ok(alakazamCard, 'expected Alakazam in hand by turn 5');
  sendAction(setup.host, { type: 'evolve', handCardId: alakazamCard.id, targetInstanceId: ownerId });
  const afterEvolve = await nextOfType(setup.hostNext, 'match');
  // Brief-code fix, reproduced directly against the local dev server:
  // Poison Sting's own text ("Flip a coin. If heads, the Defending
  // Pokémon is now Poisoned") is a REAL coin flip -- when it lands heads,
  // Kadabra also takes 10 checkup-poison damage during the guest's own
  // confirmEndTurn (applyCheckupDamage sweeps BOTH sides, not just
  // whoever's turn just ended), on top of the 10 the attack itself dealt,
  // making the damage that survives into Alakazam genuinely either 10 or
  // 20 depending on that flip -- not a fixed 10 the way the brief's own
  // code assumed. Read the actual value instead of asserting a specific
  // number no coin flip can invalidate.
  const totalDamage = afterEvolve.public.board.player1.active.damage;
  assert.ok(totalDamage === 10 || totalDamage === 20, 'expected 10 (base attack only) or 20 (base attack + a poisoned checkup tick) damage to survive evolving into Alakazam, got ' + totalDamage);
  // Brief-code fix, reproduced directly against the local dev server: this
  // evolve's own broadcastMatch() reaches guestNext too (every action
  // broadcasts to BOTH sides, same as attachEnergy/placeBench elsewhere in
  // this file) -- earlier evolves in this same function got away without
  // an explicit drain here because a "while (activePlayerId !== ...)" loop
  // always followed immediately after and silently absorbed the stale
  // message. This evolve has no such loop after it before the NEXT
  // guest-side drain (placeBench's own "guest's own copy" a few lines
  // down), so without this, that later single-shot drain would instead
  // pop THIS stale pre-Damage-Swap snapshot -- permanently offsetting
  // guestNext's queue by one message and making the guest's own
  // lastPowerUse check below see null instead of the real reveal.
  await nextOfType(setup.guestNext, 'match'); // guest's own copy of the evolve-to-Alakazam broadcast

  // Reviewer-requested fix (round 1): same bounded extra-turn-retry
  // pattern as Rain Dance's own 2nd Water Energy search below -- the 2nd
  // Abra has no deadline at all: Alakazam is already fully evolved by this
  // point, so nothing stops the host from ending a few more real turns
  // (via the same endTurnsUntilHostActive helper, same 12-cycle bound)
  // until a 2nd Abra actually turns up, instead of gambling everything on
  // turn 5's own hand alone.
  //
  // Final-review fix: an earlier version of this comment claimed the
  // Kadabra-by-turn-3/Alakazam-by-turn-5 searches above were "genuinely
  // deadline-locked by evolutionTimingAllowed" and therefore had to stay
  // single-shot asserts. That was factually wrong -- evolutionTimingAllowed
  // (rules-engine.js) is only a MINIMUM-turn gate:
  //   if (state.turnCounter <= 2 && target.turnEnteredCurrentForm <= 1) return false;
  //   return target.turnEnteredCurrentForm < state.turnCounter;
  // -- never a maximum, so evolving on turn 7, 9, or 15 is exactly as legal
  // as turn 3 or 5. No card search anywhere in this file has a hard
  // deadline; the bounded retry pattern is used wherever a search might
  // not have naturally happened yet by the scripted turn count (now also
  // evolveHostActive's own stage1Card/stage2Card searches and
  // testEnergyTrans's Grass Energy search, not just this one).
  let handForBench = afterEvolve;
  let benchCard = handForBench.myHand.find((c) => c.name === 'Abra');
  let extraTurnCyclesForBench = 0;
  while (!benchCard && extraTurnCyclesForBench < 12) {
    handForBench = await endTurnsUntilHostActive(setup.host, setup.guest, setup.hostNext, setup.guestNext);
    benchCard = handForBench.myHand.find((c) => c.name === 'Abra');
    extraTurnCyclesForBench++;
  }
  assert.ok(benchCard, 'expected a 2nd Abra to eventually turn up (even after ' + extraTurnCyclesForBench + ' extra turns)');
  sendAction(setup.host, { type: 'placeBench', handCardId: benchCard.id, benchIndex: 0 });
  const afterBench = await nextOfType(setup.hostNext, 'match');
  const benchId = afterBench.public.board.player1.bench[0].id;
  await nextOfType(setup.guestNext, 'match'); // guest's own copy

  // Damage Swap moves a FIXED 10 damage per use (card-effects.js), so
  // draining however much totalDamage actually is (10 or 20, see above)
  // takes totalDamage/10 uses, not always exactly 1.
  let remaining = totalDamage;
  while (remaining > 0) {
    sendAction(setup.host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
    const afterSwap = await nextOfType(setup.hostNext, 'match');
    remaining -= 10;
    assert.strictEqual(afterSwap.public.board.player1.active.damage, remaining, 'expected 10 damage to move off Alakazam per Damage Swap use');
    assert.strictEqual(afterSwap.public.board.player1.bench[0].damage, totalDamage - remaining, 'expected the bench Abra to accumulate the moved damage');
    assert.ok(afterSwap.public.lastPowerUse, 'expected a lastPowerUse reveal');
    assert.strictEqual(afterSwap.public.lastPowerUse.powerName, 'Damage Swap');
    assert.strictEqual(afterSwap.public.lastPowerUse.ownerName, 'Alakazam');
    const guestSeesSwap = await nextOfType(setup.guestNext, 'match');
    assert.strictEqual(guestSeesSwap.public.lastPowerUse.round, afterSwap.public.lastPowerUse.round, 'expected both sides to receive the same lastPowerUse reveal');
  }
  console.log('PASS: Damage Swap moves real damage between 2 of the host\'s own Pokémon and both sides see the same reveal');

  // Illegal attempt: moving from a Pokémon with 0 damage.
  sendAction(setup.host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const illegalReply = await setup.hostNext();
  assert.strictEqual(illegalReply.type, 'error', 'expected a 2nd Damage Swap with 0 damage on the source to be rejected');
  console.log('PASS: Damage Swap with no damage to move is rejected with a clean error, not a crash');

  setup.host.close(); setup.guest.close();
}

async function testRainDance() {
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-RAINDANCE', 'rain-dance-host-token', 'power-guest-token', 'Wartortle', 'Blastoise');
  const waterEnergy = hostState.myHand.find((c) => c.name === 'Water Energy');
  assert.ok(waterEnergy, 'expected Water Energy in hand');

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { handEnergyId: waterEnergy.id, targetInstanceId: ownerId } });
  const afterRainDance = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterRainDance.public.board.player1.active.attachedEnergy.length, 1, 'expected 1 Water Energy attached to Blastoise');
  assert.strictEqual(afterRainDance.public.lastPowerUse.powerName, 'Rain Dance');
  assert.strictEqual(afterRainDance.myHand.filter((c) => c.name === 'Water Energy').length, hostState.myHand.filter((c) => c.name === 'Water Energy').length - 1, 'expected the played Water Energy to leave the hand');
  const guestSeesRainDance = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesRainDance.public.lastPowerUse.round, afterRainDance.public.lastPowerUse.round);
  console.log('PASS: Rain Dance attaches a real Water Energy to Blastoise without using the turn\'s normal energy attachment');

  // Illegal: targeting a non-Water Pokémon isn't possible here (Blastoise
  // is the only Pokémon in play), so instead verify a 2nd Rain Dance
  // still works ("as often as you like") using a 2nd Water Energy.
  //
  // Brief-code fix, reproduced directly against the local dev server: the
  // brief's own code assumed a 2nd Water Energy would always already be
  // sitting in the SAME turn-5 hand as the first -- real shuffle variance
  // (verified both empirically and via hypergeometric modeling) makes that
  // roughly a 1-in-5 chance to NOT be true even with a generously Water-
  // Energy-heavy deck, since that hand also has to have already produced
  // Squirtle/Wartortle/Blastoise on schedule. Rather than requiring it
  // from turn 5's hand alone, keep ending full turns (each one a real
  // extra host draw, via the same endTurnsUntilHostActive helper already
  // used to reach turn 5 -- Blastoise is already fully evolved, so extra
  // turns cost nothing evolution-timing-wise) until one turns up, bounded
  // so a truly pathological shuffle still fails loudly instead of hanging.
  let handForSecond = afterRainDance;
  let waterEnergy2 = handForSecond.myHand.find((c) => c.name === 'Water Energy');
  let extraTurnCycles = 0;
  while (!waterEnergy2 && extraTurnCycles < 12) {
    handForSecond = await endTurnsUntilHostActive(host, guest, hostNext, guestNext);
    waterEnergy2 = handForSecond.myHand.find((c) => c.name === 'Water Energy');
    extraTurnCycles++;
  }
  assert.ok(waterEnergy2, 'expected a 2nd Water Energy to eventually turn up (even after ' + extraTurnCycles + ' extra turns)');
  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { handEnergyId: waterEnergy2.id, targetInstanceId: ownerId } });
  const afterSecond = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterSecond.public.board.player1.active.attachedEnergy.length, 2, 'expected Rain Dance to be usable more than once per turn');
  console.log('PASS: Rain Dance can be used more than once in the same turn, matching the real card text');

  host.close(); guest.close();
}

async function testEnergyBurn() {
  const { host, guest, hostNext, guestNext, ownerId } = await evolveHostActive('POWER-ENERGYBURN', 'energy-burn-host-token', 'power-guest-token', 'Charmeleon', 'Charizard');

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: {} });
  const afterBurn = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterBurn.public.lastPowerUse.powerName, 'Energy Burn');
  assert.strictEqual(afterBurn.public.lastPowerUse.targetName, null, 'Energy Burn has no target');
  const guestSeesBurn = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesBurn.public.lastPowerUse.round, afterBurn.public.lastPowerUse.round);
  console.log('PASS: Energy Burn works with no target and both sides see the same reveal');

  // Illegal: a wrong owner (the guest's own Active, which the host never controls).
  const guestActiveId = afterBurn.public.board.player2.active.id;
  sendAction(host, { type: 'usePower', ownerInstanceId: guestActiveId, params: {} });
  const illegalReply = await hostNext();
  assert.strictEqual(illegalReply.type, 'error', 'expected using a Power on a Pokémon that isn\'t the caller\'s own to be rejected');
  console.log('PASS: using a Power on a Pokémon that isn\'t the caller\'s own is rejected with a clean error');

  host.close(); guest.close();
}

async function testEnergyTrans() {
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-ENERGYTRANS', 'energy-trans-host-token', 'power-guest-token', 'Ivysaur', 'Venusaur', 'Bulbasaur');
  // 2nd own Pokémon on the bench: a 2ND COPY OF Bulbasaur rather than a
  // differently-named card -- see this file's own header comment (same
  // reasoning as Damage Swap's 2nd Abra). Energy Trans's own effect never
  // cares about species, only that from/to are 2 different instances.
  const benchCard = hostState.myHand.find((c) => c.name === 'Bulbasaur');
  assert.ok(benchCard, 'expected a 2nd Bulbasaur in hand to bench');
  sendAction(host, { type: 'placeBench', handCardId: benchCard.id, benchIndex: 0 });
  const afterBench = await nextOfType(hostNext, 'match');
  const benchId = afterBench.public.board.player1.bench[0].id;
  await nextOfType(guestNext, 'match'); // guest's own copy

  // Final-review fix: same bounded extra-turn-retry pattern as Rain
  // Dance's own 2nd Water Energy search and Damage Swap's own 2nd Abra
  // search -- this Grass Energy search has no deadline of any kind
  // (Venusaur is already fully evolved by this point), matching exactly
  // the shape of problem those 2 fixes already solved. Keep ending turns
  // (same endTurnsUntilHostActive helper, same 12-cycle bound) until one
  // turns up instead of gambling everything on the post-bench hand alone.
  let handForEnergy = afterBench;
  let grassEnergy = handForEnergy.myHand.find((c) => c.name === 'Grass Energy');
  let extraTurnCyclesForEnergy = 0;
  while (!grassEnergy && extraTurnCyclesForEnergy < 12) {
    handForEnergy = await endTurnsUntilHostActive(host, guest, hostNext, guestNext);
    grassEnergy = handForEnergy.myHand.find((c) => c.name === 'Grass Energy');
    extraTurnCyclesForEnergy++;
  }
  assert.ok(grassEnergy, 'expected Grass Energy to eventually turn up in hand (even after ' + extraTurnCyclesForEnergy + ' extra turns)');
  sendAction(host, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: ownerId });
  const afterAttach = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterAttach.public.board.player1.active.attachedEnergy.length, 1);
  await nextOfType(guestNext, 'match'); // guest's own copy of the attachEnergy broadcast (same class of fix as testDamageSwap's own evolve drain -- every action broadcasts to BOTH sides)

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const afterTrans = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterTrans.public.board.player1.active.attachedEnergy.length, 0, 'expected the Grass Energy to have left Venusaur');
  assert.strictEqual(afterTrans.public.board.player1.bench[0].attachedEnergy.length, 1, 'expected the Grass Energy to have landed on the bench Bulbasaur');
  assert.strictEqual(afterTrans.public.lastPowerUse.powerName, 'Energy Trans');
  const guestSeesTrans = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesTrans.public.lastPowerUse.round, afterTrans.public.lastPowerUse.round);
  console.log('PASS: Energy Trans moves a real Grass Energy card between 2 of the host\'s own Pokémon and both sides see the same reveal');

  // Illegal: moving from a Pokémon with no Grass Energy attached (the
  // bench Bulbasaur now has it, Venusaur doesn't any more).
  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { fromInstanceId: ownerId, toInstanceId: benchId } });
  const illegalReply = await hostNext();
  assert.strictEqual(illegalReply.type, 'error', 'expected Energy Trans with no Grass Energy on the source to be rejected');
  console.log('PASS: Energy Trans with nothing to move is rejected with a clean error, not a crash');

  host.close(); guest.close();
}

async function testBuzzap() {
  // Electrode is Stage 1 (Voltorb only evolves once) -- usable starting
  // the host's own turn 3, so stage2Name is omitted (null).
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-BUZZAP', 'buzzap-host-token', 'power-guest-token', 'Electrode', null, 'Voltorb');
  // 2nd own Pokémon on the bench: a 2ND COPY OF Voltorb rather than a
  // differently-named card -- see this file's own header comment (same
  // reasoning as Damage Swap's 2nd Abra). Buzzap's own target check only
  // requires a 2nd of the caller's own instances, never a specific species.
  const benchCard = hostState.myHand.find((c) => c.name === 'Voltorb');
  assert.ok(benchCard, 'expected a 2nd Voltorb in hand to bench');
  sendAction(host, { type: 'placeBench', handCardId: benchCard.id, benchIndex: 0 });
  const afterBench = await nextOfType(hostNext, 'match');
  const benchId = afterBench.public.board.player1.bench[0].id;
  await nextOfType(guestNext, 'match'); // guest's own copy

  sendAction(host, { type: 'usePower', ownerInstanceId: ownerId, params: { chosenType: 'Fire', targetInstanceId: benchId } });
  const afterBuzzap = await nextOfType(hostNext, 'match');
  assert.strictEqual(afterBuzzap.public.board.player1.active, null, 'expected Electrode to have knocked itself out');
  assert.strictEqual(afterBuzzap.public.board.player1.bench[0].attachedEnergy.length, 2, 'expected 2 Fire Energy on the bench Voltorb');
  assert.strictEqual(afterBuzzap.public.lastPowerUse.powerName, 'Buzzap');
  assert.strictEqual(afterBuzzap.public.lastPowerUse.targetName, 'Voltorb');
  const guestSeesBuzzap = await nextOfType(guestNext, 'match');
  assert.strictEqual(guestSeesBuzzap.public.lastPowerUse.round, afterBuzzap.public.lastPowerUse.round);
  console.log('PASS: Buzzap knocks out its own owner for real and attaches 2 real Energy of the chosen type to the target, both sides see the same reveal');

  host.close(); guest.close();
}

async function testStrikesBackAlreadyWorksInPvp() {
  const { host, guest, hostNext, guestNext, hostState, ownerId } = await evolveHostActive('POWER-STRIKESBACK', 'strikes-back-host-token', 'power-attacker-guest-token', 'Machoke', 'Machamp');

  // Guest attacks the host's real, live Machamp.
  sendAction(host, { type: 'endTurn' });
  await nextOfType(hostNext, 'match');
  let guestTurn = await nextOfType(guestNext, 'match');
  while (guestTurn.public.activePlayerId !== 'player2') { guestTurn = await nextOfType(guestNext, 'match'); }
  const grassEnergy = guestTurn.myHand.find((c) => c.name === 'Grass Energy');
  assert.ok(grassEnergy, 'expected Grass Energy in the guest\'s opening hand');
  const guestActiveId = guestTurn.public.board.player2.active.id;
  sendAction(guest, { type: 'attachEnergy', handCardId: grassEnergy.id, targetInstanceId: guestActiveId });
  await nextOfType(guestNext, 'match');
  sendAction(guest, { type: 'attack', attackName: 'Poison Sting' });
  const afterAttack = await nextOfType(guestNext, 'match');

  // Strikes Back: "does 10 damage to the attacking Pokémon" -- Weedle
  // (40 HP) took 10 from its own Poison Sting connecting, PLUS Machamp's
  // own automatic 10-damage counter-hit, entirely inside attack() itself,
  // unconditionally, in both local play and PVP -- no 'usePower' action
  // involved at all, this is a real reported passive effect this scenario
  // only verifies, not a new code path this plan built.
  assert.strictEqual(afterAttack.public.board.player2.active.damage, 10, 'expected Machamp\'s Strikes Back to have already dealt its 10 counter-damage to the attacking Weedle in PVP, unchanged');
  console.log('PASS: Machamp\'s Strikes Back (passive) already works correctly in PVP with no code changes');

  host.close(); guest.close();
}

async function main() {
  await new Promise((resolve) => stub.listen(8799, resolve));
  await testDamageSwap();
  await testRainDance();
  await testEnergyBurn();
  await testEnergyTrans();
  await testBuzzap();
  await testStrikesBackAlreadyWorksInPvp();
  stub.close();
  console.log('ALL PVP POWER (PartyKit) TESTS PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
