var econState = null;

function initEconomyListener(uid) {
  econState = null;
  return firebase.firestore().collection('users').doc(uid)
    .onSnapshot(function (snap) {
      var data = snap.data();
      if (!data) { return; }
      econState = { coins: data.coins, collection: data.collection || {} };
      renderCoinCount();
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
