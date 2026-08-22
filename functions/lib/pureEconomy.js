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
  'protector_fuuuu'
];

function computeMatchReward(result) {
  return result === 'win' ? 75 : 0;
}

function pickRandom(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// A drawn plain Rare (not already Rare Holo -- that tier is holo by its own
// catalog rarity already) has this chance of a bonus holo upgrade that
// actually persists on that collection copy (see openBooster in index.js,
// which stores it in collectionHolo) -- not just a cosmetic reveal-screen
// flourish. guaranteedHolo (the account being "Darkspoon") skips the roll
// and always upgrades.
var HOLO_UPGRADE_CHANCE = 0.10;

// Mirrors the pack composition of the original client-side buyBooster():
// 1 Rare/Rare Holo + 3 Uncommon + 7 Common, drawn with replacement.
function drawBoosterCards(pool, rng, guaranteedHolo) {
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  var rareCard = pickRandom(rares, rng);
  // Clone before tagging -- rareCard is a reference into the shared, in-
  // memory CARD_CATALOG, and mutating it directly would leak this one
  // draw's holo flag onto every future draw of the same card, for every
  // user, for the lifetime of this function instance.
  var holo = rareCard.r === 'Rare' && (guaranteedHolo || rng() < HOLO_UPGRADE_CHANCE);
  cards.push(Object.assign({}, rareCard, { holo: holo }));
  for (var i = 0; i < 3; i++) { cards.push(pickRandom(uncommons, rng)); }
  for (var j = 0; j < 7; j++) { cards.push(pickRandom(commons, rng)); }
  return cards;
}

module.exports = {
  BOOSTER_COST: BOOSTER_COST,
  PROTECTOR_COST: PROTECTOR_COST,
  PROTECTOR_IDS: PROTECTOR_IDS,
  HOLO_UPGRADE_CHANCE: HOLO_UPGRADE_CHANCE,
  computeMatchReward: computeMatchReward,
  drawBoosterCards: drawBoosterCards
};
