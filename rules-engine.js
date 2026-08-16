// rules-engine.js
var __instanceIdCounter = 0;
function nextId() { __instanceIdCounter++; return 'c' + __instanceIdCounter; }

function shuffle(arr, rng) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function isBasicPokemon(name) {
  var stats = CARD_STATS[name];
  return !!stats && stats.supertype === 'Pokémon' && !stats.evolvesFrom;
}

function expandDecklist(decklist) {
  var out = [];
  decklist.forEach(function (entry) {
    for (var i = 0; i < entry.count; i++) {
      out.push({ id: nextId(), name: entry.name });
    }
  });
  return out;
}

function logEvent(state, msg) { state.log.push(msg); }

function coinFlip(state) {
  var result = state.rng() < 0.5 ? 'H' : 'T';
  logEvent(state, 'Moneda: ' + (result === 'H' ? 'Cara' : 'Sello'));
  return result;
}

function drawCard(state, playerId, n) {
  n = n || 1;
  var p = state.players[playerId];
  for (var i = 0; i < n; i++) {
    if (p.deck.length === 0) { return; } // deck-out is checked by getWinner(), not here
    p.hand.push(p.deck.shift());
  }
}

function dealOpeningHand(state, playerId) {
  var p = state.players[playerId];
  var mulligans = 0;
  while (true) {
    p.deck = shuffle(p.deck.concat(p.hand), state.rng);
    p.hand = [];
    drawCard(state, playerId, 7);
    var hasBasic = p.hand.some(function (c) { return isBasicPokemon(c.name); });
    if (hasBasic) { break; }
    mulligans++;
  }
  logEvent(state, playerId + ' drew opening hand after ' + mulligans + ' mulligan(s)');
  return mulligans;
}

function createGame(rng) {
  rng = rng || Math.random;
  var state = {
    turnCounter: 1,
    activePlayerId: 'player', // placeholder, replaced below once state exists
    rng: rng,
    log: [],
    players: {
      player: { deck: shuffle(expandDecklist(DECKLISTS.overgrowth), rng), hand: [], active: null, bench: [], discard: [], prizes: [], hasHadActive: false },
      cpu: { deck: shuffle(expandDecklist(DECKLISTS.blackout), rng), hand: [], active: null, bench: [], discard: [], prizes: [], hasHadActive: false }
    }
  };
  state.activePlayerId = state.rng() < 0.5 ? 'player' : 'cpu';

  var playerMulligans = dealOpeningHand(state, 'player');
  var cpuMulligans = dealOpeningHand(state, 'cpu');
  if (playerMulligans > 0) { drawCard(state, 'cpu', playerMulligans); }
  if (cpuMulligans > 0) { drawCard(state, 'player', cpuMulligans); }

  ['player', 'cpu'].forEach(function (pid) {
    var p = state.players[pid];
    for (var i = 0; i < 6; i++) { p.prizes.push(p.deck.shift()); }
  });

  logEvent(state, (state.activePlayerId === 'player' ? 'Jugador' : 'CPU') + ' empieza la partida');
  state.players.player.energyAttachedThisTurn = false;
  state.players.player.retreatedThisTurn = false;
  state.players.cpu.energyAttachedThisTurn = false;
  state.players.cpu.retreatedThisTurn = false;
  return state;
}

function makeFreshInstance(id, name, turnCounter) {
  return {
    id: id, name: name, attachedEnergy: [], damage: 0, statusConditions: [],
    turnEnteredCurrentForm: turnCounter, lockedAttacks: [], shield: null,
    missChanceUntilTurn: null, plusPowerAttached: false
  };
}

function canPlayBasic(state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return false; }
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  if (!card || !isBasicPokemon(card.name)) { return false; }
  if (p.active === null) { return true; }
  return p.bench.length < 5;
}

function playBasic(state, playerId, handId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var instance = makeFreshInstance(card.id, card.name, state.turnCounter);
  if (p.active === null) { p.active = instance; p.hasHadActive = true; } else { p.bench.push(instance); }
  logEvent(state, playerId + ' juega ' + card.name + ' de básico');
}

function findInstance(p, instanceId) {
  if (p.active && p.active.id === instanceId) { return p.active; }
  return p.bench.find(function (b) { return b.id === instanceId; }) || null;
}

function canEvolve(state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return false; }
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  var target = findInstance(p, targetInstanceId);
  if (!card || !target) { return false; }
  var stats = CARD_STATS[card.name];
  if (!stats || stats.supertype !== 'Pokémon' || stats.evolvesFrom !== target.name) { return false; }
  if (state.turnCounter === 1) { return false; }
  return target.turnEnteredCurrentForm < state.turnCounter;
}

function evolve(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var target = findInstance(p, targetInstanceId);
  target.name = card.name;
  target.turnEnteredCurrentForm = state.turnCounter;
  logEvent(state, playerId + ' evoluciona a ' + card.name);
}

function canPayCost(instance, cost) {
  var attached = instance.attachedEnergy.slice();
  var colorlessNeeded = 0;
  var needed = {};
  cost.forEach(function (c) {
    if (c === 'Colorless') { colorlessNeeded++; } else { needed[c] = (needed[c] || 0) + 1; }
  });
  for (var type in needed) {
    var have = attached.filter(function (e) { return e === type; }).length;
    if (have < needed[type]) { return false; }
    for (var i = 0; i < needed[type]; i++) { attached.splice(attached.indexOf(type), 1); }
  }
  return attached.length >= colorlessNeeded;
}

var ENERGY_TYPE_BY_CARD_NAME = {
  'Grass Energy': 'Grass', 'Fire Energy': 'Fire', 'Water Energy': 'Water',
  'Lightning Energy': 'Lightning', 'Psychic Energy': 'Psychic', 'Fighting Energy': 'Fighting'
};

function canAttachEnergy(state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return false; }
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  var target = findInstance(p, targetInstanceId);
  if (!card || !target || !ENERGY_TYPE_BY_CARD_NAME[card.name]) { return false; }
  return !p.energyAttachedThisTurn;
}

function attachEnergy(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var target = findInstance(p, targetInstanceId);
  target.attachedEnergy.push(ENERGY_TYPE_BY_CARD_NAME[card.name]);
  p.energyAttachedThisTurn = true;
  logEvent(state, playerId + ' pone ' + card.name + ' en ' + target.name);
}

function canRetreat(state, playerId, benchInstanceId) {
  if (state.activePlayerId !== playerId) { return false; }
  var p = state.players[playerId];
  if (!p.active || p.retreatedThisTurn) { return false; }
  if (p.active.statusConditions.indexOf('Asleep') !== -1) { return false; }
  if (p.active.statusConditions.indexOf('Paralyzed') !== -1) { return false; }
  var bench = p.bench.find(function (b) { return b.id === benchInstanceId; });
  if (!bench) { return false; }
  var cost = CARD_STATS[p.active.name].retreatCost;
  return p.active.attachedEnergy.length >= cost;
}

function retreat(state, playerId, benchInstanceId) {
  var p = state.players[playerId];
  var cost = CARD_STATS[p.active.name].retreatCost;
  var discardedEnergy = p.active.attachedEnergy.splice(0, cost);
  discardedEnergy.forEach(function (energyType) { p.discard.push(discardedEnergyCard(energyType)); });
  var idx = p.bench.findIndex(function (b) { return b.id === benchInstanceId; });
  var incoming = p.bench.splice(idx, 1)[0];
  // Special Conditions (and shield/miss-chance debuffs, which are also
  // active-only mechanics) are removed the instant a Pokémon leaves Active
  // (1998-99 rules) -- only the Active Pokémon can ever carry them.
  p.active.statusConditions = [];
  p.active.shield = null;
  p.active.missChanceUntilTurn = null;
  p.bench.push(p.active);
  p.active = incoming;
  p.retreatedThisTurn = true;
  logEvent(state, playerId + ' se retira a ' + p.active.name);
}

function hasStatus(instance, status) { return instance.statusConditions.indexOf(status) !== -1; }

var EXCLUSIVE_STATUSES = ['Asleep', 'Confused', 'Paralyzed'];

function addStatus(instance, status) {
  if (EXCLUSIVE_STATUSES.indexOf(status) !== -1) {
    instance.statusConditions = instance.statusConditions.filter(function (s) { return EXCLUSIVE_STATUSES.indexOf(s) === -1; });
  }
  if (!hasStatus(instance, status)) { instance.statusConditions.push(status); }
}

var STATUS_LABELS_ES = { Poisoned: 'Envenenado', Burned: 'Quemado', Asleep: 'Dormido', Confused: 'Confundido', Paralyzed: 'Paralizado' };
function translateStatus(status) { return STATUS_LABELS_ES[status] || status; }

function typeHasMatch(list, types) {
  return (list || []).some(function (entry) { return types.indexOf(entry.type) !== -1; });
}

function dealDamage(state, attacker, defender, baseDamage) {
  if (baseDamage <= 0) { return 0; }
  var dmg = baseDamage;
  var defStats = CARD_STATS[defender.name];
  var atkTypes = CARD_STATS[attacker.name].types || [];
  if (typeHasMatch(defStats.weaknesses, atkTypes)) { dmg *= 2; }
  if (typeHasMatch(defStats.resistances, atkTypes)) { dmg = Math.max(0, dmg - 30); }
  if (attacker.plusPowerAttached) { dmg += 10; }
  if (defender.shield) {
    if (defender.shield.untilTurn < state.turnCounter) {
      // The shield's window has already passed (stale) -- clear it even
      // though it didn't block this particular hit.
      defender.shield = null;
    } else if (defender.shield.untilTurn === state.turnCounter) {
      if (defender.shield.type === 'preventAll') {
        dmg = 0;
        defender.shield = null;
      } else if (defender.shield.type === 'thresholdMax') {
        if (dmg <= defender.shield.thresholdMax) {
          dmg = 0;
          defender.shield = null;
        }
        // Otherwise this hit exceeded the threshold and wasn't actually
        // blocked -- keep the shield active so it can still block a
        // later ≤threshold hit during the same window (e.g. Onix's
        // Harden shouldn't be burned by the first hit that overwhelms it).
      }
    }
  }
  defender.damage += dmg;
  return dmg;
}

function opponentOf(playerId) { return playerId === 'player' ? 'cpu' : 'player'; }

// A discarded Energy card (from a Pokémon's attachedEnergy, which only
// stores the energy type as a string) needs to become a real card object
// to land in p.discard -- id just needs to be unique-ish, it doesn't need
// to trace back to a specific real deck card.
function discardedEnergyCard(energyType) {
  return { id: 'discarded-energy-' + Date.now() + '-' + Math.random(), name: energyType + ' Energy' };
}

function knockOutIfNeeded(state, ownerId, instance) {
  var stats = CARD_STATS[instance.name];
  if (instance.damage < stats.hp) { return; }
  var owner = state.players[ownerId];
  var attackerId = opponentOf(ownerId);
  logEvent(state, instance.name + ' (' + ownerId + ') fue noqueado');
  if (owner.active && owner.active.id === instance.id) {
    owner.active = owner.bench.length > 0 ? owner.bench.shift() : null;
  } else {
    owner.bench = owner.bench.filter(function (b) { return b.id !== instance.id; });
  }
  owner.discard.push({ id: instance.id, name: instance.name });
  instance.attachedEnergy.forEach(function (energyType) { owner.discard.push(discardedEnergyCard(energyType)); });
  var attackerPlayer = state.players[attackerId];
  if (attackerPlayer.prizes.length > 0) {
    var prize = attackerPlayer.prizes.shift();
    attackerPlayer.hand.push(prize);
    logEvent(state, attackerId + ' toma un premio (' + attackerPlayer.prizes.length + ' restantes)');
  }
}

function canAttack(state, playerId, attackName) {
  var p = state.players[playerId];
  if (state.activePlayerId !== playerId || state.turnCounter === 1 || !p.active) { return false; }
  if (hasStatus(p.active, 'Asleep') || hasStatus(p.active, 'Paralyzed')) { return false; }
  if (p.active.lockedAttacks.indexOf(attackName) !== -1) { return false; }
  var stats = CARD_STATS[p.active.name];
  var atk = (stats.attacks || []).find(function (a) { return a.name === attackName; });
  if (!atk) { return false; }
  return canPayCost(p.active, atk.cost);
}

function attack(state, playerId, attackName) {
  var p = state.players[playerId];
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var attacker = p.active;
  var stats = CARD_STATS[attacker.name];
  var atkDef = stats.attacks.find(function (a) { return a.name === attackName; });

  logEvent(state, attacker.name + ' usa ' + attackName);

  if (attacker.missChanceUntilTurn === state.turnCounter) {
    attacker.missChanceUntilTurn = null;
    if (coinFlip(state) === 'T') {
      logEvent(state, attacker.name + ' falla el ataque (efecto de Sand-attack)');
      endTurn(state);
      return;
    }
  }

  if (hasStatus(attacker, 'Confused')) {
    if (coinFlip(state) === 'T') {
      // Confusion doesn't block the attempt to attack (unlike Asleep/Paralyzed,
      // which are checked in canAttack) -- it's resolved here: tails means the
      // attack does nothing and the Confused Pokémon hits itself for 30
      // instead, via direct damage (bypassing dealDamage/weakness/resistance,
      // same pattern as Machoke's Submission self-damage). Confusion itself
      // does NOT clear on this flip (unlike Sleep/Paralysis).
      attacker.damage += 30;
      logEvent(state, attacker.name + ' se hace daño por Confusión');
      knockOutIfNeeded(state, playerId, attacker); // a confused Pokémon can KO itself
      endTurn(state);
      return;
    }
  }

  var defender = op.active;
  if (!defender) { endTurn(state); return; }
  var beforeDamage = defender.damage;
  var beforeStatus = defender.statusConditions.slice();
  var effectFn = (typeof ATTACK_EFFECTS !== 'undefined' && ATTACK_EFFECTS[attacker.name]) ? ATTACK_EFFECTS[attacker.name][attackName] : null;
  if (effectFn) {
    effectFn(state, attacker, defender, atkDef, playerId);
  } else {
    var baseDamage = parseInt(atkDef.damage, 10) || 0;
    if (defender) { dealDamage(state, attacker, defender, baseDamage); }
  }

  var damageDealt = defender.damage - beforeDamage;
  if (damageDealt > 0) { logEvent(state, defender.name + ' recibe ' + damageDealt + ' de daño'); }
  var newStatuses = defender.statusConditions.filter(function (s) { return beforeStatus.indexOf(s) === -1; });
  newStatuses.forEach(function (s) { logEvent(state, defender.name + ' ahora está ' + translateStatus(s)); });

  if (defender) { knockOutIfNeeded(state, opId, defender); }
  endTurn(state);
}

function applyCheckupDamage(state, playerId) {
  var p = state.players[playerId];
  // Special Conditions can only ever be carried by the Active Pokémon (see
  // retreat/Switch/Gust of Wind, which strip them the instant a Pokémon
  // leaves Active) -- so poison/burn/sleep checkup effects are scoped to
  // p.active only, never the bench, even defensively.
  if (p.active) {
    var instance = p.active;
    if (hasStatus(instance, 'Poisoned')) { instance.damage += 10; logEvent(state, instance.name + ' sufre daño por veneno'); }
    if (hasStatus(instance, 'Burned')) {
      instance.damage += 10;
      if (coinFlip(state) === 'H') { instance.statusConditions = instance.statusConditions.filter(function (s) { return s !== 'Burned'; }); }
    }
    if (hasStatus(instance, 'Asleep') && coinFlip(state) === 'H') {
      instance.statusConditions = instance.statusConditions.filter(function (s) { return s !== 'Asleep'; });
    }
  }
  // The KO sweep still covers the whole bench (e.g. a future effect could
  // knock out a benched Pokémon directly) even though status-condition
  // damage itself is active-only.
  if (p.active) { knockOutIfNeeded(state, playerId, p.active); }
  p.bench.slice().forEach(function (b) { knockOutIfNeeded(state, playerId, b); });
}

function endTurn(state) {
  var justFinished = state.activePlayerId;
  applyCheckupDamage(state, 'player');
  applyCheckupDamage(state, 'cpu');
  if (state.players[justFinished].active) {
    state.players[justFinished].active.statusConditions = state.players[justFinished].active.statusConditions.filter(function (s) { return s !== 'Paralyzed'; });
  }
  state.players[justFinished].active && (state.players[justFinished].active.plusPowerAttached = false);

  state.turnCounter += 1;
  state.activePlayerId = opponentOf(justFinished);
  state.players[justFinished].energyAttachedThisTurn = false;
  state.players[justFinished].retreatedThisTurn = false;

  if (state.turnCounter > 1) {
    if (state.players[state.activePlayerId].deck.length === 0) {
      state.deckedOut = state.activePlayerId;
    } else {
      drawCard(state, state.activePlayerId, 1);
    }
  }
}

function getWinner(state) {
  if (state.players.player.prizes.length === 0) { return 'player'; }
  if (state.players.cpu.prizes.length === 0) { return 'cpu'; }
  if (state.players.player.hasHadActive && !state.players.player.active && state.players.player.bench.length === 0) { return 'cpu'; }
  if (state.players.cpu.hasHadActive && !state.players.cpu.active && state.players.cpu.bench.length === 0) { return 'player'; }
  if (state.deckedOut === 'player') { return 'cpu'; }
  if (state.deckedOut === 'cpu') { return 'player'; }
  return null;
}
