const assert = require('assert');
const { BOOSTER_COST, PROTECTOR_COST, PROTECTOR_IDS, RARITY_ROLL, computeMatchReward, drawBoosterCards } = require('../lib/pureEconomy');

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

var pool = [
  { n: 'RareOne', num: '1', r: 'Rare' },
  { n: 'UncommonOne', num: '2', r: 'Uncommon' },
  { n: 'CommonOne', num: '3', r: 'Common' }
];
var cards = drawBoosterCards(pool, function () { return 0; });
assert.strictEqual(cards.length, 11, 'a booster always has 11 cards');
assert.strictEqual(cards[0].r, 'Rare', 'the first card is always the Rare/Rare Holo slot');
var uncommonCount = cards.filter(function (c) { return c.r === 'Uncommon'; }).length;
var commonCount = cards.filter(function (c) { return c.r === 'Common'; }).length;
assert.strictEqual(uncommonCount, 3, 'exactly 3 Uncommons');
assert.strictEqual(commonCount, 7, 'exactly 7 Commons');
console.log('PASS: drawBoosterCards returns 1 Rare + 3 Uncommon + 7 Common');

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

console.log('ALL PUREECONOMY TESTS PASSED');
