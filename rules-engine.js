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

function coinFlip(state) { return state.rng() < 0.5 ? 'H' : 'T'; }

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
      player: { deck: shuffle(expandDecklist(DECKLISTS.overgrowth), rng), hand: [], active: null, bench: [], discard: [], prizes: [] },
      cpu: { deck: shuffle(expandDecklist(DECKLISTS.blackout), rng), hand: [], active: null, bench: [], discard: [], prizes: [] }
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
  return state;
}
