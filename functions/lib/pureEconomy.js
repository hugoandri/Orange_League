const { STARTER_DECKLISTS } = require('./starterDecks');

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

// Draws `count` DISTINCT cards from list (no repeats within the same call) --
// removes each pick from a scratch copy before the next draw, so e.g. the
// pack's 3 Uncommon slots can never land on the same card twice. Every real
// set has far more than 3 Uncommons / 7 Commons (see CARD_CATALOG), so this
// never has to fall back to returning fewer than requested in practice.
function pickRandomUnique(list, count, rng) {
  var pool = list.slice();
  var picked = [];
  for (var i = 0; i < count && pool.length > 0; i++) {
    var idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
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

// Picks 1 card from `list`, weighted by weightsByName[card.n] (falls back to
// a weight of 1 -- i.e. plain uniform odds -- for any name not present in
// weightsByName, so an admin-set-only-some-cards config still lets every
// other rare come out normally). This is how the admin's "Probabilidades"
// panel (setRareOdds, functions/index.js) actually changes what comes out
// of the rare slot -- weightsByName is null/undefined whenever no admin
// config exists yet, which must behave identically to the old plain
// pickRandom (verified by testDrawBoosterCardsRareSlotIsUniformWithNoWeights-
// style tests).
function pickWeighted(list, weightsByName, rng) {
  var weights = list.map(function (c) {
    var w = weightsByName ? weightsByName[c.n] : undefined;
    return (typeof w === 'number' && w >= 0) ? w : 1;
  });
  var total = weights.reduce(function (sum, w) { return sum + w; }, 0);
  if (total <= 0) { return pickRandom(list, rng); } // every weight is 0 -- fall back rather than ever return undefined
  var r = rng() * total;
  for (var i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r < 0) { return list[i]; }
  }
  return list[list.length - 1]; // floating-point rounding safety net
}

// Mirrors the pack composition of the original client-side buyBooster():
// 1 Rare/Rare Holo + 3 Uncommon + 7 Common. Uncommons and Commons are each
// drawn WITHOUT replacement (pickRandomUnique) -- a real pack can otherwise
// hand back e.g. 3 copies of the same Common, which players reported as
// looking like a bug ("a veces vienen hasta 3 cartas iguales"). rareWeights
// (optional) is that set's {cardName: weight} config from setRareOdds --
// null/undefined means every rare is equally likely, same as before this
// feature existed.
function drawBoosterCards(pool, rng, useDarkspoonOdds, rareWeights) {
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  var rareCard = pickWeighted(rares, rareWeights, rng);
  // Clone before tagging -- rareCard is a reference into the shared, in-
  // memory CARD_CATALOG, and mutating it directly would leak this one
  // draw's pulledRarity onto every future draw of the same card, for every
  // user, for the lifetime of this function instance.
  var pulledRarity = rollPulledRarity(rng, useDarkspoonOdds);
  cards.push(Object.assign({}, rareCard, { pulledRarity: pulledRarity }));
  pickRandomUnique(uncommons, 3, rng).forEach(function (c) { cards.push(c); });
  pickRandomUnique(commons, 7, rng).forEach(function (c) { cards.push(c); });
  return cards;
}

// Admin-curated gift-only packs (see saveCustomPack/claimNewsGift's
// 'custompack' branch, functions/index.js) -- no rarity-tier structure like
// drawBoosterCards above, just 11 unique cards out of whatever flat pool of
// real catalog cards the admin picked. Each is granted at its own real
// catalog rarity by the caller (a pool card tagged Rare Holo comes out
// holo), not rolled the way the real-set rare slot is.
function drawCustomPackCards(poolEntries, rng) {
  return pickRandomUnique(poolEntries, 11, rng);
}

// Custom deck-builder rules (Phase 4): real 1999 Base Set deck-construction
// rules -- exactly 60 cards, at most 4 copies of any single non-basic-
// Energy card by name (Basic Energy is unlimited in real deck building),
// at least 1 Basic Pokémon (otherwise a real game could never even start),
// and never more copies of a card than the player actually owns.
var DECK_SIZE = 60;
var MAX_COPIES_PER_CARD = 4;
var BASIC_ENERGY_NAMES = ['Grass Energy', 'Fire Energy', 'Water Energy', 'Lightning Energy', 'Psychic Energy', 'Fighting Energy'];
var CUSTOM_DECK_SLOTS = ['custom-1', 'custom-2', 'custom-3', 'custom-4'];

// Aggregates a collection map (keyed 'setKey-num', see openBooster) into
// {cardName: totalOwnedCount} -- deck-building rules (both the 4-copy cap
// and ownership) are name-based, not print-based, same as CARD_STATS/
// DECKLISTS on the client only ever caring about names, never which
// specific set/number a copy came from.
function ownedCountsByName(collection, cardCatalog) {
  var byKey = {};
  Object.keys(cardCatalog).forEach(function (setKey) {
    cardCatalog[setKey].forEach(function (c) { byKey[setKey + '-' + c.num] = c.n; });
  });
  var owned = {};
  Object.keys(collection || {}).forEach(function (key) {
    var name = byKey[key];
    if (!name) { return; } // stale/unknown key -- ignore rather than throw
    owned[name] = (owned[name] || 0) + (collection[key] || 0);
  });
  return owned;
}

// {cardName: supertype}, aggregated across every set (a name's supertype
// never actually differs between prints/sets).
function supertypeByName(cardCatalog) {
  var out = {};
  Object.keys(cardCatalog).forEach(function (setKey) {
    cardCatalog[setKey].forEach(function (c) { out[c.n] = c.st; });
  });
  return out;
}

// cards: [{name, count}] -- the proposed decklist. owned: result of
// ownedCountsByName above. supertypes: result of supertypeByName above.
// evolvesFrom: name -> evolvesFrom-or-null (see pokemonEvolution.js) --
// only Pokémon names are present, so `in`/hasOwnProperty on it also
// doubles as "is this name even a real Pokémon" wherever that matters.
function validateCustomDeck(cards, owned, supertypes, evolvesFrom) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { valid: false, reason: 'El mazo está vacío.' };
  }
  var seen = {};
  var total = 0;
  for (var i = 0; i < cards.length; i++) {
    var entry = cards[i] || {};
    var name = entry.name;
    var count = entry.count;
    if (!name || typeof count !== 'number' || count <= 0 || Math.floor(count) !== count) {
      return { valid: false, reason: 'Cantidad de carta inválida.' };
    }
    if (seen[name]) {
      return { valid: false, reason: 'La carta "' + name + '" aparece más de una vez en la lista (usa un solo renglón por carta).' };
    }
    seen[name] = true;
    if (!supertypes[name]) {
      return { valid: false, reason: 'La carta "' + name + '" no existe.' };
    }
    var isBasicEnergy = BASIC_ENERGY_NAMES.indexOf(name) !== -1;
    if (!isBasicEnergy && count > MAX_COPIES_PER_CARD) {
      return { valid: false, reason: 'No puedes tener más de 4 copias de "' + name + '".' };
    }
    var have = owned[name] || 0;
    if (count > have) {
      return { valid: false, reason: 'No tienes suficientes copias de "' + name + '" en tu colección (tienes ' + have + ').' };
    }
    total += count;
  }
  if (total !== DECK_SIZE) {
    return { valid: false, reason: 'El mazo debe tener exactamente 60 cartas (tiene ' + total + ').' };
  }
  var hasBasicPokemon = cards.some(function (c) {
    return Object.prototype.hasOwnProperty.call(evolvesFrom, c.name) && !evolvesFrom[c.name];
  });
  if (!hasBasicPokemon) {
    return { valid: false, reason: 'El mazo debe tener al menos 1 Pokémon Básico.' };
  }
  return { valid: true };
}

// The inverse of ownedCountsByName: given one of the 4 real starter
// decklists (by name+count, see functions/lib/starterDecks.js) and the
// Base set's own catalog, returns {'base-<num>': count} grants ready to
// merge into a user doc's collection map -- same 'setKey-num' keying
// openBooster already uses. Throws on an unknown deckKey since this is
// only ever called after chooseStarterDeck's own onCall-level validation
// already accepted it (same trust boundary as drawBoosterCards trusting
// its own caller's setKey).
function starterDeckGrants(deckKey, cardCatalogBase) {
  var decklist = STARTER_DECKLISTS[deckKey];
  if (!decklist) { throw new Error('Unknown starter deckKey: ' + deckKey); }
  var nameToNum = {};
  cardCatalogBase.forEach(function (c) { nameToNum[c.n] = c.num; });
  var grants = {};
  decklist.forEach(function (entry) {
    var num = nameToNum[entry.name];
    if (!num) { throw new Error('Starter decklist name not in Base catalog: ' + entry.name); }
    var key = 'base-' + num;
    grants[key] = (grants[key] || 0) + entry.count;
  });
  return grants;
}

module.exports = {
  BOOSTER_COST: BOOSTER_COST,
  PROTECTOR_COST: PROTECTOR_COST,
  PROTECTOR_IDS: PROTECTOR_IDS,
  RARITY_ROLL: RARITY_ROLL,
  computeMatchReward: computeMatchReward,
  drawBoosterCards: drawBoosterCards,
  pickWeighted: pickWeighted,
  drawCustomPackCards: drawCustomPackCards,
  DECK_SIZE: DECK_SIZE,
  MAX_COPIES_PER_CARD: MAX_COPIES_PER_CARD,
  BASIC_ENERGY_NAMES: BASIC_ENERGY_NAMES,
  CUSTOM_DECK_SLOTS: CUSTOM_DECK_SLOTS,
  ownedCountsByName: ownedCountsByName,
  supertypeByName: supertypeByName,
  validateCustomDeck: validateCustomDeck,
  starterDeckGrants: starterDeckGrants
};
