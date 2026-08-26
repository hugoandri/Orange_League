var econState = null;
var profileState = null;

function initEconomyListener(uid) {
  econState = null;
  profileState = null;
  return firebase.firestore().collection('users').doc(uid)
    .onSnapshot(function (snap) {
      var data = snap.data();
      if (!data) { return; }
      econState = { coins: data.coins, collection: data.collection || {}, collectionHolo: data.collectionHolo || {}, collectionSecret: data.collectionSecret || {}, activeDeck: data.activeDeck || 'overgrowth', cardBacks: data.cardBacks || [], customDecks: data.customDecks || {} };
      profileState = { username: data.username || '', photo: data.photo || null };
      renderCoinCount();
      renderProfile();
      updateShopBalance();
      renderCardBackPicker();
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
      console.error('No se pudo escuchar los datos de la cuenta', err);
    });
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
