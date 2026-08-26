// Activatable Pokémon Powers (dispatched by usePokemonPower,
// rules-engine.js, which already validated the owner belongs to playerId,
// has this exact Power, and isn't blocked by Asleep/Confused/Paralyzed).
// Machamp's Strikes Back is NOT here -- it's a passive, always-on effect
// handled entirely inside attack() itself, with no button and no entry in
// this registry (usablePokemonPowers, rules-engine.js, explicitly skips it
// by name for that reason).
var POKEMON_POWER_EFFECTS = {};

// params: {fromInstanceId, toInstanceId} -- both must be the player's own
// Pokémon (Active or Bench). "As often as you like" needs no special
// handling here: nothing stops the player from clicking HABILIDAD and
// calling this again immediately after.
POKEMON_POWER_EFFECTS['Damage Swap'] = function (state, playerId, owner, params) {
  var p = state.players[playerId];
  var from = findInstance(p, params.fromInstanceId);
  var to = findInstance(p, params.toInstanceId);
  if (!from || !to || from.id === to.id) { return { legal: false, reason: 'elige 2 de tus Pokémon distintos' }; }
  if (from.damage < 10) { return { legal: false, reason: 'ese Pokémon no tiene daño para mover' }; }
  if (to.damage + 10 >= CARD_STATS[to.name].hp) { return { legal: false, reason: 'no puedes noquear al Pokémon de destino' }; }
  from.damage -= 10;
  to.damage += 10;
  logEvent(state, translatePlayer(playerId) + ' usa Damage Swap (Alakazam)', playerId);
  return { legal: true };
};

// params: {handEnergyId, targetInstanceId} -- Water Energy only, target
// must be one of the player's own Water-type Pokémon. Deliberately does
// NOT set p.energyAttachedThisTurn (the real text: "this doesn't use up
// your 1 Energy card attachment for the turn").
POKEMON_POWER_EFFECTS['Rain Dance'] = function (state, playerId, owner, params) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === params.handEnergyId; });
  if (idx === -1 || p.hand[idx].name !== 'Water Energy') { return { legal: false, reason: 'elige una carta de Energía Agua de tu mano' }; }
  var target = findInstance(p, params.targetInstanceId);
  if (!target || (CARD_STATS[target.name].types || []).indexOf('Water') === -1) {
    return { legal: false, reason: 'solo puedes adjuntarla a uno de tus Pokémon de tipo Agua' };
  }
  p.hand.splice(idx, 1);
  target.attachedEnergy.push('Water');
  logEvent(state, translatePlayer(playerId) + ' usa Rain Dance (Blastoise) en ' + target.name, playerId);
  return { legal: true };
};

// No target -- self-only. See canPayCost (rules-engine.js) for where the
// energyBurnActive flag it sets actually takes effect.
POKEMON_POWER_EFFECTS['Energy Burn'] = function (state, playerId, owner) {
  owner.energyBurnActive = true;
  logEvent(state, translatePlayer(playerId) + ' usa Energy Burn (Charizard)', playerId);
  return { legal: true };
};

// params: {fromInstanceId, toInstanceId} -- same shape as Damage Swap,
// just moving a Grass Energy card instead of a damage counter.
POKEMON_POWER_EFFECTS['Energy Trans'] = function (state, playerId, owner, params) {
  var p = state.players[playerId];
  var from = findInstance(p, params.fromInstanceId);
  var to = findInstance(p, params.toInstanceId);
  if (!from || !to || from.id === to.id) { return { legal: false, reason: 'elige 2 de tus Pokémon distintos' }; }
  var idx = from.attachedEnergy.indexOf('Grass');
  if (idx === -1) { return { legal: false, reason: 'el Pokémon de origen no tiene Energía Planta adjunta' }; }
  from.attachedEnergy.splice(idx, 1);
  to.attachedEnergy.push('Grass');
  logEvent(state, translatePlayer(playerId) + ' usa Energy Trans (Venusaur)', playerId);
  return { legal: true };
};

// params: {chosenType, targetInstanceId} -- "Electrode becomes an Energy
// card" fits this engine's existing representation directly: attachedEnergy
// is already just an array of energy-TYPE strings (not real card objects),
// so Electrode being Knocked Out (a real KO -- the opponent gets a prize,
// same as any other) and 2 units of the chosen type landing on another of
// the player's own Pokémon needs no new data shape at all.
POKEMON_POWER_EFFECTS['Buzzap'] = function (state, playerId, owner, params) {
  var p = state.players[playerId];
  var target = findInstance(p, params.targetInstanceId);
  if (!target || target.id === owner.id) { return { legal: false, reason: 'elige otro de tus Pokémon' }; }
  var validTypes = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless'];
  if (validTypes.indexOf(params.chosenType) === -1) { return { legal: false, reason: 'elige un tipo de Energía válido' }; }
  owner.damage = CARD_STATS[owner.name].hp;
  knockOutIfNeeded(state, playerId, owner);
  target.attachedEnergy.push(params.chosenType, params.chosenType);
  logEvent(state, translatePlayer(playerId) + ' usa Buzzap (Electrode) y adjunta 2 Energía ' + params.chosenType + ' a ' + target.name, playerId);
  return { legal: true };
};

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
    p.active.severePoison = false;
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
    op.active.severePoison = false;
    op.active.shield = null;
    op.active.missChanceUntilTurn = null;
    op.bench[idx] = op.active;
  }
  op.active = incoming;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Gust of Wind'), playerId);
  return { legal: true };
};

// energyIndex (optional): which of the target's attachedEnergy indices the
// player chose to remove (see ui.js's energy-discard modal, same pattern
// already used by Super Potion/Super Energy Removal) -- real card text is
// "Choose 1 Energy card attached to 1 of your opponent's Pokémon", a genuine
// choice whenever more than one type is attached. Defaults to index 0 for
// callers that don't care (ai.js's CPU usage, tests).
TRAINER_EFFECTS['Energy Removal'] = function (state, playerId, handId, opponentInstanceId, energyIndex) {
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
  var removeIdx = (typeof energyIndex === 'number' && energyIndex >= 0 && energyIndex < target.attachedEnergy.length) ? energyIndex : 0;
  var removedEnergy = target.attachedEnergy.splice(removeIdx, 1);
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

// targetInstanceId: one of the player's own Pokémon in play that currently
// has an Evolution attached (canEvolve-style, but here we're removing one
// rather than adding it). Simplification: always devolves all the way back
// to the Basic form rather than making the player choose an intermediate
// Stage to stop at -- avoids a dedicated stage-picker UI for this one rare
// Trainer (same call already made this session for Metronome/Amnesia's
// opponent-attack choice).
TRAINER_EFFECTS['Devolution Spray'] = function (state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target || !CARD_STATS[target.name].evolvesFrom) { return { legal: false, reason: 'ese Pokémon no tiene una Evolución que quitar' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var walk = target.name;
  while (CARD_STATS[walk] && CARD_STATS[walk].evolvesFrom) {
    p.discard.push(discardedEvolutionCard(walk));
    walk = CARD_STATS[walk].evolvesFrom;
  }
  target.name = walk;
  target.statusConditions = [];
  target.severePoison = false;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Devolution Spray') + ' en ' + target.name, playerId);
  return { legal: true };
};

// No target -- always hits the OPPONENT (opposite of regular Professor
// Oak, which affects the caster).
TRAINER_EFFECTS['Impostor Professor Oak'] = function (state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  op.deck = op.deck.concat(op.hand);
  op.hand = [];
  op.deck = shuffle(op.deck, state.rng);
  drawCard(state, opponentOf(playerId), 7);
  logEvent(state, translatePlayer(playerId) + ' juega ' + translateCardName('Impostor Professor Oak') + ' (el rival mezcla su mano y roba 7)', playerId);
  return { legal: true };
};

// discardHandIds: exactly 2 OTHER hand card ids paid as the cost (same
// convention as Computer Search). discardCardId: the specific Trainer card
// (by id, not name) chosen from the player's OWN discard pile.
TRAINER_EFFECTS['Item Finder'] = function (state, playerId, handId, discardHandIds, discardCardId) {
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
  var pileCard = p.discard.find(function (c) { return c.id === discardCardId; });
  if (!pileCard) { return { legal: false, reason: 'esa carta no está en tu descarte' }; }
  if (!CARD_STATS[pileCard.name] || CARD_STATS[pileCard.name].supertype !== 'Trainer') {
    return { legal: false, reason: 'solo puedes buscar una carta de Entrenador' };
  }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  discardHandIds.forEach(function (id) {
    var i = p.hand.findIndex(function (c) { return c.id === id; });
    if (i !== -1) { p.discard.push(p.hand.splice(i, 1)[0]); }
  });
  var found = p.discard.splice(p.discard.findIndex(function (c) { return c.id === discardCardId; }), 1)[0];
  p.hand.push(found);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Item Finder') + ' y recupera ' + translateCardName(found.name), playerId);
  return { legal: true };
};

// evolutionHandId: the Stage 2 card (by id) chosen from hand -- separate
// from handId, which is Pokémon Breeder itself. targetInstanceId: the
// matching Basic Pokémon in play. Skips the Stage 1 requirement entirely,
// but the real "you could evolve it anyway" timing rule (same turn placed,
// turn-3 opening restriction) still applies -- see evolutionTimingAllowed,
// rules-engine.js, shared with canEvolve.
TRAINER_EFFECTS['Pokémon Breeder'] = function (state, playerId, handId, evolutionHandId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  var evoCard = p.hand.find(function (c) { return c.id === evolutionHandId; });
  if (!target || !evoCard) { return { legal: false, reason: 'selección inválida' }; }
  var evoStats = CARD_STATS[evoCard.name];
  var stage1Name = evoStats && evoStats.evolvesFrom;
  var stage1Stats = stage1Name && CARD_STATS[stage1Name];
  var basicName = stage1Stats && stage1Stats.evolvesFrom;
  if (!basicName || basicName !== target.name) { return { legal: false, reason: 'esa carta no evoluciona desde ese Pokémon' }; }
  if (!evolutionTimingAllowed(state, target)) { return { legal: false, reason: 'ese Pokémon no puede evolucionar todavía' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var evoIdx = p.hand.findIndex(function (c) { return c.id === evolutionHandId; });
  p.hand.splice(evoIdx, 1);
  target.name = evoCard.name;
  target.turnEnteredCurrentForm = state.turnCounter;
  target.statusConditions = [];
  target.severePoison = false;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokémon Breeder') + ' para evolucionar a ' + evoCard.name, playerId);
  return { legal: true };
};

// tradeHandId: a Pokémon card (by id) from the player's own hand.
// deckCardId: a Pokémon card (by id) chosen from the player's own deck.
TRAINER_EFFECTS['Pokémon Trader'] = function (state, playerId, handId, tradeHandId, deckCardId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var tradeCard = p.hand.find(function (c) { return c.id === tradeHandId; });
  if (!tradeCard || !CARD_STATS[tradeCard.name] || CARD_STATS[tradeCard.name].supertype !== 'Pokémon') {
    return { legal: false, reason: 'solo puedes cambiar una carta de Pokémon' };
  }
  var deckCard = p.deck.find(function (c) { return c.id === deckCardId; });
  if (!deckCard || !CARD_STATS[deckCard.name] || CARD_STATS[deckCard.name].supertype !== 'Pokémon') {
    return { legal: false, reason: 'solo puedes buscar una carta de Pokémon' };
  }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var traded = p.hand.splice(p.hand.findIndex(function (c) { return c.id === tradeHandId; }), 1)[0];
  p.deck.push(traded);
  var found = p.deck.splice(p.deck.findIndex(function (c) { return c.id === deckCardId; }), 1)[0];
  p.hand.push(found);
  p.deck = shuffle(p.deck, state.rng);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokémon Trader') + ' y busca ' + translateCardName(found.name), playerId);
  return { legal: true };
};

// targetInstanceId: any of the player's own Pokémon in play (Active or
// Bench) -- returns its root Basic form to hand (see basicFormName,
// rules-engine.js), discarding every Evolution stage above that plus all
// attached Energy. Not a Knock Out (no prize either way): if the Active is
// scooped up, the replacement flow mirrors knockOutIfNeeded's own
// player-choice/CPU-auto-promote split.
TRAINER_EFFECTS['Scoop Up'] = function (state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target) { return { legal: false, reason: 'sin objetivo válido' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var basic = basicFormName(target.name);
  var walk = target.name;
  while (walk !== basic) {
    p.discard.push(discardedEvolutionCard(walk));
    walk = CARD_STATS[walk].evolvesFrom;
  }
  target.attachedEnergy.forEach(function (t) { p.discard.push(discardedEnergyCard(t)); });
  var isActive = p.active && p.active.id === target.id;
  if (isActive) {
    p.active = null;
    if (playerId === 'player' && benchCount(p) > 0) {
      state.pendingActiveChoice = 'player';
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
  p.hand.push({ id: 'scoopup-' + Date.now() + '-' + Math.random(), name: basic });
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Scoop Up') + ' y recoge a ' + translateCardName(basic), playerId);
  return { legal: true };
};

// No target -- always the player's own Active. Real Base Set text cures
// Asleep/Confused/Paralyzed/Poisoned -- Burned is NOT listed (unlike later
// reprints), so it's the one status this deliberately leaves untouched.
TRAINER_EFFECTS['Full Heal'] = function (state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  if (!p.active) { return { legal: false, reason: 'no tienes Pokémon Activo' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  p.active.statusConditions = p.active.statusConditions.filter(function (s) { return s === 'Burned'; });
  p.active.severePoison = false;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Full Heal'), playerId);
  return { legal: true };
};

// shuffleHandIds: exactly 2 OTHER hand card ids, shuffled into the deck
// (not discarded) before drawing 1.
TRAINER_EFFECTS['Maintenance'] = function (state, playerId, handId, shuffleHandIds) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  shuffleHandIds = shuffleHandIds || [];
  if (shuffleHandIds.length !== 2 || shuffleHandIds.indexOf(handId) !== -1) {
    return { legal: false, reason: 'debes mezclar exactamente 2 cartas de tu mano (sin contar esta)' };
  }
  var shuffleCards = shuffleHandIds.map(function (id) { return p.hand.find(function (c) { return c.id === id; }); });
  if (shuffleCards.some(function (c) { return !c; })) { return { legal: false, reason: 'esas cartas no están en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  shuffleHandIds.forEach(function (id) {
    var i = p.hand.findIndex(function (c) { return c.id === id; });
    if (i !== -1) { p.deck.push(p.hand.splice(i, 1)[0]); }
  });
  p.deck = shuffle(p.deck, state.rng);
  drawCard(state, playerId, 1);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Maintenance'), playerId);
  return { legal: true };
};

// No target -- heals every one of the player's own Pokémon with damage,
// but each healed Pokémon loses all its attached Energy as the real
// side-effect (untouched Pokémon with 0 damage keep theirs).
TRAINER_EFFECTS['Pokémon Center'] = function (state, playerId, handId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  allInstances(p).forEach(function (instance) {
    if (instance.damage > 0) {
      instance.damage = 0;
      instance.attachedEnergy.forEach(function (t) { p.discard.push(discardedEnergyCard(t)); });
      instance.attachedEnergy = [];
    }
  });
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokémon Center'), playerId);
  return { legal: true };
};

// opponentDiscardCardId: a Basic Pokémon card (by id) from the OPPONENT's
// own discard pile, placed onto the OPPONENT's Bench (not the caster's).
TRAINER_EFFECTS['Pokémon Flute'] = function (state, playerId, handId, opponentDiscardCardId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  if (benchCount(op) >= 5) { return { legal: false, reason: 'la banca rival está llena' }; }
  var pileCard = op.discard.find(function (c) { return c.id === opponentDiscardCardId; });
  if (!pileCard) { return { legal: false, reason: 'esa carta no está en el descarte rival' }; }
  if (!isBasicPokemon(pileCard.name)) { return { legal: false, reason: 'solo puedes elegir un Pokémon Básico' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var found = op.discard.splice(op.discard.findIndex(function (c) { return c.id === opponentDiscardCardId; }), 1)[0];
  var emptyIdx = op.bench.findIndex(function (b) { return !b; });
  op.bench[emptyIdx] = makeFreshInstance(found.id, found.name, state.turnCounter);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokémon Flute') + ' y pone ' + translateCardName(found.name) + ' en la banca rival', playerId);
  return { legal: true };
};

// orderedIds (optional): the full list of the top-N deck card ids in the
// NEW order the player wants -- must be exactly a permutation of the
// current top N (N = min(5, deck.length)), or the play is rejected.
// Omitting it (e.g. a caller that doesn't care) is a safe no-op reorder.
TRAINER_EFFECTS['Pokédex'] = function (state, playerId, handId, orderedIds) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var n = Math.min(5, p.deck.length);
  var topIds = p.deck.slice(0, n).map(function (c) { return c.id; });
  orderedIds = orderedIds || topIds;
  var sortedGiven = orderedIds.slice().sort();
  var sortedTop = topIds.slice().sort();
  if (JSON.stringify(sortedGiven) !== JSON.stringify(sortedTop)) {
    return { legal: false, reason: 'debes reordenar exactamente esas mismas cartas' };
  }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var byId = {};
  p.deck.slice(0, n).forEach(function (c) { byId[c.id] = c; });
  var rest = p.deck.slice(n);
  p.deck = orderedIds.map(function (id) { return byId[id]; }).concat(rest);
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Pokédex'), playerId);
  return { legal: true };
};

// discardCardId: a Basic Pokémon card (by id) from the player's OWN
// discard pile, placed onto an empty Bench slot (auto-picked -- the real
// card doesn't ask which slot).
TRAINER_EFFECTS['Revive'] = function (state, playerId, handId, discardCardId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  if (benchCount(p) >= 5) { return { legal: false, reason: 'tu banca está llena' }; }
  var pileCard = p.discard.find(function (c) { return c.id === discardCardId; });
  if (!pileCard) { return { legal: false, reason: 'esa carta no está en tu descarte' }; }
  if (!isBasicPokemon(pileCard.name)) { return { legal: false, reason: 'solo puedes elegir un Pokémon Básico' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var found = p.discard.splice(p.discard.findIndex(function (c) { return c.id === discardCardId; }), 1)[0];
  var instance = makeFreshInstance(found.id, found.name, state.turnCounter);
  var maxHp = CARD_STATS[found.name].hp;
  instance.damage = Math.floor(maxHp / 2 / 10) * 10;
  var emptyIdx = p.bench.findIndex(function (b) { return !b; });
  p.bench[emptyIdx] = instance;
  logEvent(state, translatePlayer(playerId) + ' usa ' + translateCardName('Revive') + ' y regresa a ' + translateCardName(found.name), playerId);
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
      op.active.severePoison = false;
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

// Shared by every "X damage plus 10 more for each energy of TYPE attached
// but not used to pay the cost (extra energy after the Nth doesn't count)"
// attack (Blastoise/Poliwrath/Poliwag's Water Gun & Hydro Pump): counts the
// attacker's attached energy of that type, subtracts however many the
// printed cost itself requires, and caps the remainder at capExtra before
// converting to a 10-per-extra bonus.
function extraEnergyBonus(attacker, energyType, costCount, capExtra) {
  var total = attacker.attachedEnergy.filter(function (t) { return t === energyType; }).length;
  var unused = Math.max(0, total - costCount);
  return 10 * Math.min(unused, capExtra);
}

// Shared by Metronome (Clefairy) and Amnesia (Poliwhirl): both let the
// player choose one of the Defending Pokémon's attacks. Building a full
// "pick one of the opponent's attacks" UI for these two rare, low-stakes
// cards isn't worth it -- both auto-pick the defender's single highest
// flat-damage attack instead (documented simplification, same call already
// made this session for Whirlwind/Whirlpool-style opponent-side choices).
function highestDamageAttack(defenderName) {
  var defStats = CARD_STATS[defenderName];
  if (!defStats || !defStats.attacks || !defStats.attacks.length) { return null; }
  return defStats.attacks.reduce(function (best, a) {
    var dmg = parseInt(a.damage, 10) || 0;
    return (!best || dmg > best.dmg) ? { atk: a, dmg: dmg } : best;
  }, null);
}

// Shared by Whirlwind (Pidgey/Pidgeotto): "your opponent chooses 1 of
// their Benched Pokémon and switches it with the Defending Pokémon" -- the
// choice belongs to the DEFENDING side, not the attacker, so a full
// pending-choice UI would be needed to let the CPU or player make it
// mid-opponent-attack. Auto-picks the first available Bench slot instead
// (documented simplification), same swap-in-place mechanics as
// Switch/Gust of Wind/Lure above.
function forceOpponentSwitch(state, playerId) {
  if (!playerId) { return; }
  var op = state.players[opponentOf(playerId)];
  var idx = op.bench.findIndex(function (b) { return b; });
  if (idx === -1) { return; }
  var incoming = op.bench[idx];
  op.bench[idx] = null;
  if (op.active) {
    op.active.statusConditions = [];
    op.active.severePoison = false;
    op.active.shield = null;
    op.active.missChanceUntilTurn = null;
    op.bench[idx] = op.active;
  }
  op.active = incoming;
}

// Shared by Whirlpool (Poliwrath) and Hyper Beam (Dragonair): "if the
// Defending Pokémon has any Energy attached, choose 1 and discard it" --
// same simplification as Energy Removal's own opponent-side choice
// (TRAINER_EFFECTS above): always discards index 0 rather than modeling
// "which specific energy".
function discardOneDefenderEnergy(state, defender, playerId) {
  if (!defender.attachedEnergy.length) { return; }
  var removed = defender.attachedEnergy.splice(0, 1);
  var op = state.players[opponentOf(playerId)];
  removed.forEach(function (t) { op.discard.push(discardedEnergyCard(t)); });
}

ATTACK_EFFECTS['Alakazam'] = {
  'Confuse Ray': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 30);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Confused'); }
  }
};

ATTACK_EFFECTS['Blastoise'] = {
  'Hydro Pump': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 40 + extraEnergyBonus(attacker, 'Water', 3, 2));
  }
};

ATTACK_EFFECTS['Chansey'] = {
  'Scrunch': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  // "Chansey does 80 damage to itself" -- no damage to the defender at
  // all; the existing generic self-KO check in attack() picks this up.
  'Double-edge': function (state, attacker) { attacker.damage += 80; }
};

ATTACK_EFFECTS['Charizard'] = {
  // "Discard 2 Energy cards attached to Charizard in order to use this
  // attack" -- no type restriction on which 2, unlike Fire-specific
  // discard costs (Ember/Flamethrower above).
  'Fire Spin': function (state, attacker, defender) {
    if (attacker.attachedEnergy.length < 2) { return; }
    attacker.attachedEnergy.splice(0, 2);
    dealDamage(state, attacker, defender, 100);
  }
};

ATTACK_EFFECTS['Clefairy'] = {
  'Sing': function (state, attacker, defender) {
    if (coinFlip(state) === 'H') { addStatus(defender, 'Asleep'); }
  },
  'Metronome': function (state, attacker, defender) {
    var best = highestDamageAttack(defender.name);
    if (best && best.dmg > 0) { dealDamage(state, attacker, defender, best.dmg); }
  }
};

ATTACK_EFFECTS['Magneton'] = {
  'Thunder Wave': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 30);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  },
  // Same Bench-splash-then-guaranteed-self-KO shape as Magnemite's
  // Selfdestruct above, just Magneton's own printed numbers (80 self dmg
  // instead of 40).
  'Selfdestruct': function (state, attacker, defender, atkDef, playerId) {
    ['player', 'cpu'].forEach(function (ownerId) {
      state.players[ownerId].bench.forEach(function (b) {
        if (!b) { return; }
        b.damage += 10;
        knockOutIfNeeded(state, ownerId, b);
      });
    });
    attacker.damage += 80;
    knockOutIfNeeded(state, playerId, attacker);
  }
};

ATTACK_EFFECTS['Nidoking'] = {
  // Both outcomes land the base 30; heads adds +10, tails adds +10 to
  // Nidoking itself instead.
  'Thrash': function (state, attacker, defender) {
    if (coinFlip(state) === 'H') {
      dealDamage(state, attacker, defender, 40);
    } else {
      dealDamage(state, attacker, defender, 30);
      attacker.damage += 10;
    }
  },
  // Toxic deals its own 20 damage AND poisons with the severe (20/turn)
  // variant -- severePoison rides along on the status object itself (see
  // applyCheckupDamage, rules-engine.js) and gets cleared alongside
  // statusConditions everywhere a Pokémon leaves Active or evolves.
  'Toxic': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    addStatus(defender, 'Poisoned');
    defender.severePoison = true;
  }
};

ATTACK_EFFECTS['Poliwrath'] = {
  'Water Gun': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 30 + extraEnergyBonus(attacker, 'Water', 2, 2));
  },
  'Whirlpool': function (state, attacker, defender, atkDef, playerId) {
    dealDamage(state, attacker, defender, 40);
    discardOneDefenderEnergy(state, defender, playerId);
  }
};

ATTACK_EFFECTS['Raichu'] = {
  'Agility': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  'Thunder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 60);
    if (coinFlip(state) === 'T') { attacker.damage += 30; }
  }
};

ATTACK_EFFECTS['Zapdos'] = {
  // Same Thunder as Raichu's above -- identical real text, but a separate
  // Pokémon key (ATTACK_EFFECTS is keyed by attacker name first).
  'Thunder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 60);
    if (coinFlip(state) === 'T') { attacker.damage += 30; }
  },
  'Thunderbolt': function (state, attacker, defender, atkDef, playerId) {
    var removed = attacker.attachedEnergy.splice(0, attacker.attachedEnergy.length);
    if (playerId) {
      var p = state.players[playerId];
      removed.forEach(function (t) { p.discard.push(discardedEnergyCard(t)); });
    }
    dealDamage(state, attacker, defender, 100);
  }
};

ATTACK_EFFECTS['Dragonair'] = {
  'Slam': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 30 * heads);
  },
  'Hyper Beam': function (state, attacker, defender, atkDef, playerId) {
    dealDamage(state, attacker, defender, 20);
    discardOneDefenderEnergy(state, defender, playerId);
  }
};

ATTACK_EFFECTS['Dugtrio'] = {
  // Slash (plain 40 damage) needs no entry.
  'Earthquake': function (state, attacker, defender, atkDef, playerId) {
    dealDamage(state, attacker, defender, 70);
    if (playerId) {
      state.players[playerId].bench.forEach(function (b) {
        if (!b) { return; }
        b.damage += 10;
        knockOutIfNeeded(state, playerId, b);
      });
    }
  }
};

ATTACK_EFFECTS['Electabuzz'] = {
  'Thundershock': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  },
  'Thunderpunch': function (state, attacker, defender) {
    if (coinFlip(state) === 'H') {
      dealDamage(state, attacker, defender, 40);
    } else {
      dealDamage(state, attacker, defender, 30);
      attacker.damage += 10;
    }
  }
};

ATTACK_EFFECTS['Electrode'] = {
  'Electric Shock': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 50);
    if (coinFlip(state) === 'T') { attacker.damage += 10; }
  }
};

ATTACK_EFFECTS['Pidgeotto'] = {
  'Whirlwind': function (state, attacker, defender, atkDef, playerId) {
    dealDamage(state, attacker, defender, 20);
    forceOpponentSwitch(state, playerId);
  },
  // "If Pidgeotto was attacked last turn, do the final result of that
  // attack on Pidgeotto to the Defending Pokémon" -- replays the flat
  // amount tracked by lastDamageTaken (set on every real dealDamage hit)
  // through a fresh dealDamage call against the CURRENT defender.
  'Mirror Move': function (state, attacker, defender) {
    if (attacker.lastDamageTaken && attacker.lastDamageTaken.turn === state.turnCounter - 1) {
      dealDamage(state, attacker, defender, attacker.lastDamageTaken.amount);
    }
  }
};

ATTACK_EFFECTS['Dewgong'] = {
  // Aurora Beam (plain 50 damage) needs no entry.
  'Ice Beam': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 30);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Magmar'] = {
  // Fire Punch (plain 30 damage) needs no entry.
  'Flamethrower': function (state, attacker, defender, atkDef, playerId) {
    var idx = attacker.attachedEnergy.indexOf('Fire');
    if (idx !== -1) {
      attacker.attachedEnergy.splice(idx, 1);
      if (playerId) { state.players[playerId].discard.push(discardedEnergyCard('Fire')); }
      dealDamage(state, attacker, defender, 50);
    }
  }
};

ATTACK_EFFECTS['Nidorino'] = {
  'Double Kick': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 30 * heads);
  }
  // Horn Drill (plain 50 damage) needs no entry.
};

ATTACK_EFFECTS['Poliwhirl'] = {
  // "Choose 1 of the Defending Pokémon's attacks; that Pokémon can't use
  // it during your opponent's next turn" -- see highestDamageAttack and
  // tempLockedAttack (rules-engine.js's canAttack/endTurn sweep) above.
  'Amnesia': function (state, attacker, defender) {
    var best = highestDamageAttack(defender.name);
    if (best) { defender.tempLockedAttack = { name: best.atk.name, untilTurn: state.turnCounter + 1 }; }
  },
  'Doubleslap': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 30 * heads);
  }
};

ATTACK_EFFECTS['Porygon'] = {
  // Both Conversion attacks let the player pick any non-Colorless type of
  // their choice; a dedicated type-picker UI for this one rarely-played
  // card isn't worth it (same call already made this session for
  // Metronome/Amnesia's opponent-attack choice) -- each auto-picks a
  // fixed, always-valid type instead.
  'Conversion 1': function (state, attacker, defender) {
    var defStats = CARD_STATS[defender.name];
    var hasWeakness = (defStats && defStats.weaknesses && defStats.weaknesses.length) || defender.weaknessOverride;
    if (hasWeakness) { defender.weaknessOverride = { type: 'Fighting', value: '×2' }; }
  },
  'Conversion 2': function (state, attacker) {
    attacker.resistanceOverride = { type: 'Grass', value: '-30' };
  }
};

ATTACK_EFFECTS['Raticate'] = {
  // Bite (plain 20 damage) needs no entry.
  'Super Fang': function (state, attacker, defender) {
    var maxHp = CARD_STATS[defender.name].hp;
    var remaining = Math.max(0, maxHp - defender.damage);
    var dmg = Math.ceil((remaining / 2) / 10) * 10;
    dealDamage(state, attacker, defender, dmg);
  }
};

ATTACK_EFFECTS['Caterpie'] = {
  'String Shot': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Doduo'] = {
  'Fury Attack': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 10 * heads);
  }
};

ATTACK_EFFECTS['Koffing'] = {
  // The first "both coin-flip outcomes are distinct statuses" case --
  // heads Poisons, tails Confuses, unlike every other coin-flip status
  // attack above which only ever has an effect on one side of the flip.
  'Foul Gas': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); } else { addStatus(defender, 'Confused'); }
  }
};

ATTACK_EFFECTS['Metapod'] = {
  'Stiffen': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  'Stun Spore': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Pidgey'] = {
  'Whirlwind': function (state, attacker, defender, atkDef, playerId) {
    dealDamage(state, attacker, defender, 10);
    forceOpponentSwitch(state, playerId);
  }
};

ATTACK_EFFECTS['Poliwag'] = {
  'Water Gun': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10 + extraEnergyBonus(attacker, 'Water', 1, 2));
  }
};

ATTACK_EFFECTS["Farfetch'd"] = {
  'Leek Slap': function (state, attacker, defender) {
    attacker.lockedAttacks.push('Leek Slap');
    if (coinFlip(state) === 'H') { dealDamage(state, attacker, defender, 30); }
  },
  'Pot Smash': function (state, attacker, defender) { dealDamage(state, attacker, defender, 30); }
};
