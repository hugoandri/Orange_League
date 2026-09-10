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

// PartyKit host -- the same one used in production, or 127.0.0.1:1999
// during local development (uncomment the second line and comment the
// first, mirroring firebase-init.js's own useEmulator toggle pattern).
var PVP_PARTY_HOST = 'tcg-simulador-pvp.hugoandri.partykit.dev';
// var PVP_PARTY_HOST = '127.0.0.1:1999';

var pvpSocket = null;
var pvpRoomHandler = null;
var pvpMatchHandler = null;
var pvpReqCounter = 0;
var pvpPendingActions = {}; // reqId -> {resolve, reject}
// Firestore's onSnapshot always fires immediately with the last-known
// value the instant something subscribes, even if that value arrived
// before the subscription existed -- initPvpRoomListener/
// initPvpMatchListeners below need the exact same behavior, since
// ui.js's startPvpRoomWait only calls initPvpRoomListener INSIDE
// createRoomCloud/joinRoomCloud's OWN .then() callback, i.e. strictly
// AFTER the party's first 'room' message already arrived and resolved
// that promise. Without caching it here, that first message (and for the
// match phase, the first 'match' message, delivered before enterPvpMatch
// ever calls initPvpMatchListeners) would already be lost by the time
// either handler gets registered -- these two variables are that cache.
var pvpLastRoomMessage = null;
var pvpLastMatchMessage = null;

function dispatchPvpMessage(data) {
  if (data.type === 'room') {
    pvpLastRoomMessage = data;
    if (pvpRoomHandler) { pvpRoomHandler(data); }
    return;
  }
  if (data.type === 'match') {
    pvpLastMatchMessage = data;
    if (pvpMatchHandler) { pvpMatchHandler(data); }
    return;
  }
  if (data.type === 'ack') {
    var pendingAck = pvpPendingActions[data.reqId];
    if (pendingAck) { delete pvpPendingActions[data.reqId]; pendingAck.resolve(); }
    return;
  }
  if (data.type === 'error') {
    var pendingErr = data.reqId != null ? pvpPendingActions[data.reqId] : null;
    if (pendingErr) { delete pvpPendingActions[data.reqId]; pendingErr.reject(new Error(data.message)); }
    return;
  }
  if (data.type === 'deckPeek') {
    var pendingPeek = pvpPendingActions[data.reqId];
    if (pendingPeek) { delete pvpPendingActions[data.reqId]; pendingPeek.resolve(data.cards); }
    return;
  }
}

// Opens the one shared PVP socket and resolves once the party's first
// real message arrives (an 'error' rejects, matching today's
// createRoom/joinRoom's own reject-on-invalid-code behavior) -- resolving
// on the bare WebSocket 'open' event isn't enough, since that only proves
// the TCP/TLS handshake succeeded, not that the party's own onConnect
// logic actually accepted this connection (room already taken, code
// doesn't exist, etc. all close the socket AFTER a real 'open'). Every
// message (including this first one) always goes through
// dispatchPvpMessage, so pvpLastRoomMessage/pvpLastMatchMessage are
// populated from the very start, regardless of whether a handler has
// been registered yet.
// Real gap this closes: pressing "back" out of the waiting-room screen
// before a match starts (pvpCreateBackBtn, ui.js) only ever clears
// pvpRoomHandler -- it has no reason to know it should also close a raw
// socket, since Firestore's onSnapshot (what it replaces) had no such
// resource to leak. Rather than teach ui.js about socket lifecycle, every
// fresh create/join here closes out any stale previous connection first,
// so backing out and trying again never accumulates more than one
// briefly-dangling connection (reaped the instant the next attempt
// starts, or by the browser itself on tab/page close either way).
function openPvpSocket(roomCode, deckId, cardBackId, intent) {
  if (pvpSocket) { pvpSocket.close(); pvpSocket = null; }
  pvpLastRoomMessage = null;
  pvpLastMatchMessage = null;
  return firebase.auth().currentUser.getIdToken().then(function (idToken) {
    return new Promise(function (resolve, reject) {
      var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + PVP_PARTY_HOST +
        '/parties/main/' + encodeURIComponent(roomCode) +
        '?token=' + encodeURIComponent(idToken) +
        '&deckId=' + encodeURIComponent(deckId) +
        '&cardBackId=' + encodeURIComponent(cardBackId) +
        '&intent=' + intent;
      var ws = new WebSocket(url);
      var settled = false;
      ws.addEventListener('message', function (e) {
        var data = JSON.parse(e.data);
        if (!settled) {
          settled = true;
          if (data.type === 'error') { ws.close(); reject(new Error(data.message)); return; }
          pvpSocket = ws;
          resolve({ roomCode: roomCode });
        }
        dispatchPvpMessage(data);
      });
      ws.addEventListener('close', function () {
        if (!settled) { settled = true; reject(new Error('No se pudo conectar a la sala.')); }
      });
      ws.addEventListener('error', function () {
        if (!settled) { settled = true; reject(new Error('No se pudo conectar a la sala.')); }
      });
    });
  });
}

// Real simplification from today's behavior: the old server-side
// createRoom retried up to 5 times inside one transaction on a
// collision. A collision here means openPvpSocket rejects (the party's
// onConnect sees an existing host and this client's intent is 'create')
// and the .catch() already wired at both ui.js call sites shows a plain
// alert -- no client-side auto-retry loop. Accepted: the odds are
// 1-in-32^6 (~1 billion), and the user's fix is just pressing "Crear
// Sala" again, which generates a fresh code.
function createRoomCloud(deckId) {
  var roomCode = randomRoomCodeClient();
  return openPvpSocket(roomCode, deckId, getCardBackId(), 'create');
}

function joinRoomCloud(roomCode, deckId) {
  return openPvpSocket(roomCode, deckId, getCardBackId(), 'join');
}

// Same 6-char, 32-symbol alphabet as the server used to generate
// (functions/index.js's now-deleted randomRoomCode) -- generated
// client-side now since PartyKit creates the room on first connection,
// there's no server round trip to ask for a fresh code.
function randomRoomCodeClient() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) { code += alphabet[Math.floor(Math.random() * alphabet.length)]; }
  return code;
}

function setReadyCloud() {
  pvpSocket.send(JSON.stringify({ type: 'setReady' }));
  return Promise.resolve();
}

function submitMatchActionCloud(matchId, action) {
  return new Promise(function (resolve, reject) {
    var reqId = ++pvpReqCounter;
    pvpPendingActions[reqId] = { resolve: resolve, reject: reject };
    pvpSocket.send(JSON.stringify({ type: 'action', reqId: reqId, action: action }));
  });
}

function peekOwnDeckCloud() {
  return new Promise(function (resolve, reject) {
    var reqId = ++pvpReqCounter;
    pvpPendingActions[reqId] = { resolve: resolve, reject: reject };
    pvpSocket.send(JSON.stringify({ type: 'peekOwnDeck', reqId: reqId }));
  });
}

function initPvpRoomListener(roomCode, onUpdate) {
  pvpRoomHandler = onUpdate;
  if (pvpLastRoomMessage) { onUpdate(pvpLastRoomMessage); }
  return function unsubscribe() { pvpRoomHandler = null; };
}

function initPvpMatchListeners(matchId, myUid, onUpdate) {
  pvpMatchHandler = function (data) { onUpdate({ public: data.public, myHand: data.myHand }); };
  if (pvpLastMatchMessage) { pvpMatchHandler(pvpLastMatchMessage); }
  return function unsubscribe() {
    pvpMatchHandler = null;
    if (pvpSocket) { pvpSocket.close(); pvpSocket = null; }
    pvpLastRoomMessage = null;
    pvpLastMatchMessage = null;
  };
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

