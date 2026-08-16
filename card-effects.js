var TRAINER_EFFECTS = {};

TRAINER_EFFECTS['Bill'] = function (state, playerId, handId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(idx, 1);
  drawCard(state, playerId, 2);
  logEvent(state, playerId + ' juega Bill (roba 2)');
  return { legal: true };
};

TRAINER_EFFECTS['Potion'] = function (state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target) { return { legal: false, reason: 'no target' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(idx, 1);
  target.damage = Math.max(0, target.damage - 20);
  logEvent(state, playerId + ' usa Potion en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['Super Potion'] = function (state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no energy to discard' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(idx, 1);
  target.attachedEnergy.splice(0, 1);
  target.damage = Math.max(0, target.damage - 40);
  logEvent(state, playerId + ' usa Super Potion en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['Switch'] = function (state, playerId, handId, benchInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  var benchIdx = p.bench.findIndex(function (b) { return b.id === benchInstanceId; });
  if (benchIdx === -1) { return { legal: false, reason: 'no such bench Pokémon' }; }
  p.hand.splice(idx, 1);
  var incoming = p.bench.splice(benchIdx, 1)[0];
  if (p.active) { p.bench.push(p.active); }
  p.active = incoming;
  logEvent(state, playerId + ' usa Switch');
  return { legal: true };
};

TRAINER_EFFECTS['Professor Oak'] = function (state, playerId, handId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand = [];
  drawCard(state, playerId, 7);
  logEvent(state, playerId + ' juega Professor Oak (descarta mano, roba 7)');
  return { legal: true };
};

TRAINER_EFFECTS['Gust of Wind'] = function (state, playerId, handId, opponentBenchInstanceId) {
  var p = state.players[playerId];
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var idx = op.bench.findIndex(function (b) { return b.id === opponentBenchInstanceId; });
  if (idx === -1) { return { legal: false, reason: 'no such opponent bench Pokémon' }; }
  var handIdx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (handIdx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(handIdx, 1);
  var incoming = op.bench.splice(idx, 1)[0];
  if (op.active) { op.bench.push(op.active); }
  op.active = incoming;
  logEvent(state, playerId + ' usa Gust of Wind');
  return { legal: true };
};

TRAINER_EFFECTS['Energy Removal'] = function (state, playerId, handId, opponentInstanceId) {
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var target = findInstance(op, opponentInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no energy to remove' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(idx, 1);
  target.attachedEnergy.splice(0, 1);
  logEvent(state, playerId + ' usa Energy Removal en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['Super Energy Removal'] = function (state, playerId, handId, ownInstanceId, opponentInstanceId) {
  var p = state.players[playerId];
  var own = findInstance(p, ownInstanceId);
  if (!own || own.attachedEnergy.length === 0) { return { legal: false, reason: 'no own energy to discard as cost' }; }
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var target = findInstance(op, opponentInstanceId);
  if (!target) { return { legal: false, reason: 'no opponent target' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(idx, 1);
  own.attachedEnergy.splice(0, 1);
  target.attachedEnergy.splice(0, Math.min(2, target.attachedEnergy.length));
  logEvent(state, playerId + ' usa Super Energy Removal en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['PlusPower'] = function (state, playerId, handId, ownInstanceId) {
  var p = state.players[playerId];
  var target = findInstance(p, ownInstanceId);
  if (!target || target !== p.active) { return { legal: false, reason: 'PlusPower can only attach to your Active Pokémon' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  if (idx === -1) { return { legal: false, reason: 'card not in hand' }; }
  p.hand.splice(idx, 1);
  target.plusPowerAttached = true;
  logEvent(state, playerId + ' adjunta PlusPower a ' + target.name);
  return { legal: true };
};

var ATTACK_EFFECTS = {};
