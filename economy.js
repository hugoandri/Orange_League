var econState = null;
var profileState = null;

function initEconomyListener(uid) {
  econState = null;
  profileState = null;
  return firebase.firestore().collection('users').doc(uid)
    .onSnapshot(function (snap) {
      var data = snap.data();
      if (!data) { return; }
      econState = { coins: data.coins, collection: data.collection || {}, activeDeck: data.activeDeck || 'overgrowth' };
      profileState = { username: data.username || '', photo: data.photo || null };
      renderCoinCount();
      renderProfile();
      updateShopBalance();
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

function updateProfileCloud(data) {
  return firebase.functions().httpsCallable('updateProfile')(data);
}

function updateActiveDeckCloud(deckKey) {
  return firebase.functions().httpsCallable('updateActiveDeck')({ deckKey: deckKey });
}
