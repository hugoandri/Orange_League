var econState = null;
var profileState = null;

// onFirstLoad (optional): called once, the first time this listener hears
// back from Firestore at all (success OR error) -- auth-ui.js uses this to
// know when to hide #accountVerifyingOverlay, so the player can't touch
// anything (Novedades gift buttons included) while econState is still null.
function initEconomyListener(uid, onFirstLoad) {
  econState = null;
  profileState = null;
  var firstLoadHandled = false;
  function handleFirstLoad() {
    if (firstLoadHandled) { return; }
    firstLoadHandled = true;
    if (onFirstLoad) { onFirstLoad(); }
  }
  return firebase.firestore().collection('users').doc(uid)
    .onSnapshot(function (snap) {
      handleFirstLoad();
      var data = snap.data();
      if (!data) { return; }
      econState = { coins: data.coins, collection: data.collection || {}, collectionHolo: data.collectionHolo || {}, collectionSecret: data.collectionSecret || {}, activeDeck: data.activeDeck || 'overgrowth', cardBacks: data.cardBacks || [], customDecks: data.customDecks || {}, pendingCodePacks: data.pendingCodePacks || [] };
      profileState = { uid: uid, username: data.username || '', photo: data.photo || null };
      renderCoinCount();
      renderProfile();
      updateShopBalance();
      renderCardBackPicker();
      // Keeps the Tienda's "PACK GRATIS" slot in sync with redeemed-but-
      // unopened code packs (see redeemGiftCodeCloud/pendingGiftBoosters) --
      // a no-op if the shop isn't currently open.
      renderShopScreen();
      // Real-time-updates econState.cardBacks whenever a purchase actually
      // lands, independent of the buyCardBack callable's own response --
      // that response can resolve before this snapshot arrives, so without
      // this the just-bought protector kept showing "COMPRAR" until the
      // player left the tab and came back (which forces a fresh render).
      renderProtectorsGrid();
      // Custom decks (Fase 4) are registered into the same DECKLISTS/
      // DECK_DISPLAY_NAME objects the 4 precons already live in (see
      // registerCustomDecks, ui.js), so every deck-consuming function
      // (createGame, expandDecklist, deckComposition, selectDeckCard, ...)
      // already just works for them with no further changes.
      registerCustomDecks();
    }, function (err) {
      handleFirstLoad();
      console.error('No se pudo escuchar los datos de la cuenta', err);
    });
}

// Menu's "Novedades" panel -- read directly via the client SDK (firestore.rules
// allows any signed-in player to read the 'news' collection; only
// publishNews/updateNewsItem/deleteNewsItem, server-side, can ever write to
// it -- see admin.html). Ordered newest-first, capped at 20 (the panel
// itself only ever shows the featured one + a handful more).
function initNewsListener() {
  return firebase.firestore().collection('news').orderBy('createdAt', 'desc').limit(20)
    .onSnapshot(function (snap) {
      var items = [];
      snap.forEach(function (doc) {
        var data = doc.data();
        items.push({
          id: doc.id, title: data.title, body: data.body, tag: data.tag, featured: !!data.featured,
          gift: data.gift || null,
          claimed: false,
          // False only while a gift's claim doc read (below) is still in
          // flight -- lets newsGiftButtonHtml (ui.js) show a neutral
          // "checking" state instead of flashing "RECLAMAR" (implying
          // not-yet-claimed) for an already-claimed gift on every fresh
          // page load, until the real answer comes back. Items with no
          // gift at all have nothing to check, so they start (and stay) true.
          claimChecked: !data.gift,
          // Whether the pack was actually opened (cards drawn/granted) --
          // 'card' gifts are always opened the instant they're claimed;
          // 'booster'/'custompack' gifts are claimed in Novedades (just
          // registers it, see claimNewsGift) but only actually opened later
          // from the Tienda's "PACK GRATIS" slot (openClaimedGift).
          opened: false,
          // Firestore Timestamp -> real JS Date -- createdAt can briefly be
          // null right after publishNews() writes it (serverTimestamp()
          // resolves asynchronously), so this falls back to "now" rather
          // than crashing renderNewsPanel's date formatting for that one
          // brief window.
          createdAt: data.createdAt ? data.createdAt.toDate() : new Date()
        });
      });
      var uid = firebase.auth().currentUser && firebase.auth().currentUser.uid;
      var giftedItems = uid ? items.filter(function (it) { return it.gift; }) : [];
      if (!giftedItems.length) {
        renderNewsPanel(items);
        return;
      }
      // Only items with a gift attached need a claim check (firestore.rules
      // lets a player read only their OWN claim doc, see news/{id}/claims/{uid}) --
      // renders once up front with claimed:false so the panel isn't blocked
      // on these reads, then re-renders as each claim status comes back.
      renderNewsPanel(items);
      Promise.all(giftedItems.map(function (it) {
        return firebase.firestore().collection('news').doc(it.id).collection('claims').doc(uid).get()
          .then(function (snap) {
            it.claimed = snap.exists;
            it.opened = snap.exists && !!snap.data().opened;
            it.claimChecked = true;
          })
          .catch(function () { it.claimChecked = true; });
      })).then(function () { renderNewsPanel(items); });
    }, function (err) { console.error('No se pudieron cargar las novedades', err); });
}

// Admin-curated gift-only packs (admin.html's "Packs" tab, see
// saveCustomPack/claimNewsGift's 'custompack' branch, functions/index.js).
// {packId: {name, art, pool}} -- read directly via the client SDK
// (firestore.rules lets any signed-in player read customPacks/*), so the
// Tienda's "PACK GRATIS" slot/modal (ui.js) can show a custom pack's own
// name/art instead of a real set's BOOSTER_PACKS entry.
var customPacksCache = {};
function initCustomPacksListener() {
  return firebase.firestore().collection('customPacks')
    .onSnapshot(function (snap) {
      var next = {};
      snap.forEach(function (doc) { next[doc.id] = doc.data(); });
      customPacksCache = next;
      // A pack's name/art can affect what's currently on-screen (the shop's
      // "PACK GRATIS" card, an open gift-booster-modal, the Novedades gift
      // chip) -- cheap to just re-render both real-time, and simpler than
      // threading a "did custom pack metadata change" signal through them.
      renderShopScreen();
      renderNewsPanel(latestNewsItems);
    }, function (err) { console.error('No se pudieron cargar los packs personalizados', err); });
}

// Returns {cards, opened} -- cards is null and opened is false for a
// 'booster'/'custompack' gift (nothing is drawn until openClaimedGiftCloud,
// once the player actually opens it from the Tienda). A 'card' gift comes
// back with real cards and opened:true immediately, since there's nothing
// to draw.
function claimNewsGiftCloud(newsId) {
  return firebase.functions().httpsCallable('claimNewsGift')({ newsId: newsId })
    .then(function (res) { return res.data; });
}

function openClaimedGiftCloud(newsId) {
  return firebase.functions().httpsCallable('openClaimedGift')({ newsId: newsId })
    .then(function (res) { return res.data.cards; });
}

// Same {kind, cards, opened} shape as claimNewsGiftCloud -- Configuración's
// "Canjear código" section (ui.js) branches on `kind`/`opened` the same way.
function redeemGiftCodeCloud(code) {
  return firebase.functions().httpsCallable('redeemGiftCode')({ code: code })
    .then(function (res) { return res.data; });
}

function openCodePackCloud(code) {
  return firebase.functions().httpsCallable('openCodePack')({ code: code })
    .then(function (res) { return res.data.cards; });
}

function awardMatchResultCloud(result) {
  return firebase.functions().httpsCallable('awardMatchResult')({ result: result });
}

function openBoosterCloud(setKey) {
  return firebase.functions().httpsCallable('openBooster')({ setKey: setKey })
    .then(function (res) { return res.data.cards; });
}

function buyCardBackCloud(id) {
  return firebase.functions().httpsCallable('buyCardBack')({ id: id });
}

function updateProfileCloud(data) {
  return firebase.functions().httpsCallable('updateProfile')(data);
}

function updateActiveDeckCloud(deckKey) {
  return firebase.functions().httpsCallable('updateActiveDeck')({ deckKey: deckKey });
}

// cards: [{name, count}]. coverName (optional): a card name from within
// cards, chosen as the deck's cover photo (see the Deck Builder's PORTADA
// DEL MAZO box, ui.js). Server re-validates everything (real 60-card/
// 4-copy/ownership rules, and that coverName is actually in cards) regardless
// of what the client already checked -- see saveCustomDeck, functions/index.js.
function saveCustomDeckCloud(slot, name, cards, coverName) {
  return firebase.functions().httpsCallable('saveCustomDeck')({ slot: slot, name: name, cards: cards, coverName: coverName || null });
}

// cardBackId (getCardBackId(), ui.js): the caller's own currently-equipped
// protector -- captured here (same pattern as deckId) so the server can
// carry it onto the room/match docs as hostCardBackId/guestCardBackId,
// which is what actually lets a real PVP rival see it (see
// cardBackUrlFor's own comment, ui.js) instead of always forcing the
// default the way local-vs-CPU play already did.
function createRoomCloud(deckId) {
  var fn = firebase.functions().httpsCallable('createRoom');
  return fn({ deckId: deckId, cardBackId: getCardBackId() }).then(function (res) { return res.data; });
}

function joinRoomCloud(roomCode, deckId) {
  var fn = firebase.functions().httpsCallable('joinRoom');
  return fn({ roomCode: roomCode, deckId: deckId, cardBackId: getCardBackId() }).then(function (res) { return res.data; });
}

// Fire-and-forget: boots each PVP Cloud Function's own Cloud Run container
// ahead of time, before the player has actually pressed anything that needs
// the match to move. Real reported bug: Cloud Functions v2 has no warm
// instances by default, and createRoom/joinRoom/setReady/submitMatchAction
// are each a SEPARATE service -- functions:log confirmed a cold TCP probe
// alone took ~3.4s for setReady and ~1.9s for submitMatchAction, stacking
// into several real seconds of "nothing happening" between pressing
// Iniciar and the RPS screen showing up. Each call below uses a payload
// guaranteed to fail fast, BEFORE any real read/write (invalid-argument on
// a bogus deckId, not-found on a bogus room/match code) -- the container
// still boots regardless of the thrown error, which is all this needs.
// Called the moment the PVP menu opens (menuPvp click, ui.js) -- picking a
// deck, creating/joining a room, and waiting for the opponent all give this
// several idle seconds to finish in the background before Iniciar is ever
// pressed for real.
// NOT '__warmup__' -- Firestore treats any doc id matching /^__.*__$/ as
// reserved and throws INVALID_ARGUMENT for it, which surfaced server-side
// as an actual unhandled rejection (visible in functions:log) instead of
// the clean not-found/invalid-argument this needs -- worse, the underlying
// SDK call retries a few times before giving up, wasting exactly the
// container time this was supposed to save. 'warmup_ping' isn't a real
// room/match code either, so it still fails fast for the same reason, just
// without tripping Firestore's reserved-id path.
var WARMUP_PLACEHOLDER_ID = 'warmup_ping';
var pvpFunctionsWarmed = false;
function warmupPvpFunctionsCloud() {
  if (pvpFunctionsWarmed) { return; }
  pvpFunctionsWarmed = true;
  firebase.functions().httpsCallable('createRoom')({ deckId: WARMUP_PLACEHOLDER_ID }).catch(function () {});
  firebase.functions().httpsCallable('joinRoom')({ roomCode: WARMUP_PLACEHOLDER_ID, deckId: WARMUP_PLACEHOLDER_ID }).catch(function () {});
  firebase.functions().httpsCallable('setReady')({ roomCode: WARMUP_PLACEHOLDER_ID }).catch(function () {});
  firebase.functions().httpsCallable('submitMatchAction')({ matchId: WARMUP_PLACEHOLDER_ID, action: { type: WARMUP_PLACEHOLDER_ID } }).catch(function () {});
}

function setReadyCloud(roomCode) {
  var fn = firebase.functions().httpsCallable('setReady');
  return fn({ roomCode: roomCode }).then(function (res) { return res.data; });
}

function submitMatchActionCloud(matchId, action) {
  var fn = firebase.functions().httpsCallable('submitMatchAction');
  return fn({ matchId: matchId, action: action }).then(function (res) { return res.data; });
}

// Waiting-room screen (ui.js) listens to this to know when the opponent
// joins/readies and when the match actually starts (roomData.status
// flips to 'started', roomData.matchId becomes non-null).
function initPvpRoomListener(roomCode, onUpdate) {
  return firebase.firestore().collection('rooms').doc(roomCode)
    .onSnapshot(function (snap) {
      if (!snap.exists) { onUpdate(null); return; }
      onUpdate(snap.data());
    }, function (err) { console.error('No se pudo escuchar la sala', err); });
}

// Merges the public board doc + my own private hand doc into one callback
// -- ui.js's PVP board-render path (Task 14) never has to reason about
// the two listeners firing independently/out of order, since either one
// firing just re-delivers both pieces together from their last-known
// values.
function initPvpMatchListeners(matchId, myUid, onUpdate) {
  var latestPublic = null;
  var latestHand = null;
  function fire() { if (latestPublic) { onUpdate({ public: latestPublic, myHand: latestHand || [] }); } }
  var unsubPublic = firebase.firestore().collection('matches').doc(matchId)
    .onSnapshot(function (snap) { latestPublic = snap.data(); fire(); },
      function (err) { console.error('No se pudo escuchar la partida', err); });
  var unsubPrivate = firebase.firestore().collection('matches').doc(matchId).collection('private').doc(myUid)
    .onSnapshot(function (snap) { latestHand = snap.exists ? snap.data().hand : []; fire(); },
      function (err) { console.error('No se pudo escuchar tu mano', err); });
  return function unsubscribeBoth() { unsubPublic(); unsubPrivate(); };
}

function createStarsInvoiceCloud(packageId) {
  var fn = firebase.functions().httpsCallable('createStarsInvoice');
  return fn({ packageId: packageId }).then(function (res) { return res.data; });
}

var globalEconomyConfig = null;

function initEconomyConfigListener() {
  return firebase.firestore().collection('config').doc('economy')
    .onSnapshot(function (snap) {
      var data = snap.exists ? snap.data() : null;
      globalEconomyConfig = data ? {
        boosterCosts: Object.assign({ base: 100, jungle: 100, fossil: 100 }, data.boosterCosts || {}),
        protectorCosts: Object.assign({}, data.protectorCosts || {}),
        starsPackages: data.starsPackages || null
      } : null;
      if (typeof renderShopScreen === 'function') { renderShopScreen(); }
      if (typeof renderProtectorsGrid === 'function') { renderProtectorsGrid(); }
      if (typeof renderOrbesShopGrid === 'function') { renderOrbesShopGrid(); }
    }, function (err) {
      console.warn('No se pudo cargar la configuración de precios', err);
    });
}

function setEconomyConfigCloud(config) {
  var fn = firebase.functions().httpsCallable('setEconomyConfig');
  return fn(config).then(function (res) { return res.data; });
}

function getEconomyConfigCloud() {
  var fn = firebase.functions().httpsCallable('getEconomyConfig');
  return fn().then(function (res) { return res.data; });
}

