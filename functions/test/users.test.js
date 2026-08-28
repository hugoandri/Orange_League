// Same admin-custom-token pattern as news.test.js -- see that file's header
// comment for why the Admin SDK is needed here instead of just the client SDK.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const assert = require('assert');

const ADMIN_UID = '4ViFsoJm7fMsop8eCS16u89wIxQ2';

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

async function signInAsAdmin() {
  await admin.auth().createUser({ uid: ADMIN_UID, email: 'admin@example.com', password: 'password123' }).catch(() => {});
  const token = await admin.auth().createCustomToken(ADMIN_UID);
  await signInWithCustomToken(auth, token);
}

async function signInAsNonAdmin() {
  await admin.auth().createUser({ email: 'notadmin-users@example.com', password: 'password123' }).catch(() => {});
  await signInWithEmailAndPassword(auth, 'notadmin-users@example.com', 'password123');
}

async function main() {
  const listUsers = httpsCallable(functions, 'listUsers');

  try {
    await listUsers();
    assert.fail('expected an unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: listUsers rejects an unauthenticated call');
  }

  await signInAsNonAdmin();
  try {
    await listUsers();
    assert.fail('expected a real but non-admin account to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: listUsers rejects a signed-in account that is not the admin uid');
  }
  await signOut(auth);

  // Seed a couple of user docs directly with the Admin SDK (bypasses
  // firestore.rules, same as production listUsers itself does).
  const db = admin.firestore();
  await db.collection('users').doc('fake-uid-rich').set({ username: 'RichPlayer', coins: 900, collection: {} });
  await db.collection('users').doc('fake-uid-poor').set({ username: 'PoorPlayer', coins: 50, collection: {} });
  await db.collection('users').doc('fake-uid-nocoins').set({ username: 'NoCoinsField', collection: {} });

  await signInAsAdmin();
  const res = await listUsers();
  const byUid = {};
  res.data.users.forEach((u) => { byUid[u.uid] = u; });

  assert.strictEqual(byUid['fake-uid-rich'].username, 'RichPlayer');
  assert.strictEqual(byUid['fake-uid-rich'].coins, 900);
  assert.strictEqual(byUid['fake-uid-poor'].coins, 50);
  assert.strictEqual(byUid['fake-uid-nocoins'].coins, 0, 'a doc with no coins field must default to 0, not crash or come back undefined');
  console.log('PASS: listUsers (as the real admin) returns every user doc with username + coins');

  const richIndex = res.data.users.findIndex((u) => u.uid === 'fake-uid-rich');
  const poorIndex = res.data.users.findIndex((u) => u.uid === 'fake-uid-poor');
  assert.ok(richIndex < poorIndex, 'expected users sorted by coins descending');
  console.log('PASS: listUsers sorts users by coins descending');

  console.log('ALL USERS TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
