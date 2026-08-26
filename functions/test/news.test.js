// Uses the Admin SDK (not just the client SDK, unlike the other test
// files) so it can mint a custom token for the EXACT hardcoded admin uid
// (functions/index.js's ADMIN_UID) -- there's no other way to sign in as
// that specific uid through the emulator without a real password-based
// account created ahead of time at that uid.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const assert = require('assert');

const ADMIN_UID = '4ViFsoJm7fMsop8eCS16u89wIxQ2';

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

async function signInAsAdmin() {
  await admin.auth().createUser({ uid: ADMIN_UID, email: 'admin@example.com', password: 'password123' }).catch(() => {});
  const token = await admin.auth().createCustomToken(ADMIN_UID);
  await signInWithCustomToken(auth, token);
}

async function signInAsNonAdmin() {
  await admin.auth().createUser({ email: 'notadmin-news@example.com', password: 'password123' }).catch(() => {});
  await signInWithEmailAndPassword(auth, 'notadmin-news@example.com', 'password123');
}

async function main() {
  const publishNews = httpsCallable(functions, 'publishNews');
  const updateNewsItem = httpsCallable(functions, 'updateNewsItem');
  const deleteNewsItem = httpsCallable(functions, 'deleteNewsItem');

  try {
    await publishNews({ title: 'x', body: 'y', tag: 'balance' });
    assert.fail('expected an unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: publishNews rejects an unauthenticated call');
  }

  await signInAsNonAdmin();
  try {
    await publishNews({ title: 'x', body: 'y', tag: 'balance' });
    assert.fail('expected a real but non-admin account to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: publishNews rejects a signed-in account that is not the admin uid');
  }
  await signOut(auth);

  await signInAsAdmin();

  try {
    await publishNews({ title: '', body: 'y', tag: 'balance' });
    assert.fail('expected an empty title to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: publishNews rejects an empty title');
  }

  try {
    await publishNews({ title: 'x', body: 'y', tag: 'not-a-real-tag' });
    assert.fail('expected an unknown tag to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: publishNews rejects a tag outside the 3 real styles');
  }

  const res1 = await publishNews({ title: 'Primera novedad', body: 'Cuerpo 1', tag: 'balance', featured: false });
  assert.ok(res1.data.id, 'expected a real doc id back');
  const snap1 = await getDoc(doc(db, 'news', res1.data.id));
  assert.strictEqual(snap1.data().title, 'Primera novedad');
  assert.strictEqual(snap1.data().tag, 'balance');
  assert.strictEqual(snap1.data().featured, false);
  console.log('PASS: publishNews (as the real admin) creates and persists a news doc with the real fields');

  const res2 = await publishNews({ title: 'Segunda', body: 'Cuerpo 2', tag: 'shop', featured: true });
  const snap2 = await getDoc(doc(db, 'news', res2.data.id));
  assert.strictEqual(snap2.data().featured, true);
  console.log('PASS: a news item can be published already marked featured');

  const res3 = await publishNews({ title: 'Tercera', body: 'Cuerpo 3', tag: 'notice', featured: true });
  const snap2After = await getDoc(doc(db, 'news', res2.data.id));
  const snap3 = await getDoc(doc(db, 'news', res3.data.id));
  assert.strictEqual(snap2After.data().featured, false, 'the previously-featured item must be un-featured');
  assert.strictEqual(snap3.data().featured, true, 'only the newest featured item stays featured');
  console.log('PASS: publishing a new featured item automatically un-features the previous one');

  const updateRes = await updateNewsItem({ id: res1.data.id, title: 'Primera (editada)', body: 'Cuerpo 1 editado', tag: 'notice', featured: false });
  assert.strictEqual(updateRes.data.id, res1.data.id);
  const snap1Updated = await getDoc(doc(db, 'news', res1.data.id));
  assert.strictEqual(snap1Updated.data().title, 'Primera (editada)');
  assert.strictEqual(snap1Updated.data().tag, 'notice');
  console.log('PASS: updateNewsItem edits an existing news doc\'s real fields');

  try {
    await updateNewsItem({ id: 'not-a-real-id', title: 'x', body: 'y', tag: 'balance' });
    assert.fail('expected updating a nonexistent id to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/not-found');
    console.log('PASS: updateNewsItem rejects a nonexistent id');
  }

  await deleteNewsItem({ id: res1.data.id });
  const snap1Deleted = await getDoc(doc(db, 'news', res1.data.id));
  assert.strictEqual(snap1Deleted.exists(), false);
  console.log('PASS: deleteNewsItem removes the news doc');

  await signOut(auth);
  try {
    await deleteNewsItem({ id: res2.data.id });
    assert.fail('expected deleteNewsItem to require the admin uid too');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: deleteNewsItem also requires the admin uid, not just any signed-in account');
  }

  console.log('ALL NEWS TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
