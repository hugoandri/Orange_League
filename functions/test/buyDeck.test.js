// Tests the new buyDeck Cloud Function: a flat-price (1500 Orbes by
// default), idempotent-if-already-owned purchase of one of the 4 real
// precons -- mirrors buyCardBack's exact shape (functions/index.js),
// tested here the same way functions/test/starterDeck.test.js tests
// chooseStarterDeck.
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'buyDeckApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const chooseStarterDeck = httpsCallable(functions, 'chooseStarterDeck');
  const buyDeck = httpsCallable(functions, 'buyDeck');

  const acct = await createAccount({ username: 'BuyDeckTester1', email: 'buydecktester1@example.com', password: 'password123' });
  const uid = acct.data.uid;
  await signInWithEmailAndPassword(auth, 'buydecktester1@example.com', 'password123');

  const userDocRef = doc(db, 'users', uid);
  const freshSnap = await getDoc(userDocRef);
  assert.deepStrictEqual(freshSnap.data().ownedPrecons, [], 'a freshly created account starts with an empty ownedPrecons array');
  console.log('PASS: createAccount seeds ownedPrecons: []');

  await chooseStarterDeck({ deckKey: 'overgrowth' });
  const afterChooseSnap = await getDoc(userDocRef);
  assert.deepStrictEqual(afterChooseSnap.data().ownedPrecons, ['overgrowth'], 'choosing a starter deck seeds ownedPrecons with that deck');
  console.log('PASS: chooseStarterDeck seeds ownedPrecons: [deckKey]');

  // Coins from chooseStarterDeck's free grant: still 150 (the signup
  // default) since choosing a starter deck has never cost coins.
  const coinsBeforeBuy = afterChooseSnap.data().coins;
  assert.strictEqual(coinsBeforeBuy, 150, 'the starter choice itself is free -- coins are unaffected');

  // --- Not enough coins ---
  try {
    await buyDeck({ deckKey: 'blackout' });
    assert.fail('expected buyDeck to reject an account with insufficient coins (150 < 1500)');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: buyDeck rejects an account with insufficient coins');
  }

  // Give the account enough coins directly (bypassing the real economy
  // flow -- deterministic setup, same technique every other test file in
  // this suite already uses for seeding state).
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ coins: 5000 });
  });
  await testEnv.cleanup();

  // --- Successful purchase ---
  const buyRes = await buyDeck({ deckKey: 'blackout' });
  const totalGranted = Object.keys(buyRes.data.collection).reduce(function (sum, k) { return sum + buyRes.data.collection[k]; }, 0);
  assert.strictEqual(totalGranted, 120, 'after buying a 2nd deck, the collection holds both decks worth of cards (60 + 60 = 120)');
  assert.deepStrictEqual(buyRes.data.ownedPrecons.sort(), ['blackout', 'overgrowth'], 'ownedPrecons now includes both the starter choice and the purchase');
  assert.strictEqual(buyRes.data.coins, 5000 - 1500, 'exactly 1500 coins were deducted');
  console.log('PASS: buyDeck grants 60 cards, adds the deck to ownedPrecons, and deducts exactly 1500 coins');

  // --- Idempotent: buying the same deck again is a no-op, not an error ---
  const rebuyRes = await buyDeck({ deckKey: 'blackout' });
  assert.strictEqual(rebuyRes.data.coins, 5000 - 1500, 'buying an already-owned deck again does not charge a second time');
  assert.deepStrictEqual(rebuyRes.data.ownedPrecons.sort(), ['blackout', 'overgrowth'], 'ownedPrecons is unchanged by a repeat purchase');
  console.log('PASS: buyDeck is idempotent -- buying an already-owned deck again does not charge or error');

  // --- Invalid deckKey ---
  try {
    await buyDeck({ deckKey: 'not-a-real-deck' });
    assert.fail('expected an invalid deckKey to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: buyDeck rejects an invalid deckKey');
  }

  await auth.signOut();
  try {
    await buyDeck({ deckKey: 'overgrowth' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: buyDeck requires auth');
  }

  console.log('ALL BUY DECK TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
