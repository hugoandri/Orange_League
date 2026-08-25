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
  'protector_pikachu_sorprendido',
  'protector_six_seven',
  'protector_trollface',
  'protector_fuuuu',
  'protector_remielle'
];

function computeMatchReward(result) {
  return result === 'win' ? 75 : 0;
}

function pickRandom(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Every star-tier pull (the pack's one Rare/Rare Holo slot) rolls its own
// displayed/persisted rarity independently of what the catalog happens to
// tag that print as -- the same Clefairy can come out Rare one pack and
// Secret Rare the next, no card is locked to one tier. Order matters: check
// secret first (rarest), then holo, whatever's left is plain rare.
var RARITY_ROLL = {
  normal: { secret: 0.01, holo: 0.10 },   // + 89% plain rare
  darkspoon: { secret: 0.45, holo: 0.50 } // + 5% plain rare
};

function rollPulledRarity(rng, useDarkspoonOdds) {
  var table = useDarkspoonOdds ? RARITY_ROLL.darkspoon : RARITY_ROLL.normal;
  var roll = rng();
  if (roll < table.secret) { return 'secret'; }
  if (roll < table.secret + table.holo) { return 'holo'; }
  return 'rare';
}

// Mirrors the pack composition of the original client-side buyBooster():
// 1 Rare/Rare Holo + 3 Uncommon + 7 Common, drawn with replacement.
function drawBoosterCards(pool, rng, useDarkspoonOdds) {
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  var rareCard = pickRandom(rares, rng);
  // Clone before tagging -- rareCard is a reference into the shared, in-
  // memory CARD_CATALOG, and mutating it directly would leak this one
  // draw's pulledRarity onto every future draw of the same card, for every
  // user, for the lifetime of this function instance.
  var pulledRarity = rollPulledRarity(rng, useDarkspoonOdds);
  cards.push(Object.assign({}, rareCard, { pulledRarity: pulledRarity }));
  for (var i = 0; i < 3; i++) { cards.push(pickRandom(uncommons, rng)); }
  for (var j = 0; j < 7; j++) { cards.push(pickRandom(commons, rng)); }
  return cards;
}

module.exports = {
  BOOSTER_COST: BOOSTER_COST,
  PROTECTOR_COST: PROTECTOR_COST,
  PROTECTOR_IDS: PROTECTOR_IDS,
  RARITY_ROLL: RARITY_ROLL,
  computeMatchReward: computeMatchReward,
  drawBoosterCards: drawBoosterCards
};
