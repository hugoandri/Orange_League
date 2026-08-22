const assert = require('assert');
const { BOOSTER_COST, PROTECTOR_COST, PROTECTOR_IDS, HOLO_UPGRADE_CHANCE, computeMatchReward, drawBoosterCards } = require('../lib/pureEconomy');

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

assert.strictEqual(HOLO_UPGRADE_CHANCE, 0.10, 'a plain Rare has a 10% chance of the bonus holo upgrade');
console.log('PASS: HOLO_UPGRADE_CHANCE is 0.10');

// rng always 0 -> Math.floor(0*len)=0 for the rare pick, and the separate
// holo roll (0 < 0.10) also succeeds, so a plain Rare comes back holo.
var holoRollCards = drawBoosterCards(pool, function () { return 0; });
assert.strictEqual(holoRollCards[0].holo, true, 'a plain Rare rolls holo when the roll lands under HOLO_UPGRADE_CHANCE');
console.log('PASS: plain Rare can roll the bonus holo upgrade');

// rng always 0.99 -> same Rare gets picked (Math.floor(0.99*1)=0, only one
// Rare in this pool) but the separate holo roll (0.99 < 0.10) fails.
var noHoloRollCards = drawBoosterCards(pool, function () { return 0.99; });
assert.strictEqual(noHoloRollCards[0].holo, false, 'a plain Rare does not roll holo when the roll misses');
console.log('PASS: plain Rare stays non-holo on a missed roll');

// guaranteedHolo (the Darkspoon account) skips the roll entirely.
var guaranteedCards = drawBoosterCards(pool, function () { return 0.99; }, true);
assert.strictEqual(guaranteedCards[0].holo, true, 'guaranteedHolo always upgrades a plain Rare, no roll needed');
console.log('PASS: guaranteedHolo always upgrades a plain Rare');

// A card that's already Rare Holo by catalog rarity never gets the *upgrade*
// flag -- it's already holo by its own rarity, this mechanic is specifically
// the bonus for a plain (non-holo) Rare.
var holoOnlyPool = [
  { n: 'AlreadyHolo', num: '9', r: 'Rare Holo' },
  { n: 'UncommonOne', num: '2', r: 'Uncommon' },
  { n: 'CommonOne', num: '3', r: 'Common' }
];
var alreadyHoloCards = drawBoosterCards(holoOnlyPool, function () { return 0; });
assert.strictEqual(alreadyHoloCards[0].r, 'Rare Holo');
assert.strictEqual(alreadyHoloCards[0].holo, false, 'the upgrade flag does not apply to a card that is already Rare Holo by rarity');
console.log('PASS: a Rare Holo catalog card does not also get the upgrade flag');

// Mutating the returned card must never leak back into the shared pool --
// drawBoosterCards clones before tagging .holo (see its own comment).
assert.strictEqual(pool[0].holo, undefined, 'the original catalog card object is never mutated');
console.log('PASS: drawBoosterCards clones before tagging holo, never mutates the shared pool');

console.log('ALL PUREECONOMY TESTS PASSED');
