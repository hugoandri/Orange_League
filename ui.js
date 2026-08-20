var gameState = null;
var econState = null;

// Every shell screen (#menuScreen, #shopScreen, ...) has its own
// .shell-viewport > .shell-stage pair; each stage gets the same elastic-width
// transform independently -- they're isolated fixed-position overlays, only
// one ever visible at a time, so there's no interaction between them.
function layoutShellStages() {
  var t = computeStageTransform(window.innerWidth, window.innerHeight);
  document.querySelectorAll('.shell-stage').forEach(function (stage) {
    stage.style.width = t.width + 'px';
    stage.style.transform = 'translate(' + t.x + 'px,' + t.y + 'px) scale(' + t.scale + ')';
  });
}

// Force clear broken portada positions and old backgrounds
(function () {
  try {
    var bg = localStorage.getItem('tcg_menu_bg');
    if (bg && (bg.indexOf('portada.png') !== -1 || bg.indexOf('.html') !== -1)) {
      localStorage.removeItem('tcg_menu_bg');
    }
    var pos = JSON.parse(localStorage.getItem('tcg_menu_pos'));
    var isOldFormat = pos && ((pos.nav && pos.nav.dx === undefined) || (pos.logo && pos.logo.dx === undefined));
    var isOutOfBounds = pos && ((pos.nav && (pos.nav.y > 800 || pos.nav.y < -100 || pos.nav.x > 1200 || pos.nav.x < -300)) ||
        (pos.logo && (pos.logo.y > 800 || pos.logo.y < -100 || pos.logo.x > 1200 || pos.logo.x < -300)));
    if (pos && (isOldFormat || isOutOfBounds)) {
      localStorage.removeItem('tcg_menu_pos');
      localStorage.removeItem('tcg_menu_logo');
    }
  } catch (e) {}
})();

// Tracked separately from getWinner(gameState) because a surrender ends the
// match without the underlying game state actually reaching a real win
// condition (prizes emptied, etc.) -- this is the source of truth the
// header result text and the Rendirse button's visibility read from.
var matchWinner = null;

function renderCoinCount() {
  if (!econState) { return; }
  var val = econState.coins;
  document.getElementById('coin-count').textContent = val;
  var floatEl = document.getElementById('coin-count-float');
  if (floatEl) { floatEl.textContent = val; }
  var menuEl = document.getElementById('menuCoinCount');
  if (menuEl) { menuEl.textContent = val; }
}

// Syncs every static "who am I" spot in the UI (menu widget, floating coin
// display, shop/collection sidebars) to profileState -- the board's own
// header re-reads profileState live via playerPhotoUrl()/playerDisplayName()
// on its next render, so it doesn't need updating here.
function renderProfile() {
  if (!profileState) { return; }
  var name = playerDisplayName();
  var photo = playerPhotoUrl();

  var menuNameEl = document.getElementById('menuProfileName');
  if (menuNameEl) { menuNameEl.textContent = name; }
  var menuPhotoEl = document.getElementById('menuProfilePhoto');
  if (menuPhotoEl) { menuPhotoEl.src = photo; }

  var floatNameEl = document.querySelector('.coin-float-name');
  if (floatNameEl) { floatNameEl.textContent = name; }
  var floatPhotoEl = document.querySelector('.coin-float-photo');
  if (floatPhotoEl) { floatPhotoEl.src = photo; }

  document.querySelectorAll('.collection-profile-name').forEach(function (el) { el.textContent = name; });
  document.querySelectorAll('.collection-profile-photo').forEach(function (el) { el.src = photo; });

  var collectionSubEl = document.getElementById('menuCollectionSub');
  if (collectionSubEl && econState) {
    var progress = collectionProgress(econState.collection, CARD_CATALOG);
    collectionSubEl.textContent = progress.owned + ' DE ' + progress.total + ' CARTAS';
  }
}

// Syncs the header's result text ("Ganaste"/"Perdiste") and the Rendirse
// button's visibility to matchWinner -- called on every board render plus
// right after finishMatch() sets it, so both stay consistent everywhere.
function updateHeaderControls() {
  var resultEl = document.getElementById('matchResult');
  var surrenderBtn = document.getElementById('surrenderBtn');
  resultEl.classList.remove('match-result-win', 'match-result-loss');
  if (matchWinner) {
    resultEl.textContent = matchWinner === 'player' ? 'Ganaste' : 'Perdiste';
    resultEl.classList.add(matchWinner === 'player' ? 'match-result-win' : 'match-result-loss');
    surrenderBtn.classList.add('hidden');
  } else {
    resultEl.textContent = '';
    surrenderBtn.classList.remove('hidden');
  }
}

var ENERGY_ICON = { Grass: '🌿', Fire: '🔥', Water: '💧', Lightning: '⚡', Psychic: '🔮', Fighting: '🥊', Colorless: '⚪' };

var STATUS_EMOJI = { Asleep: '😴', Paralyzed: '⛓️', Poisoned: '☠️', Burned: '🔥', Confused: '😵' };

function statusBadgeHtml(instance, flipped) {
  if (!instance.statusConditions.length) { return ''; }
  var cls = 'status-badge' + (flipped ? ' status-badge-bottom' : '');
  return '<span class="' + cls + '" title="' + instance.statusConditions.map(translateStatus).join(', ') + '">' +
    instance.statusConditions.map(function (s) { return STATUS_EMOJI[s] || ''; }).join('') + '</span>';
}

// Default profile photos (Perfil/) -- the player's own photo/name come from
// profileState (economy.js) once signed in; these are the fallback until a
// photo is configured (or for the CPU side, which is never configurable).
var PROFILE_PHOTO_URL = { player: 'Perfil/Jugador.jpg', cpu: 'Perfil/Rival.jpg' };

function playerPhotoUrl() {
  return (profileState && profileState.photo) || PROFILE_PHOTO_URL.player;
}
function playerDisplayName() {
  return (profileState && profileState.username) || 'Tú';
}

// Real Base Set-era card back. Originally hotlinked from Bulbapedia
// (archives.bulbagarden.net) -- moved to a local copy (Cartas/Cardback.jpg)
// because ad blockers commonly filter that domain, leaving the card back
// invisible for a meaningful share of players.
var CARD_BACK_URL = 'Cartas/Cardback.jpg';

// Real card artwork, reused from the same catalog data that backs the
// booster/collection feature (data-sets.js) -- every card in Overgrowth and
// Blackout is a Base Set card, so this lookup covers the whole game.
var CARD_IMAGE_BY_NAME = {};
['base', 'jungle', 'fossil'].forEach(function (setKey) {
  (CARD_CATALOG[setKey] || []).forEach(function (c) { CARD_IMAGE_BY_NAME[c.n] = c.img; });
});

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

// Attacks list for the quick-reference card viewer (its own white panel,
// #card-viewer-panel, to the left of the dark Registro log) -- same
// translated name/text/energy-cost display as attacksPanelHtml, but with no
// canAttack/disabled state, since this is just a reference, not an action.
function cardQuickRefAttacksHtml(name) {
  var stats = CARD_STATS[name];
  if (!stats || stats.supertype !== 'Pokémon' || !stats.attacks || !stats.attacks.length) { return ''; }
  var html = '';
  stats.attacks.forEach(function (atk) {
    var costLabel = atk.cost.map(function (c) { return ENERGY_ICON[c] || c; }).join(' ');
    var nameEs = translateAttackName(atk.name);
    var textEs = translateAttackText(name, atk.name);
    html += '<div class="attack-option">';
    html += '<div><strong>' + escapeHtml(nameEs) + '</strong> [' + costLabel + '] · ' + (atk.damage || '0') + ' de daño</div>';
    if (textEs) { html += '<div class="attack-effect-text">' + escapeHtml(textEs) + '</div>'; }
    html += '</div>';
  });
  return html;
}

// Fills the quick-reference card viewer with a card's illustration plus
// (for Pokémon) its attacks -- shown by clicking the card itself (hand or
// board), instead of a separate magnify button/modal that would cover the
// board.
function showCardInViewer(name) {
  var url = CARD_IMAGE_BY_NAME[name];
  if (!url) { return; }
  document.getElementById('cardViewer').innerHTML =
    '<img class="card-viewer-img" src="' + url + '" alt="' + escapeHtml(name) + '">' +
    '<div class="card-viewer-name">' + escapeHtml(translateCardName(name)) + '</div>' +
    cardQuickRefAttacksHtml(name);
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

// Every card actually discarded this duel, face-up -- opened by clicking
// the Discard pile (see deckDiscardHtml), only ever shown when non-empty.
function openDiscardPileModal(ownerId) {
  var p = gameState.players[ownerId];
  document.getElementById('discardPileTitle').textContent =
    (ownerId === 'player' ? 'Tu descarte' : 'Descarte del rival') + ' (' + p.discard.length + ')';
  document.getElementById('discardPileGrid').innerHTML = p.discard.map(function (card) {
    var url = CARD_IMAGE_BY_NAME[card.name];
    if (!url) { return ''; }
    return '<div class="discard-pile-card"><img src="' + url + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' +
      '<span>' + escapeHtml(translateCardName(card.name)) + '</span></div>';
  }).join('');
  document.getElementById('discardPileModal').classList.remove('hidden');
}

function closeDiscardPileModal() {
  document.getElementById('discardPileModal').classList.add('hidden');
}

// Reverse of rules-engine.js's ENERGY_TYPE_BY_CARD_NAME -- attachedEnergy
// stores just the type ('Water'), but the discard-choice modal needs the
// real card name to look up its illustration.
var ENERGY_CARD_NAME_BY_TYPE = {
  Grass: 'Grass Energy', Fire: 'Fire Energy', Water: 'Water Energy',
  Lightning: 'Lightning Energy', Psychic: 'Psychic Energy', Fighting: 'Fighting Energy'
};

// Holds the in-progress choice while the energy-discard modal is open:
// which energy types are offered, how many must be picked, and what to do
// with the chosen indices once confirmed. null when the modal is closed.
var energyDiscardState = null;

function openEnergyDiscardModal(energyTypes, count, onConfirm) {
  energyDiscardState = { energyTypes: energyTypes, count: count, selected: [], onConfirm: onConfirm };
  renderEnergyDiscardModal();
  document.getElementById('energyDiscardModal').classList.remove('hidden');
}

function closeEnergyDiscardModal() {
  document.getElementById('energyDiscardModal').classList.add('hidden');
  energyDiscardState = null;
}

function renderEnergyDiscardModal() {
  var s = energyDiscardState;
  document.getElementById('energyDiscardPrompt').textContent =
    'Elige ' + s.count + (s.count === 1 ? ' energía para descartar' : ' energías para descartar') +
    ' (' + s.selected.length + '/' + s.count + ')';
  var grid = document.getElementById('energyDiscardGrid');
  grid.innerHTML = s.energyTypes.map(function (type, i) {
    var cardName = ENERGY_CARD_NAME_BY_TYPE[type] || type;
    var selected = s.selected.indexOf(i) !== -1;
    return '<div class="energy-discard-option' + (selected ? ' selected' : '') + '" data-energy-index="' + i + '">' +
      cardImageTag(cardName, '') + '<span>' + escapeHtml(translateCardName(cardName)) + '</span></div>';
  }).join('');
  grid.querySelectorAll('.energy-discard-option').forEach(function (el) {
    el.addEventListener('click', function () {
      var i = parseInt(el.getAttribute('data-energy-index'), 10);
      var pos = s.selected.indexOf(i);
      if (pos !== -1) {
        s.selected.splice(pos, 1);
      } else if (s.selected.length < s.count) {
        s.selected.push(i);
      }
      renderEnergyDiscardModal();
    });
  });
  document.getElementById('energyDiscardConfirm').disabled = s.selected.length !== s.count;
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
  return '<div class="' + cls + '" data-instance-id="' + instance.id + '" data-card-name="' + escapeHtml(instance.name) + '">' + statusBadgeHtml(instance, flipped) + body + '</div>';
}

function activeSlotHtml(activeInstance, ownerClass, flipped) {
  if (activeInstance) { return '<div class="active-row">' + pokemonCardHtml(activeInstance, true, ownerClass, true, flipped) + '</div>'; }
  return '<div class="active-row"><div class="bench-slot active-slot-empty">Sin Activo</div></div>';
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
  var totalSlots = 6;
  var html = '<div class="prize-column"><p class="prize-label">Premios (' + p.prizes.length + ')</p><div class="prize-grid">';
  for (var i = 0; i < totalSlots; i++) {
    if (i < p.prizes.length) {
      var cls = 'prize-card' + (choosable ? ' prize-choosable' : '');
      html += '<div class="' + cls + '"' + (choosable ? ' data-prize-index="' + i + '" title="Elegir esta carta de premio"' : '') + '>' +
        '<img src="' + CARD_BACK_URL + '" alt="Carta de premio boca abajo" loading="lazy"></div>';
    } else {
      html += '<div class="prize-card prize-empty"></div>';
    }
  }
  html += '</div></div>';
  return html;
}

// Deck (always face-down, just a count) and Discard pile (face-down too --
// only the count matters at a glance; the discard's actual cards are one
// click away, see openDiscardPileModal). The CPU's sits beside its Bench
// row (above its Active+Premios row); mine sits beside my own Mano row
// instead (at hand height, below my Active+Premios row), both called from
// renderBoard.
function deckDiscardHtml(state, ownerId) {
  var p = state.players[ownerId];
  var discardCount = p.discard.length;
  var html = '<div class="deck-discard-wrap">';
  html += '<div class="deck-discard-pile" title="Mazo">' +
    '<img src="' + CARD_BACK_URL + '" alt="Mazo" loading="lazy">' +
    '<p class="pile-label">Mazo (' + p.deck.length + ')</p></div>';
  html += '<div class="deck-discard-pile' + (discardCount > 0 ? ' discard-pile-clickable' : '') + '"' +
    (discardCount > 0 ? ' data-discard-owner="' + ownerId + '" title="Ver descarte"' : '') + '>' +
    (discardCount > 0 ? '<img src="' + CARD_BACK_URL + '" alt="Descarte" loading="lazy">' : '<div class="pile-empty">Vacío</div>') +
    '<p class="pile-label">Descarte (' + discardCount + ')</p></div>';
  html += '</div>';
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
  return '<div class="attacks-panel setup-panel coin-flip-panel">' +
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
    '<button class="action-btn" id="retreatBtn"' + (canRetreatAny ? '' : ' disabled') + '>Cambiar Pokémon</button><br>' +
    '<button class="action-btn" id="endTurnBtn">Terminar turno</button></div>';
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;
  var html = '';
  updateHeaderControls();
  // The CPU's side runs Bench-then-Active (top to bottom) while the
  // player's runs Active-then-Bench, so the two Actives meet in the middle
  // like facing across a real table, instead of both sides reading the
  // same top-to-bottom order as if looking the same direction. The name
  // photo and Premios column sit on the right of the board, at the height
  // of that side's own Active row (a separate flex row from the Bench) so
  // the rival's remaining prizes are always level with mine, easy to
  // compare at a glance instead of sitting up by their Bench.
  // CPU sidebar: deck/discard → prizes → profile/name (stacked vertically)
  html += '<div class="side-row"><div class="side-board">';
  html += '<div class="cpu-hand-row">';
  for (var i = 0; i < c.hand.length; i++) {
    html += '<div class="cpu-hand-card"><img src="' + CARD_BACK_URL + '" alt="Carta boca abajo" loading="lazy"></div>';
  }
  html += '</div>';
  html += benchSlotsHtml(c.bench, 'cpu', true);
  html += activeSlotHtml(c.active, 'active-cpu', true);
  html += '</div><div class="cpu-sidebar">' +
    deckDiscardHtml(s, 'cpu') +
    '<div class="cpu-sidebar-gap"></div>' +
    prizeColumnHtml(s, 'cpu') +
    '<div class="cpu-sidebar-gap"></div>' +
    '<h3 class="side-heading side-heading-cpu"><img class="profile-photo" src="' + PROFILE_PHOTO_URL.cpu + '" alt="">CPU' + turnLightHtml(s, 'cpu') + '</h3>' +
    '</div></div>';

  // Player Active + attacks
  html += '<div class="side-row"><div class="side-board">';
  html += '<div class="active-with-attacks">';
  html += '<div class="side-slot">' + setupPanelHtml(s) + playControlsHtml(s) + '</div>';
  html += '<div class="active-slot">' + activeSlotHtml(p.active, 'active-player') + '</div>';
  html += '<div class="side-slot">' + attacksPanelHtml(s) + '</div>';
  html += '</div></div>';
  // Player sidebar: profile/name → prizes → deck/discard
  html += '<div class="cpu-sidebar">' +
    '<h3 class="side-heading side-heading-player"><img class="profile-photo" src="' + playerPhotoUrl() + '" alt="">' + escapeHtml(playerDisplayName()) + turnLightHtml(s, 'player') + '</h3>' +
    '<div class="cpu-sidebar-gap"></div>' +
    prizeColumnHtml(s, 'player') +
    '<div class="cpu-sidebar-gap"></div>' +
    deckDiscardHtml(s, 'player') +
    '</div></div>';
  // Player Bench (below active)
  html += '<div class="side-row player-bench-row"><div class="side-board">';
  html += benchSlotsHtml(p.bench, 'player');
  html += '</div><div class="side-spacer"></div></div>';

  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';

  if (pendingPlayerPrize) {
    html += '<div class="setup-panel"><p>¡Noqueaste un Pokémon! Elige una de tus cartas de premio (boca abajo, arriba) para tomarla.</p></div>';
    document.getElementById('app').innerHTML = html;
    document.getElementById('log').innerHTML = logHtml(s);
    wireBoardButtons();
    return;
  }

  html += '<div class="side-row"><div class="side-board">';
  html += '<h4>Mano</h4><div class="hand-row">';
  p.hand.forEach(function (card) {
    // During setup, only Basic Pokémon can be placed -- Energy/Trainer cards
    // can't be used until the match actually starts.
    var disabled = s.phase === 'setup' && !isBasicPokemon(card.name);
    html += '<div class="hand-card-wrap">' +
      '<button class="action-btn hand-card" data-hand-id="' + card.id + '" data-card-name="' + escapeHtml(card.name) + '"' + (disabled ? ' disabled' : '') + '>' +
      cardImageTag(card.name, 'card-thumb-hand') + '<span>' + escapeHtml(translateCardName(card.name)) + '</span></button></div>';
  });
  html += '</div></div></div>';

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

// winner is 'player' or 'cpu' -- called both when getWinner(gameState)
// finds a real win condition and when the player surrenders (see
// surrenderConfirmBtn's handler), so it doesn't re-derive the winner from
// game state itself. "Nueva partida" now lives in the header's Jugar
// button (see tabBtnPlay's handler) instead of a button rendered here.
function finishMatch(winner) {
  matchWinner = winner;
  awardMatchResultCloud(winner === 'player' ? 'win' : 'loss')
    .catch(function (e) { console.error('No se pudo registrar el resultado de la partida', e); });
  renderBoard(); // shows the final board state (last action's results); also syncs the header via updateHeaderControls()
  var textEl = document.getElementById('matchEndText');
  textEl.textContent = winner === 'player' ? 'Has Ganado' : 'Has Perdido';
  textEl.classList.remove('win', 'loss');
  textEl.classList.add(winner === 'player' ? 'win' : 'loss');
  document.getElementById('matchEndModal').classList.remove('hidden');
}

function wireBoardButtons() {
  var handButtons = document.querySelectorAll('.hand-card');
  var selectedHandId = null;
  var retreatMode = false;
  handButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      showCardInViewer(btn.getAttribute('data-card-name'));
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
      showCardInViewer(el.getAttribute('data-card-name'));
      var instanceId = el.getAttribute('data-instance-id');
      if (retreatMode) {
        retreatMode = false;
        if (canRetreat(gameState, 'player', instanceId)) {
          var activePokemon = gameState.players.player.active;
          var retreatCostNow = CARD_STATS[activePokemon.name].retreatCost;
          if (retreatCostNow === 0) {
            retreat(gameState, 'player', instanceId);
            renderBoard();
          } else {
            openEnergyDiscardModal(activePokemon.attachedEnergy.slice(), retreatCostNow, function (indices) {
              retreat(gameState, 'player', instanceId, indices);
              renderBoard();
            });
          }
        } else {
          renderBoard();
        }
        return;
      }
      if (!selectedHandId) { return; }
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      var superPotionTarget = handCard.name === 'Super Potion' ? findInstance(p, instanceId) : null;
      if (isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', selectedHandId)) {
        playBasic(gameState, 'player', selectedHandId);
      } else if (canEvolve(gameState, 'player', selectedHandId, instanceId)) {
        evolve(gameState, 'player', selectedHandId, instanceId);
      } else if (canAttachEnergy(gameState, 'player', selectedHandId, instanceId)) {
        attachEnergy(gameState, 'player', selectedHandId, instanceId);
      } else if (superPotionTarget && superPotionTarget.attachedEnergy.length > 0) {
        // Which energy to discard is the player's choice -- pick it in the
        // modal, then apply the effect with that specific index (see
        // TRAINER_EFFECTS['Super Potion']'s optional energyIndex param).
        var superPotionHandId = selectedHandId;
        selectedHandId = null;
        openEnergyDiscardModal(superPotionTarget.attachedEnergy.slice(), 1, function (indices) {
          var result = TRAINER_EFFECTS['Super Potion'](gameState, 'player', superPotionHandId, instanceId, indices[0]);
          if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
          renderBoard();
        });
        return;
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

  document.querySelectorAll('.prize-choosable').forEach(function (el) {
    el.addEventListener('click', function () {
      var index = parseInt(el.getAttribute('data-prize-index'), 10);
      var wonCard = gameState.players.player.prizes[index];
      var wonCardName = wonCard && wonCard.name;
      takePrize(gameState, 'player', index);
      afterPlayerAction();
      // Zoom the card just taken so it's clear which prize was won -- reuses
      // the same enlarge modal as the hand's 🔍 buttons.
      if (wonCardName) { openCardModal(wonCardName); }
    });
  });

  document.querySelectorAll('.discard-pile-clickable').forEach(function (el) {
    el.addEventListener('click', function () {
      openDiscardPileModal(el.getAttribute('data-discard-owner'));
    });
  });
}

function startNewMatch() {
  matchWinner = null;
  document.getElementById('matchEndModal').classList.add('hidden');
  gameState = createGame(Math.random);
  aiSetupBoard(gameState, 'cpu');
  logEvent(gameState, 'Coloca tu Pokémon Activo y, si quieres, tu Banca (máx. 5) antes de empezar.');
  renderBoard();
}

var BOOSTER_PACKS = {
  base: [
    'Sobres/base.webp',
    'Sobres/base-blastoise.webp',
    'Sobres/base-venusaur.webp'
  ],
  jungle: [
    'Sobres/jungle.webp',
    'Sobres/jungle-flareon.webp',
    'Sobres/jungle-wigglytuff.webp'
  ],
  fossil: [
    'Sobres/fossil.webp',
    'Sobres/fossil-aerodactyl.webp',
    'Sobres/fossil-zapdos.webp'
  ]
};
var BOOSTER_NAMES = { base: 'Base Set', jungle: 'Jungle', fossil: 'Fossil' };

var BOOSTER_PACK_NAMES = {
  base: { 'base.webp': 'Charizard', 'base-blastoise.webp': 'Blastoise', 'base-venusaur.webp': 'Venusaur' },
  jungle: { 'jungle.webp': 'Scyther', 'jungle-flareon.webp': 'Flareon', 'jungle-wigglytuff.webp': 'Wigglytuff' },
  fossil: { 'fossil.webp': 'Lapras', 'fossil-aerodactyl.webp': 'Aerodactyl', 'fossil-zapdos.webp': 'Zapdos' }
};

var boosterSelectState = null;

// Tracks where the shop screen was opened from, so the "◀ VOLVER" button can
// return there: 'menu' from the main menu's TIENDA item, 'game' from a live
// match. Defaults to 'menu' since that's the only reachable entry point today.
var shopReturnTo = 'menu';

function showShopScreen(returnTo) {
  shopReturnTo = returnTo;
  document.getElementById('shopScreen').classList.remove('hidden');
  renderShopScreen();
}

function hideShopScreen() {
  document.getElementById('shopScreen').classList.add('hidden');
}

// Only updates the coin balance -- called on every Firestore snapshot
// (economy.js). Deliberately NOT rebuilding the card grid here: that would
// re-roll each card's random cover art out from under the player while
// they're looking at the screen, e.g. right after a purchase updates coins.
function updateShopBalance() {
  var balanceEl = document.getElementById('shopCoinBalance');
  if (balanceEl && econState) { balanceEl.textContent = econState.coins; }
}

// Builds the card grid -- called once per screen-open (showShopScreen), not
// on every economy update (see updateShopBalance above).
function renderShopScreen() {
  updateShopBalance();

  var grid = document.getElementById('shopGrid');
  if (!grid || !econState) { return; }

  var html = '';
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    var packs = BOOSTER_PACKS[setKey];
    var randomPack = packs[Math.floor(Math.random() * packs.length)];
    html +=
      '<div class="shell-shop-card" data-set="' + setKey + '">' +
        '<div class="shell-shop-card-art"><img src="' + randomPack + '" alt="' + BOOSTER_NAMES[setKey] + '"></div>' +
        '<div class="shell-shop-card-text">' +
          '<div class="shell-shop-card-name">SOBRE ' + BOOSTER_NAMES[setKey].toUpperCase() + '</div>' +
          '<div class="shell-shop-card-desc">11 CARTAS + 1 ENERGÍA</div>' +
        '</div>' +
        '<div class="shell-shop-card-footer">' +
          '<span class="shell-shop-card-price"><span class="shell-shop-coin"></span>100</span>' +
          '<button type="button" class="shell-shop-card-btn">ABRIR</button>' +
        '</div>' +
      '</div>';
  });
  html +=
    '<div class="shell-shop-card shell-shop-card-disabled">' +
      '<div class="shell-shop-card-art"><span class="shell-shop-card-placeholder">PRÓXIMAMENTE</span></div>' +
      '<div class="shell-shop-card-text">' +
        '<div class="shell-shop-card-name">NUEVO SOBRE</div>' +
        '<div class="shell-shop-card-desc">EN UNA PRÓXIMA ACTUALIZACIÓN</div>' +
      '</div>' +
      '<div class="shell-shop-card-footer">' +
        '<button type="button" class="shell-shop-card-btn" disabled>PRÓXIMAMENTE</button>' +
      '</div>' +
    '</div>';
  grid.innerHTML = html;

  grid.querySelectorAll('.shell-shop-card[data-set]').forEach(function (card) {
    card.querySelector('.shell-shop-card-btn').addEventListener('click', function () {
      openBoosterSelectModal(card.getAttribute('data-set'));
    });
  });
}

function renderCollection() {
  if (!econState) { document.getElementById('collectionStats').innerHTML = '<div>Cargando…</div>'; return; }
  var total = 0, owned = 0;
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    CARD_CATALOG[setKey].forEach(function (c) {
      total++;
      var key = setKey + '-' + c.num;
      if ((econState.collection[key] || 0) > 0) { owned++; }
    });
  });
  document.getElementById('collectionStats').innerHTML =
    '<div>' + owned + ' / ' + total + ' cartas</div>' +
    '<div>' + Math.round(owned / total * 100) + '% completado</div>';
  renderCollectionOwned();
}

function openBoosterSelectModal(setKey) {
  var packs = BOOSTER_PACKS[setKey];
  var names = BOOSTER_PACK_NAMES[setKey];
  var html = '';
  packs.forEach(function (src, i) {
    var fileName = src.split('/').pop();
    var name = names[fileName] || BOOSTER_NAMES[setKey];
    html += '<div class="booster-variant" data-index="' + i + '">' +
      '<img src="' + src + '" alt="' + name + '">' +
      '<div class="bv-name">' + name + '</div>' +
      '</div>';
  });
  document.getElementById('boosterModalTitle').textContent = 'Sobre ' + BOOSTER_NAMES[setKey];
  document.getElementById('boosterModalGrid').innerHTML = html;
  document.getElementById('boosterOpenBtn').disabled = true;
  document.querySelector('#boosterSelectModal .bm-selected-info').textContent = 'Toca un sobre para seleccionarlo';
  boosterSelectState = { setKey: setKey, selectedPack: null };

  document.querySelectorAll('.booster-variant').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('.booster-variant').forEach(function (v) { v.classList.remove('selected'); });
      el.classList.add('selected');
      boosterSelectState.selectedPack = parseInt(el.getAttribute('data-index'), 10);
      document.getElementById('boosterOpenBtn').disabled = false;
      var fileName = packs[boosterSelectState.selectedPack].split('/').pop();
      var chosenName = names[fileName] || BOOSTER_NAMES[setKey];
      document.querySelector('#boosterSelectModal .bm-selected-info').innerHTML =
        'Seleccionado: <strong>' + chosenName + '</strong>';
    });
  });

  document.getElementById('boosterSelectModal').classList.remove('hidden');
}

function closeBoosterSelectModal() {
  document.getElementById('boosterSelectModal').classList.add('hidden');
  boosterSelectState = null;
}

function openBoosterAndPurchase() {
  if (!boosterSelectState || boosterSelectState.selectedPack === null) { return; }
  var setKey = boosterSelectState.setKey;
  document.getElementById('boosterOpenBtn').disabled = true;
  openBoosterCloud(setKey)
    .then(function (cards) {
      closeBoosterSelectModal();
      showBoosterResult(cards);
    })
    .catch(function (err) {
      alert(err.message || 'No se pudo abrir el sobre.');
      document.getElementById('boosterOpenBtn').disabled = false;
    });
}

function showBoosterResult(cards) {
  var html = '';
  cards.forEach(function (c) {
    var url = CARD_IMAGE_BY_NAME[c.n] || '';
    var isRare = c.r === 'Rare' || c.r === 'Rare Holo';
    html += '<div class="booster-result-card' + (isRare ? ' rare' : '') + '" data-card-name="' + escapeHtml(c.n) + '">' +
      (url ? '<img src="' + url + '" alt="' + escapeHtml(c.n) + '" loading="lazy">' : '') +
      '<div class="brc-name">' + escapeHtml(translateCardName(c.n)) + '</div>' +
      '</div>';
  });
  document.getElementById('boosterResultGrid').innerHTML = html;
  document.getElementById('boosterResultModal').classList.remove('hidden');

  document.querySelectorAll('.booster-result-card').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name); }
    });
  });
}

function renderCollectionCards(filter) {
  if (!econState) { return; }
  var html = '';
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    var cards = [];
    CARD_CATALOG[setKey].forEach(function (c) {
      var key = setKey + '-' + c.num;
      var count = econState.collection[key] || 0;
      if (filter === 'owned' && count === 0) { return; }
      cards.push({ c: c, count: count });
    });
    if (cards.length === 0 && filter === 'owned') { return; }
    html += '<h4>' + setKey.charAt(0).toUpperCase() + setKey.slice(1) + ' <span style="font-weight:400;color:var(--ink-soft);font-size:0.75rem;">(' + cards.length + ')</span></h4><div class="collection-grid">';
    cards.forEach(function (item) {
      var url = item.c.img || '';
      var countCls = item.count > 0 ? '' : ' zero';
      html += '<div class="collection-card" data-card-name="' + escapeHtml(item.c.n) + '">' +
        (url ? '<img src="' + url + '" alt="' + escapeHtml(item.c.n) + '" loading="lazy">' : '') +
        '<div class="collection-card-name">' + escapeHtml(translateCardName(item.c.n)) + '</div>' +
        '<div class="collection-card-count' + countCls + '">x' + item.count + '</div>' +
        '</div>';
    });
    html += '</div>';
  });
  if (!html) {
    html = '<p style="color:var(--ink-soft);padding:20px;text-align:center;">Aún no tenés cartas. ¡Comprá sobres en la Tienda!</p>';
  }
  document.getElementById('collection-content').innerHTML = html;

  document.querySelectorAll('#collection-content .collection-card').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name); }
    });
  });
}

function renderCollectionOwned() { renderCollectionCards('owned'); }
function renderCollectionAll() { renderCollectionCards('all'); }

// ── Theme ──────────────────────────────────────────────────────────
function applyTheme(dark) {
  document.body.classList.toggle('light', !dark);
  var icon = dark ? '🌙' : '☀️';
  var t1 = document.getElementById('themeToggle');
  if (t1) { t1.textContent = icon; }
  var t2 = document.getElementById('configThemeToggle');
  if (t2) { t2.textContent = icon + (dark ? ' Modo Oscuro' : ' Modo Claro'); }
  try { localStorage.setItem('tcg_theme', dark ? 'dark' : 'light'); } catch (e) {}
}
function toggleTheme() {
  var isDark = !document.body.classList.contains('light');
  applyTheme(!isDark);
}

// ── Menu ───────────────────────────────────────────────────────────
function showMenu() {
  document.getElementById('menuScreen').classList.remove('hidden');
}
function hideMenu() {
  document.getElementById('menuScreen').classList.add('hidden');
}

function initMenuParticles() {
  var container = document.getElementById('menuParticles');
  if (!container) { return; }
  container.innerHTML = '';
  for (var i = 0; i < 30; i++) {
    var dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:2px;height:2px;background:rgba(201,168,76,0.3);border-radius:50%;' +
      'left:' + Math.random() * 100 + '%;top:' + Math.random() * 100 + '%;' +
      'animation:particleFade ' + (3 + Math.random() * 4) + 's ease-in-out infinite;' +
      'animation-delay:' + Math.random() * 5 + 's;';
    container.appendChild(dot);
  }
}

var MENU_BG_DEFAULT = (function () {
  try {
    var base = window.location.href.replace(/\/[^\/]*$/, '/');
    return base + 'Perfil/Portada_Oficial.jpeg';
  } catch (e) { return 'Perfil/Portada_Oficial.jpeg'; }
})();

function applyMenuBackground() {
  var el = document.getElementById('shellKeyart');
  if (!el) { return; }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tcg_menu_bg')); } catch (e) {}
  if (saved && saved.img) {
    el.style.backgroundImage = 'url(' + saved.img + ')';
    // 'cover' instead of the saved width%/auto-height: a width below 100%
    // (or an image whose aspect ratio doesn't match the 1180x1080 box)
    // left the image narrower/shorter than its frame, showing the frame's
    // own dark background as two solid columns on the image's own left and
    // right sides. Cover guarantees the image always fills the frame with
    // no gaps; the saved x/y position still controls which part of the
    // image is centered/visible.
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = saved.x + '% ' + saved.y + '%';
    el.style.backgroundRepeat = 'no-repeat';
  } else {
    el.style.backgroundImage = 'url(' + MENU_BG_DEFAULT + ')';
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
  }
}

function applyMenuLogo() {
  var show = true;
  try { show = localStorage.getItem('tcg_menu_logo') !== 'hidden'; } catch (e) {}
  var logoWrap = document.getElementById('menuLogoWrap');
  if (logoWrap) { logoWrap.style.display = show ? '' : 'none'; }
}

function openConfigModal() {
  document.getElementById('configMenu').classList.remove('config-hidden');
  document.getElementById('configBgPanel').classList.add('config-hidden');
  document.getElementById('configModal').classList.remove('hidden');
  var logoToggle = document.getElementById('configLogoToggle');
  var isHidden = localStorage.getItem('tcg_menu_logo') === 'hidden';
  logoToggle.classList.toggle('off', isHidden);
  logoToggle.textContent = isHidden ? 'OFF' : 'ON';
}

function closeConfigModal() {
  document.getElementById('configModal').classList.add('hidden');
}

function showConfigBg() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tcg_menu_bg')); } catch (e) {}
  var w = saved ? saved.w : 100, h = saved ? saved.h : 100, x = saved ? saved.x : 50, y = saved ? saved.y : 50;
  document.getElementById('configWidth').value = w;
  document.getElementById('configHeight').value = h;
  document.getElementById('configX').value = x;
  document.getElementById('configY').value = y;
  document.getElementById('configWidthVal').textContent = w;
  document.getElementById('configHeightVal').textContent = h;
  document.getElementById('configXVal').textContent = x;
  document.getElementById('configYVal').textContent = y;
  var preview = document.getElementById('configPreview');
  var placeholder = document.querySelector('.config-preview-placeholder');
  if (saved && saved.img) {
    document.getElementById('configPreviewImg').src = saved.img;
    preview.style.backgroundImage = 'url(' + saved.img + ')';
    preview.style.backgroundSize = w + '% ' + h + '%';
    preview.style.backgroundPosition = x + '% ' + y + '%';
    placeholder.style.display = 'none';
  } else {
    preview.style.backgroundImage = 'none';
    placeholder.style.display = 'flex';
  }
  document.getElementById('configMenu').classList.add('config-hidden');
  document.getElementById('configBgPanel').classList.remove('config-hidden');
}

function updateConfigPreview() {
  var img = document.getElementById('configPreviewImg');
  var preview = document.getElementById('configPreview');
  var placeholder = document.querySelector('.config-preview-placeholder');
  var src = img.src;
  if (!src || src === window.location.href) {
    placeholder.style.display = 'flex';
    preview.style.backgroundImage = 'none';
    return;
  }
  placeholder.style.display = 'none';
  var w = document.getElementById('configWidth').value;
  var h = document.getElementById('configHeight').value;
  var x = document.getElementById('configX').value;
  var y = document.getElementById('configY').value;
  preview.style.backgroundImage = 'url(' + src + ')';
  preview.style.backgroundSize = w + '% ' + h + '%';
  preview.style.backgroundPosition = x + '% ' + y + '%';
  preview.style.backgroundRepeat = 'no-repeat';
  document.getElementById('configWidthVal').textContent = w;
  document.getElementById('configHeightVal').textContent = h;
  document.getElementById('configXVal').textContent = x;
  document.getElementById('configYVal').textContent = y;
}
function openPauseMenu() {
  document.getElementById('pauseModal').classList.remove('hidden');
}
function closePauseMenu() {
  document.getElementById('pauseModal').classList.add('hidden');
}
document.addEventListener('DOMContentLoaded', function () {
  // Theme init
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('tcg_theme'); } catch (e) {}
  applyTheme(savedTheme !== 'light');

  applyMenuBackground();
  applyMenuLogo();
  layoutShellStages();
  window.addEventListener('resize', layoutShellStages);

  // Menu buttons
  document.getElementById('menuPlay').addEventListener('click', function () {
    hideMenu();
    switchTab('play');
  });
  document.getElementById('menuShop').addEventListener('click', function () {
    hideMenu();
    showShopScreen('menu');
  });
  document.getElementById('menuCollection').addEventListener('click', function () {
    hideMenu();
    switchTab('collection');
  });
  document.getElementById('menuConfig').addEventListener('click', function () {
    openConfigModal();
  });
  // Config modal
  document.getElementById('configBgBtn').addEventListener('click', showConfigBg);
  document.getElementById('configBack').addEventListener('click', function () {
    document.getElementById('configBgPanel').classList.add('config-hidden');
    document.getElementById('configMenu').classList.remove('config-hidden');
  });
  document.getElementById('configCloseMenu').addEventListener('click', function () {
    closeConfigModal();
  });
  document.querySelector('#configModal .card-modal-backdrop').addEventListener('click', function () {
    closeConfigModal();
  });

  // Logo toggle
  var logoToggle = document.getElementById('configLogoToggle');
  logoToggle.addEventListener('click', function () {
    var isOn = !logoToggle.classList.contains('off');
    logoToggle.classList.toggle('off');
    logoToggle.textContent = isOn ? 'OFF' : 'ON';
    localStorage.setItem('tcg_menu_logo', isOn ? 'hidden' : 'visible');
    applyMenuLogo();
  });

  // Enable drag when config opens
  document.getElementById('configFileInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      document.getElementById('configPreviewImg').src = ev.target.result;
      updateConfigPreview();
    };
    reader.readAsDataURL(file);
  });
  ['configWidth', 'configHeight', 'configX', 'configY'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', updateConfigPreview);
  });
  document.getElementById('configSave').addEventListener('click', function () {
    var img = document.getElementById('configPreviewImg');
    if (!img.src || img.src === window.location.href) { return; }
    var data = {
      img: img.src,
      w: parseInt(document.getElementById('configWidth').value),
      h: parseInt(document.getElementById('configHeight').value),
      x: parseInt(document.getElementById('configX').value),
      y: parseInt(document.getElementById('configY').value)
    };
    localStorage.setItem('tcg_menu_bg', JSON.stringify(data));
    applyMenuBackground();
    closeConfigModal();
  });
  document.getElementById('configReset').addEventListener('click', function () {
    localStorage.removeItem('tcg_menu_bg');
    applyMenuBackground();
    document.getElementById('configPreviewImg').src = '';
    document.getElementById('configPreview').style.backgroundImage = 'none';
    document.querySelector('.config-preview-placeholder').style.display = 'flex';
    document.getElementById('configWidth').value = 100;
    document.getElementById('configHeight').value = 100;
    document.getElementById('configX').value = 50;
    document.getElementById('configY').value = 50;
    document.getElementById('configWidthVal').textContent = '100';
    document.getElementById('configHeightVal').textContent = '100';
    document.getElementById('configXVal').textContent = '50';
    document.getElementById('configYVal').textContent = '50';
  });
  document.querySelector('#configModal .card-modal-backdrop').addEventListener('click', closeConfigModal);
  document.getElementById('configThemeToggle').addEventListener('click', function () {
    toggleTheme();
    this.textContent = document.body.classList.contains('light') ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
  });
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Collection sidebar
  document.getElementById('navOwned').addEventListener('click', function () {
    document.getElementById('navOwned').classList.add('active');
    document.getElementById('navAll').classList.remove('active');
    renderCollectionOwned();
  });
  document.getElementById('navAll').addEventListener('click', function () {
    document.getElementById('navAll').classList.add('active');
    document.getElementById('navOwned').classList.remove('active');
    renderCollectionAll();
  });
  document.getElementById('navExit').addEventListener('click', function () {
    showMenu();
  });

  // Tab buttons
  document.getElementById('tabBtnMenu').addEventListener('click', showMenu);
  document.getElementById('tabBtnPlay').addEventListener('click', function () { switchTab('play'); });
  document.getElementById('tabBtnShop').addEventListener('click', function () { showShopScreen('game'); });
  document.getElementById('tabBtnCollection').addEventListener('click', function () { switchTab('collection'); });

  document.getElementById('shopBackBtn').addEventListener('click', function () {
    hideShopScreen();
    if (shopReturnTo === 'menu') { showMenu(); }
  });

  // ── Modals ───────────────────────────────────────────────────────
  document.getElementById('cardModalClose').addEventListener('click', closeCardModal);
  document.querySelector('#cardModal .card-modal-backdrop').addEventListener('click', closeCardModal);

  document.getElementById('discardPileClose').addEventListener('click', closeDiscardPileModal);
  document.querySelector('#discardPileModal .card-modal-backdrop').addEventListener('click', closeDiscardPileModal);

  document.getElementById('surrenderBtn').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.remove('hidden');
  });
  document.getElementById('surrenderCancelBtn').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
  });
  document.querySelector('#surrenderModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
  });
  document.getElementById('surrenderConfirmBtn').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
    finishMatch('cpu');
  });

  document.getElementById('energyDiscardCancel').addEventListener('click', closeEnergyDiscardModal);
  document.querySelector('#energyDiscardModal .card-modal-backdrop').addEventListener('click', closeEnergyDiscardModal);
  document.getElementById('energyDiscardConfirm').addEventListener('click', function () {
    var s = energyDiscardState;
    if (!s || s.selected.length !== s.count) { return; }
    var indices = s.selected.slice();
    var onConfirm = s.onConfirm;
    closeEnergyDiscardModal();
    onConfirm(indices);
  });

  document.getElementById('matchEndReplayBtn').addEventListener('click', function () {
    document.getElementById('matchEndModal').classList.add('hidden');
    startNewMatch();
  });
  document.getElementById('matchEndCancelBtn').addEventListener('click', function () {
    document.getElementById('matchEndModal').classList.add('hidden');
    switchTab('collection');
    showMenu();
  });
  document.querySelector('#matchEndModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('matchEndModal').classList.add('hidden');
  });

  // Booster select modal
  document.getElementById('boosterModalClose').addEventListener('click', closeBoosterSelectModal);
  document.querySelector('#boosterSelectModal .card-modal-backdrop').addEventListener('click', closeBoosterSelectModal);
  document.getElementById('boosterOpenBtn').addEventListener('click', openBoosterAndPurchase);

  // Booster result modal
  document.getElementById('boosterResultClose').addEventListener('click', function () {
    document.getElementById('boosterResultModal').classList.add('hidden');
    renderCollection();
  });
  document.querySelector('#boosterResultModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('boosterResultModal').classList.add('hidden');
    renderCollection();
  });

  // Music
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

  // Pause menu (ESC)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var panelPlay = document.getElementById('panelPlay');
      if (!panelPlay.classList.contains('active')) { return; }
      if (!document.getElementById('pauseModal').classList.contains('hidden')) {
        closePauseMenu();
      } else {
        openPauseMenu();
      }
    }
  });
  document.getElementById('pauseResume').addEventListener('click', closePauseMenu);
  document.getElementById('pauseConfig').addEventListener('click', function () {
    closePauseMenu();
    openConfigModal();
  });
  document.getElementById('pauseSurrender').addEventListener('click', function () {
    closePauseMenu();
    document.getElementById('surrenderModal').classList.remove('hidden');
  });
  document.getElementById('pauseMusic').addEventListener('click', function () {
    var audio = document.getElementById('bgMusic');
    if (audio.paused) {
      audio.play();
      this.textContent = '🔊 Música';
    } else {
      audio.pause();
      this.textContent = '🔈 Música';
    }
  });
  document.getElementById('pauseExit').addEventListener('click', function () {
    closePauseMenu();
    switchTab('collection');
    showMenu();
  });
});

function switchTab(tab) {
  var tabs = { play: 'tabBtnPlay', collection: 'tabBtnCollection' };
  var panels = { play: 'panelPlay', collection: 'panelCollection' };
  Object.keys(tabs).forEach(function (key) {
    document.getElementById(tabs[key]).classList.toggle('active', key === tab);
    document.getElementById(panels[key]).classList.toggle('active', key === tab);
  });
  var header = document.querySelector('header.top');
  var coinFloat = document.getElementById('coinFloat');
  header.style.display = 'none';
  if (tab === 'play') {
    if (coinFloat) { coinFloat.style.display = ''; }
    startNewMatch();
  } else {
    if (coinFloat) { coinFloat.style.display = 'none'; }
  }
  if (tab === 'collection') { renderCollection(); }
}
