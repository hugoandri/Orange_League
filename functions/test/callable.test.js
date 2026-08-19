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

  const res = await createAccount({ username: 'testuser1', email: 'testuser1@example.com', password: 'password123' });
  assert.ok(res.data.uid, 'expected a uid back');
  console.log('PASS: createAccount returns a uid');

  try {
    await createAccount({ username: 'testuser1', email: 'other@example.com', password: 'password123' });
    assert.fail('expected duplicate username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: duplicate username is rejected');
  }

  try {
    await createAccount({ username: 'ab', email: 'shortname@example.com', password: 'password123' });
    assert.fail('expected too-short username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: too-short username is rejected');
  }
}

async function testResolveLoginEmail() {
  const resolveLoginEmail = httpsCallable(functions, 'resolveLoginEmail');

  const res = await resolveLoginEmail({ username: 'testuser1' });
  assert.strictEqual(res.data.email, 'testuser1@example.com');
  console.log('PASS: resolveLoginEmail finds the email for an existing username');

  try {
    await resolveLoginEmail({ username: 'nosuchuser' });
    assert.fail('expected unknown username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/not-found');
    console.log('PASS: unknown username returns not-found');
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
  await testResolveLoginEmail();
  await testAwardMatchResult();
  await testOpenBooster();
  console.log('ALL CALLABLE TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
