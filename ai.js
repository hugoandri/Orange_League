function aiBestAffordableAttack(instance) {
  var stats = CARD_STATS[instance.name];
  var payable = (stats.attacks || []).filter(function (a) {
    return instance.lockedAttacks.indexOf(a.name) === -1 && canPayCost(instance, a.cost);
  });
  if (payable.length === 0) { return null; }
  payable.sort(function (a, b) { return (parseInt(b.damage, 10) || 0) - (parseInt(a.damage, 10) || 0); });
  return payable[0];
}

// Mirrors dealDamage's weakness/resistance/PlusPower math (rules-engine.js)
// so Normal/Hard can judge an attack by what it actually does to a specific
// defender, not just the printed number. Shields (Onix's Harden, Squirtle/
// Wartortle's Withdraw) are a temporary, coin-flip-triggered block that
// would need real turn-by-turn tracking to predict reliably -- skipped
// here, so this can occasionally overestimate the one hit a shield blocks.
function estimateDamage(attackerName, baseDamage, defenderName, plusPower) {
  if (baseDamage <= 0) { return 0; }
  var dmg = baseDamage;
  var atkTypes = CARD_STATS[attackerName].types || [];
  var defStats = CARD_STATS[defenderName];
  if (typeHasMatch(defStats.weaknesses, atkTypes)) { dmg *= 2; }
  if (typeHasMatch(defStats.resistances, atkTypes)) { dmg = Math.max(0, dmg - 30); }
  if (plusPower) { dmg += 10; }
  return dmg;
}

function payableAttacks(instance) {
  var stats = CARD_STATS[instance.name];
  return (stats.attacks || []).filter(function (a) {
    return instance.lockedAttacks.indexOf(a.name) === -1 && canPayCost(instance, a.cost);
  });
}

// Normal/Hard: picks by real damage against the actual defender (weakness/
// resistance-aware) instead of Easy's raw printed-number sort.
function aiBestAttackAgainst(instance, defender) {
  if (!defender) { return null; }
  var payable = payableAttacks(instance);
  if (payable.length === 0) { return null; }
  payable.sort(function (a, b) {
    var dmgA = estimateDamage(instance.name, parseInt(a.damage, 10) || 0, defender.name, instance.plusPowerAttached);
    var dmgB = estimateDamage(instance.name, parseInt(b.damage, 10) || 0, defender.name, instance.plusPowerAttached);
    return dmgB - dmgA;
  });
  return payable[0];
}

function aiTryEvolveBench(state, playerId) {
  var p = state.players[playerId];
  var all = (p.active ? [p.active] : []).concat(p.bench.filter(function (b) { return b; }));
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

// Whether instance has any attack this energy type would actually pay
// toward -- either the cost lists this exact type, or it has an open
// Colorless slot any type can fill. A Pokémon with neither gets no value
// at all from one more of this type (e.g. Water energy on a Machop, whose
// only attack costs pure Fighting).
function energyTypeHelpsAttacks(instance, energyType) {
  var stats = CARD_STATS[instance.name];
  return (stats.attacks || []).some(function (a) {
    return a.cost.indexOf(energyType) !== -1 || a.cost.indexOf('Colorless') !== -1;
  });
}

// Easy: always attaches to the Active, exactly as before difficulty tiers
// existed, regardless of whether the type actually helps it.
// Hard: always reasons about it -- if the Active can't actually use this
// energy type for any of its attacks but a Bench Pokémon can, attaches it
// there instead, both building toward a real attacker for later (after a
// retreat, or once the Active is knocked out) and not wasting the turn's
// one attach on a type that does nothing for whoever's out front right now.
// Normal reasons about it too, but only about half the time (rolled off
// state.rng(), same deterministic source as coin flips/shuffles) -- the
// rest of the time it just attaches to the Active like Easy, regardless of
// type fit. Per the user: Normal shouldn't be *consistently* this
// strategic, just occasionally get it right.
function aiTryAttachEnergy(state, playerId, difficulty) {
  var p = state.players[playerId];
  if (!p.active || p.energyAttachedThisTurn) { return false; }
  var handCard = p.hand.find(function (c) { return ENERGY_TYPE_BY_CARD_NAME[c.name]; });
  if (!handCard) { return false; }
  var energyType = ENERGY_TYPE_BY_CARD_NAME[handCard.name];
  var target = p.active;
  var actsSmart = difficulty === 'hard' || (difficulty === 'normal' && state.rng() < 0.5);
  if (actsSmart && !energyTypeHelpsAttacks(p.active, energyType)) {
    var benchMatch = p.bench.find(function (b) { return b && energyTypeHelpsAttacks(b, energyType); });
    if (benchMatch) { target = benchMatch; }
  }
  if (!canAttachEnergy(state, playerId, handCard.id, target.id)) { return false; }
  attachEnergy(state, playerId, handCard.id, target.id);
  return true;
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

// Normal/Hard: pulls the opponent's weakest/most-damaged Bench Pokémon into
// their Active spot with Gust of Wind whenever the CPU's own Active could
// knock it out this turn -- a free/cheap prize the opponent didn't offer up
// themselves by attacking with it.
function aiTryGustSnipe(state, playerId) {
  var p = state.players[playerId];
  if (!p.active) { return false; }
  var gust = p.hand.find(function (c) { return c.name === 'Gust of Wind'; });
  if (!gust) { return false; }
  var op = state.players[opponentOf(playerId)];
  var target = op.bench.filter(function (b) { return b; }).find(function (b) {
    var best = aiBestAttackAgainst(p.active, b);
    if (!best) { return false; }
    var dmg = estimateDamage(p.active.name, parseInt(best.damage, 10) || 0, b.name, p.active.plusPowerAttached);
    return dmg >= (CARD_STATS[b.name].hp - b.damage);
  });
  if (!target) { return false; }
  TRAINER_EFFECTS['Gust of Wind'](state, playerId, gust.id, target.id);
  return true;
}

// Normal (onlyIfNeeded=false): attaches PlusPower to the Active whenever it
// would push the best attack into lethal range this turn, even if the plain
// attack was already lethal on its own (a bit wasteful, matching Normal's
// "knows some strategies" rather than "master" ceiling).
// Hard (onlyIfNeeded=true): same check, but skips it when the plain attack
// already secures the KO -- the precise-timing behavior the user asked for.
function aiTryPlusPower(state, playerId, onlyIfNeeded) {
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  if (!p.active || p.active.plusPowerAttached || !op.active) { return false; }
  var plusPower = p.hand.find(function (c) { return c.name === 'PlusPower'; });
  if (!plusPower) { return false; }
  var best = aiBestAttackAgainst(p.active, op.active);
  if (!best) { return false; }
  var baseDamage = parseInt(best.damage, 10) || 0;
  var withoutBonus = estimateDamage(p.active.name, baseDamage, op.active.name, false);
  var withBonus = withoutBonus + 10;
  var remainingHp = CARD_STATS[op.active.name].hp - op.active.damage;
  if (withBonus < remainingHp) { return false; } // wouldn't even secure the KO -- not worth it here
  if (onlyIfNeeded && withoutBonus >= remainingHp) { return false; } // already lethal, don't waste it
  TRAINER_EFFECTS['PlusPower'](state, playerId, plusPower.id, p.active.id);
  return true;
}

// Hard only: Energy Removal / Super Energy Removal are only worth playing
// the exact turn they deny the opponent's best attack next turn (i.e. their
// Active currently has JUST enough energy for it) -- playing them the
// moment they're drawn just delays the same removal by a turn without
// changing what it accomplishes, which is what Normal/Easy still do (they
// don't play these at all).
function aiTryEnergyDisruption(state, playerId) {
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  if (!op.active || op.active.attachedEnergy.length === 0) { return false; }
  var oppBest = aiBestAffordableAttack(op.active); // what they could do right now, on their own terms
  if (!oppBest) { return false; } // already can't attack -- no need to disrupt
  var oppStats = CARD_STATS[op.active.name];
  var atkDef = oppStats.attacks.find(function (a) { return a.name === oppBest.name; });
  var costLen = atkDef.cost.length;
  var superRemoval = p.hand.find(function (c) { return c.name === 'Super Energy Removal'; });
  if (superRemoval && p.active && p.active.attachedEnergy.length > 0) {
    if (op.active.attachedEnergy.length - 2 < costLen) {
      TRAINER_EFFECTS['Super Energy Removal'](state, playerId, superRemoval.id, p.active.id, op.active.id);
      return true;
    }
  }
  var removal = p.hand.find(function (c) { return c.name === 'Energy Removal'; });
  if (removal && (op.active.attachedEnergy.length - 1 < costLen)) {
    TRAINER_EFFECTS['Energy Removal'](state, playerId, removal.id, op.active.id);
    return true;
  }
  return false;
}

// Hard only: decides whether to retreat INSTEAD of attacking this turn --
// never overrides a KO the CPU can secure right now, but if the best
// available attack falls short and staying Active would leave it exposed
// to the opponent's own best attack next turn, retreats to a Bench Pokémon
// that can still fight instead of trading into that hit.
function aiShouldRetreatInsteadOfAttack(state, playerId) {
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  if (!p.active || !op.active) { return null; }
  var myBest = aiBestAttackAgainst(p.active, op.active);
  var myBestDmg = myBest ? estimateDamage(p.active.name, parseInt(myBest.damage, 10) || 0, op.active.name, p.active.plusPowerAttached) : 0;
  var opRemainingHp = CARD_STATS[op.active.name].hp - op.active.damage;
  if (myBest && myBestDmg >= opRemainingHp) { return null; } // securing a KO always comes first
  var oppBest = aiBestAffordableAttack(op.active);
  if (!oppBest) { return null; } // no threat next turn, no need to run
  var oppDmg = estimateDamage(op.active.name, parseInt(oppBest.damage, 10) || 0, p.active.name, false);
  var myRemainingHp = CARD_STATS[p.active.name].hp - p.active.damage;
  if (oppDmg < myRemainingHp) { return null; } // safe enough to stay
  return p.bench.find(function (b) { return b && aiBestAffordableAttack(b) !== null && canRetreat(state, playerId, b.id); }) || null;
}

// Normal/Hard: decides whether to retreat instead of attacking this turn.
// Easy never does (matches its unchanged, attack-first behavior). Normal
// uses a flat HP threshold; Hard reasons about the actual trade (see
// aiShouldRetreatInsteadOfAttack's own comment).
function aiProactiveRetreat(state, playerId, difficulty) {
  if (difficulty === 'easy') { return null; }
  if (difficulty === 'hard') { return aiShouldRetreatInsteadOfAttack(state, playerId); }
  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  if (!p.active) { return null; }
  var remainingHp = CARD_STATS[p.active.name].hp - p.active.damage;
  if (remainingHp > 30) { return null; }
  return p.bench.find(function (b) { return b && aiBestAttackAgainst(b, op.active) !== null && canRetreat(state, playerId, b.id); }) || null;
}

// difficulty: 'easy' (default, unchanged from before tiers existed), 'normal',
// or 'hard'. Callers (ui.js) pick how long to visually "think" before
// invoking this based on the same value -- this function itself stays fully
// synchronous either way, so tests that call it directly keep working
// exactly as before when difficulty is omitted.
function cpuTakeTurn(state, difficulty) {
  difficulty = difficulty || 'easy';
  var playerId = state.activePlayerId;
  // The CPU's turn-start draw happens here (rather than in endTurn(),
  // rules-engine.js, which can run well before the CPU actually acts --
  // e.g. right when the player attacks, which ends their turn internally
  // but waits for an explicit "Terminar turno" click before the CPU moves)
  // so the player never sees the CPU's hand count go up before its turn is
  // actually being played out. Skipped on turn 1 (nobody draws going
  // first), matching endTurn()'s own condition for the player's side.
  if (state.turnCounter > 1) { drawForTurnStart(state, playerId); }
  if (state.turnDrewCard) { logEvent(state, 'Turno del Rival - Roba 1 Carta', 'cpu'); }
  var guard = 0;
  while (guard < 20) {
    guard++;
    if (aiTryEvolveBench(state, playerId)) { continue; }
    if (aiTryAttachEnergy(state, playerId, difficulty)) { continue; }
    if (aiTryPlayBasic(state, playerId)) { continue; }
    if (difficulty !== 'easy' && aiTryGustSnipe(state, playerId)) { continue; }
    if (difficulty === 'hard' && aiTryEnergyDisruption(state, playerId)) { continue; }
    if (difficulty !== 'easy' && aiTryPlusPower(state, playerId, difficulty === 'hard')) { continue; }
    if (aiTryUseTrainer(state, playerId)) { continue; }
    break;
  }

  var p = state.players[playerId];
  var op = state.players[opponentOf(playerId)];
  // A retreat swaps who's Active (and pays its cost from the Pokémon
  // LEAVING, not the one coming in) -- it doesn't end the turn on its own,
  // real rules let the same turn's attack still happen with whoever's
  // Active afterward. This used to return right after retreating here,
  // which meant a Bench Pokémon switched in with plenty of energy attached
  // (its own, untouched by the retreat cost) never got to attack the very
  // turn it came in.
  if (p.active) {
    var proactive = aiProactiveRetreat(state, playerId, difficulty);
    if (proactive) { retreat(state, playerId, proactive.id); }
  }
  if (p.active) {
    var best = difficulty === 'easy' ? aiBestAffordableAttack(p.active) : aiBestAttackAgainst(p.active, op.active);
    if (best && canAttack(state, playerId, best.name)) {
      attack(state, playerId, best.name);
      return;
    }
    var firstBenched = p.bench.filter(function (b) { return b; })[0];
    if (firstBenched && canRetreat(state, playerId, firstBenched.id)) {
      var betterBench = difficulty === 'easy'
        ? p.bench.find(function (b) { return b && aiBestAffordableAttack(b) !== null; })
        : p.bench.find(function (b) { return b && aiBestAttackAgainst(b, op.active) !== null; });
      if (betterBench) { retreat(state, playerId, betterBench.id); }
    }
  }
  endTurn(state);
}
