// Same emulator env vars / createUser / idTokenFor pattern as
// functions/test/resolvePvpIdentity.test.js. The onCall function
// (getActiveMatch) is exercised through the firebase client SDK's
// httpsCallable, the same proven mechanism functions/test/callable.test.js
// already uses for other onCall functions (awardMatchResult, etc.) --
// hand-crafting the onCall wire envelope/headers against the emulator by
// hand isn't a stable shape to depend on across firebase-functions versions.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });
const assert = require('assert');

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');

const clientApp = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'activeMatchClient');
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
const clientFunctions = getFunctions(clientApp);
connectFunctionsEmulator(clientFunctions, '127.0.0.1', 5001);

const SECRET = 'change-me-in-production-party-internal-secret';
const PASSWORD = 'password123';

async function createUser(email) {
  const user = await admin.auth().createUser({ email: email, password: PASSWORD });
  await admin.firestore().collection('users').doc(user.uid).set({
    username: 'jugador', photo: null, coins: 500, collection: {},
    collectionHolo: {}, collectionSecret: {}, cardBacks: [], customDecks: {}
  });
  return user.uid;
}

async function callFn(name, body) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

// getActiveMatch is an onCall function -- called through the firebase
// client SDK (signed in as the target user), same as callable.test.js
// calls awardMatchResult/updateProfile/etc.
async function callGetActiveMatch(email) {
  await signInWithEmailAndPassword(clientAuth, email, PASSWORD);
  const getActiveMatch = httpsCallable(clientFunctions, 'getActiveMatch');
  const res = await getActiveMatch();
  await clientAuth.signOut();
  return res;
}

async function main() {
  const uidEmail = 'activematch1@test.com';
  const uid = await createUser(uidEmail);

  const badSecret = await callFn('registerActiveMatch', { uid: uid, roomCode: 'ABC123', secret: 'wrong' });
  assert.strictEqual(badSecret.status, 401);
  console.log('PASS: registerActiveMatch rejects the wrong secret');

  const missing = await callFn('registerActiveMatch', { uid: uid, secret: SECRET });
  assert.strictEqual(missing.status, 400);
  console.log('PASS: registerActiveMatch rejects a missing roomCode');

  const registered = await callFn('registerActiveMatch', { uid: uid, roomCode: 'ABC123', secret: SECRET });
  assert.strictEqual(registered.status, 200);
  console.log('PASS: registerActiveMatch accepts a valid call');

  const looked = await callGetActiveMatch(uidEmail);
  assert.strictEqual(looked.data.roomCode, 'ABC123');
  console.log('PASS: getActiveMatch returns the registered roomCode for its own caller');

  const cleared = await callFn('clearActiveMatch', { uid: uid, secret: SECRET });
  assert.strictEqual(cleared.status, 200);
  console.log('PASS: clearActiveMatch accepts a valid call');

  const lookedAfter = await callGetActiveMatch(uidEmail);
  assert.strictEqual(lookedAfter.data.roomCode, null);
  console.log('PASS: getActiveMatch returns null once cleared');

  const otherEmail = 'activematch2@test.com';
  await createUser(otherEmail);
  await callFn('registerActiveMatch', { uid: uid, roomCode: 'XYZ789', secret: SECRET });
  const otherLook = await callGetActiveMatch(otherEmail);
  assert.strictEqual(otherLook.data.roomCode, null);
  console.log("PASS: getActiveMatch never returns another uid's active match");

  console.log('ALL activeMatch TESTS PASSED');
  process.exit(0);
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
