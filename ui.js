var gameState = null;
var econState = null;

function renderCoinCount() {
  document.getElementById('coin-count').textContent = econState.coins;
}

var ENERGY_ICON = { Grass: '🌿', Fire: '🔥', Water: '💧', Lightning: '⚡', Psychic: '🔮', Fighting: '🥊', Colorless: '⚪' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function pokemonCardHtml(instance, isActive, ownerClass, big) {
  var stats = CARD_STATS[instance.name];
  var hpLine = (stats.hp - instance.damage) + '/' + stats.hp + ' HP';
  var statusLine = instance.statusConditions.length ? ' [' + instance.statusConditions.map(translateStatus).join(', ') + ']' : '';
  var cls = 'pokemon-card' + (isActive ? ' ' + ownerClass : '') + (big ? ' active-card' : '');
  return '<div class="' + cls + '" data-instance-id="' + instance.id + '">' +
    '<strong>' + instance.name + '</strong><br>' + hpLine + statusLine +
    '<br>Energía: ' + instance.attachedEnergy.join(',') + '</div>';
}

function activeSlotHtml(activeInstance, ownerClass) {
  if (activeInstance) { return '<div class="active-row">' + pokemonCardHtml(activeInstance, true, ownerClass, true) + '</div>'; }
  return '<div class="active-row"><div class="bench-slot">Sin Activo</div></div>';
}

function benchSlotsHtml(bench) {
  var html = '<div class="bench-row">';
  for (var i = 0; i < 5; i++) {
    html += bench[i] ? pokemonCardHtml(bench[i], false, '') : '<div class="bench-slot">Vacío</div>';
  }
  html += '</div>';
  return html;
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;
  var html = '';
  html += '<h3>CPU</h3>';
  html += '<p class="active-label">Activo</p>' + activeSlotHtml(c.active, 'active-cpu');
  html += '<p class="bench-label">Banca (' + c.bench.length + '/5)</p>' + benchSlotsHtml(c.bench);
  html += '<p>Descarte CPU: ' + c.discard.length + '</p>';

  html += '<h3>Tú</h3>';
  html += '<p class="active-label">Activo</p>' + activeSlotHtml(p.active, 'active-player');
  html += '<p class="bench-label">Banca (' + p.bench.length + '/5)</p>' + benchSlotsHtml(p.bench);
  html += '<p>Descarte: ' + p.discard.length + '</p>';

  html += '<h4>Mano</h4><div class="hand-row">';
  p.hand.forEach(function (card) {
    html += '<button class="action-btn hand-card" data-hand-id="' + card.id + '">' + card.name + '</button>';
  });
  html += '</div>';

  if (p.active) {
    html += '<h4>Ataques</h4>';
    (CARD_STATS[p.active.name].attacks || []).forEach(function (atk) {
      var can = canAttack(s, 'player', atk.name);
      var costLabel = atk.cost.map(function (c) { return ENERGY_ICON[c] || c; }).join(' ');
      html += '<div class="attack-option">';
      html += '<button class="action-btn attack-btn" data-attack-name="' + atk.name + '"' + (can ? '' : ' disabled') + '>' +
        escapeHtml(atk.name) + ' [' + costLabel + '] · ' + (atk.damage || '0') + ' dmg</button>';
      if (atk.text) { html += '<div class="attack-effect-text">' + escapeHtml(atk.text) + '</div>'; }
      html += '</div>';
    });
  }

  if (p.bench.length > 0) {
    html += '<h4>Retirarse</h4>';
    p.bench.forEach(function (b) {
      var canRet = canRetreat(s, 'player', b.id);
      html += '<button class="action-btn retreat-btn" data-bench-id="' + b.id + '"' + (canRet ? '' : ' disabled') + '>Retirar a ' + b.name + '</button>';
    });
  }

  // Attacking is the only built-in way rules-engine.js advances the turn.
  // On the very first turn of the match, attacking is always illegal
  // (canAttack forbids turnCounter === 1), so without an explicit way to
  // end the turn the player going first would be stuck forever. Also cover
  // any turn where the player simply has no attack they want to (or can)
  // use — mirrors cpuTakeTurn()'s own unconditional endTurn() fallback.
  if (s.activePlayerId === 'player') {
    html += '<button class="action-btn" id="endTurnBtn">Pasar turno</button>';
  }

  html += '<p>Premios restantes — Tú: ' + p.prizes.length + ' · CPU: ' + c.prizes.length + '</p>';

  document.getElementById('app').innerHTML = html;
  document.getElementById('log').textContent = s.log.slice(-30).join('\n');
  wireBoardButtons();
}

function afterPlayerAction() {
  // getWinner() itself now tracks hasHadActive per player (rules-engine.js),
  // so it correctly returns null before either side has placed their
  // opening Basic Pokémon — no UI-side workaround needed here anymore.
  var winner = getWinner(gameState);
  if (winner) { finishMatch(winner); return; }
  if (gameState.activePlayerId === 'cpu') {
    cpuTakeTurn(gameState);
    var winner2 = getWinner(gameState);
    if (winner2) { finishMatch(winner2); return; }
  }
  renderBoard();
}

function finishMatch(winner) {
  econState = winner === 'player' ? awardWin(econState) : awardLoss(econState);
  saveEconomy(econState);
  renderCoinCount();
  document.getElementById('app').innerHTML += '<p><strong>' + (winner === 'player' ? 'Ganaste' : 'Perdiste') + '</strong></p>' +
    '<button class="action-btn" id="newMatchBtn">Nueva partida</button>';
  document.getElementById('newMatchBtn').addEventListener('click', startNewMatch);
}

function wireBoardButtons() {
  var handButtons = document.querySelectorAll('.hand-card');
  var selectedHandId = null;
  handButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var handId = btn.getAttribute('data-hand-id');
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === handId; });
      if (!handCard) { return; }

      // Bill and Professor Oak ignore their target argument entirely (they
      // don't need one) -- dispatch them immediately instead of waiting for
      // a board-Pokémon click, since the board can even be completely empty.
      if (handCard.name === 'Bill' || handCard.name === 'Professor Oak') {
        var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', handId);
        if (result && !result.legal) { logEvent(gameState, result.reason); }
        selectedHandId = null;
        renderBoard();
        return;
      }

      // Placing your very first Basic Pokémon into an empty Active spot needs
      // no target (playBasic() ignores the target instance in that case) —
      // and when the board is completely empty (true game start), there is
      // no .pokemon-card element on the page to click as a target anyway.
      // So complete the play immediately instead of waiting for a target click.
      if (p.active === null && isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', handId)) {
        playBasic(gameState, 'player', handId);
        selectedHandId = null;
        renderBoard();
        return;
      }
      selectedHandId = handId;
    });
  });

  var attackButtons = document.querySelectorAll('.attack-btn');
  attackButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-attack-name');
      if (canAttack(gameState, 'player', name)) { attack(gameState, 'player', name); afterPlayerAction(); }
    });
  });

  var endTurnBtn = document.getElementById('endTurnBtn');
  if (endTurnBtn) {
    endTurnBtn.addEventListener('click', function () {
      if (gameState.activePlayerId === 'player') { endTurn(gameState); afterPlayerAction(); }
    });
  }

  var retreatButtons = document.querySelectorAll('.retreat-btn');
  retreatButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var benchId = btn.getAttribute('data-bench-id');
      if (canRetreat(gameState, 'player', benchId)) { retreat(gameState, 'player', benchId); afterPlayerAction(); }
    });
  });

  document.querySelectorAll('.pokemon-card').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!selectedHandId) { return; }
      var instanceId = el.getAttribute('data-instance-id');
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      if (isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', selectedHandId)) {
        playBasic(gameState, 'player', selectedHandId);
      } else if (canEvolve(gameState, 'player', selectedHandId, instanceId)) {
        evolve(gameState, 'player', selectedHandId, instanceId);
      } else if (canAttachEnergy(gameState, 'player', selectedHandId, instanceId)) {
        attachEnergy(gameState, 'player', selectedHandId, instanceId);
      } else if (TRAINER_EFFECTS[handCard.name]) {
        var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', selectedHandId, instanceId);
        if (result && !result.legal) { logEvent(gameState, result.reason); }
      }
      selectedHandId = null;
      renderBoard();
    });
  });
}

function startNewMatch() {
  gameState = createGame(Math.random);
  renderBoard();
  if (gameState.activePlayerId === 'cpu') { afterPlayerAction(); }
}

function renderCollection() {
  var html = '<h3>Comprar sobre</h3>';
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    html += '<button class="action-btn buy-booster-btn" data-set="' + setKey + '">Comprar sobre (' + setKey + ') — 100 monedas</button>';
  });
  document.getElementById('booster-shop').innerHTML = html;
  document.querySelectorAll('.buy-booster-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var result = buyBooster(econState, btn.getAttribute('data-set'), Math.random);
      if (!result) { alert('No tienes suficientes monedas.'); return; }
      econState = result.economy;
      saveEconomy(econState);
      renderCoinCount();
      renderCollectionGrid();
    });
  });
  renderCollectionGrid();
}

function renderCollectionGrid() {
  var total = 0, owned = 0;
  var html = '';
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    html += '<h4>' + setKey + '</h4><div class="board-row">';
    CARD_CATALOG[setKey].forEach(function (c) {
      total++;
      var key = setKey + '-' + c.num;
      var count = econState.collection[key] || 0;
      if (count > 0) { owned++; }
      html += '<div class="pokemon-card">' + c.n + '<br>x' + count + '</div>';
    });
    html += '</div>';
  });
  html = '<p>' + owned + ' / ' + total + ' cartas distintas</p>' + html;
  document.getElementById('collection-view').innerHTML = html;
}

document.addEventListener('DOMContentLoaded', function () {
  econState = loadEconomy();
  renderCoinCount();
  startNewMatch();

  document.getElementById('tabBtnPlay').addEventListener('click', function () {
    document.getElementById('tabBtnPlay').classList.add('active');
    document.getElementById('tabBtnCollection').classList.remove('active');
    document.getElementById('panelPlay').classList.add('active');
    document.getElementById('panelCollection').classList.remove('active');
  });
  document.getElementById('tabBtnCollection').addEventListener('click', function () {
    document.getElementById('tabBtnCollection').classList.add('active');
    document.getElementById('tabBtnPlay').classList.remove('active');
    document.getElementById('panelCollection').classList.add('active');
    document.getElementById('panelPlay').classList.remove('active');
    renderCollection();
  });
});
