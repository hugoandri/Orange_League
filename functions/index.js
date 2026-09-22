const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const {
  computeMatchReward, BOOSTER_COST, drawBoosterCards, drawCustomPackCards, PROTECTOR_COST, PROTECTOR_IDS,
  CUSTOM_DECK_SLOTS, ownedCountsByName, supertypeByName, validateCustomDeck, starterDeckGrants
} = require('./lib/pureEconomy');
const CARD_CATALOG = require('./lib/cardCatalog');
const POKEMON_EVOLUTION = require('./lib/pokemonEvolution');
admin.initializeApp();

// The 3 real (non-promo) sets: basep/espromo (Wizards Black Star Promos +
// Special Promos) are gift-only, collectible but never sold as boosters --
// used below wherever an admin/booster action needs to validate against
// "a real, purchasable set" (setRareOdds, setEconomyConfig's boosterCosts).
const PLAYABLE_SET_KEYS = ['base', 'jungle', 'fossil'];

// Shared secret the PartyKit backend (party/index.js) uses to authenticate
// itself when writing to the active-match directory below -- NOT a user ID
// token, since these calls happen when a match starts/ends (server-side
// events), not on a fresh browser request. Same process.env-with-literal-
// fallback pattern as TELEGRAM_BOT_TOKEN elsewhere in this file; the
// literal fallback is a LOCAL-DEV-ONLY placeholder -- the real deployed
// project must set a real value via `firebase functions:config` (or the
// v2 equivalent) with the SAME value configured on the party side via
// `party env add PARTY_INTERNAL_SECRET`. The literal fallback must NEVER
// apply to a real deployment missing the env var -- that would defeat the
// whole point of the secret check (anyone can read this literal from this
// public source file). FUNCTIONS_EMULATOR is set to 'true' by the Firebase
// emulator (including under `firebase emulators:exec`, which
// functions/test/activeMatch.test.js runs under), so the literal still
// applies there; a real deploy missing the env var gets `null` instead, and
// registerActiveMatch/clearActiveMatch below fail closed (503) on that.
const PARTY_INTERNAL_SECRET = process.env.PARTY_INTERNAL_SECRET ||
  (process.env.FUNCTIONS_EMULATOR === 'true' ? 'change-me-in-production-party-internal-secret' : null);

// Deck-building eligibility, separately: CARD_STATS (data-cards.js) only
// ever implemented the Base Set's own 102 cards -- Jungle and Fossil are
// fully collectible (real boosters, real catalog entries) but were never
// given a real playable implementation. That distinction matters because a
// handful of names collide across sets without being the same real card
// (Pikachu is a genuinely different Jungle print, not a Base reprint) --
// counting a Jungle-sourced copy toward "do I own this card" used to let a
// player deck-build with a card this game has no actual rules for. Real
// reported bug, fixed by scoping deck ownership to Base only. Kept separate
// from the full CARD_CATALOG (which openBooster/claimNewsGift still use
// for all 3 sets, since those ARE real purchasable/collectible packs) so
// neither a promo nor a Jungle/Fossil copy can ever count toward deck
// ownership, even from a hand-crafted request.
const DECK_LEGAL_SET_KEYS = ['base'];
const DECK_LEGAL_CARD_CATALOG = {};
DECK_LEGAL_SET_KEYS.forEach((k) => { DECK_LEGAL_CARD_CATALOG[k] = CARD_CATALOG[k]; });

// The admin's "Probabilidades" panel (setRareOdds below) -- a single doc,
// one field per playable set, each {cardName: weight}. Read fresh on every
// pack opened rather than cached, since the admin can change it at any
// time and there's no reasonable staleness window for "did my odds change
// actually take effect". Missing doc/field/name all mean "no override yet",
// which drawBoosterCards/pickWeighted (pureEconomy.js) already treat as
// plain uniform odds -- the exact same behavior as before this existed.
async function fetchRareWeights(setKey) {
  const snap = await admin.firestore().collection('config').doc('rareOdds').get();
  return snap.exists ? (snap.data()[setKey] || null) : null;
}

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
    starterDeckChosen: null,
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

  return { coins: newCoins, delta: delta };
});

async function fetchEconomyConfig() {
  const snap = await admin.firestore().collection('config').doc('economy').get();
  const data = snap.exists ? snap.data() : {};
  return {
    boosterCosts: Object.assign({ base: 100, jungle: 100, fossil: 100 }, data.boosterCosts || {}),
    protectorCosts: Object.assign({}, data.protectorCosts || {}),
    starsPackages: Object.assign({}, STARS_PACKAGES, data.starsPackages || {})
  };
}

exports.openBooster = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const setKey = (request.data || {}).setKey;
  if (!Object.prototype.hasOwnProperty.call(CARD_CATALOG, setKey)) {
    throw new HttpsError('invalid-argument', 'Set inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const rareWeights = await fetchRareWeights(setKey);
  const ecoConfig = await fetchEconomyConfig();
  const cost = (ecoConfig.boosterCosts && typeof ecoConfig.boosterCosts[setKey] === 'number')
    ? ecoConfig.boosterCosts[setKey]
    : BOOSTER_COST;

  const cards = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : null;
    if (!data || data.coins < cost) {
      throw new HttpsError('failed-precondition', 'No tienes suficientes Orbes.');
    }
    // Darkspoon's own account rolls the pulled Rare's rarity on much better
    // odds (see RARITY_ROLL.darkspoon) instead of the normal table --
    // checked server-side (not just at reveal time) since this is what
    // actually gets persisted.
    const useDarkspoonOdds = (data.username || '').toLowerCase() === 'darkspoon';
    const drawn = drawBoosterCards(CARD_CATALOG[setKey], Math.random, useDarkspoonOdds, rareWeights);
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
      coins: data.coins - cost,
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
  const ecoConfig = await fetchEconomyConfig();
  const cost = (ecoConfig.protectorCosts && typeof ecoConfig.protectorCosts[id] === 'number')
    ? ecoConfig.protectorCosts[id]
    : PROTECTOR_COST;

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
    if (data.coins < cost) {
      throw new HttpsError('failed-precondition', 'No tienes suficientes Orbes.');
    }
    const newCardBacks = owned.concat([id]);
    tx.update(userRef, { coins: data.coins - cost, cardBacks: newCardBacks });
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

  // Once starterDeckChosen is a real deckKey (not null, not absent), the
  // player may only ever have THAT precon as their active deck -- switching
  // to any of the other 3 unpicked precons is blocked here, the real
  // enforcement point (the Decks screen's own click handler, ui.js, is UX
  // only and could be bypassed by calling this function directly). A
  // grandfathered account (starterDeckChosen absent/undefined) is
  // completely unaffected -- the check below only ever fires when the
  // field is a non-null string that differs from the requested deckKey.
  if (VALID_DECK_KEYS.indexOf(deckKey) !== -1) {
    const userRef = admin.firestore().collection('users').doc(uid);
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const uData = snap.exists ? snap.data() : {};
      if (uData.starterDeckChosen && uData.starterDeckChosen !== deckKey) {
        throw new HttpsError('failed-precondition', 'Ya elegiste tu mazo inicial -- no puedes cambiarte a otro precon.');
      }
      tx.set(userRef, { activeDeck: deckKey }, { merge: true });
    });
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

// The starter-deck counterpart to openBooster: grants a fixed, known
// 60-card decklist instead of a random pull, but the same trust boundary
// applies -- the grant is entirely server-computed (starterDeckGrants,
// pureEconomy.js) from a server-side decklist copy, never from anything
// the client sends. The transaction's own starterDeckChosen check (must be
// exactly null, not absent and not already a string) is the real
// enforcement of "choose once, permanently" -- the client-side mandatory
// screen (ui.js) is UX only.
exports.chooseStarterDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const deckKey = (request.data || {}).deckKey;
  if (VALID_DECK_KEYS.indexOf(deckKey) === -1) {
    throw new HttpsError('invalid-argument', 'Mazo inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const grants = starterDeckGrants(deckKey, CARD_CATALOG.base);

  const newCollection = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};
    if (data.starterDeckChosen !== null) {
      throw new HttpsError('failed-precondition', 'Ya elegiste tu mazo inicial.');
    }
    const updatedCollection = Object.assign({}, data.collection);
    Object.keys(grants).forEach(function (key) {
      updatedCollection[key] = (updatedCollection[key] || 0) + grants[key];
    });
    tx.update(userRef, {
      collection: updatedCollection,
      starterDeckChosen: deckKey,
      activeDeck: deckKey
    });
    return updatedCollection;
  });

  return { collection: newCollection };
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
    const owned = ownedCountsByName(uData.collection || {}, DECK_LEGAL_CARD_CATALOG);
    const supertypes = supertypeByName(DECK_LEGAL_CARD_CATALOG);
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
// Matches the 4 real tag styles already defined in shell-theme.css
// (shell-news-item-tag--balance/--shop/--notice/--gift) -- kept as a fixed
// set rather than free text so the admin can't accidentally pick a tag with
// no matching CSS class. 'gift' is the editorial category (the admin can
// tag ANY post "REGALO" even without one) -- separate from whether the post
// actually has a claimable gift attached (see validateGiftField/gift below).
const NEWS_TAGS = ['balance', 'shop', 'notice', 'gift'];

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

// A news item may optionally carry a one-time, once-per-player reward that
// shows up as a "reclamar" button in the menu's Novedades panel (see
// claimNewsGift below). Booster gifts reuse the same 3 sets sold in the
// shop; card gifts are restricted to the promo-only catalogs (basep/
// espromo) per the original ask -- the admin picks the exact rarity
// (rare/holo/secret) at gift time since promos don't have one single "real"
// rarity the way numbered Base/Jungle/Fossil cards do. custompack gifts
// point at an admin-curated customPacks/{packId} doc (see saveCustomPack) --
// existence is checked here (unlike booster/card, this isn't static
// in-memory CARD_CATALOG data) so a typo'd or deleted packId is caught at
// publish time, not silently at claim time for every future player.
const GIFT_BOOSTER_SET_KEYS = ['base', 'jungle', 'fossil'];
const GIFT_CARD_SET_KEYS = ['basep', 'espromo'];
const GIFT_RARITIES = ['rare', 'holo', 'secret'];

async function validateGiftField(gift) {
  if (!gift || !gift.kind) { return null; }
  if (gift.kind === 'booster') {
    if (GIFT_BOOSTER_SET_KEYS.indexOf(gift.setKey) === -1) {
      throw new HttpsError('invalid-argument', 'Set de pack inválido para el regalo.');
    }
    return { kind: 'booster', setKey: gift.setKey };
  }
  if (gift.kind === 'card') {
    if (GIFT_CARD_SET_KEYS.indexOf(gift.setKey) === -1) {
      throw new HttpsError('invalid-argument', 'Set de carta inválido para el regalo.');
    }
    const entry = (CARD_CATALOG[gift.setKey] || []).find((c) => c.num === gift.num);
    if (!entry) {
      throw new HttpsError('invalid-argument', 'Esa carta no existe en ese set.');
    }
    if (GIFT_RARITIES.indexOf(gift.rarity) === -1) {
      throw new HttpsError('invalid-argument', 'Rareza de regalo inválida.');
    }
    return { kind: 'card', setKey: gift.setKey, num: gift.num, rarity: gift.rarity };
  }
  if (gift.kind === 'custompack') {
    if (typeof gift.packId !== 'string' || !gift.packId) {
      throw new HttpsError('invalid-argument', 'Falta el id del pack personalizado.');
    }
    const packSnap = await admin.firestore().collection('customPacks').doc(gift.packId).get();
    if (!packSnap.exists) {
      throw new HttpsError('invalid-argument', 'Ese pack personalizado no existe.');
    }
    return { kind: 'custompack', packId: gift.packId };
  }
  throw new HttpsError('invalid-argument', 'Tipo de regalo inválido.');
}

exports.publishNews = onCall(async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const fields = validateNewsFields(data);
  const gift = await validateGiftField(data.gift);
  const docRef = await admin.firestore().collection('news').add(Object.assign({}, fields, {
    gift: gift,
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
  const gift = await validateGiftField(data.gift);
  const ref = admin.firestore().collection('news').doc(id);
  const snap = await ref.get();
  if (!snap.exists) { throw new HttpsError('not-found', 'Esa novedad no existe.'); }
  await ref.set(Object.assign({}, fields, { gift: gift }), { merge: true });
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

// Any signed-in player (not just the admin) can call this -- it's how a
// news item's optional gift actually gets granted, once per player per
// news item. The claim itself is enforced by a doc's mere existence at
// news/{newsId}/claims/{uid} (firestore.rules lets a player only ever READ
// -- never write -- their own claim doc, so this transaction, running
// under the Admin SDK, is the only path that can ever create one).
// A 'card' gift has no randomness to defer -- it grants immediately and its
// claim doc is created already opened:true. A 'booster'/'custompack' gift
// instead only REGISTERS the claim here (opened:false, nothing granted
// yet) -- the actual draw happens later, in openClaimedGift, once the
// player opens it from the Tienda's "PACK GRATIS" slot. This is what makes
// "Reclamar" in Novedades just flip the button to "Reclamado" (and make the
// pack available in the shop) without spending the pack's randomness right
// there -- see openClaimedGift below for the actual draw.
exports.claimNewsGift = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const newsId = (request.data || {}).newsId;
  if (!newsId) { throw new HttpsError('invalid-argument', 'Falta el id de la novedad.'); }

  const db = admin.firestore();
  const newsRef = db.collection('news').doc(newsId);
  const newsSnap = await newsRef.get();
  if (!newsSnap.exists) { throw new HttpsError('not-found', 'Esa novedad no existe.'); }
  const gift = newsSnap.data().gift;
  if (!gift) { throw new HttpsError('failed-precondition', 'Esta novedad no tiene un regalo.'); }

  const uid = request.auth.uid;
  const claimRef = newsRef.collection('claims').doc(uid);
  const userRef = db.collection('users').doc(uid);

  if (gift.kind !== 'card') {
    await db.runTransaction(async (tx) => {
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists) {
        throw new HttpsError('already-exists', 'Ya reclamaste este regalo.');
      }
      tx.set(claimRef, { claimedAt: FieldValue.serverTimestamp(), opened: false });
    });
    return { cards: null, opened: false };
  }

  const cards = await db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists) {
      throw new HttpsError('already-exists', 'Ya reclamaste este regalo.');
    }
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : {};
    const newCollection = Object.assign({}, userData.collection);
    const newCollectionHolo = Object.assign({}, userData.collectionHolo);
    const newCollectionSecret = Object.assign({}, userData.collectionSecret);

    const entry = CARD_CATALOG[gift.setKey].find((c) => c.num === gift.num);
    const key = gift.setKey + '-' + gift.num;
    newCollection[key] = (newCollection[key] || 0) + 1;
    if (gift.rarity === 'holo') { newCollectionHolo[key] = (newCollectionHolo[key] || 0) + 1; }
    if (gift.rarity === 'secret') { newCollectionSecret[key] = (newCollectionSecret[key] || 0) + 1; }
    const granted = [Object.assign({}, entry, { pulledRarity: gift.rarity })];

    tx.set(claimRef, { claimedAt: FieldValue.serverTimestamp(), opened: true });
    tx.set(userRef, {
      collection: newCollection,
      collectionHolo: newCollectionHolo,
      collectionSecret: newCollectionSecret
    }, { merge: true });
    return granted;
  });

  return { cards: cards, opened: true };
});

// Draws the actual cards for a 'booster'/'custompack' gift the player
// already claimed (see claimNewsGift above) but hasn't opened yet -- this
// is what the Tienda's "PACK GRATIS" modal calls when the player taps
// ABRIR on a pending pack.
// Shared by openClaimedGift/openCodePack -- resolves what's needed to
// actually draw a booster/custompack gift's cards (rareWeights config, or
// the custom pack's own pool resolved into real catalog entries). Pre-
// fetched outside whatever transaction the caller runs, same reasoning as
// fetchRareWeights itself: a pack definition, once its existence is
// confirmed here, is treated like any other static config for this call.
async function resolveGiftPackDrawInputs(gift) {
  const rareWeights = gift.kind === 'booster' ? await fetchRareWeights(gift.setKey) : null;
  let customPackPoolEntries = null;
  if (gift.kind === 'custompack') {
    const packSnap = await admin.firestore().collection('customPacks').doc(gift.packId).get();
    if (!packSnap.exists) { throw new HttpsError('not-found', 'Ese pack ya no existe.'); }
    customPackPoolEntries = (packSnap.data().pool || []).map((key) => {
      const sep = key.indexOf('-');
      const setKey = key.slice(0, sep);
      const num = key.slice(sep + 1);
      const entry = (CARD_CATALOG[setKey] || []).find((c) => c.num === num);
      return entry ? Object.assign({}, entry, { setKey: setKey }) : null;
    }).filter((e) => e !== null);
  }
  return { rareWeights, customPackPoolEntries };
}

// Draws the cards for a booster/custompack gift and merges them into the
// (already-cloned) newCollection/newCollectionHolo/newCollectionSecret
// objects in place -- shared by openClaimedGift/openCodePack so both stay
// in lockstep with drawBoosterCards/drawCustomPackCards's real behavior.
function drawAndMergeGiftPackCards(gift, drawInputs, newCollection, newCollectionHolo, newCollectionSecret) {
  if (gift.kind === 'booster') {
    const granted = drawBoosterCards(CARD_CATALOG[gift.setKey], Math.random, false, drawInputs.rareWeights);
    granted.forEach((c) => {
      const key = gift.setKey + '-' + c.num;
      newCollection[key] = (newCollection[key] || 0) + 1;
      if (c.pulledRarity === 'holo') { newCollectionHolo[key] = (newCollectionHolo[key] || 0) + 1; }
      if (c.pulledRarity === 'secret') { newCollectionSecret[key] = (newCollectionSecret[key] || 0) + 1; }
    });
    return granted;
  }
  // No rarity roll here (unlike the real-set rare slot above) -- each card
  // is granted at exactly its own printed catalog rarity, so a Rare Holo
  // pool card always comes out holo, never randomly plain.
  const granted = drawCustomPackCards(drawInputs.customPackPoolEntries, Math.random);
  granted.forEach((c) => {
    const key = c.setKey + '-' + c.num;
    newCollection[key] = (newCollection[key] || 0) + 1;
    if (c.r === 'Rare Holo') { newCollectionHolo[key] = (newCollectionHolo[key] || 0) + 1; }
  });
  return granted;
}

exports.openClaimedGift = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const newsId = (request.data || {}).newsId;
  if (!newsId) { throw new HttpsError('invalid-argument', 'Falta el id de la novedad.'); }

  const db = admin.firestore();
  const newsRef = db.collection('news').doc(newsId);
  const newsSnap = await newsRef.get();
  if (!newsSnap.exists) { throw new HttpsError('not-found', 'Esa novedad no existe.'); }
  const gift = newsSnap.data().gift;
  if (!gift) { throw new HttpsError('failed-precondition', 'Esta novedad no tiene un regalo.'); }

  const uid = request.auth.uid;
  const claimRef = newsRef.collection('claims').doc(uid);
  const userRef = db.collection('users').doc(uid);
  const drawInputs = await resolveGiftPackDrawInputs(gift);

  const cards = await db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists) {
      throw new HttpsError('failed-precondition', 'Todavía no reclamaste este regalo.');
    }
    if (claimSnap.data().opened) {
      throw new HttpsError('already-exists', 'Ya abriste este regalo.');
    }
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : {};
    const newCollection = Object.assign({}, userData.collection);
    const newCollectionHolo = Object.assign({}, userData.collectionHolo);
    const newCollectionSecret = Object.assign({}, userData.collectionSecret);
    const granted = drawAndMergeGiftPackCards(gift, drawInputs, newCollection, newCollectionHolo, newCollectionSecret);

    tx.set(claimRef, { opened: true, openedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(userRef, {
      collection: newCollection,
      collectionHolo: newCollectionHolo,
      collectionSecret: newCollectionSecret
    }, { merge: true });
    return granted;
  });

  return { cards: cards };
});

// ── Admin users overview (admin.html "Usuarios" tab) ───────────────────
// firestore.rules only lets a user read their own users/{uid} doc, so the
// admin panel can't just query the collection client-side -- this callable
// reads it with the Admin SDK (which bypasses rules) and is itself gated by
// requireAdmin, same pattern as the news functions above.
exports.listUsers = onCall(async (request) => {
  requireAdmin(request);
  const snap = await admin.firestore().collection('users').get();
  const users = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    users.push({
      uid: doc.id,
      username: d.username || '(sin nombre)',
      coins: typeof d.coins === 'number' ? d.coins : 0
    });
  });
  users.sort((a, b) => b.coins - a.coins);
  return { users: users };
});

// ── Admin "Probabilidades" tab ──────────────────────────────────────────
// Lets the admin re-weight which Rare/Rare Holo card comes out of a
// booster's one rare slot, per set. Stored at config/rareOdds.{setKey} =
// {cardName: weight} -- read by fetchRareWeights above, consumed by
// drawBoosterCards/pickWeighted (functions/lib/pureEconomy.js). Any name
// left out of the submitted odds, or the whole doc/field being absent,
// falls back to plain uniform odds (weight 1) -- an admin who never touches
// this tab changes nothing about existing behavior.
exports.setRareOdds = onCall(async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const setKey = data.setKey;
  if (PLAYABLE_SET_KEYS.indexOf(setKey) === -1) {
    throw new HttpsError('invalid-argument', 'Set inválido.');
  }
  const odds = data.odds;
  if (!odds || typeof odds !== 'object' || Array.isArray(odds)) {
    throw new HttpsError('invalid-argument', 'Formato de probabilidades inválido.');
  }
  const validNames = new Set(
    CARD_CATALOG[setKey]
      .filter((c) => c.r === 'Rare' || c.r === 'Rare Holo')
      .map((c) => c.n)
  );
  const cleaned = {};
  for (const name of Object.keys(odds)) {
    if (!validNames.has(name)) {
      throw new HttpsError('invalid-argument', 'Esa carta no es una rara real de ese set: ' + name);
    }
    const weight = odds[name];
    if (typeof weight !== 'number' || !isFinite(weight) || weight < 0) {
      throw new HttpsError('invalid-argument', 'Peso inválido para ' + name + '.');
    }
    cleaned[name] = weight;
  }
  await admin.firestore().collection('config').doc('rareOdds').set({ [setKey]: cleaned }, { merge: true });
  return { setKey: setKey, odds: cleaned };
});

// ── Admin "Packs" tab -- custom gift-only packs ────────────────────────
// A customPacks/{packId} doc = {name, art, pool}. pool is a flat list of
// "setKey-num" references into the real CARD_CATALOG (any set, including
// basep/espromo) that the admin picked as "cards that can come out of this
// pack" -- opening one (claimNewsGift's 'custompack' branch) draws 11
// unique cards from that pool, same count as a real booster, but with no
// rarity-tier structure since the pool itself is a flat admin-curated list.
const CUSTOM_PACK_ID_RE = /^[a-z0-9_-]{2,40}$/;

function parseCatalogKey(key) {
  const sep = typeof key === 'string' ? key.indexOf('-') : -1;
  if (sep === -1) { return null; }
  return { setKey: key.slice(0, sep), num: key.slice(sep + 1) };
}

exports.saveCustomPack = onCall(async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const packId = (data.packId || '').trim();
  if (!CUSTOM_PACK_ID_RE.test(packId)) {
    throw new HttpsError('invalid-argument', 'El id del pack debe tener 2-40 caracteres: minúsculas, números, "-" o "_".');
  }
  const name = (data.name || '').trim().slice(0, 40);
  if (!name) {
    throw new HttpsError('invalid-argument', 'El pack necesita un nombre.');
  }
  const art = Array.isArray(data.art)
    ? data.art.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim()).slice(0, 6)
    : [];
  const pool = Array.isArray(data.pool) ? data.pool : null;
  if (!pool || pool.length < 11) {
    throw new HttpsError('invalid-argument', 'El pack necesita al menos 11 cartas para elegir (tiene ' + (pool ? pool.length : 0) + ').');
  }
  // Repeated entries are intentional here (not a mistake to reject like
  // saveCustomDeck's real 4-copy rule) -- that's how the admin puts more
  // than one copy of the same card (e.g. 2 Grass Energy) into a single
  // pack's odds, since drawCustomPackCards/pickRandomUnique treats each
  // array slot as its own draw-able copy regardless of repeated values.
  for (const key of pool) {
    const parsed = parseCatalogKey(key);
    if (!parsed || !CARD_CATALOG[parsed.setKey] || !CARD_CATALOG[parsed.setKey].some((c) => c.num === parsed.num)) {
      throw new HttpsError('invalid-argument', 'Esa carta no existe: ' + key);
    }
  }
  await admin.firestore().collection('customPacks').doc(packId).set({
    name: name,
    art: art,
    pool: pool,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { packId: packId };
});

exports.deleteCustomPack = onCall(async (request) => {
  requireAdmin(request);
  const packId = (request.data || {}).packId;
  if (!packId) { throw new HttpsError('invalid-argument', 'Falta el id del pack.'); }
  await admin.firestore().collection('customPacks').doc(packId).delete();
  return { packId: packId };
});

// ── Admin "Códigos" tab -- one-time-per-player redeemable gift codes ──
// giftCodes/{code} = {gift, updatedAt}. gift reuses the exact same shape
// and validation as a news item's gift (validateGiftField) -- a code is
// really just "a gift not tied to any specific news post", redeemable by
// any signed-in player, once each (redemptions subcollection mirrors
// news/{id}/claims/{uid}). Booster/custompack gifts follow the same
// claim-then-open split as news gifts (see openClaimedGift's own comment),
// except the "pending to open" list lives on the player's own user doc
// (pendingCodePacks) instead of a per-news claim doc, since a code isn't
// tied to one news item a player can re-check claim status against.
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;

exports.saveGiftCode = onCall(async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const code = (data.code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    throw new HttpsError('invalid-argument', 'El código debe tener 3-30 caracteres: mayúsculas, números, "-" o "_".');
  }
  const gift = await validateGiftField(data.gift);
  if (!gift) {
    throw new HttpsError('invalid-argument', 'El código necesita un regalo.');
  }
  // A full overwrite (no {merge:true}) -- re-saving an existing code (e.g.
  // switching it from a 'card' gift to a 'booster' gift) must never leave
  // stale fields from the previous gift shape lingering in the doc.
  await admin.firestore().collection('giftCodes').doc(code).set({
    gift: gift,
    updatedAt: FieldValue.serverTimestamp()
  });
  return { code: code };
});

exports.deleteGiftCode = onCall(async (request) => {
  requireAdmin(request);
  const code = (request.data || {}).code;
  if (!code) { throw new HttpsError('invalid-argument', 'Falta el código.'); }
  await admin.firestore().collection('giftCodes').doc(code.trim().toUpperCase()).delete();
  return { code: code };
});

exports.redeemGiftCode = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const rawCode = (request.data || {}).code;
  if (!rawCode) { throw new HttpsError('invalid-argument', 'Ingresá un código.'); }
  const code = rawCode.trim().toUpperCase();

  const db = admin.firestore();
  const codeRef = db.collection('giftCodes').doc(code);
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists) { throw new HttpsError('not-found', 'Ese código no existe.'); }
  const gift = codeSnap.data().gift;

  const uid = request.auth.uid;
  const redemptionRef = codeRef.collection('redemptions').doc(uid);
  const userRef = db.collection('users').doc(uid);

  if (gift.kind === 'card') {
    const cards = await db.runTransaction(async (tx) => {
      const redemptionSnap = await tx.get(redemptionRef);
      if (redemptionSnap.exists) {
        throw new HttpsError('already-exists', 'Ya canjeaste este código.');
      }
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const newCollection = Object.assign({}, userData.collection);
      const newCollectionHolo = Object.assign({}, userData.collectionHolo);
      const newCollectionSecret = Object.assign({}, userData.collectionSecret);

      const entry = CARD_CATALOG[gift.setKey].find((c) => c.num === gift.num);
      const key = gift.setKey + '-' + gift.num;
      newCollection[key] = (newCollection[key] || 0) + 1;
      if (gift.rarity === 'holo') { newCollectionHolo[key] = (newCollectionHolo[key] || 0) + 1; }
      if (gift.rarity === 'secret') { newCollectionSecret[key] = (newCollectionSecret[key] || 0) + 1; }
      const granted = [Object.assign({}, entry, { pulledRarity: gift.rarity })];

      tx.set(redemptionRef, { redeemedAt: FieldValue.serverTimestamp() });
      tx.set(userRef, {
        collection: newCollection,
        collectionHolo: newCollectionHolo,
        collectionSecret: newCollectionSecret
      }, { merge: true });
      return granted;
    });
    return { kind: 'card', cards: cards, opened: true };
  }

  // booster/custompack: only registers the redemption + queues it onto the
  // player's own pendingCodePacks -- nothing is drawn until openCodePack
  // (Tienda's "PACK GRATIS" -> ABRIR), same split as claimNewsGift.
  await db.runTransaction(async (tx) => {
    const redemptionSnap = await tx.get(redemptionRef);
    if (redemptionSnap.exists) {
      throw new HttpsError('already-exists', 'Ya canjeaste este código.');
    }
    const userSnap = await tx.get(userRef);
    const pending = (userSnap.exists && Array.isArray(userSnap.data().pendingCodePacks)) ? userSnap.data().pendingCodePacks : [];
    tx.set(redemptionRef, { redeemedAt: FieldValue.serverTimestamp() });
    tx.set(userRef, { pendingCodePacks: pending.concat([{ code: code, gift: gift }]) }, { merge: true });
  });
  return { kind: gift.kind, cards: null, opened: false };
});

// Draws the actual cards for a redeemed booster/custompack code the player
// hasn't opened yet -- called from the Tienda's "PACK GRATIS" modal, same
// as openClaimedGift but sourced from pendingCodePacks instead of a news
// claim.
exports.openCodePack = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const rawCode = (request.data || {}).code;
  if (!rawCode) { throw new HttpsError('invalid-argument', 'Falta el código.'); }
  const code = rawCode.trim().toUpperCase();

  const uid = request.auth.uid;
  const userRef = admin.firestore().collection('users').doc(uid);

  const codeSnap = await admin.firestore().collection('giftCodes').doc(code).get();
  if (!codeSnap.exists) { throw new HttpsError('not-found', 'Ese código ya no existe.'); }
  const gift = codeSnap.data().gift;
  const drawInputs = await resolveGiftPackDrawInputs(gift);

  const cards = await admin.firestore().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : {};
    const pending = Array.isArray(userData.pendingCodePacks) ? userData.pendingCodePacks : [];
    const idx = pending.findIndex((p) => p.code === code);
    if (idx === -1) {
      throw new HttpsError('failed-precondition', 'Todavía no canjeaste ese código, o ya lo abriste.');
    }
    const newCollection = Object.assign({}, userData.collection);
    const newCollectionHolo = Object.assign({}, userData.collectionHolo);
    const newCollectionSecret = Object.assign({}, userData.collectionSecret);
    const granted = drawAndMergeGiftPackCards(gift, drawInputs, newCollection, newCollectionHolo, newCollectionSecret);

    const newPending = pending.slice();
    newPending.splice(idx, 1);
    tx.set(userRef, {
      collection: newCollection,
      collectionHolo: newCollectionHolo,
      collectionSecret: newCollectionSecret,
      pendingCodePacks: newPending
    }, { merge: true });
    return granted;
  });

  return { cards: cards };
});

const PRECON_DECK_KEYS_LIST = ['overgrowth', 'blackout', 'zap', 'brushfire'];

// Throws if deckId isn't usable -- either a real precon key, or
// 'custom:<slot>' where the caller actually has a saved deck in that slot.
async function validateDeckId(uid, deckId) {
  if (PRECON_DECK_KEYS_LIST.indexOf(deckId) !== -1) {
    // Same starter-deck lock updateActiveDeck (above) already enforces for
    // local play -- mirrored here so "Duelo en Vivo" can't be used as a
    // bypass. Three-state-correct on purpose: starterDeckChosen absent
    // (grandfathered account) or null (no choice made yet -- shouldn't
    // reach a PvP room anyway since the mandatory screen gates the menu,
    // but defense-in-depth) is falsy and never blocks; only a real,
    // different, already-chosen deckKey string blocks.
    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    const uData = userSnap.data() || {};
    if (uData.starterDeckChosen && uData.starterDeckChosen !== deckId) {
      throw new HttpsError('invalid-argument', 'Ya elegiste tu mazo inicial -- no puedes usar otro precon en Duelo en Vivo.');
    }
    return;
  }
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

// Real display name (and profile photo, for the waiting-room "VS" screen)
// for the room's own two participants -- players can only ever read their
// OWN users/{uid} doc (firestore.rules), so the opponent's username/photo
// has to be captured server-side (Admin SDK bypasses that rule) and carried
// on the room/match docs themselves, rather than ever asking the client to
// read it directly. One doc read covers both fields.
async function fetchProfile(uid) {
  const snap = await admin.firestore().collection('users').doc(uid).get();
  const data = snap.data() || {};
  return { username: data.username || 'Jugador', photo: data.photo || null };
}

// For a 'custom:{slot}' deckId, the deck's cover card name -- needed on the
// room doc for the exact same reason hostUsername/hostPhoto are (above):
// pvpDeckArtFor (ui.js) resolves a custom deck's cover art through the
// OWNER's own econState.customDecks, which the opponent's client never has.
// null for a precon deckId (its art is already resolvable client-side, via
// the global PRECON_DECK_ART table, for either viewer).
async function fetchDeckCoverName(uid, deckId) {
  const m = /^custom:(.+)$/.exec(deckId || '');
  if (!m) { return null; }
  const snap = await admin.firestore().collection('users').doc(uid).get();
  const customDecks = (snap.data() || {}).customDecks || {};
  const deck = customDecks[m[1]];
  return (deck && deck.coverName) || null;
}

// Real reported bug: the opponent's chosen card protector never reached
// the other client at all (ui.js's cardBackUrlFor forced the default for
// any non-'player' side, since the local CPU bot never has a real one) --
// captured here the same way hostUsername/hostDeckCoverName already are,
// so it can be carried onto the room/match docs. Trusts the CLIENT's own
// choice only as far as it can prove ownership: 'clasico' (the default) and
// the two other cost-less options are always allowed; every purchased
// Protector is named 'protector_*' (CARD_BACK_OPTIONS, ui.js) and must
// actually be in the caller's own users/{uid}.cardBacks array -- anything
// else (unrecognized id, or a paid one the caller never bought) silently
// falls back to the default rather than blocking room creation over a
// cosmetic. Keep FREE_CARD_BACK_IDS in sync with the cost-less entries in
// ui.js's CARD_BACK_OPTIONS if that list ever changes.
const FREE_CARD_BACK_IDS = ['clasico', 'pocket_monsters', 'arcoiris'];
async function resolveCardBackId(uid, cardBackId) {
  const id = typeof cardBackId === 'string' ? cardBackId : '';
  if (FREE_CARD_BACK_IDS.indexOf(id) !== -1) { return id; }
  if (id.indexOf('protector_') !== 0) { return 'clasico'; }
  const snap = await admin.firestore().collection('users').doc(uid).get();
  const owned = (snap.data() || {}).cardBacks || [];
  return owned.indexOf(id) !== -1 ? id : 'clasico';
}

// Server-to-server only (the PartyKit room's own `fetch()`, never a
// browser) -- a plain onRequest endpoint, not onCall, since there's no
// Firebase client SDK on the calling side to attach request.auth
// automatically. Called once per socket, on connect (see
// party/index.js's onConnect) -- never once per action, which is what
// keeps this off PVP's hot path entirely.
exports.resolvePvpIdentity = onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const { idToken, deckId, cardBackId } = req.body || {};

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken || '');
    uid = decoded.uid;
  } catch (err) {
    res.status(401).json({ error: 'Token inválido.' });
    return;
  }

  try {
    await validateDeckId(uid, deckId);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Mazo inválido.' });
    return;
  }

  const profile = await fetchProfile(uid);
  const deckCoverName = await fetchDeckCoverName(uid, deckId);
  const resolvedCardBackId = await resolveCardBackId(uid, cardBackId);
  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  const userData = userSnap.data() || {};

  // Same synthetic-key convention resolveDeckKeyForMatch already used --
  // duplicated here (not calling that function) because it mutates a
  // shared DECKLISTS global that no longer exists in this file after
  // Task 7; the PARTY registers customDeckCards into its OWN DECKLISTS
  // right before calling createGame (see party/index.js, Task 5).
  const customMatch = /^custom:(.+)$/.exec(deckId || '');
  let deckKey = deckId;
  let customDeckCards = null;
  if (customMatch) {
    const saved = (userData.customDecks || {})[customMatch[1]];
    // Narrow race: validateDeckId (above) did its own separate Firestore
    // read to confirm this slot existed, but userSnap here is a second,
    // later read -- if the slot was deleted/overwritten in between, saved
    // is undefined. Fail clean (400) rather than let saved.cards throw,
    // same defensive shape fetchDeckCoverName already uses for the
    // identical case just above.
    if (!saved) { res.status(400).json({ error: 'Ese mazo personalizado ya no existe.' }); return; }
    deckKey = 'pvp_' + uid + '_' + customMatch[1];
    customDeckCards = saved.cards;
  }

  res.status(200).json({
    uid: uid, username: profile.username, photo: profile.photo,
    deckKey: deckKey, deckCoverName: deckCoverName, customDeckCards: customDeckCards,
    cardBackId: resolvedCardBackId,
    collectionHolo: userData.collectionHolo || {},
    collectionSecret: userData.collectionSecret || {}
  });
});

// "Duelo en Vivo": party/index.js calls this (best-effort, fire-and-forget)
// the moment a match actually starts (startMatch()), once per side, so a
// player who later loses access to their browser (crash, dead internet,
// closed tab) can find their way back from ANY device -- see
// 2026-09-17-pvp-reconnect-forfeit-design.md section 4.1.
exports.registerActiveMatch = onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const { uid, roomCode, secret } = req.body || {};
  // Fail closed: PARTY_INTERNAL_SECRET is only ever null in a real deploy
  // that forgot to set the env var (see its own comment above). Without
  // this check, a request with an explicit `secret: null` in its JSON body
  // would pass `secret !== PARTY_INTERNAL_SECRET` (null !== null is false).
  if (!PARTY_INTERNAL_SECRET) { res.status(503).json({ error: 'No configurado.' }); return; }
  if (secret !== PARTY_INTERNAL_SECRET) { res.status(401).json({ error: 'No autorizado.' }); return; }
  if (!uid || !roomCode) { res.status(400).json({ error: 'Faltan datos.' }); return; }
  await admin.firestore().collection('activeMatches').doc(uid).set({ roomCode: roomCode });
  res.status(200).json({ ok: true });
});

// Called by party/index.js (same auth as registerActiveMatch above) the
// first time it observes the match has a winner -- normal win, timeout, or
// a forfeit -- for both uids.
exports.clearActiveMatch = onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const { uid, secret } = req.body || {};
  // Same fail-closed check as registerActiveMatch above -- see its comment.
  if (!PARTY_INTERNAL_SECRET) { res.status(503).json({ error: 'No configurado.' }); return; }
  if (secret !== PARTY_INTERNAL_SECRET) { res.status(401).json({ error: 'No autorizado.' }); return; }
  if (!uid) { res.status(400).json({ error: 'Faltan datos.' }); return; }
  await admin.firestore().collection('activeMatches').doc(uid).delete();
  res.status(200).json({ ok: true });
});

// Called by the BROWSER client (economy.js's getActiveMatchCloud) when the
// main menu loads -- normal onCall auth via the caller's own Firebase Auth
// context, same pattern as awardMatchResult/updateProfile above.
exports.getActiveMatch = onCall(async (request) => {
  if (!request.auth) { throw new HttpsError('unauthenticated', 'Debes iniciar sesión.'); }
  const snap = await admin.firestore().collection('activeMatches').doc(request.auth.uid).get();
  return { roomCode: snap.exists ? snap.data().roomCode : null };
});

// ===== TELEGRAM STARS PAYMENTS =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8922530812:AAFJeIUrTlRPEiMIDLtSyoHCURwX5bDyyVQ';

const STARS_PACKAGES = {
  orbes_100: {
    id: 'orbes_100',
    title: '100 Orbes · Bolsa',
    description: 'Bolsa con 100 Orbes para comprar sobres y protectores en la tienda.',
    coins: 100,
    stars: 15
  },
  orbes_550: {
    id: 'orbes_550',
    title: '550 Orbes · Saco (+50 Extra)',
    description: 'Saco con 550 Orbes (+10% extra) para expandir tu colección de cartas.',
    coins: 550,
    stars: 65
  },
  orbes_1400: {
    id: 'orbes_1400',
    title: '1,400 Orbes · Cofre (+200 Extra)',
    description: 'Cofre con 1,400 Orbes (+16% extra) para sobres y protectores exclusivos.',
    coins: 1400,
    stars: 140
  },
  orbes_3600: {
    id: 'orbes_3600',
    title: '3,600 Orbes · Tesoro de la Liga (+600 Extra)',
    description: 'Tesoro de la Liga con 3,600 Orbes (+20% extra). ¡El paquete definitivo!',
    coins: 3600,
    stars: 320
  }
};

exports.createStarsInvoice = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para comprar Orbes.');
  }
  const data = request.data || {};
  const packageId = data.packageId;
  const ecoConfig = await fetchEconomyConfig();
  const pkg = (ecoConfig.starsPackages && ecoConfig.starsPackages[packageId]) || STARS_PACKAGES[packageId];
  if (!pkg) {
    throw new HttpsError('invalid-argument', 'Paquete de Orbes no válido.');
  }

  const payload = JSON.stringify({
    uid: request.auth.uid,
    packageId: pkg.id,
    coins: pkg.coins,
    stars: pkg.stars,
    createdAt: Date.now()
  });

  const body = {
    title: pkg.title,
    description: pkg.description || pkg.title,
    payload: payload,
    currency: 'XTR',
    prices: [{ label: pkg.title, amount: pkg.stars }]
  };

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const resData = await res.json();
  if (!resData.ok) {
    console.error('Telegram createInvoiceLink error:', resData);
    throw new HttpsError('internal', resData.description || 'Error al generar la factura en Telegram.');
  }

  return {
    invoiceLink: resData.result,
    package: pkg
  };
});

async function sendTelegramMessage(chatId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) { body.reply_markup = replyMarkup; }
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch((err) => console.error('Error sending Telegram message:', err));
}

async function sendTelegramInvoice(chatId, title, description, payload, stars) {
  const cleanTitle = String(title || 'Orbes').slice(0, 32);
  const cleanDesc = String(description || 'Paquete de Orbes para Orange League').slice(0, 255);
  const cleanPrice = Math.max(1, parseInt(stars, 10) || 1);

  let invoiceUrl = null;
  try {
    const linkRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: cleanTitle,
        description: cleanDesc,
        payload: payload,
        currency: 'XTR',
        prices: [{ label: cleanTitle, amount: cleanPrice }]
      })
    });
    const linkData = await linkRes.json();
    if (linkData.ok && linkData.result) {
      invoiceUrl = linkData.result;
    } else {
      console.error('Error from createInvoiceLink:', JSON.stringify(linkData));
    }
  } catch (err) {
    console.error('Error calling createInvoiceLink:', err);
  }

  // Also send native invoice card to the chat
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendInvoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        title: cleanTitle,
        description: cleanDesc,
        payload: payload,
        currency: 'XTR',
        prices: [{ label: cleanTitle, amount: cleanPrice }]
      })
    });
  } catch (err) {
    console.error('Error sending native invoice:', err);
  }

  // Always send the interactive payment button
  if (invoiceUrl) {
    await sendTelegramMessage(
      chatId,
      `⭐️ *${cleanTitle}*\n${cleanDesc}\n\n👉 *Presiona el botón de abajo para pagar con Estrellas (⭐):*`,
      {
        inline_keyboard: [
          [{ text: `⭐️ Pagar ${cleanPrice} ⭐ ahora`, url: invoiceUrl }]
        ]
      }
    );
  }

  return { ok: true, invoiceUrl: invoiceUrl };
}

async function answerTelegramCallbackQuery(queryId, text, showAlert = false) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: queryId,
      text: text,
      show_alert: !!showAlert
    })
  }).catch((err) => console.error('Error answering Telegram callback:', err));
}

async function buildShopKeyboard(uid, username, pkgs) {
  const keyboard = await Promise.all(Object.keys(pkgs).map(async (k) => {
    const p = pkgs[k];
    const tagText = p.tag ? ` (${p.tag})` : '';
    const payload = JSON.stringify({
      uid: uid,
      packageId: p.id,
      coins: p.coins,
      stars: p.stars,
      createdAt: Date.now()
    });

    const invoiceTitle = (p.title || `${p.coins} Orbes`).slice(0, 32);
    const invoiceDesc = `Recibirás ${p.coins} Orbes en la cuenta de Entrenador (${username || 'Jugador'}).`.slice(0, 255);

    try {
      const linkRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: invoiceTitle,
          description: invoiceDesc,
          payload: payload,
          currency: 'XTR',
          prices: [{ label: invoiceTitle, amount: p.stars }]
        })
      });
      const linkData = await linkRes.json();
      if (linkData.ok && linkData.result) {
        return [{
          text: `⭐️ ${p.coins} Orbes — ${p.stars} ⭐${tagText}`,
          url: linkData.result
        }];
      }
    } catch (_) {}

    return [{
      text: `⭐️ ${p.coins} Orbes — ${p.stars} ⭐${tagText}`,
      callback_data: `buy_${p.id}`
    }];
  }));

  keyboard.push([{ text: '🔄 Cambiar cuenta vinculada', callback_data: 'change_uid' }]);
  return keyboard;
}

exports.telegramWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const update = req.body || {};

  // 1. Handle pre_checkout_query (must answer within 10s to approve Stars payment)
  if (update.pre_checkout_query) {
    const pcq = update.pre_checkout_query;
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: pcq.id,
          ok: true
        })
      });
    } catch (err) {
      console.error('Error answering pre_checkout_query:', err);
    }
    res.status(200).json({ ok: true });
    return;
  }

  // 2. Handle successful_payment (credited after Stars purchase completes)
  if (update.message && update.message.successful_payment) {
    const sp = update.message.successful_payment;
    try {
      const payload = JSON.parse(sp.invoice_payload);
      if (payload && payload.uid && payload.coins) {
        const db = admin.firestore();
        const userRef = db.collection('users').doc(payload.uid);
        const chargeId = sp.telegram_payment_charge_id;
        const paymentRef = db.collection('payments').doc(chargeId);

        await db.runTransaction(async (tx) => {
          const pDoc = await tx.get(paymentRef);
          if (pDoc.exists) {
            console.log(`Payment ${chargeId} already processed.`);
            return;
          }

          const userDoc = await tx.get(userRef);
          if (!userDoc.exists) {
            console.error(`User ${payload.uid} not found for payment ${chargeId}`);
            return;
          }

          tx.set(paymentRef, {
            chargeId: chargeId,
            providerPaymentChargeId: sp.provider_payment_charge_id || null,
            uid: payload.uid,
            packageId: payload.packageId,
            coins: payload.coins,
            stars: sp.total_amount,
            currency: sp.currency,
            paidAt: FieldValue.serverTimestamp(),
            telegramUser: update.message.from || null
          });

          tx.update(userRef, {
            coins: FieldValue.increment(payload.coins)
          });
        });

        // Send confirmation receipt to the buyer on Telegram
        if (update.message.chat && update.message.chat.id) {
          const confirmText = `🎉 *¡PAGO RECIBIDO CON ÉXITO!*\n\nSe han acreditado *${payload.coins} Orbes* en tu cuenta de Entrenador de Orange League.\n\n🆔 UID: \`${payload.uid}\`\n⭐️ Estrellas pagadas: ${sp.total_amount} ⭐\n\n¡Gracias por tu compra! Ya puedes abrir sobres y protectores en el juego.`;
          await sendTelegramMessage(update.message.chat.id, confirmText);
        }
      }
    } catch (err) {
      console.error('Error processing successful_payment:', err);
    }
    res.status(200).json({ ok: true });
    return;
  }

  // 3. Handle callback_query (inline buttons for choosing packages)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = (cb.message && cb.message.chat && cb.message.chat.id) || (cb.from && cb.from.id);
    const data = cb.data || '';
    const db = admin.firestore();

    if (data.startsWith('buy_') && chatId) {
      const packageId = data.replace('buy_', '');
      const linkSnap = await db.collection('telegram_links').doc(String(chatId)).get();
      if (!linkSnap.exists) {
        await answerTelegramCallbackQuery(cb.id, '⚠️ Primero vincula tu UID con /vincular TU_UID', true);
        await sendTelegramMessage(chatId, '⚠️ *Aún no has vinculado tu UID del juego.*\n\nPor favor escribe:\n`/vincular TU_UID`');
        res.status(200).json({ ok: true });
        return;
      }
      const linkData = linkSnap.data();
      const ecoConfig = await fetchEconomyConfig();
      const pkg = (ecoConfig.starsPackages && ecoConfig.starsPackages[packageId]) || STARS_PACKAGES[packageId];
      if (!pkg) {
        await answerTelegramCallbackQuery(cb.id, 'Paquete no válido.', true);
        res.status(200).json({ ok: true });
        return;
      }

      await answerTelegramCallbackQuery(cb.id, `Generando orden de ${pkg.coins} Orbes...`);

      const payload = JSON.stringify({
        uid: linkData.uid,
        packageId: pkg.id,
        coins: pkg.coins,
        stars: pkg.stars,
        createdAt: Date.now()
      });

      await sendTelegramInvoice(
        chatId,
        pkg.title,
        `Recibirás ${pkg.coins} Orbes en la cuenta de Entrenador (${linkData.username || 'Jugador'}).`,
        payload,
        pkg.stars
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (data === 'change_uid' && chatId) {
      await answerTelegramCallbackQuery(cb.id, 'Cambiar UID');
      await sendTelegramMessage(chatId, 'Para vincular un UID diferente, escribe:\n\n`/vincular TU_NUEVO_UID`');
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
    return;
  }

  // 4. Handle text messages and commands
  if (update.message && update.message.text) {
    const text = update.message.text.trim();
    const chatId = update.message.chat.id;
    const fromUser = update.message.from || {};
    const db = admin.firestore();

    // 4.1 /start [payload]
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const startParam = parts[1] || '';

      if (startParam.startsWith('uid_')) {
        const uid = startParam.replace('uid_', '').trim();
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
          const userData = userSnap.data();
          await db.collection('telegram_links').doc(String(chatId)).set({
            uid: uid,
            username: userData.username || 'Jugador',
            telegramId: fromUser.id || chatId,
            telegramUsername: fromUser.username || null,
            updatedAt: FieldValue.serverTimestamp()
          });

          const ecoConfig = await fetchEconomyConfig();
          const pkgs = ecoConfig.starsPackages || STARS_PACKAGES;
          const inlineKeyboard = await buildShopKeyboard(uid, userData.username, pkgs);

          const welcomeMsg = `⚡ *¡ORANGE LEAGUE TCG - TIENDA OFICIAL!*\n\n✅ *Cuenta vinculada con éxito:*\n👤 Entrenador: *${userData.username || 'Jugador'}*\n🆔 UID: \`${uid}\`\n💰 Saldo actual: *${userData.coins || 0} Orbes*\n\n🛒 *Elige el paquete que deseas comprar con Estrellas (⭐):*\n\nSi necesitas ayuda utiliza el comando /ayuda.`;
          await sendTelegramMessage(chatId, welcomeMsg, { inline_keyboard: inlineKeyboard });
          res.status(200).json({ ok: true });
          return;
        }
      }

      // Check if already linked
      const linkSnap = await db.collection('telegram_links').doc(String(chatId)).get();
      if (linkSnap.exists) {
        const linkData = linkSnap.data();
        const msg = `¡Hola de nuevo, *${linkData.username || 'Entrenador'}*! ⚡\n\n🆔 UID vinculado: \`${linkData.uid}\`\n\n📌 *Comandos disponibles:*\n• /tienda o /comprar - Ver paquetes de Orbes ⭐\n• /vincular <UID> - Cambiar tu UID\n• /ayuda - Información y soporte\n\nSi necesitas ayuda utiliza el comando /ayuda.`;
        await sendTelegramMessage(chatId, msg, {
          keyboard: [[{ text: '🛒 Ver Tienda / Comprar Orbes' }, { text: '👤 Mi Cuenta' }]],
          resize_keyboard: true
        });
      } else {
        const msg = `¡Bienvenido a *Orange League - Pokémon TCG Simulator*! ⚡\n\nAquí puedes comprar *Orbes* directamente con *Estrellas de Telegram (⭐)* y cargarlos a tu juego.\n\n👉 Para comenzar, dinos tu UID del juego:\nEscribe: \`/vincular TU_UID\`\n\n💡 *¿Dónde encuentro mi UID?*\nEn el juego, en la barra inferior del menú principal verás tu código (ej: \`UID: 4ViFsoJm...\`).\n\nSi necesitas ayuda utiliza el comando /ayuda.`;
        await sendTelegramMessage(chatId, msg);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // 4.2 Check current linked account (button "👤 Mi Cuenta" or commands)
    const isShowAccount = (
      text === '👤 Mi Cuenta' ||
      text.toLowerCase() === 'mi cuenta' ||
      text.toLowerCase() === 'cuenta' ||
      text === '/cuenta' ||
      text === '/vincular' ||
      text === '/micuenta'
    );

    if (isShowAccount) {
      const linkSnap = await db.collection('telegram_links').doc(String(chatId)).get();
      if (linkSnap.exists) {
        const linkData = linkSnap.data();
        const userSnap = await db.collection('users').doc(linkData.uid).get();
        const userCoins = userSnap.exists ? (userSnap.data().coins || 0) : 0;
        const userName = userSnap.exists ? (userSnap.data().username || linkData.username) : linkData.username;
        const msg = `👤 *TU CUENTA VINCULADA:*\n\n• Entrenador: *${userName}*\n• UID: \`${linkData.uid}\`\n• Saldo actual: *${userCoins} Orbes*\n\nPara vincular otra cuenta, escribe:\n\`/vincular OTRO_UID\``;
        await sendTelegramMessage(chatId, msg, {
          keyboard: [[{ text: '🛒 Ver Tienda / Comprar Orbes' }, { text: '👤 Mi Cuenta' }]],
          resize_keyboard: true
        });
      } else {
        const msg = `⚠️ *Aún no has vinculado tu cuenta del juego.*\n\nPor favor escribe:\n\`/vincular TU_UID\`\n\n💡 *¿Dónde encuentro mi UID?*\nEn el juego, en la barra inferior del menú principal verás tu código (ej: \`UID: 4ViFsoJm...\`).`;
        await sendTelegramMessage(chatId, msg);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // 4.3 Link specific UID: /vincular <UID> or /cuenta <UID>
    if (text.startsWith('/vincular ') || text.startsWith('/cuenta ')) {
      const parts = text.split(/\s+/);
      const uidArg = parts.slice(1).join('').trim();

      if (!uidArg) {
        await sendTelegramMessage(chatId, `⚠️ Para vincular tu cuenta, incluye tu UID:\n\nEjemplo: \`/vincular TU_UID\``);
        res.status(200).json({ ok: true });
        return;
      }

      const userSnap = await db.collection('users').doc(uidArg).get();
      if (!userSnap.exists) {
        await sendTelegramMessage(chatId, `❌ No se encontró ningún Entrenador con el UID: \`${uidArg}\`.\n\nVerifica haberlo copiado bien desde la barra inferior del menú principal del juego.`);
        res.status(200).json({ ok: true });
        return;
      }

      const userData = userSnap.data();
      await db.collection('telegram_links').doc(String(chatId)).set({
        uid: uidArg,
        username: userData.username || 'Jugador',
        telegramId: fromUser.id || chatId,
        telegramUsername: fromUser.username || null,
        updatedAt: FieldValue.serverTimestamp()
      });

      const confirmMsg = `✅ *¡Cuenta vinculada con éxito!*\n\n👤 *Entrenador:* ${userData.username || 'Jugador'}\n🆔 *UID:* \`${uidArg}\`\n💰 *Saldo actual:* ${userData.coins || 0} Orbes\n\n¡Ahora puedes escribir /tienda para comprar Orbes con Estrellas ⭐!`;
      await sendTelegramMessage(chatId, confirmMsg, {
        keyboard: [[{ text: '🛒 Ver Tienda / Comprar Orbes' }, { text: '👤 Mi Cuenta' }]],
        resize_keyboard: true
      });
      res.status(200).json({ ok: true });
      return;
    }

    // 4.3 /tienda or /comprar or button "🛒 Ver Tienda / Comprar Orbes"
    if (text.startsWith('/tienda') || text.startsWith('/comprar') || text === '🛒 Ver Tienda / Comprar Orbes') {
      const linkSnap = await db.collection('telegram_links').doc(String(chatId)).get();
      if (!linkSnap.exists) {
        const notLinkedMsg = `⚠️ *Aún no has vinculado tu UID del juego.*\n\nPor favor escribe:\n\`/vincular TU_UID\`\n\n(Tu UID está en la barra inferior del menú principal del juego)`;
        await sendTelegramMessage(chatId, notLinkedMsg);
        res.status(200).json({ ok: true });
        return;
      }

      const linkData = linkSnap.data();
      const userSnap = await db.collection('users').doc(linkData.uid).get();
      const userCoins = userSnap.exists ? (userSnap.data().coins || 0) : 0;
      const userName = userSnap.exists ? (userSnap.data().username || linkData.username) : linkData.username;

      const ecoConfig = await fetchEconomyConfig();
      const pkgs = ecoConfig.starsPackages || STARS_PACKAGES;
      const inlineKeyboard = await buildShopKeyboard(linkData.uid, userName, pkgs);

      const shopMsg = `🛒 *TIENDA DE ORBES · ORANGE LEAGUE*\n\n👤 *Entrenador:* ${userName}\n🆔 *UID:* \`${linkData.uid}\`\n💰 *Saldo actual:* ${userCoins} Orbes\n\nElige el paquete que deseas comprar con *Estrellas de Telegram (⭐)*:`;
      await sendTelegramMessage(chatId, shopMsg, { inline_keyboard: inlineKeyboard });
      res.status(200).json({ ok: true });
      return;
    }

    // 4.4 /ayuda
    if (text.startsWith('/ayuda') || text.startsWith('/help')) {
      const helpMsg = `❓ *AYUDA - BOT DE ORANGE LEAGUE*\n\n1. *¿Cómo compro Orbes?*\n• Primero vincula tu cuenta escribiendo: \`/vincular TU_UID\`\n• Luego escribe /tienda y selecciona tu paquete.\n• Confirma el pago con tus Estrellas de Telegram (⭐).\n• ¡Los Orbes se cargan automáticamente a tu partida!\n\n2. *¿Dónde encuentro mi UID?*\nEn la barra inferior del menú principal del juego verás tu código de Entrenador.\n\n3. *¿Dudas o problemas?*\nÚnete a nuestra comunidad en Discord: https://discord.gg/vrsFAkvFN`;
      await sendTelegramMessage(chatId, helpMsg);
      res.status(200).json({ ok: true });
      return;
    }

    // 4.5 Auto-detect raw UID paste (20 to 36 chars)
    if (/^[a-zA-Z0-9_-]{20,36}$/.test(text)) {
      const userSnap = await db.collection('users').doc(text).get();
      if (userSnap.exists) {
        const userData = userSnap.data();
        await db.collection('telegram_links').doc(String(chatId)).set({
          uid: text,
          username: userData.username || 'Jugador',
          telegramId: fromUser.id || chatId,
          telegramUsername: fromUser.username || null,
          updatedAt: FieldValue.serverTimestamp()
        });
        const confirmMsg = `✅ *¡UID detectado y vinculado con éxito!*\n\n👤 *Entrenador:* ${userData.username || 'Jugador'}\n🆔 *UID:* \`${text}\`\n💰 *Saldo:* ${userData.coins || 0} Orbes\n\n¡Ahora puedes escribir /tienda para ver los paquetes de Orbes con Estrellas ⭐!`;
        await sendTelegramMessage(chatId, confirmMsg, {
          keyboard: [[{ text: '🛒 Ver Tienda / Comprar Orbes' }, { text: '👤 Mi Cuenta' }]],
          resize_keyboard: true
        });
        res.status(200).json({ ok: true });
        return;
      }
    }
  }

  res.status(200).json({ ok: true });
});

// ── Admin Economy / Shop Prices Config ──────────────────────────────────
exports.getEconomyConfig = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  return fetchEconomyConfig();
});

exports.setEconomyConfig = onCall(async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const boosterCosts = data.boosterCosts || {};
  const protectorCosts = data.protectorCosts || {};
  const starsPackages = data.starsPackages || {};

  const cleanBoosterCosts = {};
  ['base', 'jungle', 'fossil'].forEach((k) => {
    const v = parseInt(boosterCosts[k], 10);
    cleanBoosterCosts[k] = isNaN(v) || v < 0 ? 100 : v;
  });

  const cleanProtectorCosts = {};
  PROTECTOR_IDS.forEach((id) => {
    const v = parseInt(protectorCosts[id], 10);
    cleanProtectorCosts[id] = isNaN(v) || v < 0 ? 75 : v;
  });

  const cleanStarsPackages = {};
  Object.keys(starsPackages).forEach((key) => {
    const p = starsPackages[key];
    if (p && typeof p === 'object') {
      const coins = parseInt(p.coins, 10);
      const stars = parseInt(p.stars, 10);
      if (!isNaN(coins) && coins > 0 && !isNaN(stars) && stars > 0) {
        cleanStarsPackages[key] = {
          id: String(p.id || key).slice(0, 30),
          title: String(p.title || '').slice(0, 80),
          subtitle: String(p.subtitle || '').slice(0, 80),
          description: String(p.description || '').slice(0, 200),
          coins: coins,
          stars: stars,
          tag: p.tag ? String(p.tag).slice(0, 40) : null
        };
      }
    }
  });

  const payload = {
    boosterCosts: cleanBoosterCosts,
    protectorCosts: cleanProtectorCosts,
    starsPackages: Object.keys(cleanStarsPackages).length > 0 ? cleanStarsPackages : STARS_PACKAGES,
    updatedAt: FieldValue.serverTimestamp()
  };

  await admin.firestore().collection('config').doc('economy').set(payload, { merge: true });
  return { ok: true, config: payload };
});


