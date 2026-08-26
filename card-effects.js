var TRAINER_EFFECTS = {};

TRAINER_EFFECTS['Bill'] = function (state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  drawCard(state, playerId, 2);
  logEvent(state, translatePlayer(playerId) + ' juega Bill (roba 2)', playerId);
  return { legal: true };
};

TRAINER_EFFECTS['Potion'] = function (state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target) { return { legal: false, reason: 'sin objetivo válido' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  target.damage = Math.max(0, target.damage - 20);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Potion') + ' en ' + target.name, playerId);
  return { legal: true };
};

// energyIndex (optional): which attachedEnergy index the player chose to
// discard (see ui.js's energy-discard modal). Defaults to the first one.
TRAINER_EFFECTS['Super Potion'] = function (state, playerId, handId, targetInstanceId, energyIndex) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no hay energía para descartar' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var removedEnergy = target.attachedEnergy.splice(energyIndex || 0, 1);
  removedEnergy.forEach(function (energyType) { p.discard.push(discardedEnergyCard(energyType)); });
  target.damage = Math.max(0, target.damage - 40);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Super Potion') + ' en ' + target.name, playerId);
  return { legal: true };
};

TRAINER_EFFECTS['Switch'] = function (state, playerId, handId, benchInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var benchIdx = p.bench.findIndex(function (b) { return b && b.id === benchInstanceId; });
  if (benchIdx === -1) { return { legal: false, reason: 'ese Pokémon no está en tu banca' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var incoming = p.bench[benchIdx];
  // Swap in place -- the outgoing Active (if there is one) takes over the
  // exact slot the incoming one is leaving, same as a real retreat
  // (rules-engine.js); with no Active yet, the slot just empties out.
  p.bench[benchIdx] = null;
  if (p.active) {
    p.active.statusConditions = [];
    p.active.shield = null;
    p.active.missChanceUntilTurn = null;
    p.bench[benchIdx] = p.active;
  }
  p.active = incoming;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Switch'), playerId);
  return { legal: true };
};

TRAINER_EFFECTS['Professor Oak'] = function (state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  p.discard = p.discard.concat(p.hand);
  p.hand = [];
  drawCard(state, playerId, 7);
  logEvent(state, translatePlayer(playerId) + ' juega ' + translateCardName('Professor Oak') + ' (descarta mano, roba 7)', playerId);
  return { legal: true };
};

TRAINER_EFFECTS['Gust of Wind'] = function (state, playerId, handId, opponentBenchInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var idx = op.bench.findIndex(function (b) { return b && b.id === opponentBenchInstanceId; });
  if (idx === -1) { return { legal: false, reason: 'ese Pokémon no está en la banca rival' }; }
  var handIdx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (handIdx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(handIdx, 1)[0];
  p.discard.push(card);
  var incoming = op.bench[idx];
  // Swap in place, same reasoning as Switch above.
  op.bench[idx] = null;
  if (op.active) {
    op.active.statusConditions = [];
    op.active.shield = null;
    op.active.missChanceUntilTurn = null;
    op.bench[idx] = op.active;
  }
  op.active = incoming;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Gust of Wind'), playerId);
  return { legal: true };
};

TRAINER_EFFECTS['Energy Removal'] = function (state, playerId, handId, opponentInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var target = findInstance(op, opponentInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no hay energía para retirar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var removedEnergy = target.attachedEnergy.splice(0, 1);
  removedEnergy.forEach(function (energyType) { op.discard.push(discardedEnergyCard(energyType)); });
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Energy Removal') + ' en ' + target.name, playerId);
  return { legal: true };
};

// ownEnergyIndex (optional): which of the own Pokémon's attached energy
// cards pays the cost -- the player picks this in a modal (see ui.js's
// wireBoardButtons, same openEnergyDiscardModal used by Super Potion)
// since a Pokémon can have more than one energy type attached. Defaults to
// index 0 for callers that don't care (ai.js's CPU usage).
TRAINER_EFFECTS['Super Energy Removal'] = function (state, playerId, handId, ownInstanceId, opponentInstanceId, ownEnergyIndex) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var own = findInstance(p, ownInstanceId);
  if (!own || own.attachedEnergy.length === 0) { return { legal: false, reason: 'no tienes energía propia para descartar como costo' }; }
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var target = findInstance(op, opponentInstanceId);
  if (!target) { return { legal: false, reason: 'sin objetivo rival válido' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var ownIdx = (typeof ownEnergyIndex === 'number' && ownEnergyIndex >= 0 && ownEnergyIndex < own.attachedEnergy.length) ? ownEnergyIndex : 0;
  var ownRemoved = own.attachedEnergy.splice(ownIdx, 1);
  ownRemoved.forEach(function (energyType) { p.discard.push(discardedEnergyCard(energyType)); });
  var oppRemoved = target.attachedEnergy.splice(0, Math.min(2, target.attachedEnergy.length));
  oppRemoved.forEach(function (energyType) { op.discard.push(discardedEnergyCard(energyType)); });
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Super Energy Removal') + ' en ' + target.name, playerId);
  return { legal: true };
};

TRAINER_EFFECTS['PlusPower'] = function (state, playerId, handId, ownInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, ownInstanceId);
  if (!target || target !== p.active) { return { legal: false, reason: 'Más Potencia solo se puede adjuntar a tu Pokémon Activo' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  target.plusPowerAttached = true;
  logEvent(state, translatePlayer(playerId) + ' adjunta ' + translateCardName('PlusPower') + ' a ' + target.name, playerId);
  return { legal: true };
};

// discardHandIds: exactly 2 OTHER hand card ids paid as the cost (per
// user's explicit call -- the real printed text does carry a "discard 2
// cards from your hand" cost). deckCardId identifies the exact deck-array
// card the player picked (see ui.js's openDeckSearchModal, which lists the
// live deck in order -- duplicates and all -- rather than a deduplicated-
// by-name list, since there's no other way to distinguish "this specific
// Bill" from another once they're all just plain {id, name} objects).
TRAINER_EFFECTS['Computer Search'] = function (state, playerId, handId, deckCardId, discardHandIds) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  discardHandIds = discardHandIds || [];
  if (discardHandIds.length !== 2 || discardHandIds.indexOf(handId) !== -1) {
    return { legal: false, reason: 'debes descartar exactamente 2 cartas de tu mano (sin contar esta)' };
  }
  var discardCards = discardHandIds.map(function (id) { return p.hand.find(function (c) { return c.id === id; }); });
  if (discardCards.some(function (c) { return !c; })) { return { legal: false, reason: 'esas cartas no están en tu mano' }; }
  var deckIdx = p.deck.findIndex(function (c) { return c.id === deckCardId; });
  if (deckIdx === -1) { return { legal: false, reason: 'esa carta no está en tu mazo' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  discardHandIds.forEach(function (id) {
    var i = p.hand.findIndex(function (c) { return c.id === id; });
    if (i !== -1) { p.discard.push(p.hand.splice(i, 1)[0]); }
  });
  var found = p.deck.splice(deckIdx, 1)[0];
  p.hand.push(found);
  p.deck = shuffle(p.deck, state.rng);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Computer Search') + ' y busca ' + translateCardName(found.name), playerId);
  return { legal: true };
};

// Real card text: "Attach Defender to 1 of your Pokémon" -- any of the
// player's own (Active or Bench), unlike PlusPower which is Active-only.
// The lingering damage-reduction itself is a new shield type (see
// dealDamage's 'reduceFlat' case, rules-engine.js) -- Defender is discarded
// from hand immediately on play like every other Trainer here; the "at the
// end of your opponent's next turn, discard Defender" printed text just
// describes when the shield itself stops applying (shield.untilTurn),
// same convention PlusPower already uses for its own end-of-turn wording.
TRAINER_EFFECTS['Defender'] = function (state, playerId, handId, ownInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, ownInstanceId);
  if (!target) { return { legal: false, reason: 'ese Pokémon no es tuyo' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  target.shield = { untilTurn: state.turnCounter + 1, type: 'reduceFlat', reduceAmount: 20 };
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Defender') + ' en ' + target.name, playerId);
  return { legal: true };
};

// No target of its own (like Bill/Professor Oak) -- both hands are
// affected automatically, no choice involved on either side.
TRAINER_EFFECTS['Lass'] = function (state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  [p, op].forEach(function (side) {
    var trainerIds = side.hand.filter(function (c) { return CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Trainer'; }).map(function (c) { return c.id; });
    trainerIds.forEach(function (id) {
      var i = side.hand.findIndex(function (c) { return c.id === id; });
      if (i !== -1) { side.deck.push(side.hand.splice(i, 1)[0]); }
    });
    if (trainerIds.length) { side.deck = shuffle(side.deck, state.rng); }
  });
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Lass'), playerId);
  return { legal: true };
};

// tradeHandId: the 1 OTHER hand card paid as the cost (real text: "Trade
// 1 of the other cards in your hand for up to 2 basic Energy cards from
// your discard pile"). retrieveDiscardIds: 0-2 basic Energy card ids from
// the player's own discard pile -- "up to 2" makes this a real choice,
// not a fixed amount, unlike Super Energy Removal's fixed counts.
TRAINER_EFFECTS['Energy Retrieval'] = function (state, playerId, handId, tradeHandId, retrieveDiscardIds) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  if (!tradeHandId || tradeHandId === handId) { return { legal: false, reason: 'debes cambiar 1 carta de tu mano' }; }
  var tradeIdx = p.hand.findIndex(function (c) { return c.id === tradeHandId; });
  if (tradeIdx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  retrieveDiscardIds = retrieveDiscardIds || [];
  if (retrieveDiscardIds.length > 2) { return { legal: false, reason: 'puedes recuperar como máximo 2 cartas de Energía' }; }
  var retrieveCards = retrieveDiscardIds.map(function (id) { return p.discard.find(function (c) { return c.id === id; }); });
  if (retrieveCards.some(function (c) { return !c || !ENERGY_TYPE_BY_CARD_NAME.hasOwnProperty(c.name); })) {
    return { legal: false, reason: 'solo puedes recuperar cartas de Energía básica de tu descarte' };
  }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var traded = p.hand.splice(p.hand.findIndex(function (c) { return c.id === tradeHandId; }), 1)[0];
  p.discard.push(traded);
  retrieveDiscardIds.forEach(function (id) {
    var i = p.discard.findIndex(function (c) { return c.id === id; });
    if (i !== -1) { p.hand.push(p.discard.splice(i, 1)[0]); }
  });
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Energy Retrieval'), playerId);
  return { legal: true };
};

// Queues every successful Trainer play on state (name + who played it) so
// ui.js's renderBoard() can flash each one big for a moment in turn -- both
// the player's own plays (ui.js's various USAR/target-click handlers) and
// the CPU's (ai.js's aiTryUseTrainer/aiTryPlusPower/aiTryGustSnipe/
// aiTryEnergyDisruption) route through these same functions, so wrapping
// them all here covers every case without touching either caller. A queue
// (not a single last-play slot) because cpuTakeTurn can play more than one
// Trainer in the same turn before ui.js ever gets to render in between --
// a single slot would silently drop every play but the last. Card names in
// TRAINER_EFFECTS are never called with a `this` of their own, so
// forwarding through .apply(null, ...) is safe.
Object.keys(TRAINER_EFFECTS).forEach(function (name) {
  var original = TRAINER_EFFECTS[name];
  TRAINER_EFFECTS[name] = function (state, playerId) {
    var result = original.apply(null, arguments);
    if (result && result.legal) {
      state.trainerPlaysQueue = state.trainerPlaysQueue || [];
      state.trainerPlaysQueue.push({ name: name, playerId: playerId });
    }
    return result;
  };
});

var ATTACK_EFFECTS = {};

ATTACK_EFFECTS['Weedle'] = {
  'Poison Sting': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); }
  }
};

ATTACK_EFFECTS['Bulbasaur'] = {
  'Leech Seed': function (state, attacker, defender) {
    var dealt = dealDamage(state, attacker, defender, 20);
    if (dealt > 0) { attacker.damage = Math.max(0, attacker.damage - 10); }
  }
};

ATTACK_EFFECTS['Ivysaur'] = {
  'Vine Whip': function (state, attacker, defender) { dealDamage(state, attacker, defender, 30); },
  'Poisonpowder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    addStatus(defender, 'Poisoned');
  }
};

ATTACK_EFFECTS['Kakuna'] = {
  'Stiffen': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  'Poisonpowder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); }
  }
};

ATTACK_EFFECTS['Beedrill'] = {
  'Twineedle': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 30 * heads);
  },
  'Poison Sting': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 40);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); }
  }
};

ATTACK_EFFECTS['Magikarp'] = {
  'Tackle': function (state, attacker, defender) { dealDamage(state, attacker, defender, 10); },
  'Flail': function (state, attacker, defender) { dealDamage(state, attacker, defender, 10 * (attacker.damage / 10)); }
};

ATTACK_EFFECTS['Gyarados'] = {
  'Dragon Rage': function (state, attacker, defender) { dealDamage(state, attacker, defender, 50); },
  'Bubblebeam': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 40);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Staryu'] = {
  'Slap': function (state, attacker, defender) { dealDamage(state, attacker, defender, 20); }
};

ATTACK_EFFECTS['Starmie'] = {
  'Recover': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Water');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      attacker.damage = 0;
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Water')); }
    }
  },
  'Star Freeze': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Machop'] = {
  'Low Kick': function (state, attacker, defender) { dealDamage(state, attacker, defender, 20); }
};

ATTACK_EFFECTS['Machoke'] = {
  'Karate Chop': function (state, attacker, defender) {
    var dmg = Math.max(0, 50 - 10 * (attacker.damage / 10));
    dealDamage(state, attacker, defender, dmg);
  },
  'Submission': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 60);
    attacker.damage += 20;
  }
};

ATTACK_EFFECTS['Hitmonchan'] = {
  'Jab': function (state, attacker, defender) { dealDamage(state, attacker, defender, 20); },
  'Special Punch': function (state, attacker, defender) { dealDamage(state, attacker, defender, 40); }
};

ATTACK_EFFECTS['Onix'] = {
  'Rock Throw': function (state, attacker, defender) { dealDamage(state, attacker, defender, 10); },
  'Harden': function (state, attacker) {
    attacker.shield = { untilTurn: state.turnCounter + 1, type: 'thresholdMax', thresholdMax: 30 };
  }
};

ATTACK_EFFECTS['Sandshrew'] = {
  'Sand-attack': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (defender) { defender.missChanceUntilTurn = state.turnCounter + 1; }
  }
};

ATTACK_EFFECTS['Squirtle'] = {
  'Bubble': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  },
  'Withdraw': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  }
};

ATTACK_EFFECTS['Wartortle'] = {
  'Withdraw': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  'Bite': function (state, attacker, defender) { dealDamage(state, attacker, defender, 40); }
};

// Gnaw (plain 10 damage) and Super Psy (plain 50 damage) need no entry --
// attack()'s own fallback already handles flat-damage attacks straight
// from CARD_STATS.
ATTACK_EFFECTS['Mewtwo'] = {
  'Psychic': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10 + 10 * defender.attachedEnergy.length);
  },
  'Barrier': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Psychic');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Psychic')); }
      attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' };
    }
  }
};

ATTACK_EFFECTS['Kadabra'] = {
  // Same mechanic as Starmie's Recover above, just discarding Psychic
  // energy instead of Water.
  'Recover': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Psychic');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      attacker.damage = 0;
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Psychic')); }
    }
  }
};

ATTACK_EFFECTS['Jynx'] = {
  'Doubleslap': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 10 * heads);
  },
  'Meditate': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20 + 10 * (defender.damage / 10));
  }
};

ATTACK_EFFECTS['Haunter'] = {
  'Hypnosis': function (state, attacker, defender) { addStatus(defender, 'Asleep'); }
  // Dream Eater's "unless the Defending Pokémon is Asleep" restriction
  // lives in canAttack (rules-engine.js) since it's a legality gate, not
  // an in-attack effect -- its own 50 flat damage needs no entry here.
};

ATTACK_EFFECTS['Gastly'] = {
  'Sleeping Gas': function (state, attacker, defender) {
    if (coinFlip(state) === 'H') { addStatus(defender, 'Asleep'); }
  },
  // Sets a revenge-KO flag consumed later by knockOutIfNeeded
  // (rules-engine.js), not anything resolved here -- Destiny Bond does no
  // damage of its own.
  'Destiny Bond': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Psychic');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Psychic')); }
      attacker.destinyBond = { untilTurn: state.turnCounter + 1 };
    }
  }
};

ATTACK_EFFECTS['Drowzee'] = {
  // Pound (plain 10 damage) needs no entry.
  'Confuse Ray': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Confused'); }
  }
};

ATTACK_EFFECTS['Abra'] = {
  'Psyshock': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Pikachu'] = {
  // Gnaw (plain 10 damage) needs no entry.
  'Thunder Jolt': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 30);
    if (coinFlip(state) === 'T') { attacker.damage += 10; }
  }
};

ATTACK_EFFECTS['Magnemite'] = {
  'Thunder Wave': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  },
  // Splashes both players' whole Bench (bypassing dealDamage -- the real
  // card explicitly says Weakness/Resistance don't apply to the Bench
  // here) before the attacker's own guaranteed-lethal 40 self-damage.
  // knockOutIfNeeded already handles a Bench instance being knocked out
  // directly (see its own comment), and also handles the attacker itself
  // dying here -- unlike Machoke's Submission, this attack's self-damage
  // is large enough (40, exactly Magnemite's own max HP) that it almost
  // always needs that check to actually fire.
  'Selfdestruct': function (state, attacker, defender, atkDef, playerId) {
    ['player', 'cpu'].forEach(function (ownerId) {
      state.players[ownerId].bench.forEach(function (b) {
        if (!b) { return; }
        b.damage += 10;
        knockOutIfNeeded(state, ownerId, b);
      });
    });
    attacker.damage += 40;
    knockOutIfNeeded(state, playerId, attacker);
  }
};

// Ninetales' Lure is the one real Base Set attack that needs a chosen
// target the same way a Trainer does (see attack()'s targetInstanceId,
// rules-engine.js, and ui.js's Lure-specific click handling) -- every
// other attack here always just hits the opponent's current Active.
ATTACK_EFFECTS['Ninetales'] = {
  'Lure': function (state, attacker, defender, atkDef, playerId, targetInstanceId) {
    if (!playerId || !targetInstanceId) { return; }
    var op = state.players[opponentOf(playerId)];
    var idx = op.bench.findIndex(function (b) { return b && b.id === targetInstanceId; });
    if (idx === -1) { return; } // no such Benched Pokémon -- real card just does nothing then
    var incoming = op.bench[idx];
    op.bench[idx] = null;
    if (op.active) {
      op.active.statusConditions = [];
      op.active.shield = null;
      op.active.missChanceUntilTurn = null;
      op.bench[idx] = op.active;
    }
    op.active = incoming;
  },
  'Fire Blast': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Fire');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Fire')); }
      dealDamage(state, attacker, defender, 80);
    }
  }
};

ATTACK_EFFECTS['Arcanine'] = {
  'Flamethrower': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Fire');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Fire')); }
      dealDamage(state, attacker, defender, 50);
    }
  },
  'Take Down': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 80);
    attacker.damage += 30;
  }
};

ATTACK_EFFECTS['Charmeleon'] = {
  // Slash (plain 30 damage) needs no entry.
  'Flamethrower': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Fire');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Fire')); }
      dealDamage(state, attacker, defender, 50);
    }
  }
};

ATTACK_EFFECTS['Nidoran ♂'] = {
  'Horn Hazard': function (state, attacker, defender) {
    if (coinFlip(state) === 'H') { dealDamage(state, attacker, defender, 30); }
    // Tails: "this attack does nothing" -- no damage, no other effect.
  }
};

ATTACK_EFFECTS['Tangela'] = {
  'Bind': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  },
  'Poisonpowder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    addStatus(defender, 'Poisoned');
  }
};

ATTACK_EFFECTS['Vulpix'] = {
  'Confuse Ray': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Confused'); }
  }
};

ATTACK_EFFECTS['Charmander'] = {
  // Scratch (plain 10 damage) needs no entry.
  'Ember': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Fire');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Fire')); }
      dealDamage(state, attacker, defender, 30);
    }
  }
};

ATTACK_EFFECTS["Farfetch'd"] = {
  'Leek Slap': function (state, attacker, defender) {
    attacker.lockedAttacks.push('Leek Slap');
    if (coinFlip(state) === 'H') { dealDamage(state, attacker, defender, 30); }
  },
  'Pot Smash': function (state, attacker, defender) { dealDamage(state, attacker, defender, 30); }
};
