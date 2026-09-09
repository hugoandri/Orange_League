// Same emulator/custom-token pattern as functions/test/giftCodes.test.js.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });
const assert = require('assert');

async function createUser(email, extra) {
  const user = await admin.auth().createUser({ email: email, password: 'password123' });
  await admin.firestore().collection('users').doc(user.uid).set(Object.assign({
    username: 'jugador', photo: null, coins: 500, collection: {},
    collectionHolo: {}, collectionSecret: {}, cardBacks: [], customDecks: {}
  }, extra || {}));
  return user.uid;
}

async function idTokenFor(uid) {
  // The Auth emulator's REST API exchanges a custom token for a real ID
  // token -- admin.auth().createCustomToken() alone isn't verifiable by
  // admin.auth().verifyIdToken() the way a real client-issued ID token is.
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const data = await res.json();
  return data.idToken;
}

async function callResolvePvpIdentity(body) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/resolvePvpIdentity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const uid = await createUser('rpi1@test.com', {
    collectionHolo: { 'base-6': 1 }, collectionSecret: {}
  });
  const idToken = await idTokenFor(uid);

  const badToken = await callResolvePvpIdentity({ idToken: 'not-a-real-token', deckId: 'overgrowth', cardBackId: 'clasico' });
  assert.strictEqual(badToken.status, 401);
  console.log('PASS: an invalid ID token is rejected with 401');

  const badDeck = await callResolvePvpIdentity({ idToken: idToken, deckId: 'not-a-real-deck', cardBackId: 'clasico' });
  assert.strictEqual(badDeck.status, 400);
  console.log('PASS: an invalid deckId is rejected with 400');

  const ok = await callResolvePvpIdentity({ idToken: idToken, deckId: 'overgrowth', cardBackId: 'protector_messi' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.uid, uid);
  assert.strictEqual(ok.data.deckKey, 'overgrowth');
  assert.strictEqual(ok.data.customDeckCards, null);
  console.log('PASS: a real precon deckId resolves deckKey unchanged, customDeckCards null');

  assert.strictEqual(ok.data.cardBackId, 'clasico');
  console.log('PASS: an unowned protector silently falls back to clasico');

  assert.deepStrictEqual(ok.data.collectionHolo, { 'base-6': 1 });
  console.log('PASS: the real collectionHolo comes through unchanged');

  const customUid = await createUser('rpi2@test.com', {
    customDecks: { 'custom-1': { name: 'Mi Mazo', cards: ['Charmander', 'Charmander'], coverName: 'Charmander' } }
  });
  const customIdToken = await idTokenFor(customUid);
  const customRes = await callResolvePvpIdentity({ idToken: customIdToken, deckId: 'custom:custom-1', cardBackId: 'clasico' });
  assert.strictEqual(customRes.status, 200);
  assert.strictEqual(customRes.data.deckKey, 'pvp_' + customUid + '_custom-1');
  assert.deepStrictEqual(customRes.data.customDeckCards, ['Charmander', 'Charmander']);
  assert.strictEqual(customRes.data.deckCoverName, 'Charmander');
  console.log('PASS: a custom deckId resolves a synthetic key + its real card list + cover name');

  console.log('ALL resolvePvpIdentity TESTS PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
