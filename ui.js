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

// Tracked separately from getWinner(gameState) because a surrender ends the
// match without the underlying game state actually reaching a real win
// condition (prizes emptied, etc.) -- this is the source of truth the
// match-end modal and finishMatch() read from.
var matchWinner = null;

function renderCoinCount() {
  if (!econState) { return; }
  var val = econState.coins;
  var menuEl = document.getElementById('menuCoinCount');
  if (menuEl) { menuEl.innerHTML = pixelDigitsHtml(val, 'oro', 3); }
}

// Syncs every static "who am I" spot in the UI (menu widget, shop/collection
// sidebars) to profileState -- the board's own profile footer re-reads
// profileState live via playerPhotoUrl()/playerDisplayName() on its next
// renderBoardActions(), so it doesn't need updating here.
function renderProfile() {
  if (!profileState) { return; }
  var name = playerDisplayName();
  var photo = playerPhotoUrl();

  var menuNameEl = document.getElementById('menuProfileName');
  if (menuNameEl) { menuNameEl.textContent = name; }
  var menuPhotoEl = document.getElementById('menuProfilePhoto');
  if (menuPhotoEl) { menuPhotoEl.src = photo; }

  document.querySelectorAll('.collection-profile-name').forEach(function (el) { el.textContent = name; });
  document.querySelectorAll('.collection-profile-photo').forEach(function (el) { el.src = photo; });

  var collectionSubEl = document.getElementById('menuCollectionSub');
  if (collectionSubEl && econState) {
    var progress = collectionProgress(econState.collection, CARD_CATALOG);
    collectionSubEl.textContent = progress.owned + ' DE ' + progress.total + ' CARTAS';
  }
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

// Real Base Set-era card back -- the CPU's hand always shows this one
// (see cpuHandRowHtml); it's also the fallback/default for the player's own
// deck/discard/prizes, which the player can instead personalize below.
var CARD_BACK_URL = 'Cartas/Cardback.jpg';

// Card backs the player can choose for their OWN deck/discard/prizes only
// -- the rival's cards always show CARD_BACK_URL, per user request. A
// plain array (not hardcoded selects) so a future shop unlock can just push
// another entry here without touching the picker markup or logic. Entries
// with no `cost` are free/always available; the rest are the Tienda's
// "Protectores" (real Cloud Function purchase -- see buyCardBackCloud),
// only selectable once their id shows up in econState.cardBacks.
var PROTECTOR_COST = 75;
var CARD_BACK_OPTIONS = [
  { id: 'clasico', name: 'Clásico', img: CARD_BACK_URL },
  { id: 'pocket_monsters', name: 'Pocket Monsters', img: 'Cartas/Cardback_PocketMonsters.png' },
  { id: 'arcoiris', name: 'Arcoíris', img: 'Cartas/Cardback_Arcoiris.png' },
  { id: 'protector_koffing', name: 'Koffing', img: 'Cartas/Protector_Koffing.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_pikachu', name: 'Pikachu', img: 'Cartas/Protector_Pikachu.png?v=2', cost: PROTECTOR_COST },
  // Edge-to-edge black art with no border of its own -- outline:true adds a
  // white frame so it doesn't blend into the shop card's dark background.
  { id: 'protector_team_rocket', name: 'Team Rocket', img: 'Cartas/Protector_TeamRocket.png?v=2', cost: PROTECTOR_COST, outline: true },
  { id: 'protector_pokebola_morada', name: 'Poké Ball Morada', img: 'Cartas/Protector_PokebolaMorada.png?v=4', cost: PROTECTOR_COST },
  { id: 'protector_fantasma', name: 'Fantasma', img: 'Cartas/Protector_Fantasma.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_perona', name: 'Perona', img: 'Cartas/Protector_Perona.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_sasuke', name: 'Sasuke', img: 'Cartas/Protector_Sasuke.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_squirtle', name: 'Squirtle', img: 'Cartas/Protector_Squirtle.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_charmander', name: 'Charmander', img: 'Cartas/Protector_Charmander.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_bulbasaur', name: 'Bulbasaur', img: 'Cartas/Protector_Bulbasaur.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_messi', name: 'Messi', img: 'Cartas/Protector_Messi.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_ronaldo', name: 'Ronaldo', img: 'Cartas/Protector_Ronaldo.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_pikachu_sorprendido', name: 'Pikachu Sorprendido', img: 'Cartas/Protector_PikachuSorprendido.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_six_seven', name: 'Six Seven', img: 'Cartas/Protector_SixSeven.png', cost: PROTECTOR_COST },
  { id: 'protector_trollface', name: 'Trollface', img: 'Cartas/Protector_TrollFace.png', cost: PROTECTOR_COST },
  { id: 'protector_fuuuu', name: 'Fuuuu', img: 'Cartas/Protector_Fuuuu.png', cost: PROTECTOR_COST }
];
var DEFAULT_CARD_BACK_ID = 'clasico';

function ownsCardBack(id) {
  var opt = CARD_BACK_OPTIONS.filter(function (o) { return o.id === id; })[0];
  if (!opt) { return false; }
  if (!opt.cost) { return true; }
  return !!(econState && econState.cardBacks && econState.cardBacks.indexOf(id) !== -1);
}

function getCardBackId() {
  var id = localStorage.getItem('tcg_card_back');
  return (CARD_BACK_OPTIONS.some(function (o) { return o.id === id; }) && ownsCardBack(id)) ? id : DEFAULT_CARD_BACK_ID;
}
function setCardBackId(id) {
  if (!ownsCardBack(id)) { return; }
  try { localStorage.setItem('tcg_card_back', id); } catch (e) {}
}
// The rival's face-down cards never change -- only 'player' reads the
// chosen option; any other owner falls back to the real default.
function cardBackUrlFor(ownerId) {
  if (ownerId !== 'player') { return CARD_BACK_URL; }
  var chosen = CARD_BACK_OPTIONS.filter(function (o) { return o.id === getCardBackId(); })[0];
  return chosen ? chosen.img : CARD_BACK_URL;
}

function renderCardBackPicker() {
  var grid = document.getElementById('configCardBackGrid');
  if (!grid) { return; }
  var selected = getCardBackId();
  var owned = CARD_BACK_OPTIONS.filter(function (o) { return ownsCardBack(o.id); });
  grid.innerHTML = owned.map(function (o) {
    return '<div class="shell-config-cardback-option' + (o.id === selected ? ' selected' : '') +
      '" data-card-back-id="' + o.id + '" title="' + escapeHtml(o.name) + '">' +
      '<img src="' + o.img + '" alt="' + escapeHtml(o.name) + '"' + (o.outline ? ' class="outlined"' : '') + '>' +
      '<span>' + escapeHtml(o.name) + '</span></div>';
  }).join('');
  grid.querySelectorAll('.shell-config-cardback-option').forEach(function (el) {
    el.addEventListener('click', function () {
      setCardBackId(el.getAttribute('data-card-back-id'));
      renderCardBackPicker();
      // Live-update the board if a match is already in progress.
      if (gameState && gameState.phase === 'playing') { renderBoard(); }
    });
  });
}

// Real card artwork, reused from the same catalog data that backs the
// booster/collection feature (data-sets.js) -- every card in Overgrowth and
// Blackout is a Base Set card, so this lookup covers the whole game.
var CARD_IMAGE_BY_NAME = {};
var CARD_SUPERTYPE_BY_NAME = {};
['base', 'jungle', 'fossil'].forEach(function (setKey) {
  (CARD_CATALOG[setKey] || []).forEach(function (c) {
    CARD_IMAGE_BY_NAME[c.n] = c.img;
    CARD_SUPERTYPE_BY_NAME[c.n] = c.st;
  });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

// Colors each log line by whose side it's about -- green for the player,
// red/orange for the CPU -- using the ownerId logEvent tagged it with
// (rules-engine.js). Lines with no owner (coin flips, setup instructions)
// render in the log panel's default (neutral) color.
function logHtml(s) {
  return s.log.slice(-30).map(function (entry) {
    var cls = entry.ownerId === 'player' ? 'log-line-player' : entry.ownerId === 'cpu' ? 'log-line-cpu' : 'log-line-neutral';
    return '<div class="' + cls + '">' + escapeHtml(entry.msg) + '</div>';
  }).join('');
}

function cardImageTag(name, cls) {
  var url = CARD_IMAGE_BY_NAME[name];
  return url ? '<img class="' + cls + '" src="' + url + '" alt="' + escapeHtml(name) + '" loading="lazy">' : '';
}

// Real weakness/resistance/retreat-cost trio (data-cards.js), shown under
// the attacks panel in the card viewer -- weaknesses/resistances are only
// ever a single entry for these cards, matching the real Base Set prints.
function viewerTrioHtml(stats) {
  var weakness = stats.weaknesses && stats.weaknesses[0];
  var resistance = stats.resistances && stats.resistances[0];
  var retreatCost = stats.retreatCost || 0;
  var weaknessHtml = (weakness && ENERGY_CARD_TYPE_ICON[weakness.type])
    ? '<img src="Tipos/' + ENERGY_CARD_TYPE_ICON[weakness.type] + '.png" alt="">'
    : '<div class="shell-board-viewer-trio-dash">—</div>';
  var resistanceHtml = (resistance && ENERGY_CARD_TYPE_ICON[resistance.type])
    ? '<img src="Tipos/' + ENERGY_CARD_TYPE_ICON[resistance.type] + '.png" alt="">'
    : '<div class="shell-board-viewer-trio-dash">—</div>';
  var retreatHtml = retreatCost > 0
    ? '<div class="shell-board-viewer-trio-retreat"><img src="Tipos/incoloro.png" alt="">' + (retreatCost > 1 ? '<span>×' + retreatCost + '</span>' : '') + '</div>'
    : '<div class="shell-board-viewer-trio-dash">—</div>';
  return '<div class="shell-board-viewer-trio">' +
    '<div class="shell-board-viewer-trio-box"><div class="shell-board-viewer-trio-label">DEBILIDAD</div>' + weaknessHtml + '</div>' +
    '<div class="shell-board-viewer-trio-box"><div class="shell-board-viewer-trio-label">RESISTENCIA</div>' + resistanceHtml + '</div>' +
    '<div class="shell-board-viewer-trio-box"><div class="shell-board-viewer-trio-label">RETIRADA</div>' + retreatHtml + '</div>' +
    '</div>';
}

// 'BÁSICO' / 'ETAPA 1' / 'ETAPA 2', derived from the real evolvesFrom chain
// (data-cards.js has no explicit stage field) -- every card actually used by
// Overgrowth/Blackout only ever reaches Stage 1, but this stays correct for
// any future deck that goes deeper.
function pokemonStageLabel(name) {
  var stats = CARD_STATS[name];
  if (!stats || !stats.evolvesFrom) { return 'BÁSICO'; }
  var prev = CARD_STATS[stats.evolvesFrom];
  if (!prev || !prev.evolvesFrom) { return 'ETAPA 1'; }
  return 'ETAPA 2';
}

// actionableState is the live gameState when these rows should be real,
// clickable attack buttons (viewing your own current Active, during your
// turn, no pending prize choice) -- null/undefined renders plain read-only
// rows instead, used when inspecting any other card (hand, bench, rival's).
function viewerAttacksHtml(name, actionableState) {
  var stats = CARD_STATS[name];
  if (!stats || stats.supertype !== 'Pokémon' || !stats.attacks || !stats.attacks.length) { return ''; }
  var rows = stats.attacks.map(function (atk) {
    var costHtml = atk.cost.map(function (c) {
      var icon = ENERGY_CARD_TYPE_ICON[c];
      return icon ? '<img src="Tipos/' + icon + '.png" alt="">' : '';
    }).join('');
    var nameEs = translateAttackName(atk.name);
    var textEs = translateAttackText(name, atk.name);
    var body = '<div class="shell-board-viewer-attack-cost">' + costHtml + '</div>' +
      '<div class="shell-board-viewer-attack-body">' +
        '<div class="shell-board-viewer-attack-name">' + escapeHtml(nameEs) + '</div>' +
        (textEs ? '<div class="shell-board-viewer-attack-text">' + escapeHtml(textEs) + '</div>' : '') +
      '</div>' +
      '<div class="shell-board-viewer-attack-damage">' + (atk.damage || '0') + '</div>';
    if (actionableState) {
      var can = canAttack(actionableState, 'player', atk.name);
      return '<button type="button" class="shell-board-viewer-attack actionable" data-attack-name="' + escapeHtml(atk.name) + '"' + (can ? '' : ' disabled') + '>' + body + '</button>';
    }
    return '<div class="shell-board-viewer-attack">' + body + '</div>';
  }).join('');
  return '<div class="shell-board-viewer-attacks"><div class="shell-board-viewer-attacks-header">ATAQUES</div>' + rows + '</div>';
}

// Looks up a live battle instance by id on either side of the board (not
// just one player's, unlike rules-engine.js's own findInstance) -- the
// viewer needs this to show real current HP/energy/status for whichever
// card was clicked, CPU's included.
function findInstanceEitherSide(instanceId) {
  if (!instanceId) { return null; }
  return findInstance(gameState.players.player, instanceId) || findInstance(gameState.players.cpu, instanceId);
}

// Fills the card viewer (Column A) with a card's illustration, identity, and
// (for Pokémon) its real attacks + weakness/resistance/retreat -- shown by
// clicking the card itself (hand or board). Attack rows are only real,
// clickable buttons when the card being viewed is the player's own current
// Active during their own turn; otherwise this is a read-only reference,
// same as it's always been for any card that isn't actionable.
function showCardInViewer(name, instanceId) {
  var url = CARD_IMAGE_BY_NAME[name];
  if (!url) { return; }
  var stats = CARD_STATS[name];
  var instance = findInstanceEitherSide(instanceId);
  var isOwnActive = !!(instanceId && gameState.players.player.active && gameState.players.player.active.id === instanceId);
  var pendingPlayerPrize = gameState.pendingPrizeChoice && gameState.pendingPrizeChoice.playerId === 'player';
  var actionableState = (isOwnActive && gameState.phase === 'playing' && gameState.activePlayerId === 'player' && !pendingPlayerPrize) ? gameState : null;

  var frameHtml = '<div class="shell-board-viewer-frame">' +
    '<div class="shell-board-viewer-frame-inner"><img src="' + url + '" alt="' + escapeHtml(name) + '"></div>' +
    '<div class="shell-board-viewer-corner tl"></div><div class="shell-board-viewer-corner br"></div>' +
    '</div>';

  var bodyHtml;
  if (stats && stats.supertype === 'Pokémon') {
    var damage = instance ? instance.damage : 0;
    var hp = stats.hp - damage;
    var typeIcon = stats.types && ENERGY_CARD_TYPE_ICON[stats.types[0]];
    var identityHtml = '<div class="shell-board-viewer-identity">' +
      (typeIcon ? '<img src="Tipos/' + typeIcon + '.png" alt="">' : '') +
      '<div class="shell-board-viewer-identity-name">' + escapeHtml(translateCardName(name)) + '</div>' +
      '<div class="shell-board-viewer-identity-stage">' + pokemonStageLabel(name) + '</div>' +
      '<div class="shell-board-viewer-identity-hp">' + hp + '<span>/' + stats.hp + '</span></div>' +
      '</div>';
    var statusHtml = (instance && instance.statusConditions.length)
      ? '<div class="shell-board-viewer-note">' + escapeHtml(instance.statusConditions.map(translateStatus).join(', ')) + '</div>'
      : '';
    bodyHtml = identityHtml + viewerAttacksHtml(name, actionableState) + statusHtml + viewerTrioHtml(stats);
  } else {
    bodyHtml = '<div class="shell-board-viewer-identity"><div class="shell-board-viewer-identity-name">' + escapeHtml(translateCardName(name)) + '</div></div>';
  }

  document.getElementById('cardViewer').innerHTML = frameHtml + bodyHtml;

  if (actionableState) {
    document.querySelectorAll('#cardViewer .shell-board-viewer-attack.actionable').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var atkName = btn.getAttribute('data-attack-name');
        if (canAttack(gameState, 'player', atkName)) { attack(gameState, 'player', atkName); afterPlayerAction(); }
      });
    });
  }
}

// imgUrl is optional: some callers only have a bare card name (e.g. gameplay
// code working from a deck, where CARD_IMAGE_BY_NAME's name->image lookup is
// safe because no card name in Overgrowth/Blackout is ambiguous). Callers
// that already have the specific card object in hand (collection grid,
// booster result) MUST pass its own img explicitly instead of relying on
// that lookup -- 34 of the 228 catalog cards share a name with a
// differently-illustrated reprint in another set or at another rarity (e.g.
// Haunter: Base Set #29 vs Fossil #6/#21), so the name-keyed table can only
// ever hold one of them and silently shows the wrong art for the others.
function openCardModal(name, imgUrl) {
  var url = imgUrl || CARD_IMAGE_BY_NAME[name];
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
    return '<div class="shell-discard-pile-card-item"><img src="' + url + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' +
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
    return '<div class="shell-energy-discard-option' + (selected ? ' selected' : '') + '" data-energy-index="' + i + '">' +
      cardImageTag(cardName, '') + '<span>' + escapeHtml(translateCardName(cardName)) + '</span></div>';
  }).join('');
  grid.querySelectorAll('.shell-energy-discard-option').forEach(function (el) {
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

// Shown whenever gameState.pendingActiveChoice === 'player' (see
// rules-engine.js's knockOutIfNeeded/chooseNewActive) -- a real mandatory
// choice, not an auto-promoted Bench Pokémon: no backdrop-click or Escape
// dismissal, since real TCG rules don't let you skip placing a new Active.
function renderActiveChoiceModal() {
  var p = gameState.players.player;
  var grid = document.getElementById('activeChoiceGrid');
  grid.innerHTML = p.bench.map(function (instance) {
    return '<button type="button" class="shell-active-choice-card" data-instance-id="' + instance.id + '">' +
      cardImageTag(instance.name, 'shell-board-card-art') +
      '<span>' + escapeHtml(translateCardName(instance.name)) + '</span>' +
      '</button>';
  }).join('');
  grid.querySelectorAll('.shell-active-choice-card').forEach(function (btn) {
    btn.addEventListener('click', function () {
      chooseNewActive(gameState, 'player', btn.getAttribute('data-instance-id'));
      afterPlayerAction();
    });
  });
  document.getElementById('activeChoiceModal').classList.remove('hidden');
}

// One small icon per attached energy, overlaid in the card's top-left
// corner -- same visual trick the hand cards used for their type icon,
// reused here to show the real attached-energy count/types at a glance
// (bench cards previously showed no energy info at all; the Active's own
// separate energy row is retired in favor of this single mechanism).
function cardEnergiesOverlayHtml(attachedEnergy) {
  if (!attachedEnergy.length) { return ''; }
  var icons = attachedEnergy.map(function (e) {
    var icon = ENERGY_CARD_TYPE_ICON[e];
    return icon ? '<img src="Tipos/' + icon + '.png" alt="">' : '';
  }).join('');
  return '<div class="shell-board-card-energies">' + icons + '</div>';
}

// Same overlay mechanic as the attached-energy icons, but anchored to the
// card's bottom edge (see .shell-board-active-status-badges) so it never
// collides with the energy icons sitting up top. Only the Active shows this
// -- the Bench doesn't display Special Conditions in the real rules.
function cardStatusOverlayHtml(statusConditions) {
  if (!statusConditions.length) { return ''; }
  var badges = statusConditions.map(function (s) { return pixelStatusBadgeHtml(s, 2); }).join('');
  return '<div class="shell-board-active-status-badges">' + badges + '</div>';
}

// `flipped` rotates the CPU's Bench art 180° too, same as its Active --
// per user request, so the whole rival side reads consistently as "facing
// across the table" instead of just the Active looking that way.
function benchCardHtml(instance, mine, flipped) {
  var stats = CARD_STATS[instance.name];
  var hp = stats.hp - instance.damage;
  var pct = Math.max(0, Math.round((hp / stats.hp) * 100));
  var cardHtml = '<div class="shell-board-bench-card' + (mine ? ' mine' : '') + (flipped ? ' flipped' : '') +
    '" data-instance-id="' + instance.id + '" data-card-name="' + escapeHtml(instance.name) + '">' +
    cardImageTag(instance.name, 'shell-board-card-art') + cardEnergiesOverlayHtml(instance.attachedEnergy) + '</div>';
  var hpHtml = '<div class="shell-board-bench-hp"><div class="shell-board-bench-hp-fill' + (mine ? ' mine' : '') + '" style="width:' + pct + '%"></div></div>';
  var nameHtml = '<div class="shell-board-bench-name">' + escapeHtml(translateCardName(instance.name)) + '</div>';
  return '<div class="shell-board-bench-slot">' + cardHtml + hpHtml + nameHtml + '</div>';
}

function benchEmptyHtml(mine) {
  var cls = 'shell-board-bench-empty' + (mine ? ' pickable' : '');
  return '<div class="shell-board-bench-slot"><div class="' + cls + '"' + (mine ? ' data-owner="player"' : '') + '>BANCA</div></div>';
}

function benchRowHtml(bench, mine, flipped) {
  var html = '<div class="shell-board-bench-row">';
  for (var i = 0; i < 5; i++) {
    html += bench[i] ? benchCardHtml(bench[i], mine, flipped) : benchEmptyHtml(mine);
  }
  html += '</div>';
  return html;
}

// `flipped` rotates the CPU's Active art 180° so it faces the player across
// the table -- name plate stays upright/readable, only the illustration
// flips (see .shell-board-active-card.flipped). Attached energy shows as
// the same top-left icon overlay bench cards use, not a separate row.
function activeColHtml(activeInstance, mine, flipped) {
  if (!activeInstance) {
    return '<div class="shell-board-active-col"><div class="shell-board-active-empty">SIN ACTIVO</div></div>';
  }
  var stats = CARD_STATS[activeInstance.name];
  var hp = stats.hp - activeInstance.damage;
  var nameEs = escapeHtml(translateCardName(activeInstance.name));
  var namePlate = '<div class="shell-board-active-name-plate' + (mine ? ' mine' : '') + '">' +
    '<span class="name">' + nameEs + '</span><span class="hp">' + hp + '/' + stats.hp + '</span></div>';
  var cardHtml = '<div class="shell-board-active-card' + (mine ? ' mine' : '') + (flipped ? ' flipped' : '') +
    '" data-instance-id="' + activeInstance.id + '" data-card-name="' + escapeHtml(activeInstance.name) + '">' +
    cardImageTag(activeInstance.name, 'shell-board-card-art') + cardEnergiesOverlayHtml(activeInstance.attachedEnergy) +
    cardStatusOverlayHtml(activeInstance.statusConditions) +
    '</div>';
  var order = mine ? (cardHtml + namePlate) : (namePlate + cardHtml);
  return '<div class="shell-board-active-col">' + order + '</div>';
}

function sideHeaderHtml(ownerId) {
  var mine = ownerId === 'player';
  var name = mine ? escapeHtml(playerDisplayName()) : 'CPU';
  var avatar = mine ? playerPhotoUrl() : PROFILE_PHOTO_URL.cpu;
  var on = gameState.activePlayerId === ownerId;
  return '<div class="shell-board-side-header' + (mine ? ' mine' : '') + '">' +
    '<div class="shell-board-side-avatar"><img src="' + avatar + '" alt=""></div>' +
    '<div class="shell-board-side-name">' + name + '</div>' +
    '<div class="shell-board-side-led' + (on ? '' : ' off') + '"></div>' +
    '</div>';
}

// Deck (always face-down, just a count) and Discard pile -- only the count
// matters at a glance; the discard's actual cards are one click away (see
// openDiscardPileModal). Both use the real card back, per user request.
function deckDiscardRowHtml(state, ownerId) {
  var p = state.players[ownerId];
  var mine = ownerId === 'player';
  var discardCount = p.discard.length;
  var backUrl = cardBackUrlFor(ownerId);
  var deckArt = '<div class="shell-board-deckbox-art"><img src="' + backUrl + '" alt="Mazo boca abajo"></div>';
  var discardArt = discardCount > 0
    ? '<div class="shell-board-deckbox-art"><img src="' + backUrl + '" alt="Descarte boca abajo"></div>'
    : '<div class="shell-board-deckbox-art empty"></div>';
  return '<div class="shell-board-deckrow">' +
    '<div class="shell-board-deckbox" title="Mazo">' + deckArt + '<div class="shell-board-deckbox-label">MAZO ' + p.deck.length + '</div></div>' +
    '<div class="shell-board-deckbox' + (discardCount > 0 ? ' clickable' : '') + '"' +
    (discardCount > 0 ? ' data-discard-owner="' + ownerId + '" title="Ver descarte"' : '') + '>' +
    discardArt + '<div class="shell-board-deckbox-label' + (discardCount === 0 ? ' empty' : '') + '">DESC. ' + discardCount + '</div></div>' +
    '</div>';
}

// Each prize is a specific, already-determined face-down card (set aside in
// createGame). When the player has a pending choice (rules-engine.js's
// state.pendingPrizeChoice), their own prize cards become clickable so they
// pick which one to flip -- instead of it being auto-resolved.
function prizeGridHtml(state, ownerId) {
  var p = state.players[ownerId];
  var mine = ownerId === 'player';
  var choosable = mine && state.pendingPrizeChoice && state.pendingPrizeChoice.playerId === 'player';
  var backUrl = cardBackUrlFor(ownerId);
  var html = '<div class="shell-board-prize-label' + (mine ? ' mine' : '') + '">PREMIOS · ' + p.prizes.length + '</div><div class="shell-board-prize-grid">';
  for (var i = 0; i < 6; i++) {
    if (i < p.prizes.length) {
      var cls = 'shell-board-prize-card' + (choosable ? ' choosable' : '');
      html += '<div class="' + cls + '"' + (choosable ? ' data-prize-index="' + i + '" title="Elegir esta carta de premio"' : '') + '>' +
        '<img src="' + backUrl + '" alt="Carta de premio boca abajo"></div>';
    } else {
      html += '<div class="shell-board-prize-card empty"></div>';
    }
  }
  html += '</div>';
  return html;
}

function cpuHandRowHtml(count) {
  var cards = '';
  for (var i = 0; i < count; i++) { cards += '<div class="shell-board-hand-cpu-card"><img src="' + CARD_BACK_URL + '" alt="Carta boca abajo"></div>'; }
  return '<div class="shell-board-hand-cpu">' +
    '<div class="shell-board-hand-cpu-label"><span>MANO CPU</span><span class="shell-board-hand-cpu-count">' + count + '</span></div>' +
    '<div class="shell-board-hand-cpu-fan">' + cards + '</div>' +
    '</div>';
}

function handBandHtml(state) {
  var p = state.players.player;
  var cardsHtml = p.hand.map(function (card) {
    // During setup, only Basic Pokémon can be placed -- Energy/Trainer cards
    // can't be used until the match actually starts.
    var disabled = state.phase === 'setup' && !isBasicPokemon(card.name);
    return '<button type="button" class="shell-board-hand-card-wrap" data-hand-id="' + card.id + '" data-card-name="' + escapeHtml(card.name) + '"' + (disabled ? ' disabled' : '') + '>' +
      '<div class="shell-board-hand-card">' + cardImageTag(card.name, '') + '</div>' +
      '<div class="shell-board-hand-card-name">' + escapeHtml(translateCardName(card.name)) + '</div>' +
      '</button>';
  }).join('');
  return '<div class="shell-board-hand-band">' +
    '<div class="shell-board-hand-header"><span>MANO · ' + p.hand.length + '</span><span class="shell-board-hand-header-rule"></span></div>' +
    '<div class="shell-board-hand-cards">' + cardsHtml + '</div>' +
    '</div>';
}

// Column A's lower half: setup's coin-flip button, or (during play) the
// Retirada/Habilidad/Pasar turno grid, plus the player's own profile footer.
// Habilidad stays visible but disabled -- there is no Pokémon Powers/
// Abilities system in this game yet, only attacks/trainers/retreat/energy.
function renderBoardActions() {
  var s = gameState;
  var p = s.players.player;
  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';
  var pendingActive = s.pendingActiveChoice === 'player';
  var html = '';

  if (s.phase === 'setup') {
    html += '<div class="shell-board-actions"><button type="button" class="shell-board-action-start" id="startMatchBtn"' + (p.active ? '' : ' disabled') + '>🪙 LANZAR MONEDA Y COMENZAR</button></div>';
  } else if (s.phase === 'playing' && !pendingPlayerPrize && !pendingActive) {
    var canRetreatAny = p.bench.some(function (b) { return canRetreat(s, 'player', b.id); });
    html += '<div class="shell-board-actions"><div class="shell-board-actions-grid">' +
      '<button type="button" class="shell-board-action" id="retreatBtn"' + (canRetreatAny ? '' : ' disabled') + '>CAMBIAR POKÉMON</button>' +
      '<button type="button" class="shell-board-action" disabled title="Próximamente">HABILIDAD</button>' +
      '<button type="button" class="shell-board-action-gold" id="endTurnBtn">PASAR TURNO ▶</button>' +
      '</div></div>';
  }

  html += '<div class="shell-board-viewer-footer">' +
    '<div class="shell-board-viewer-footer-avatar"><img src="' + playerPhotoUrl() + '" alt=""></div>' +
    '<div class="shell-board-viewer-footer-name">' + escapeHtml(playerDisplayName()) + '</div>' +
    '<div class="shell-board-viewer-footer-coin-dot">' + pixelCoinHtml('oro', 2) + '</div>' +
    '<div class="shell-board-viewer-footer-coin-value">' + (econState ? econState.coins : '--') + '</div>' +
    '</div>';

  document.getElementById('boardActions').innerHTML = html;
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;

  // The CPU's side runs Bench-then-Active (top to bottom) while the
  // player's runs Active-then-Bench, so the two Actives meet in the middle
  // like facing across a real table, instead of both sides reading the
  // same top-to-bottom order as if looking the same direction.
  var boardHtml = cpuHandRowHtml(c.hand.length) +
    '<div class="shell-board-zone">' +
    '<div class="shell-board-centerline"></div><div class="shell-board-centerline-diamond"></div>' +
    benchRowHtml(c.bench, false, true) +
    activeColHtml(c.active, false, true) +
    activeColHtml(p.active, true, false) +
    benchRowHtml(p.bench, true, false) +
    '</div>';

  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';
  var pendingActive = s.pendingActiveChoice === 'player';
  if (pendingPlayerPrize) {
    boardHtml += '<div class="shell-board-prize-pending">¡Noqueaste un Pokémon! Elige una de tus cartas de premio para tomarla.</div>';
  } else if (!pendingActive) {
    boardHtml += handBandHtml(s);
  }
  document.getElementById('app').innerHTML = boardHtml;

  if (pendingActive) {
    renderActiveChoiceModal();
  } else {
    document.getElementById('activeChoiceModal').classList.add('hidden');
  }

  // Column C: CPU block (header → deck/discard → prizes) on top, mine
  // (mirrored) on the bottom, sharing one flexible spacer -- this is what
  // keeps both sides' prizes/actives level and comparable at a glance.
  document.getElementById('boardSide').innerHTML =
    sideHeaderHtml('cpu') + deckDiscardRowHtml(s, 'cpu') + prizeGridHtml(s, 'cpu') +
    '<div class="shell-board-side-spacer"></div>' +
    prizeGridHtml(s, 'player') + deckDiscardRowHtml(s, 'player') + sideHeaderHtml('player');

  renderBoardActions();
  document.getElementById('log').innerHTML = logHtml(s);

  document.getElementById('boardPhaseText').textContent = s.phase === 'setup' ? 'PREPARACIÓN' : 'FASE PRINCIPAL';
  document.getElementById('boardTurnLabel').textContent = 'TURNO ' + s.turnCounter;
  var turnValueEl = document.getElementById('boardTurnValue');
  if (s.phase === 'setup') {
    turnValueEl.textContent = 'PREPARANDO';
    turnValueEl.classList.remove('cpu');
  } else if (s.activePlayerId === 'player') {
    turnValueEl.textContent = 'TU TURNO';
    turnValueEl.classList.remove('cpu');
  } else {
    turnValueEl.textContent = 'TURNO DE LA CPU';
    turnValueEl.classList.add('cpu');
  }

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
// finds a real win condition (including running out of time -- see
// tickGameClock) and when the player surrenders (see surrenderConfirmBtn's
// handler), so it doesn't re-derive the winner from game state itself.
// "Nueva partida" lives on matchEndReplayBtn instead of a button rendered here.
function finishMatch(winner) {
  matchWinner = winner;
  stopGameClock();
  playMatchEndMusic(winner);
  awardMatchResultCloud(winner === 'player' ? 'win' : 'loss')
    .catch(function (e) { console.error('No se pudo registrar el resultado de la partida', e); });
  renderBoard(); // shows the final board state (last action's results)
  var textEl = document.getElementById('matchEndText');
  textEl.textContent = winner === 'player' ? 'Has Ganado' : 'Has Perdido';
  textEl.classList.remove('win', 'loss');
  textEl.classList.add(winner === 'player' ? 'win' : 'loss');
  document.getElementById('matchEndModal').classList.remove('hidden');
}

function wireBoardButtons() {
  var handButtons = document.querySelectorAll('.shell-board-hand-card-wrap');
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
      // no board card element on the page to click as a target anyway.
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

  var startMatchBtn = document.getElementById('startMatchBtn');
  if (startMatchBtn) {
    startMatchBtn.addEventListener('click', function () {
      if (gameState.phase === 'setup' && gameState.players.player.active) {
        startMatch(gameState);
        startGameClock();
        startDuelMusic();
        showCardInViewer(gameState.players.player.active.name, gameState.players.player.active.id);
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
  // you want to swap in -- handled by the shared bench/active card handler.
  var retreatBtn = document.getElementById('retreatBtn');
  if (retreatBtn) {
    retreatBtn.addEventListener('click', function () {
      selectedHandId = null;
      retreatMode = true;
    });
  }

  document.querySelectorAll('.shell-board-bench-card, .shell-board-active-card').forEach(function (el) {
    el.addEventListener('click', function () {
      var instanceId = el.getAttribute('data-instance-id');
      showCardInViewer(el.getAttribute('data-card-name'), instanceId);
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
        // Refresh the viewer to the evolved Pokémon (new name/HP/attacks/
        // status) -- it was showing a snapshot of the pre-evolution card
        // from the showCardInViewer() call at the top of this handler.
        var evolved = findInstanceEitherSide(instanceId);
        if (evolved) { showCardInViewer(evolved.name, instanceId); }
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
  document.querySelectorAll('.shell-board-bench-empty.pickable').forEach(function (el) {
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

  document.querySelectorAll('.shell-board-prize-card.choosable').forEach(function (el) {
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

  document.querySelectorAll('.shell-board-deckbox.clickable').forEach(function (el) {
    el.addEventListener('click', function () {
      openDiscardPileModal(el.getAttribute('data-discard-owner'));
    });
  });
}

// ── Chess clock (both players, real time bank) ──────────────────────
// The engine (rules-engine.js) stays pure/deterministic: it only knows how
// to subtract an elapsed duration (tickClock) and treat a depleted bank as
// a loss (getWinner). Real wall-clock timing lives here.
var CLOCK_TICK_MS = 250;
var clockIntervalId = null;
var clockLastTickAt = null;

function formatClockMs(ms) {
  var totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  var m = Math.floor(totalSeconds / 60);
  var sec = totalSeconds % 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// Same pixel-glyph digit rendering the coin/collection counts use (not
// plain browser text) -- per user feedback that the clock looked
// inconsistent next to them.
function renderClockDisplay(el, ms, isCpu) {
  var low = ms <= 30000;
  el.innerHTML = pixelDigitsHtml(formatClockMs(ms), (isCpu || low) ? 'dano' : 'oro', 2);
  el.classList.toggle('cpu', !!isCpu);
  el.classList.toggle('low', low);
}

function renderClocks() {
  var s = gameState;
  var el = document.getElementById('boardClock');
  if (!s || s.phase !== 'playing' || !s.activePlayerId) { return; }
  var activeId = s.activePlayerId;
  var remaining = s.players[activeId].timeBankMs;
  renderClockDisplay(el, remaining, activeId === 'cpu');
}

function tickGameClock() {
  if (!gameState || gameState.phase !== 'playing' || !gameState.activePlayerId) { return; }
  var now = Date.now();
  var elapsed = clockLastTickAt ? (now - clockLastTickAt) : 0;
  clockLastTickAt = now;
  tickClock(gameState, gameState.activePlayerId, elapsed);
  renderClocks();
  var winner = getWinner(gameState);
  if (winner) { finishMatch(winner); }
}

function startGameClock() {
  stopGameClock();
  clockLastTickAt = Date.now();
  clockIntervalId = setInterval(tickGameClock, CLOCK_TICK_MS);
  renderClocks();
}

function stopGameClock() {
  if (clockIntervalId) { clearInterval(clockIntervalId); clockIntervalId = null; }
  clockLastTickAt = null;
}

function startNewMatch() {
  matchWinner = null;
  stopGameClock();
  stopDuelMusic();
  document.getElementById('matchEndMusic').pause();
  document.getElementById('matchEndModal').classList.add('hidden');
  gameState = createGame(Math.random);
  aiSetupBoard(gameState, 'cpu');
  logEvent(gameState, 'Coloca tu Pokémon Activo y, si quieres, tu Banca (máx. 5) antes de empezar.');
  // renderClocks() itself no-ops during 'setup' (no activePlayerId yet), so
  // the clock display is reset here directly -- otherwise it would keep
  // showing whatever the previous match's clock last read.
  renderClockDisplay(document.getElementById('boardClock'), DEFAULT_TIME_BANK_MS, false);
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
  showShopTab('packs');
  renderShopScreen();
}

function hideShopScreen() {
  document.getElementById('shopScreen').classList.add('hidden');
}

// Two tabs for now (Packs / Protectores) -- Packs is the existing booster
// grid, Protectores is the new cosmetic card-back shop below.
function showShopTab(tab) {
  document.querySelectorAll('.shell-shop-tab').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-shop-tab') === tab);
  });
  document.getElementById('shopPacksPanel').classList.toggle('hidden', tab !== 'packs');
  document.getElementById('shopProtectorsPanel').classList.toggle('hidden', tab !== 'protectores');
  if (tab === 'protectores') { renderProtectorsGrid(); }
}

// Only updates the coin balance -- called on every Firestore snapshot
// (economy.js). Deliberately NOT rebuilding the card grid here: that would
// re-roll each card's random cover art out from under the player while
// they're looking at the screen, e.g. right after a purchase updates coins.
function updateShopBalance() {
  var balanceEl = document.getElementById('shopCoinBalance');
  if (balanceEl && econState) { balanceEl.innerHTML = pixelDigitsHtml(econState.coins, 'oro', 3); }
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
          '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 2) + pixelDigitsHtml(100, 'oro', 3) + '</span>' +
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

// Protectores: real cosmetic card backs bought with real coins (Cloud
// Function, see buyCardBackCloud) -- unlike the boosters above there's no
// randomness to re-roll, so re-rendering after a purchase is always safe.
function renderProtectorsGrid() {
  var grid = document.getElementById('shopProtectorsGrid');
  if (!grid || !econState) { return; }

  var protectors = CARD_BACK_OPTIONS.filter(function (o) { return o.cost; });
  grid.innerHTML = protectors.map(function (o) {
    var owned = ownsCardBack(o.id);
    var footer = owned
      ? '<span class="shell-shop-card-owned-label">EN TU COLECCIÓN</span>'
      : '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 2) + pixelDigitsHtml(o.cost, 'oro', 3) + '</span>' +
        '<button type="button" class="shell-shop-card-btn" data-buy-back="' + o.id + '">COMPRAR</button>';
    return '<div class="shell-shop-card' + (owned ? ' shell-shop-card-owned' : '') + '">' +
      '<div class="shell-shop-card-art protector"><img src="' + o.img + '" alt="' + escapeHtml(o.name) + '"' + (o.outline ? ' class="outlined"' : '') + '></div>' +
      '<div class="shell-shop-card-text">' +
        '<div class="shell-shop-card-name">' + escapeHtml(o.name.toUpperCase()) + '</div>' +
        '<div class="shell-shop-card-desc">PROTECTOR DE CARTAS</div>' +
      '</div>' +
      '<div class="shell-shop-card-footer">' + footer + '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('[data-buy-back]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-buy-back');
      btn.disabled = true;
      btn.textContent = 'COMPRANDO...';
      buyCardBackCloud(id)
        .then(function () {
          renderProtectorsGrid();
          renderCardBackPicker();
        })
        .catch(function (err) {
          alert(err.message || 'No se pudo comprar el protector.');
          btn.disabled = false;
          btn.textContent = 'COMPRAR';
        });
    });
  });
}

// Tracks where the collection screen was opened from, mirroring shopReturnTo.
var collectionReturnTo = 'menu';
var collectionFilters = { search: '', rarity: null };

var COLLECTION_RARITIES = [
  { key: 'Common', label: 'COMÚN', color: '#8dff62' },
  { key: 'Uncommon', label: 'INFRECUENTE', color: '#8dff62' },
  { key: 'Rare', label: 'RARA', color: '#e8c46a' },
  { key: 'Rare Holo', label: 'HOLOGRÁFICA', color: '#ff8a72' }
];

function showCollectionScreen(returnTo) {
  collectionReturnTo = returnTo;
  collectionFilters = { search: '', rarity: null };
  var searchInput = document.getElementById('collectionSearch');
  if (searchInput) { searchInput.value = ''; }
  document.getElementById('collectionScreen').classList.remove('hidden');
  renderCollectionScreen();
}

function hideCollectionScreen() {
  document.getElementById('collectionScreen').classList.add('hidden');
}

// Flattens the 3-set catalog into one list, joined with real owned counts.
function collectionAllCards() {
  var all = [];
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    var setTotal = CARD_CATALOG[setKey].length;
    CARD_CATALOG[setKey].forEach(function (c) {
      var key = setKey + '-' + c.num;
      all.push({
        setKey: setKey, setTotal: setTotal, num: c.num, name: c.n, rarity: c.r, img: c.img,
        count: (econState.collection[key] || 0)
      });
    });
  });
  return all;
}

// Builds the header progress bar, the rarity filter list (with real owned/
// total per rarity), and the real duplicates count. Called once per
// screen-open; the grid itself (renderCollectionGrid) re-renders on every
// filter change without rebuilding any of this.
function renderCollectionScreen() {
  if (!econState) { return; }
  var all = collectionAllCards();
  var owned = all.filter(function (c) { return c.count > 0; });

  var pct = all.length ? Math.round(owned.length / all.length * 100) : 0;
  document.getElementById('collectionProgressFill').style.width = pct + '%';
  document.getElementById('collectionProgressCount').innerHTML =
    pixelDigitsHtml(owned.length, 'fosforo', 2) +
    '<span class="shell-collection-progress-total">/' + all.length + '</span>';

  var rarityHtml = COLLECTION_RARITIES.map(function (r) {
    var ofThisRarity = all.filter(function (c) { return c.rarity === r.key; });
    var ownedOfThisRarity = ofThisRarity.filter(function (c) { return c.count > 0; }).length;
    var active = collectionFilters.rarity === r.key;
    return '<button type="button" class="shell-collection-rarity-row' + (active ? ' active' : '') + '" data-rarity="' + r.key + '">' +
      '<span class="shell-collection-rarity-name">' + r.label + '</span>' +
      '<span class="shell-collection-rarity-count" style="color:' + r.color + ';">' + ownedOfThisRarity + '/' + ofThisRarity.length + '</span>' +
      '</button>';
  }).join('');
  document.getElementById('collectionRarityList').innerHTML = rarityHtml;
  document.querySelectorAll('.shell-collection-rarity-row').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var r = btn.getAttribute('data-rarity');
      collectionFilters.rarity = collectionFilters.rarity === r ? null : r;
      renderCollectionScreen();
    });
  });

  var dupCount = owned.reduce(function (sum, c) { return sum + Math.max(0, c.count - 1); }, 0);
  document.getElementById('collectionDuplicates').innerHTML = pixelDigitsHtml(dupCount, 'oro', 3);

  renderCollectionGrid(all);
}

function renderCollectionGrid(all) {
  all = all || collectionAllCards();
  var search = collectionFilters.search;
  var rarity = collectionFilters.rarity;
  var filtered = all.filter(function (c) {
    if (rarity && c.rarity !== rarity) { return false; }
    if (search && translateCardName(c.name).toLowerCase().indexOf(search) === -1) { return false; }
    return true;
  });

  var html = filtered.map(function (c) {
    var owned = c.count > 0;
    var numLabel = ('000' + c.num).slice(-3) + '/' + c.setTotal;
    return '<div class="shell-collection-cell' + (owned ? '' : ' locked') + '" data-card-name="' + escapeHtml(c.name) + '" data-card-img="' + escapeHtml(c.img || '') + '">' +
      '<div class="shell-collection-cell-art">' +
        (c.img ? '<img src="' + c.img + '" alt="' + escapeHtml(c.name) + '" loading="lazy">' : '') +
        (owned ? '<span class="shell-collection-cell-count">' + c.count + '</span>' : '<div class="shell-collection-cell-veil">?</div>') +
      '</div>' +
      '<div class="shell-collection-cell-num">' + numLabel + '</div>' +
      '</div>';
  }).join('');

  var grid = document.getElementById('collectionGrid');
  grid.innerHTML = html || '<div class="shell-collection-empty">SIN RESULTADOS</div>';

  // This card's own img is passed through explicitly (see openCardModal) --
  // several names in the catalog are shared with a differently-illustrated
  // reprint elsewhere, so looking the art back up by bare name would risk
  // showing the wrong one, same as the bug this was just fixed to avoid.
  grid.querySelectorAll('.shell-collection-cell').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name, el.getAttribute('data-card-img')); }
    });
  });
}

function openBoosterSelectModal(setKey) {
  var packs = BOOSTER_PACKS[setKey];
  var names = BOOSTER_PACK_NAMES[setKey];
  var html = '';
  packs.forEach(function (src, i) {
    var fileName = src.split('/').pop();
    var name = names[fileName] || BOOSTER_NAMES[setKey];
    html += '<button type="button" class="shell-booster-variant" data-index="' + i + '">' +
      '<span class="shell-booster-variant-art"><img src="' + src + '" alt="' + name + '"></span>' +
      '<span class="shell-booster-variant-name">' + name.toUpperCase() + '</span>' +
      '</button>';
  });
  document.getElementById('boosterModalTitle').textContent = 'SOBRE ' + BOOSTER_NAMES[setKey].toUpperCase();
  document.getElementById('boosterModalPrice').innerHTML = pixelDigitsHtml(100, 'oro', 2);
  document.getElementById('boosterModalGrid').innerHTML = html;
  document.getElementById('boosterOpenBtn').disabled = true;
  document.getElementById('boosterSelectedInfo').textContent = 'TOCÁ UN SOBRE PARA SELECCIONARLO';
  boosterSelectState = { setKey: setKey, selectedPack: null };

  document.querySelectorAll('.shell-booster-variant').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('.shell-booster-variant').forEach(function (v) { v.classList.remove('selected'); });
      el.classList.add('selected');
      boosterSelectState.selectedPack = parseInt(el.getAttribute('data-index'), 10);
      document.getElementById('boosterOpenBtn').disabled = false;
      var fileName = packs[boosterSelectState.selectedPack].split('/').pop();
      var chosenName = names[fileName] || BOOSTER_NAMES[setKey];
      document.getElementById('boosterSelectedInfo').innerHTML =
        'SELECCIONADO: <strong>' + chosenName.toUpperCase() + '</strong>';
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
      showBoosterResult(cards, setKey);
    })
    .catch(function (err) {
      alert(err.message || 'No se pudo abrir el sobre.');
      document.getElementById('boosterOpenBtn').disabled = false;
    });
}

var BOOSTER_RESULT_RARITY = {
  'Rare Holo': { cls: 'holo', label: 'HOLOGRÁFICA' },
  Rare: { cls: 'rare', label: 'RARA' },
  Uncommon: { cls: 'uncommon', label: 'INFRECUENTE' },
  Common: { cls: 'common', label: 'COMÚN' }
};

// Tracks which set the currently-shown result came from, so "ABRIR OTRO"
// knows which pack-select modal to reopen.
var boosterResultSetKey = null;

function showBoosterResult(cards, setKey) {
  boosterResultSetKey = setKey;
  var counts = { holo: 0, rare: 0, uncommon: 0 };
  var html = '';
  cards.forEach(function (c) {
    // c.img is this exact card's own art (straight from the set that was
    // actually opened) -- NOT the ambiguous CARD_IMAGE_BY_NAME[c.n] lookup,
    // which silently picks a different set's/rarity's reprint for any of
    // the 34 catalog names that aren't unique (see openCardModal's comment).
    // That mismatch is exactly the "opened a Base pack, got a Fossil-art
    // Haunter" bug this fixes.
    var url = c.img || '';
    var rarity = BOOSTER_RESULT_RARITY[c.r] || BOOSTER_RESULT_RARITY.Common;
    if (counts[rarity.cls] !== undefined) { counts[rarity.cls]++; }
    html += '<div class="shell-booster-result-card ' + rarity.cls + '" data-card-name="' + escapeHtml(c.n) + '" data-card-img="' + escapeHtml(url) + '">' +
      '<div class="shell-booster-result-card-art">' +
        (url ? '<img src="' + url + '" alt="' + escapeHtml(c.n) + '" loading="lazy">' : '') +
        (rarity.cls === 'holo' ? '<div class="shell-booster-result-foil"></div>' : '') +
      '</div>' +
      '<div class="shell-booster-result-card-label">' + rarity.label + '</div>' +
      '</div>';
  });
  document.getElementById('boosterResultGrid').innerHTML = html;
  document.getElementById('boosterResultTitle').innerHTML =
    pixelDigitsHtml(cards.length, 'fosforo', 3) + ' CARTAS NUEVAS';

  var subtitleParts = [];
  if (counts.holo) { subtitleParts.push(counts.holo + (counts.holo > 1 ? ' HOLOGRÁFICAS' : ' HOLOGRÁFICA')); }
  if (counts.rare) { subtitleParts.push(counts.rare + (counts.rare > 1 ? ' RARAS' : ' RARA')); }
  if (counts.uncommon) { subtitleParts.push(counts.uncommon + ' INFRECUENTES'); }
  document.getElementById('boosterResultSubtitle').textContent = subtitleParts.join(' · ');

  document.getElementById('boosterResultModal').classList.remove('hidden');

  document.querySelectorAll('.shell-booster-result-card').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name, el.getAttribute('data-card-img')); }
    });
  });
}


// ── Mazos (deck selection) ────────────────────────────────────────
// Only "overgrowth" is a real, player-usable deck today -- "blackout" is
// the CPU's fixed deck (real data, not player-selectable yet) and there is
// no deck builder, so a third "new deck" slot is a generic placeholder,
// not a fabricated preset. See DECKLISTS in data-decks.js.
var ENERGY_CARD_TYPE_ICON = {
  Grass: 'planta', Fire: 'fuego', Water: 'agua', Lightning: 'rayo',
  Psychic: 'psiquico', Fighting: 'lucha', Colorless: 'incoloro'
};

function deckComposition(deckKey) {
  var counts = { pokemon: 0, trainer: 0, energy: 0 };
  var energies = [];
  var seenEnergy = {};
  DECKLISTS[deckKey].forEach(function (entry) {
    var st = CARD_SUPERTYPE_BY_NAME[entry.name];
    if (st === 'Pokémon') { counts.pokemon += entry.count; }
    else if (st === 'Trainer') { counts.trainer += entry.count; }
    else if (st === 'Energy') {
      counts.energy += entry.count;
      if (!seenEnergy[entry.name]) {
        seenEnergy[entry.name] = true;
        var typeWord = entry.name.replace(/ Energy$/, '');
        energies.push({ name: entry.name, count: entry.count, icon: ENERGY_CARD_TYPE_ICON[typeWord] });
      }
    }
  });
  return { pokemon: counts.pokemon, trainer: counts.trainer, energy: counts.energy, total: counts.pokemon + counts.trainer + counts.energy, energies: energies };
}

function renderDeckDetail(deckKey) {
  var comp = deckComposition(deckKey);
  var stats = [
    { label: 'POKÉMON', value: comp.pokemon },
    { label: 'ENTRENADOR', value: comp.trainer },
    { label: 'ENERGÍA', value: comp.energy }
  ];
  document.getElementById('deckStats').innerHTML = stats.map(function (s) {
    var pct = comp.total ? Math.round((s.value / comp.total) * 100) : 0;
    return '<div class="shell-deck-stat">' +
      '<div class="shell-deck-stat-row"><span class="shell-deck-stat-label">' + s.label + '</span>' +
      '<span class="shell-deck-stat-value">' + s.value + ' (' + pct + '%)</span></div>' +
      '<div class="shell-deck-stat-track"><div class="shell-deck-stat-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
  }).join('');

  var energiesHtml = '<div class="shell-deck-energies-label">ENERGÍAS</div>' + comp.energies.map(function (e) {
    if (!e.icon) { return ''; }
    return '<div class="shell-deck-energy-chip"><img src="Tipos/' + e.icon + '.png" alt=""><span>' + e.count + '</span></div>';
  }).join('');
  document.getElementById('deckEnergies').innerHTML = energiesHtml;

  var html = expandDecklist(DECKLISTS[deckKey]).map(function (card) {
    var img = CARD_IMAGE_BY_NAME[card.name] || '';
    return '<div class="shell-deck-slot" data-card-name="' + escapeHtml(card.name) + '">' +
      (img ? '<img src="' + img + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' : '') +
      '</div>';
  }).join('');
  var grid = document.getElementById('deckGrid');
  grid.innerHTML = html;
  grid.querySelectorAll('.shell-deck-slot').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name); }
    });
  });
}

function showDecksScreen() {
  renderDeckDetail((econState && econState.activeDeck) || 'overgrowth');
  document.getElementById('decksSaveStatus').textContent = '';
  document.getElementById('decksSaveStatus').className = 'shell-decks-save-status';
  document.getElementById('decksScreen').classList.remove('hidden');
}
function hideDecksScreen() {
  document.getElementById('decksScreen').classList.add('hidden');
}

// ── Theme ──────────────────────────────────────────────────────────
function applyTheme(dark) {
  document.body.classList.toggle('light', !dark);
  var t2 = document.getElementById('configThemeSelect');
  if (t2) { t2.value = dark ? 'dark' : 'light'; }
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

// ── Tablero de duelo ──────────────────────────────────────────────
function showBoardScreen() {
  document.getElementById('boardScreen').classList.remove('hidden');
}
function hideBoardScreen() {
  document.getElementById('boardScreen').classList.add('hidden');
  stopGameClock();
  stopDuelMusic();
  document.getElementById('matchEndMusic').pause();
}

// Restarts the chess clock after anything that covers the board (pause,
// Configuración, the surrender confirm) closes back to a live match --
// never while setup/game-over, so it can't resurrect a finished match's clock.
function resumeGameClockIfNeeded() {
  if (gameState && gameState.phase === 'playing' && !getWinner(gameState)) { startGameClock(); }
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

function applyMenuLogo() {
  var show = true;
  try { show = localStorage.getItem('tcg_menu_logo') !== 'hidden'; } catch (e) {}
  var logoWrap = document.getElementById('menuLogoWrap');
  if (logoWrap) { logoWrap.style.display = show ? '' : 'none'; }
}

// ── Configuración ──────────────────────────────────────────────────

// Real duel-music library (Songs/) -- grouped exactly as requested: YGOFBM's
// two Yu-Gi-Oh tracks, PKMNTCG's five Pokémon TCG tracks. Filenames kept
// verbatim (spaces/apostrophes and all); set as a JS property, not written
// into an HTML attribute, so no manual escaping is needed.
var DUEL_MUSIC_TRACKS = {
  ygofbm_free: { label: 'Free Duel', file: 'Songs/Yugioh_Free_Duel.mp3' },
  ygofbm_prelim: { label: 'Preliminar', file: 'Songs/Yugioh_Preliminares.mp3' },
  pkmntcg_duel: { label: 'Duel', file: 'Songs/Pokemon_TCG.mp3' },
  pkmntcg_club: { label: 'Club Master Duel', file: 'Songs/14 Club Master Duel.mp3' },
  pkmntcg_ronald: { label: 'Ronald', file: "Songs/16 Ronald's Theme.mp3" },
  pkmntcg_grand: { label: 'Gran Master Duel', file: 'Songs/20 Grand Master Duel.mp3' },
  pkmntcg_imakuni: { label: 'Imakuni', file: "Songs/17. Imakuni_'s Theme.mp3" }
};
var DUEL_MUSIC_DEFAULT = 'ygofbm_free';
var MATCH_END_MUSIC = { win: 'Songs/06 Win!.mp3', loss: 'Songs/08 Lost.mp3' };

function getMusicVolume() {
  var v = parseInt(localStorage.getItem('tcg_music_volume'), 10);
  return isNaN(v) ? 70 : Math.max(0, Math.min(100, v));
}
function setMusicVolume(pct) {
  try { localStorage.setItem('tcg_music_volume', pct); } catch (e) {}
  var vol = pct / 100;
  var bg = document.getElementById('bgMusic');
  if (bg) { bg.volume = vol; }
  var endEl = document.getElementById('matchEndMusic');
  if (endEl) { endEl.volume = vol; }
  // Also live while the 7s preview (Configuración) is playing.
  var previewEl = document.getElementById('duelMusicPreview');
  if (previewEl) { previewEl.volume = vol; }
}

function getDuelMusicKey() {
  var key = localStorage.getItem('tcg_duel_track');
  return DUEL_MUSIC_TRACKS[key] ? key : DUEL_MUSIC_DEFAULT;
}
function setDuelMusicKey(key) {
  if (!DUEL_MUSIC_TRACKS[key]) { return; }
  try { localStorage.setItem('tcg_duel_track', key); } catch (e) {}
}

// Called once the coin flip actually starts the duel (startMatchBtn) --
// loops for the whole match, real volume from the Música slider.
function startDuelMusic() {
  var bg = document.getElementById('bgMusic');
  var track = DUEL_MUSIC_TRACKS[getDuelMusicKey()];
  bg.src = track.file;
  bg.loop = true;
  bg.volume = getMusicVolume() / 100;
  bg.currentTime = 0;
  bg.play().catch(function () {});
}
function stopDuelMusic() {
  var bg = document.getElementById('bgMusic');
  bg.pause();
}
// Stops the duel music and plays the real Win!/Lost fanfare once (no loop).
function playMatchEndMusic(winner) {
  stopDuelMusic();
  var el = document.getElementById('matchEndMusic');
  el.src = winner === 'player' ? MATCH_END_MUSIC.win : MATCH_END_MUSIC.loss;
  el.loop = false;
  el.volume = getMusicVolume() / 100;
  el.currentTime = 0;
  el.play().catch(function () {});
}

// 7-second preview of whichever track is currently selected in the
// dropdown (not necessarily saved yet) -- uses its own <audio> element so
// it never interferes with an actual in-progress match's music.
var duelMusicPreviewTimeout = null;
function stopDuelMusicPreview() {
  if (!duelMusicPreviewTimeout) { return; }
  clearTimeout(duelMusicPreviewTimeout);
  duelMusicPreviewTimeout = null;
  document.getElementById('duelMusicPreview').pause();
  var btn = document.getElementById('configDuelMusicPlay');
  btn.textContent = '▶';
  btn.classList.remove('playing');
}
function toggleDuelMusicPreview() {
  if (duelMusicPreviewTimeout) { stopDuelMusicPreview(); return; }
  var track = DUEL_MUSIC_TRACKS[document.getElementById('configDuelMusicSelect').value];
  if (!track) { return; }
  var el = document.getElementById('duelMusicPreview');
  el.src = track.file;
  el.currentTime = 0;
  el.volume = getMusicVolume() / 100;
  el.play().catch(function () {});
  var btn = document.getElementById('configDuelMusicPlay');
  btn.textContent = '⏸';
  btn.classList.add('playing');
  duelMusicPreviewTimeout = setTimeout(stopDuelMusicPreview, 7000);
}

// Click-to-set AND drag-to-set: mousedown starts tracking mousemove on the
// whole document (not just the track) so dragging past its edges still
// works, standard slider UX -- the Música slider updates real playback
// volume live as it's dragged, not just once on release.
function initConfigSliders() {
  document.querySelectorAll('.shell-config-slider').forEach(function (el) {
    var track = el.querySelector('[data-slider-track]');
    var fill = el.querySelector('[data-slider-fill]');
    var thumb = el.querySelector('[data-slider-thumb]');
    var valueEl = el.querySelector('[data-slider-value]');
    var isMusic = el.id === 'configMusicSlider';

    function setFromClientX(clientX) {
      var rect = track.getBoundingClientRect();
      var pct = Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
      fill.style.width = pct + '%';
      thumb.style.left = pct + '%';
      valueEl.textContent = pct;
      if (isMusic) { setMusicVolume(pct); }
    }

    track.addEventListener('mousedown', function (e) {
      setFromClientX(e.clientX);
      function onMove(e2) { setFromClientX(e2.clientX); }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    track.addEventListener('touchstart', function (e) {
      if (e.touches[0]) { setFromClientX(e.touches[0].clientX); }
    });
    track.addEventListener('touchmove', function (e) {
      if (e.touches[0]) { setFromClientX(e.touches[0].clientX); }
      e.preventDefault();
    }, { passive: false });
  });
}

// Tracks where the config screen was opened from, mirroring shopReturnTo:
// 'menu' from the main menu's CONFIGURACIÓN item, 'game' from the in-game
// pause menu's ⚙️ button (both reachable today).
var configReturnTo = 'menu';

function showConfigScreen(returnTo) {
  configReturnTo = returnTo;
  document.getElementById('configAccountPhoto').src = playerPhotoUrl();
  document.getElementById('configAccountName').textContent = playerDisplayName();
  document.getElementById('configThemeSelect').value = document.body.classList.contains('light') ? 'light' : 'dark';
  document.getElementById('configLogoSelect').value = localStorage.getItem('tcg_menu_logo') === 'hidden' ? 'hide' : 'show';
  document.getElementById('configModeSelect').value = document.fullscreenElement ? 'fullscreen' : 'window';
  document.getElementById('configDuelMusicSelect').value = getDuelMusicKey();
  var musicPct = getMusicVolume();
  var musicSlider = document.getElementById('configMusicSlider');
  musicSlider.querySelector('[data-slider-fill]').style.width = musicPct + '%';
  musicSlider.querySelector('[data-slider-thumb]').style.left = musicPct + '%';
  musicSlider.querySelector('[data-slider-value]').textContent = musicPct;
  document.getElementById('configScreen').classList.remove('hidden');
}
function hideConfigScreen() {
  stopDuelMusicPreview();
  document.getElementById('configScreen').classList.add('hidden');
}

function openPauseMenu() {
  stopGameClock();
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

  applyMenuLogo();
  layoutShellStages();
  window.addEventListener('resize', layoutShellStages);

  // News panel dates -- static placeholder content (no real feed exists
  // yet), so a one-time pass at load is enough; a live feed would call this
  // again after replacing the list's HTML.
  document.querySelectorAll('.shell-news-item-day').forEach(function (el) {
    el.innerHTML = pixelDigitsHtml(el.textContent.trim(), 'plata', 2);
  });

  // Static coin-icon spots (menu balance, shop header, booster modal price) --
  // replaced once here with the pixel-glyph coin; the shop-card and board-
  // footer coins are rendered per-instance in their own template strings
  // since those elements get rebuilt on every render.
  document.querySelectorAll('.shell-player-coin, .shell-page-coin-dot, .shell-shop-coin').forEach(function (el) {
    el.innerHTML = pixelCoinHtml('oro', 2);
  });

  // Menu buttons
  document.getElementById('menuPlay').addEventListener('click', function () {
    hideMenu();
    showBoardScreen();
    startNewMatch();
  });
  document.getElementById('menuDeck').addEventListener('click', function () {
    hideMenu();
    showDecksScreen();
  });
  document.getElementById('decksBackBtn').addEventListener('click', function () {
    hideDecksScreen();
    showMenu();
  });
  document.querySelectorAll('.shell-deck-card[data-card-img]').forEach(function (el) {
    el.addEventListener('click', function () {
      openCardModal(el.getAttribute('data-card-name'), el.getAttribute('data-card-img'));
    });
  });
  document.getElementById('decksSaveBtn').addEventListener('click', function () {
    var btn = document.getElementById('decksSaveBtn');
    var status = document.getElementById('decksSaveStatus');
    btn.disabled = true;
    status.className = 'shell-decks-save-status';
    status.textContent = 'GUARDANDO...';
    updateActiveDeckCloud('overgrowth')
      .then(function () {
        btn.disabled = false;
        status.className = 'shell-decks-save-status ok';
        status.textContent = 'GUARDADO ✓';
      })
      .catch(function () {
        btn.disabled = false;
        status.className = 'shell-decks-save-status error';
        status.textContent = 'NO SE PUDO GUARDAR. INTENTA DE NUEVO.';
      });
  });
  document.getElementById('menuShop').addEventListener('click', function () {
    hideMenu();
    showShopScreen('menu');
  });
  document.getElementById('menuCollection').addEventListener('click', function () {
    hideMenu();
    showCollectionScreen('menu');
  });
  document.getElementById('menuConfig').addEventListener('click', function () {
    hideMenu();
    showConfigScreen('menu');
  });
  document.getElementById('configBackBtn').addEventListener('click', function () {
    hideConfigScreen();
    if (configReturnTo === 'menu') { showMenu(); } else { resumeGameClockIfNeeded(); }
  });

  initConfigSliders();
  renderCardBackPicker();

  document.getElementById('configModeSelect').addEventListener('change', function () {
    if (this.value === 'fullscreen') {
      if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen().catch(function () {}); }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  });
  document.addEventListener('fullscreenchange', function () {
    var modeSelect = document.getElementById('configModeSelect');
    if (modeSelect) { modeSelect.value = document.fullscreenElement ? 'fullscreen' : 'window'; }
  });
  document.getElementById('configThemeSelect').addEventListener('change', function () {
    applyTheme(this.value === 'dark');
  });
  document.getElementById('configLogoSelect').addEventListener('change', function () {
    localStorage.setItem('tcg_menu_logo', this.value === 'hide' ? 'hidden' : 'visible');
    applyMenuLogo();
  });
  document.getElementById('configDuelMusicSelect').addEventListener('change', function () {
    setDuelMusicKey(this.value);
    stopDuelMusicPreview();
  });
  document.getElementById('configDuelMusicPlay').addEventListener('click', toggleDuelMusicPreview);
  document.getElementById('configChangeNameBtn').addEventListener('click', function () {
    document.getElementById('menuProfileBtn').click();
  });
  document.getElementById('configLogoutBtn').addEventListener('click', function () {
    document.getElementById('menuLogoutBtn').click();
  });

  document.getElementById('boardBackBtn').addEventListener('click', openPauseMenu);
  document.getElementById('boardCloseBtn').addEventListener('click', function () {
    stopGameClock();
    showConfigScreen('game');
  });

  document.getElementById('shopBackBtn').addEventListener('click', function () {
    hideShopScreen();
    if (shopReturnTo === 'menu') { showMenu(); }
  });
  document.querySelectorAll('.shell-shop-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { showShopTab(btn.getAttribute('data-shop-tab')); });
  });

  document.getElementById('collectionBackBtn').addEventListener('click', function () {
    hideCollectionScreen();
    if (collectionReturnTo === 'menu') { showMenu(); }
  });
  document.getElementById('collectionSearch').addEventListener('input', function () {
    collectionFilters.search = this.value.trim().toLowerCase();
    renderCollectionGrid();
  });

  // ── Modals ───────────────────────────────────────────────────────
  document.getElementById('cardModalClose').addEventListener('click', closeCardModal);
  document.querySelector('#cardModal .card-modal-backdrop').addEventListener('click', closeCardModal);

  document.getElementById('discardPileClose').addEventListener('click', closeDiscardPileModal);
  document.querySelector('#discardPileModal .card-modal-backdrop').addEventListener('click', closeDiscardPileModal);

  document.getElementById('surrenderCancelBtn').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
    resumeGameClockIfNeeded();
  });
  document.querySelector('#surrenderModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
    resumeGameClockIfNeeded();
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
    hideBoardScreen();
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
  });
  document.querySelector('#boosterResultModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('boosterResultModal').classList.add('hidden');
  });
  document.getElementById('boosterResultAgain').addEventListener('click', function () {
    document.getElementById('boosterResultModal').classList.add('hidden');
    if (boosterResultSetKey) { openBoosterSelectModal(boosterResultSetKey); }
  });

  // Pause menu (ESC) -- only while the board screen is actually visible.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (document.getElementById('boardScreen').classList.contains('hidden')) { return; }
      if (!document.getElementById('pauseModal').classList.contains('hidden')) {
        closePauseMenu();
        resumeGameClockIfNeeded();
      } else {
        openPauseMenu();
      }
    }
  });
  document.getElementById('pauseResume').addEventListener('click', function () {
    closePauseMenu();
    resumeGameClockIfNeeded();
  });
  document.getElementById('pauseConfig').addEventListener('click', function () {
    closePauseMenu();
    showConfigScreen('game');
  });
  document.getElementById('pauseSurrender').addEventListener('click', function () {
    closePauseMenu();
    document.getElementById('surrenderModal').classList.remove('hidden');
  });
  document.getElementById('pauseMusic').addEventListener('click', function () {
    var audio = document.getElementById('bgMusic');
    if (audio.paused) {
      audio.play();
      this.textContent = '🔊 MÚSICA';
    } else {
      audio.pause();
      this.textContent = '🔈 MÚSICA';
    }
  });
  document.getElementById('pauseExit').addEventListener('click', function () {
    closePauseMenu();
    hideBoardScreen();
    showMenu();
  });
});
