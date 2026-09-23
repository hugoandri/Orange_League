const assert = require('assert');
const { BOOSTER_COST, PROTECTOR_COST, PROTECTOR_IDS, RARITY_ROLL, computeMatchReward, drawBoosterCards, pickWeighted } = require('../lib/pureEconomy');

assert.strictEqual(BOOSTER_COST, 100, 'booster costs 100 coins');
console.log('PASS: BOOSTER_COST is 100');

assert.strictEqual(PROTECTOR_COST, 75, 'a protector costs 75 coins');
console.log('PASS: PROTECTOR_COST is 75');

assert.strictEqual(PROTECTOR_IDS.length, 16, 'there are 16 real protectors for sale');
assert.strictEqual(new Set(PROTECTOR_IDS).size, PROTECTOR_IDS.length, 'no duplicate protector ids');
console.log('PASS: PROTECTOR_IDS has 16 unique ids');

assert.strictEqual(computeMatchReward('win'), 75, 'a win pays 75 coins');
console.log('PASS: win reward is 75');

assert.strictEqual(computeMatchReward('loss'), 0, 'a loss pays 0 coins');
console.log('PASS: loss reward is 0');

// A real set always has far more than 3 Uncommons / 7 Commons, so this pool
// (4 Uncommons, 8 Commons) is realistic, not a contrived edge case.
var bigPool = [
  { n: 'RareOne', num: 'r1', r: 'Rare' },
  { n: 'U1', num: 'u1', r: 'Uncommon' }, { n: 'U2', num: 'u2', r: 'Uncommon' },
  { n: 'U3', num: 'u3', r: 'Uncommon' }, { n: 'U4', num: 'u4', r: 'Uncommon' },
  { n: 'C1', num: 'c1', r: 'Common' }, { n: 'C2', num: 'c2', r: 'Common' },
  { n: 'C3', num: 'c3', r: 'Common' }, { n: 'C4', num: 'c4', r: 'Common' },
  { n: 'C5', num: 'c5', r: 'Common' }, { n: 'C6', num: 'c6', r: 'Common' },
  { n: 'C7', num: 'c7', r: 'Common' }, { n: 'C8', num: 'c8', r: 'Common' }
];
var cards = drawBoosterCards(bigPool, function () { return 0; });
assert.strictEqual(cards.length, 11, 'a booster always has 11 cards');
assert.strictEqual(cards[0].r, 'Rare', 'the first card is always the Rare/Rare Holo slot');
var uncommonNames = cards.filter(function (c) { return c.r === 'Uncommon'; }).map(function (c) { return c.n; });
var commonNames = cards.filter(function (c) { return c.r === 'Common'; }).map(function (c) { return c.n; });
assert.strictEqual(uncommonNames.length, 3, 'exactly 3 Uncommons');
assert.strictEqual(commonNames.length, 7, 'exactly 7 Commons');
console.log('PASS: drawBoosterCards returns 1 Rare + 3 Uncommon + 7 Common');

// rng() always returning 0 always picks whatever is CURRENTLY first in the
// shrinking scratch pool (see pickRandomUnique) -- under the old with-
// replacement behavior this would deterministically produce 3x U1 + 7x C1
// (all duplicates); with sampling-without-replacement it walks U1, U2, U3
// and C1..C7 instead, so this doubles as a real regression check for
// "a veces vienen hasta 3 cartas iguales", not just a shape check.
assert.strictEqual(new Set(uncommonNames).size, 3, 'the 3 Uncommons in one pack are never duplicated');
assert.strictEqual(new Set(commonNames).size, 7, 'the 7 Commons in one pack are never duplicated');
console.log('PASS: drawBoosterCards never repeats a card within the same pack');

// Kept small on purpose -- the tests below only ever look at cards[0]'s
// pulledRarity (the Rare/Rare Holo slot), never the total card count.
var pool = [
  { n: 'RareOne', num: '1', r: 'Rare' },
  { n: 'UncommonOne', num: '2', r: 'Uncommon' },
  { n: 'CommonOne', num: '3', r: 'Common' }
];

assert.deepStrictEqual(RARITY_ROLL.normal, { secret: 0.01, holo: 0.10 }, 'normal odds: 1% secret, 10% holo, 89% rare');
assert.deepStrictEqual(RARITY_ROLL.darkspoon, { secret: 0.45, holo: 0.50 }, 'darkspoon odds: 45% secret, 50% holo, 5% rare');
console.log('PASS: RARITY_ROLL has the right odds for both tables');

// Every star-tier pull rolls its own rarity independently of the catalog's
// own r tag -- pickRandom consumes rng() once for the index (irrelevant
// here, only one card in "rares"), then the rarity roll consumes it again.
function pulledRarityWithRoll(roll, useDarkspoonOdds) {
  return drawBoosterCards(pool, function () { return roll; }, useDarkspoonOdds)[0].pulledRarity;
}
assert.strictEqual(pulledRarityWithRoll(0), 'secret', 'a roll under 0.01 is Secret Rare');
assert.strictEqual(pulledRarityWithRoll(0.05), 'holo', 'a roll between 0.01 and 0.11 is Holo Rare');
assert.strictEqual(pulledRarityWithRoll(0.5), 'rare', 'a roll of 0.5 (the remaining 89%) is plain Rare');
console.log('PASS: the same plain-Rare pool card can come back Rare, Holo, or Secret depending on the roll');

assert.strictEqual(pulledRarityWithRoll(0, true), 'secret', 'darkspoon: a roll under 0.45 is Secret Rare');
assert.strictEqual(pulledRarityWithRoll(0.5, true), 'holo', 'darkspoon: a roll between 0.45 and 0.95 is Holo Rare');
assert.strictEqual(pulledRarityWithRoll(0.99, true), 'rare', 'darkspoon: a roll of 0.99 (the remaining 5%) is plain Rare');
console.log('PASS: the darkspoon table shifts the same rolls toward Holo/Secret');

// A card already tagged Rare Holo by catalog rarity rolls the same as a
// plain Rare -- the catalog tag no longer locks in the displayed rarity,
// per "no hay exclusividad de cartas raras solo rare o solo secret o solo holo".
var holoOnlyPool = [
  { n: 'AlreadyHolo', num: '9', r: 'Rare Holo' },
  { n: 'UncommonOne', num: '2', r: 'Uncommon' },
  { n: 'CommonOne', num: '3', r: 'Common' }
];
var alreadyHoloCards = drawBoosterCards(holoOnlyPool, function () { return 0.99; });
assert.strictEqual(alreadyHoloCards[0].r, 'Rare Holo');
assert.strictEqual(alreadyHoloCards[0].pulledRarity, 'rare', 'a Rare Holo catalog card can still roll down to plain Rare');
console.log('PASS: catalog rarity no longer locks in the pulled rarity');

// Mutating the returned card must never leak back into the shared pool --
// drawBoosterCards clones before tagging pulledRarity (see its own comment).
assert.strictEqual(pool[0].pulledRarity, undefined, 'the original catalog card object is never mutated');
console.log('PASS: drawBoosterCards clones before tagging pulledRarity, never mutates the shared pool');

// ── pickWeighted (the admin's "Probabilidades" tab, setRareOdds) ───────
var weightedList = [{ n: 'A' }, { n: 'B' }, { n: 'C' }];

assert.strictEqual(pickWeighted(weightedList, null, function () { return 0.5; }).n, 'B',
  'with no weights config at all, pickWeighted behaves like plain uniform pickRandom');

assert.strictEqual(pickWeighted(weightedList, { A: 0, C: 0 }, function () { return 0.999; }).n, 'B',
  'zeroing out every other card makes the remaining one certain, regardless of the roll');

assert.strictEqual(pickWeighted(weightedList, { A: 0, B: 0, C: 0 }, function () { return 0.5; }).n, 'B',
  'if every weight is 0, it falls back to plain uniform odds instead of ever returning undefined');

// B is 9x as likely as A or C (weights 1:9:1, total 11) -- rolls near the
// start/end of B's slice land on B, just outside it land on A/C.
var skewed = { A: 1, B: 9, C: 1 };
assert.strictEqual(pickWeighted(weightedList, skewed, function () { return 0; }).n, 'A');
assert.strictEqual(pickWeighted(weightedList, skewed, function () { return 1 / 11 + 0.001; }).n, 'B');
assert.strictEqual(pickWeighted(weightedList, skewed, function () { return 10 / 11 - 0.001; }).n, 'B');
assert.strictEqual(pickWeighted(weightedList, skewed, function () { return 10 / 11 + 0.001; }).n, 'C');
console.log('PASS: pickWeighted respects configured weights, defaulting missing names to 1');

// drawBoosterCards' rare slot actually uses those weights, keyed by card name.
var rareOddsPool = [
  { n: 'RareA', num: '1', r: 'Rare' },
  { n: 'RareB', num: '2', r: 'Rare' },
  { n: 'UncommonOne', num: '3', r: 'Uncommon' },
  { n: 'CommonOne', num: '4', r: 'Common' }
];
var alwaysRareA = drawBoosterCards(rareOddsPool, function () { return 0.9; }, false, { RareA: 1, RareB: 0 });
assert.strictEqual(alwaysRareA[0].n, 'RareA', 'a 0-weighted rare is never pulled, even on a high roll');
console.log('PASS: drawBoosterCards\' rare slot honors an admin-configured rareWeights argument');

// ── Custom deck-builder validation (Phase 4) ──────────────────────────
const { DECK_SIZE, MAX_COPIES_PER_CARD, BASIC_ENERGY_NAMES, ownedCountsByName, supertypeByName, validateCustomDeck } = require('../lib/pureEconomy');

var testCatalog = {
  base: [
    { n: 'Bulbasaur', num: '1', st: 'Pokémon' },
    { n: 'Ivysaur', num: '2', st: 'Pokémon' },
    { n: 'Bill', num: '3', st: 'Trainer' },
    { n: 'Grass Energy', num: '4', st: 'Energy' }
  ],
  jungle: [
    // Same name, a different print -- ownedCountsByName must sum both.
    { n: 'Bulbasaur', num: '1', st: 'Pokémon' }
  ]
};
var testEvolvesFrom = { Bulbasaur: null, Ivysaur: 'Bulbasaur' };

assert.deepStrictEqual(
  ownedCountsByName({ 'base-1': 2, 'jungle-1': 1, 'base-3': 4 }, testCatalog),
  { Bulbasaur: 3, Bill: 4 },
  'ownedCountsByName sums copies of the same name across different sets'
);
console.log('PASS: ownedCountsByName aggregates by name, not by print');

assert.deepStrictEqual(
  ownedCountsByName({ 'base-1': 2, 'stale-key-999': 5 }, testCatalog),
  { Bulbasaur: 2 },
  'an unrecognized collection key is ignored rather than crashing'
);
console.log('PASS: ownedCountsByName ignores unknown/stale collection keys');

assert.deepStrictEqual(
  supertypeByName(testCatalog),
  { Bulbasaur: 'Pokémon', Ivysaur: 'Pokémon', Bill: 'Trainer', 'Grass Energy': 'Energy' },
  'supertypeByName maps every catalog name to its real supertype'
);
console.log('PASS: supertypeByName builds a flat name->supertype map');

var check = validateCustomDeck([], {}, {}, {});
assert.strictEqual(check.valid, false, 'an empty deck is rejected');
console.log('PASS: validateCustomDeck rejects an empty deck list');

var owned60 = { Bulbasaur: 4, 'Grass Energy': 56 };
var supers60 = { Bulbasaur: 'Pokémon', 'Grass Energy': 'Energy' };
var evo60 = { Bulbasaur: null };
check = validateCustomDeck([{ name: 'Bulbasaur', count: 4 }, { name: 'Grass Energy', count: 56 }], owned60, supers60, evo60);
assert.strictEqual(check.valid, true, 'a real 60-card deck with a Basic Pokémon and enough owned copies is legal: ' + (check.reason || ''));
console.log('PASS: validateCustomDeck accepts a legal 60-card deck');

check = validateCustomDeck([{ name: 'Bulbasaur', count: 5 }, { name: 'Grass Energy', count: 55 }], { Bulbasaur: 5, 'Grass Energy': 55 }, supers60, evo60);
assert.strictEqual(check.valid, false, '5 copies of a non-Basic-Energy card is illegal even if all 5 are owned');
console.log('PASS: validateCustomDeck enforces the real 4-copy cap');

check = validateCustomDeck([{ name: 'Grass Energy', count: 60 }], { 'Grass Energy': 60 }, supers60, evo60);
assert.strictEqual(check.valid, false, 'Basic Energy is exempt from the 4-copy cap, but a deck with ZERO Basic Pokémon is still illegal');
console.log('PASS: validateCustomDeck exempts Basic Energy from the copy cap, but still requires a Basic Pokémon');

check = validateCustomDeck([{ name: 'Bulbasaur', count: 4 }, { name: 'Grass Energy', count: 56 }], { Bulbasaur: 3, 'Grass Energy': 56 }, supers60, evo60);
assert.strictEqual(check.valid, false, 'claiming more copies than actually owned is illegal even at a legal total/cap');
console.log('PASS: validateCustomDeck enforces real ownership, not just the printed rules');

check = validateCustomDeck([{ name: 'Bulbasaur', count: 4 }, { name: 'Grass Energy', count: 50 }], owned60, supers60, evo60);
assert.strictEqual(check.valid, false, 'a 54-card deck (not exactly 60) is illegal');
console.log('PASS: validateCustomDeck requires exactly 60 cards, not "up to" 60');

check = validateCustomDeck([{ name: 'Nonexistent Card', count: 60 }], { 'Nonexistent Card': 60 }, supers60, evo60);
assert.strictEqual(check.valid, false, 'a name outside the real catalog is illegal');
console.log('PASS: validateCustomDeck rejects a card name that isn\'t real');

check = validateCustomDeck([{ name: 'Bulbasaur', count: 4 }, { name: 'Bulbasaur', count: 56 }], { Bulbasaur: 60 }, supers60, evo60);
assert.strictEqual(check.valid, false, 'the same name listed twice (even summing to 60) is illegal -- one row per card');
console.log('PASS: validateCustomDeck rejects a duplicated name entry');

assert.strictEqual(DECK_SIZE, 60, 'DECK_SIZE is 60');
assert.strictEqual(MAX_COPIES_PER_CARD, 4, 'MAX_COPIES_PER_CARD is 4');
assert.strictEqual(BASIC_ENERGY_NAMES.length, 6, 'there are 6 real Basic Energy types');
console.log('PASS: deck-building constants match the real 1999 rules');

console.log('ALL PUREECONOMY TESTS PASSED');
