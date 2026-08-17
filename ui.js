var gameState = null;
var econState = null;

function renderCoinCount() {
  document.getElementById('coin-count').textContent = econState.coins;
}

var ENERGY_ICON = { Grass: '🌿', Fire: '🔥', Water: '💧', Lightning: '⚡', Psychic: '🔮', Fighting: '🥊', Colorless: '⚪' };

// Profile photos supplied by the user (Perfil/), matched to each side by
// filename: Jugador.jpg is the player, Rival.jpg is the CPU.
var PROFILE_PHOTO_URL = { player: 'Perfil/Jugador.jpg', cpu: 'Perfil/Rival.jpg' };

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

// Colors each log line by whose side it's about -- yellow for the player,
// orange for the CPU -- using the ownerId logEvent tagged it with
// (rules-engine.js). Lines with no owner (coin flips, setup instructions)
// render in the log panel's default color.
function logHtml(s) {
  return s.log.slice(-30).map(function (entry) {
    var cls = entry.ownerId === 'player' ? 'log-line-player' : entry.ownerId === 'cpu' ? 'log-line-cpu' : 'log-line-neutral';
    return '<div class="' + cls + '">' + escapeHtml(entry.msg) + '</div>';
  }).join('');
}

// Small turn indicator next to each heading -- green when it's that side's
// turn, red otherwise (including during setup, before startMatch() picks
// who goes first: activePlayerId is null then, so neither side lights up).
function turnLightHtml(s, ownerId) {
  var on = s.activePlayerId === ownerId;
  return '<span class="turn-light ' + (on ? 'turn-light-on' : 'turn-light-off') + '" title="' +
    (on ? 'Su turno' : 'No es su turno') + '"></span>';
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

// `flipped` renders the CPU's cards as if facing the player across a table:
// name/HP/energy above the art (instead of below), and the art itself
// rotated 180° -- text stays upright/readable, only the illustration flips.
function pokemonCardHtml(instance, isActive, ownerClass, big, flipped) {
  var stats = CARD_STATS[instance.name];
  var hpLine = (stats.hp - instance.damage) + '/' + stats.hp + ' HP';
  var statusLine = instance.statusConditions.length ? ' [' + instance.statusConditions.map(translateStatus).join(', ') + ']' : '';
  var cls = 'pokemon-card' + (isActive ? ' ' + ownerClass : '') + (big ? ' active-card' : '') + (flipped ? ' flipped' : '');
  var infoHtml = '<strong>' + instance.name + '</strong><br>' + hpLine + statusLine +
    '<br>Energía: ' + instance.attachedEnergy.map(function (e) { return ENERGY_ICON[e] || e; }).join(' ');
  var imgHtml = cardImageTag(instance.name, 'card-thumb' + (flipped ? ' card-thumb-flipped' : ''));
  var body = flipped ? (infoHtml + imgHtml) : (imgHtml + infoHtml);
  return '<div class="' + cls + '" data-instance-id="' + instance.id + '">' + magnifyBtnHtml(instance.name) + body + '</div>';
}

function activeSlotHtml(activeInstance, ownerClass, flipped) {
  if (activeInstance) { return '<div class="active-row">' + pokemonCardHtml(activeInstance, true, ownerClass, true, flipped) + '</div>'; }
  return '<div class="active-row"><div class="bench-slot">Sin Activo</div></div>';
}

function benchSlotsHtml(bench, ownerId, flipped) {
  var html = '<div class="bench-row">';
  for (var i = 0; i < 5; i++) {
    if (bench[i]) {
      html += pokemonCardHtml(bench[i], false, '', false, flipped);
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
    var nameEs = translateAttackName(atk.name);
    var textEs = translateAttackText(p.active.name, atk.name);
    html += '<div class="attack-option">';
    html += '<button class="action-btn attack-btn" data-attack-name="' + atk.name + '"' + (can ? '' : ' disabled') + '>' +
      escapeHtml(nameEs) + ' [' + costLabel + '] · ' + (atk.damage || '0') + ' de daño</button>';
    if (textEs) { html += '<div class="attack-effect-text">' + escapeHtml(textEs) + '</div>'; }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function setupPanelHtml(s) {
  if (s.phase !== 'setup') { return ''; }
  var p = s.players.player;
  return '<div class="attacks-panel setup-panel">' +
    '<button class="action-btn" id="startMatchBtn"' + (p.active ? '' : ' disabled') + '>🪙 Lanzar moneda y comenzar</button></div>';
}

// Left-slot controls during normal play: Retirar (above) then Terminar
// turno (below) -- Retirar starts a "pick a Bench target" mode (see
// wireBoardButtons' retreatMode), Terminar turno both ends the player's own
// turn (if it's their turn) and lets the CPU actually take its turn (if
// it's already the CPU's turn but hasn't moved yet) -- see afterPlayerAction.
function playControlsHtml(s) {
  if (s.phase !== 'playing') { return ''; }
  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';
  if (pendingPlayerPrize) { return ''; }
  var p = s.players.player;
  var canRetreatAny = p.bench.some(function (b) { return canRetreat(s, 'player', b.id); });
  return '<div class="attacks-panel setup-panel">' +
    '<button class="action-btn" id="retreatBtn"' + (canRetreatAny ? '' : ' disabled') + '>Retirar</button><br>' +
    '<button class="action-btn" id="endTurnBtn">Terminar turno</button></div>';
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;
  var html = '';
  // The CPU's side runs Bench-then-Active (top to bottom) while the
  // player's runs Active-then-Bench, so the two Actives meet in the middle
  // like facing across a real table, instead of both sides reading the
  // same top-to-bottom order as if looking the same direction. The name
  // photo and Premios column sit on the right of the board, at the height
  // of that side's own Active row (a separate flex row from the Bench) so
  // the rival's remaining prizes are always level with mine, easy to
  // compare at a glance instead of sitting up by their Bench.
  html += '<div class="side-row"><div class="side-board">';
  html += '<p class="bench-label">Banca (' + c.bench.length + '/5)</p>' + benchSlotsHtml(c.bench, 'cpu', true);
  html += '</div></div>';
  html += '<div class="side-row"><div class="side-board">';
  html += '<p class="active-label">Activo</p>' + activeSlotHtml(c.active, 'active-cpu', true);
  html += '</div><div class="prize-column-wrap">' +
    '<h3 class="side-heading side-heading-cpu"><img class="profile-photo" src="' + PROFILE_PHOTO_URL.cpu + '" alt="">CPU' + turnLightHtml(s, 'cpu') + '</h3>' +
    prizeColumnHtml(s, 'cpu') + '</div></div>';
  html += '<p>Descarte CPU: ' + c.discard.length + '</p>';

  // Fixed 3-column row (left slot / Active / right slot) so the Active
  // Pokémon always sits dead center -- the left slot (start-match button)
  // and right slot (attacks) each reserve their column's space even when
  // empty, so neither one appearing/disappearing shifts the Active card.
  html += '<div class="side-row"><div class="side-board">';
  html += '<div class="active-with-attacks">';
  html += '<div class="side-slot">' + setupPanelHtml(s) + playControlsHtml(s) + '</div>';
  html += '<div class="active-slot"><p class="active-label">Activo</p>' + activeSlotHtml(p.active, 'active-player') + '</div>';
  html += '<div class="side-slot">' + attacksPanelHtml(s) + '</div>';
  html += '</div></div><div class="prize-column-wrap">' +
    '<h3 class="side-heading side-heading-player"><img class="profile-photo" src="' + PROFILE_PHOTO_URL.player + '" alt="">Tú' + turnLightHtml(s, 'player') + '</h3>' +
    prizeColumnHtml(s, 'player') + '</div></div>';
  html += '<div class="side-row"><div class="side-board">';
  html += '<p class="bench-label">Banca (' + p.bench.length + '/5)</p>' + benchSlotsHtml(p.bench, 'player');
  html += '</div></div>';
  html += '<p>Descarte: ' + p.discard.length + '</p>';

  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';

  if (pendingPlayerPrize) {
    html += '<div class="setup-panel"><p>¡Noqueaste un Pokémon! Elegí una de tus cartas de premio (boca abajo, arriba) para tomarla.</p></div>';
    document.getElementById('app').innerHTML = html;
    document.getElementById('log').innerHTML = logHtml(s);
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
      cardImageTag(card.name, 'card-thumb-hand') + '<span>' + escapeHtml(translateCardName(card.name)) + '</span></button></div>';
  });
  html += '</div>';

  document.getElementById('app').innerHTML = html;
  document.getElementById('log').innerHTML = logHtml(s);
  wireBoardButtons();
}

// Deliberately does NOT auto-run the CPU's turn. Whatever the player just
// did (attack, retreat, play a Trainer...) may already have ended their
// turn engine-side (attack() calls endTurn() internally), but the CPU only
// actually moves once the player clicks "Terminar turno" -- see
// wireBoardButtons' endTurnBtn handler. This lets the player review the
// result of their own action (damage dealt, effects applied, etc. in the
// log) before the board changes again.
function afterPlayerAction() {
  // getWinner() itself now tracks hasHadActive per player (rules-engine.js),
  // so it correctly returns null before either side has placed their
  // opening Basic Pokémon — no UI-side workaround needed here anymore.
  var winner = getWinner(gameState);
  if (winner) { finishMatch(winner); return; }
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
  var retreatMode = false;
  handButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      retreatMode = false;
      var handId = btn.getAttribute('data-hand-id');
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === handId; });
      if (!handCard) { return; }

      // Bill and Professor Oak ignore their target argument entirely (they
      // don't need one) -- dispatch them immediately instead of waiting for
      // a board-Pokémon click, since the board can even be completely empty.
      if (handCard.name === 'Bill' || handCard.name === 'Professor Oak') {
        var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', handId);
        if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
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
        // If the coin flip hands the CPU the opening turn, there's no turn
        // of mine being cut short here to review -- so, same as ending my
        // own turn, let it play immediately instead of sitting idle until
        // a click.
        if (gameState.activePlayerId === 'cpu') { cpuTakeTurn(gameState); }
        afterPlayerAction();
      }
    });
  }

  // "Terminar turno" is context-aware: if it's still the player's turn it
  // ends it (endTurn); if it's already the CPU's turn (their turn started
  // but they haven't moved yet -- see afterPlayerAction's comment) it lets
  // them actually take it (cpuTakeTurn). Same button, same label, either
  // way the player has to click it before the game state advances again.
  // The two checks are sequential (not else-if) so a single click always
  // fully hands the turn to the CPU and plays it out immediately -- ending
  // my own turn here (if it was still mine) makes activePlayerId 'cpu'
  // right away, and the very same click already covers that case below,
  // instead of requiring a second press just for the CPU to actually move.
  var endTurnBtn = document.getElementById('endTurnBtn');
  if (endTurnBtn) {
    endTurnBtn.addEventListener('click', function () {
      if (gameState.activePlayerId === 'player') { endTurn(gameState); }
      if (gameState.activePlayerId === 'cpu') { cpuTakeTurn(gameState); }
      afterPlayerAction();
    });
  }

  // "Retirar" starts a target-selection mode instead of listing one button
  // per Bench Pokémon: click Retirar, then click the Bench Pokémon (below)
  // you want to swap in -- handled by the shared .pokemon-card handler.
  var retreatBtn = document.getElementById('retreatBtn');
  if (retreatBtn) {
    retreatBtn.addEventListener('click', function () {
      selectedHandId = null;
      retreatMode = true;
    });
  }

  document.querySelectorAll('.pokemon-card').forEach(function (el) {
    el.addEventListener('click', function () {
      var instanceId = el.getAttribute('data-instance-id');
      if (retreatMode) {
        if (canRetreat(gameState, 'player', instanceId)) { retreat(gameState, 'player', instanceId); }
        retreatMode = false;
        renderBoard();
        return;
      }
      if (!selectedHandId) { return; }
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
        if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
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
  logEvent(gameState, 'Coloca tu Pokémon Activo y, si quieres, tu Banca (máx. 5) antes de empezar.');
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
