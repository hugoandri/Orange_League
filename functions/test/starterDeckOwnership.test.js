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
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'starterDeckOwnershipApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

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
  console.log('ALL STARTER DECK OWNERSHIP TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
