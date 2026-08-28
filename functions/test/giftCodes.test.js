// Same admin-custom-token pattern as news.test.js -- see that file's header
// comment for why the Admin SDK is needed here too (saveGiftCode needs the
// exact hardcoded ADMIN_UID signed in).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const assert = require('assert');

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

// Same reasoning as customPacks.test.js's signInAsPlayer -- createUser alone
// leaves no users/{uid} doc, so this seeds one directly with the Admin SDK.
async function signInAsPlayer(email) {
  const existing = await admin.auth().getUserByEmail(email).catch(() => null);
  const uid = existing ? existing.uid : (await admin.auth().createUser({ email: email, password: 'password123' })).uid;
  await admin.firestore().collection('users').doc(uid).set({ coins: 500, collection: {} }, { merge: true });
  await signInWithEmailAndPassword(auth, email, 'password123');
  return uid;
}

function sumValues(obj) {
  return Object.keys(obj || {}).reduce((sum, k) => sum + obj[k], 0);
}

async function main() {
  const saveGiftCode = httpsCallable(functions, 'saveGiftCode');
  const deleteGiftCode = httpsCallable(functions, 'deleteGiftCode');
  const redeemGiftCode = httpsCallable(functions, 'redeemGiftCode');
  const openCodePack = httpsCallable(functions, 'openCodePack');

  const cardGift = { kind: 'card', setKey: 'espromo', num: '2', rarity: 'holo' }; // Zapdos (GB)
  const boosterGift = { kind: 'booster', setKey: 'jungle' };

  try {
    await saveGiftCode({ code: 'TESTCODE', gift: cardGift });
    assert.fail('expected an unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: saveGiftCode rejects an unauthenticated call');
  }

  await signInAsPlayer('giftcodes-notadmin@example.com');
  try {
    await saveGiftCode({ code: 'TESTCODE', gift: cardGift });
    assert.fail('expected a real but non-admin account to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/permission-denied');
    console.log('PASS: saveGiftCode rejects a signed-in account that is not the admin uid');
  }
  await signOut(auth);

  await signInAsAdmin();

  try {
    await saveGiftCode({ code: 'no spaces!', gift: cardGift });
    assert.fail('expected an invalid code format to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveGiftCode rejects a code with invalid characters');
  }

  try {
    await saveGiftCode({ code: 'BADGIFT', gift: { kind: 'nonsense' } });
    assert.fail('expected an invalid gift to be rejected (reuses validateGiftField)');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: saveGiftCode rejects an invalid gift shape');
  }

  await saveGiftCode({ code: 'card-code-1', gift: cardGift }); // lowercase input...
  const cardCodeSnap = await getDoc(doc(db, 'giftCodes', 'CARD-CODE-1'));
  assert.strictEqual(cardCodeSnap.exists(), true, '...normalized to uppercase for the doc id');
  assert.deepStrictEqual(cardCodeSnap.data().gift, cardGift);
  console.log('PASS: saveGiftCode (as the real admin) creates and persists a valid card-gift code, normalizing to uppercase');

  await saveGiftCode({ code: 'PACK-CODE-1', gift: boosterGift });
  console.log('PASS: saveGiftCode also accepts a booster-gift code');

  await signOut(auth);

  try {
    await redeemGiftCode({ code: 'CARD-CODE-1' });
    assert.fail('expected an unauthenticated redemption to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: redeemGiftCode requires auth');
  }

  const playerAUid = await signInAsPlayer('giftcodes-player-a@example.com');

  try {
    await redeemGiftCode({ code: 'NO-SUCH-CODE' });
    assert.fail('expected a nonexistent code to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/not-found');
    console.log('PASS: redeemGiftCode rejects a code that does not exist');
  }

  const cardRedeemRes = await redeemGiftCode({ code: 'card-code-1' }); // lowercase input still resolves
  assert.strictEqual(cardRedeemRes.data.kind, 'card');
  assert.strictEqual(cardRedeemRes.data.opened, true);
  assert.strictEqual(cardRedeemRes.data.cards.length, 1);
  assert.strictEqual(cardRedeemRes.data.cards[0].n, 'Zapdos (GB)');
  assert.strictEqual(cardRedeemRes.data.cards[0].pulledRarity, 'holo');

  const playerADoc = await admin.firestore().collection('users').doc(playerAUid).get();
  assert.strictEqual((playerADoc.data().collection || {})['espromo-2'], 1);
  assert.strictEqual((playerADoc.data().collectionHolo || {})['espromo-2'], 1);
  console.log('PASS: redeemGiftCode grants a card gift immediately, holo rarity included, lowercase code accepted');

  try {
    await redeemGiftCode({ code: 'CARD-CODE-1' });
    assert.fail('expected the same player redeeming the same code twice to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: the same player cannot redeem the same code twice');
  }

  await signOut(auth);
  const playerBUid = await signInAsPlayer('giftcodes-player-b@example.com');
  const cardRedeemResB = await redeemGiftCode({ code: 'CARD-CODE-1' });
  assert.strictEqual(cardRedeemResB.data.cards.length, 1, 'a different player can redeem the same code too -- codes are multi-player');
  console.log('PASS: a code can be redeemed by more than one different player');

  // Now the booster-gift code: claiming only registers it (nothing drawn),
  // it must show up in pendingCodePacks, then openCodePack actually draws.
  const boosterRedeemRes = await redeemGiftCode({ code: 'PACK-CODE-1' });
  assert.strictEqual(boosterRedeemRes.data.kind, 'booster');
  assert.strictEqual(boosterRedeemRes.data.cards, null);
  assert.strictEqual(boosterRedeemRes.data.opened, false);

  const beforeOpenDoc = await admin.firestore().collection('users').doc(playerBUid).get();
  assert.ok((beforeOpenDoc.data().pendingCodePacks || []).some((p) => p.code === 'PACK-CODE-1'), 'the pack must be queued in pendingCodePacks');
  console.log('PASS: redeeming a booster-gift code only registers it, drawing nothing yet');

  try {
    await redeemGiftCode({ code: 'PACK-CODE-1' });
    assert.fail('expected redeeming the same booster code twice to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: the same player cannot redeem the same booster code twice, even before opening it');
  }

  const beforeTotal = sumValues(beforeOpenDoc.data().collection);
  const openRes = await openCodePack({ code: 'PACK-CODE-1' });
  assert.strictEqual(openRes.data.cards.length, 11, 'opening the code pack grants the same 11 cards a real jungle booster does');

  const afterOpenDoc = await admin.firestore().collection('users').doc(playerBUid).get();
  assert.strictEqual(sumValues(afterOpenDoc.data().collection) - beforeTotal, 11, 'the 11 cards actually land in the collection');
  assert.strictEqual((afterOpenDoc.data().pendingCodePacks || []).length, 0, 'the pack is removed from pendingCodePacks once opened');
  console.log('PASS: openCodePack draws the pack and removes it from pendingCodePacks');

  try {
    await openCodePack({ code: 'PACK-CODE-1' });
    assert.fail('expected opening the same code pack twice to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: openCodePack refuses to open a pack that is no longer pending');
  }

  await signOut(auth);
  await signInAsAdmin();
  await deleteGiftCode({ code: 'card-code-1' });
  const deletedSnap = await getDoc(doc(db, 'giftCodes', 'CARD-CODE-1'));
  assert.strictEqual(deletedSnap.exists(), false);
  await deleteGiftCode({ code: 'PACK-CODE-1' });
  console.log('PASS: deleteGiftCode removes the code doc');

  console.log('ALL GIFT CODES TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
