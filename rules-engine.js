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

// p.prizes stays a fixed 6-slot array for the whole match -- a taken prize
// becomes null in place rather than being spliced out, so remaining prizes
// never shift position (the UI's prize row/modal renders taken slots as a
// gap in the same spot instead of everything sliding left).
function remainingPrizes(p) {
  return p.prizes.filter(function (c) { return c; }).length;
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
// log line's color in the UI -- see ui.js's log rendering. kind (optional):
// a tag for lines that need extra styling beyond just their color -- 'turn-end'
// is the only one today (see endTurn below), rendered bigger/bolder so it
// stands out while scrolling back through the log.
function logEvent(state, msg, ownerId, kind) { state.log.push({ msg: msg, ownerId: ownerId || null, kind: kind || null }); }

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

// playerDeckKey ('overgrowth' or 'blackout', defaults to 'overgrowth' so
// every existing call site/test that only passes rng keeps working
// unchanged): whichever one the player picked (ui.js's Decks screen,
// persisted as econState.activeDeck), the CPU gets the other of the two --
// there are only ever these two real preset decks, so "the other one" is
// unambiguous.
function createGame(rng, playerDeckKey, humanControlled) {
  rng = rng || Math.random;
  playerDeckKey = DECKLISTS[playerDeckKey] ? playerDeckKey : 'overgrowth';
  // The CPU gets a random one of every OTHER real PRECON deck -- Zap!/
  // Brushfire were never sold as an official pair the way the Overgrowth/
  // Blackout starter set was, so there's no fixed pairing to preserve once
  // there are more than 2 real decks (per user's explicit call). Uses the
  // fixed PRECON_DECK_KEYS rather than Object.keys(DECKLISTS) specifically
  // because the player's own custom decks (Fase 4) get registered into
  // that same DECKLISTS object at runtime -- the CPU must never end up
  // playing one of the PLAYER's own personally-built decks.
  var otherDeckKeys = PRECON_DECK_KEYS.filter(function (k) { return k !== playerDeckKey; });
  var cpuDeckKey = otherDeckKeys[Math.floor(rng() * otherDeckKeys.length)];
  var state = {
    turnCounter: 1,
    activePlayerId: null, // decided by startMatch()'s coin flip, once both sides have set up
    phase: 'setup', // 'setup' until startMatch() is called, then 'playing'
    pendingPrizeChoice: null, // { playerId: 'player'|'cpu', count: N } while that side must pick prize card(s) -- either side can populate this once humanControlled makes 'cpu' a real player too
    pendingActiveChoice: null, // 'player'|'cpu' while that side must pick which Bench Pokémon becomes their new Active
    // Whether each side is a real human waiting to be asked, vs. today's
    // local bot ('cpu') which is always auto-resolved. Defaults preserve
    // every existing call site's exact behavior -- only PVP match creation
    // (Task 6) ever passes {player:true, cpu:true}. See knockOutIfNeeded/
    // discardOwnPokemonInPlay below, the only two places this is read.
    humanControlled: humanControlled || { player: true, cpu: false },
    rng: rng,
    log: [],
    players: {
      // deckKey recorded on each side (not just implied by 'player'/'cpu')
      // so ui.js's isHoloInMatch can look up the right guaranteed Rare Holo
      // (Gyarados for Overgrowth, Hitmonchan for Blackout) for whichever
      // deck each side actually ended up with, now that either one is
      // possible on either side.
      player: { deckKey: playerDeckKey, deck: shuffle(expandDecklist(DECKLISTS[playerDeckKey]), rng), hand: [], active: null, bench: [null, null, null, null, null], discard: [], prizes: [], hasHadActive: false, energyAttachedThisTurn: false, retreatedThisTurn: false, timeBankMs: DEFAULT_TIME_BANK_MS },
      cpu: { deckKey: cpuDeckKey, deck: shuffle(expandDecklist(DECKLISTS[cpuDeckKey]), rng), hand: [], active: null, bench: [null, null, null, null, null], discard: [], prizes: [], hasHadActive: false, energyAttachedThisTurn: false, retreatedThisTurn: false, timeBankMs: DEFAULT_TIME_BANK_MS }
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
  // "match-start" gets the same bigger/bolder log styling as "turn-end"
  // (see logHtml, ui.js) -- who actually won the coin flip used to be
  // easy to miss, sitting in the log at the same small size as everything
  // else right as the much more visually loud turn-flash ("TU TURNO"/
  // "TURNO DEL RIVAL") also fires and then quickly fades.
  logEvent(state, (state.activePlayerId === 'player' ? 'Jugador' : 'CPU') + ' empieza la partida', state.activePlayerId, 'match-start');
  drawForTurnStart(state, state.activePlayerId);
}

function makeFreshInstance(id, name, turnCounter) {
  return {
    id: id, name: name, attachedEnergy: [], damage: 0, statusConditions: [],
    turnEnteredCurrentForm: turnCounter, lockedAttacks: [], shield: null,
    missChanceUntilTurn: null, plusPowerAttached: false, destinyBond: null,
    // Nidoking's Toxic: stronger Poison (20/turn instead of 10) -- checked
    // in applyCheckupDamage.
    severePoison: false,
    // Porygon's Conversion 1/2: {type} overriding this instance's real
    // printed Weakness (set on whoever Conversion 1 targeted) or
    // Resistance (set on Porygon itself by Conversion 2) -- checked in
    // dealDamage instead of the static CARD_STATS lookup. Cleared when the
    // Pokémon leaves play (a fresh instance always starts null); real
    // rules have no turn-based expiry for these, they last until replaced.
    weaknessOverride: null,
    resistanceOverride: null,
    // Poliwhirl's Amnesia: locks one CHOSEN opposing attack for a single
    // turn -- {name, untilTurn}, checked in canAttack. Distinct from
    // lockedAttacks (a permanent, self-only lock like Farfetch'd's Leek
    // Slap).
    tempLockedAttack: null,
    // Pidgeotto's Mirror Move: {amount, turn} -- the real damage this
    // instance took from an attack, recorded in dealDamage, so Mirror Move
    // can replay it the following turn.
    lastDamageTaken: null,
    // Charizard's Energy Burn (Pokémon Power): while true, every Energy
    // attached to this instance counts as Fire for canPayCost -- checked
    // there instead of the static attachedEnergy array. Cleared at the end
    // of the OWNER's own turn (endTurn's sweep), matching "for the rest of
    // the turn".
    energyBurnActive: false
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
  return benchCount(p) < 5;
}

// playBasic optionally takes a specific benchIndex (0-4) so the player can
// drag/click a Basic into whichever empty slot they want -- p.bench is a
// fixed 5-slot array (nulls = empty, see benchCount) for the whole match, so
// a chosen slot never gets renumbered by other Pokémon leaving the bench.
// An invalid/already-occupied index (or none at all -- the CPU never
// specifies one) falls back to the first free slot.
function playBasic(state, playerId, handId, benchIndex) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var instance = makeFreshInstance(card.id, card.name, state.turnCounter);
  if (p.active === null) {
    p.active = instance;
    p.hasHadActive = true;
  } else {
    var slot = (typeof benchIndex === 'number' && p.bench[benchIndex] === null) ? benchIndex : p.bench.indexOf(null);
    p.bench[slot] = instance;
  }
  logEvent(state, translatePlayer(playerId) + ' juega ' + card.name + ' de básico', playerId);
}

// Real, non-null Bench Pokémon count -- p.bench.length is always 5 once the
// match starts (empty slots are null in place, not removed), so any "how
// many are actually benched" check needs this instead of .length.
function benchCount(p) {
  return p.bench.filter(function (b) { return b; }).length;
}

function findInstance(p, instanceId) {
  if (p.active && p.active.id === instanceId) { return p.active; }
  return p.bench.find(function (b) { return b && b.id === instanceId; }) || null;
}

// Shared by canEvolve and Pokémon Breeder (card-effects.js): the timing
// rule is identical either way -- Breeder's real ruling is "you can only
// play this card when you would be allowed to evolve that Pokémon anyway",
// it only skips the Stage 1 requirement, not this timing check.
function evolutionTimingAllowed(state, target) {
  if (state.turnCounter <= 2 && target.turnEnteredCurrentForm <= 1) { return false; }
  return target.turnEnteredCurrentForm < state.turnCounter;
}

function canEvolve(state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return false; }
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  var target = findInstance(p, targetInstanceId);
  if (!card || !target) { return false; }
  var stats = CARD_STATS[card.name];
  if (!stats || stats.supertype !== 'Pokémon' || stats.evolvesFrom !== target.name) { return false; }
  return evolutionTimingAllowed(state, target);
}

// Walks CARD_STATS[name].evolvesFrom back to the root Basic name -- used by
// Scoop Up (return the Basic form to hand) and Devolution Spray (devolve
// all the way back to Basic).
function basicFormName(name) {
  var stats = CARD_STATS[name];
  while (stats && stats.evolvesFrom) {
    name = stats.evolvesFrom;
    stats = CARD_STATS[name];
  }
  return name;
}

// Same id/shape convention as discardedEnergyCard below, for the
// intermediate Evolution-stage "cards" Scoop Up/Devolution Spray discard
// on the way back down to a Pokémon's Basic form.
function discardedEvolutionCard(name) {
  return { id: 'discarded-evo-' + Date.now() + '-' + Math.random(), name: name };
}

function evolve(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var target = findInstance(p, targetInstanceId);
  target.name = card.name;
  target.turnEnteredCurrentForm = state.turnCounter;
  // Per user ruling: evolving clears Special Conditions (Paralyzed,
  // Poisoned, Asleep, Confused, Burned) -- unlike retreat/Switch/Gust of
  // Wind, damage and attached energy are untouched here.
  target.statusConditions = [];
  // severePoison (Nidoking's Toxic) rides along with Poisoned itself --
  // clearing statusConditions without this would leave a stale flag that
  // silently upgrades a later, unrelated Poison to 20/turn.
  target.severePoison = false;
  logEvent(state, translatePlayer(playerId) + ' evoluciona a ' + card.name, playerId);
}

function canPayCost(instance, cost) {
  // Charizard's Energy Burn (Pokémon Power): every attached Energy counts
  // as Fire for the rest of the turn -- Charizard's only real attack (Fire
  // Spin) is the sole thing this could ever matter for.
  var attached = instance.energyBurnActive ? instance.attachedEnergy.map(function () { return 'Fire'; }) : instance.attachedEnergy.slice();
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
  'Lightning Energy': 'Lightning', 'Psychic Energy': 'Psychic', 'Fighting Energy': 'Fighting',
  // Provides 2 Colorless from a single physical card (attachEnergy special-
  // cases this name to push 'Colorless' twice) -- this lookup entry alone
  // is just enough to make canAttachEnergy/UI icon lookups treat it as a
  // real, attachable Colorless-providing card.
  'Double Colorless Energy': 'Colorless'
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
  // Double Colorless Energy is one physical card worth 2 Colorless --
  // pushed as two separate attachedEnergy entries since that array is
  // also what pays attack costs and what "discard 1 energy" effects
  // remove from. (Known simplification: a "discard 1 energy" effect could
  // technically peel off just one of these two entries, splitting what's
  // printed as a single indivisible card -- a rare edge case, not worth
  // a bigger data-model change for.)
  if (card.name === 'Double Colorless Energy') {
    target.attachedEnergy.push('Colorless', 'Colorless');
  } else {
    target.attachedEnergy.push(ENERGY_TYPE_BY_CARD_NAME[card.name]);
  }
  p.energyAttachedThisTurn = true;
  logEvent(state, translatePlayer(playerId) + ' pone ' + translateCardName(card.name) + ' en ' + target.name, playerId);
}

function canRetreat(state, playerId, benchInstanceId) {
  if (state.activePlayerId !== playerId) { return false; }
  var p = state.players[playerId];
  if (!p.active || p.retreatedThisTurn) { return false; }
  if (p.active.statusConditions.indexOf('Asleep') !== -1) { return false; }
  if (p.active.statusConditions.indexOf('Paralyzed') !== -1) { return false; }
  // Clefairy Doll: "can't retreat" -- stronger than a free (0-cost) retreat
  // like Diglett/Doduo/Rattata's real retreatCost:0, which stays freely
  // retreatable.
  if (CARD_STATS[p.active.name].cantRetreat) { return false; }
  var bench = p.bench.find(function (b) { return b && b.id === benchInstanceId; });
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
  var idx = p.bench.findIndex(function (b) { return b && b.id === benchInstanceId; });
  var incoming = p.bench[idx];
  // Special Conditions (and shield/miss-chance debuffs, which are also
  // active-only mechanics) are removed the instant a Pokémon leaves Active
  // (1998-99 rules) -- only the Active Pokémon can ever carry them.
  p.active.statusConditions = [];
  p.active.severePoison = false;
  p.active.shield = null;
  p.active.missChanceUntilTurn = null;
  // The retreating Pokémon takes over the exact slot the incoming one is
  // leaving (a straight swap) rather than being pushed to the end -- every
  // other Bench Pokémon's position is untouched.
  p.bench[idx] = p.active;
  p.active = incoming;
  p.retreatedThisTurn = true;
  logEvent(state, translatePlayer(playerId) + ' se retira a ' + p.active.name, playerId);
}

function hasStatus(instance, status) { return instance.statusConditions.indexOf(status) !== -1; }

var EXCLUSIVE_STATUSES = ['Asleep', 'Confused', 'Paralyzed'];

function addStatus(instance, status) {
  // Clefairy Doll: "can't be Asleep, Confused, Paralyzed, or Poisoned" --
  // the only real card in this immune-to-status category.
  if (CARD_STATS[instance.name] && CARD_STATS[instance.name].immuneToStatus) { return; }
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
  'Psychic Energy': 'Energía Psíquica',
  'Computer Search': 'Búsqueda Computarizada', 'Defender': 'Defensor',
  'Lass': 'Señorita', 'Energy Retrieval': 'Recuperar Energía',
  'Clefairy Doll': 'Muñeco de Clefairy', 'Devolution Spray': 'Espray de Involución',
  'Impostor Professor Oak': 'Profesor Oak Impostor', 'Item Finder': 'Buscador de Objetos',
  'Pokémon Breeder': 'Criador Pokémon', 'Pokémon Trader': 'Intercambiador Pokémon',
  'Scoop Up': 'Recogida', 'Full Heal': 'Cura Total', 'Maintenance': 'Mantenimiento',
  'Pokémon Center': 'Centro Pokémon', 'Pokémon Flute': 'Flauta Pokémon',
  'Pokédex': 'Pokédex', 'Revive': 'Revivir'
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
  'Recover': 'Recuperación', 'Star Freeze': 'Congelación Estelar', 'Slap': 'Bofetón', 'Bite': 'Mordisco',
  'Psychic': 'Psíquico', 'Barrier': 'Barrera', 'Super Psy': 'Súper Psíquico',
  'Doubleslap': 'Bofetón Doble', 'Meditate': 'Meditar', 'Hypnosis': 'Hipnosis',
  'Dream Eater': 'Come Sueños', 'Sleeping Gas': 'Gas Somnífero', 'Destiny Bond': 'Lazo del Destino',
  'Pound': 'Golpe', 'Confuse Ray': 'Rayo Confuso', 'Psyshock': 'Psicochoque',
  'Gnaw': 'Mordisqueo', 'Thunder Jolt': 'Chispazo', 'Thunder Wave': 'Onda de Trueno',
  'Selfdestruct': 'Autodestrucción',
  'Lure': 'Señuelo', 'Fire Blast': 'Lanzallamas Explosivo', 'Flamethrower': 'Lanzallamas',
  'Take Down': 'Derribo', 'Slash': 'Corte', 'Flare': 'Llamarada',
  'Horn Hazard': 'Cornada Peligrosa', 'Bind': 'Constricción', 'Scratch': 'Arañazo', 'Ember': 'Ascuas',
  'Hydro Pump': 'Hidrobomba', 'Scrunch': 'Encogerse', 'Double-edge': 'Doble Filo', 'Fire Spin': 'Giro Fuego',
  'Sing': 'Canto', 'Metronome': 'Metrónomo', 'Seismic Toss': 'Tiro Sísmico', 'Thrash': 'Golpes Furia',
  'Toxic': 'Tóxico', 'Water Gun': 'Pistola Agua', 'Whirlpool': 'Remolino', 'Agility': 'Agilidad',
  'Thunder': 'Trueno', 'Solarbeam': 'Rayo Solar', 'Thunderbolt': 'Rayo', 'Slam': 'Golpazo',
  'Hyper Beam': 'Hiperrayo', 'Earthquake': 'Terremoto', 'Thundershock': 'Impactrueno', 'Thunderpunch': 'Puño Trueno',
  'Electric Shock': 'Descarga Eléctrica', 'Whirlwind': 'Torbellino', 'Mirror Move': 'Espejo',
  'Aurora Beam': 'Rayo Aurora', 'Ice Beam': 'Rayo Hielo', 'Fire Punch': 'Puño Fuego',
  'Double Kick': 'Doble Patada', 'Horn Drill': 'Taladro', 'Amnesia': 'Amnesia',
  'Conversion 1': 'Conversión 1', 'Conversion 2': 'Conversión 2', 'Super Fang': 'Supercolmillo',
  'Headbutt': 'Cabezazo', 'String Shot': 'Lanza Hilo', 'Dig': 'Cavar', 'Mud Slap': 'Bofetón Lodo',
  'Fury Attack': 'Ataque Furia', 'Foul Gas': 'Gas Fétido', 'Stun Spore': 'Paralizador',
  'Smash Kick': 'Patada Certera', 'Flame Tail': 'Cola Llama'
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
  'Star Freeze': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Kadabra|Recover': 'Descarta 1 carta de Energía Psíquica adjunta a este Pokémon para usar este ataque. Quita todas las fichas de daño de este Pokémon.',
  'Psychic': 'Hace 10 de daño más 10 de daño adicional por cada carta de Energía adjunta al Pokémon Defensor.',
  'Barrier': 'Descarta 1 carta de Energía Psíquica adjunta a este Pokémon para usar este ataque. Durante el próximo turno de tu rival, evita todos los efectos de los ataques, incluido el daño, hechos a este Pokémon.',
  'Doubleslap': 'Lanza 2 monedas. Este ataque hace 10 de daño por cada cara.',
  'Meditate': 'Hace 20 de daño más 10 de daño adicional por cada ficha de daño en el Pokémon Defensor.',
  'Hypnosis': 'El Pokémon Defensor queda Dormido.',
  'Dream Eater': 'No puedes usar este ataque a menos que el Pokémon Defensor esté Dormido.',
  'Sleeping Gas': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Dormido.',
  'Destiny Bond': 'Descarta 1 carta de Energía Psíquica adjunta a este Pokémon para usar este ataque. Si un Pokémon noquea a este Pokémon durante el próximo turno de tu rival, ese Pokémon también queda noqueado.',
  'Confuse Ray': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Confundido.',
  'Psyshock': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Thunder Jolt': 'Lanza una moneda. Si es cruz, este Pokémon se hace 10 de daño a sí mismo.',
  'Thunder Wave': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Selfdestruct': 'Hace 10 de daño a cada Pokémon de la Banca de ambos jugadores (no se aplica Debilidad ni Resistencia a la Banca). Este Pokémon se hace 40 de daño a sí mismo.',
  'Lure': 'Si tu rival tiene algún Pokémon en la Banca, elige 1 e intercámbialo con el Pokémon Defensor.',
  'Fire Blast': 'Descarta 1 carta de Energía Fuego adjunta a Ninetales para usar este ataque.',
  'Flamethrower': 'Descarta 1 carta de Energía Fuego adjunta a este Pokémon para usar este ataque.',
  'Take Down': 'Este Pokémon se hace 30 de daño a sí mismo.',
  'Horn Hazard': 'Lanza una moneda. Si es cruz, este ataque no hace nada.',
  'Bind': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Ember': 'Descarta 1 carta de Energía Fuego adjunta a este Pokémon para usar este ataque.',
  'Scrunch': 'Lanza una moneda. Si es cara, evita todo el daño que se le haga a este Pokémon durante el próximo turno de tu rival.',
  'Double-edge': 'Este Pokémon se hace 80 de daño a sí mismo.',
  'Fire Spin': 'Descarta 2 cartas de Energía adjuntas a este Pokémon para usar este ataque.',
  'Sing': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Dormido.',
  'Metronome': 'Elige 1 de los ataques del Pokémon Defensor. Metrónomo copia ese ataque, excepto sus costos de Energía y cualquier otro requisito para usarlo, como descartar cartas de Energía.',
  'Thrash': 'Lanza una moneda. Si es cara, este ataque hace 30 de daño más 10 de daño adicional; si es cruz, este ataque hace 30 de daño y este Pokémon se hace 10 de daño a sí mismo.',
  'Toxic': 'El Pokémon Defensor queda Envenenado. A partir de ahora recibe 20 de daño por veneno en lugar de 10 después de cada turno (aunque ya estuviera Envenenado).',
  'Whirlpool': 'Si el Pokémon Defensor tiene alguna carta de Energía adjunta, elige 1 y descártala.',
  'Agility': 'Lanza una moneda. Si es cara, durante el próximo turno de tu rival, evita todos los efectos de los ataques, incluido el daño, hechos a este Pokémon.',
  'Thunder': 'Lanza una moneda. Si es cruz, este Pokémon se hace 30 de daño a sí mismo.',
  'Thunderbolt': 'Descarta todas las cartas de Energía adjuntas a este Pokémon para usar este ataque.',
  'Slam': 'Lanza 2 monedas. Este ataque hace 30 de daño por cada cara.',
  'Hyper Beam': 'Si el Pokémon Defensor tiene alguna carta de Energía adjunta, elige 1 y descártala.',
  'Earthquake': 'Hace 10 de daño a cada uno de tus propios Pokémon de la Banca (no se aplica Debilidad ni Resistencia a la Banca).',
  'Thundershock': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Thunderpunch': 'Lanza una moneda. Si es cara, este ataque hace 30 de daño más 10 de daño adicional; si es cruz, este ataque hace 30 de daño y este Pokémon se hace 10 de daño a sí mismo.',
  'Electric Shock': 'Lanza una moneda. Si es cruz, este Pokémon se hace 10 de daño a sí mismo.',
  'Whirlwind': 'Si tu rival tiene algún Pokémon en la Banca, tu rival elige 1 y lo intercambia con el Pokémon Defensor. (El daño se aplica antes del cambio.)',
  'Mirror Move': 'Si a este Pokémon lo atacaron el turno anterior, aplica el resultado final de ese ataque sobre el Pokémon Defensor.',
  'Ice Beam': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Double Kick': 'Lanza 2 monedas. Este ataque hace 30 de daño por cada cara.',
  'Amnesia': 'Elige 1 de los ataques del Pokémon Defensor. Ese Pokémon no podrá usar ese ataque durante el próximo turno de tu rival.',
  'Conversion 1': 'Si el Pokémon Defensor tiene Debilidad, puedes cambiarla a un tipo de tu elección (que no sea Incoloro).',
  'Conversion 2': 'Cambia la Resistencia de este Pokémon a un tipo de tu elección (que no sea Incoloro).',
  'Super Fang': 'Hace al Pokémon Defensor un daño igual a la mitad de su HP restante, redondeado hacia arriba a la decena más cercana.',
  'String Shot': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Fury Attack': 'Lanza 2 monedas. Este ataque hace 10 de daño por cada cara.',
  'Foul Gas': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Envenenado. Si es cruz, el Pokémon Defensor queda Confundido.',
  'Stun Spore': 'Lanza una moneda. Si es cara, el Pokémon Defensor queda Paralizado.',
  'Hydro Pump': 'Hace 40 de daño más 10 de daño adicional por cada Energía Agua adjunta a este Pokémon que no se haya usado para pagar el costo del ataque. La Energía Agua extra después de la 2ª no cuenta.',
  'Poliwag|Water Gun': 'Hace 10 de daño más 10 de daño adicional por cada Energía Agua adjunta a este Pokémon que no se haya usado para pagar el costo del ataque. No puedes sumar más de 20 de daño de esta forma.',
  'Poliwrath|Water Gun': 'Hace 30 de daño más 10 de daño adicional por cada Energía Agua adjunta a este Pokémon que no se haya usado para pagar el costo del ataque. La Energía Agua extra después de la 2ª no cuenta.'
};
function translateAttackText(pokemonName, attackName) {
  var key = pokemonName + '|' + attackName;
  if (ATTACK_TEXT_ES.hasOwnProperty(key)) { return ATTACK_TEXT_ES[key]; }
  return ATTACK_TEXT_ES.hasOwnProperty(attackName) ? ATTACK_TEXT_ES[attackName] : '';
}

// Spanish translations of the 9 real Trainer cards' printed effect text
// (CARD_STATS[name].text has the verbatim English from pokemontcg.io) --
// shown in the card zoom modal (#cardModal, see ui.js's openCardModal),
// since the actual printed rules text on a real Trainer card's scanned
// art is too small to read even zoomed in, unlike a Pokémon's attack
// name/damage which prints large enough on the card itself.
var TRAINER_TEXT_ES = {
  'Bill': 'Roba 2 cartas.',
  'Potion': 'Quita hasta 2 fichas de daño de uno de tus Pokémon.',
  'Super Potion': 'Descarta 1 carta de Energía adjunta a uno de tus Pokémon para quitar hasta 4 fichas de daño de ese Pokémon.',
  'Switch': 'Cambia 1 de tus Pokémon de la Banca con tu Pokémon Activo.',
  'Professor Oak': 'Descarta tu mano y luego roba 7 cartas.',
  'Gust of Wind': 'Elige 1 Pokémon de la Banca de tu rival e intercámbialo con su Pokémon Activo.',
  'Energy Removal': 'Elige 1 carta de Energía adjunta a un Pokémon de tu rival y descártala.',
  'Super Energy Removal': 'Descarta 1 carta de Energía adjunta a uno de tus Pokémon para elegir 1 Pokémon de tu rival y hasta 2 cartas de Energía adjuntas a él. Descarta esas cartas de Energía.',
  'PlusPower': 'Adjunta Más Potencia a tu Pokémon Activo. Al final de tu turno, descarta Más Potencia. Si el ataque de este Pokémon hace daño al Pokémon Defensor (tras aplicar Debilidad y Resistencia), el ataque hace 10 de daño más al Pokémon Defensor.',
  'Computer Search': 'Descarta 2 cartas de tu mano. (Si no puedes descartar 2 cartas, no puedes jugar esta carta.) Busca en tu mazo la carta que quieras y ponla en tu mano. Luego, baraja tu mazo.',
  'Defender': 'Adjunta Defensor a uno de tus Pokémon. Al final del próximo turno de tu rival, descarta Defensor. El daño que reciba ese Pokémon por ataques se reduce en 20 (tras aplicar Debilidad y Resistencia).',
  'Lass': 'Tú y tu rival se muestran las manos, luego mezclan todas las cartas de Entrenador de sus manos en sus mazos.',
  'Energy Retrieval': 'Cambia 1 de las otras cartas de tu mano por hasta 2 cartas de Energía básica de tu descarte.',
  'Clefairy Doll': 'Juega Muñeco de Clefairy como si fuera un Pokémon Básico. En juego, cuenta como Pokémon (no como Entrenador). No tiene ataques, no puede retirarse y no puede estar Dormido, Confundido, Paralizado ni Envenenado. Si es noqueado, tu rival no roba una carta de Premio. En cualquier momento de tu turno, antes de atacar, puedes descartarlo.',
  'Devolution Spray': 'Elige 1 de tus Pokémon en juego. Descarta todas las cartas de Evolución adjuntas a ese Pokémon, devolviéndolo a su forma Básica. Ya no está Dormido, Confundido, Paralizado, Envenenado ni nada que sea resultado de un ataque (como si hubiera evolucionado).',
  'Impostor Professor Oak': 'Tu rival mezcla su mano en su mazo y luego roba 7 cartas.',
  'Item Finder': 'Descarta 2 de las otras cartas de tu mano para poner una carta de Entrenador de tu descarte en tu mano.',
  'Pokémon Breeder': 'Pon una carta de Evolución de 2ª Etapa de tu mano sobre el Pokémon Básico correspondiente, saltándote la 1ª Etapa. Solo puedes jugar esta carta cuando ya podrías evolucionar a ese Pokémon de todas formas.',
  'Pokémon Trader': 'Cambia 1 carta de Pokémon Básico o de Evolución de tu mano por 1 carta de Pokémon Básico o de Evolución de tu mazo. Luego, baraja tu mazo.',
  'Scoop Up': 'Elige 1 de tus Pokémon en juego y devuelve su carta de Pokémon Básico a tu mano. (Descarta todas las cartas adjuntas a esa carta.)',
  'Full Heal': 'Tu Pokémon Activo ya no está Dormido, Confundido, Paralizado ni Envenenado.',
  'Maintenance': 'Mezcla 2 de las otras cartas de tu mano en tu mazo para robar 1 carta.',
  'Pokémon Center': 'Quita todas las fichas de daño de tus Pokémon que tengan daño y luego descarta toda la Energía adjunta a esos Pokémon.',
  'Pokémon Flute': 'Elige 1 carta de Pokémon Básico del descarte de tu rival y ponla en su Banca. (No puedes jugar esta carta si la Banca rival está llena.)',
  'Pokédex': 'Mira hasta 5 cartas de la parte superior de tu mazo y reordénalas como quieras.',
  'Revive': 'Pon 1 carta de Pokémon Básico de tu descarte en tu Banca. Ponle fichas de daño equivalentes a la mitad de sus PS (redondeado hacia abajo a la decena más cercana). (No puedes jugar esta carta si tu Banca está llena.)'
};
function translateTrainerText(name) { return TRAINER_TEXT_ES[name] || ''; }

function typeHasMatch(list, types) {
  return (list || []).some(function (entry) { return types.indexOf(entry.type) !== -1; });
}

function dealDamage(state, attacker, defender, baseDamage) {
  if (baseDamage <= 0) { return 0; }
  var dmg = baseDamage;
  var defStats = CARD_STATS[defender.name];
  var atkTypes = CARD_STATS[attacker.name].types || [];
  // Porygon's Conversion 1/2 can override either side's printed Weakness/
  // Resistance with a chosen type -- checked first, falling back to the
  // real card data when no override is set.
  var weaknesses = defender.weaknessOverride ? [defender.weaknessOverride] : defStats.weaknesses;
  var resistances = defender.resistanceOverride ? [defender.resistanceOverride] : defStats.resistances;
  if (typeHasMatch(weaknesses, atkTypes)) { dmg *= 2; }
  if (typeHasMatch(resistances, atkTypes)) { dmg = Math.max(0, dmg - 30); }
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
      } else if (defender.shield.type === 'reduceFlat') {
        // Defender (Trainer): flat reduction applies to every hit for the
        // rest of its window, not just the first one -- unlike preventAll,
        // this never consumes/clears itself early.
        dmg = Math.max(0, dmg - defender.shield.reduceAmount);
      }
    }
  }
  defender.damage += dmg;
  // Pidgeotto's Mirror Move needs "the final result of the attack this
  // Pokémon took last turn" -- recorded here (after Weakness/Resistance/
  // shields are already applied, i.e. the real final number), regardless
  // of which Pokémon it is, since it's cheap to always track and only
  // Pidgeotto/Pidgey ever read it back.
  defender.lastDamageTaken = { amount: dmg, turn: state.turnCounter };
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
    if (state.humanControlled[ownerId] && benchCount(owner) > 0) {
      // Let the player choose which Bench Pokémon becomes their new Active
      // instead of auto-promoting the first one -- see chooseNewActive(),
      // resolved from the UI's active-choice modal. The CPU still
      // auto-promotes (first non-null slot): no player input to wait on there.
      owner.active = null;
      state.pendingActiveChoice = ownerId;
      logEvent(state, 'Jugador debe elegir un nuevo Pokémon Activo', 'player');
    } else {
      var promoteIdx = owner.bench.findIndex(function (b) { return b; });
      owner.active = promoteIdx !== -1 ? owner.bench[promoteIdx] : null;
      if (promoteIdx !== -1) { owner.bench[promoteIdx] = null; }
    }
  } else {
    // The KO'd Bench Pokémon's slot goes null in place -- every other Bench
    // Pokémon (and the player-facing gap where this one used to sit) keeps
    // its exact position, same reasoning as the fixed-slot prizes array.
    var koIdx = owner.bench.findIndex(function (b) { return b && b.id === instance.id; });
    if (koIdx !== -1) { owner.bench[koIdx] = null; }
  }
  owner.discard.push({ id: instance.id, name: instance.name });
  instance.attachedEnergy.forEach(function (energyType) { owner.discard.push(discardedEnergyCard(energyType)); });
  var attackerPlayer = state.players[attackerId];
  // Clefairy Doll: "doesn't count as a Knocked Out Pokémon" -- everything
  // else above and below (leaving play, discard, Destiny Bond) still
  // happens normally, only the opponent's prize is skipped.
  if (!stats.noKnockOutPrize && remainingPrizes(attackerPlayer) > 0) {
    if (state.humanControlled[attackerId]) {
      // The player's own prizes are specific, already-determined cards (set
      // aside face down in createGame) -- let them pick which face-down slot
      // to flip rather than auto-taking the first one. take Prize() resolves
      // this once the UI collects the player's choice.
      if (!state.pendingPrizeChoice || state.pendingPrizeChoice.playerId !== attackerId) {
        state.pendingPrizeChoice = { playerId: attackerId, count: 0 };
      }
      state.pendingPrizeChoice.count += 1;
      logEvent(state, 'Jugador debe elegir una carta de premio', 'player');
    } else {
      var prizeIndex = attackerPlayer.prizes.findIndex(function (c) { return c; });
      var prize = attackerPlayer.prizes[prizeIndex];
      attackerPlayer.prizes[prizeIndex] = null;
      attackerPlayer.hand.push(prize);
      logEvent(state, translatePlayer(attackerId) + ' toma un premio (' + remainingPrizes(attackerPlayer) + ' restantes)', attackerId);
    }
  }

  // Destiny Bond (Gastly): triggers only if this KO lands during the exact
  // window promised when the attack was used ("your opponent's next turn"
  // -- see ATTACK_EFFECTS['Gastly']['Destiny Bond']) AND it's genuinely
  // that opponent's turn happening right now. That second check is what
  // excludes e.g. this same Pokémon dying to its own end-of-turn Poison
  // checkup -- that runs during ITS OWN side's turn-ending, not the
  // opponent's, even though turnCounter could still match the window.
  if (instance.destinyBond && instance.destinyBond.untilTurn === state.turnCounter && state.activePlayerId === attackerId) {
    var revengeTarget = attackerPlayer.active;
    instance.destinyBond = null;
    if (revengeTarget) {
      logEvent(state, instance.name + ' se lleva a ' + revengeTarget.name + ' con Lazo del Destino', ownerId);
      // This is a forced KO regardless of revengeTarget's own remaining HP
      // (real card: "Knock Out that Pokémon", no damage math involved) --
      // knockOutIfNeeded's own damage>=hp guard expects a real lethal
      // state, so set that directly rather than trying to special-case
      // the guard itself.
      revengeTarget.damage = Math.max(revengeTarget.damage, CARD_STATS[revengeTarget.name].hp);
      knockOutIfNeeded(state, attackerId, revengeTarget);
    }
  }
}

// Clefairy Doll: "At any time during your turn before your attack, you may
// discard Clefairy Doll" -- gated on CARD_STATS[...].voluntaryDiscard so
// this stays generic for any future card with the same "give it up at
// will" mechanic. Not a Knock Out (no prize either way, same as
// noKnockOutPrize would give it anyway) -- just leaves play like a real
// voluntary discard, replacing the Active from Bench the same way
// knockOutIfNeeded's player-choice/CPU-auto-promote split already does.
function discardOwnPokemonInPlay(state, playerId, instanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede usar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, instanceId);
  if (!target || !CARD_STATS[target.name].voluntaryDiscard) { return { legal: false, reason: 'no puedes descartar ese Pokémon' }; }
  target.attachedEnergy.forEach(function (t) { p.discard.push(discardedEnergyCard(t)); });
  var isActive = p.active && p.active.id === target.id;
  if (isActive) {
    p.active = null;
    if (state.humanControlled[playerId] && benchCount(p) > 0) {
      state.pendingActiveChoice = playerId;
      logEvent(state, 'Jugador debe elegir un nuevo Pokémon Activo', 'player');
    } else if (benchCount(p) > 0) {
      var promoteIdx = p.bench.findIndex(function (b) { return b; });
      p.active = p.bench[promoteIdx];
      p.bench[promoteIdx] = null;
    }
  } else {
    var bIdx = p.bench.findIndex(function (b) { return b && b.id === target.id; });
    if (bIdx !== -1) { p.bench[bIdx] = null; }
  }
  p.discard.push({ id: target.id, name: target.name });
  logEvent(state, translatePlayer(playerId) + ' descarta ' + translateCardName(target.name), playerId);
  return { legal: true };
}

// Resolves one of the player's pending prize choices: moves the specific
// face-down prize card at prizeIndex into their hand. Decrements (and
// eventually clears) state.pendingPrizeChoice as choices are resolved.
function takePrize(state, playerId, prizeIndex) {
  var p = state.players[playerId];
  if (prizeIndex < 0 || prizeIndex >= p.prizes.length || !p.prizes[prizeIndex]) { return; }
  var card = p.prizes[prizeIndex];
  p.prizes[prizeIndex] = null;
  p.hand.push(card);
  logEvent(state, translatePlayer(playerId) + ' toma un premio (' + remainingPrizes(p) + ' restantes)', playerId);
  if (state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === playerId) {
    state.pendingPrizeChoice.count -= 1;
    if (state.pendingPrizeChoice.count <= 0) { state.pendingPrizeChoice = null; }
  }
}

// Resolves the player's pending Active choice (see knockOutIfNeeded): moves
// the chosen Bench Pokémon into the now-empty Active slot.
function chooseNewActive(state, playerId, benchInstanceId) {
  var p = state.players[playerId];
  var idx = p.bench.findIndex(function (b) { return b && b.id === benchInstanceId; });
  if (idx === -1) { return; }
  p.active = p.bench[idx];
  p.bench[idx] = null;
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
  if (p.active.tempLockedAttack && p.active.tempLockedAttack.name === attackName) { return false; }
  var stats = CARD_STATS[p.active.name];
  var atk = (stats.attacks || []).find(function (a) { return a.name === attackName; });
  if (!atk) { return false; }
  // Dream Eater (Haunter): "You can't use this attack unless the Defending
  // Pokémon is Asleep" -- the one real Base Set attack whose legality
  // depends on the OPPONENT's status rather than the attacker's own.
  if (attackName === 'Dream Eater') {
    var opActive = state.players[opponentOf(playerId)].active;
    if (!opActive || !hasStatus(opActive, 'Asleep')) { return false; }
  }
  return canPayCost(p.active, atk.cost);
}

// Returns the list of the player's own Pokémon (Active or Bench) that
// currently have a Pokémon Power the player can actually activate right
// now -- i.e. excludes passive-only powers (Machamp's Strikes Back, which
// has no button and never appears here) and anything blocked by the
// Active's own Special Conditions. Drives ui.js's HABILIDAD button: it's
// disabled whenever this list is empty.
function usablePokemonPowers(state, playerId) {
  var p = state.players[playerId];
  if (state.activePlayerId !== playerId) { return []; }
  return allInstances(p).filter(function (instance) {
    var power = CARD_STATS[instance.name] && CARD_STATS[instance.name].pokemonPower;
    if (!power || power.name === 'Strikes Back') { return false; }
    if (typeof POKEMON_POWER_EFFECTS === 'undefined' || !POKEMON_POWER_EFFECTS[power.name]) { return false; }
    if (instance === p.active && (hasStatus(instance, 'Asleep') || hasStatus(instance, 'Confused') || hasStatus(instance, 'Paralyzed'))) { return false; }
    return true;
  });
}

// params carries whatever extra targeting info a given Power needs (see
// each POKEMON_POWER_EFFECTS entry, card-effects.js) -- e.g.
// {fromInstanceId, toInstanceId} for Damage Swap/Energy Trans,
// {handEnergyId, targetInstanceId} for Rain Dance, {chosenType,
// targetInstanceId} for Buzzap, or nothing at all for Energy Burn.
function usePokemonPower(state, playerId, ownerInstanceId, params) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede usar' }; }
  var p = state.players[playerId];
  var owner = findInstance(p, ownerInstanceId);
  if (!owner) { return { legal: false, reason: 'ese Pokémon no es tuyo' }; }
  var power = CARD_STATS[owner.name] && CARD_STATS[owner.name].pokemonPower;
  if (!power) { return { legal: false, reason: 'ese Pokémon no tiene Poder Pokémon' }; }
  // Powers are blocked by Special Conditions only when the owner is
  // actually the Active Pokémon -- Bench Pokémon never carry Special
  // Conditions in this engine in the first place (see retreat's own
  // comment), so the check only ever matters for p.active.
  if (owner === p.active && (hasStatus(owner, 'Asleep') || hasStatus(owner, 'Confused') || hasStatus(owner, 'Paralyzed'))) {
    return { legal: false, reason: 'no se puede usar: Dormido, Confundido o Paralizado' };
  }
  var effectFn = (typeof POKEMON_POWER_EFFECTS !== 'undefined') ? POKEMON_POWER_EFFECTS[power.name] : null;
  if (!effectFn) { return { legal: false, reason: 'este Poder aún no está implementado' }; }
  return effectFn(state, playerId, owner, params || {});
}

// targetInstanceId (optional): only meaningful for Ninetales' Lure, the
// one real Base Set attack that (like a Trainer) needs the player to
// choose a specific opposing Bench Pokémon -- every other attack always
// just hits the opponent's current Active, no target needed.
function attack(state, playerId, attackName, targetInstanceId) {
  var p = state.players[playerId];
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var attacker = p.active;
  var stats = CARD_STATS[attacker.name];
  var atkDef = stats.attacks.find(function (a) { return a.name === attackName; });

  // endTurn() itself no longer runs the Pokémon Checkup (see its own
  // comment) -- the CPU's own turn genuinely, immediately ends the instant
  // it attacks (no click involved), so checkup applies right here, same as
  // always. The player's attack also ends their turn engine-side right
  // away (real rules -- attacking is your last action), but the *visible*
  // effects of that stay held back until they actually click "Terminar
  // turno" (ui.js's runCpuTurn calls applyEndOfTurnCheckup itself, right at
  // the click) -- otherwise the player would see status damage resolve on
  // either side the instant they attacked, before they'd done anything to
  // actually hand the turn over.
  function endThisTurn() {
    endTurn(state);
    if (playerId === 'cpu') { applyEndOfTurnCheckup(state); }
  }

  logEvent(state, attacker.name + ' usa ' + translateAttackName(attackName), playerId);

  if (attacker.missChanceUntilTurn === state.turnCounter) {
    attacker.missChanceUntilTurn = null;
    if (coinFlip(state) === 'T') {
      logEvent(state, attacker.name + ' falla el ataque (efecto de ' + translateAttackName('Sand-attack') + ')', playerId);
      endThisTurn();
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
      endThisTurn();
      return;
    }
  }

  var defender = op.active;
  if (!defender) { endThisTurn(); return; }
  var beforeDamage = defender.damage;
  var beforeStatus = defender.statusConditions.slice();
  var effectFn = (typeof ATTACK_EFFECTS !== 'undefined' && ATTACK_EFFECTS[attacker.name]) ? ATTACK_EFFECTS[attacker.name][attackName] : null;
  if (effectFn) {
    effectFn(state, attacker, defender, atkDef, playerId, targetInstanceId);
  } else {
    var baseDamage = parseInt(atkDef.damage, 10) || 0;
    if (defender) { dealDamage(state, attacker, defender, baseDamage); }
  }

  var damageDealt = defender.damage - beforeDamage;
  if (damageDealt > 0) { logEvent(state, defender.name + ' recibe ' + damageDealt + ' de daño', opId); }
  var newStatuses = defender.statusConditions.filter(function (s) { return beforeStatus.indexOf(s) === -1; });
  newStatuses.forEach(function (s) { logEvent(state, defender.name + ' ahora está ' + translateStatus(s), opId); });
  if (damageDealt > 0 || newStatuses.length > 0) {
    // Drives the ~1s "both cards in the foreground, damage number (and any
    // new Special Condition) on the defender" animation (see
    // showAttackOverlay, ui.js) -- damageDealt is already the real final
    // number (dealDamage already applied Weakness/Resistance/PlusPower/
    // shields internally before this delta was taken), so PlusPower's +10
    // and Defender's -20 both show up correctly here with no extra math
    // needed. Triggered by a new status alone too (Sing/Hypnosis are 0-
    // damage, status-only attacks) -- not just damage. A single
    // overwritable field, not a queue: exactly one attack() call ever
    // happens between the UI reading and clearing this, since attacking
    // always ends the turn.
    state.lastAttackResult = {
      attackerName: attacker.name, defenderName: defender.name, damage: damageDealt,
      newStatuses: newStatuses, severePoison: !!defender.severePoison
    };
  }

  if (defender) { knockOutIfNeeded(state, opId, defender); }
  // Machamp's Strikes Back (Pokémon Power, passive -- always on, no
  // button): whenever an opposing Pokémon attacks Machamp and deals
  // damage, it hits back for 10, even if Machamp is Knocked Out by the
  // very attack that triggered it (the `defender` reference still points
  // at the same object either way). Blocked only if Machamp was ALREADY
  // Asleep, Confused, or Paralyzed before this attack connected -- a
  // status this same attack just inflicted (beforeStatus predates it)
  // doesn't retroactively block the counter-hit.
  var defenderPower = defender && CARD_STATS[defender.name] && CARD_STATS[defender.name].pokemonPower;
  if (defenderPower && defenderPower.name === 'Strikes Back' && damageDealt > 0 &&
      beforeStatus.indexOf('Asleep') === -1 && beforeStatus.indexOf('Confused') === -1 && beforeStatus.indexOf('Paralyzed') === -1) {
    attacker.damage += 10;
    logEvent(state, defender.name + ' contraataca con Strikes Back e inflige 10 a ' + attacker.name, opId);
  }
  // Self-damage (Pikachu's Thunder Jolt, Machoke's Submission, ...) can
  // knock the attacker itself out -- this used to go unchecked here, so a
  // 0-HP Pokémon sat on the board as a live Active until the NEXT
  // checkup (applyCheckupDamage always re-checks p.active regardless of
  // whether it just added damage, so it eventually caught the KO -- but
  // only at "Terminar turno", not immediately, and never prompted a
  // Bench replacement in the meantime). Guarded on the attacker still
  // being the current Active so effects that already resolve their own
  // self-KO inline (Magnemite's Selfdestruct, which can also need to
  // knock out Bench Pokémon first) don't get double-processed here.
  if (p.active && p.active.id === attacker.id) { knockOutIfNeeded(state, playerId, attacker); }
  endThisTurn();
}

function applyCheckupDamage(state, playerId) {
  var p = state.players[playerId];
  // Special Conditions can only ever be carried by the Active Pokémon (see
  // retreat/Switch/Gust of Wind, which strip them the instant a Pokémon
  // leaves Active) -- so poison/burn/sleep checkup effects are scoped to
  // p.active only, never the bench, even defensively.
  if (p.active) {
    var instance = p.active;
    if (hasStatus(instance, 'Poisoned')) {
      // Nidoking's Toxic: 20/turn instead of the normal 10, "even if it
      // was already Poisoned" (i.e. Toxic upgrades an existing Poison
      // rather than requiring a fresh one).
      instance.damage += instance.severePoison ? 20 : 10;
      logEvent(state, instance.name + ' sufre daño por veneno', playerId);
    }
    if (hasStatus(instance, 'Burned')) {
      instance.damage += 10;
      // Real reported bug (same class): the Poisoned branch above already
      // logs its own damage, but Burned's never did, and neither branch
      // ever logged actually CURING a condition (waking up from Asleep,
      // curing off Burned) -- silent either way, even though gaining the
      // same status logs "ahora está X" (see attack()'s own newStatuses
      // handling). Both directions now log symmetrically.
      logEvent(state, instance.name + ' sufre daño por quemadura', playerId);
      if (coinFlip(state) === 'H') {
        instance.statusConditions = instance.statusConditions.filter(function (s) { return s !== 'Burned'; });
        logEvent(state, instance.name + ' se curó de la quemadura', playerId);
      }
    }
    if (hasStatus(instance, 'Asleep') && coinFlip(state) === 'H') {
      instance.statusConditions = instance.statusConditions.filter(function (s) { return s !== 'Asleep'; });
      logEvent(state, instance.name + ' se despertó', playerId);
    }
  }
  // The KO sweep still covers the whole bench (e.g. a future effect could
  // knock out a benched Pokémon directly) even though status-condition
  // damage itself is active-only.
  if (p.active) { knockOutIfNeeded(state, playerId, p.active); }
  p.bench.filter(function (b) { return b; }).forEach(function (b) { knockOutIfNeeded(state, playerId, b); });
}

// Both sides' Poison/Burned/Asleep resolve at the same Pokémon Checkup,
// whichever side's turn is ending (see testCheckupAppliesToOpponents
// PoisonedActiveSameTurn) -- but WHEN that checkup actually runs now
// depends on who ended the turn (see attack()'s own comment): immediately
// for the CPU's own turn-end, or held until the player's explicit
// "Terminar turno" click for theirs (ui.js's runCpuTurn calls this
// directly). No longer folded into endTurn() itself for that reason.
function applyEndOfTurnCheckup(state) {
  applyCheckupDamage(state, 'player');
  applyCheckupDamage(state, 'cpu');
}

function allInstances(p) {
  return (p.active ? [p.active] : []).concat(p.bench.filter(function (b) { return b; }));
}

function endTurn(state) {
  var justFinished = state.activePlayerId;
  // Real reported bug: logging the player's own "HAS TERMINADO TU TURNO"
  // right here fired the instant an attack auto-ended their turn
  // (endThisTurn -> endTurn, inside attack()) -- immediately visible
  // (afterPlayerAction renders right after), well before the player
  // actually clicked "Terminar turno" to hand play to the CPU. The CPU's
  // own turn-end is fine logged here unconditionally: cpuTakeTurn's whole
  // turn resolves silently and is only ever revealed afterward, as one
  // unit, through the CPU-turn reveal sequence (ui.js) -- so logging it
  // early never causes a premature render the way it did for the player.
  // The player's own line is logged instead from the exact moment they
  // click "Terminar turno" (see endTurnBtn's handler, ui.js), which fires
  // there unconditionally whether or not this function's own endTurn call
  // already ran earlier (from an attack) or is running right now (from
  // this very click).
  if (justFinished === 'cpu') {
    logEvent(state, 'CPU HA TERMINADO SU TURNO', justFinished, 'turn-end');
  }
  if (state.players[justFinished].active) {
    state.players[justFinished].active.statusConditions = state.players[justFinished].active.statusConditions.filter(function (s) { return s !== 'Paralyzed'; });
  }
  // PlusPower: "At the end of your turn, discard PlusPower" -- swept
  // across the ending player's WHOLE side (not just whatever's still
  // Active), so retreating away from it before ending the turn can't
  // leave a stale +10ATK badge on a Benched Pokémon forever.
  allInstances(state.players[justFinished]).forEach(function (instance) {
    instance.plusPowerAttached = false;
    // Energy Burn (Charizard's Pokémon Power): "for the rest of the turn"
    // -- always cleared at the end of its OWNER's own turn, same sweep as
    // PlusPower above.
    instance.energyBurnActive = false;
  });
  // Shields (Onix's Harden, Squirtle/Wartortle's Withdraw, Defender's
  // reduceFlat, ...) used to only ever get cleared reactively, inside
  // dealDamage, the next time something actually attacked the shielded
  // Pokémon -- functionally harmless for the no-UI shields (their
  // untilTurn check already made them correctly inert past their window
  // regardless), but Defender has a visible "+20DEF" badge keyed off the
  // shield object's mere presence, so a Pokémon that was never attacked
  // during the window kept showing it indefinitely. Swept here on BOTH
  // sides every turn transition (not just the ending player's), since a
  // shield's owner and whichever side's turn is currently ending aren't
  // always the same (Defender protects through the OPPONENT's next turn).
  ['player', 'cpu'].forEach(function (ownerId) {
    allInstances(state.players[ownerId]).forEach(function (instance) {
      if (instance.shield && instance.shield.untilTurn <= state.turnCounter) { instance.shield = null; }
      // Amnesia's lock (Poliwhirl) rides the same untilTurn/sweep
      // convention as shields: set to turnCounter+1 the moment it's used,
      // so it survives this immediate end-of-turn check, blocks the named
      // attack for the locked Pokémon's owner during their very next turn
      // (see canAttack), and is swept here at the end of THAT turn --
      // unlike shield/missChanceUntilTurn, this one is NOT cleared on
      // retreat, since the real card ties the lock to the specific
      // Pokémon and attack, not to "whichever Pokémon is currently Active".
      if (instance.tempLockedAttack && instance.tempLockedAttack.untilTurn <= state.turnCounter) { instance.tempLockedAttack = null; }
    });
  });

  state.turnCounter += 1;
  state.activePlayerId = opponentOf(justFinished);
  state.players[justFinished].energyAttachedThisTurn = false;
  state.players[justFinished].retreatedThisTurn = false;

  // Only draws here for the player -- their upcoming turn starts playing
  // immediately, no click needed, so there's nothing wrong with drawing
  // right away. The CPU's turn-start draw happens later, at the top of
  // cpuTakeTurn() (ai.js) instead: endTurn() can flip activePlayerId to
  // 'cpu' well before the CPU actually acts (e.g. right when the player
  // attacks, which ends their turn internally but waits for an explicit
  // "Terminar turno" click before the CPU moves -- see ui.js's
  // runCpuTurn/afterPlayerAction). Drawing here for the CPU would let the
  // player see its hand count go up before it's actually taken its turn.
  if (state.turnCounter > 1 && state.activePlayerId === 'player') { drawForTurnStart(state, 'player'); }
}

function getWinner(state) {
  if (state.players.player.prizes.length > 0 && remainingPrizes(state.players.player) === 0) { return 'player'; }
  if (state.players.cpu.prizes.length > 0 && remainingPrizes(state.players.cpu) === 0) { return 'cpu'; }
  if (state.players.player.hasHadActive && !state.players.player.active && benchCount(state.players.player) === 0) { return 'cpu'; }
  if (state.players.cpu.hasHadActive && !state.players.cpu.active && benchCount(state.players.cpu) === 0) { return 'player'; }
  if (state.deckedOut === 'player') { return 'cpu'; }
  if (state.deckedOut === 'cpu') { return 'player'; }
  if (state.players.player.timeBankMs <= 0) { return 'cpu'; }
  if (state.players.cpu.timeBankMs <= 0) { return 'player'; }
  return null;
}
