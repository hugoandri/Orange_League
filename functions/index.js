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

// ── App news (menu's "Novedades" panel + admin.html) ──────────────────
// Only this one account may publish/edit/delete -- there's exactly one
// real account on this project today, same reasoning as GRANT_TARGET_UID's
// one-time collection grant. Gated by uid (immutable) rather than username
// (can be renamed via updateProfile), same as that migration.
const ADMIN_UID = '4ViFsoJm7fMsop8eCS16u89wIxQ2';
// Matches the 3 real tag styles already defined in shell-theme.css
// (shell-news-item-tag--balance/--shop/--notice) -- kept as a fixed set
// rather than free text so the admin can't accidentally pick a tag with no
// matching CSS class.
const NEWS_TAGS = ['balance', 'shop', 'notice'];

function requireAdmin(request) {
  if (!request.auth || request.auth.uid !== ADMIN_UID) {
    throw new HttpsError('permission-denied', 'No tienes permiso para publicar novedades.');
  }
}

function validateNewsFields(data) {
  const title = (data.title || '').trim().slice(0, 80);
  const body = (data.body || '').trim().slice(0, 400);
  const tag = data.tag;
  if (!title) { throw new HttpsError('invalid-argument', 'El título es obligatorio.'); }
  if (!body) { throw new HttpsError('invalid-argument', 'El cuerpo es obligatorio.'); }
  if (NEWS_TAGS.indexOf(tag) === -1) { throw new HttpsError('invalid-argument', 'Etiqueta inválida.'); }
  return { title, body, tag, featured: !!data.featured };
}

// Only one news item is ever shown as "DESTACADO" at a time -- clears the
// flag off every other item server-side whenever a new one is marked
// featured, so the admin can never end up with two at once even from a
// stale/double-submitted form.
async function clearOtherFeatured(exceptId) {
  const snap = await admin.firestore().collection('news').where('featured', '==', true).get();
  const batch = admin.firestore().batch();
  snap.forEach((doc) => {
    if (doc.id !== exceptId) { batch.update(doc.ref, { featured: false }); }
  });
  await batch.commit();
}

exports.publishNews = onCall(async (request) => {
  requireAdmin(request);
  const fields = validateNewsFields(request.data || {});
  const docRef = await admin.firestore().collection('news').add(Object.assign({}, fields, {
    createdAt: FieldValue.serverTimestamp()
  }));
  if (fields.featured) { await clearOtherFeatured(docRef.id); }
  return { id: docRef.id };
});

exports.updateNewsItem = onCall(async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const id = data.id;
  if (!id) { throw new HttpsError('invalid-argument', 'Falta el id de la novedad.'); }
  const fields = validateNewsFields(data);
  const ref = admin.firestore().collection('news').doc(id);
  const snap = await ref.get();
  if (!snap.exists) { throw new HttpsError('not-found', 'Esa novedad no existe.'); }
  await ref.set(fields, { merge: true });
  if (fields.featured) { await clearOtherFeatured(id); }
  return { id: id };
});

exports.deleteNewsItem = onCall(async (request) => {
  requireAdmin(request);
  const id = (request.data || {}).id;
  if (!id) { throw new HttpsError('invalid-argument', 'Falta el id de la novedad.'); }
  await admin.firestore().collection('news').doc(id).delete();
  return { id: id };
});

const PRECON_DECK_KEYS_LIST = ['overgrowth', 'blackout', 'zap', 'brushfire'];
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ROOM_EXPIRY_MS = 20 * 60 * 1000;

function randomRoomCode() {
  var code = '';
  for (var i = 0; i < 6; i++) { code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]; }
  return code;
}

// Throws if deckId isn't usable -- either a real precon key, or
// 'custom:<slot>' where the caller actually has a saved deck in that slot.
async function validateDeckId(uid, deckId) {
  if (PRECON_DECK_KEYS_LIST.indexOf(deckId) !== -1) { return; }
  const m = /^custom:(.+)$/.exec(deckId || '');
  if (!m || CUSTOM_DECK_SLOTS.indexOf(m[1]) === -1) {
    throw new HttpsError('invalid-argument', 'Mazo inválido.');
  }
  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  const customDecks = (userSnap.data() || {}).customDecks || {};
  if (!customDecks[m[1]]) {
    throw new HttpsError('invalid-argument', 'Ese mazo personalizado no existe.');
  }
}

exports.createRoom = onCall(async (request) => {
  if (!request.auth) { throw new HttpsError('unauthenticated', 'Debes iniciar sesión.'); }
  const deckId = (request.data || {}).deckId;
  await validateDeckId(request.auth.uid, deckId);

  const db = admin.firestore();
  let roomCode;
  await db.runTransaction(async (tx) => {
    // Extremely unlikely collision on a 6-char, 32-symbol alphabet
    // (32^6 ≈ 1 billion) -- retried a few times inside one transaction
    // rather than assumed away.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomRoomCode();
      const snap = await tx.get(db.collection('rooms').doc(candidate));
      if (!snap.exists) { roomCode = candidate; break; }
    }
    if (!roomCode) { throw new HttpsError('internal', 'No se pudo generar un código de sala.'); }
    tx.set(db.collection('rooms').doc(roomCode), {
      hostUid: request.auth.uid, hostDeckId: deckId, hostReady: false,
      guestUid: null, guestDeckId: null, guestReady: false,
      status: 'waiting', matchId: null, createdAt: FieldValue.serverTimestamp()
    });
  });
  return { roomCode: roomCode };
});

exports.joinRoom = onCall(async (request) => {
  if (!request.auth) { throw new HttpsError('unauthenticated', 'Debes iniciar sesión.'); }
  const data = request.data || {};
  const roomCode = (data.roomCode || '').trim().toUpperCase();
  const deckId = data.deckId;
  await validateDeckId(request.auth.uid, deckId);

  const db = admin.firestore();
  const roomRef = db.collection('rooms').doc(roomCode);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists) { throw new HttpsError('not-found', 'Ese código no existe.'); }
    const room = snap.data();
    const isExpired = room.status === 'waiting' &&
      room.createdAt && (Date.now() - room.createdAt.toMillis()) > ROOM_EXPIRY_MS;
    if (isExpired) { throw new HttpsError('not-found', 'Ese código venció.'); }
    if (room.hostUid === request.auth.uid) {
      throw new HttpsError('failed-precondition', 'No puedes unirte a tu propia sala.');
    }
    if (room.status !== 'waiting' || room.guestUid) {
      throw new HttpsError('failed-precondition', 'Esa sala ya está llena o ya empezó.');
    }
    tx.update(roomRef, { guestUid: request.auth.uid, guestDeckId: deckId });
  });
  return { roomCode: roomCode };
});

// rules-engine.js is synced verbatim from the client (functions/scripts/
// sync-shared-engine.js) where CARD_STATS/DECKLISTS/PRECON_DECK_KEYS are
// script-tag globals (index.html loads data-cards.js/data-decks.js before
// rules-engine.js) rather than module imports -- rules-engine.js's own
// functions reference them as bare identifiers with no local declaration.
// To make that same file work under CommonJS here, these have to be bound
// onto the true global object before rules-engine.js's functions are
// called, so its bare references resolve via the scope chain.
const { CARD_STATS } = require('./lib/dataCards');
const { DECKLISTS, PRECON_DECK_KEYS } = require('./lib/dataDecks');
global.CARD_STATS = CARD_STATS;
global.DECKLISTS = DECKLISTS;
global.PRECON_DECK_KEYS = PRECON_DECK_KEYS;
const { createGame, redactMatchState } = require('./lib/rulesEngine');

// Mirrors ui.js's registerCustomDecks() (ui.js:3309) for exactly the one
// deck this match needs -- reads the caller's own saved custom deck and
// registers it into the server's own DECKLISTS under a synthetic key, so
// createGame() (which only ever looks up DECKLISTS[key]) doesn't need any
// changes to support a custom deck.
async function resolveDeckKeyForMatch(uid, deckId) {
  const m = /^custom:(.+)$/.exec(deckId || '');
  if (!m) { return deckId; } // already a real precon key
  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  const customDeck = (userSnap.data() || {}).customDecks || {};
  const saved = customDeck[m[1]];
  const syntheticKey = 'pvp_' + uid + '_' + m[1];
  DECKLISTS[syntheticKey] = saved.cards;
  return syntheticKey;
}

exports.setReady = onCall(async (request) => {
  if (!request.auth) { throw new HttpsError('unauthenticated', 'Debes iniciar sesión.'); }
  const roomCode = ((request.data || {}).roomCode || '').trim().toUpperCase();
  const uid = request.auth.uid;
  const db = admin.firestore();
  const roomRef = db.collection('rooms').doc(roomCode);

  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) { throw new HttpsError('not-found', 'Esa sala no existe.'); }
  const room = roomSnap.data();
  if (room.status !== 'waiting') { throw new HttpsError('failed-precondition', 'Esa sala ya no está esperando.'); }
  if (uid !== room.hostUid && uid !== room.guestUid) {
    throw new HttpsError('permission-denied', 'No formas parte de esa sala.');
  }

  const isHost = uid === room.hostUid;
  const readyField = isHost ? 'hostReady' : 'guestReady';
  const otherReady = isHost ? room.guestReady : room.hostReady;

  if (!otherReady) {
    await roomRef.update({ [readyField]: true });
    return { ready: true, matchId: null };
  }

  // Both sides ready -- resolve deck keys (before the transaction: these
  // are simple reads plus a DECKLISTS registration, not writes) and build
  // the match. hostUid always maps to engine slot 'player', guestUid
  // always to 'cpu' (see this plan's Global Constraints).
  const hostDeckKey = await resolveDeckKeyForMatch(room.hostUid, room.hostDeckId);
  const matchRef = db.collection('matches').doc();

  await db.runTransaction(async (tx) => {
    const freshRoomSnap = await tx.get(roomRef);
    const freshRoom = freshRoomSnap.data();
    if (freshRoom.status !== 'waiting') {
      throw new HttpsError('failed-precondition', 'Esa sala ya no está esperando.');
    }
    tx.update(roomRef, { [readyField]: true, status: 'started', matchId: matchRef.id });

    const state = createGame(Math.random, hostDeckKey, { player: true, cpu: true });
    const redacted = redactMatchState(state, freshRoom.hostUid, freshRoom.guestUid);
    tx.set(matchRef, redacted.public);
    tx.set(matchRef.collection('private').doc(freshRoom.hostUid), redacted.private[freshRoom.hostUid]);
    tx.set(matchRef.collection('private').doc(freshRoom.guestUid), redacted.private[freshRoom.guestUid]);
    // state.rng is the literal Math.random function reference createGame
    // stored on the state -- Firestore can't serialize a function, and a
    // live RNG couldn't survive a round-trip through Firestore anyway.
    // Persist everything else verbatim; whoever loads serverOnly/state
    // back out (Tasks 7-9) re-attaches a fresh Math.random before calling
    // back into the engine.
    tx.set(matchRef.collection('serverOnly').doc('state'), { state: Object.assign({}, state, { rng: null }) });
  });

  return { ready: true, matchId: matchRef.id };
});

const { canPlayBasic, playBasic, startMatch } = require('./lib/rulesEngine');

// Loads a match's full serverOnly state and resolves which engine slot
// ('player'/'cpu') the calling uid actually is. Every action handler below
// starts with this. Throws not-found/permission-denied as appropriate.
async function resolveMatchSide(matchId, uid) {
  const db = admin.firestore();
  const matchRef = db.collection('matches').doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) { throw new HttpsError('not-found', 'Esa partida no existe.'); }
  const pub = matchSnap.data();
  let side, opponentSide, opponentUid;
  if (pub.players.player1 === uid) { side = 'player'; opponentSide = 'cpu'; opponentUid = pub.players.player2; }
  else if (pub.players.player2 === uid) { side = 'cpu'; opponentSide = 'player'; opponentUid = pub.players.player1; }
  else { throw new HttpsError('permission-denied', 'No formas parte de esa partida.'); }
  const serverOnlySnap = await matchRef.collection('serverOnly').doc('state').get();
  const state = serverOnlySnap.data().state;
  // state.rng was nulled out before being written to Firestore (see
  // setReady's comment above -- Firestore can't store a function value).
  // Re-attach a fresh Math.random here, before returning, so anything
  // downstream that calls back into the engine (e.g. confirmSetup's
  // startMatch(state) -> coinFlip(state) -> state.rng()) has a real
  // function to call instead of crashing on a null.
  state.rng = Math.random;
  return { state: state, side: side, opponentSide: opponentSide, uid: uid, opponentUid: opponentUid, matchRef: matchRef };
}

// Writes the redacted public/private views back after a mutation --
// side1Uid/side2Uid are always (hostUid, guestUid) regardless of who
// called this action, matching redactMatchState's own fixed player1='player'/
// player2='cpu' mapping.
async function persistMatchState(matchRef, state, hostUid, guestUid) {
  const redacted = redactMatchState(state, hostUid, guestUid);
  // Null out state.rng again before writing -- mirrors setReady's exact
  // pattern above -- Firestore can't serialize a function value.
  await matchRef.collection('serverOnly').doc('state').set({ state: Object.assign({}, state, { rng: null }) });
  await matchRef.set(redacted.public);
  await matchRef.collection('private').doc(hostUid).set(redacted.private[hostUid]);
  await matchRef.collection('private').doc(guestUid).set(redacted.private[guestUid]);
}

exports.submitMatchAction = onCall(async (request) => {
  if (!request.auth) { throw new HttpsError('unauthenticated', 'Debes iniciar sesión.'); }
  const data = request.data || {};
  const matchId = data.matchId;
  const action = data.action || {};
  const { state, side, uid } = await resolveMatchSide(matchId, request.auth.uid);
  const db = admin.firestore();
  const matchRef = db.collection('matches').doc(matchId);
  const pub = (await matchRef.get()).data();
  const hostUid = pub.players.player1;
  const guestUid = pub.players.player2;

  switch (action.type) {
    case 'placeActive': {
      if (!canPlayBasic(state, side, action.handCardId)) {
        throw new HttpsError('failed-precondition', 'No puedes jugar esa carta ahí.');
      }
      if (state.players[side].active) {
        throw new HttpsError('failed-precondition', 'Ya tienes un Pokémon Activo.');
      }
      // playBasic(state, playerId, handId, benchIndex) needs a benchIndex,
      // but placing the very first (Active) Pokémon during setup has no
      // bench slot -- reuse the existing local convention (ui.js's own
      // drop-on-empty-Active-spot path) of calling playBasic with
      // benchIndex null. Confirmed against rules-engine.js:230-243:
      // playBasic places into p.active whenever it's currently null,
      // regardless of what benchIndex was passed, so this is correct
      // exactly as written.
      playBasic(state, side, action.handCardId, null);
      break;
    }
    case 'placeBench': {
      if (!canPlayBasic(state, side, action.handCardId)) {
        throw new HttpsError('failed-precondition', 'No puedes jugar esa carta ahí.');
      }
      if (typeof action.benchIndex !== 'number' || state.players[side].bench[action.benchIndex]) {
        throw new HttpsError('invalid-argument', 'Slot de banca inválido u ocupado.');
      }
      playBasic(state, side, action.handCardId, action.benchIndex);
      break;
    }
    case 'confirmSetup': {
      if (state.phase !== 'setup') { throw new HttpsError('failed-precondition', 'La partida ya empezó.'); }
      // Requires BOTH sides to have placed their opening Active before
      // this confirm can register -- not just the caller's own side. Real
      // rules: you can't lock in "ready to start" while your opponent's
      // board is still empty, since the coin flip (startMatch) needs both
      // Actives to exist. Confirmed by tracing the exact test above: the
      // guest's confirmSetup call right after placing their OWN Active
      // (with the host's Active still unset) must be rejected, even
      // though the guest's own side already has an Active at that point --
      // the only check that produces that rejection is one that looks at
      // both sides, not just the caller's.
      if (!state.players.player.active || !state.players.cpu.active) {
        throw new HttpsError('failed-precondition', 'Ambos jugadores deben colocar su Pokémon Activo antes de confirmar.');
      }
      state.setupConfirmed = state.setupConfirmed || { player: false, cpu: false };
      state.setupConfirmed[side] = true;
      if (state.setupConfirmed.player && state.setupConfirmed.cpu) {
        startMatch(state);
      }
      break;
    }
    default:
      throw new HttpsError('invalid-argument', 'Tipo de acción desconocido o no soportado en Fase 1: ' + action.type);
  }

  await persistMatchState(matchRef, state, hostUid, guestUid);
  return { ok: true };
});
