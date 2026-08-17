function aiBestAffordableAttack(instance) {
  var stats = CARD_STATS[instance.name];
  var payable = (stats.attacks || []).filter(function (a) {
    return instance.lockedAttacks.indexOf(a.name) === -1 && canPayCost(instance, a.cost);
  });
  if (payable.length === 0) { return null; }
  payable.sort(function (a, b) { return (parseInt(b.damage, 10) || 0) - (parseInt(a.damage, 10) || 0); });
  return payable[0];
}

function aiTryEvolveBench(state, playerId) {
  var p = state.players[playerId];
  var all = (p.active ? [p.active] : []).concat(p.bench);
  for (var i = 0; i < all.length; i++) {
    var target = all[i];
    var handCard = p.hand.find(function (c) { return canEvolve(state, playerId, c.id, target.id); });
    if (handCard) { evolve(state, playerId, handCard.id, target.id); return true; }
  }
  return false;
}

function aiTryPlayBasic(state, playerId) {
  var p = state.players[playerId];
  var handCard = p.hand.find(function (c) { return canPlayBasic(state, playerId, c.id); });
  if (handCard) { playBasic(state, playerId, handCard.id); return true; }
  return false;
}

// Called once during the 'setup' phase to place the CPU's opening Active
// and fill its Bench (up to 5) from its opening hand, before the coin flip.
function aiSetupBoard(state, playerId) {
  while (aiTryPlayBasic(state, playerId)) {}
}

function aiTryAttachEnergy(state, playerId) {
  var p = state.players[playerId];
  if (!p.active || p.energyAttachedThisTurn) { return false; }
  var handCard = p.hand.find(function (c) { return canAttachEnergy(state, playerId, c.id, p.active.id); });
  if (handCard) { attachEnergy(state, playerId, handCard.id, p.active.id); return true; }
  return false;
}

function aiTryUseTrainer(state, playerId) {
  var p = state.players[playerId];
  if (p.active && p.active.damage > 0) {
    var potion = p.hand.find(function (c) { return c.name === 'Potion'; });
    if (potion) { TRAINER_EFFECTS['Potion'](state, playerId, potion.id, p.active.id); return true; }
  }
  if (p.hand.length <= 2) {
    var oak = p.hand.find(function (c) { return c.name === 'Professor Oak'; });
    if (oak) { TRAINER_EFFECTS['Professor Oak'](state, playerId, oak.id); return true; }
  }
  return false;
}

function cpuTakeTurn(state) {
  var playerId = state.activePlayerId;
  // Logged here (rather than in endTurn(), which flips activePlayerId to
  // 'cpu' as soon as the player's turn ends -- including immediately on
  // attack(), well before the player clicks "Terminar turno") so the line
  // only appears once the CPU's turn is actually being played out, matching
  // the same turnCounter > 1 gating endTurn() uses for the draw itself.
  if (state.turnCounter > 1) { logEvent(state, 'Turno del Rival - Roba 1 Carta', 'cpu'); }
  var guard = 0;
  while (guard < 20) {
    guard++;
    if (aiTryEvolveBench(state, playerId)) { continue; }
    if (aiTryAttachEnergy(state, playerId)) { continue; }
    if (aiTryPlayBasic(state, playerId)) { continue; }
    if (aiTryUseTrainer(state, playerId)) { continue; }
    break;
  }

  var p = state.players[playerId];
  if (p.active) {
    var best = aiBestAffordableAttack(p.active);
    if (best && canAttack(state, playerId, best.name)) {
      attack(state, playerId, best.name);
      return;
    }
    if (p.bench.length > 0 && canRetreat(state, playerId, p.bench[0].id)) {
      var betterBench = p.bench.find(function (b) { return aiBestAffordableAttack(b) !== null; });
      if (betterBench) { retreat(state, playerId, betterBench.id); }
    }
  }
  endTurn(state);
}
