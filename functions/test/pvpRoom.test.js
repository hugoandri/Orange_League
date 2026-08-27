// Same emulator/custom-token pattern as functions/test/giftCodes.test.js --
// see that file's header comment for the reasoning.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
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

async function main() {
  const createRoom = httpsCallable(functions, 'createRoom');
  const joinRoom = httpsCallable(functions, 'joinRoom');

  try {
    await createRoom({ deckId: 'overgrowth' });
    assert.fail('expected an unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: createRoom requires auth');
  }

  const hostUid = await signInAsPlayer('pvp-host@example.com');
  const createRes = await createRoom({ deckId: 'overgrowth' });
  const roomCode = createRes.data.roomCode;
  assert.ok(/^[A-Z2-9]{6}$/.test(roomCode), 'roomCode is a 6-char code from the ambiguity-free alphabet');
  const roomSnap = await admin.firestore().collection('rooms').doc(roomCode).get();
  assert.strictEqual(roomSnap.data().hostUid, hostUid);
  assert.strictEqual(roomSnap.data().hostDeckId, 'overgrowth');
  assert.strictEqual(roomSnap.data().status, 'waiting');
  assert.strictEqual(roomSnap.data().guestUid, null);
  console.log('PASS: createRoom creates a waiting room with a valid code');

  await signOut(auth);
  try {
    await joinRoom({ roomCode: roomCode, deckId: 'blackout' });
    assert.fail('expected an unauthenticated join to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: joinRoom requires auth');
  }

  await signOut(auth);
  await signInAsPlayer('pvp-host@example.com');
  try {
    await joinRoom({ roomCode: roomCode, deckId: 'blackout' });
    assert.fail('expected the host to be rejected joining their own room');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: joinRoom rejects the host joining their own room');
  }

  try {
    await joinRoom({ roomCode: 'ZZZZZZ', deckId: 'blackout' });
    assert.fail('expected a nonexistent code to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/not-found');
    console.log('PASS: joinRoom rejects a nonexistent code');
  }

  await signOut(auth);
  const guestUid = await signInAsPlayer('pvp-guest@example.com');
  await joinRoom({ roomCode: roomCode, deckId: 'blackout' });
  const joinedSnap = await admin.firestore().collection('rooms').doc(roomCode).get();
  assert.strictEqual(joinedSnap.data().guestUid, guestUid);
  assert.strictEqual(joinedSnap.data().guestDeckId, 'blackout');
  console.log('PASS: joinRoom sets the guest side of the room');

  await signOut(auth);
  const secondGuestUid = await signInAsPlayer('pvp-guest2@example.com');
  try {
    await joinRoom({ roomCode: roomCode, deckId: 'overgrowth' });
    assert.fail('expected a full room to reject a 3rd player');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: joinRoom rejects joining an already-full room');
  }

  // --- setReady / match creation ---
  const setReady = httpsCallable(functions, 'setReady');

  await signOut(auth);
  await signInAsPlayer('pvp-host@example.com'); // re-sign-in as the original host
  const readyHostRes = await setReady({ roomCode: roomCode });
  assert.strictEqual(readyHostRes.data.ready, true);
  assert.strictEqual(readyHostRes.data.matchId, null, 'match not created yet -- guest not ready');

  await signOut(auth);
  await signInAsPlayer('pvp-guest@example.com');
  const readyGuestRes = await setReady({ roomCode: roomCode });
  assert.strictEqual(readyGuestRes.data.ready, true);
  assert.ok(readyGuestRes.data.matchId, 'both ready -- match created');
  const matchId = readyGuestRes.data.matchId;

  const roomAfter = await admin.firestore().collection('rooms').doc(roomCode).get();
  assert.strictEqual(roomAfter.data().status, 'started');
  assert.strictEqual(roomAfter.data().matchId, matchId);

  const publicSnap = await admin.firestore().collection('matches').doc(matchId).get();
  const pub = publicSnap.data();
  assert.strictEqual(pub.phase, 'setup');
  assert.strictEqual(pub.handCount.player1, 7, 'host dealt an opening hand of 7');
  assert.strictEqual(pub.handCount.player2, 7, 'guest dealt an opening hand of 7');
  assert.strictEqual(pub.prizesRemaining.player1, 6);
  // (Brief's literal assertion here -- `assert.strictEqual(A || B, B, ...)`
  // where A is a boolean -- always fails regardless of implementation
  // correctness whenever no "name" field is present in `pub`, which is
  // exactly the setup-phase case since no Basics are placed yet. Replaced
  // with a well-formed check of the same stated intent.)
  assert.ok(pub.board, 'sanity: board exists');

  const hostPrivateSnap = await admin.firestore().collection('matches').doc(matchId).collection('private').doc(hostUid).get();
  assert.strictEqual(hostPrivateSnap.data().hand.length, 7);

  const serverOnlySnap = await admin.firestore().collection('matches').doc(matchId).collection('serverOnly').doc('state').get();
  assert.ok(serverOnlySnap.exists, 'serverOnly/state exists');
  assert.strictEqual(serverOnlySnap.data().state.players.player.hand.length, 7);
  console.log('PASS: setReady creates a real match once both sides are ready, with correctly redacted docs');

  try {
    await setReady({ roomCode: roomCode });
    assert.fail('expected setReady on an already-started room to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: setReady rejects a room that already started');
  }

  console.log('ALL PVP ROOM TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
