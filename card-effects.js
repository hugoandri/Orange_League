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

TRAINER_EFFECTS['Super Potion'] = function (state, playerId, handId, targetInstanceId) {
  if (state.activePlayerId !== playerId) { return { legal: false, reason: 'No se puede jugar' }; }
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no hay energía para descartar' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var removedEnergy = target.attachedEnergy.splice(0, 1);
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
  var benchIdx = p.bench.findIndex(function (b) { return b.id === benchInstanceId; });
  if (benchIdx === -1) { return { legal: false, reason: 'ese Pokémon no está en tu banca' }; }
  var card = p.hand.splice(idx, 1)[0];
  p.discard.push(card);
  var incoming = p.bench.splice(benchIdx, 1)[0];
  if (p.active) {
    p.active.statusConditions = [];
    p.active.shield = null;
    p.active.missChanceUntilTurn = null;
    p.bench.push(p.active);
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
  var idx = op.bench.findIndex(function (b) { return b.id === opponentBenchInstanceId; });
  if (idx === -1) { return { legal: false, reason: 'ese Pokémon no está en la banca rival' }; }
  var handIdx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (handIdx === -1) { return { legal: false, reason: 'esa carta no está en tu mano' }; }
  var card = p.hand.splice(handIdx, 1)[0];
  p.discard.push(card);
  var incoming = op.bench.splice(idx, 1)[0];
  if (op.active) {
    op.active.statusConditions = [];
    op.active.shield = null;
    op.active.missChanceUntilTurn = null;
    op.bench.push(op.active);
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

TRAINER_EFFECTS['Super Energy Removal'] = function (state, playerId, handId, ownInstanceId, opponentInstanceId) {
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
  var ownRemoved = own.attachedEnergy.splice(0, 1);
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

ATTACK_EFFECTS["Farfetch'd"] = {
  'Leek Slap': function (state, attacker, defender) {
    attacker.lockedAttacks.push('Leek Slap');
    if (coinFlip(state) === 'H') { dealDamage(state, attacker, defender, 30); }
  },
  'Pot Smash': function (state, attacker, defender) { dealDamage(state, attacker, defender, 30); }
};
