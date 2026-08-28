// Same admin-custom-token pattern as news.test.js -- see that file's header
// comment for why the Admin SDK is needed here too (saveCustomPack/
// publishNews need the exact hardcoded ADMIN_UID signed in).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const assert = require('assert');
const CARD_CATALOG = require('../lib/cardCatalog');

const ADMIN_UID = '4ViFsoJm7fMsop8eCS16u89wIxQ2';

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

async function signInAsAdmin() {
  await admin.auth().createUser({ uid: ADMIN_UID, email: 'admin@example.com', password: 'password123' }).catch(() => {});
  const token = await admin.auth().createCustomToken(ADMIN_UID);
  await signInWithCustomToken(auth, token);
}

// Same reasoning as rareOdds.test.js's signInAsPlayer -- createUser alone
// leaves no users/{uid} doc, so this seeds one directly.
async function signInAsPlayer(email) {
  const existing = await admin.auth().getUserByEmail(email).catch(() => null);
  const uid = existing ? existing.uid : (await admin.auth().createUser({ email: email, password: 'password123' })).uid;
  await admin.firestore().collection('users').doc(uid).set({ coins: 500, collection: {} }, { merge: true });
  await signInWithEmailAndPassword(auth, email, 'password123');
  return uid;
}

// Exactly 11 entries (the minimum), guaranteed to include one Rare Holo --
// with pool.length === 11, drawCustomPackCards (pickRandomUnique(pool, 11))
// always drains the ENTIRE pool every time, so the claimed cards are fully
// deterministic without needing to mock Math.random.
function buildElevenCardPoolWithHolo(setKey) {
  const holo = CARD_CATALOG[setKey].find((c) => c.r === 'Rare Holo');
  const others = CARD_CATALOG[setKey].filter((c) => c.num !== holo.num).slice(0, 10);
  return [holo].concat(others).map((c) => setKey + '-' + c.num);
}

// Same idea, but the holo card's key is repeated once instead of using a
// 10th distinct card -- lets the admin put e.g. 2 Grass Energy in one pack
// (see admin.html's per-card quantity field), and pickRandomUnique treats
// each ARRAY SLOT as its own copy regardless of repeated string values, so
// this still deterministically drains to exactly those 11 slots.
function buildElevenCardPoolWithADuplicate(setKey) {
  const holo = CARD_CATALOG[setKey].find((c) => c.r === 'Rare Holo');
  const others = CARD_CATALOG[setKey].filter((c) => c.num !== holo.num).slice(0, 9);
  const keys = [holo].concat(others).map((c) => setKey + '-' + c.num);
  keys.push(keys[0]);
  return keys;
}

async function main() {
  const saveCustomPack = httpsCallable(functions, 'saveCustomPack');
  const deleteCustomPack = httpsCallable(functions, 'deleteCustomPack');
  const publishNews = httpsCallable(functions, 'publishNews');
  const claimNewsGift = httpsCallable(functions, 'claimNewsGift');
  const openClaimedGift = httpsCallable(functions, 'openClaimedGift');

  try {
    await saveCustomPack({ packId: 'x', name: 'X', pool: buildElevenCardPoolWithHolo('base') });
    assert.fail('expected an unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: saveCustomPack rejects an unauthenticated call');
  }

  await signInAsPlayer('custompacks-notadmin@example.com');
  try {
    await saveCustomPack({ packId: 'x', name: 'X', pool: buildElevenCardPoolWithHolo('base') });
    assert.fail('expected a real but non-admin account to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: saveCustomPack rejects a signed-in account that is not the admin uid');
  }
  await signOut(auth);

  await signInAsAdmin();

  const goodPool = buildElevenCardPoolWithHolo('base');

  try {
    await saveCustomPack({ packId: 'Not Valid!', name: 'X', pool: goodPool });
    assert.fail('expected an invalid packId format to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveCustomPack rejects a packId with invalid characters');
  }

  try {
    await saveCustomPack({ packId: 'orangeleague', name: '', pool: goodPool });
    assert.fail('expected an empty name to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveCustomPack rejects an empty name');
  }

  try {
    await saveCustomPack({ packId: 'orangeleague', name: 'Orange League', pool: goodPool.slice(0, 10) });
    assert.fail('expected a pool smaller than 11 to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveCustomPack rejects a pool with fewer than 11 cards');
  }

  try {
    await saveCustomPack({ packId: 'orangeleague', name: 'Orange League', pool: goodPool.slice(0, 10).concat(['base-99999']) });
    assert.fail('expected a nonexistent card reference to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveCustomPack rejects a pool entry that is not a real card');
  }

  await saveCustomPack({
    packId: 'orangeleague',
    name: 'Orange League',
    art: ['Sobres/Promo_Orange_1.webp', 'Sobres/Promo_Orange_2.webp'],
    pool: goodPool
  });
  const packSnap = await getDoc(doc(db, 'customPacks', 'orangeleague'));
  assert.strictEqual(packSnap.data().name, 'Orange League');
  assert.deepStrictEqual(packSnap.data().pool, goodPool);
  console.log('PASS: saveCustomPack (as the real admin) creates and persists a valid pack');

  try {
    await publishNews({ title: 'x', body: 'y', tag: 'balance', gift: { kind: 'custompack', packId: 'no-such-pack' } });
    assert.fail('expected a gift pointing at a nonexistent custom pack to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: publishNews rejects a custompack gift whose packId does not exist');
  }

  const newsRes = await publishNews({ title: 'Regalo Orange League', body: 'y', tag: 'shop', gift: { kind: 'custompack', packId: 'orangeleague' } });
  const newsSnap = await getDoc(doc(db, 'news', newsRes.data.id));
  assert.deepStrictEqual(newsSnap.data().gift, { kind: 'custompack', packId: 'orangeleague' });
  console.log('PASS: publishNews accepts and stores a valid custompack gift');

  await signOut(auth);
  const playerUid = await signInAsPlayer('custompacks-player@example.com');
  const claimRes = await claimNewsGift({ newsId: newsRes.data.id });
  assert.strictEqual(claimRes.data.cards, null, 'claiming a custompack gift draws nothing yet, same as a booster gift');
  assert.strictEqual(claimRes.data.opened, false);

  const openRes = await openClaimedGift({ newsId: newsRes.data.id });
  assert.strictEqual(openRes.data.cards.length, 11, 'a custom pack always grants exactly 11 cards');
  const grantedKeys = openRes.data.cards.map((c) => c.setKey + '-' + c.num).sort();
  assert.deepStrictEqual(grantedKeys, goodPool.slice().sort(), 'with an 11-card pool, every single pool card is granted');

  const playerDoc = await admin.firestore().collection('users').doc(playerUid).get();
  goodPool.forEach((key) => {
    assert.strictEqual((playerDoc.data().collection || {})[key], 1, key + ' should be in the collection');
  });
  const holoKey = goodPool[0]; // buildElevenCardPoolWithHolo always puts the Rare Holo first
  assert.strictEqual((playerDoc.data().collectionHolo || {})[holoKey], 1, 'the Rare Holo pool card is granted holo, not plain');
  console.log('PASS: claim+openClaimedGift grants all 11 custom-pack cards, each at its own real catalog rarity');

  // A repeated pool entry (e.g. the admin wants 2 Grass Energy available in
  // one pack, see admin.html's per-card quantity field) must be accepted
  // and must actually let that same card come out more than once.
  await signOut(auth);
  await signInAsAdmin();
  const dupePool = buildElevenCardPoolWithADuplicate('jungle');
  await saveCustomPack({ packId: 'dupepack', name: 'Dupe Pack', pool: dupePool });
  console.log('PASS: saveCustomPack accepts a pool with a repeated card (quantity > 1)');

  const dupeNewsRes = await publishNews({ title: 'Regalo Dupe Pack', body: 'y', tag: 'shop', gift: { kind: 'custompack', packId: 'dupepack' } });
  await signOut(auth);
  await signInWithEmailAndPassword(auth, 'custompacks-player@example.com', 'password123');
  await claimNewsGift({ newsId: dupeNewsRes.data.id });
  const dupeOpenRes = await openClaimedGift({ newsId: dupeNewsRes.data.id });
  assert.strictEqual(dupeOpenRes.data.cards.length, 11, 'still exactly 11 cards even with a repeated pool entry');
  const dupedKey = dupePool[0];
  const dupedCount = dupeOpenRes.data.cards.filter((c) => (c.setKey + '-' + c.num) === dupedKey).length;
  assert.strictEqual(dupedCount, 2, 'the repeated card actually comes out twice, not deduplicated to once');
  const dupePlayerDoc = await admin.firestore().collection('users').doc(playerUid).get();
  assert.strictEqual((dupePlayerDoc.data().collection || {})[dupedKey], 2, 'the collection count reflects both copies');
  console.log('PASS: claim+openClaimedGift grants both copies of a repeated custom-pack pool card');

  await signOut(auth);
  await signInAsAdmin();
  await deleteCustomPack({ packId: 'orangeleague' });
  const deletedSnap = await getDoc(doc(db, 'customPacks', 'orangeleague'));
  assert.strictEqual(deletedSnap.exists(), false);
  await deleteCustomPack({ packId: 'dupepack' });
  console.log('PASS: deleteCustomPack removes the pack doc');

  console.log('ALL CUSTOM PACKS TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
