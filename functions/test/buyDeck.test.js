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

  // --- Regression: chooseStarterDeck must MERGE into ownedPrecons, not
  // overwrite it. buyDeck has no dependency on starterDeckChosen -- a
  // player can own coins (e.g. via createStarsInvoice, a real-money path
  // with no starterDeckChosen gate) and call buyDeck successfully while
  // starterDeckChosen is still null. If they then call chooseStarterDeck
  // for a DIFFERENT deck, ownedPrecons must retain the earlier purchase,
  // not silently drop it (which would let a subsequent buyDeck call for
  // that same deck double-charge for cards the player already owns).
  const acct2 = await createAccount({ username: 'BuyDeckTester2', email: 'buydecktester2@example.com', password: 'password123' });
  const uid2 = acct2.data.uid;
  await signInWithEmailAndPassword(auth, 'buydecktester2@example.com', 'password123');

  const testEnv2 = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv2.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid2).update({ coins: 5000 });
  });
  await testEnv2.cleanup();

  // Buy a precon BEFORE ever choosing a starter deck (starterDeckChosen
  // is still null here -- mirrors a player who topped up Orbes via
  // createStarsInvoice, which has no starterDeckChosen gate).
  const preStarterBuy = await buyDeck({ deckKey: 'blackout' });
  assert.deepStrictEqual(preStarterBuy.data.ownedPrecons, ['blackout'], 'buyDeck works even before starterDeckChosen is set');
  const coinsAfterFirstBuy = preStarterBuy.data.coins;
  assert.strictEqual(coinsAfterFirstBuy, 5000 - 1500, 'the pre-starter purchase charged exactly 1500');

  // Now choose a DIFFERENT deck as the starter -- ownedPrecons must merge
  // (['blackout', 'overgrowth']), not overwrite to just ['overgrowth'].
  await chooseStarterDeck({ deckKey: 'overgrowth' });
  const uid2DocRef = doc(db, 'users', uid2);
  const afterStarterSnap = await getDoc(uid2DocRef);
  assert.deepStrictEqual(afterStarterSnap.data().ownedPrecons.sort(), ['blackout', 'overgrowth'], 'chooseStarterDeck merges into ownedPrecons additively -- it must not erase a deck bought earlier');
  console.log('PASS: chooseStarterDeck merges ownedPrecons instead of overwriting it');

  // Re-buying the already-owned deck must NOT charge a second time.
  const rebuyAfterStarter = await buyDeck({ deckKey: 'blackout' });
  assert.strictEqual(rebuyAfterStarter.data.coins, coinsAfterFirstBuy, 'buying an already-owned deck again after chooseStarterDeck does not double-charge (coin balance unchanged)');
  assert.deepStrictEqual(rebuyAfterStarter.data.ownedPrecons.sort(), ['blackout', 'overgrowth'], 'ownedPrecons is still both decks after the repeat purchase');
  console.log('PASS: no double-charge for a deck bought before chooseStarterDeck ran -- the reviewer-found exploit is fixed');

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
