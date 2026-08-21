var BOOSTER_COST = 100;

// Cosmetic card-back skins sold in the Tienda's "Protectores" tab (see
// buyCardBack in index.js) -- server-side source of truth for both the
// valid ids and the price, so a client can never claim a different cost.
var PROTECTOR_COST = 75;
var PROTECTOR_IDS = [
  'protector_koffing',
  'protector_pikachu',
  'protector_team_rocket',
  'protector_pokebola_morada',
  'protector_fantasma',
  'protector_perona',
  'protector_sasuke',
  'protector_squirtle',
  'protector_charmander',
  'protector_bulbasaur',
  'protector_messi',
  'protector_ronaldo',
  'protector_pikachu_sorprendido'
];

function computeMatchReward(result) {
  return result === 'win' ? 75 : 0;
}

function pickRandom(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Mirrors the pack composition of the original client-side buyBooster():
// 1 Rare/Rare Holo + 3 Uncommon + 7 Common, drawn with replacement.
function drawBoosterCards(pool, rng) {
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  cards.push(pickRandom(rares, rng));
  for (var i = 0; i < 3; i++) { cards.push(pickRandom(uncommons, rng)); }
  for (var j = 0; j < 7; j++) { cards.push(pickRandom(commons, rng)); }
  return cards;
}

module.exports = {
  BOOSTER_COST: BOOSTER_COST,
  PROTECTOR_COST: PROTECTOR_COST,
  PROTECTOR_IDS: PROTECTOR_IDS,
  computeMatchReward: computeMatchReward,
  drawBoosterCards: drawBoosterCards
};
