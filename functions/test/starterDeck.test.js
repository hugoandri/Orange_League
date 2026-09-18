const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, deleteField } = require('firebase/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'starterDeckApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

// Directly clears a user doc's starterDeckChosen field entirely (bypassing
// firestore.rules) to simulate a grandfathered pre-feature account -- real
// grandfathered accounts simply never had this field written in the first
// place, this is a deterministic stand-in for that same state.
async function makeGrandfathered(uid) {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: { host: '127.0.0.1', port: 8080 }
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ starterDeckChosen: deleteField() });
  });
  await testEnv.cleanup();
}

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const chooseStarterDeck = httpsCallable(functions, 'chooseStarterDeck');
  const updateActiveDeck = httpsCallable(functions, 'updateActiveDeck');

  // --- Fresh account: starterDeckChosen starts out null ---
  const acct1 = await createAccount({ username: 'StarterTester1', email: 'startertester1@example.com', password: 'password123' });
  const uid1 = acct1.data.uid;
  await signInWithEmailAndPassword(auth, 'startertester1@example.com', 'password123');

  const userDocRef1 = doc(db, 'users', uid1);
  const freshSnap = await getDoc(userDocRef1);
  assert.strictEqual(freshSnap.data().starterDeckChosen, null, 'a freshly created account starts with starterDeckChosen: null');
  console.log('PASS: createAccount stamps new accounts with starterDeckChosen: null');

  const chooseRes = await chooseStarterDeck({ deckKey: 'overgrowth' });
  const totalGranted = Object.keys(chooseRes.data.collection).reduce(function (sum, k) { return sum + chooseRes.data.collection[k]; }, 0);
  assert.strictEqual(totalGranted, 60, 'choosing a starter deck grants exactly 60 cards');
  console.log('PASS: chooseStarterDeck grants exactly 60 cards');

  const afterChooseSnap = await getDoc(userDocRef1);
  assert.strictEqual(afterChooseSnap.data().starterDeckChosen, 'overgrowth', 'starterDeckChosen is locked to the chosen deck');
  assert.strictEqual(afterChooseSnap.data().activeDeck, 'overgrowth', 'activeDeck is also set to the chosen deck');
  console.log('PASS: chooseStarterDeck locks starterDeckChosen and sets activeDeck');

  // --- Double-choice is rejected ---
  try {
    await chooseStarterDeck({ deckKey: 'blackout' });
    assert.fail('expected a second chooseStarterDeck call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: chooseStarterDeck rejects a second choice from the same account');
  }

  // --- updateActiveDeck lock: the chosen precon still works, others don't ---
  const stillWorksRes = await updateActiveDeck({ deckKey: 'overgrowth' });
  assert.strictEqual(stillWorksRes.data.activeDeck, 'overgrowth', 'switching to the ALREADY-chosen precon still works (no-op)');
  console.log('PASS: updateActiveDeck still allows the chosen precon');

  try {
    await updateActiveDeck({ deckKey: 'blackout' });
    assert.fail('expected updateActiveDeck to a different, unchosen precon to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: updateActiveDeck rejects switching to a precon other than the one chosen');
  }

  // --- Invalid deckKey ---
  try {
    await chooseStarterDeck({ deckKey: 'not-a-real-deck' });
    assert.fail('expected an invalid deckKey to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: chooseStarterDeck rejects an invalid deckKey');
  }

  await auth.signOut();

  // --- Grandfathered account (no starterDeckChosen field at all) ---
  const acct2 = await createAccount({ username: 'StarterTester2', email: 'startertester2@example.com', password: 'password123' });
  const uid2 = acct2.data.uid;
  await makeGrandfathered(uid2);
  await signInWithEmailAndPassword(auth, 'startertester2@example.com', 'password123');

  try {
    await chooseStarterDeck({ deckKey: 'overgrowth' });
    assert.fail('expected a grandfathered account (no starterDeckChosen field) to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: chooseStarterDeck rejects a grandfathered account with no starterDeckChosen field');
  }

  const grandfatheredUpdateRes = await updateActiveDeck({ deckKey: 'blackout' });
  assert.strictEqual(grandfatheredUpdateRes.data.activeDeck, 'blackout', 'a grandfathered account can still freely switch precons, unaffected by the lock');
  console.log('PASS: updateActiveDeck is unaffected for a grandfathered account (zero behavior change)');

  await auth.signOut();
  try {
    await chooseStarterDeck({ deckKey: 'overgrowth' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: chooseStarterDeck requires auth');
  }

  console.log('ALL STARTER DECK TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
