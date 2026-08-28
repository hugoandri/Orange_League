// Same admin-custom-token pattern as news.test.js/users.test.js -- see
// news.test.js's header comment for why the Admin SDK is needed here too
// (publishNews needs the exact hardcoded ADMIN_UID signed in).
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

async function signInAsPlayer(email) {
  await admin.auth().createUser({ email: email, password: 'password123' }).catch(() => {});
  await signInWithEmailAndPassword(auth, email, 'password123');
  return auth.currentUser.uid;
}

function sumValues(obj) {
  return Object.keys(obj || {}).reduce((sum, k) => sum + obj[k], 0);
}

async function main() {
  const publishNews = httpsCallable(functions, 'publishNews');
  const claimNewsGift = httpsCallable(functions, 'claimNewsGift');
  const openClaimedGift = httpsCallable(functions, 'openClaimedGift');

  await signInAsAdmin();

  const badGifts = [
    { kind: 'card', setKey: 'base', num: '1', rarity: 'rare' },       // base isn't a giftable promo set
    { kind: 'card', setKey: 'basep', num: '999', rarity: 'rare' },    // no such card in basep
    { kind: 'card', setKey: 'basep', num: '1', rarity: 'ultra' },     // not a real rarity
    { kind: 'booster', setKey: 'basep' },                             // basep has no purchasable booster
    { kind: 'nonsense' }
  ];
  for (const gift of badGifts) {
    try {
      await publishNews({ title: 'x', body: 'y', tag: 'balance', gift: gift });
      assert.fail('expected an invalid gift shape to be rejected: ' + JSON.stringify(gift));
    } catch (e) {
      assert.strictEqual(e.code, 'functions/invalid-argument', 'wrong error for ' + JSON.stringify(gift));
    }
  }
  console.log('PASS: publishNews rejects every malformed gift shape');

  const noGiftRes = await publishNews({ title: 'Sin regalo', body: 'y', tag: 'notice' });
  const giftBoosterRes = await publishNews({ title: 'Con pack', body: 'y', tag: 'shop', gift: { kind: 'booster', setKey: 'fossil' } });
  const giftCardRes = await publishNews({ title: 'Con carta', body: 'y', tag: 'shop', gift: { kind: 'card', setKey: 'espromo', num: '1', rarity: 'secret' } });

  const boosterSnap = await getDoc(doc(db, 'news', giftBoosterRes.data.id));
  assert.deepStrictEqual(boosterSnap.data().gift, { kind: 'booster', setKey: 'fossil' });
  const cardSnap = await getDoc(doc(db, 'news', giftCardRes.data.id));
  assert.deepStrictEqual(cardSnap.data().gift, { kind: 'card', setKey: 'espromo', num: '1', rarity: 'secret' });
  console.log('PASS: a valid gift (booster or card) is stored on the news doc as submitted');

  await signOut(auth);
  const playerAUid = await signInAsPlayer('gift-player-a@example.com');

  try {
    await claimNewsGift({ newsId: noGiftRes.data.id });
    assert.fail('expected claiming a gift-less news item to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: claimNewsGift rejects a news item with no gift attached');
  }

  const beforeUser = await admin.firestore().collection('users').doc(playerAUid).get();
  const beforeTotal = sumValues((beforeUser.data() || {}).collection);

  // Claiming a booster/custompack gift only REGISTERS it now (nothing
  // drawn/granted yet, opened:false) -- see claimNewsGift's own comment.
  const claimRes = await claimNewsGift({ newsId: giftBoosterRes.data.id });
  assert.strictEqual(claimRes.data.cards, null, 'claiming a booster gift draws nothing yet');
  assert.strictEqual(claimRes.data.opened, false);
  console.log('PASS: claiming a booster gift only registers the claim, it does not draw cards yet');

  const noCollectionYetUser = await admin.firestore().collection('users').doc(playerAUid).get();
  assert.strictEqual(sumValues((noCollectionYetUser.data() || {}).collection), beforeTotal, 'nothing is granted until the pack is actually opened');

  try {
    await claimNewsGift({ newsId: giftBoosterRes.data.id });
    assert.fail('expected a second claim of the same gift to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: the same player cannot claim the same gift twice');
  }

  const ownClaimSnap = await getDoc(doc(db, 'news', giftBoosterRes.data.id, 'claims', playerAUid));
  assert.strictEqual(ownClaimSnap.exists(), true);
  console.log("PASS: a player can read their OWN claim doc (firestore.rules' news/{id}/claims/{uid})");

  // Now actually open the claimed pack (Tienda's "PACK GRATIS" -> ABRIR).
  const openRes = await openClaimedGift({ newsId: giftBoosterRes.data.id });
  assert.strictEqual(openRes.data.cards.length, 11, 'opening a booster gift grants the same 11 cards a real booster does');

  const afterUser = await admin.firestore().collection('users').doc(playerAUid).get();
  const afterTotal = sumValues(afterUser.data().collection);
  assert.strictEqual(afterTotal - beforeTotal, 11, 'the 11 gifted cards must actually land in the collection once opened');
  console.log('PASS: openClaimedGift grants 11 cards into the collection');

  try {
    await openClaimedGift({ newsId: giftBoosterRes.data.id });
    assert.fail('expected opening the same gift twice to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: the same player cannot open the same gift twice');
  }

  try {
    await openClaimedGift({ newsId: giftCardRes.data.id });
    assert.fail('expected opening a gift that was never claimed to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: openClaimedGift refuses to open a gift the caller never claimed');
  }

  await signOut(auth);
  const playerBUid = await signInAsPlayer('gift-player-b@example.com');

  const cardClaimRes = await claimNewsGift({ newsId: giftCardRes.data.id });
  assert.strictEqual(cardClaimRes.data.cards.length, 1);
  assert.strictEqual(cardClaimRes.data.cards[0].n, 'Articuno (GB)');
  assert.strictEqual(cardClaimRes.data.cards[0].pulledRarity, 'secret');

  const playerBDoc = await admin.firestore().collection('users').doc(playerBUid).get();
  const key = 'espromo-1';
  assert.strictEqual((playerBDoc.data().collection || {})[key], 1);
  assert.strictEqual((playerBDoc.data().collectionSecret || {})[key], 1, 'a secret-rarity card gift must land in collectionSecret too');
  console.log('PASS: claiming a card gift grants exactly 1 copy at the chosen rarity, into the right collection field');

  try {
    await getDoc(doc(db, 'news', giftBoosterRes.data.id, 'claims', playerAUid));
    assert.fail("expected reading another player's claim doc to be rejected by firestore.rules");
  } catch (e) {
    assert.ok(/permission/i.test(e.code || e.message || ''), 'expected a permission-denied style error, got: ' + e.code);
    console.log("PASS: a player CANNOT read another player's claim doc");
  }

  console.log('ALL NEWS GIFT TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
