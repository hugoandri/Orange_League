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
  check('prize not yet taken until the choice is resolved', state.players.player.prizes.length, 1);
  takePrize(state, 'player', 0);
  check('player took their 1 remaining prize once resolved', state.players.player.prizes.length, 0);
  check('pendingPrizeChoice clears once resolved', state.pendingPrizeChoice, null);
  check('getWinner declares player the winner', getWinner(state), 'player');
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
  check('chosen Pokémon is removed from the bench', state.players.player.bench.length, 1);
  check('remaining bench still has the other Pokémon', state.players.player.bench[0].id, 'p2');
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
  // endTurn's ordering is "flip active player, then the flipped-to player is who
  // must have cards to draw" -- so to simulate cpu being the one handed the turn
  // (and thus forced to draw from their empty deck), activePlayerId must be
  // 'player' (the player finishing their turn) right before endTurn is called.
  state.activePlayerId = 'player';
  state.turnCounter = 3; // not turn 1, so a draw is attempted
  endTurn(state); // endTurn hands the turn to cpu and triggers their draw-phase check internally via getWinner after draw attempt -- see implementation
  check('cpu loses by decking out, player wins', getWinner(state), 'player');
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
  check('poison on the opponent\'s active ticks at the same checkup, not a turn late', state.players.cpu.active.damage, 10);
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
  check('Burned deals 10 damage at checkup', p.active.damage, 10);
  checkTrue('Burned heals on a heads coin flip', p.active.statusConditions.indexOf('Burned') === -1);
})();

(function testAsleepWakesOnHeads() {
  var state = createGame(function () { return 0.0; }); // heads = wakes up
  var p = state.players.player;
  p.active = { id: 'sleep1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: ['Asleep'], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.activePlayerId = 'player';
  endTurn(state);
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
      // this fully-automated simulation just always takes the first one, the
      // same way the CPU's own prizes are auto-taken with no real choice.
      while (state.pendingPrizeChoice) { takePrize(state, state.pendingPrizeChoice.playerId, 0); }
      winner = getWinner(state);
      turns++;
    }
    checkTrue('game ' + g + ' finished within ' + TURN_CAP + ' turns', turns < TURN_CAP);
    if (winner) { completed++; }
  }
  check('all scripted games reached a winner', completed, GAMES);
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

  // Unknown glyph (not 0-9) renders nothing, not a crash.
  check('buildPixelDigitCells rejects a non-digit', buildPixelDigitCells('X', 'oro').length, 0);

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

  // The coin icon reuses the same 8x11 cell grid as every digit.
  var coin = buildPixelDigitCells('moneda', 'oro', null, 1);
  check('the coin glyph is a real, known glyph (not the non-digit fallback)', coin.length, 88);
  var coinHtml = pixelCoinHtml('oro', 3);
  check('pixelCoinHtml renders one 8x11 grid at the requested block size', (coinHtml.match(/width:3px/g) || []).length, 88);

  // Status badges: one real Special Condition per key, letters match the
  // handoff's abbreviations, and the glyph count matches the letter count.
  check('every real Special Condition has a status badge', Object.keys(PIXEL_STATUS_BADGES).sort(), ['Asleep', 'Burned', 'Confused', 'Paralyzed', 'Poisoned'].sort());
  var poisonedHtml = pixelStatusBadgeHtml('Poisoned', 2);
  check('pixelStatusBadgeHtml renders one glyph per letter (PSN = 3)', (poisonedHtml.match(/display:grid/g) || []).length, 3);
  check('pixelStatusBadgeHtml uses the plate gradient colors', poisonedHtml.indexOf('#b47ce4') !== -1 && poisonedHtml.indexOf('#6a2f9e') !== -1, true);
  check('pixelStatusBadgeHtml on an unknown status renders nothing', pixelStatusBadgeHtml('Frozen', 2), '');
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
