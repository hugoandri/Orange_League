// Same pattern as pvpRoom.test.js -- see that file's header. This file
// assumes a room has already been created/joined/readied (Task 6's flow)
// and focuses on submitMatchAction itself.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, collection } = require('firebase/firestore');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

async function signInAsPlayer(email) {
  const existing = await admin.auth().getUserByEmail(email).catch(() => null);
  const uid = existing ? existing.uid : (await admin.auth().createUser({ email: email, password: 'password123' })).uid;
  await admin.firestore().collection('users').doc(uid).set({ coins: 500, collection: {} }, { merge: true });
  await signInWithEmailAndPassword(auth, email, 'password123');
  return uid;
}

// Deals with a real shuffled hand -- returns whatever Basic Pokémon (or
// Trainer/Energy) card ids the caller's own private hand doc actually has,
// so tests don't assume any specific card ended up in a random hand.
async function getPrivateHand(matchId, uid) {
  const snap = await admin.firestore().collection('matches').doc(matchId).collection('private').doc(uid).get();
  return snap.data().hand;
}
function isBasic(cardName, CARD_STATS) {
  var stats = CARD_STATS[cardName];
  return !!stats && stats.supertype === 'Pokémon' && !stats.evolvesFrom;
}

async function main() {
  const createRoom = httpsCallable(functions, 'createRoom');
  const joinRoom = httpsCallable(functions, 'joinRoom');
  const setReady = httpsCallable(functions, 'setReady');
  const submitMatchAction = httpsCallable(functions, 'submitMatchAction');
  const { CARD_STATS } = require('../lib/dataCards');

  await signInAsPlayer('pvpm-host@example.com');
  const createRes = await createRoom({ deckId: 'overgrowth' });
  const roomCode = createRes.data.roomCode;
  const hostUid = (await admin.firestore().collection('rooms').doc(roomCode).get()).data().hostUid;

  await signOut(auth);
  const guestUid = await signInAsPlayer('pvpm-guest@example.com');
  await joinRoom({ roomCode: roomCode, deckId: 'blackout' });

  await signOut(auth);
  await signInAsPlayer('pvpm-host@example.com');
  await setReady({ roomCode: roomCode });
  await signOut(auth);
  await signInAsPlayer('pvpm-guest@example.com');
  const readyRes = await setReady({ roomCode: roomCode });
  const matchId = readyRes.data.matchId;

  try {
    await submitMatchAction({ matchId: matchId, action: { type: 'placeActive', handCardId: 'not-a-real-id' } });
    assert.fail('expected placing an unowned card to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: placeActive rejects an unowned/invalid hand card id');
  }

  // Guest places their opening Basic. Opening hand size is normally 7, but
  // real rules give a bonus draw to whichever side's OPPONENT mulliganed
  // (see rules-engine.js's dealOpeningHand + createGame's post-mulligan
  // bonus-draw lines) -- since these tests shuffle with real Math.random,
  // a mulligan can genuinely happen on either side, so the expected
  // post-placeActive hand count is computed from the actual dealt hand
  // size rather than hardcoded, to avoid a rare, legitimate flake.
  const guestHand = await getPrivateHand(matchId, guestUid);
  const guestBasic = guestHand.find(function (c) { return isBasic(c.name, CARD_STATS); });
  await submitMatchAction({ matchId: matchId, action: { type: 'placeActive', handCardId: guestBasic.id } });
  let pub = (await admin.firestore().collection('matches').doc(matchId).get()).data();
  assert.strictEqual(pub.board.player2.active.name, guestBasic.name);
  assert.strictEqual(pub.handCount.player2, guestHand.length - 1);
  console.log('PASS: placeActive moves the named hand card onto the board and out of the private hand count');

  try {
    await submitMatchAction({ matchId: matchId, action: { type: 'confirmSetup' } });
    assert.fail('expected confirmSetup to be rejected before the host has placed an Active');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: confirmSetup rejects a side with no Active placed yet');
  }

  await signOut(auth);
  await signInAsPlayer('pvpm-host@example.com');
  const hostHand = await getPrivateHand(matchId, hostUid);
  const hostBasic = hostHand.find(function (c) { return isBasic(c.name, CARD_STATS); });

  try {
    await submitMatchAction({ matchId: matchId, action: { type: 'placeBench', handCardId: hostBasic.id, benchIndex: 0 } });
    assert.fail('expected placeBench to be rejected before this side has placed an Active');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: placeBench rejects a side with no Active placed yet');
  }

  await submitMatchAction({ matchId: matchId, action: { type: 'placeActive', handCardId: hostBasic.id } });
  await submitMatchAction({ matchId: matchId, action: { type: 'confirmSetup' } });
  pub = (await admin.firestore().collection('matches').doc(matchId).get()).data();
  assert.strictEqual(pub.phase, 'setup', 'still setup -- only host confirmed so far');

  await signOut(auth);
  await signInAsPlayer('pvpm-guest@example.com');
  await submitMatchAction({ matchId: matchId, action: { type: 'confirmSetup' } });
  pub = (await admin.firestore().collection('matches').doc(matchId).get()).data();
  assert.strictEqual(pub.phase, 'playing', 'both confirmed -- startMatch() ran');
  assert.ok(pub.activePlayerId === 'player1' || pub.activePlayerId === 'player2', 'coin flip decided a real starting side');
  console.log('PASS: confirmSetup from both sides starts the match (coin flip + playing phase)');

  // Whoever the coin flip picked attaches an Energy card if they have one,
  // otherwise just ends their turn -- keep this test deck-agnostic rather
  // than assuming a specific starting hand.
  async function currentTurnUid() {
    const p = (await admin.firestore().collection('matches').doc(matchId).get()).data();
    return p.activePlayerId === 'player1' ? hostUid : guestUid;
  }
  async function signInAsUid(uid) {
    await signOut(auth);
    const email = uid === hostUid ? 'pvpm-host@example.com' : 'pvpm-guest@example.com';
    await signInWithEmailAndPassword(auth, email, 'password123');
  }

  const firstTurnUid = await currentTurnUid();
  await signInAsUid(firstTurnUid);
  const firstHand = await getPrivateHand(matchId, firstTurnUid);
  const energyCard = firstHand.find(function (c) { return c.name.indexOf('Energy') !== -1 && c.name !== 'Double Colorless Energy'; });

  if (energyCard) {
    const pubBefore = (await admin.firestore().collection('matches').doc(matchId).get()).data();
    const mySide = pubBefore.activePlayerId; // 'player1' | 'player2'
    const activeView = mySide === 'player1' ? pubBefore.board.player1.active : pubBefore.board.player2.active;
    await submitMatchAction({ matchId: matchId, action: { type: 'attachEnergy', handCardId: energyCard.id, targetInstanceId: activeView.id } });
    const pubAfter = (await admin.firestore().collection('matches').doc(matchId).get()).data();
    const activeAfter = mySide === 'player1' ? pubAfter.board.player1.active : pubAfter.board.player2.active;
    assert.strictEqual(activeAfter.attachedEnergy.length, activeView.attachedEnergy.length + 1);
    console.log('PASS: attachEnergy moves the named hand card onto the target and shows up in the public board view');
  } else {
    console.log('SKIP: no Energy card in this random opening hand to test attachEnergy with');
  }

  const mySideBeforeEndTurn = (await admin.firestore().collection('matches').doc(matchId).get()).data().activePlayerId;
  try {
    await submitMatchAction({ matchId: matchId, action: { type: 'endTurn' } });
  } catch (e) { assert.fail('endTurn should be legal for whoever\'s turn it is: ' + e.message); }
  const pubAfterEndTurn = (await admin.firestore().collection('matches').doc(matchId).get()).data();
  assert.strictEqual(pubAfterEndTurn.turnCounter, 2);
  assert.notStrictEqual(pubAfterEndTurn.activePlayerId, mySideBeforeEndTurn);
  console.log('PASS: endTurn advances turnCounter and flips activePlayerId');

  try {
    await submitMatchAction({ matchId: matchId, action: { type: 'endTurn' } });
    assert.fail('expected the player who just ended their turn to be rejected calling endTurn again immediately');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: endTurn rejects a call from the side that no longer holds the turn');
  }

  // --- vanilla attack -> KO -> prize -> winner, contrived board state ---
  // Directly manipulating serverOnly/state via the Admin SDK to force a
  // deterministic lethal setup (real gameplay RNG makes "attack for exactly
  // lethal damage" hard to arrange from a real shuffled match) is the
  // pragmatic approach here -- every other functions test file in this repo
  // that needs a specific board state does the same (see
  // rareOdds.test.js's pattern of seeding exact Firestore docs directly).
  const { ATTACK_EFFECTS } = require('../lib/cardEffects');
  const { redactMatchState, canAttack } = require('../lib/rulesEngine');
  // rules-engine.js's functions reference CARD_STATS as a bare global (see
  // index.js's own identical setup, required for the exact same reason,
  // right before it requires rulesEngine.js) -- this test process never
  // loads index.js, so canAttack() below would otherwise throw a
  // ReferenceError the instant it looked up CARD_STATS[p.active.name].
  global.CARD_STATS = CARD_STATS;
  // Find a real Base Set attack with no ATTACK_EFFECTS entry (vanilla) and
  // one WITH an entry (special, must be rejected) by inspecting the loaded
  // tables directly -- keeps this test resilient to which specific cards
  // exist rather than hardcoding a card name that might not be in overgrowth/blackout.
  let vanillaAttackerName, vanillaAttackName, specialAttackerName, specialAttackName;
  Object.keys(CARD_STATS).forEach(function (name) {
    (CARD_STATS[name].attacks || []).forEach(function (atk) {
      if (!vanillaAttackerName && !(ATTACK_EFFECTS[name] && ATTACK_EFFECTS[name][atk.name])) {
        vanillaAttackerName = name; vanillaAttackName = atk.name;
      }
      if (!specialAttackerName && ATTACK_EFFECTS[name] && ATTACK_EFFECTS[name][atk.name]) {
        specialAttackerName = name; specialAttackName = atk.name;
      }
    });
  });
  assert.ok(vanillaAttackerName && specialAttackerName, 'test setup needs at least one vanilla and one special attack in the catalog');

  const matchDocRef = admin.firestore().collection('matches').doc(matchId);
  const serverOnlyRef = matchDocRef.collection('serverOnly').doc('state');
  const seeded = (await serverOnlyRef.get()).data().state;
  seeded.phase = 'playing';
  seeded.activePlayerId = 'player';

  function makeActive(id, name, damage) {
    return { id: id, name: name, attachedEnergy: [], damage: damage || 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null, severePoison: false, weaknessOverride: null, resistanceOverride: null, tempLockedAttack: null, lastDamageTaken: null, energyBurnActive: false };
  }

  // NOTE ON FIXTURE DESIGN (deviates from the brief's literal Step 1 here):
  // the loop above picks the FIRST vanilla attacker/attack pair and the
  // FIRST special attacker/attack pair it finds independently -- in this
  // card catalog those come out to two DIFFERENT Pokemon (Kadabra's "Super
  // Psy" vs Beedrill's "Twineedle", which Kadabra doesn't even know). If
  // the rejection test put specialAttackName on the VANILLA Pokemon's
  // active slot (as the brief's single seeded board literally does),
  // canAttack() would reject it anyway for a totally different reason
  // (that attack isn't even in this Pokemon's own attack list) than the
  // ATTACK_EFFECTS check this task actually adds -- both produce the same
  // failed-precondition code, so that version of the test would pass
  // without ever proving the new check works. Fixed by seeding the
  // special-attack rejection against an active Pokemon that genuinely
  // knows that attack (specialAttackerName, cost fully paid), as a separate
  // board state from the vanilla-attack/KO scenario below, and by asserting
  // canAttack() directly to prove the attack really is otherwise-legal.
  const specialAtkDef = CARD_STATS[specialAttackerName].attacks.find(function (a) { return a.name === specialAttackName; });
  seeded.players.player.active = makeActive('specialTestAttacker', specialAttackerName, 0);
  seeded.players.player.active.attachedEnergy = (specialAtkDef.cost || []).slice();
  await serverOnlyRef.set({ state: seeded });
  await matchDocRef.set(redactMatchState(seeded, hostUid, guestUid).public);

  // Confirm locally that canAttack() alone would actually allow this attack
  // (real Pokemon, real attack, cost fully paid, no status blocking it) --
  // proves the rejection below comes from the new ATTACK_EFFECTS check
  // added in this task, not from canAttack() rejecting it for some other
  // reason.
  assert.strictEqual(canAttack(seeded, 'player', specialAttackName), true, 'test setup: this attack must be otherwise-legal so the ATTACK_EFFECTS rejection is what is actually being tested');

  await signInAsUid(hostUid); // engine slot 'player' == player1 == hostUid

  try {
    await submitMatchAction({ matchId: matchId, action: { type: 'attack', attackName: specialAttackName } });
    assert.fail('expected a special-effect attack to be rejected in Fase 1');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: a special-effect attack (present in ATTACK_EFFECTS) is rejected -- Fase 2 territory');
  }

  // Now the real vanilla-attack -> KO -> prize/winner scenario: reseed the
  // Active Pokemon on both sides directly (koTestAttacker/koTestDefender),
  // with the defender exactly one damage below its own KO threshold so any
  // real positive-damage vanilla attack finishes it off.
  const vanillaAtkDef = CARD_STATS[vanillaAttackerName].attacks.find(function (a) { return a.name === vanillaAttackName; });
  seeded.players.player.active = makeActive('koTestAttacker', vanillaAttackerName, 0);
  seeded.players.player.active.attachedEnergy = (vanillaAtkDef.cost || []).slice();
  seeded.players.cpu.active = makeActive('koTestDefender', 'Pidgey', CARD_STATS['Pidgey'].hp - 1);
  await serverOnlyRef.set({ state: seeded });
  await matchDocRef.set(redactMatchState(seeded, hostUid, guestUid).public);

  await submitMatchAction({ matchId: matchId, action: { type: 'attack', attackName: vanillaAttackName } });
  const pubAfterAttack = (await matchDocRef.get()).data();
  assert.strictEqual(pubAfterAttack.board.player2.active, null, 'defender was knocked out');
  assert.ok(pubAfterAttack.pendingPrizeChoice || pubAfterAttack.winner, 'a prize choice is pending, or the match already ended if that was the last prize');
  console.log('PASS: a vanilla attack applies real damage via the generic damage path and KOs correctly');

  // --- C4 regression: the guest's turn-start draw must not be skipped when
  // the HOST's turn ends via an ATTACK, not just via the explicit endTurn
  // action. endTurn() (rules-engine.js) only auto-draws for the literal
  // 'player' slot -- ai.js's cpuTakeTurn (the only other caller of
  // drawForTurnStart for 'cpu') never runs in PVP. attack() ends the turn
  // internally (endThisTurn() -> endTurn(state)) EVERY time it resolves,
  // unconditionally, regardless of KO -- so without this fix the guest
  // would lose their turn-start draw almost every turn cycle, since
  // attacking is the normal way a turn ends. ---
  // Re-seed a fresh, KO-free scenario (host's active can legally attack;
  // guest -- engine slot 'cpu', humanControlled true in this PVP match --
  // has no active Pokémon on the receiving end, so attack() takes its
  // early "no defender" return path, still ending the turn unconditionally
  // with no KO/prize-choice complexity to account for).
  const guestHandBeforeHostAttack = await getPrivateHand(matchId, guestUid);
  const drawTestSeed = (await serverOnlyRef.get()).data().state;
  drawTestSeed.phase = 'playing';
  drawTestSeed.activePlayerId = 'player';
  drawTestSeed.pendingPrizeChoice = null;
  drawTestSeed.pendingActiveChoice = null;
  drawTestSeed.players.player.active = makeActive('drawTestAttacker', vanillaAttackerName, 0);
  drawTestSeed.players.player.active.attachedEnergy = (vanillaAtkDef.cost || []).slice();
  drawTestSeed.players.cpu.active = null;
  await serverOnlyRef.set({ state: drawTestSeed });
  await matchDocRef.set(redactMatchState(drawTestSeed, hostUid, guestUid).public);

  await signInAsUid(hostUid); // engine slot 'player' == player1 == hostUid
  await submitMatchAction({ matchId: matchId, action: { type: 'attack', attackName: vanillaAttackName } });
  const pubAfterHostAttack = (await matchDocRef.get()).data();
  assert.strictEqual(pubAfterHostAttack.activePlayerId, 'player2', 'the host attacking ends their turn and hands it to the guest');
  const guestHandAfterHostAttack = await getPrivateHand(matchId, guestUid);
  assert.strictEqual(
    guestHandAfterHostAttack.length,
    guestHandBeforeHostAttack.length + 1,
    'the guest still gets their turn-start draw even though the host ended their turn via attack(), not the explicit endTurn action'
  );
  console.log('PASS (C4 regression): the guest gets a turn-start draw when the host ends their turn by attacking, not just via the explicit endTurn action');

  // --- Regression test (fix-wave re-review of C4): the draw-compensation
  // guard must fire EXACTLY ONCE per real turn handoff to the guest -- not
  // once per action the guest happens to submit while their turn is
  // already in progress. The bug: the original guard only checked "is it
  // currently the guest's turn AND are they humanControlled"
  // (state.activePlayerId !== 'player' && state.humanControlled[...]), with
  // no comparison against what activePlayerId was BEFORE the switch ran --
  // so it was true, and fired, for EVERY action the guest submitted during
  // their own turn (attachEnergy, retreat, ...), not just the one action
  // that started it. Left unfixed this draws the guest a free, unearned
  // card on every single action of their own turn, which can eventually
  // empty their deck (state.deckedOut) and auto-lose them via getWinner() --
  // a worse bug than the one the original C4 fix addressed. This test gets
  // the guest to their own turn (host calls the plain 'endTurn' action --
  // simpler than routing through attack() again, since that path is already
  // covered above), then has the guest submit TWO separate legal actions
  // (attachEnergy, then retreat) in that same turn without ever calling
  // endTurn in between, asserting the guest's hand only ever reflects the
  // ONE legitimate turn-start draw plus whatever a given action itself
  // legitimately removes from hand -- never an extra card per action.
  const regressionSeed = (await serverOnlyRef.get()).data().state;
  regressionSeed.phase = 'playing';
  regressionSeed.activePlayerId = 'player';
  regressionSeed.pendingPrizeChoice = null;
  regressionSeed.pendingActiveChoice = null;
  // Guest (engine slot 'cpu'): a retreatCost-0 Active (Rattata) plus a
  // Bench mon (Diglett) to retreat into, so retreat is legal without first
  // needing to attach enough Energy of the right type to pay a real
  // retreat cost -- keeps this fixture minimal and focused on the actual
  // bug (double-draw per action), not on satisfying retreat's cost rules.
  regressionSeed.players.cpu.active = makeActive('regressionGuestActive', 'Rattata', 0);
  regressionSeed.players.cpu.bench = [makeActive('regressionGuestBench', 'Diglett', 0), null, null, null, null];
  regressionSeed.players.cpu.energyAttachedThisTurn = false;
  regressionSeed.players.cpu.retreatedThisTurn = false;
  const regressionEnergyCardId = 'regression-energy-card';
  const regressionFillerCardId = 'regression-filler-card';
  // Hand fully replaced with a small, known set of cards (rather than
  // appended to whatever random hand this match happened to accumulate by
  // now) so the length math below is exact and easy to verify by hand.
  regressionSeed.players.cpu.hand = [
    { id: regressionFillerCardId, name: 'Rattata' },
    { id: regressionEnergyCardId, name: 'Grass Energy' }
  ];
  const regressionGuestHandLenBeforeTurnStart = regressionSeed.players.cpu.hand.length; // 2
  await serverOnlyRef.set({ state: regressionSeed });
  await matchDocRef.set(redactMatchState(regressionSeed, hostUid, guestUid).public);

  await signInAsUid(hostUid); // engine slot 'player' == player1 == hostUid
  await submitMatchAction({ matchId: matchId, action: { type: 'endTurn' } });
  const pubAfterRegressionEndTurn = (await matchDocRef.get()).data();
  assert.strictEqual(pubAfterRegressionEndTurn.activePlayerId, 'player2', 'ending the host\'s turn hands it to the guest');

  const guestHandAfterTurnStartDraw = await getPrivateHand(matchId, guestUid);
  assert.strictEqual(
    guestHandAfterTurnStartDraw.length,
    regressionGuestHandLenBeforeTurnStart + 1,
    'guest gets exactly the one legitimate turn-start draw when the turn transitions to them'
  );

  // Guest's FIRST action of their own turn: attachEnergy. Legitimate
  // behavior removes exactly the one played card from hand and draws
  // nothing further. Under the bug, the guard would ALSO fire here (it only
  // checked "is it currently the guest's turn", true for this call too),
  // masking as a net-ZERO hand-size change (-1 for the card played, +1 for
  // the phantom draw) instead of the real -1 -- so this assertion catches
  // the regression even though the hand still shrinks somewhat.
  await signInAsUid(guestUid);
  const guestActiveId = pubAfterRegressionEndTurn.board.player2.active.id;
  await submitMatchAction({ matchId: matchId, action: { type: 'attachEnergy', handCardId: regressionEnergyCardId, targetInstanceId: guestActiveId } });
  const guestHandAfterAttachEnergy = await getPrivateHand(matchId, guestUid);
  assert.strictEqual(
    guestHandAfterAttachEnergy.length,
    guestHandAfterTurnStartDraw.length - 1,
    'REGRESSION: attachEnergy during the guest\'s own already-in-progress turn must not trigger a second, unearned turn-start draw'
  );

  // Guest's SECOND action of the SAME turn (still no endTurn in between):
  // retreat. Legitimate behavior touches no hand cards at all (net zero) --
  // under the bug, the guard would fire yet again, adding another phantom
  // card.
  const pubBeforeRegressionRetreat = (await matchDocRef.get()).data();
  const guestBenchInstance = pubBeforeRegressionRetreat.board.player2.bench.find(function (b) { return b; });
  await submitMatchAction({ matchId: matchId, action: { type: 'retreat', targetInstanceId: guestBenchInstance.id } });
  const guestHandAfterRetreat = await getPrivateHand(matchId, guestUid);
  assert.strictEqual(
    guestHandAfterRetreat.length,
    guestHandAfterAttachEnergy.length,
    'REGRESSION: retreat during the guest\'s own already-in-progress turn must not trigger a second, unearned turn-start draw either'
  );
  const pubAfterRegressionRetreat = (await matchDocRef.get()).data();
  assert.strictEqual(pubAfterRegressionRetreat.activePlayerId, 'player2', 'still the guest\'s turn after retreat -- retreat does not end the turn');
  console.log('PASS (regression, fix-wave re-review): the guest does not get an extra unearned draw for each additional action taken during their own already-in-progress turn');

  console.log('ALL PVP MATCH TESTS PASSED (setup + generic turn actions + vanilla attacks)');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
