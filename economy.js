function defaultEconomy() { return { coins: 150, collection: {} }; }

function awardWin(econ) { return Object.assign({}, econ, { coins: econ.coins + 75 }); }
function awardLoss(econ) { return Object.assign({}, econ, { coins: econ.coins }); }

function pickRandom(list, rng) { return list[Math.floor(rng() * list.length)]; }

function buyBooster(econ, setKey, rng) {
  rng = rng || Math.random;
  if (econ.coins < 100) { return null; }
  var pool = CARD_CATALOG[setKey];
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  cards.push(pickRandom(rares, rng));
  for (var i = 0; i < 3; i++) { cards.push(pickRandom(uncommons, rng)); }
  for (var j = 0; j < 7; j++) { cards.push(pickRandom(commons, rng)); }

  var newCollection = Object.assign({}, econ.collection);
  cards.forEach(function (c) {
    var key = setKey + '-' + c.num;
    newCollection[key] = (newCollection[key] || 0) + 1;
  });

  return { economy: { coins: econ.coins - 100, collection: newCollection }, cards: cards };
}

function loadEconomy() {
  if (typeof localStorage === 'undefined') { return defaultEconomy(); }
  var raw = localStorage.getItem('tcg_economy');
  if (!raw) { return defaultEconomy(); }
  try { return JSON.parse(raw); } catch (e) { return defaultEconomy(); }
}

function saveEconomy(econ) {
  if (typeof localStorage === 'undefined') { return; }
  localStorage.setItem('tcg_economy', JSON.stringify(econ));
}
