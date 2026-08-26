const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  computeMatchReward, BOOSTER_COST, drawBoosterCards, PROTECTOR_COST, PROTECTOR_IDS,
  CUSTOM_DECK_SLOTS, ownedCountsByName, supertypeByName, validateCustomDeck
} = require('./lib/pureEconomy');
const CARD_CATALOG = require('./lib/cardCatalog');
const POKEMON_EVOLUTION = require('./lib/pokemonEvolution');
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
      throw new HttpsError('failed-precondition', 'No tienes suficientes Orbes.');
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
      throw new HttpsError('failed-precondition', 'No tienes suficientes Orbes.');
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
  const uid = request.auth.uid;

  if (VALID_DECK_KEYS.indexOf(deckKey) !== -1) {
    await admin.firestore().collection('users').doc(uid).set({ activeDeck: deckKey }, { merge: true });
    return { activeDeck: deckKey };
  }
  // A custom deck slot ('custom-1'..'custom-4') is only a legal activeDeck
  // if THIS player has actually saved a deck there -- checked inside a
  // transaction (not just a shape check) since it depends on live
  // Firestore state, same reasoning as every other read-then-validate
  // write in this file.
  if (CUSTOM_DECK_SLOTS.indexOf(deckKey) !== -1) {
    const userRef = admin.firestore().collection('users').doc(uid);
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const uData = snap.exists ? snap.data() : {};
      if (!uData.customDecks || !uData.customDecks[deckKey]) {
        throw new HttpsError('failed-precondition', 'Ese mazo personalizado no existe todavía.');
      }
      tx.set(userRef, { activeDeck: deckKey }, { merge: true });
    });
    return { activeDeck: deckKey };
  }
  throw new HttpsError('invalid-argument', 'Mazo inválido.');
});

// Saves (creates or overwrites) one of the player's up to 4 custom-deck
// slots. cards: [{name, count}] -- validated server-side against the real
// 1999 deck-construction rules AND the player's own live collection (see
// validateCustomDeck, pureEconomy.js) so a client bug or tampered request
// can never persist an illegal or unowned decklist, matching every other
// write in this file being server-validated rather than trusted from the
// client.
exports.saveCustomDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const data = request.data || {};
  const slot = data.slot;
  if (CUSTOM_DECK_SLOTS.indexOf(slot) === -1) {
    throw new HttpsError('invalid-argument', 'Slot de mazo inválido.');
  }
  const name = (data.name || '').trim().slice(0, 30);
  if (!name) {
    throw new HttpsError('invalid-argument', 'El mazo necesita un nombre.');
  }
  const cards = Array.isArray(data.cards) ? data.cards : null;
  if (!cards) {
    throw new HttpsError('invalid-argument', 'Lista de cartas inválida.');
  }
  // Cover photo (optional): must be one of the card names actually in this
  // deck -- a client bug or tampered request could otherwise claim a cover
  // the player never even put in the list.
  const coverName = data.coverName || null;
  if (coverName !== null && !cards.some((c) => c && c.name === coverName)) {
    throw new HttpsError('invalid-argument', 'La portada debe ser una carta que esté en el mazo.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const savedDeck = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Cuenta no encontrada.');
    }
    const uData = snap.data();
    const owned = ownedCountsByName(uData.collection || {}, CARD_CATALOG);
    const supertypes = supertypeByName(CARD_CATALOG);
    const check = validateCustomDeck(cards, owned, supertypes, POKEMON_EVOLUTION);
    if (!check.valid) {
      throw new HttpsError('failed-precondition', check.reason);
    }
    const customDecks = Object.assign({}, uData.customDecks);
    const deck = { name: name, cards: cards, coverName: coverName };
    customDecks[slot] = deck;
    tx.set(userRef, { customDecks: customDecks }, { merge: true });
    return deck;
  });

  return { slot: slot, deck: savedDeck };
});
