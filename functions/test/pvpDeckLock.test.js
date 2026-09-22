// Covers the ONE finding from the final whole-branch review of the starter-
// deck-selection feature: the starter-deck lock that chooseStarterDeck /
// updateActiveDeck already enforce for local play (see
// functions/test/starterDeck.test.js) was completely missing from the
// separate PVP "Duelo en Vivo" room-creation/joining flow -- a player who
// locked in one precon could still freely bring any OTHER precon into a
// PVP room. The real fix lives in validateDeckId (functions/index.js),
// which every PVP room-creation/join call routes through via
// resolvePvpIdentity (its only caller, confirmed with `grep -n
// "validateDeckId(" functions/index.js`) -- an onRequest endpoint (not
// onCall, since the calling side there is the PartyKit server, not a
// Firebase client SDK), so this test drives it the same way
// resolvePvpIdentity.test.js does: real signed-in-user ID tokens over a
// plain fetch(), rather than httpsCallable.
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'pvpDeckLockApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

// Same deterministic stand-in for a grandfathered pre-feature account that
// starterDeck.test.js already uses -- clears starterDeckChosen entirely
// (bypassing firestore.rules), rather than leaving it null, since a real
// grandfathered account never had the field written in the first place.
async function makeGrandfathered(uid) {
  const { deleteField } = require('firebase/firestore');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: { host: '127.0.0.1', port: 8080 }
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ starterDeckChosen: deleteField() });
  });
  await testEnv.cleanup();
}

// Seeds this uid's `collection` field directly (bypassing firestore.rules),
// same helper customDeck.test.js already uses, so saveCustomDeck's real
// ownership check can be satisfied without going through openBooster.
// base-44 = Bulbasaur, base-99 = Grass Energy (functions/lib/cardCatalog.js).
async function seedCollection(uid, collection) {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: { host: '127.0.0.1', port: 8080 }
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).set({ collection: collection }, { merge: true });
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
  const saveCustomDeck = httpsCallable(functions, 'saveCustomDeck');

  // --- An account that already locked in 'overgrowth' ---
  const acct = await createAccount({ username: 'PvpLockTesterA1', email: 'pvplocktestera1@example.com', password: 'password123' });
  const uid = acct.data.uid;
  await signInWithEmailAndPassword(auth, 'pvplocktestera1@example.com', 'password123');
  await chooseStarterDeck({ deckKey: 'overgrowth' });

  // Also give this account a real, saved custom deck slot -- the lock must
  // not touch custom decks at all (they're a completely separate universe
  // from the precon lock).
  await seedCollection(uid, { 'base-44': 4, 'base-99': 60 });
  await saveCustomDeck({ slot: 'custom-1', name: 'Mi Mazo', cards: [{ name: 'Bulbasaur', count: 4 }, { name: 'Grass Energy', count: 56 }] });

  const idToken = await auth.currentUser.getIdToken();

  const blackoutRes = await callResolvePvpIdentity(idToken, 'blackout');
  assert.strictEqual(blackoutRes.status, 400, 'a locked-in account must be rejected with 400 for a DIFFERENT precon in Duelo en Vivo');
  console.log('PASS: resolvePvpIdentity rejects a different precon than the one the account already chose');

  const overgrowthRes = await callResolvePvpIdentity(idToken, 'overgrowth');
  assert.strictEqual(overgrowthRes.status, 200, 'the account\'s OWN chosen precon must still work in Duelo en Vivo');
  assert.strictEqual(overgrowthRes.data.deckKey, 'overgrowth');
  console.log('PASS: resolvePvpIdentity still accepts the account\'s own chosen precon');

  const customRes = await callResolvePvpIdentity(idToken, 'custom:custom-1');
  assert.strictEqual(customRes.status, 200, 'a locked-in account\'s own real custom deck slot must be unaffected by the precon lock');
  assert.strictEqual(customRes.data.deckKey, 'pvp_' + uid + '_custom-1');
  // saveCustomDeck persists cards as [{name, count}, ...] (see
  // customDeck.test.js) and resolvePvpIdentity passes that array straight
  // through as customDeckCards (functions/index.js: `customDeckCards =
  // saved.cards`) -- no expansion into one entry per physical card.
  assert.deepStrictEqual(customRes.data.customDeckCards, [{ name: 'Bulbasaur', count: 4 }, { name: 'Grass Energy', count: 56 }], 'the real, saved custom deck comes through unchanged, unaffected by the precon lock');
  console.log('PASS: resolvePvpIdentity is unaffected for the account\'s own real custom deck (precon lock does not touch custom decks)');

  await auth.signOut();

  // --- A grandfathered account (no starterDeckChosen field at all) ---
  const acct2 = await createAccount({ username: 'PvpLockTesterA2', email: 'pvplocktestera2@example.com', password: 'password123' });
  const uid2 = acct2.data.uid;
  await makeGrandfathered(uid2);
  await signInWithEmailAndPassword(auth, 'pvplocktestera2@example.com', 'password123');
  const idToken2 = await auth.currentUser.getIdToken();

  const grandOvergrowth = await callResolvePvpIdentity(idToken2, 'overgrowth');
  assert.strictEqual(grandOvergrowth.status, 200, 'a grandfathered account can freely use overgrowth in Duelo en Vivo');
  const grandBlackout = await callResolvePvpIdentity(idToken2, 'blackout');
  assert.strictEqual(grandBlackout.status, 200, 'a grandfathered account can freely use blackout in Duelo en Vivo');
  const grandZap = await callResolvePvpIdentity(idToken2, 'zap');
  assert.strictEqual(grandZap.status, 200, 'a grandfathered account can freely use zap in Duelo en Vivo');
  const grandBrushfire = await callResolvePvpIdentity(idToken2, 'brushfire');
  assert.strictEqual(grandBrushfire.status, 200, 'a grandfathered account can freely use brushfire in Duelo en Vivo');
  console.log('PASS: a grandfathered account (no starterDeckChosen field) can freely use ANY precon in Duelo en Vivo, completely unaffected');

  await auth.signOut();

  console.log('ALL PVP DECK LOCK TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
