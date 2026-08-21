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

// ownerId ('player' | 'cpu' | omitted for neutral/system lines) drives the
// log line's color in the UI -- see ui.js's log rendering.
function logEvent(state, msg, ownerId) { state.log.push({ msg: msg, ownerId: ownerId || null }); }

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

// Shared by startMatch() (turn 1) and endTurn() (turn 2+) -- house rule for
// this era (Base/Jungle/Fossil), unlike later official tournament rules:
// whoever goes first still draws (and can attack, see canAttack) on turn 1.
// Sets state.turnDrewCard so the turn-start log line (logged here for the
// player, or deferred to cpuTakeTurn() for the CPU -- see ai.js) knows
// whether a card was actually drawn, vs. the deck being empty.
function drawForTurnStart(state, playerId) {
  if (state.players[playerId].deck.length === 0) {
    state.deckedOut = playerId;
    state.turnDrewCard = false;
    return;
  }
  drawCard(state, playerId, 1);
  state.turnDrewCard = true;
  if (playerId === 'player') { logEvent(state, 'Tu Turno - Robas 1 Carta', 'player'); }
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
  logEvent(state, translatePlayer(playerId) + ' roba su mano inicial (mulligans: ' + mulligans + ')', playerId);
  return mulligans;
}

// Chess-clock time bank: each player starts with this many ms and only their
// own clock ticks down during their own turn (see ui.js's tickGameClock,
// which calls tickClock() below with real elapsed wall-clock time -- kept
// out of this pure/deterministic engine on purpose, same reasoning as the
// rest of this file never touching Date.now()/setInterval itself).
var DEFAULT_TIME_BANK_MS = 10 * 60 * 1000;

function tickClock(state, ownerId, elapsedMs) {
  var p = state.players[ownerId];
  p.timeBankMs = Math.max(0, p.timeBankMs - elapsedMs);
  return p.timeBankMs;
}

function createGame(rng) {
  rng = rng || Math.random;
  var state = {
    turnCounter: 1,
    activePlayerId: null, // decided by startMatch()'s coin flip, once both sides have set up
    phase: 'setup', // 'setup' until startMatch() is called, then 'playing'
    pendingPrizeChoice: null, // { playerId: 'player', count: N } while the player must pick prize card(s)
    pendingActiveChoice: null, // 'player' while they must pick which Bench Pokémon becomes their new Active
    rng: rng,
    log: [],
    players: {
      player: { deck: shuffle(expandDecklist(DECKLISTS.overgrowth), rng), hand: [], active: null, bench: [], discard: [], prizes: [], hasHadActive: false, energyAttachedThisTurn: false, retreatedThisTurn: false, timeBankMs: DEFAULT_TIME_BANK_MS },
      cpu: { deck: shuffle(expandDecklist(DECKLISTS.blackout), rng), hand: [], active: null, bench: [], discard: [], prizes: [], hasHadActive: false, energyAttachedThisTurn: false, retreatedThisTurn: false, timeBankMs: DEFAULT_TIME_BANK_MS }
    }
  };

  var playerMulligans = dealOpeningHand(state, 'player');
  var cpuMulligans = dealOpeningHand(state, 'cpu');
  if (playerMulligans > 0) { drawCard(state, 'cpu', playerMulligans); }
  if (cpuMulligans > 0) { drawCard(state, 'player', cpuMulligans); }

  ['player', 'cpu'].forEach(function (pid) {
    var p = state.players[pid];
    for (var i = 0; i < 6; i++) { p.prizes.push(p.deck.shift()); }
  });

  return state;
}

// Called once both players have placed their opening Basic Pokémon (Active +
// Bench) during the 'setup' phase. Flips a coin to decide who takes the
// first turn -- heads the player, tails the CPU -- and switches the game
// into 'playing'. Turn 1 begins immediately after for whoever won the flip.
function startMatch(state) {
  state.phase = 'playing';
  state.turnCounter = 1;
  state.activePlayerId = coinFlip(state) === 'H' ? 'player' : 'cpu';
  logEvent(state, (state.activePlayerId === 'player' ? 'Jugador' : 'CPU') + ' empieza la partida', state.activePlayerId);
  drawForTurnStart(state, state.activePlayerId);
}

function makeFreshInstance(id, name, turnCounter) {
  return {
    id: id, name: name, attachedEnergy: [], damage: 0, statusConditions: [],
    turnEnteredCurrentForm: turnCounter, lockedAttacks: [], shield: null,
    missChanceUntilTurn: null, plusPowerAttached: false
  };
}

function canPlayBasic(state, playerId, handId) {
  // During setup, either player may place Basics at any time (there is no
  // "current turn" yet -- both sides set up simultaneously, in real terms).
  // Once the match is playing, only the active player may play a Basic.
  if (state.phase !== 'setup' && state.activePlayerId !== playerId) { return false; }
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
  logEvent(state, translatePlayer(playerId) + ' juega ' + card.name + ' de básico', playerId);
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
  if (state.turnCounter <= 2 && target.turnEnteredCurrentForm <= 1) { return false; }
  return target.turnEnteredCurrentForm < state.turnCounter;
}

function evolve(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var target = findInstance(p, targetInstanceId);
  target.name = card.name;
  target.turnEnteredCurrentForm = state.turnCounter;
  logEvent(state, translatePlayer(playerId) + ' evoluciona a ' + card.name, playerId);
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
  logEvent(state, translatePlayer(playerId) + ' pone ' + translateCardName(card.name) + ' en ' + target.name, playerId);
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

// energyIndices (optional): specific attachedEnergy indices the player chose
// to pay the retreat cost with (see ui.js's energy-discard modal). Falls
// back to the first `cost` many when omitted, e.g. for the AI (ai.js) and
// tests, which don't care which specific energy is discarded.
function retreat(state, playerId, benchInstanceId, energyIndices) {
  var p = state.players[playerId];
  var cost = CARD_STATS[p.active.name].retreatCost;
  var indices = energyIndices || p.active.attachedEnergy.map(function (_, i) { return i; }).slice(0, cost);
  // Splice from the highest index down so earlier removals don't shift the
  // indices of the ones still to come.
  var discardedEnergy = indices.slice().sort(function (a, b) { return b - a; })
    .map(function (i) { return p.active.attachedEnergy.splice(i, 1)[0]; });
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
  logEvent(state, translatePlayer(playerId) + ' se retira a ' + p.active.name, playerId);
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

function translatePlayer(playerId) { return playerId === 'player' ? 'Jugador' : 'CPU'; }

// Display-only Spanish translations for Trainer/Energy card names and
// attack names/effect text. CARD_STATS itself stays untouched (it's the
// verified pokemontcg.io-sourced data) -- these are separate lookups used
// only when rendering UI text or log lines. Pokémon species names are
// never translated (Nintendo keeps them identical in Spanish and English).
var TRAINER_NAME_ES = {
  'Potion': 'Poción', 'Super Potion': 'Súper Poción', 'Switch': 'Cambio',
  'Professor Oak': 'Profesor Oak', 'Gust of Wind': 'Ráfaga de Viento',
  'Energy Removal': 'Retirar Energía', 'Super Energy Removal': 'Súper Retirar Energía',
  'PlusPower': 'Más Potencia', 'Water Energy': 'Energía Agua',
  'Grass Energy': 'Energía Planta', 'Fighting Energy': 'Energía Lucha',
  'Fire Energy': 'Energía Fuego', 'Lightning Energy': 'Energía Rayo',
  'Psychic Energy': 'Energía Psíquica'
};
function translateCardName(name) { return TRAINER_NAME_ES[name] || name; }

var ATTACK_NAME_ES = {
  'Twineedle': 'Doble Aguijón', 'Poison Sting': 'Picadura Venenosa', 'Leech Seed': 'Semilla Drenadora',
  'Leek Slap': 'Golpe de Puerro', 'Pot Smash': 'Golpe Contundente', 'Dragon Rage': 'Furia Dragón',
  'Bubblebeam': 'Rayo Burbuja', 'Jab': 'Golpe Rápido', 'Special Punch': 'Puñetazo Especial',
  'Vine Whip': 'Látigo Cepa', 'Poisonpowder': 'Polvo Veneno', 'Stiffen': 'Endurecer',
  'Karate Chop': 'Golpe Kárate', 'Submission': 'Sumisión', 'Low Kick': 'Patada Baja',
  'Tackle': 'Placaje', 'Flail': 'Coletazo', 'Rock Throw': 'Lanzarrocas', 'Harden': 'Fortaleza',
  'Sand-attack': 'Ataque Arena', 'Bubble': 'Burbuja', 'Withdraw': 'Refugio',
  'Recover': 'Recuperación', 'Star Freeze': 'Congelación Estelar', 'Slap': 'Bofetón', 'Bite': 'Mordisco'
};
function translateAttackName(name) { return ATTACK_NAME_ES[name] || name; }

var ATTACK_TEXT_ES = {
  'Twineedle': 'Lanza 2 monedas. Este ataque hace 30 de daño por cada cara.',
  'Poison Sting': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Envenenado.',
  'Leech Seed': 'A menos que todo el daño de este ataque sea evitado, puedes quitar 1 ficha de daño de este Pokémon.',
  'Leek Slap': 'Lanza una moneda. Si es cruz, este ataque no hace nada. De cualquier forma, no puedes volver a usar este ataque mientras este Pokémon siga en juego.',
  'Bubblebeam': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Poisonpowder': 'El Pokémon Defensor queda Envenenado.',
  'Ivysaur|Poisonpowder': 'El Pokémon Defensor queda Envenenado.',
  'Kakuna|Poisonpowder': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Envenenado.',
  'Stiffen': 'Lanza una moneda. Si es cara, evita todo el daño hecho a este Pokémon durante el próximo turno de tu rival.',
  'Karate Chop': 'Hace 50 de daño menos 10 de daño por cada ficha de daño en este Pokémon.',
  'Submission': 'Este Pokémon se hace 20 de daño a sí mismo.',
  'Flail': 'Hace 10 de daño por cada ficha de daño en este Pokémon.',
  'Harden': 'Durante el próximo turno de tu rival, siempre que se le haga 30 de daño o menos a este Pokémon (tras aplicar Debilidad y Resistencia), evita ese daño.',
  'Sand-attack': 'Si el Pokémon Defensor intenta atacar durante el próximo turno de tu rival, tu rival lanza una moneda. Si es cruz, ese ataque no hace nada.',
  'Bubble': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Withdraw': 'Lanza una moneda. Si es cara, evita todo el daño que se le haga a este Pokémon durante el próximo turno de tu rival.',
  'Recover': 'Descarta 1 carta de Energía Agua adjunta a este Pokémon para usar este ataque. Quita todas las fichas de daño de este Pokémon.',
  'Star Freeze': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.'
};
function translateAttackText(pokemonName, attackName) {
  var key = pokemonName + '|' + attackName;
  if (ATTACK_TEXT_ES.hasOwnProperty(key)) { return ATTACK_TEXT_ES[key]; }
  return ATTACK_TEXT_ES.hasOwnProperty(attackName) ? ATTACK_TEXT_ES[attackName] : '';
}

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
  logEvent(state, instance.name + ' (' + translatePlayer(ownerId) + ') fue noqueado', ownerId);
  if (owner.active && owner.active.id === instance.id) {
    if (ownerId === 'player' && owner.bench.length > 0) {
      // Let the player choose which Bench Pokémon becomes their new Active
      // instead of auto-promoting the first one -- see chooseNewActive(),
      // resolved from the UI's active-choice modal. The CPU still
      // auto-promotes (bench.shift()): no player input to wait on there.
      owner.active = null;
      state.pendingActiveChoice = 'player';
      logEvent(state, 'Jugador debe elegir un nuevo Pokémon Activo', 'player');
    } else {
      owner.active = owner.bench.length > 0 ? owner.bench.shift() : null;
    }
  } else {
    owner.bench = owner.bench.filter(function (b) { return b.id !== instance.id; });
  }
  owner.discard.push({ id: instance.id, name: instance.name });
  instance.attachedEnergy.forEach(function (energyType) { owner.discard.push(discardedEnergyCard(energyType)); });
  var attackerPlayer = state.players[attackerId];
  if (attackerPlayer.prizes.length > 0) {
    if (attackerId === 'player') {
      // The player's own prizes are specific, already-determined cards (set
      // aside face down in createGame) -- let them pick which face-down slot
      // to flip rather than auto-taking the first one. take Prize() resolves
      // this once the UI collects the player's choice.
      if (!state.pendingPrizeChoice || state.pendingPrizeChoice.playerId !== 'player') {
        state.pendingPrizeChoice = { playerId: 'player', count: 0 };
      }
      state.pendingPrizeChoice.count += 1;
      logEvent(state, 'Jugador debe elegir una carta de premio', 'player');
    } else {
      var prize = attackerPlayer.prizes.shift();
      attackerPlayer.hand.push(prize);
      logEvent(state, translatePlayer(attackerId) + ' toma un premio (' + attackerPlayer.prizes.length + ' restantes)', attackerId);
    }
  }
}

// Resolves one of the player's pending prize choices: moves the specific
// face-down prize card at prizeIndex into their hand. Decrements (and
// eventually clears) state.pendingPrizeChoice as choices are resolved.
function takePrize(state, playerId, prizeIndex) {
  var p = state.players[playerId];
  if (prizeIndex < 0 || prizeIndex >= p.prizes.length) { return; }
  var card = p.prizes.splice(prizeIndex, 1)[0];
  p.hand.push(card);
  logEvent(state, translatePlayer(playerId) + ' toma un premio (' + p.prizes.length + ' restantes)', playerId);
  if (state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === playerId) {
    state.pendingPrizeChoice.count -= 1;
    if (state.pendingPrizeChoice.count <= 0) { state.pendingPrizeChoice = null; }
  }
}

// Resolves the player's pending Active choice (see knockOutIfNeeded): moves
// the chosen Bench Pokémon into the now-empty Active slot.
function chooseNewActive(state, playerId, benchInstanceId) {
  var p = state.players[playerId];
  var idx = p.bench.findIndex(function (b) { return b.id === benchInstanceId; });
  if (idx === -1) { return; }
  p.active = p.bench.splice(idx, 1)[0];
  if (state.pendingActiveChoice === playerId) { state.pendingActiveChoice = null; }
  logEvent(state, translatePlayer(playerId) + ' elige a ' + p.active.name + ' como Activo', playerId);
}

function canAttack(state, playerId, attackName) {
  var p = state.players[playerId];
  // House rule for this era (Base/Jungle/Fossil): unlike later official
  // tournament rules, whoever goes first can still attack on turn 1 (see
  // drawForTurnStart -- they draw on turn 1 too).
  if (state.activePlayerId !== playerId || !p.active) { return false; }
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

  logEvent(state, attacker.name + ' usa ' + translateAttackName(attackName), playerId);

  if (attacker.missChanceUntilTurn === state.turnCounter) {
    attacker.missChanceUntilTurn = null;
    if (coinFlip(state) === 'T') {
      logEvent(state, attacker.name + ' falla el ataque (efecto de ' + translateAttackName('Sand-attack') + ')', playerId);
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
      logEvent(state, attacker.name + ' se hace daño por Confusión', playerId);
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
  if (damageDealt > 0) { logEvent(state, defender.name + ' recibe ' + damageDealt + ' de daño', opId); }
  var newStatuses = defender.statusConditions.filter(function (s) { return beforeStatus.indexOf(s) === -1; });
  newStatuses.forEach(function (s) { logEvent(state, defender.name + ' ahora está ' + translateStatus(s), opId); });

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
    if (hasStatus(instance, 'Poisoned')) { instance.damage += 10; logEvent(state, instance.name + ' sufre daño por veneno', playerId); }
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

  // drawForTurnStart logs immediately for the player; the CPU's turn-start
  // line is logged separately, at the top of cpuTakeTurn() (ai.js) instead
  // of here -- endTurn() can flip activePlayerId to 'cpu' well before the
  // CPU actually acts (e.g. right when the player attacks, which ends their
  // turn internally but waits for an explicit "Terminar turno" click before
  // the CPU moves -- see ui.js's afterPlayerAction). Logging it here would
  // leak "Turno del Rival" into the log before the CPU has done anything.
  if (state.turnCounter > 1) { drawForTurnStart(state, state.activePlayerId); }
}

function getWinner(state) {
  if (state.players.player.prizes.length === 0) { return 'player'; }
  if (state.players.cpu.prizes.length === 0) { return 'cpu'; }
  if (state.players.player.hasHadActive && !state.players.player.active && state.players.player.bench.length === 0) { return 'cpu'; }
  if (state.players.cpu.hasHadActive && !state.players.cpu.active && state.players.cpu.bench.length === 0) { return 'player'; }
  if (state.deckedOut === 'player') { return 'cpu'; }
  if (state.deckedOut === 'cpu') { return 'player'; }
  if (state.players.player.timeBankMs <= 0) { return 'cpu'; }
  if (state.players.cpu.timeBankMs <= 0) { return 'player'; }
  return null;
}
