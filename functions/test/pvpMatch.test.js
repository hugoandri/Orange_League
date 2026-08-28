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

  console.log('ALL PVP MATCH SETUP TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
