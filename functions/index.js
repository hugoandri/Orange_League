const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { computeMatchReward, BOOSTER_COST, drawBoosterCards } = require('./lib/pureEconomy');
const CARD_CATALOG = require('./lib/cardCatalog');
admin.initializeApp();

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

exports.createAccount = onCall(async (request) => {
  const data = request.data || {};
  const username = (data.username || '').trim().toLowerCase();
  const email = (data.email || '').trim();
  const password = data.password || '';

  if (!USERNAME_RE.test(username)) {
    throw new HttpsError('invalid-argument', 'El usuario debe tener 3-20 letras minúsculas, números o guión bajo.');
  }
  if (!email || email.indexOf('@') === -1) {
    throw new HttpsError('invalid-argument', 'Email inválido.');
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
  }

  const usernameRef = admin.firestore().collection('usernames').doc(username);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(usernameRef);
    if (snap.exists) {
      throw new HttpsError('already-exists', 'Ese usuario ya está en uso.');
    }
    tx.set(usernameRef, { uid: 'pending' });
  });

  var userRecord;
  try {
    userRecord = await admin.auth().createUser({ email: email, password: password });
  } catch (e) {
    await usernameRef.delete();
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Ese email ya está registrado.');
    }
    throw new HttpsError('internal', 'No se pudo crear la cuenta.');
  }

  const uid = userRecord.uid;
  const db = admin.firestore();
  const batch = db.batch();
  batch.set(usernameRef, { uid: uid });
  batch.set(db.collection('users').doc(uid), {
    username: username,
    coins: 150,
    collection: {},
    createdAt: FieldValue.serverTimestamp()
  });
  await batch.commit();

  return { uid: uid };
});

exports.resolveLoginEmail = onCall(async (request) => {
  const username = (((request.data || {}).username) || '').trim().toLowerCase();
  if (!username) {
    throw new HttpsError('not-found', 'Usuario o contraseña incorrectos.');
  }

  const snap = await admin.firestore().collection('usernames').doc(username).get();
  const uid = snap.exists ? snap.data().uid : null;
  if (!uid || uid === 'pending') {
    throw new HttpsError('not-found', 'Usuario o contraseña incorrectos.');
  }

  try {
    const userRecord = await admin.auth().getUser(uid);
    return { email: userRecord.email };
  } catch (e) {
    throw new HttpsError('not-found', 'Usuario o contraseña incorrectos.');
  }
});

exports.awardMatchResult = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const result = (request.data || {}).result;
  if (result !== 'win' && result !== 'loss') {
    throw new HttpsError('invalid-argument', 'Resultado inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const delta = computeMatchReward(result);

  const newCoins = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.exists ? snap.data().coins : 0;
    const updated = current + delta;
    tx.set(userRef, { coins: updated }, { merge: true });
    return updated;
  });

  return { coins: newCoins };
});

exports.openBooster = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const setKey = (request.data || {}).setKey;
  if (!CARD_CATALOG[setKey]) {
    throw new HttpsError('invalid-argument', 'Set inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);

  const cards = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : null;
    if (!data || data.coins < BOOSTER_COST) {
      throw new HttpsError('failed-precondition', 'No tenés suficientes monedas.');
    }
    const drawn = drawBoosterCards(CARD_CATALOG[setKey], Math.random);
    const newCollection = Object.assign({}, data.collection);
    drawn.forEach(function (c) {
      const key = setKey + '-' + c.num;
      newCollection[key] = (newCollection[key] || 0) + 1;
    });
    tx.update(userRef, { coins: data.coins - BOOSTER_COST, collection: newCollection });
    return drawn;
  });

  return { cards: cards };
});
