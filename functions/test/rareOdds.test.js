// Same admin-custom-token pattern as news.test.js -- see that file's header
// comment for why the Admin SDK is needed here too (setRareOdds/publishNews
// need the exact hardcoded ADMIN_UID signed in).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const assert = require('assert');
const CARD_CATALOG = require('../lib/cardCatalog');

const ADMIN_UID = '4ViFsoJm7fMsop8eCS16u89wIxQ2';

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

async function signInAsAdmin() {
  await admin.auth().createUser({ uid: ADMIN_UID, email: 'admin@example.com', password: 'password123' }).catch(() => {});
  const token = await admin.auth().createCustomToken(ADMIN_UID);
  await signInWithCustomToken(auth, token);
}

// Unlike news.test.js's non-admin helper (which never needs to spend
// anything), this player needs real coins to open a real booster --
// createUser alone leaves no users/{uid} doc at all, so this seeds one
// directly with the Admin SDK (bypasses rules, same as customDeck.test.js's
// seedCollection), rather than going through createAccount just for its
// fixed 150-coin starting balance.
async function signInAsPlayer(email) {
  const existing = await admin.auth().getUserByEmail(email).catch(() => null);
  const uid = existing ? existing.uid : (await admin.auth().createUser({ email: email, password: 'password123' })).uid;
  await admin.firestore().collection('users').doc(uid).set({ coins: 500, collection: {} }, { merge: true });
  await signInWithEmailAndPassword(auth, email, 'password123');
  return uid;
}

// Every OTHER real rare in the set gets weight 0, so the rare slot has
// exactly one possible outcome -- makes the end-to-end effect on
// openBooster/claimNewsGift deterministic without needing to mock Math.random.
function zeroExceptOne(setKey, keepName, keepWeight) {
  const names = Array.from(new Set(
    CARD_CATALOG[setKey].filter((c) => c.r === 'Rare' || c.r === 'Rare Holo').map((c) => c.n)
  ));
  const odds = {};
  names.forEach((n) => { odds[n] = n === keepName ? keepWeight : 0; });
  return odds;
}

async function main() {
  const setRareOdds = httpsCallable(functions, 'setRareOdds');
  const openBooster = httpsCallable(functions, 'openBooster');
  const publishNews = httpsCallable(functions, 'publishNews');
  const claimNewsGift = httpsCallable(functions, 'claimNewsGift');
  const openClaimedGift = httpsCallable(functions, 'openClaimedGift');

  try {
    await setRareOdds({ setKey: 'base', odds: { Charizard: 1 } });
    assert.fail('expected an unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: setRareOdds rejects an unauthenticated call');
  }

  await signInAsPlayer('rareodds-notadmin@example.com');
  try {
    await setRareOdds({ setKey: 'base', odds: { Charizard: 1 } });
    assert.fail('expected a real but non-admin account to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: setRareOdds rejects a signed-in account that is not the admin uid');
  }
  await signOut(auth);

  await signInAsAdmin();

  try {
    await setRareOdds({ setKey: 'basep', odds: { Mewtwo: 1 } });
    assert.fail('expected a non-playable/non-boosterable set to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: setRareOdds rejects a set with no real booster (basep)');
  }

  try {
    await setRareOdds({ setKey: 'base', odds: { 'Not A Real Card': 5 } });
    assert.fail('expected an unknown card name to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: setRareOdds rejects a card name that is not a real rare in that set');
  }

  try {
    await setRareOdds({ setKey: 'base', odds: { Charizard: -1 } });
    assert.fail('expected a negative weight to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: setRareOdds rejects a negative weight');
  }

  try {
    await setRareOdds({ setKey: 'base', odds: { Charizard: 'lots' } });
    assert.fail('expected a non-numeric weight to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: setRareOdds rejects a non-numeric weight');
  }

  await setRareOdds({ setKey: 'base', odds: zeroExceptOne('base', 'Charizard', 5) });
  console.log('PASS: setRareOdds (as the real admin) accepts a valid, fully-specified weight map');

  await signOut(auth);
  const playerUid = await signInAsPlayer('rareodds-player@example.com');
  const boosterRes = await openBooster({ setKey: 'base' });
  assert.strictEqual(boosterRes.data.cards[0].n, 'Charizard', 'with every other rare zeroed out, the rare slot always pulls the configured one');
  console.log('PASS: openBooster actually applies the admin-configured rare odds');

  await signOut(auth);
  await signInAsAdmin();
  // Fossil's "Dragonite" appears twice in the catalog (once per foil tier,
  // see rareNamesForSet's own comment in admin.html) -- zeroing every other
  // NAME still leaves both Dragonite entries as the only possible outcomes.
  await setRareOdds({ setKey: 'fossil', odds: zeroExceptOne('fossil', 'Dragonite', 3) });
  const giftRes = await publishNews({ title: 'Con pack fossil', body: 'y', tag: 'shop', gift: { kind: 'booster', setKey: 'fossil' } });

  await signOut(auth);
  await signInWithEmailAndPassword(auth, 'rareodds-player@example.com', 'password123');
  await claimNewsGift({ newsId: giftRes.data.id });
  const openRes = await openClaimedGift({ newsId: giftRes.data.id });
  assert.strictEqual(openRes.data.cards[0].n, 'Dragonite', 'openClaimedGift\'s booster branch also applies the admin-configured rare odds');
  console.log('PASS: openClaimedGift actually applies the admin-configured rare odds too');

  console.log('ALL RARE ODDS TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
