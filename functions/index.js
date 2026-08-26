const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { computeMatchReward, BOOSTER_COST, drawBoosterCards, PROTECTOR_COST, PROTECTOR_IDS } = require('./lib/pureEconomy');
const CARD_CATALOG = require('./lib/cardCatalog');
admin.initializeApp();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

exports.createAccount = onCall(async (request) => {
  const data = request.data || {};
  const username = (data.username || '').trim();
  const email = (data.email || '').trim();
  const password = data.password || '';

  if (!USERNAME_RE.test(username)) {
    throw new HttpsError('invalid-argument', 'El usuario debe tener 3-20 letras, números o guión bajo.');
  }
  if (!email || email.indexOf('@') === -1) {
    throw new HttpsError('invalid-argument', 'Email inválido.');
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
  }

  // Uniqueness is enforced case-insensitively via this lowercase key, but the
  // display username keeps whatever casing the user typed (see users/{uid}.username below).
  const usernameKey = username.toLowerCase();
  const usernameRef = admin.firestore().collection('usernames').doc(usernameKey);

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
    await usernameRef.delete().catch(function () {});
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
  try {
    await batch.commit();
  } catch (e) {
    await admin.auth().deleteUser(uid).catch(function () {});
    await usernameRef.delete().catch(function () {});
    throw new HttpsError('internal', 'No se pudo crear la cuenta.');
  }

  return { uid: uid };
});

const AWARD_COOLDOWN_MS = 10000;

exports.awardMatchResult = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const result = (request.data || {}).result;
  if (result !== 'win' && result !== 'loss') {
    throw new HttpsError('invalid-argument', 'Resultado inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const delta = computeMatchReward(result);

  const newCoins = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};
    const current = data.coins || 0;
    const lastAwardAt = data.lastAwardAt;
    const now = Timestamp.now();
    if (lastAwardAt && now.toMillis() - lastAwardAt.toMillis() < AWARD_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'Espera un poco antes de registrar otro resultado.');
    }
    const updated = current + delta;
    tx.set(userRef, { coins: updated, lastAwardAt: now }, { merge: true });
    return updated;
  });

  return { coins: newCoins };
});

exports.openBooster = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const setKey = (request.data || {}).setKey;
  if (!Object.prototype.hasOwnProperty.call(CARD_CATALOG, setKey)) {
    throw new HttpsError('invalid-argument', 'Set inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);

  const cards = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : null;
    if (!data || data.coins < BOOSTER_COST) {
      throw new HttpsError('failed-precondition', 'No tienes suficientes monedas.');
    }
    // Darkspoon's own account rolls the pulled Rare's rarity on much better
    // odds (see RARITY_ROLL.darkspoon) instead of the normal table --
    // checked server-side (not just at reveal time) since this is what
    // actually gets persisted.
    const useDarkspoonOdds = (data.username || '').toLowerCase() === 'darkspoon';
    const drawn = drawBoosterCards(CARD_CATALOG[setKey], Math.random, useDarkspoonOdds);
    const newCollection = Object.assign({}, data.collection);
    const newCollectionHolo = Object.assign({}, data.collectionHolo);
    const newCollectionSecret = Object.assign({}, data.collectionSecret);
    drawn.forEach(function (c) {
      const key = setKey + '-' + c.num;
      newCollection[key] = (newCollection[key] || 0) + 1;
      if (c.pulledRarity === 'holo') { newCollectionHolo[key] = (newCollectionHolo[key] || 0) + 1; }
      if (c.pulledRarity === 'secret') { newCollectionSecret[key] = (newCollectionSecret[key] || 0) + 1; }
    });
    tx.update(userRef, {
      coins: data.coins - BOOSTER_COST,
      collection: newCollection,
      collectionHolo: newCollectionHolo,
      collectionSecret: newCollectionSecret
    });
    return drawn;
  });

  return { cards: cards };
});

// Tienda's "Protectores" tab: a one-time cosmetic purchase, unlocked forever
// once bought -- unlike a booster, there's nothing to "consume" here, so a
// repeat purchase of an already-owned id is a harmless no-op instead of an
// error (covers double-clicks / stale UI without double-charging).
exports.buyCardBack = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const id = (request.data || {}).id;
  if (PROTECTOR_IDS.indexOf(id) === -1) {
    throw new HttpsError('invalid-argument', 'Protector inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : null;
    if (!data) {
      throw new HttpsError('failed-precondition', 'Cuenta no encontrada.');
    }
    const owned = Array.isArray(data.cardBacks) ? data.cardBacks : [];
    if (owned.indexOf(id) !== -1) {
      return { cardBacks: owned };
    }
    if (data.coins < PROTECTOR_COST) {
      throw new HttpsError('failed-precondition', 'No tienes suficientes monedas.');
    }
    const newCardBacks = owned.concat([id]);
    tx.update(userRef, { coins: data.coins - PROTECTOR_COST, cardBacks: newCardBacks });
    return { cardBacks: newCardBacks };
  });
});

const MAX_PHOTO_LENGTH = 200000; // ~150KB binary once base64 overhead is accounted for -- generous for a compressed profile photo, small enough to leave headroom in the 1MiB Firestore document limit

exports.updateProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const data = request.data || {};

  var newUsername = null;
  if (typeof data.username === 'string' && data.username.trim()) {
    newUsername = data.username.trim();
    if (!USERNAME_RE.test(newUsername)) {
      throw new HttpsError('invalid-argument', 'El usuario debe tener 3-20 letras, números o guión bajo.');
    }
  }

  var photo = null;
  if (typeof data.photo === 'string' && data.photo) {
    if (data.photo.indexOf('data:image/') !== 0) {
      throw new HttpsError('invalid-argument', 'La foto debe ser una imagen válida.');
    }
    if (data.photo.length > MAX_PHOTO_LENGTH) {
      throw new HttpsError('invalid-argument', 'La foto es demasiado grande.');
    }
    photo = data.photo;
  }

  if (!newUsername && !photo) {
    throw new HttpsError('invalid-argument', 'No hay cambios para guardar.');
  }

  const uid = request.auth.uid;
  const userRef = admin.firestore().collection('users').doc(uid);

  const result = await admin.firestore().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const currentUsername = userSnap.exists ? userSnap.data().username : null;
    const currentUsernameKey = currentUsername ? currentUsername.toLowerCase() : null;
    const newUsernameKey = newUsername ? newUsername.toLowerCase() : null;

    // Only touch the uniqueness index when the case-insensitive key actually
    // changes -- a pure casing edit (e.g. "hugo" -> "Hugo") keeps the same key.
    var newUsernameRef = null;
    if (newUsername && newUsernameKey !== currentUsernameKey) {
      newUsernameRef = admin.firestore().collection('usernames').doc(newUsernameKey);
      const newUsernameSnap = await tx.get(newUsernameRef);
      if (newUsernameSnap.exists) {
        throw new HttpsError('already-exists', 'Ese usuario ya está en uso.');
      }
    }

    const updates = {};
    if (newUsername) {
      if (newUsernameRef) {
        tx.set(newUsernameRef, { uid: uid });
        if (currentUsernameKey) {
          tx.delete(admin.firestore().collection('usernames').doc(currentUsernameKey));
        }
      }
      updates.username = newUsername;
    }
    if (photo) {
      updates.photo = photo;
    }
    tx.set(userRef, updates, { merge: true });
    return updates;
  });

  return result;
});

// 'overgrowth', 'blackout', 'zap', and 'brushfire' are the real,
// player-usable decks (see DECKLISTS in data-decks.js on the client) --
// rejecting anything else keeps this field from ever holding a deck the
// game can't actually load, even if a client bug let the UI send
// something else.
const VALID_DECK_KEYS = ['overgrowth', 'blackout', 'zap', 'brushfire'];

exports.updateActiveDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const deckKey = (request.data || {}).deckKey;
  if (VALID_DECK_KEYS.indexOf(deckKey) === -1) {
    throw new HttpsError('invalid-argument', 'Mazo inválido.');
  }

  const uid = request.auth.uid;
  await admin.firestore().collection('users').doc(uid).set({ activeDeck: deckKey }, { merge: true });
  return { activeDeck: deckKey };
});
