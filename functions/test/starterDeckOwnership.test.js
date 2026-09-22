// Proves a SECOND owned precon (acquired via buyDeck, not just the free
// starter choice) becomes usable at both server-side lock points --
// updateActiveDeck (local play) and validateDeckId/resolvePvpIdentity
// (PVP room creation/joining) -- while a still-unbought THIRD precon stays
// rejected at both. Complements functions/test/starterDeck.test.js (which
// already covers the single-deck case) and
// functions/test/pvpDeckLock.test.js (which already covers the PVP lock
// point's single-deck case) -- this file is the ownedPrecons-aware
// extension of both, not a replacement.
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, deleteField } = require('firebase/firestore');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'starterDeckOwnershipApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

// Simulates an account that predates the ownedPrecons field entirely --
// chose a starter deck back when only starterDeckChosen existed, so
// ownedPrecons was never written for it (as opposed to makeGrandfathered-
// style helpers elsewhere, which clear starterDeckChosen itself; here
// starterDeckChosen stays intact and only ownedPrecons is removed).
async function makeLegacyOwnershipAccount(uid) {
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ ownedPrecons: deleteField() });
  });
  await testEnv.cleanup();
}

async function callResolvePvpIdentity(idToken, deckId) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/resolvePvpIdentity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: idToken, deckId: deckId, cardBackId: 'clasico' })
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const chooseStarterDeck = httpsCallable(functions, 'chooseStarterDeck');
  const buyDeck = httpsCallable(functions, 'buyDeck');
  const updateActiveDeck = httpsCallable(functions, 'updateActiveDeck');

  const acct = await createAccount({ username: 'OwnershipTester1', email: 'ownershiptester1@example.com', password: 'password123' });
  const uid = acct.data.uid;
  await signInWithEmailAndPassword(auth, 'ownershiptester1@example.com', 'password123');
  await chooseStarterDeck({ deckKey: 'overgrowth' });

  // Give this account enough coins to buy a 2nd deck.
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ coins: 5000 });
  });
  await testEnv.cleanup();

  await buyDeck({ deckKey: 'blackout' });
  // Now owns: overgrowth (starter) + blackout (bought). zap and brushfire
  // remain unowned.

  // --- updateActiveDeck (local play) ---
  const switchToBoughtRes = await updateActiveDeck({ deckKey: 'blackout' });
  assert.strictEqual(switchToBoughtRes.data.activeDeck, 'blackout', 'a bought (not just starter-chosen) precon is now usable as the local activeDeck');
  console.log('PASS: updateActiveDeck accepts a precon acquired via purchase, not just the starter choice');

  try {
    await updateActiveDeck({ deckKey: 'zap' });
    assert.fail('expected updateActiveDeck to reject a still-unowned precon');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: updateActiveDeck still rejects a precon the account has neither chosen nor bought');
  }

  // --- validateDeckId / resolvePvpIdentity (PVP room creation/joining) ---
  const idToken = await auth.currentUser.getIdToken();

  const pvpBoughtRes = await callResolvePvpIdentity(idToken, 'blackout');
  assert.strictEqual(pvpBoughtRes.status, 200, 'a bought precon is now usable in Duelo en Vivo, not just the starter choice');
  console.log('PASS: resolvePvpIdentity accepts a precon acquired via purchase');

  const pvpUnownedRes = await callResolvePvpIdentity(idToken, 'zap');
  assert.strictEqual(pvpUnownedRes.status, 400, 'a still-unowned precon stays rejected in Duelo en Vivo');
  console.log('PASS: resolvePvpIdentity still rejects a precon the account has neither chosen nor bought');

  await auth.signOut();

  // --- Critical-finding regression: a legacy account that predates the
  // ownedPrecons field entirely (chose a starter deck, but ownedPrecons
  // was never written for it) must not be locked out of its OWN deck, and
  // must not be re-sold/re-charged for a deck it already owns. ---
  const acct3 = await createAccount({ username: 'OwnershipTester2', email: 'ownershiptester2@example.com', password: 'password123' });
  const uid3 = acct3.data.uid;
  await signInWithEmailAndPassword(auth, 'ownershiptester2@example.com', 'password123');
  await chooseStarterDeck({ deckKey: 'overgrowth' });

  // Give this account enough coins to buy a 2nd deck later in this scenario.
  const testEnv3 = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv3.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid3).update({ coins: 5000 });
  });
  await testEnv3.cleanup();

  // Simulate "this account predates ownedPrecons existing" -- delete just
  // that field, leaving starterDeckChosen: 'overgrowth' intact.
  await makeLegacyOwnershipAccount(uid3);
  const legacyDocRef = doc(db, 'users', uid3);
  const legacySnap = await getDoc(legacyDocRef);
  assert.strictEqual(legacySnap.data().ownedPrecons, undefined, 'ownedPrecons is genuinely absent, simulating a pre-feature account');
  assert.strictEqual(legacySnap.data().starterDeckChosen, 'overgrowth', 'starterDeckChosen is untouched -- still the deck this account actually owns');

  // updateActiveDeck for their OWN deck must succeed (previously rejected:
  // [].indexOf('overgrowth') === -1 even though they own it).
  const legacyUpdateRes = await updateActiveDeck({ deckKey: 'overgrowth' });
  assert.strictEqual(legacyUpdateRes.data.activeDeck, 'overgrowth', 'a legacy account can still set its OWN precon as the active deck');
  console.log('PASS: updateActiveDeck no longer rejects a legacy account for its own already-owned deck');

  // A real PVP-room call for their OWN deck must succeed.
  const legacyIdToken = await auth.currentUser.getIdToken();
  const legacyPvpRes = await callResolvePvpIdentity(legacyIdToken, 'overgrowth');
  assert.strictEqual(legacyPvpRes.status, 200, 'a legacy account can still bring its OWN precon into Duelo en Vivo');
  console.log('PASS: resolvePvpIdentity no longer rejects a legacy account for its own already-owned deck');

  // buyDeck for the SAME (already-owned) deck must be idempotent: no
  // charge. Read the coin balance before and after to confirm.
  const coinsBeforeIdempotentBuy = (await getDoc(legacyDocRef)).data().coins;
  const legacyRebuyRes = await buyDeck({ deckKey: 'overgrowth' });
  assert.strictEqual(legacyRebuyRes.data.coins, coinsBeforeIdempotentBuy, 'buyDeck for a legacy account\'s own already-owned deck does not charge -- hits the idempotent early-return path');
  const coinsAfterIdempotentBuy = (await getDoc(legacyDocRef)).data().coins;
  assert.strictEqual(coinsAfterIdempotentBuy, coinsBeforeIdempotentBuy, 'coin balance in Firestore is genuinely unchanged, not just the callable response');
  console.log('PASS: buyDeck is idempotent for a legacy account\'s own already-owned deck (the Critical bug -- no second charge, no second copy of the same 60 cards)');

  // buyDeck for a genuinely NEW deck must still charge normally, and the
  // resulting ownedPrecons must include BOTH the legacy starter deck and
  // the newly bought one.
  const legacyNewBuyRes = await buyDeck({ deckKey: 'blackout' });
  assert.strictEqual(legacyNewBuyRes.data.coins, coinsAfterIdempotentBuy - 1500, 'buying a genuinely new deck still charges the normal 1500 coins');
  assert.deepStrictEqual(legacyNewBuyRes.data.ownedPrecons.sort(), ['blackout', 'overgrowth'], 'ownedPrecons after the new purchase includes BOTH the legacy starter deck and the newly bought one');
  console.log('PASS: buyDeck still charges normally for a genuinely new deck, and merges it alongside the legacy starter deck in ownedPrecons');

  await auth.signOut();
  console.log('ALL STARTER DECK OWNERSHIP TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
