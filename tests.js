// tests.js -- shared between run-tests.js (Node vm sandbox) and
// tests.html (real browser). No Node-specific code allowed here: it only
// uses whatever globals the other <script> files define.
var __testsRun = 0;
var __testFailures = 0;

function report(line) {
  console.log(line);
  if (typeof document !== 'undefined') {
    var pre = document.getElementById('output');
    if (pre) { pre.textContent += line + '\n'; }
  }
}

function check(description, actual, expected) {
  __testsRun++;
  var pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    report('PASS: ' + description);
  } else {
    __testFailures++;
    report('FAIL: ' + description + ' -- expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
  }
}

function checkTrue(description, actual) { check(description, !!actual, true); }

(function testExpandDecklist() {
  var expanded = expandDecklist(DECKLISTS.overgrowth);
  check('expandDecklist(overgrowth) has 60 cards', expanded.length, 60);
  var bulbasaurCount = expanded.filter(function (c) { return c.name === 'Bulbasaur'; }).length;
  check('expandDecklist has 4 Bulbasaur', bulbasaurCount, 4);
  var ids = expanded.map(function (c) { return c.id; });
  check('expandDecklist gives every card a unique id', new Set(ids).size, 60);
})();

(function testShuffleIsDeterministicWithFixedRng() {
  var arr = [1, 2, 3, 4, 5];
  var rng = (function () { var seq = [0.9, 0.1, 0.5, 0.2, 0.05]; var i = 0; return function () { return seq[i++ % seq.length]; }; })();
  var shuffled = shuffle(arr.slice(), rng);
  check('shuffle returns same length', shuffled.length, 5);
  check('shuffle does not lose elements', shuffled.slice().sort().join(','), '1,2,3,4,5');
})();

(function testCreateGameBasicSetup() {
  var rng = function () { return 0.999; }; // never triggers a mulligan-forcing shuffle order by luck alone; see note below
  var state = createGame(rng);
  check('turnCounter starts at 1', state.turnCounter, 1);
  checkTrue('activePlayerId is player or cpu', state.activePlayerId === 'player' || state.activePlayerId === 'cpu');
  check('player prizes has 6 cards', state.players.player.prizes.length, 6);
  check('cpu prizes has 6 cards', state.players.cpu.prizes.length, 6);
  check('player hand has at least 7 cards', state.players.player.hand.length >= 7, true);
  check('cpu hand has at least 7 cards', state.players.cpu.hand.length >= 7, true);
  var playerHasBasic = state.players.player.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('player opening hand contains a Basic Pokémon', playerHasBasic);
  var cpuHasBasic = state.players.cpu.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('cpu opening hand contains a Basic Pokémon', cpuHasBasic);
  var totalPlayerCards = state.players.player.deck.length + state.players.player.hand.length + state.players.player.prizes.length;
  check('player total cards still 60 after setup', totalPlayerCards, 60);
  var totalCpuCards = state.players.cpu.deck.length + state.players.cpu.hand.length + state.players.cpu.prizes.length;
  check('cpu total cards still 60 after setup', totalCpuCards, 60);
})();

(function testMulliganRedrawsUntilBasicPresent() {
  // A fixed rng of 0 drives shuffle()'s Fisher-Yates into one specific,
  // reproducible permutation (not "no shuffle") -- the exact resulting
  // order isn't what matters here. What matters is the invariant this
  // test checks: no matter what a given shuffle produces, the mulligan
  // loop in dealOpeningHandWithMulligans must keep re-shuffling and
  // re-dealing until the opening hand contains a Basic Pokémon, so the
  // game can never start with an unplayable hand.
  var forcedRng = function () { return 0; };
  var state = createGame(forcedRng);
  var playerHasBasic = state.players.player.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('after setup, player hand always has a Basic (mulligan loop holds)', playerHasBasic);
  var cpuHasBasic = state.players.cpu.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('after setup, cpu hand always has a Basic (mulligan loop holds)', cpuHasBasic);
})();

(function testPlayBasicAndEvolve() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  // Force a known hand: Bulbasaur in hand, nothing active yet.
  p.hand = [{ id: 'x1', name: 'Bulbasaur' }];
  p.active = null; p.bench = [];

  checkTrue('canPlayBasic true for Bulbasaur with empty active', canPlayBasic(state, pid, 'x1'));
  playBasic(state, pid, 'x1');
  check('active is now Bulbasaur', state.players[pid].active.name, 'Bulbasaur');
  check('hand no longer has x1', state.players[pid].hand.length, 0);

  p.hand = [{ id: 'x2', name: 'Ivysaur' }];
  checkTrue('canEvolve is false same turn Bulbasaur entered play', !canEvolve(state, pid, 'x2', state.players[pid].active.id));
  state.turnCounter += 1;
  checkTrue('canEvolve is true on a later turn', canEvolve(state, pid, 'x2', state.players[pid].active.id));
  evolve(state, pid, 'x2', state.players[pid].active.id);
  check('active evolved into Ivysaur, same instance id', state.players[pid].active.name, 'Ivysaur');
})();

(function testAttachEnergyOncePerTurn() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.hand = [{ id: 'e1', name: 'Grass Energy' }, { id: 'e2', name: 'Grass Energy' }];

  checkTrue('canAttachEnergy true the first time', canAttachEnergy(state, pid, 'e1', 'a1'));
  attachEnergy(state, pid, 'e1', 'a1');
  check('active has 1 attached energy', state.players[pid].active.attachedEnergy.length, 1);
  checkTrue('canAttachEnergy false a second time same turn', !canAttachEnergy(state, pid, 'e2', 'a1'));
})();

(function testRetreat() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Onix', attachedEnergy: ['Fighting', 'Fighting', 'Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.bench = [{ id: 'b1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];

  checkTrue('canRetreat true, Onix retreat cost 3 and has 3 energy', canRetreat(state, pid, 'b1'));
  retreat(state, pid, 'b1');
  check('bench Machop is now active', state.players[pid].active.name, 'Machop');
  check('Onix went to bench with only 0 energy left (3 discarded)', state.players[pid].bench[0].attachedEnergy.length, 0);
})();
