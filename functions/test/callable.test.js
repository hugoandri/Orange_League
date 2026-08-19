const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
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

async function testCreateAccount() {
  const createAccount = httpsCallable(functions, 'createAccount');

  const res = await createAccount({ username: 'TestUser1', email: 'testuser1@example.com', password: 'password123' });
  assert.ok(res.data.uid, 'expected a uid back');
  console.log('PASS: createAccount returns a uid');

  // Firestore rules only allow owner reads, so sign in as the new account to check its doc.
  await signInWithEmailAndPassword(auth, 'testuser1@example.com', 'password123');
  const userDocRef = doc(db, 'users', res.data.uid);
  const snap = await getDoc(userDocRef);
  assert.strictEqual(snap.data().username, 'TestUser1', 'the display username keeps the casing the user typed');
  console.log('PASS: createAccount preserves the username casing');
  await auth.signOut();

  try {
    await createAccount({ username: 'testuser1', email: 'other@example.com', password: 'password123' });
    assert.fail('expected a case-insensitive duplicate username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: duplicate username is rejected case-insensitively');
  }

  try {
    await createAccount({ username: 'ab', email: 'shortname@example.com', password: 'password123' });
    assert.fail('expected too-short username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: too-short username is rejected');
  }
}

async function testUpdateProfile() {
  await signInWithEmailAndPassword(auth, 'testuser1@example.com', 'password123');
  const updateProfile = httpsCallable(functions, 'updateProfile');
  const userDocRef = doc(db, 'users', auth.currentUser.uid);

  const caseOnlyRes = await updateProfile({ username: 'testUser1' });
  assert.strictEqual(caseOnlyRes.data.username, 'testUser1');
  const caseOnlySnap = await getDoc(userDocRef);
  assert.strictEqual(caseOnlySnap.data().username, 'testUser1', 'a casing-only change is saved without touching the uniqueness index');
  console.log('PASS: updateProfile allows a casing-only rename');

  const res = await updateProfile({ username: 'TestUser1Renamed' });
  assert.strictEqual(res.data.username, 'TestUser1Renamed');
  console.log('PASS: updateProfile changes the username');

  const snap = await getDoc(userDocRef);
  assert.strictEqual(snap.data().username, 'TestUser1Renamed', 'the user doc reflects the new username, casing included');
  console.log('PASS: the renamed username is saved on the user doc');

  // The old username should be freed -- prove it by successfully claiming it
  // for a different account (createAccount doesn't change the caller's own
  // signed-in session, so we're still TestUser1Renamed's session below).
  const createAccount = httpsCallable(functions, 'createAccount');
  const claimRes = await createAccount({ username: 'testuser1', email: 'reclaimed@example.com', password: 'password123' });
  assert.ok(claimRes.data.uid, 'the old username should be free to claim again');
  console.log('PASS: the old username was freed and can be claimed by someone else');

  try {
    await updateProfile({ username: 'TestUser1' });
    assert.fail('expected a username already taken by someone else (case-insensitively) to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: updateProfile rejects a username already taken by someone else, case-insensitively');
  }

  const tinyPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const photoRes = await updateProfile({ photo: tinyPhoto });
  assert.strictEqual(photoRes.data.photo, tinyPhoto);
  const snapAfterPhoto = await getDoc(userDocRef);
  assert.strictEqual(snapAfterPhoto.data().photo, tinyPhoto, 'the photo is saved on the user doc');
  console.log('PASS: updateProfile saves a photo');

  try {
    await updateProfile({});
    assert.fail('expected a no-op call (nothing to change) to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: updateProfile rejects a call with nothing to change');
  }

  await auth.signOut();
  try {
    await updateProfile({ username: 'somebody' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: updateProfile requires auth');
  }
}

async function testAwardMatchResult() {
  await signInWithEmailAndPassword(auth, 'testuser1@example.com', 'password123');
  const awardMatchResult = httpsCallable(functions, 'awardMatchResult');

  const winRes = await awardMatchResult({ result: 'win' });
  assert.strictEqual(winRes.data.coins, 225, '150 starting + 75 for a win');
  console.log('PASS: a win pays 75 coins on top of the starting balance');

  try {
    await awardMatchResult({ result: 'loss' });
    assert.fail('expected a second award right after the first to be rejected by the cooldown');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/resource-exhausted');
    console.log('PASS: awarding twice in a row is rejected by the cooldown');
  }

  await auth.signOut();
  try {
    await awardMatchResult({ result: 'win' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: awardMatchResult requires auth');
  }
}

async function testOpenBooster() {
  await signInWithEmailAndPassword(auth, 'testuser1@example.com', 'password123');
  const openBooster = httpsCallable(functions, 'openBooster');

  const res = await openBooster({ setKey: 'base' });
  assert.strictEqual(res.data.cards.length, 11, 'a booster has 11 cards');
  console.log('PASS: openBooster returns 11 cards');

  const userDocRef = doc(db, 'users', auth.currentUser.uid);
  const snapAfterFirst = await getDoc(userDocRef);
  assert.strictEqual(snapAfterFirst.data().coins, 125, '225 starting - 100 for the booster = 125');
  assert.ok(Object.keys(snapAfterFirst.data().collection).length > 0, 'the drawn cards were recorded in the collection');
  console.log('PASS: openBooster deducts 100 coins and records the cards in the collection');

  const res2 = await openBooster({ setKey: 'base' });
  assert.strictEqual(res2.data.cards.length, 11, 'a second booster also has 11 cards');
  const snapAfterSecond = await getDoc(userDocRef);
  assert.strictEqual(snapAfterSecond.data().coins, 25, '125 - 100 = 25, not enough for a third booster');

  try {
    await openBooster({ setKey: 'base' });
    assert.fail('expected insufficient coins to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: opening a booster with insufficient coins is rejected');
  }

  try {
    await openBooster({ setKey: 'not-a-real-set' });
    assert.fail('expected an invalid set to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: an unknown setKey is rejected');
  }

  await auth.signOut();
  try {
    await openBooster({ setKey: 'base' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: openBooster requires auth');
  }
}

async function main() {
  await testCreateAccount();
  await testUpdateProfile();
  await testAwardMatchResult();
  await testOpenBooster();
  console.log('ALL CALLABLE TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
