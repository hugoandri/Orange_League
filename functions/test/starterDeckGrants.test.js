const assert = require('assert');
const { starterDeckGrants } = require('../lib/pureEconomy');
const { STARTER_DECKLISTS } = require('../lib/starterDecks');
const CARD_CATALOG = require('../lib/cardCatalog');

['overgrowth', 'blackout', 'zap', 'brushfire'].forEach(function (deckKey) {
  var grants = starterDeckGrants(deckKey, CARD_CATALOG.base);
  var total = Object.keys(grants).reduce(function (sum, k) { return sum + grants[k]; }, 0);
  assert.strictEqual(total, 60, deckKey + ' grants exactly 60 cards total');
  Object.keys(grants).forEach(function (key) {
    assert.ok(/^base-/.test(key), deckKey + '\'s every grant key is a base-<num> print (got ' + key + ')');
  });
  console.log('PASS: starterDeckGrants(' + deckKey + ') grants exactly 60 base-print cards');
});

// Overgrowth's own decklist has 2 rows for the same eventual card (Weedle
// appears only once, but Water Energy/Grass Energy are single named
// entries too) -- the real cross-check is a card that legitimately repeats
// across two DIFFERENT decklist rows would be wrong; instead assert the
// known, hand-verified shape of one deck's grants directly, catching a
// wrong name->num lookup that a total-count check alone could miss.
var overgrowthGrants = starterDeckGrants('overgrowth', CARD_CATALOG.base);
var bulbasaurNum = CARD_CATALOG.base.find(function (c) { return c.n === 'Bulbasaur'; }).num;
assert.strictEqual(overgrowthGrants['base-' + bulbasaurNum], 4, 'overgrowth grants exactly 4 Bulbasaur');
var gyaradosNum = CARD_CATALOG.base.find(function (c) { return c.n === 'Gyarados'; }).num;
assert.strictEqual(overgrowthGrants['base-' + gyaradosNum], 1, 'overgrowth grants exactly 1 Gyarados');
console.log('PASS: starterDeckGrants(overgrowth) maps specific names to the correct base print counts');

assert.throws(function () { starterDeckGrants('not-a-real-deck', CARD_CATALOG.base); },
  'starterDeckGrants throws on an unknown deckKey (its caller must validate first, same as drawBoosterCards trusting its own caller)');
console.log('PASS: starterDeckGrants throws on an invalid deckKey');

console.log('ALL STARTER DECK GRANTS TESTS PASSED');
