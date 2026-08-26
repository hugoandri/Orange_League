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
  check('phase starts as setup', state.phase, 'setup');
  check('activePlayerId is null until startMatch() flips the coin', state.activePlayerId, null);
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

(function testCreateGameDeckSelection() {
  var rng = function () { return 0.999; };
  var defaultState = createGame(rng);
  check('createGame defaults player to overgrowth when no deckKey is given', defaultState.players.player.deckKey, 'overgrowth');
  checkTrue('cpu gets a real deck other than overgrowth', defaultState.players.cpu.deckKey !== 'overgrowth' && !!DECKLISTS[defaultState.players.cpu.deckKey]);

  var blackoutState = createGame(rng, 'blackout');
  check('createGame assigns the requested deck to the player', blackoutState.players.player.deckKey, 'blackout');
  checkTrue('cpu gets a real deck other than blackout', blackoutState.players.cpu.deckKey !== 'blackout' && !!DECKLISTS[blackoutState.players.cpu.deckKey]);

  var invalidState = createGame(rng, 'not-a-real-deck');
  check('createGame falls back to overgrowth for an invalid deckKey', invalidState.players.player.deckKey, 'overgrowth');
  checkTrue('cpu still gets a real other deck when the player key was invalid', invalidState.players.cpu.deckKey !== 'overgrowth' && !!DECKLISTS[invalidState.players.cpu.deckKey]);
})();

(function testCreateGameCpuDeckIsRandomAmongTheOthers() {
  // The CPU's deck pick consumes one rng() call, before either side's own
  // shuffle -- with 3 real decks (overgrowth/blackout/zap) and the player
  // on overgrowth, otherDeckKeys is ['blackout', 'zap'] in that order
  // (Object.keys preserves insertion order), so rng() just below 0.5 picks
  // index 0 (blackout) and rng() at/above 0.5 picks index 1 (zap).
  var lowState = createGame(function () { return 0.1; }, 'overgrowth');
  check('a low rng roll picks the first other deck for the cpu', lowState.players.cpu.deckKey, 'blackout');
  var highState = createGame(function () { return 0.9; }, 'overgrowth');
  check('a high rng roll picks the last other deck for the cpu', highState.players.cpu.deckKey, 'zap');
})();

(function testStartMatchFlipsCoinAndBeginsPlay() {
  var state = createGame(function () { return 0.42; });
  checkTrue('canPlayBasic works during setup regardless of (null) activePlayerId', canPlayBasic(state, 'player', state.players.player.hand.filter(function (c) { return isBasicPokemon(c.name); })[0].id));
  startMatch(state);
  check('phase is playing after startMatch', state.phase, 'playing');
  checkTrue('activePlayerId is player or cpu after startMatch', state.activePlayerId === 'player' || state.activePlayerId === 'cpu');
  check('turnCounter is 1 after startMatch', state.turnCounter, 1);
  checkTrue('canPlayBasic now requires activePlayerId to match once playing', !canPlayBasic(state, opponentOf(state.activePlayerId), state.players[opponentOf(state.activePlayerId)].hand[0] ? state.players[opponentOf(state.activePlayerId)].hand[0].id : 'nope'));
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
  state.activePlayerId = pid;
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
  checkTrue('canEvolve is still false on turn 2 for setup-placed Pokémon', !canEvolve(state, pid, 'x2', state.players[pid].active.id));
  state.turnCounter += 1;
  checkTrue('canEvolve is true on turn 3', canEvolve(state, pid, 'x2', state.players[pid].active.id));
  // Per user ruling: evolving clears Special Conditions, but leaves damage
  // and attached energy untouched (only retreat/Switch/Gust of Wind clear
  // status *and* those stay on the Pokémon regardless of evolving).
  state.players[pid].active.statusConditions = ['Poisoned'];
  state.players[pid].active.damage = 10;
  state.players[pid].active.attachedEnergy = ['Grass'];
  evolve(state, pid, 'x2', state.players[pid].active.id);
  check('active evolved into Ivysaur, same instance id', state.players[pid].active.name, 'Ivysaur');
  check('evolving clears Special Conditions', state.players[pid].active.statusConditions, []);
  check('evolving does not reset damage', state.players[pid].active.damage, 10);
  check('evolving does not discard attached energy', state.players[pid].active.attachedEnergy, ['Grass']);
})();

(function testBenchPositionalPlacementStaysPutAndLeavesGaps() {
  // Real UI requirement: the player drags/clicks a Basic onto a *specific*
  // empty Bench slot -- it must land exactly there, not just "the next free
  // one", and everything already benched must stay exactly where it was.
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  state.activePlayerId = pid;
  var p = state.players[pid];
  p.active = { id: 'a0', name: 'Onix', attachedEnergy: ['Fighting', 'Fighting', 'Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.bench = [null, null, null, null, null];
  p.hand = [{ id: 'h1', name: 'Bulbasaur' }, { id: 'h2', name: 'Squirtle' }];

  playBasic(state, pid, 'h1', 3);
  check('Bulbasaur lands in the exact requested slot (3), not slot 0', p.bench[3].name, 'Bulbasaur');
  check('slot 0 stays empty -- placement did not default to first-free', p.bench[0], null);
  check('benchCount reflects the 1 real Pokémon benched', benchCount(p), 1);

  playBasic(state, pid, 'h2', 0);
  check('Squirtle lands in its own requested slot (0)', p.bench[0].name, 'Squirtle');
  check('Bulbasaur at slot 3 is undisturbed by a later placement', p.bench[3].name, 'Bulbasaur');
  check('bench array is still exactly 5 slots', p.bench.length, 5);

  // Retreating swaps in place: the outgoing Active takes over the exact
  // slot the incoming Bench Pokémon is leaving, nothing shifts.
  retreat(state, pid, p.bench[3].id); // Bulbasaur (slot 3) becomes Active
  check('Bulbasaur is now Active', state.players[pid].active.name, 'Bulbasaur');
  check('Onix (retreated) takes over slot 3, the exact slot vacated', p.bench[3].name, 'Onix');
  check('Squirtle at slot 0 is untouched by the retreat', p.bench[0].name, 'Squirtle');

  // A benched Pokémon knocked out (e.g. by a bench-hitting effect) leaves a
  // null gap in its own slot -- the other one does not shift to fill it.
  p.bench[0].damage = 999; // Squirtle, force a KO
  knockOutIfNeeded(state, pid, p.bench[0]);
  check('knocked-out bench slot goes null in place', p.bench[0], null);
  check('the other benched Pokémon (slot 3) is untouched', p.bench[3].name, 'Onix');
  check('benchCount drops to 1', benchCount(p), 1);
})();

(function testAttachEnergyOncePerTurn() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  state.activePlayerId = pid;
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
  state.activePlayerId = pid;
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Onix', attachedEnergy: ['Fighting', 'Fighting', 'Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.bench = [{ id: 'b1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];

  checkTrue('canRetreat true, Onix retreat cost 3 and has 3 energy', canRetreat(state, pid, 'b1'));
  retreat(state, pid, 'b1');
  check('bench Machop is now active', state.players[pid].active.name, 'Machop');
  check('Onix went to bench with only 0 energy left (3 discarded)', state.players[pid].bench[0].attachedEnergy.length, 0);
})();

(function testStatusConditionsClearedOnLeavingActive() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: ['Poisoned', 'Paralyzed'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.bench = [{ id: 'b1', name: 'Ivysaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  retreat(state, pid, 'b1');
  check('retreating Pokemon loses its status conditions when benched', p.bench.filter(function(b){return b.id==='a1';})[0].statusConditions, []);

  var state2 = createGame(function () { return 0.42; });
  var p2 = state2.players.player;
  p2.active = { id: 'a2', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: ['Poisoned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p2.bench = [];
  state2.activePlayerId = 'player';
  endTurn(state2);
  applyEndOfTurnCheckup(state2); // checkup no longer lives inside endTurn() itself -- see its own comment
  check('a benched Pokemon (none here, but active poisoned) still ticks normally when it stays active', p2.active.damage, 10);

  var state3 = createGame(function () { return 0.42; });
  var p3 = state3.players.player;
  p3.active = { id: 'a3', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p3.bench = [{ id: 'b3', name: 'Ivysaur', attachedEnergy: [], damage: 0, statusConditions: ['Poisoned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  state3.activePlayerId = 'player';
  endTurn(state3);
  check('a benched Pokemon with (illegally set) Poisoned status does NOT take checkup damage, since only active is checked', p3.bench[0].damage, 0);
})();

(function testDealDamageWeaknessResistance() {
  var state = createGame(function () { return 0.42; });
  var attacker = { id: 'a1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var defender = { id: 'd1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  // Gyarados (Water) attacking Bulbasaur (Grass, weak to Fire, no resistance) -- no weakness/resistance interaction, plain 50 damage.
  var dmg = dealDamage(state, attacker, defender, 50);
  check('plain damage with no weakness/resistance', dmg, 50);
  check('defender damage counter updated', defender.damage, 50);

  // Beedrill resists Fighting (-30): confirms resistance is applied independently of weakness.
  var fightingAttacker = { id: 'a3', name: 'Machoke', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var beedrillDefender = { id: 'd3', name: 'Beedrill', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var dmg2 = dealDamage(state, fightingAttacker, beedrillDefender, 50); // Beedrill resists Fighting by -30
  check('resistance subtracts 30', dmg2, 20);
})();

(function testShieldPreventsAllDamage() {
  var state = createGame(function () { return 0.42; });
  state.turnCounter = 5;
  var attacker = { id: 'a1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var defender = { id: 'd1', name: 'Squirtle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: { untilTurn: 5, type: 'preventAll' }, missChanceUntilTurn: null, plusPowerAttached: false };
  var dmg = dealDamage(state, attacker, defender, 50);
  check('shielded defender takes 0 damage', dmg, 0);
  check('shield is consumed after blocking', defender.shield, null);
})();

(function testThresholdMaxShieldSurvivesAnOverThresholdHit() {
  // Onix's Harden (thresholdMax: 30) should keep blocking every <=30 hit
  // during its window, not be burned by the first hit regardless of
  // whether that hit actually got blocked.
  var state = createGame(function () { return 0.42; });
  state.turnCounter = 5;
  var attacker = { id: 'a1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var defender = { id: 'd1', name: 'Onix', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: { untilTurn: 5, type: 'thresholdMax', thresholdMax: 30 }, missChanceUntilTurn: null, plusPowerAttached: false };
  var dmg1 = dealDamage(state, attacker, defender, 50); // exceeds threshold, not blocked
  check('a hit exceeding the threshold is not blocked', dmg1, 50);
  check('the shield survives a hit it did not block', defender.shield && defender.shield.type, 'thresholdMax');
  var dmg2 = dealDamage(state, attacker, defender, 20); // within threshold, blocked
  check('a later <=30 hit in the same window is still blocked', dmg2, 0);
  check('the shield is consumed only once it actually blocks a hit', defender.shield, null);
})();

(function testStaleShieldIsClearedOnceItsWindowExpires() {
  var state = createGame(function () { return 0.42; });
  state.turnCounter = 6; // shield's window (turn 5) has already passed
  var attacker = { id: 'a1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var defender = { id: 'd1', name: 'Onix', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: { untilTurn: 5, type: 'thresholdMax', thresholdMax: 30 }, missChanceUntilTurn: null, plusPowerAttached: false };
  var dmg = dealDamage(state, attacker, defender, 10);
  check('a stale, expired shield no longer blocks damage', dmg, 10);
  check('a stale, expired shield is cleared', defender.shield, null);
})();

(function testAttackKnockoutAwardsPrizeAndEndsGameOnEmptyPrizes() {
  var state = createGame(function () { return 0.42; });
  state.players.player.active = { id: 'p1', name: 'Gyarados', attachedEnergy: ['Water', 'Water', 'Water'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.player.bench = [];
  state.players.cpu.active = { id: 'c1', name: 'Weedle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.bench = [];
  state.players.player.prizes = [{ id: 'pz1', name: 'Bulbasaur' }];
  state.activePlayerId = 'player';
  state.turnCounter = 2; // turn 1 is unattackable (the going-first player can't attack their very first turn); advance past it so this is a legal attack

  checkTrue('canAttack true, Gyarados has enough Water energy for Dragon Rage', canAttack(state, 'player', 'Dragon Rage'));
  attack(state, 'player', 'Dragon Rage'); // 50 damage, Weedle has 40 HP -> KO
  check('Weedle was knocked out and removed as cpu active', state.players.cpu.active, null);
  checkTrue('KO defers the prize to a pending player choice instead of auto-taking', !!state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === 'player');
  check('prize not yet taken until the choice is resolved', remainingPrizes(state.players.player), 1);
  takePrize(state, 'player', 0);
  // The taken slot becomes null in place (not spliced out) so remaining
  // prizes never shift position -- .length stays 1, only the real count drops.
  check('the taken slot becomes null, not removed', state.players.player.prizes.length, 1);
  check('player took their 1 remaining prize once resolved', remainingPrizes(state.players.player), 0);
  check('pendingPrizeChoice clears once resolved', state.pendingPrizeChoice, null);
  check('getWinner declares player the winner', getWinner(state), 'player');
})();

(function testTakenPrizesStayInPlaceAsAGap() {
  // Real UI requirement: picking prize slot 2, then slot 4, must leave prizes
  // 0/1/3/5 exactly where they were -- not shifted left to fill the gaps --
  // so the on-board row and the choice modal always show taken slots in the
  // same spot they always occupied.
  var state = createGame(function () { return 0.42; });
  var p = state.players.player;
  var original = p.prizes.slice();

  takePrize(state, 'player', 2);
  check('slot 2 becomes null', p.prizes[2], null);
  check('slot 0 is untouched by taking slot 2', p.prizes[0], original[0]);
  check('slot 5 is untouched by taking slot 2', p.prizes[5], original[5]);
  check('remainingPrizes drops to 5', remainingPrizes(p), 5);

  takePrize(state, 'player', 4);
  check('slot 4 becomes null too', p.prizes[4], null);
  check('slot 2 stays null (not reused)', p.prizes[2], null);
  check('slot 1 is still the original card, same position', p.prizes[1], original[1]);
  check('slot 3 is still the original card, same position', p.prizes[3], original[3]);
  check('the array never shrinks', p.prizes.length, 6);
  check('remainingPrizes drops to 4', remainingPrizes(p), 4);

  // Taking an already-taken slot is a no-op, not a crash or a double-decrement.
  takePrize(state, 'player', 2);
  check('re-taking an already-empty slot changes nothing', remainingPrizes(p), 4);
})();

(function testKnockoutDefersActiveChoiceToPlayerWhenBenchIsNonEmpty() {
  var state = createGame(function () { return 0.42; });
  state.players.player.active = { id: 'p1', name: 'Gyarados', attachedEnergy: [], damage: 100, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.player.bench = [
    { id: 'p2', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false },
    { id: 'p3', name: 'Staryu', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }
  ];
  state.players.cpu.active = { id: 'c1', name: 'Weedle', attachedEnergy: ['Grass', 'Grass', 'Grass'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.bench = [];
  state.activePlayerId = 'cpu';
  state.turnCounter = 2;

  knockOutIfNeeded(state, 'player', state.players.player.active);
  check('player active is not auto-promoted', state.players.player.active, null);
  check('pendingActiveChoice is set to player instead', state.pendingActiveChoice, 'player');
  check('player bench is untouched until the choice is resolved', state.players.player.bench.length, 2);

  chooseNewActive(state, 'player', 'p3');
  check('chosen Bench Pokémon becomes the new Active', state.players.player.active.id, 'p3');
  // The vacated slot goes null in place (not spliced out) -- same
  // position-stability guarantee as prizes/retreat elsewhere.
  check('chosen Pokémon leaves its bench slot null, not shrinking the array', benchCount(state.players.player), 1);
  check('remaining bench still has the other Pokémon, same position', state.players.player.bench[0].id, 'p2');
  check('pendingActiveChoice clears once resolved', state.pendingActiveChoice, null);
})();

(function testKnockoutStillAutoPromotesWhenNoChoiceApplies() {
  var state = createGame(function () { return 0.42; });
  // CPU's own knockout always auto-promotes -- no player input to wait on.
  state.players.cpu.active = { id: 'c1', name: 'Weedle', attachedEnergy: [], damage: 40, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.bench = [{ id: 'c2', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  knockOutIfNeeded(state, 'cpu', state.players.cpu.active);
  check('cpu auto-promotes its own bench Pokémon', state.players.cpu.active.id, 'c2');
  check('no pendingActiveChoice for the cpu side', state.pendingActiveChoice, null);

  // Player's own knockout with an empty bench has no choice to make either --
  // active just goes to null, preserving the existing "no active, no bench" loss path.
  var state2 = createGame(function () { return 0.42; });
  state2.players.player.active = { id: 'p1', name: 'Gyarados', attachedEnergy: [], damage: 100, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state2.players.player.bench = [];
  state2.players.player.hasHadActive = true;
  state2.players.cpu.active = { id: 'c1', name: 'Weedle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  knockOutIfNeeded(state2, 'player', state2.players.player.active);
  check('player active goes to null with an empty bench', state2.players.player.active, null);
  check('no pendingActiveChoice when there is nothing to choose from', state2.pendingActiveChoice, null);
  check('getWinner declares cpu the winner (no active, empty bench)', getWinner(state2), 'cpu');
})();

(function testEndTurnClearsPerTurnFlagsAndAdvancesTurn() {
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var beforePlayer = state.activePlayerId;
  state.players[beforePlayer].energyAttachedThisTurn = true;
  state.players[beforePlayer].retreatedThisTurn = true;
  var before = state.turnCounter;
  endTurn(state);
  check('turnCounter advanced by 1', state.turnCounter, before + 1);
  checkTrue('active player switched', state.activePlayerId !== beforePlayer);
  check('energyAttachedThisTurn reset', state.players[beforePlayer].energyAttachedThisTurn, false);
  check('retreatedThisTurn reset', state.players[beforePlayer].retreatedThisTurn, false);
})();

(function testDeckOutLoss() {
  var state = createGame(function () { return 0.42; });
  // Both players need an active Pokémon on the field, matching a real in-progress
  // game -- otherwise getWinner's "no active + empty bench" loss check (which runs
  // before the deck-out check) fires spuriously on this raw post-createGame state,
  // where neither player has played a Basic yet.
  state.players.player.active = { id: 'pa1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.active = { id: 'ca1', name: 'Weedle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.deck = [];
  check('getWinner is null before anyone is forced to draw from empty deck', getWinner(state), null);
  // endTurn only draws immediately for the player's own upcoming turn now --
  // the CPU's turn-start draw (and thus its deck-out check) happens later,
  // once cpuTakeTurn() actually runs (see its own comment), not inside
  // endTurn() itself anymore.
  state.activePlayerId = 'player';
  state.turnCounter = 3; // not turn 1, so a draw is attempted
  endTurn(state); // hands the turn to cpu; activePlayerId is now 'cpu'
  cpuTakeTurn(state); // cpu's turn actually starts, forced to draw from its empty deck
  check('cpu loses by decking out, player wins', getWinner(state), 'player');
})();

(function testCpuTurnStartDrawIsDeferredUntilCpuTakeTurn() {
  // Regression: attacking ends the player's turn engine-side (attack()
  // calls endTurn() internally) well before the CPU actually takes its
  // turn -- that only happens once the player clicks "Terminar turno"
  // (ui.js's runCpuTurn). The CPU's own turn-start draw used to happen
  // right there in endTurn(), so the player would see the CPU's hand count
  // go up the instant they attacked, before the CPU had done anything.
  var state = createGame(function () { return 0.42; });
  var p = state.players.player;
  var op = state.players.cpu;
  p.active = { id: 'atk1', name: 'Squirtle', attachedEnergy: ['Water'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  op.active = { id: 'def1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  // Empty CPU hand -- createGame's real dealt cards (Trainers that draw
  // more, energy to attach...) would add uncontrolled hand-count changes
  // during cpuTakeTurn's own action loop, confusing what this test means
  // to isolate: exactly one card drawn, and only once cpuTakeTurn runs.
  op.hand = [];
  state.activePlayerId = 'player';
  state.turnCounter = 3; // not turn 1, so a draw is actually attempted
  var cpuDeckBefore = op.deck.length;
  attack(state, 'player', 'Bubble'); // ends the player's turn internally
  check('attacking hands the turn to the CPU engine-side', state.activePlayerId, 'cpu');
  check("the CPU's hand hasn't drawn yet -- its turn hasn't actually started", op.hand.length, 0);
  check("the CPU's deck is untouched too", op.deck.length, cpuDeckBefore);
  cpuTakeTurn(state); // the CPU's turn actually starts now
  // Not a strict hand.length/deck.length delta check -- whatever single
  // card the CPU draws here might itself be immediately played (a Basic,
  // an Energy, even Professor Oak/Bill drawing more), so those counts
  // aren't deterministic. turnDrewCard is: drawForTurnStart sets it
  // regardless of what happens to the card afterward.
  checkTrue('the CPU only draws once its turn actually starts playing out', state.turnDrewCard);
  checkTrue("the draw came from its own deck", op.deck.length < cpuDeckBefore);
})();

(function testDeckOutOnlyTriggersWhenForcedToDrawWithEmptyDeck() {
  var state = createGame(function () { return 0.42; });
  // Both players need an active Pokémon (see testDeckOutLoss above) so the
  // "no active + empty bench" loss check doesn't fire spuriously on this raw
  // post-createGame state.
  state.players.player.active = { id: 'pa1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.active = { id: 'ca1', name: 'Weedle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.player.deck = [{ id: 'lastcard', name: 'Grass Energy' }];
  // For player to be the one who draws (and thus the one whose deck this test
  // is about), endTurn's "flip active player, then the flipped-to player draws"
  // ordering means cpu must be the one finishing their turn beforehand -- see
  // the same reasoning documented in testDeckOutLoss above.
  state.activePlayerId = 'cpu';
  state.turnCounter = 3;
  endTurn(state); // player successfully draws their last card, deck now empty
  check('successfully drawing the last card does not cause a loss', getWinner(state), null);
})();

(function testCheckupAppliesToOpponentsPoisonedActiveSameTurn() {
  var state = createGame(function () { return 0.42; });
  state.players.cpu.active = { id: 'cp1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: ['Poisoned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.bench = [];
  state.players.player.active = { id: 'pp1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.player.bench = [];
  state.activePlayerId = 'player';
  endTurn(state);
  applyEndOfTurnCheckup(state); // checkup no longer lives inside endTurn() itself -- see its own comment
  check('poison on the opponent\'s active ticks at the same checkup, not a turn late', state.players.cpu.active.damage, 10);
})();

(function testPlayerAttackDefersCheckupUntilTerminarTurno() {
  // Regression: attacking already ends the player's turn engine-side
  // (attack() calls endTurn() internally), but the Pokémon Checkup itself
  // (Poison/Burned/Asleep, both sides) should still wait for the real
  // "Terminar turno" click (ui.js's runCpuTurn calls applyEndOfTurnCheckup
  // directly) -- not resolve the instant the player attacks, before
  // they've actually handed the turn over.
  var state = createGame(function () { return 0.42; });
  var p = state.players.player;
  var op = state.players.cpu;
  p.active = { id: 'atk1', name: 'Squirtle', attachedEnergy: ['Water'], damage: 0, statusConditions: ['Poisoned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  op.active = { id: 'def1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: ['Poisoned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.activePlayerId = 'player';
  state.turnCounter = 3;
  attack(state, 'player', 'Bubble'); // ends the player's turn engine-side
  check("the player's own poisoned Pokémon hasn't ticked yet -- checkup is held until the real click", p.active.damage, 0);
  check("the attack's own 10 damage landed, but the CPU's poison hasn't ticked on top of it yet", op.active.damage, 10);
  applyEndOfTurnCheckup(state); // simulates ui.js's runCpuTurn, called right at the "Terminar turno" click
  check('the player\'s own poison now ticks, right at the click', p.active.damage, 10);
  check("the CPU's poison now ticks too, same click, same checkup", op.active.damage, 20);
})();

(function testCpuAttackAppliesCheckupImmediately() {
  // The CPU's own turn genuinely, immediately ends the instant it attacks
  // -- no click involved, unlike the player's -- so checkup applies right
  // away, same as it always has.
  var state = createGame(function () { return 0.42; });
  var p = state.players.cpu;
  p.active = { id: 'atk2', name: 'Squirtle', attachedEnergy: ['Water'], damage: 0, statusConditions: ['Poisoned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.player.active = { id: 'def2', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.activePlayerId = 'cpu';
  state.turnCounter = 3;
  attack(state, 'cpu', 'Bubble');
  check("the CPU's own poison ticks immediately, no click to wait for", p.active.damage, 10);
})();

(function testTrainerEffects() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  state.activePlayerId = pid;
  var p = state.players[pid];

  // Bill: draw 2
  p.hand = [{ id: 'h1', name: 'Bill' }];
  var beforeDeck = p.deck.length;
  var res = TRAINER_EFFECTS['Bill'](state, pid, 'h1');
  checkTrue('Bill is legal', res.legal);
  check('Bill draws 2 cards', p.deck.length, beforeDeck - 2);
  check('Bill card itself lands in the discard pile after being played', p.discard.map(function (c) { return c.name; }), ['Bill']);

  // Potion: remove up to 2 damage counters (20 HP) from one Pokémon
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 30, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.hand = [{ id: 'h2', name: 'Potion' }];
  TRAINER_EFFECTS['Potion'](state, pid, 'h2', 'a1');
  check('Potion removes up to 20 damage', p.active.damage, 10);

  // Super Potion: discard 1 energy from own Pokémon, remove up to 4 counters (40 HP)
  p.active.damage = 50;
  p.active.attachedEnergy = ['Grass'];
  p.hand = [{ id: 'h3', name: 'Super Potion' }];
  var superRes = TRAINER_EFFECTS['Super Potion'](state, pid, 'h3', 'a1');
  checkTrue('Super Potion legal when energy is attached', superRes.legal);
  check('Super Potion removes up to 40 damage', p.active.damage, 10);
  check('Super Potion discarded the energy', p.active.attachedEnergy.length, 0);

  // Switch: swap active with a bench Pokémon
  p.bench = [{ id: 'b1', name: 'Ivysaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  p.hand = [{ id: 'h4', name: 'Switch' }];
  TRAINER_EFFECTS['Switch'](state, pid, 'h4', 'b1');
  check('Switch makes Ivysaur active', p.active.name, 'Ivysaur');

  // Professor Oak: discard hand, draw 7
  p.hand = [{ id: 'h5', name: 'Professor Oak' }, { id: 'junk1', name: 'Grass Energy' }];
  var deckBefore = p.deck.length;
  TRAINER_EFFECTS['Professor Oak'](state, pid, 'h5');
  check('Professor Oak leaves exactly 7 cards in hand', p.hand.length, 7);

  // Gust of Wind: force opponent's bench Pokémon to become their active
  var cpu = state.players.cpu;
  cpu.active = { id: 'ca1', name: 'Hitmonchan', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  cpu.bench = [{ id: 'cb1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  p.hand = [{ id: 'h6', name: 'Gust of Wind' }];
  TRAINER_EFFECTS['Gust of Wind'](state, pid, 'h6', 'cb1');
  check('Gust of Wind forces Machop to become cpu active', cpu.active.name, 'Machop');

  // Energy Removal: discard 1 energy from opponent's chosen Pokémon
  cpu.active.attachedEnergy = ['Fighting'];
  p.hand = [{ id: 'h7', name: 'Energy Removal' }];
  TRAINER_EFFECTS['Energy Removal'](state, pid, 'h7', cpu.active.id);
  check('Energy Removal discards opponent energy', cpu.active.attachedEnergy.length, 0);

  // Super Energy Removal: discard 1 of own energy to discard up to 2 of opponent's
  p.active.attachedEnergy = ['Grass'];
  cpu.active.attachedEnergy = ['Fighting', 'Fighting'];
  p.hand = [{ id: 'h8', name: 'Super Energy Removal' }];
  TRAINER_EFFECTS['Super Energy Removal'](state, pid, 'h8', p.active.id, cpu.active.id);
  check('Super Energy Removal discards own energy', p.active.attachedEnergy.length, 0);
  check('Super Energy Removal discards up to 2 opponent energy', cpu.active.attachedEnergy.length, 0);

  // PlusPower: attaches, marks plusPowerAttached
  p.hand = [{ id: 'h9', name: 'PlusPower' }];
  TRAINER_EFFECTS['PlusPower'](state, pid, 'h9', p.active.id);
  checkTrue('PlusPower attaches to active', p.active.plusPowerAttached);

  // Every played Trainer card above (Bill, Potion, Super Potion, Switch,
  // Professor Oak, Gust of Wind, Energy Removal, Super Energy Removal,
  // PlusPower = 9 cards) plus the energy discarded as a cost/effect along
  // the way (Super Potion's 1, Energy Removal's 1, Super Energy Removal's
  // 1 own + up to 2 opponent's) should all have landed in a discard pile.
  var playerDiscardNames = p.discard.map(function (c) { return c.name; });
  check('all 9 played Trainer cards ended up in the discard pile', playerDiscardNames.filter(function (n) {
    return ['Bill', 'Potion', 'Super Potion', 'Switch', 'Professor Oak', 'Gust of Wind', 'Energy Removal', 'Super Energy Removal', 'PlusPower'].indexOf(n) !== -1;
  }).length, 9);
})();

(function testTrainerEffectsInvalidHandId() {
  // Test that invalid handId fails cleanly without corrupting hand
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.hand = [{ id: 'h1', name: 'Grass Energy' }, { id: 'h2', name: 'Grass Energy' }];
  var handLengthBefore = p.hand.length;
  var res = TRAINER_EFFECTS['Bill'](state, pid, 'bogus-id-not-in-hand');
  checkTrue('Bill with invalid handId is not legal', !res.legal);
  check('Bill with invalid handId did not remove any card', p.hand.length, handLengthBefore);
})();

(function testPlusPowerMustTargetActive() {
  // Test that PlusPower can only target the Active Pokémon, not bench
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.bench = [{ id: 'b1', name: 'Ivysaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  p.hand = [{ id: 'h1', name: 'PlusPower' }];
  var benchBefore = p.bench[0].plusPowerAttached;
  var res = TRAINER_EFFECTS['PlusPower'](state, pid, 'h1', p.bench[0].id);
  checkTrue('PlusPower targeting bench is not legal', !res.legal);
  check('PlusPower card still in hand', p.hand.length, 1);
  check('bench Pokémon not affected by failed PlusPower', p.bench[0].plusPowerAttached, false);
})();

(function testSuperEnergyRemovalOwnEnergyIndex() {
  // The player picks which of their own Pokémon's attached energy cards
  // pays the cost (ui.js's openEnergyDiscardModal) -- ownEnergyIndex must
  // actually honor that choice, not always discard index 0.
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  state.activePlayerId = pid;
  var p = state.players[pid];
  var cpu = state.players.cpu;
  p.active = { id: 'a1', name: 'Blastoise', attachedEnergy: ['Water', 'Grass'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  cpu.active = { id: 'ca1', name: 'Machop', attachedEnergy: ['Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.hand = [{ id: 'h1', name: 'Super Energy Removal' }];
  TRAINER_EFFECTS['Super Energy Removal'](state, pid, 'h1', p.active.id, cpu.active.id, 1);
  check('ownEnergyIndex=1 discards the Grass energy, not Water', p.active.attachedEnergy, ['Water']);

  // Omitting ownEnergyIndex still defaults to index 0 (ai.js's CPU usage
  // never passes it).
  var state2 = createGame(function () { return 0.42; });
  state2.activePlayerId = 'player';
  var p2 = state2.players.player;
  var cpu2 = state2.players.cpu;
  p2.active = { id: 'a2', name: 'Blastoise', attachedEnergy: ['Water', 'Grass'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  cpu2.active = { id: 'ca2', name: 'Machop', attachedEnergy: ['Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p2.hand = [{ id: 'h2', name: 'Super Energy Removal' }];
  TRAINER_EFFECTS['Super Energy Removal'](state2, 'player', 'h2', p2.active.id, cpu2.active.id);
  check('omitting ownEnergyIndex defaults to discarding index 0 (Water)', p2.active.attachedEnergy, ['Grass']);
})();

(function testOvergrowthAttackEffects() {
  var state = createGame(function () { return 0.0; }); // rng()=0 => coinFlip always 'H' (heads)
  var mkP = function (name, extra) {
    var base = { id: 'x_' + name, name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
    return Object.assign(base, extra || {});
  };

  // Weedle's Poison Sting: 10 dmg, coin flip to poison (heads => poisoned, since rng()=0 always heads)
  var weedle = mkP('Weedle'); var target1 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Weedle']['Poison Sting'](state, weedle, target1);
  check('Weedle Poison Sting deals 10', target1.damage, 10);
  checkTrue('Weedle Poison Sting poisons on heads', hasStatus(target1, 'Poisoned'));

  // Ivysaur's Poisonpowder: always poisons (no coin flip in the text), 20 dmg
  var ivysaur = mkP('Ivysaur'); var target2 = mkP('Machop');
  ATTACK_EFFECTS['Ivysaur']['Poisonpowder'](state, ivysaur, target2);
  check('Ivysaur Poisonpowder deals 20', target2.damage, 20);
  checkTrue('Ivysaur Poisonpowder always poisons', hasStatus(target2, 'Poisoned'));

  // Gyarados Bubblebeam: 40 dmg, coin flip to paralyze
  var gyarados = mkP('Gyarados'); var target3 = mkP('Onix');
  ATTACK_EFFECTS['Gyarados']['Bubblebeam'](state, gyarados, target3);
  check('Gyarados Bubblebeam deals 40', target3.damage, 40);
  checkTrue('Gyarados Bubblebeam paralyzes on heads', hasStatus(target3, 'Paralyzed'));

  // Magikarp's Flail: 10 x its own damage counters
  var magikarp = mkP('Magikarp', { damage: 20 }); var target4 = mkP('Squirtle');
  ATTACK_EFFECTS['Magikarp']['Flail'](state, magikarp, target4);
  check('Flail deals 10 per damage counter (2 counters = 20)', target4.damage, 20);

  // Beedrill's Twineedle: flip 2 coins, 30 x heads -- rng always 0 => both heads => 60
  var beedrill = mkP('Beedrill'); var target5 = mkP('Squirtle');
  ATTACK_EFFECTS['Beedrill']['Twineedle'](state, beedrill, target5);
  check('Twineedle with both coins heads deals 60', target5.damage, 60);

  // Kakuna's Stiffen: coin flip shield, no damage
  var kakuna = mkP('Kakuna');
  state.turnCounter = 4;
  ATTACK_EFFECTS['Kakuna']['Stiffen'](state, kakuna, null);
  check('Stiffen sets a preventAll shield on heads', kakuna.shield && kakuna.shield.type, 'preventAll');
  check('Stiffen shield applies to the attacker\'s own next-defended turn', kakuna.shield.untilTurn, 5);

  // Starmie's Recover: discards a Water Energy from itself, heals fully
  var starmie = mkP('Starmie', { attachedEnergy: ['Water', 'Water'], damage: 30 });
  ATTACK_EFFECTS['Starmie']['Recover'](state, starmie, null);
  check('Recover heals all damage', starmie.damage, 0);
  check('Recover discards 1 Water Energy', starmie.attachedEnergy.length, 1);

  // Staryu's Slap: plain 20 damage
  var staryu = mkP('Staryu'); var target6 = mkP('Machop');
  ATTACK_EFFECTS['Staryu']['Slap'](state, staryu, target6);
  check('Slap deals 20', target6.damage, 20);

  // Bulbasaur's Leech Seed: 20 dmg, heals 1 damage counter (10) off itself when damage lands
  var bulbasaur = mkP('Bulbasaur', { damage: 20 }); var target7 = mkP('Machop');
  ATTACK_EFFECTS['Bulbasaur']['Leech Seed'](state, bulbasaur, target7);
  check('Leech Seed deals 20 to the defender', target7.damage, 20);
  check('Leech Seed heals 10 off Bulbasaur when damage lands', bulbasaur.damage, 10);
})();

(function testBlackoutAttackEffects() {
  var state = createGame(function () { return 0.0; }); // always heads
  var mkP = function (name, extra) {
    var base = { id: 'y_' + name, name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
    return Object.assign(base, extra || {});
  };

  // Machoke's Karate Chop: 50 minus 10 per own damage counter
  var machoke = mkP('Machoke', { damage: 20 }); var t1 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Machoke']['Karate Chop'](state, machoke, t1);
  check('Karate Chop with 2 counters deals 30', t1.damage, 30);

  // Machoke's Submission: 60 to defender, 20 to self
  var machoke2 = mkP('Machoke'); var t2 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Machoke']['Submission'](state, machoke2, t2);
  check('Submission deals 60 to defender', t2.damage, 60);
  check('Submission deals 20 to self', machoke2.damage, 20);

  // Squirtle's Bubble: 10 dmg + coin flip paralyze
  var squirtle = mkP('Squirtle'); var t3 = mkP('Machop');
  ATTACK_EFFECTS['Squirtle']['Bubble'](state, squirtle, t3);
  check('Bubble deals 10', t3.damage, 10);
  checkTrue('Bubble paralyzes on heads', hasStatus(t3, 'Paralyzed'));

  // Squirtle's Withdraw: coin-flip shield, no damage
  var squirtle2 = mkP('Squirtle');
  state.turnCounter = 2;
  ATTACK_EFFECTS['Squirtle']['Withdraw'](state, squirtle2, null);
  check('Withdraw sets a preventAll shield on heads', squirtle2.shield && squirtle2.shield.type, 'preventAll');

  // Onix's Harden: always sets a thresholdMax(30) shield, no coin flip
  var onix = mkP('Onix');
  state.turnCounter = 7;
  ATTACK_EFFECTS['Onix']['Harden'](state, onix, null);
  check('Harden sets a thresholdMax shield', onix.shield && onix.shield.type, 'thresholdMax');
  check('Harden threshold is 30', onix.shield.thresholdMax, 30);

  // Sandshrew's Sand-attack: 10 dmg, sets a miss-chance debuff on the defender's next attack
  var sandshrew = mkP('Sandshrew'); var t4 = mkP('Machop');
  state.turnCounter = 9;
  ATTACK_EFFECTS['Sandshrew']['Sand-attack'](state, sandshrew, t4);
  check('Sand-attack deals 10', t4.damage, 10);
  check('Sand-attack sets missChanceUntilTurn on the defender for the opponent\'s next turn', t4.missChanceUntilTurn, 10);

  // Farfetch'd's Leek Slap: 30 dmg on heads, and locks itself regardless of outcome
  var farfetchd = mkP("Farfetch'd"); var t5 = mkP('Machop');
  ATTACK_EFFECTS["Farfetch'd"]['Leek Slap'](state, farfetchd, t5);
  checkTrue('Leek Slap locks itself after use', farfetchd.lockedAttacks.indexOf('Leek Slap') !== -1);

  // Hitmonchan's Special Punch: plain 40 damage, no text
  var hitmonchan = mkP('Hitmonchan'); var t6 = mkP('Machop');
  ATTACK_EFFECTS['Hitmonchan']['Special Punch'](state, hitmonchan, t6);
  check('Special Punch deals 40', t6.damage, 40);
})();

(function testZapAttackEffects() {
  var state = createGame(function () { return 0.0; }); // rng()=0 => coinFlip always 'H' (heads), 'T' never
  var mkP = function (name, extra) {
    var base = { id: 'z_' + name, name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
    return Object.assign(base, extra || {});
  };

  // Mewtwo's Psychic: 10 + 10 per Energy card attached to the DEFENDER (not
  // the attacker) -- uses a Grass-type defender (Bulbasaur, weak to Fire)
  // instead of a Fighting-type one, since Fighting is weak to Psychic in
  // this era's type chart and would double the damage, muddying this
  // specific formula check.
  var mewtwo = mkP('Mewtwo'); var t1 = mkP('Bulbasaur', { attachedEnergy: ['Grass', 'Grass'] });
  ATTACK_EFFECTS['Mewtwo']['Psychic'](state, mewtwo, t1);
  check('Psychic deals 10 + 10 per energy on the defender (2 energy = 30)', t1.damage, 30);

  // Mewtwo's Barrier: discards its own Psychic energy, sets a preventAll shield
  var mewtwo2 = mkP('Mewtwo', { attachedEnergy: ['Psychic'] });
  state.turnCounter = 3;
  ATTACK_EFFECTS['Mewtwo']['Barrier'](state, mewtwo2, null, null, 'player');
  check('Barrier discards the Psychic energy', mewtwo2.attachedEnergy.length, 0);
  check('Barrier sets a preventAll shield', mewtwo2.shield && mewtwo2.shield.type, 'preventAll');
  check('Barrier shield covers the opponent\'s next turn', mewtwo2.shield.untilTurn, 4);

  // Kadabra's Recover: same mechanic as Starmie's, but discards Psychic energy
  var kadabra = mkP('Kadabra', { attachedEnergy: ['Psychic', 'Psychic'], damage: 30 });
  ATTACK_EFFECTS['Kadabra']['Recover'](state, kadabra, null, null, 'player');
  check('Kadabra Recover heals all damage', kadabra.damage, 0);
  check('Kadabra Recover discards 1 Psychic Energy', kadabra.attachedEnergy.length, 1);

  // Jynx's Meditate: 20 + 10 per damage counter ALREADY on the defender
  var jynx = mkP('Jynx'); var t2 = mkP('Gastly', { damage: 20 });
  ATTACK_EFFECTS['Jynx']['Meditate'](state, jynx, t2);
  check('Meditate deals 20 + 10 per damage counter on the defender (2 counters = 40 more)', t2.damage - 20, 40);

  // Haunter's Hypnosis: unconditional Asleep (no coin flip in the real text)
  var haunter = mkP('Haunter'); var t3 = mkP('Pikachu');
  ATTACK_EFFECTS['Haunter']['Hypnosis'](state, haunter, t3);
  checkTrue('Hypnosis always puts the defender Asleep', hasStatus(t3, 'Asleep'));

  // Gastly's Destiny Bond: discards Psychic energy, arms a revenge-KO flag
  var gastly = mkP('Gastly', { attachedEnergy: ['Psychic'] });
  state.turnCounter = 5;
  ATTACK_EFFECTS['Gastly']['Destiny Bond'](state, gastly, null, null, 'player');
  check('Destiny Bond discards the Psychic energy', gastly.attachedEnergy.length, 0);
  check('Destiny Bond arms a revenge-KO for the exact next turn', gastly.destinyBond.untilTurn, 6);

  // Drowzee's Confuse Ray: 10 dmg + coin flip Confused -- Bulbasaur again
  // (not Abra/another Psychic-type, which would double from weakness).
  var drowzee = mkP('Drowzee'); var t4 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Drowzee']['Confuse Ray'](state, drowzee, t4);
  check('Confuse Ray deals 10', t4.damage, 10);
  checkTrue('Confuse Ray confuses on heads', hasStatus(t4, 'Confused'));

  // Pikachu's Thunder Jolt: 30 dmg always, self-damage only on TAILS (rng=0 => always heads => no self-damage)
  var pikachu = mkP('Pikachu'); var t5 = mkP('Magnemite');
  ATTACK_EFFECTS['Pikachu']['Thunder Jolt'](state, pikachu, t5);
  check('Thunder Jolt deals 30', t5.damage, 30);
  check('Thunder Jolt does not self-damage on heads', pikachu.damage, 0);
})();

(function testThunderJoltSelfDamageOnTails() {
  var state = createGame(function () { return 0.99; }); // coinFlip always 'T' (tails)
  var pikachu = { id: 'pk1', name: 'Pikachu', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  var defender = { id: 'df1', name: 'Magnemite', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  ATTACK_EFFECTS['Pikachu']['Thunder Jolt'](state, pikachu, defender);
  check('Thunder Jolt still deals 30 on tails', defender.damage, 30);
  check('Thunder Jolt self-damages 10 on tails', pikachu.damage, 10);
})();

(function testSelfDamageKOsTheAttackerImmediately() {
  // Real reported bug: Pikachu (40 HP) at 30 damage used Thunder Jolt,
  // rolled tails (10 self-damage, reaching exactly 40), and stayed on the
  // board as a live 0-HP Active until the player's NEXT "Terminar turno"
  // -- because attack() only ever checked the DEFENDER for a KO, never
  // the attacker's own self-damage. It must be knocked out (and prompt a
  // Bench replacement, same as a KO from the opponent) the instant the
  // attack resolves, not deferred to the next checkup.
  var state = createGame(function () { return 0.99; }); // coinFlip always 'T' (tails)
  state.activePlayerId = 'player';
  var p = state.players.player;
  var cpu = state.players.cpu;
  p.active = { id: 'pk1', name: 'Pikachu', attachedEnergy: ['Lightning', 'Colorless'], damage: 30, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  p.bench = [{ id: 'b1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null }, null, null, null, null];
  p.prizes = [{ id: 'pz1', name: 'Bill' }];
  cpu.active = { id: 'ca1', name: 'Magnemite', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };

  attack(state, 'player', 'Thunder Jolt');

  check('Pikachu is no longer the Active -- it was knocked out immediately, not left at 0 HP', p.active, null);
  checkTrue('the player is immediately prompted to pick a Bench replacement', state.pendingActiveChoice === 'player');
})();

(function testHaunterDreamEaterRequiresSleepingDefender() {
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  var op = state.players.cpu;
  p.active = { id: 'h1', name: 'Haunter', attachedEnergy: ['Psychic', 'Psychic'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  op.active = { id: 'c1', name: 'Pikachu', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  checkTrue('Dream Eater is illegal when the defender is not Asleep', !canAttack(state, 'player', 'Dream Eater'));
  op.active.statusConditions = ['Asleep'];
  checkTrue('Dream Eater becomes legal once the defender is Asleep', canAttack(state, 'player', 'Dream Eater'));
})();

(function testDestinyBondRevengeKO() {
  // Gastly uses Destiny Bond, survives to the opponent's next turn, then
  // gets knocked out by their attack -- the attacker should go down too.
  var state = createGame(function () { return 0.99; }); // coinFlip always tails (no incidental status effects)
  state.activePlayerId = 'player';
  var p = state.players.player;
  var cpu = state.players.cpu;
  p.active = { id: 'g1', name: 'Gastly', attachedEnergy: ['Psychic'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  p.bench = [null, null, null, null, null];
  p.prizes = [{ id: 'pz1', name: 'Bill' }];
  cpu.active = { id: 'm1', name: 'Machop', attachedEnergy: ['Fighting', 'Fighting', 'Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  cpu.bench = [null, null, null, null, null];
  cpu.prizes = [{ id: 'pz2', name: 'Bill' }];

  ATTACK_EFFECTS['Gastly']['Destiny Bond'](state, p.active, null, null, 'player');
  check('Destiny Bond window is the very next turn', p.active.destinyBond.untilTurn, state.turnCounter + 1);

  // Hand the turn to the CPU (real flow: attack() -> endTurn() would do
  // this; simulated directly here since we're calling the attack effect
  // in isolation above).
  state.turnCounter += 1;
  state.activePlayerId = 'cpu';
  p.active.damage = CARD_STATS['Gastly'].hp; // Machop's attack lands the KO on Gastly
  knockOutIfNeeded(state, 'player', p.active);

  check('Gastly itself is knocked out', state.players.player.active, null);
  check('Machop (the attacker) is also knocked out by Destiny Bond', cpu.active, null);
  // The player's own prizes are specific face-down cards (see
  // knockOutIfNeeded's own comment) -- a KO in the player's favor sets a
  // pending choice rather than moving a card straight to hand.
  checkTrue('Gastly\'s owner still gets a prize choice for Machop going down too', !!state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === 'player');
})();

(function testDestinyBondDoesNotTriggerDuringOwnTurn() {
  // If Gastly dies during its OWN side's turn (e.g. its own end-of-turn
  // Poison checkup), Destiny Bond must NOT trigger -- the real card only
  // covers "your opponent's next turn".
  var state = createGame(function () { return 0.99; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  var cpu = state.players.cpu;
  p.active = { id: 'g2', name: 'Gastly', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: { untilTurn: state.turnCounter } };
  p.bench = [null, null, null, null, null];
  p.prizes = [{ id: 'pz3', name: 'Bill' }];
  cpu.active = { id: 'm2', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  cpu.bench = [null, null, null, null, null];
  cpu.prizes = [{ id: 'pz4', name: 'Bill' }];

  p.active.damage = CARD_STATS['Gastly'].hp;
  knockOutIfNeeded(state, 'player', p.active);
  check('Gastly is knocked out', state.players.player.active, null);
  check('Machop survives -- Destiny Bond does not fire during Gastly\'s own turn', cpu.active.name, 'Machop');
})();

(function testMagnemiteSelfdestruct() {
  var state = createGame(function () { return 0.5; }); // rng()=0.5 => coinFlip('T', since 0.5 is not < 0.5) -- irrelevant here, Selfdestruct has no coin flip
  state.activePlayerId = 'player';
  var p = state.players.player;
  var cpu = state.players.cpu;
  var mk = function (id, name, extra) {
    return Object.assign({ id: id, name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null }, extra || {});
  };
  p.active = mk('mag1', 'Magnemite');
  p.bench = [mk('pb1', 'Bulbasaur'), null, null, null, null];
  p.prizes = [{ id: 'pz5', name: 'Bill' }];
  cpu.active = mk('opp1', 'Machop');
  // One CPU bench Pokémon already has 30 damage -- the 10 splash should knock it out.
  cpu.bench = [mk('cb1', 'Weedle', { damage: 30 }), null, null, null, null];
  cpu.prizes = [{ id: 'pz6', name: 'Bill' }];

  ATTACK_EFFECTS['Magnemite']['Selfdestruct'](state, p.active, cpu.active, null, 'player');

  check('Selfdestruct splashes 10 onto the player\'s own bench too', p.bench[0].damage, 10);
  check('Selfdestruct splashes 10 onto the opponent\'s bench', cpu.bench[0], null); // Weedle (40 HP) had 30+10=40 -> knocked out, slot cleared
  check('Selfdestruct does not touch the opponent\'s Active at all', cpu.active.damage, 0);
  check('Magnemite (the attacker) takes exactly 40 self-damage and is knocked out', p.active, null);
  // The opponent's bench Weedle going down is a KO in the PLAYER's favor
  // (whose own prizes are specific face-down cards -- see
  // knockOutIfNeeded's own comment), so it sets a pending choice rather
  // than moving a card straight to hand.
  checkTrue('the player gets a prize choice for the opponent\'s bench Weedle going down', !!state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === 'player');
})();

(function testComputerSearch() {
  // Real printed text (per user's explicit call): discard 2 OTHER hand
  // cards as a cost, then search the deck for any card.
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  p.hand = [{ id: 'h1', name: 'Computer Search' }, { id: 'h2', name: 'Bill' }, { id: 'h3', name: 'Potion' }];
  p.deck = [{ id: 'd1', name: 'Bill' }, { id: 'd2', name: 'Potion' }, { id: 'd3', name: 'Bill' }];
  var result = TRAINER_EFFECTS['Computer Search'](state, 'player', 'h1', 'd2', ['h2', 'h3']);
  checkTrue('Computer Search resolves legally', result.legal);
  check('Computer Search card lands in the discard pile', p.discard.some(function (c) { return c.name === 'Computer Search'; }), true);
  check('both discard-cost cards land in the discard pile', p.discard.filter(function (c) { return c.id === 'h2' || c.id === 'h3'; }).length, 2);
  checkTrue('the searched-for card lands in hand', p.hand.some(function (c) { return c.id === 'd2'; }));
  check('the deck has one fewer card', p.deck.length, 2);
  checkTrue('the found card is no longer in the deck', p.deck.every(function (c) { return c.id !== 'd2'; }));

  var badResult = TRAINER_EFFECTS['Computer Search'](state, 'player', 'nope', 'd1', ['h2', 'h3']);
  checkTrue('an invalid hand id is rejected', !badResult.legal);
})();

(function testComputerSearchRequiresExactlyTwoOtherDiscards() {
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  p.hand = [{ id: 'h1', name: 'Computer Search' }, { id: 'h2', name: 'Bill' }];
  p.deck = [{ id: 'd1', name: 'Bill' }];
  var handLengthBefore = p.hand.length;

  var noDiscards = TRAINER_EFFECTS['Computer Search'](state, 'player', 'h1', 'd1');
  checkTrue('omitting discardHandIds is illegal', !noDiscards.legal);

  var onlyOne = TRAINER_EFFECTS['Computer Search'](state, 'player', 'h1', 'd1', ['h2']);
  checkTrue('discarding only 1 card is illegal', !onlyOne.legal);

  var itself = TRAINER_EFFECTS['Computer Search'](state, 'player', 'h1', 'd1', ['h1', 'h2']);
  checkTrue('trying to discard Computer Search itself as one of the 2 is illegal', !itself.legal);

  check('none of the illegal attempts changed the hand', p.hand.length, handLengthBefore);
})();

(function testDefenderShield() {
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  var cpu = state.players.cpu;
  p.hand = [{ id: 'h1', name: 'Defender' }];
  var bench = { id: 'b1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  p.bench = [bench, null, null, null, null];
  state.turnCounter = 2;
  var result = TRAINER_EFFECTS['Defender'](state, 'player', 'h1', 'b1');
  checkTrue('Defender can target a Bench Pokémon (unlike PlusPower)', result.legal);
  check('Defender sets a reduceFlat shield', bench.shield.type, 'reduceFlat');
  check('Defender reduces damage by 20', bench.shield.reduceAmount, 20);
  check('Defender lasts through the opponent\'s next turn', bench.shield.untilTurn, 3);

  var attacker = { id: 'atk1', name: 'Machop' };
  cpu.active = attacker;
  // The shield only actually applies once its promised window (untilTurn)
  // arrives -- advance turnCounter to match, same as every other shield
  // type already does (see Kakuna's Stiffen/Onix's Harden tests above).
  state.turnCounter = 3;
  var dealt = dealDamage(state, attacker, bench, 30);
  check('dealDamage applies the reduceFlat shield (30-20=10)', dealt, 10);
  var dealtAgain = dealDamage(state, attacker, bench, 15);
  check('reduceFlat keeps applying to every hit in its window, not just the first', dealtAgain, 0);
})();

(function testDefenderShieldExpiresEvenIfNeverAttacked() {
  // Real bug report: Defender's shield (and its visible "+20DEF" badge)
  // used to only ever get cleared reactively, inside dealDamage -- a
  // Pokémon that was never actually attacked during its window kept the
  // shield (and the badge) forever. endTurn() now sweeps it away once its
  // window has genuinely passed, whether or not anything ever hit it.
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  var cpu = state.players.cpu;
  p.hand = [{ id: 'h1', name: 'Defender' }];
  var shielded = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  p.active = shielded;
  p.bench = [null, null, null, null, null];
  cpu.active = { id: 'c1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  cpu.bench = [null, null, null, null, null];

  TRAINER_EFFECTS['Defender'](state, 'player', 'h1', 'a1');
  check('Defender is armed for the very next turn', shielded.shield.untilTurn, state.turnCounter + 1);

  endTurn(state); // ends the player's turn (the one Defender was played on) -- shield must survive this
  checkTrue('the shield survives past the end of the SAME turn it was played', !!shielded.shield);

  endTurn(state); // ends the opponent's turn -- nothing ever attacked "shielded" this whole time
  check('the shield is swept away once its promised window has fully passed, even though nothing ever attacked it', shielded.shield, null);
})();

(function testPlusPowerClearsFromBenchIfRetreatedBeforeEndOfTurn() {
  // Real card: "At the end of your turn, discard PlusPower" -- applies
  // regardless of where the Pokémon ends up, not just whatever's still
  // Active the instant the turn ends.
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  var retreated = { id: 'r1', name: 'Pikachu', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: true, destinyBond: null };
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null };
  p.bench = [retreated, null, null, null, null]; // simulates having retreated away from it earlier this same turn
  endTurn(state);
  check('PlusPower clears even on a Pokémon that retreated to Bench before the turn ended', retreated.plusPowerAttached, false);
})();

(function testCpuTakesALegalTurnWithoutThrowing() {
  var state = createGame(function () { return 0.37; });
  state.activePlayerId = 'cpu';
  var beforeTurn = state.turnCounter;
  cpuTakeTurn(state);
  checkTrue('cpuTakeTurn advances the turn (attacked or explicitly ended turn)', state.turnCounter > beforeTurn);
})();

(function testGetWinnerNullAtGameStart() {
  var state = createGame(function () { return 0.42; });
  check('no false winner before either player has placed a Pokémon', getWinner(state), null);
})();

(function testGetWinnerNullAfterOnlyOneSideHasMoved() {
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'cpu';
  cpuTakeTurn(state); // cpu places its own active and ends its turn; player has not acted yet
  check('no false winner when only one side has had a turn (Task 11\'s exact call pattern)', getWinner(state), null);
})();

(function testGetWinnerStillDetectsRealWipeout() {
  var state = createGame(function () { return 0.42; });
  state.players.player.hasHadActive = true;
  state.players.player.active = null;
  state.players.player.bench = [];
  check('a real wipeout (had an active, now has none) still correctly loses', getWinner(state), 'cpu');
})();

(function testBurnedDamageAndCoinFlipHeal() {
  var state = createGame(function () { return 0.0; }); // heads = burn heals
  var p = state.players.player;
  p.active = { id: 'burn1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: ['Burned'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.activePlayerId = 'player';
  endTurn(state);
  applyEndOfTurnCheckup(state); // checkup no longer lives inside endTurn() itself -- see its own comment
  check('Burned deals 10 damage at checkup', p.active.damage, 10);
  checkTrue('Burned heals on a heads coin flip', p.active.statusConditions.indexOf('Burned') === -1);
})();

(function testAsleepWakesOnHeads() {
  var state = createGame(function () { return 0.0; }); // heads = wakes up
  var p = state.players.player;
  p.active = { id: 'sleep1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: ['Asleep'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.activePlayerId = 'player';
  endTurn(state);
  applyEndOfTurnCheckup(state); // checkup no longer lives inside endTurn() itself -- see its own comment
  checkTrue('Asleep wakes up on a heads coin flip', p.active.statusConditions.indexOf('Asleep') === -1);
})();

(function testAddStatusExclusivity() {
  var instance = { id: 'x1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  addStatus(instance, 'Asleep');
  addStatus(instance, 'Paralyzed');
  check('Asleep and Paralyzed are mutually exclusive, only the latest remains', instance.statusConditions, ['Paralyzed']);
  addStatus(instance, 'Poisoned');
  check('Poisoned stacks alongside an exclusive status', instance.statusConditions.sort(), ['Paralyzed', 'Poisoned']);
})();

(function testConfusedAttackSelfDamageOnTails() {
  // 0.99 (not the literal 1.0) -- rng()===1.0 exactly hits a pre-existing,
  // out-of-scope edge case in shuffle()'s Fisher-Yates (Math.floor(1.0*(i+1))
  // goes one index past the end of the array during createGame's initial
  // deck shuffle). 0.99 still deterministically resolves the coin flip to
  // tails (rng() < 0.5 is false) without tripping that unrelated bug.
  var state = createGame(function () { return 0.99; }); // tails
  var p = state.players.player;
  p.active = { id: 'conf1', name: 'Bulbasaur', attachedEnergy: ['Grass', 'Grass'], damage: 0, statusConditions: ['Confused'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.active = { id: 'target1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.activePlayerId = 'player';
  state.turnCounter = 2;
  attack(state, 'player', 'Leech Seed');
  check('Confused attack on tails deals 30 self-damage instead of the normal attack', p.active.damage, 30);
  check('Confused attack on tails does not damage the defender', state.players.cpu.active.damage, 0);
})();

(function testScriptedCpuVsCpuStabilityRun() {
  var GAMES = 20;
  var TURN_CAP = 400;
  var completed = 0;
  for (var g = 0; g < GAMES; g++) {
    var seed = g;
    var rng = (function (s) { return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })(seed + 1);
    var state = createGame(rng);
    aiSetupBoard(state, 'player');
    aiSetupBoard(state, 'cpu');
    startMatch(state);
    var turns = 0;
    var winner = null;
    while (!winner && turns < TURN_CAP) {
      cpuTakeTurn(state);
      // The player's own prizes are a choice in real play (see takePrize());
      // this fully-automated simulation just always takes the first still-
      // available slot, the same way the CPU's own prizes are auto-taken
      // with no real choice. Slots go null in place instead of shifting, so
      // "the first one" means the first non-null slot, not index 0.
      while (state.pendingPrizeChoice) {
        var pid = state.pendingPrizeChoice.playerId;
        var idx = state.players[pid].prizes.findIndex(function (c) { return c; });
        takePrize(state, pid, idx);
      }
      winner = getWinner(state);
      turns++;
    }
    checkTrue('game ' + g + ' finished within ' + TURN_CAP + ' turns', turns < TURN_CAP);
    if (winner) { completed++; }
  }
  check('all scripted games reached a winner', completed, GAMES);
})();

(function testEstimateDamage() {
  // Beedrill (Grass) vs Gyarados, which is weak to Grass -- doubles.
  check('estimateDamage doubles on a real weakness match', estimateDamage('Beedrill', 40, 'Gyarados', false), 80);
  // Machop (Fighting) vs Beedrill, which resists Fighting by -30, clamped at 0.
  check('estimateDamage applies -30 resistance, clamped at 0', estimateDamage('Machop', 20, 'Beedrill', false), 0);
  // Beedrill vs Wartortle: no weakness/resistance interaction, just +10 for PlusPower.
  check('estimateDamage adds +10 for PlusPower with no other interaction', estimateDamage('Beedrill', 40, 'Wartortle', true), 50);
  // Gyarados (Water) vs Bulbasaur, which is weak to Fire only -- no interaction.
  check('estimateDamage with no weakness/resistance/plusPower is just the base', estimateDamage('Gyarados', 50, 'Bulbasaur', false), 50);
  check('estimateDamage of 0 base damage stays 0', estimateDamage('Beedrill', 0, 'Gyarados', false), 0);
})();

(function testAiBestAttackAgainst() {
  var beedrill = { id: 'b1', name: 'Beedrill', attachedEnergy: ['Grass', 'Grass', 'Grass'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var gyarados = { id: 'g1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var best = aiBestAttackAgainst(beedrill, gyarados);
  check('aiBestAttackAgainst picks the attack with the highest real damage vs this defender', best.name, 'Poison Sting');
  check('aiBestAttackAgainst with no defender returns null', aiBestAttackAgainst(beedrill, null), null);
})();

(function testAiTryPlusPower() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'z_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  // Beedrill's Poison Sting is a flat 40 vs Wartortle (no weakness/
  // resistance interaction between them).
  function setup(defenderDamage) {
    var state = createGame(function () { return 0.42; });
    state.activePlayerId = 'cpu';
    var p = state.players.cpu;
    var op = state.players.player;
    p.active = mk('Beedrill', { attachedEnergy: ['Grass', 'Grass', 'Grass'] });
    op.active = mk('Wartortle', { damage: defenderDamage });
    p.hand = [{ id: 'pp1', name: 'PlusPower' }];
    return { state: state, p: p, op: op };
  }

  // Wartortle has 70 HP; 21 damage taken leaves 49 remaining. Poison Sting
  // alone (40) falls short; +10 from PlusPower (50) secures it.
  var needed = setup(21);
  checkTrue('Normal plays PlusPower when it turns a non-lethal hit lethal', aiTryPlusPower(needed.state, 'cpu', false));
  checkTrue('PlusPower actually got attached', needed.p.active.plusPowerAttached);

  // 40 damage taken leaves 30 remaining -- Poison Sting (40) is already
  // lethal on its own.
  var alreadyLethalHard = setup(40);
  check('Hard (onlyIfNeeded) does not waste PlusPower when the plain attack already KOs', aiTryPlusPower(alreadyLethalHard.state, 'cpu', true), false);
  check('PlusPower stayed in hand', alreadyLethalHard.p.active.plusPowerAttached, false);

  var alreadyLethalNormal = setup(40);
  checkTrue('Normal (not onlyIfNeeded) still plays it even though already lethal', aiTryPlusPower(alreadyLethalNormal.state, 'cpu', false));

  // 0 damage taken leaves 70 remaining -- not even 50 (40+10) reaches that.
  var hopeless = setup(0);
  check('neither tier plays PlusPower when it still would not secure the KO', aiTryPlusPower(hopeless.state, 'cpu', false), false);
})();

(function testAiTryGustSnipe() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'gz_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'cpu';
  var p = state.players.cpu;
  var op = state.players.player;
  p.active = mk('Beedrill', { attachedEnergy: ['Grass', 'Grass', 'Grass'] });
  op.active = mk('Machop');
  // Onix (Fighting, 90 HP, weak to Grass) with 75 damage taken -- 15 HP
  // left. Beedrill's Poison Sting (40, Grass) doubles to 80 vs that
  // weakness, way past 15.
  var onix = mk('Onix', { damage: 75 });
  op.bench = [onix, null, null, null, null];
  p.hand = [{ id: 'gust1', name: 'Gust of Wind' }];
  checkTrue('aiTryGustSnipe pulls a benched Pokémon it can knock out', aiTryGustSnipe(state, 'cpu'));
  check('the sniped Pokémon becomes the opponent\'s new Active', op.active.id, onix.id);
})();

(function testAiTryEnergyDisruption() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'ez_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  function setup(oppEnergyCount) {
    var state = createGame(function () { return 0.42; });
    state.activePlayerId = 'cpu';
    var p = state.players.cpu;
    var op = state.players.player;
    p.active = mk('Onix');
    // Machop's Low Kick costs exactly 1 Fighting.
    op.active = mk('Machop', { attachedEnergy: Array(oppEnergyCount).fill('Fighting') });
    p.hand = [{ id: 'er1', name: 'Energy Removal' }];
    return { state: state, p: p, op: op };
  }

  // Exactly 1 Fighting attached -- Machop can attack right now. Removing
  // that one energy denies Low Kick next turn: the precise moment to strike.
  var precise = setup(1);
  checkTrue("plays Energy Removal the exact turn it denies the opponent's next attack", aiTryEnergyDisruption(precise.state, 'cpu'));
  check('the energy is actually gone', precise.op.active.attachedEnergy.length, 0);

  // 2 Fighting attached -- removing 1 still leaves 1, which still pays for
  // Low Kick. No value in playing it yet.
  var tooEarly = setup(2);
  check('does not play Energy Removal when it would not actually deny anything', aiTryEnergyDisruption(tooEarly.state, 'cpu'), false);
})();

(function testAiShouldRetreatInsteadOfAttack() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'rz_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };

  // Squirtle at 30 damage (10 HP left) can only Bubble for 10 (no
  // weakness interaction vs Machop) -- nowhere near a KO. Machop's Low
  // Kick (20, no interaction vs Squirtle either) would far exceed
  // Squirtle's remaining 10 HP next turn.
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'cpu';
  var p = state.players.cpu;
  var op = state.players.player;
  p.active = mk('Squirtle', { damage: 30, attachedEnergy: ['Water'] });
  op.active = mk('Machop', { attachedEnergy: ['Fighting'] });
  var saferBench = mk('Beedrill', { attachedEnergy: ['Grass', 'Grass', 'Grass'] });
  p.bench = [saferBench, null, null, null, null];
  var choice = aiShouldRetreatInsteadOfAttack(state, 'cpu');
  check('retreats to a Bench Pokémon that can still fight when staying Active risks a KO next turn', choice && choice.id, saferBench.id);

  // Beedrill's Poison Sting easily finishes a Machop already at 40 damage
  // (10 HP left, no weakness interaction needed) -- securing that KO
  // always wins over running away, regardless of what's on the Bench.
  var state2 = createGame(function () { return 0.42; });
  state2.activePlayerId = 'cpu';
  var p2 = state2.players.cpu;
  var op2 = state2.players.player;
  p2.active = mk('Beedrill', { attachedEnergy: ['Grass', 'Grass', 'Grass'] });
  op2.active = mk('Machop', { damage: 40 });
  check('never retreats away from a KO it can secure this turn', aiShouldRetreatInsteadOfAttack(state2, 'cpu'), null);
})();

(function testAiProactiveRetreatNormalThreshold() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'nz_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'cpu';
  var p = state.players.cpu;
  var op = state.players.player;
  // Wartortle (70 HP) at 45 damage leaves 25 -- at or under Normal's flat
  // 30-HP threshold, regardless of what the opponent can actually do.
  p.active = mk('Wartortle', { damage: 45, attachedEnergy: ['Water'] });
  op.active = mk('Weedle');
  var bench = mk('Beedrill', { attachedEnergy: ['Grass', 'Grass', 'Grass'] });
  p.bench = [bench, null, null, null, null];
  check('Easy never proactively retreats', aiProactiveRetreat(state, 'cpu', 'easy'), null);
  var choice = aiProactiveRetreat(state, 'cpu', 'normal');
  check("Normal retreats on a flat low-HP threshold, regardless of the actual threat", choice && choice.id, bench.id);
})();

(function testAiTryAttachEnergyRedirectsToBenchOnHard() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'az_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  function setup(rng) {
    var state = createGame(rng || function () { return 0.42; });
    state.activePlayerId = 'cpu';
    var p = state.players.cpu;
    // Machop's only attack (Low Kick) costs pure Fighting, no Colorless
    // slot -- Water energy does nothing for it. Staryu's Slap costs pure
    // Water, so it's the real beneficiary.
    p.active = mk('Machop');
    var staryu = mk('Staryu');
    p.bench = [staryu, null, null, null, null];
    p.hand = [{ id: 'we1', name: 'Water Energy' }];
    return { state: state, p: p, staryu: staryu };
  }

  var easy = setup();
  checkTrue('Easy attaches energy', aiTryAttachEnergy(easy.state, 'cpu', 'easy'));
  check('Easy always attaches to the Active, even when it is useless there', easy.p.active.attachedEnergy, ['Water']);
  check("Easy's Bench Pokémon is untouched", easy.staryu.attachedEnergy, []);

  // Normal only reasons about it ~half the time (state.rng() < 0.5) --
  // 0.9 fails that roll (dumb, straight to the Active), 0.1 passes it
  // (smart, redirects to the Bench Pokémon that can actually use it).
  var normalDumb = setup(function () { return 0.9; });
  checkTrue('Normal attaches energy (dumb roll)', aiTryAttachEnergy(normalDumb.state, 'cpu', 'normal'));
  check('Normal sometimes just attaches to the Active regardless of type fit', normalDumb.p.active.attachedEnergy, ['Water']);

  var normalSmart = setup(function () { return 0.1; });
  checkTrue('Normal attaches energy (smart roll)', aiTryAttachEnergy(normalSmart.state, 'cpu', 'normal'));
  check('Normal sometimes gets it right and redirects to the Bench', normalSmart.p.active.attachedEnergy, []);
  check("Normal's smart roll put it on the Staryu", normalSmart.staryu.attachedEnergy, ['Water']);

  var hard = setup();
  checkTrue('Hard attaches energy', aiTryAttachEnergy(hard.state, 'cpu', 'hard'));
  check("Hard redirects to the Bench Pokémon that can actually use this energy type", hard.p.active.attachedEnergy, []);
  check('the Staryu on Bench got the Water Energy instead', hard.staryu.attachedEnergy, ['Water']);
})();

(function testAiTryAttachEnergyStaysOnActiveWhenItHelps() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'ah_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'cpu';
  var p = state.players.cpu;
  // Staryu's own Slap costs Water -- Hard has no reason to redirect away
  // from an Active that already benefits from this exact type.
  p.active = mk('Staryu');
  var bench = mk('Machop');
  p.bench = [bench, null, null, null, null];
  p.hand = [{ id: 'we2', name: 'Water Energy' }];
  checkTrue('Hard attaches energy', aiTryAttachEnergy(state, 'cpu', 'hard'));
  check('Hard keeps it on the Active when the Active can actually use it', p.active.attachedEnergy, ['Water']);
})();

(function testCpuTakeTurnAcceptsAllDifficulties() {
  ['easy', 'normal', 'hard'].forEach(function (difficulty) {
    var state = createGame(function () { return 0.37; });
    state.activePlayerId = 'cpu';
    var beforeTurn = state.turnCounter;
    cpuTakeTurn(state, difficulty);
    checkTrue('cpuTakeTurn(' + difficulty + ') advances the turn without throwing', state.turnCounter > beforeTurn);
  });
})();

(function testCpuTakeTurnAttacksAfterAProactiveRetreat() {
  var mk = function (name, extra) {
    return Object.assign({ id: 'pr_' + name + Math.random(), name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }, extra || {});
  };
  // 0.9 (not 0.42): Beedrill's Poison Sting flips a coin to also poison the
  // defender (ATTACK_EFFECTS['Beedrill']), and 0.42 lands on heads --
  // poison's own end-of-turn checkup damage stacks with the 40 from the hit
  // itself and exactly finishes off Machop's 50 HP, which is a fine real
  // outcome but not what this test means to isolate. 0.9 is tails, so
  // Machop just takes the 40 and survives to be asserted on below.
  var state = createGame(function () { return 0.9; });
  state.activePlayerId = 'cpu';
  var p = state.players.cpu;
  var op = state.players.player;
  // Same fixture as aiShouldRetreatInsteadOfAttack's own test: Squirtle at
  // 30 damage (10 HP left) is a likely KO for Machop's Low Kick next turn,
  // so Hard retreats to Beedrill instead of attacking with Squirtle. Unlike
  // that isolated unit test, this drives the real cpuTakeTurn end to end --
  // Beedrill already has its own 3 Grass energy attached (untouched by the
  // retreat, which only costs Squirtle's own energy), so it should still
  // attack THIS turn instead of the turn just ending on the retreat alone.
  p.active = mk('Squirtle', { damage: 30, attachedEnergy: ['Water'] });
  op.active = mk('Machop', { attachedEnergy: ['Fighting'] });
  var beedrill = mk('Beedrill', { attachedEnergy: ['Grass', 'Grass', 'Grass'] });
  p.bench = [beedrill, null, null, null, null];
  op.bench = [null, null, null, null, null];
  // Empty both hands -- createGame's real dealt cards (Trainers, PlusPower,
  // more energy...) would add uncontrolled extra actions on top of the
  // exact retreat-then-attack sequence this test means to isolate.
  p.hand = [];
  op.hand = [];
  cpuTakeTurn(state, 'hard');
  check('retreated to Beedrill instead of attacking with the doomed Squirtle', state.players.cpu.active.id, beedrill.id);
  checkTrue('Beedrill also attacked this same turn instead of the turn just ending on the retreat', op.active.damage > 0);
})();

(function testCpuTakeTurnDefaultsToEasy() {
  // Card ids come from a global incrementing counter shared across the
  // whole process (data-decks.js), so two independent createGame() calls
  // never produce identical ids even with the same rng -- strip them
  // before comparing; everything else (names, order, damage, log) should
  // still match exactly for the same seed.
  var stripIds = function (state) { return JSON.stringify(state).replace(/"id":"c\d+"/g, '"id":"X"'); };
  var stateDefault = createGame(function () { return 0.37; });
  stateDefault.activePlayerId = 'cpu';
  var stateExplicitEasy = createGame(function () { return 0.37; });
  stateExplicitEasy.activePlayerId = 'cpu';
  cpuTakeTurn(stateDefault);
  cpuTakeTurn(stateExplicitEasy, 'easy');
  check('cpuTakeTurn(state) with no difficulty behaves identically to explicit easy', stripIds(stateDefault), stripIds(stateExplicitEasy));
})();

(function testScriptedCpuVsCpuStabilityRunHigherDifficulties() {
  ['normal', 'hard'].forEach(function (difficulty) {
    var GAMES = 5;
    var TURN_CAP = 400;
    var completed = 0;
    for (var g = 0; g < GAMES; g++) {
      var seed = g;
      var rng = (function (s) { return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })(seed + 1);
      var state = createGame(rng);
      aiSetupBoard(state, 'player');
      aiSetupBoard(state, 'cpu');
      startMatch(state);
      var turns = 0;
      var winner = null;
      while (!winner && turns < TURN_CAP) {
        cpuTakeTurn(state, difficulty);
        while (state.pendingPrizeChoice) {
          var pid = state.pendingPrizeChoice.playerId;
          var idx = state.players[pid].prizes.findIndex(function (c) { return c; });
          takePrize(state, pid, idx);
        }
        winner = getWinner(state);
        turns++;
      }
      checkTrue(difficulty + ' game ' + g + ' finished within ' + TURN_CAP + ' turns', turns < TURN_CAP);
      if (winner) { completed++; }
    }
    check('all scripted ' + difficulty + ' games reached a winner', completed, GAMES);
  });
})();

(function testScriptedZapVsOvergrowthStability() {
  // Forces the CPU onto Zap! specifically (rather than leaving it to
  // chance) so this new deck's content -- Mewtwo/Kadabra/Jynx/Haunter/
  // Gastly/Drowzee/Abra/Pikachu/Magnemite's attacks, Computer Search,
  // Defender -- all gets exercised through real full games without
  // throwing or hanging, at both difficulties CPU AI actually runs at.
  ['normal', 'hard'].forEach(function (difficulty) {
    var GAMES = 5;
    var TURN_CAP = 400;
    var completed = 0;
    for (var g = 0; g < GAMES; g++) {
      var seed = g;
      var baseRng = (function (s) { return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })(seed + 1);
      // otherDeckKeys for playerDeckKey='overgrowth' is ['blackout', 'zap']
      // (Object.keys insertion order) -- force index 1 on the very first
      // rng() call (createGame's own CPU-deck pick) by wrapping it, then
      // fall through to the real seeded sequence for everything after.
      var firstCall = true;
      var rng = function () {
        if (firstCall) { firstCall = false; return 0.99; }
        return baseRng();
      };
      var state = createGame(rng, 'overgrowth');
      check('cpu is really on zap for this scripted game', state.players.cpu.deckKey, 'zap');
      aiSetupBoard(state, 'player');
      aiSetupBoard(state, 'cpu');
      startMatch(state);
      var turns = 0;
      var winner = null;
      while (!winner && turns < TURN_CAP) {
        cpuTakeTurn(state, difficulty);
        while (state.pendingPrizeChoice) {
          var pid = state.pendingPrizeChoice.playerId;
          var idx = state.players[pid].prizes.findIndex(function (c) { return c; });
          takePrize(state, pid, idx);
        }
        winner = getWinner(state);
        turns++;
      }
      checkTrue('zap-vs-overgrowth ' + difficulty + ' game ' + g + ' finished within ' + TURN_CAP + ' turns', turns < TURN_CAP);
      if (winner) { completed++; }
    }
    check('all scripted zap-vs-overgrowth ' + difficulty + ' games reached a winner', completed, GAMES);
  });
})();

(function testTrainerPlaysQueue() {
  var state = createGame(function () { return 0.42; });
  state.activePlayerId = 'player';
  var p = state.players.player;
  p.hand = [{ id: 'bill1', name: 'Bill' }];
  check('no queue exists before any Trainer is played', state.trainerPlaysQueue, undefined);
  var result = TRAINER_EFFECTS['Bill'](state, 'player', 'bill1');
  checkTrue('Bill plays legally', result.legal);
  check('a successful Trainer play is queued with its name and player', state.trainerPlaysQueue, [{ name: 'Bill', playerId: 'player' }]);

  // An illegal play (wrong active player) must not queue anything.
  state.activePlayerId = 'cpu';
  p.hand = [{ id: 'bill2', name: 'Bill' }];
  var illegal = TRAINER_EFFECTS['Bill'](state, 'player', 'bill2');
  check('an illegal play is correctly rejected', illegal.legal, false);
  check('the queue is untouched by the illegal play', state.trainerPlaysQueue.length, 1);
})();

(function testTranslateTrainerText() {
  var realTrainers = Object.keys(TRAINER_EFFECTS);
  realTrainers.forEach(function (name) {
    checkTrue('translateTrainerText has real text for ' + name, translateTrainerText(name).length > 0);
  });
  check('translateTrainerText returns empty for a non-Trainer/unknown name', translateTrainerText('Not A Real Card'), '');
})();

(function testCreateGameStartsWithDefaultTimeBank() {
  var state = createGame(function () { return 0.42; });
  check('player starts with the default time bank', state.players.player.timeBankMs, DEFAULT_TIME_BANK_MS);
  check('cpu starts with the default time bank', state.players.cpu.timeBankMs, DEFAULT_TIME_BANK_MS);
})();

(function testTickClockDecrementsAndClampsAtZero() {
  var state = createGame(function () { return 0.42; });
  var remaining = tickClock(state, 'player', 1500);
  check('tickClock returns the new remaining time', remaining, DEFAULT_TIME_BANK_MS - 1500);
  check('tickClock only affects the given player', state.players.cpu.timeBankMs, DEFAULT_TIME_BANK_MS);
  tickClock(state, 'player', DEFAULT_TIME_BANK_MS * 10);
  check('tickClock clamps at 0 instead of going negative', state.players.player.timeBankMs, 0);
})();

(function testGetWinnerOnTimeOut() {
  var state = createGame(function () { return 0.42; });
  // Both players need an active Pokémon (see testDeckOutLoss above) so the
  // "no active + empty bench" loss check doesn't fire spuriously here.
  state.players.player.active = { id: 'pa1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.active = { id: 'ca1', name: 'Weedle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  check('getWinner is null with full time banks', getWinner(state), null);
  tickClock(state, 'cpu', DEFAULT_TIME_BANK_MS);
  check('player wins when cpu runs out of time', getWinner(state), 'player');
})();

(function testComputeStageTransform() {
  // Elastic-width canvas: height always drives the scale, the stage's own
  // width grows to fill whatever real width that leaves (clamped to
  // 1920-2560) -- so a normal landscape screen gets no side bars at all.
  // See shell-layout.js for the full rule and why plain contain/cover were
  // each tried and reverted before landing here.

  // Narrower than 16:9: width takes over as the driver, bars appear only
  // top/bottom (never left/right), stage width floors at 1920.
  var narrow = computeStageTransform(960, 1080);
  check('computeStageTransform(960,1080) scale', narrow.scale, 0.5);
  check('computeStageTransform(960,1080) width', narrow.width, 1920);
  check('computeStageTransform(960,1080) x', narrow.x, 0);
  check('computeStageTransform(960,1080) y', narrow.y, 270);

  // Within the elastic range (1920-2560 at this scale): the stage widens to
  // fill the screen exactly, no bars on any side.
  var elastic = computeStageTransform(2200, 1080);
  check('computeStageTransform(2200,1080) scale', elastic.scale, 1);
  check('computeStageTransform(2200,1080) width', elastic.width, 2200);
  check('computeStageTransform(2200,1080) x', elastic.x, 0);
  check('computeStageTransform(2200,1080) y', elastic.y, 0);

  // Past 2560 (ultra-wide): the stage caps out and centers, bars reappear
  // on the sides rather than stretching the composition further apart.
  var ultrawide = computeStageTransform(3840, 1080);
  check('computeStageTransform(3840,1080) scale', ultrawide.scale, 1);
  check('computeStageTransform(3840,1080) width', ultrawide.width, 2560);
  check('computeStageTransform(3840,1080) x', ultrawide.x, 640);
  check('computeStageTransform(3840,1080) y', ultrawide.y, 0);

  // Exact fit (minimum width, height-exact).
  var exact = computeStageTransform(1920, 1080);
  check('computeStageTransform(1920,1080) scale', exact.scale, 1);
  check('computeStageTransform(1920,1080) width', exact.width, 1920);
  check('computeStageTransform(1920,1080) x', exact.x, 0);
  check('computeStageTransform(1920,1080) y', exact.y, 0);
})();

(function testPixelDigits() {
  // Every glyph flattens to the full 8x11 = 88-cell grid, transparent cells
  // included (the renderer always loops over all 88, matching the source
  // reference implementation).
  var one = buildPixelDigitCells('1', 'plata');
  check('buildPixelDigitCells("1") has 88 cells', one.length, 88);

  // Spot-check against the actual ported algorithm's output (not hand-
  // derived -- the flood-fill/outline/highlight logic is intricate enough
  // that re-deriving it by hand would just be a second, less trustworthy
  // implementation). Locks in known-good behavior as a regression guard.
  check('buildPixelDigitCells("1") cell 0 is transparent', one[0].bg, 'transparent');
  check('buildPixelDigitCells("1") cell 3 is the outline color', one[3].bg, '#0a0806');
  check('buildPixelDigitCells("1") cell 11 is the highlight tone', one[11].bg, '#ffffff');
  check('buildPixelDigitCells("1") cell 19 is a mid-ramp tone', one[19].bg, '#cfc6b6');
  check('buildPixelDigitCells("1") cell 75 is the cut/low tone', one[75].bg, '#2a251f');

  // Custom outline color is honored.
  var withOutline = buildPixelDigitCells('1', 'dano', 'rgba(58,8,2,.92)');
  check('buildPixelDigitCells honors a custom outline color', withOutline[3].bg, 'rgba(58,8,2,.92)');

  // Unknown glyph renders nothing, not a crash. 'X'/'x'/'×'/'-'/'+' are real
  // glyphs now (attack-damage modifiers like "30×"/"50-"), so this uses a
  // genuinely unmapped character instead.
  check('buildPixelDigitCells rejects an unmapped character', buildPixelDigitCells('Q', 'oro').length, 0);

  // pixelDigitsHtml wraps one grid per character, all at the requested block
  // size, with a gap proportional to it.
  var html = pixelDigitsHtml('10', 'oro', 2);
  check('pixelDigitsHtml renders one grid per digit', (html.match(/display:grid/g) || []).length, 2);
  check('pixelDigitsHtml renders all cells at the requested block size', (html.match(/width:2px/g) || []).length, 88 * 2);
  check('pixelDigitsHtml sets the gap proportional to block size', html.indexOf('gap:4px') !== -1, true);

  // rampOffset (4th arg) shifts which ramp row an "on" cell reads from,
  // clamped so it never goes out of bounds -- used by the coin icon so its
  // metal starts on a lighter tone, like a numeral's top row would.
  var plain = buildPixelDigitCells('8', 'oro');
  var shifted = buildPixelDigitCells('8', 'oro', null, 1);
  check('rampOffset shifts an on-cell to the previous ramp row', shifted[25].bg, plain[18].bg);
  check('rampOffset clamps at the ramp\'s first row instead of going negative', buildPixelDigitCells('8', 'oro', null, 8)[18].bg, PIXEL_DIGIT_PALETTES.oro.ramp[0]);

  // The currency ($) glyph reuses the same 8x11 cell grid as every digit.
  var dollar = buildPixelDigitCells('$', 'oro');
  check('the $ glyph is a real, known glyph (not the non-digit fallback)', dollar.length, 88);
  var coinHtml = pixelCoinHtml('oro', 3);
  check('pixelCoinHtml renders one 8x11 grid at the requested block size', (coinHtml.match(/width:3px/g) || []).length, 88);

  // Status badges: one real Special Condition per key, letters match the
  // handoff's abbreviations, and the glyph count matches the letter count.
  check('every real Special Condition has a status badge', Object.keys(PIXEL_STATUS_BADGES).sort(), ['Asleep', 'Burned', 'Confused', 'Paralyzed', 'Poisoned'].sort());
  var poisonedHtml = pixelStatusBadgeHtml('Poisoned', 2);
  check('pixelStatusBadgeHtml renders one glyph per letter (PSN = 3)', (poisonedHtml.match(/display:grid/g) || []).length, 3);
  check('pixelStatusBadgeHtml uses the plate gradient colors', poisonedHtml.indexOf('#b47ce4') !== -1 && poisonedHtml.indexOf('#6a2f9e') !== -1, true);
  check('pixelStatusBadgeHtml on an unknown status renders nothing', pixelStatusBadgeHtml('Frozen', 2), '');

  // PlusPower's badge reuses the same plate-rendering path as a status
  // badge (renderPixelBadgePlate) but lives outside PIXEL_STATUS_BADGES,
  // since it isn't a real Special Condition.
  var plusPowerHtml = pixelPlusPowerBadgeHtml(2);
  check('pixelPlusPowerBadgeHtml renders one glyph per character (+10ATK = 6)', (plusPowerHtml.match(/display:grid/g) || []).length, 6);
  check('pixelPlusPowerBadgeHtml uses its own plate gradient colors', plusPowerHtml.indexOf('#ff7ad1') !== -1 && plusPowerHtml.indexOf('#c8258f') !== -1, true);

  var defenderHtml = pixelDefenderBadgeHtml(2);
  check('pixelDefenderBadgeHtml renders one glyph per character (+20DEF = 6)', (defenderHtml.match(/display:grid/g) || []).length, 6);
  check('pixelDefenderBadgeHtml uses its own plate gradient colors', defenderHtml.indexOf('#7ab8ff') !== -1 && defenderHtml.indexOf('#1f5fa8') !== -1, true);

  // The duel timer's colon is a real glyph (not the generic non-digit
  // fallback) so mm:ss renders in the same pixel style as the digits either
  // side of it, matching the coin/collection numbers.
  var colon = buildPixelDigitCells(':', 'oro');
  check('the colon separator is a real, known glyph (not the non-digit fallback)', colon.length, 88);
  var clockHtml = pixelDigitsHtml('9:05', 'oro', 2);
  check('pixelDigitsHtml renders the clock colon as a glyph grid, not plain text', (clockHtml.match(/display:grid/g) || []).length, 4);
})();

(function testCollectionProgress() {
  var fakeCatalog = { base: [{}, {}, {}], jungle: [{}, {}] };
  var progress = collectionProgress({ 'base-1': 2, 'base-2': 1 }, fakeCatalog);
  check('collectionProgress owned counts distinct keys', progress.owned, 2);
  check('collectionProgress total sums every set', progress.total, 5);

  var empty = collectionProgress({}, fakeCatalog);
  check('collectionProgress owned is 0 for an empty collection', empty.owned, 0);

  var real = collectionProgress({}, CARD_CATALOG);
  check('collectionProgress total matches the real catalog (base+jungle+fossil)', real.total, 228);
})();
