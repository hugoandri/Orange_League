const assert = require('assert');
const { BOOSTER_COST, PROTECTOR_COST, PROTECTOR_IDS, computeMatchReward, drawBoosterCards } = require('../lib/pureEconomy');

assert.strictEqual(BOOSTER_COST, 100, 'booster costs 100 coins');
console.log('PASS: BOOSTER_COST is 100');

assert.strictEqual(PROTECTOR_COST, 75, 'a protector costs 75 coins');
console.log('PASS: PROTECTOR_COST is 75');

assert.strictEqual(PROTECTOR_IDS.length, 5, 'there are 5 real protectors for sale');
assert.strictEqual(new Set(PROTECTOR_IDS).size, PROTECTOR_IDS.length, 'no duplicate protector ids');
console.log('PASS: PROTECTOR_IDS has 5 unique ids');

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

console.log('ALL PUREECONOMY TESTS PASSED');
