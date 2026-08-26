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

module.exports = {
  BOOSTER_COST: BOOSTER_COST,
  PROTECTOR_COST: PROTECTOR_COST,
  PROTECTOR_IDS: PROTECTOR_IDS,
  RARITY_ROLL: RARITY_ROLL,
  computeMatchReward: computeMatchReward,
  drawBoosterCards: drawBoosterCards,
  DECK_SIZE: DECK_SIZE,
  MAX_COPIES_PER_CARD: MAX_COPIES_PER_CARD,
  BASIC_ENERGY_NAMES: BASIC_ENERGY_NAMES,
  CUSTOM_DECK_SLOTS: CUSTOM_DECK_SLOTS,
  ownedCountsByName: ownedCountsByName,
  supertypeByName: supertypeByName,
  validateCustomDeck: validateCustomDeck
};
