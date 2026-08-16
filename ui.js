var gameState = null;
var econState = null;

function renderCoinCount() {
  document.getElementById('coin-count').textContent = econState.coins;
}

var ENERGY_ICON = { Grass: '🌿', Fire: '🔥', Water: '💧', Lightning: '⚡', Psychic: '🔮', Fighting: '🥊', Colorless: '⚪' };

// Real Base Set-era card back, sourced from Bulbapedia (archives.bulbagarden.net),
// verified reachable (HTTP 200) before use.
var CARD_BACK_URL = 'https://archives.bulbagarden.net/media/upload/1/17/Cardback.jpg';

// Real card artwork, reused from the same catalog data that backs the
// booster/collection feature (data-sets.js) -- every card in Overgrowth and
// Blackout is a Base Set card, so this lookup covers the whole game.
var CARD_IMAGE_BY_NAME = {};
(CARD_CATALOG.base || []).forEach(function (c) { CARD_IMAGE_BY_NAME[c.n] = c.img; });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function cardImageTag(name, cls) {
  var url = CARD_IMAGE_BY_NAME[name];
  return url ? '<img class="' + cls + '" src="' + url + '" alt="' + escapeHtml(name) + '" loading="lazy">' : '';
}

// A small 🔍 control, separate from the card's own click target, so
// enlarging a card never fires the game action (play/attach/target) that
// clicking the rest of the card triggers. Wired with stopPropagation().
function magnifyBtnHtml(name) {
  if (!CARD_IMAGE_BY_NAME[name]) { return ''; }
  return '<button type="button" class="magnify-btn" data-card-name="' + escapeHtml(name) + '" title="Ver carta">🔍</button>';
}

function openCardModal(name) {
  var url = CARD_IMAGE_BY_NAME[name];
  if (!url) { return; }
  var img = document.getElementById('cardModalImg');
  img.src = url;
  img.alt = name;
  document.getElementById('cardModal').classList.remove('hidden');
}

function closeCardModal() {
  document.getElementById('cardModal').classList.add('hidden');
}

function pokemonCardHtml(instance, isActive, ownerClass, big) {
  var stats = CARD_STATS[instance.name];
  var hpLine = (stats.hp - instance.damage) + '/' + stats.hp + ' HP';
  var statusLine = instance.statusConditions.length ? ' [' + instance.statusConditions.map(translateStatus).join(', ') + ']' : '';
  var cls = 'pokemon-card' + (isActive ? ' ' + ownerClass : '') + (big ? ' active-card' : '');
  return '<div class="' + cls + '" data-instance-id="' + instance.id + '">' +
    magnifyBtnHtml(instance.name) + cardImageTag(instance.name, 'card-thumb') +
    '<strong>' + instance.name + '</strong><br>' + hpLine + statusLine +
    '<br>Energía: ' + instance.attachedEnergy.map(function (e) { return ENERGY_ICON[e] || e; }).join(' ') + '</div>';
}

function activeSlotHtml(activeInstance, ownerClass) {
  if (activeInstance) { return '<div class="active-row">' + pokemonCardHtml(activeInstance, true, ownerClass, true) + '</div>'; }
  return '<div class="active-row"><div class="bench-slot">Sin Activo</div></div>';
}

function benchSlotsHtml(bench, ownerId) {
  var html = '<div class="bench-row">';
  for (var i = 0; i < 5; i++) {
    if (bench[i]) {
      html += pokemonCardHtml(bench[i], false, '');
    } else if (ownerId === 'player') {
      html += '<div class="bench-slot bench-slot-empty" data-owner="player">Vacío</div>';
    } else {
      html += '<div class="bench-slot">Vacío</div>';
    }
  }
  html += '</div>';
  return html;
}

// Each prize is a specific, already-determined face-down card (set aside in
// createGame). When the player has a pending choice (rules-engine.js's
// state.pendingPrizeChoice), their own prize cards become clickable so they
// pick which one to flip -- instead of it being auto-resolved.
function prizeColumnHtml(state, ownerId) {
  var p = state.players[ownerId];
  var choosable = ownerId === 'player' && state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === 'player';
  var html = '<div class="prize-column"><p class="prize-label">Premios (' + p.prizes.length + ')</p><div class="prize-grid">';
  for (var i = 0; i < p.prizes.length; i++) {
    var cls = 'prize-card' + (choosable ? ' prize-choosable' : '');
    html += '<div class="' + cls + '"' + (choosable ? ' data-prize-index="' + i + '" title="Elegir esta carta de premio"' : '') + '>' +
      '<img src="' + CARD_BACK_URL + '" alt="Carta de premio boca abajo" loading="lazy"></div>';
  }
  html += '</div></div>';
  return html;
}

function attacksPanelHtml(s) {
  var p = s.players.player;
  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';
  if (s.phase === 'setup' || pendingPlayerPrize || !p.active) { return ''; }
  var html = '<div class="attacks-panel"><h4>Ataques</h4>';
  (CARD_STATS[p.active.name].attacks || []).forEach(function (atk) {
    var can = canAttack(s, 'player', atk.name);
    var costLabel = atk.cost.map(function (c) { return ENERGY_ICON[c] || c; }).join(' ');
    html += '<div class="attack-option">';
    html += '<button class="action-btn attack-btn" data-attack-name="' + atk.name + '"' + (can ? '' : ' disabled') + '>' +
      escapeHtml(atk.name) + ' [' + costLabel + '] · ' + (atk.damage || '0') + ' dmg</button>';
    if (atk.text) { html += '<div class="attack-effect-text">' + escapeHtml(atk.text) + '</div>'; }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;
  var html = '';
  // The CPU's side runs Bench-then-Active (top to bottom) while the
  // player's runs Active-then-Bench, so the two Actives meet in the middle
  // like facing across a real table, instead of both sides reading the
  // same top-to-bottom order as if looking the same direction.
  html += '<h3>CPU</h3><div class="side-row"><div class="side-board">';
  html += '<p class="bench-label">Banca (' + c.bench.length + '/5)</p>' + benchSlotsHtml(c.bench, 'cpu');
  html += '<p class="active-label">Activo</p>' + activeSlotHtml(c.active, 'active-cpu');
  html += '</div>' + prizeColumnHtml(s, 'cpu') + '</div>';
  html += '<p>Descarte CPU: ' + c.discard.length + '</p>';

  html += '<h3>Tú</h3><div class="side-row"><div class="side-board">';
  html += '<div class="active-with-attacks"><div>';
  html += '<p class="active-label">Activo</p>' + activeSlotHtml(p.active, 'active-player');
  html += '</div>' + attacksPanelHtml(s) + '</div>';
  html += '<p class="bench-label">Banca (' + p.bench.length + '/5)</p>' + benchSlotsHtml(p.bench, 'player');
  html += '</div>' + prizeColumnHtml(s, 'player') + '</div>';
  html += '<p>Descarte: ' + p.discard.length + '</p>';

  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';

  if (pendingPlayerPrize) {
    html += '<div class="setup-panel"><p>¡Noqueaste un Pokémon! Elegí una de tus cartas de premio (boca abajo, arriba) para tomarla.</p></div>';
    document.getElementById('app').innerHTML = html;
    document.getElementById('log').textContent = s.log.slice(-30).join('\n');
    wireBoardButtons();
    return;
  }

  html += '<h4>Mano</h4><div class="hand-row">';
  p.hand.forEach(function (card) {
    // During setup, only Basic Pokémon can be placed -- Energy/Trainer cards
    // can't be used until the match actually starts.
    var disabled = s.phase === 'setup' && !isBasicPokemon(card.name);
    html += '<div class="hand-card-wrap">' + magnifyBtnHtml(card.name) +
      '<button class="action-btn hand-card" data-hand-id="' + card.id + '"' + (disabled ? ' disabled' : '') + '>' +
      cardImageTag(card.name, 'card-thumb-hand') + '<span>' + escapeHtml(card.name) + '</span></button></div>';
  });
  html += '</div>';

  if (s.phase === 'setup') {
    html += '<div class="setup-panel"><p>Coloca tu Pokémon Activo y, si quieres, tu Banca (máx. 5) antes de empezar.</p>';
    html += '<button class="action-btn" id="startMatchBtn"' + (p.active ? '' : ' disabled') + '>🪙 Lanzar moneda y comenzar</button></div>';
  } else {
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
  }

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
  // Don't let the CPU take its turn while the player still has a prize card
  // to pick -- render the choice prompt first and wait for it to resolve.
  if (gameState.pendingPrizeChoice && gameState.pendingPrizeChoice.playerId === 'player') {
    renderBoard();
    return;
  }
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

  var startMatchBtn = document.getElementById('startMatchBtn');
  if (startMatchBtn) {
    startMatchBtn.addEventListener('click', function () {
      if (gameState.phase === 'setup' && gameState.players.player.active) {
        startMatch(gameState);
        afterPlayerAction();
      }
    });
  }

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

  // Click an empty Bench slot to place the selected Basic there. Placement
  // always lands in the next free slot (the bench has no meaningful "which
  // exact position" beyond that), but letting the player pick the slot they
  // click on -- instead of having to click their own Active as a stand-in
  // target -- is the intuitive way to choose where a Basic goes.
  document.querySelectorAll('.bench-slot-empty').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!selectedHandId) { return; }
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      if (isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', selectedHandId)) {
        playBasic(gameState, 'player', selectedHandId);
      }
      selectedHandId = null;
      renderBoard();
    });
  });

  document.querySelectorAll('.magnify-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openCardModal(btn.getAttribute('data-card-name'));
    });
  });

  document.querySelectorAll('.prize-choosable').forEach(function (el) {
    el.addEventListener('click', function () {
      var index = parseInt(el.getAttribute('data-prize-index'), 10);
      takePrize(gameState, 'player', index);
      afterPlayerAction();
    });
  });
}

function startNewMatch() {
  gameState = createGame(Math.random);
  aiSetupBoard(gameState, 'cpu');
  renderBoard();
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

  document.getElementById('cardModalClose').addEventListener('click', closeCardModal);
  document.querySelector('.card-modal-backdrop').addEventListener('click', closeCardModal);

  // Browsers block audio autoplay before a user gesture, so the music only
  // starts/stops from this explicit toggle rather than trying to autoplay.
  document.getElementById('musicToggle').addEventListener('click', function () {
    var audio = document.getElementById('bgMusic');
    if (audio.paused) {
      audio.play();
      this.textContent = '🔊 Música';
    } else {
      audio.pause();
      this.textContent = '🔈 Música';
    }
  });

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
