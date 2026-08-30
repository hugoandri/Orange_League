const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

// Seeds this uid's `collection` field directly, bypassing firestore.rules
// (real writes only ever happen server-side, e.g. via openBooster -- this
// is just a deterministic stand-in for "the player owns exactly these
// cards" so saveCustomDeck's real validation can be exercised precisely).
// base-44 = Bulbasaur, base-99 = Grass Energy, base-30 = Ivysaur (see
// functions/lib/cardCatalog.js).
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

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const saveCustomDeck = httpsCallable(functions, 'saveCustomDeck');
  const updateActiveDeck = httpsCallable(functions, 'updateActiveDeck');

  const acct = await createAccount({ username: 'DeckTester1', email: 'decktester1@example.com', password: 'password123' });
  const uid = acct.data.uid;
  await signInWithEmailAndPassword(auth, 'decktester1@example.com', 'password123');

  // Owns exactly 4 Bulbasaur, 60 Grass Energy, and only 2 Ivysaur (fewer
  // than the 4-copy cap would otherwise allow) -- deliberately so the
  // ownership check and the copy-cap check can each be tested on their own.
  await seedCollection(uid, { 'base-44': 4, 'base-99': 60, 'base-30': 2 });

  const legalDeck = [{ name: 'Bulbasaur', count: 4 }, { name: 'Grass Energy', count: 56 }];
  const saveRes = await saveCustomDeck({ slot: 'custom-1', name: 'Mi Mazo Planta', cards: legalDeck });
  assert.strictEqual(saveRes.data.slot, 'custom-1');
  assert.strictEqual(saveRes.data.deck.name, 'Mi Mazo Planta');
  console.log('PASS: saveCustomDeck accepts a legal, fully-owned 60-card deck');

  const userDocRef = doc(db, 'users', uid);
  const snap = await getDoc(userDocRef);
  assert.deepStrictEqual(snap.data().customDecks['custom-1'].cards, legalDeck, 'the saved deck is persisted exactly as sent');
  console.log('PASS: the saved custom deck is persisted on the user doc');

  const activeRes = await updateActiveDeck({ deckKey: 'custom-1' });
  assert.strictEqual(activeRes.data.activeDeck, 'custom-1');
  const snapAfterActive = await getDoc(userDocRef);
  assert.strictEqual(snapAfterActive.data().activeDeck, 'custom-1');
  console.log('PASS: updateActiveDeck accepts a custom slot the player actually saved a deck to');

  const coverRes = await saveCustomDeck({ slot: 'custom-3', name: 'Con Portada', cards: legalDeck, coverName: 'Bulbasaur' });
  assert.strictEqual(coverRes.data.deck.coverName, 'Bulbasaur');
  const snapAfterCover = await getDoc(userDocRef);
  assert.strictEqual(snapAfterCover.data().customDecks['custom-3'].coverName, 'Bulbasaur', 'coverName is persisted on the user doc');
  console.log('PASS: saveCustomDeck accepts and persists a coverName that is actually in the deck');

  try {
    await saveCustomDeck({ slot: 'custom-4', name: 'Portada trucha', cards: legalDeck, coverName: 'Charizard' });
    assert.fail('expected a coverName not present in the deck to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveCustomDeck rejects a coverName that is not one of the deck\'s own cards');
  }

  try {
    await updateActiveDeck({ deckKey: 'custom-2' });
    assert.fail('expected an empty custom slot to be rejected as an activeDeck target');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: updateActiveDeck rejects a custom slot with no saved deck yet');
  }

  try {
    await saveCustomDeck({ slot: 'custom-1', name: 'Demasiadas', cards: [{ name: 'Bulbasaur', count: 5 }, { name: 'Grass Energy', count: 55 }] });
    assert.fail('expected 5 copies of a non-Basic-Energy card to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: saveCustomDeck enforces the real 4-copy cap server-side');
  }

  try {
    await saveCustomDeck({ slot: 'custom-2', name: 'Mas Ivysaur de la cuenta', cards: [{ name: 'Ivysaur', count: 3 }, { name: 'Grass Energy', count: 57 }] });
    assert.fail('expected claiming 3 Ivysaur while owning only 2 to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: saveCustomDeck enforces real ownership, not just the printed copy limit');
  }

  // Promos (basep/espromo) are collectible but not deck-legal for now (see
  // DECK_LEGAL_CARD_CATALOG, functions/index.js) -- even genuinely owning 4
  // copies of a promo-exclusive name (basep-28 = Surfing Pikachu, a name
  // with no real Base/Jungle/Fossil print) must not make it deck-eligible.
  await seedCollection(uid, { 'base-44': 4, 'base-99': 60, 'base-30': 2, 'basep-28': 4 });
  try {
    await saveCustomDeck({ slot: 'custom-3', name: 'Con promo', cards: [{ name: 'Surfing Pikachu', count: 4 }, { name: 'Grass Energy', count: 56 }] });
    assert.fail('expected a promo-only card name to be rejected even though it is genuinely owned');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: saveCustomDeck rejects promo cards as deck-illegal even when owned');
  }

  // Real reported bug: Jungle and Fossil are real, purchasable, collectible
  // sets (unlike basep/espromo above) but CARD_STATS (data-cards.js) never
  // implemented either one -- only Base's own 102 cards. Pikachu happens to
  // exist as a genuinely different real card in both Base (base-58) and
  // Jungle (jungle-60), so owning ONLY the Jungle print used to still make
  // "Pikachu" deck-eligible (using Base's own Gnaw/Thunder Jolt stats for a
  // card this game never actually implemented for Jungle). DECK_LEGAL_SET_
  // KEYS/DECK_LEGAL_CARD_CATALOG scope deck ownership to Base only now.
  await seedCollection(uid, { 'jungle-60': 4, 'base-99': 60 });
  try {
    await saveCustomDeck({ slot: 'custom-4', name: 'Con jungla', cards: [{ name: 'Pikachu', count: 4 }, { name: 'Grass Energy', count: 56 }] });
    assert.fail('expected a Jungle-only print to be rejected as deck-illegal even though the name is genuinely owned');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: saveCustomDeck rejects a name owned only via a Jungle/Fossil print, not Base');
  }

  // The rejected attempts above must not have clobbered the earlier good save.
  const snapAfterRejections = await getDoc(userDocRef);
  assert.deepStrictEqual(snapAfterRejections.data().customDecks['custom-1'].cards, legalDeck, 'a rejected save never overwrites a previously legal one');
  assert.ok(!snapAfterRejections.data().customDecks['custom-2'], 'a rejected save never creates a new slot either');
  console.log('PASS: rejected saveCustomDeck calls leave existing custom decks untouched');

  try {
    await saveCustomDeck({ slot: 'custom-5', name: 'Slot inválido', cards: legalDeck });
    assert.fail('expected an out-of-range slot to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveCustomDeck rejects a slot outside custom-1..custom-4');
  }

  await auth.signOut();
  try {
    await saveCustomDeck({ slot: 'custom-1', name: 'x', cards: legalDeck });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: saveCustomDeck requires auth');
  }

  console.log('ALL CUSTOM DECK TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
