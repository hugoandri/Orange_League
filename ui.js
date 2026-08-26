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
var CARD_BACK_URL = 'Cartas/Cardback.jpg?v=2';

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
  // Ordered by theme -- Pokémon first, then One Piece, then memes/pop
  // culture (Sasuke's Naruto art has no clean bucket of its own, grouped
  // with the memes per user's call).
  { id: 'protector_koffing', name: 'Koffing', img: 'Cartas/Protector_Koffing.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_pikachu', name: 'Pikachu', img: 'Cartas/Protector_Pikachu.png?v=2', cost: PROTECTOR_COST },
  // Edge-to-edge black art with no border of its own -- outline:true adds a
  // white frame so it doesn't blend into the shop card's dark background.
  { id: 'protector_team_rocket', name: 'Team Rocket', img: 'Cartas/Protector_TeamRocket.png?v=2', cost: PROTECTOR_COST, outline: true },
  { id: 'protector_pokebola_morada', name: 'Poké Ball Morada', img: 'Cartas/Protector_PokebolaMorada.png?v=4', cost: PROTECTOR_COST },
  { id: 'protector_squirtle', name: 'Squirtle', img: 'Cartas/Protector_Squirtle.png?v=3', cost: PROTECTOR_COST },
  { id: 'protector_charmander', name: 'Charmander', img: 'Cartas/Protector_Charmander.png?v=3', cost: PROTECTOR_COST },
  { id: 'protector_bulbasaur', name: 'Bulbasaur', img: 'Cartas/Protector_Bulbasaur.png?v=3', cost: PROTECTOR_COST },
  { id: 'protector_pikachu_sorprendido', name: 'Pikachu Sorprendido', img: 'Cartas/Protector_PikachuSorprendido.png?v=3', cost: PROTECTOR_COST },
  { id: 'protector_fantasma', name: 'Fantasma', img: 'Cartas/Protector_Fantasma.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_perona', name: 'Perona', img: 'Cartas/Protector_Perona.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_messi', name: 'Messi', img: 'Cartas/Protector_Messi.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_ronaldo', name: 'Ronaldo', img: 'Cartas/Protector_Ronaldo.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_sasuke', name: 'Sasuke', img: 'Cartas/Protector_Sasuke.png?v=4', cost: PROTECTOR_COST },
  { id: 'protector_six_seven', name: 'Six Seven', img: 'Cartas/Protector_SixSeven.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_trollface', name: 'Trollface', img: 'Cartas/Protector_TrollFace.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_fuuuu', name: 'Fuuuu', img: 'Cartas/Protector_Fuuuu.png?v=2', cost: PROTECTOR_COST },
  { id: 'protector_remielle', name: 'Remielle', img: 'Cartas/Protector_Remielle.png', cost: PROTECTOR_COST }
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
// booster/collection feature (data-sets.js) -- every real deck (Overgrowth/
// Blackout/Zap!, and Brushfire to come) is built entirely from Base Set
// cards, so Base Set's own print must always win here. ~34 names are
// reprinted with different art in Jungle/Fossil (e.g. Pikachu, Haunter,
// Gastly) -- first-wins (not overwriting an already-set name) combined
// with 'base' being first in this list is what makes that guarantee hold;
// a plain overwrite loop let whichever set was iterated LAST win instead,
// which is exactly what silently swapped Zap!'s Haunter/Gastly/Pikachu to
// their Fossil/Jungle art (this lookup has no set/num to disambiguate by,
// unlike the Collection grid, which reads each pulled card's own img
// directly instead of going through this by-name lookup at all).
var CARD_IMAGE_BY_NAME = {};
var CARD_SUPERTYPE_BY_NAME = {};
['base', 'jungle', 'fossil'].forEach(function (setKey) {
  (CARD_CATALOG[setKey] || []).forEach(function (c) {
    if (CARD_IMAGE_BY_NAME.hasOwnProperty(c.n)) { return; }
    CARD_IMAGE_BY_NAME[c.n] = c.img;
    CARD_SUPERTYPE_BY_NAME[c.n] = c.st;
  });
});

// Every card image the app could ever need to show -- the full base/
// jungle/fossil catalog (~228 real prints, walked per set+num rather than
// through the by-name CARD_IMAGE_BY_NAME lookup so the ~34 reprints that
// share a name with a different set's art still each get their own image
// preloaded, not just whichever one that lookup happened to keep last),
// plus every card back (the default plus every Protector, since the
// player could have any one of them picked), plus every booster-pack box
// art variant (BOOSTER_PACKS, read lazily below since it's declared later
// in this file -- only ever inserted into the DOM dynamically via
// innerHTML in the Tienda tab / booster-select modal, so without this it
// showed the exact same pop-in the cards used to) and the two match-deck
// box arts (Mazos/*.png -- already static <img> tags in index.html so the
// browser fetches them on page load regardless, but listed here too for
// consistency and in case that markup ever becomes dynamic). Both a
// match's two fixed preset decks (Base Set only) and the Collection grid
// (which can show any real print from any of the three sets) draw
// straight from this same set. Warms the browser's own HTTP cache well
// before any of these screens are actually opened, so a card's <img> only
// ever needs to paint an already-downloaded image instead of starting a
// fresh fetch the first time it's inserted -- that fetch is what showed
// up as a ~1s pop-in the user noticed both mid-duel and in their
// Collection.
var cardImagePreloadDone = false;
function preloadCardImages() {
  if (cardImagePreloadDone) { return; }
  cardImagePreloadDone = true;
  var urls = {};
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    (CARD_CATALOG[setKey] || []).forEach(function (c) { if (c.img) { urls[c.img] = true; } });
  });
  urls[CARD_BACK_URL] = true;
  CARD_BACK_OPTIONS.forEach(function (o) { if (o.img) { urls[o.img] = true; } });
  Object.keys(BOOSTER_PACKS).forEach(function (setKey) {
    BOOSTER_PACKS[setKey].forEach(function (src) { urls[src] = true; });
  });
  urls['Mazos/overgrowth.png'] = true;
  urls['Mazos/blackout.png'] = true;
  urls['Mazos/zap.jpg'] = true;
  urls['Mazos/brushfire.jpg'] = true;
  Object.keys(urls).forEach(function (url) { var img = new Image(); img.src = url; });
}

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

// Twinkling four-pointed star field for holo cards, matching the "Holos.html"
// design reference's campoEstrellas/chispa technique. Deterministic (sine-based
// instead of Math.random) so the same card always draws the same field instead
// of reshuffling on every re-render. Capped at 20 stars/card (the reference
// used 26) since holo cards can appear by the dozen at once in the Collection
// grid -- 20 already reads as "sparkling" without animating hundreds of nodes.
//
// Real Base/Jungle/Fossil Rare Holo art already has small pale star sparkles
// painted into the illustration itself (see e.g. Gyarados) -- the first pass
// at this used the same soft white/pastel tones at 4-9px, which camouflaged
// completely against that existing print pattern and looked like nothing had
// changed. Sizes and colors below are deliberately bigger and more saturated
// than the card's own baked-in stars so the overlay reads as a distinct
// effect, and the opacity floor is raised so they never fully fade out.
function holoStarsHtml(n) {
  n = n || 20;
  var stars = '';
  for (var i = 0; i < n; i++) {
    var a = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1;
    var b = Math.abs(Math.sin((i + 1) * 78.233) * 12345.6789) % 1;
    var c = Math.abs(Math.sin((i + 1) * 39.425) * 9876.5432) % 1;
    var w = c < 0.12 ? 34 : c < 0.38 ? 24 : 16;
    var x = (6 + a * 88).toFixed(2) + '%';
    var y = (5 + b * 90).toFixed(2) + '%';
    var off = (-w / 2) + 'px';
    var dur = (2.2 + c * 3.4).toFixed(2) + 's';
    var delay = (-c * 5.5).toFixed(2) + 's';
    var tone = a < 0.34 ? '#ffffff' : a < 0.58 ? '#4fd6ff' : a < 0.8 ? '#ff5fd6' : '#ffe14f';
    stars += '<div class="shell-holo-star" style="left:' + x + ';top:' + y + ';width:' + w + 'px;height:' + w + 'px;margin-left:' + off + ';margin-top:' + off + ';background:' + tone + ';color:' + tone + ';animation-duration:' + dur + ';animation-delay:' + delay + ';"></div>';
  }
  return '<div class="shell-holo-stars">' + stars + '</div>';
}

// isHolo is real, not decorative: the historical Overgrowth/Blackout theme
// decks each ship exactly one guaranteed Rare Holo (Gyarados / Hitmonchan --
// see isHoloInMatch), so this reuses the same shimmering foil overlay the
// Collection screen uses for those, front face only -- the card back never
// changes regardless of holo.
function cardImageTag(name, cls, isHolo) {
  var url = CARD_IMAGE_BY_NAME[name];
  if (!url) { return ''; }
  var img = '<img class="' + cls + '" src="' + url + '" alt="' + escapeHtml(name) + '" loading="lazy">';
  if (isHolo === 'secret') {
    return '<span class="shell-card-holo-wrap">' + img + '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' + holoStarsHtml() + '</span>';
  }
  return isHolo ? '<span class="shell-card-holo-wrap">' + img + '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() + '</span>' : img;
}

// Returns the highest foil tier the player actually owns of a given card
// name across all sets, or null if only plain copies are owned. Used by
// the board renderer so holo/secret rare cards show their real foil during
// a match instead of only the deck's one guaranteed holo.
function getPlayerCardFoilTier(name) {
  if (!econState) { return null; }
  var hasSecret = false;
  var hasHolo = false;
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    CARD_CATALOG[setKey].forEach(function (c) {
      if (c.n !== name) { return; }
      var key = setKey + '-' + c.num;
      if ((econState.collectionSecret[key] || 0) > 0) { hasSecret = true; }
      if ((econState.collectionHolo[key] || 0) > 0) { hasHolo = true; }
    });
  });
  if (hasSecret) { return 'secret'; }
  if (hasHolo) { return 'holo'; }
  return null;
}

// Whether ownerId's copy of this exact card name is the deck's one
// guaranteed Rare Holo -- Gyarados for Overgrowth, Hitmonchan for Blackout
// (both real, single-copy Rare Holos in the actual 1999 preconstructed
// decks, not an arbitrary pick). Keyed by deckKey (createGame,
// rules-engine.js), not by 'player'/'cpu' directly -- the player can now
// choose either deck (see the Decks screen), and the CPU always plays
// whichever one they didn't pick, so either side can end up with either
// card.
var DECK_HOLO_CARD = { overgrowth: 'Gyarados', blackout: 'Hitmonchan', zap: 'Mewtwo', brushfire: 'Ninetales' };
function isHoloInMatch(ownerId, cardName) {
  var p = gameState && gameState.players[ownerId];
  return !!(p && DECK_HOLO_CARD[p.deckKey] === cardName);
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
      '<div class="shell-board-viewer-attack-damage">' + pixelDigitsHtml(atk.damage || '0', 'fosforo', 2) + '</div>';
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

  // A hand-card view has no instanceId and is always the player's own hand
  // (the CPU's hand only ever shows as face-down backs); a board-card view
  // carries a real instanceId that belongs to one side or the other.
  var viewerOwnerId = !instanceId ? 'player'
    : findInstance(gameState.players.player, instanceId) ? 'player'
    : findInstance(gameState.players.cpu, instanceId) ? 'cpu' : null;
  var viewerFoilTier = viewerOwnerId === 'player' ? (getPlayerCardFoilTier(name) || (isHoloInMatch('player', name) ? 'holo' : null))
    : (viewerOwnerId === 'cpu' && isHoloInMatch('cpu', name) ? 'holo' : null);
  var viewerIsHolo = !!viewerFoilTier;

  var frameHtml = '<div class="shell-board-viewer-frame">' +
    '<div class="shell-board-viewer-frame-inner"><img src="' + url + '" alt="' + escapeHtml(name) + '">' +
    (viewerFoilTier === 'secret' ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' + holoStarsHtml()
      : viewerIsHolo ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '') + '</div>' +
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
      '<div class="shell-board-viewer-identity-hp">' + pixelDigitsHtml(hp, 'fosforo', 2) +
        '<span>/' + stats.hp + '</span></div>' +
      '</div>';
    var statusHtml = (instance && instance.statusConditions.length)
      ? '<div class="shell-board-viewer-note">' + escapeHtml(instance.statusConditions.map(function (s) {
          return translateStatus(s) + (s === 'Poisoned' && instance.severePoison ? ' Severo' : '');
        }).join(', ')) + '</div>'
      : '';
    // Clefairy Doll: "at any time during your turn before your attack, you
    // may discard it" -- unlike the attack buttons above, this applies
    // whether it's the Active or on the Bench, so it's gated separately
    // rather than reusing actionableState (which is Active-only).
    var canVoluntaryDiscard = !!(instance && stats.voluntaryDiscard && viewerOwnerId === 'player' &&
      gameState.phase === 'playing' && gameState.activePlayerId === 'player' && !pendingPlayerPrize);
    var discardBtnHtml = canVoluntaryDiscard
      ? '<div class="shell-board-viewer-attacks"><button type="button" class="shell-board-viewer-attack actionable" id="voluntaryDiscardBtn">DESCARTAR</button></div>'
      : '';
    bodyHtml = identityHtml + viewerAttacksHtml(name, actionableState) + discardBtnHtml + statusHtml + viewerTrioHtml(stats);
  } else {
    // Trainer/Energy cards: the title stays in its real printed (English)
    // name here -- unlike the deck list/hand label, which do translate it
    // -- per explicit user request, since the card art right above it is
    // also printed in English and a translated title next to it read as
    // inconsistent. The effect text itself (translateTrainerText) was
    // simply missing before -- this view showed the name and nothing else.
    var trainerText = translateTrainerText(name);
    bodyHtml = '<div class="shell-board-viewer-identity"><div class="shell-board-viewer-identity-name">' + escapeHtml(name) + '</div></div>' +
      (trainerText ? '<div class="shell-board-viewer-note">' + escapeHtml(trainerText) + '</div>' : '');
  }

  document.getElementById('cardViewer').innerHTML = frameHtml + bodyHtml;

  if (actionableState) {
    document.querySelectorAll('#cardViewer .shell-board-viewer-attack.actionable').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var atkName = btn.getAttribute('data-attack-name');
        if (!canAttack(gameState, 'player', atkName)) { return; }
        if (atkName === 'Lure') {
          // Needs a chosen rival Bench Pokémon -- arm target-selection
          // mode instead of firing immediately (see the Bench/Active
          // click handler in wireBoardButtons for the other half of this).
          pendingAttackNeedingTarget = atkName;
          showTargetHintModal('Elige un Pokémon de la Banca del Rival');
          return;
        }
        attack(gameState, 'player', atkName);
        afterPlayerAction();
      });
    });
  }

  var voluntaryDiscardBtn = document.getElementById('voluntaryDiscardBtn');
  if (voluntaryDiscardBtn) {
    voluntaryDiscardBtn.addEventListener('click', function () {
      var result = discardOwnPokemonInPlay(gameState, 'player', instanceId);
      if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
      afterPlayerAction();
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
// Reads which foil tier a rendered card element ended up with (see
// renderCollectionGrid/showBoosterResult/renderDeckDetail, which all apply
// .secret/.holo the same way) so the zoom modal it opens into matches.
function cellFoilTier(el) {
  if (el.classList.contains('secret')) { return 'secret'; }
  if (el.classList.contains('holo')) { return 'holo'; }
  return null;
}

// foilTier: 'holo', 'secret', or falsy for a plain card.
function openCardModal(name, imgUrl, foilTier) {
  var url = imgUrl || CARD_IMAGE_BY_NAME[name];
  if (!url) { return; }
  var img = document.getElementById('cardModalImg');
  img.src = url;
  img.alt = name;
  var modal = document.getElementById('cardModal');
  modal.classList.toggle('holo', foilTier === 'holo');
  modal.classList.toggle('secret', foilTier === 'secret');
  document.getElementById('cardModalStars').innerHTML = foilTier === 'holo' ? holoStarsHtml() : '';
  // A real Trainer card's printed rules text is too small to read even
  // zoomed in (unlike a Pokémon's attack name/damage, which prints large
  // enough on the card itself) -- show the Spanish translation
  // (translateTrainerText, rules-engine.js) as real text underneath.
  // CARD_STATS[name] is undefined for anything that isn't a real card by
  // that exact name (e.g. a face-down prize's generic label), so this is
  // naturally a no-op for those.
  var stats = CARD_STATS[name];
  var textEl = document.getElementById('cardModalText');
  var trainerText = (stats && stats.supertype === 'Trainer') ? translateTrainerText(name) : '';
  textEl.textContent = trainerText;
  textEl.classList.toggle('hidden', !trainerText);
  modal.classList.remove('hidden');
}

// Fires once, the next time #cardModal closes -- used by the prize-choice
// flow to hold the CPU's turn until the player has actually looked at (and
// dismissed) the zoom of the card they just won, not the instant they pick
// the prize slot (see renderPrizeChoiceModal). null the rest of the time.
var onCardModalClose = null;
function closeCardModal() {
  document.getElementById('cardModal').classList.add('hidden');
  if (onCardModalClose) {
    var cb = onCardModalClose;
    onCardModalClose = null;
    cb();
  }
}

// Flashes a just-played Trainer card big in the middle of the screen for
// about a second, then calls onDone -- added because Trainer plays (both
// the player's own and the CPU's) were easy to miss entirely, buried in the
// text log. Non-blocking (pointer-events:none) since it's a notice, not a
// modal the player has to dismiss.
var trainerPlayedHoldTimeout = null;
var trainerPlayedFadeTimeout = null;
function showTrainerPlayedOverlay(play, onDone) {
  var el = document.getElementById('trainerPlayedOverlay');
  var img = document.getElementById('trainerPlayedImg');
  var label = document.getElementById('trainerPlayedLabel');
  var url = CARD_IMAGE_BY_NAME[play.name];
  if (!el || !img || !label || !url) { if (onDone) { onDone(); } return; }
  clearTimeout(trainerPlayedHoldTimeout);
  clearTimeout(trainerPlayedFadeTimeout);
  img.src = url;
  img.alt = play.name;
  label.textContent = (play.playerId === 'player' ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name);
  el.classList.remove('hidden', 'fading');
  trainerPlayedHoldTimeout = setTimeout(function () {
    el.classList.add('fading');
    trainerPlayedFadeTimeout = setTimeout(function () {
      el.classList.add('hidden');
      el.classList.remove('fading');
      if (onDone) { onDone(); }
    }, 220);
  }, 1280); // 1280ms hold + 220ms fade-out = ~1.5s total on screen
}

// Drains gameState.trainerPlaysQueue (see card-effects.js's TRAINER_EFFECTS
// wrapper), showing each queued play in sequence rather than all at once --
// a single CPU turn can play more than one Trainer before this ever gets a
// chance to run.
// onAllDone (optional): called once every queued play has finished
// showing (immediately, synchronously, if the queue was already empty) --
// runCpuTurn uses this to hold "TU TURNO" until any Trainer(s) the CPU just
// played are done flashing, instead of both appearing over each other in
// the same spot.
function showTrainerPlaysSequence(queue, onAllDone) {
  if (!queue.length) { if (onAllDone) { onAllDone(); } return; }
  var play = queue.shift();
  showTrainerPlayedOverlay(play, function () { showTrainerPlaysSequence(queue, onAllDone); });
}
function drainTrainerPlaysQueue(onAllDone) {
  if (!gameState || !gameState.trainerPlaysQueue || !gameState.trainerPlaysQueue.length) {
    if (onAllDone) { onAllDone(); }
    return;
  }
  var queue = gameState.trainerPlaysQueue;
  gameState.trainerPlaysQueue = [];
  showTrainerPlaysSequence(queue, onAllDone);
}

// Big centered "TURNO DEL RIVAL" (red) / "TU TURNO" (green) flash for about
// a second whenever control actually changes hands -- see runCpuTurn's two
// call sites. colorClass is 'rival' or 'mine' (see the matching CSS).
var turnFlashHoldTimeout = null;
var turnFlashFadeTimeout = null;
// Holds "TU TURNO" back when a KO leaves the player forced to pick a new
// Active (gameState.pendingActiveChoice) -- shown right after that choice
// resolves instead (see renderActiveChoiceModal's click handler) so it
// doesn't flash while they're mid-decision. { text, colorClass } or null.
var pendingTurnFlash = null;
// True while runCpuTurn is holding off starting the CPU's turn because the
// checkup it just ran left a prize or new-Active choice open for the
// player -- see hasPendingPlayerChoice/maybeResumeCpuTurn.
var cpuTurnAwaitingPlayerChoice = false;
// Set to an attack name while the player has clicked an attack that needs
// a chosen target (Ninetales' Lure is the only real one) and is waiting
// for a rival Bench click -- module-level (not scoped inside a single
// function, unlike selectedHandId/retreatMode in wireBoardButtons) since
// the attack button lives in showCardInViewer, a different function
// entirely, and this needs to survive whatever renders happen in between.
var pendingAttackNeedingTarget = null;
// #turnFlashOverlay is position:fixed at the page level (so it renders
// above any modal, e.g. #activeChoiceModal after a KO -- see the CSS
// comment), so it needs its own top/left/width/height set here to still
// land centered on the board specifically, not the whole viewport.
function positionTurnFlash(el) {
  var boardEl = document.querySelector('.shell-board-table-wrap');
  if (!boardEl) { return; }
  var rect = boardEl.getBoundingClientRect();
  el.style.top = rect.top + 'px';
  el.style.left = rect.left + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
}

function showTurnFlash(text, colorClass) {
  var el = document.getElementById('turnFlashOverlay');
  if (!el) { return; }
  clearTimeout(turnFlashHoldTimeout);
  clearTimeout(turnFlashFadeTimeout);
  el.textContent = text;
  el.className = 'shell-turn-flash ' + colorClass; // resets any stale fading/hidden from a previous flash
  positionTurnFlash(el);
  turnFlashHoldTimeout = setTimeout(function () {
    el.classList.add('fading');
    turnFlashFadeTimeout = setTimeout(function () {
      el.classList.add('hidden');
      el.classList.remove('fading');
    }, 250);
  }, 1000);
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

// Computer Search: shows the player's live deck in order (not deduplicated
// by name -- if a card is duplicated in the deck it appears again, each
// with its own image, per user request) as a scrollable clickable grid,
// same layout as the discard pile modal above. onPick(deckCardId) fires
// once, then the modal closes itself.
var deckSearchOnPick = null;
function openDeckSearchModal(deckCards, onPick) {
  deckSearchOnPick = onPick;
  var grid = document.getElementById('deckSearchGrid');
  grid.innerHTML = deckCards.map(function (card) {
    var url = CARD_IMAGE_BY_NAME[card.name];
    if (!url) { return ''; }
    return '<button type="button" class="shell-discard-pile-card-item" data-deck-card-id="' + card.id + '">' +
      '<img src="' + url + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' +
      '<span>' + escapeHtml(translateCardName(card.name)) + '</span></button>';
  }).join('');
  grid.querySelectorAll('[data-deck-card-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-deck-card-id');
      // Capture onPick BEFORE closing -- closeDeckSearchModal() nulls
      // deckSearchOnPick, so reading it afterward (as this used to) always
      // saw null and silently did nothing, no matter which card was
      // clicked. Same fix shape as energyDiscardConfirm's onConfirm.
      var onPick = deckSearchOnPick;
      closeDeckSearchModal();
      if (onPick) { onPick(id); }
    });
  });
  document.getElementById('deckSearchModal').classList.remove('hidden');
}
function closeDeckSearchModal() {
  document.getElementById('deckSearchModal').classList.add('hidden');
  deckSearchOnPick = null;
}

// Generic "pick one option, resolves on click" modal (see index.html's own
// comment) -- options: [{id, label, imgUrl}]. Reused by the Pokémon Powers
// flow below for both picking WHICH eligible Pokémon's Power to activate
// (2+ candidates) and Buzzap's energy-type choice.
var choicePickerOnPick = null;
function openChoicePickerModal(promptText, options, onPick) {
  choicePickerOnPick = onPick;
  document.getElementById('choicePickerPrompt').textContent = promptText;
  var grid = document.getElementById('choicePickerGrid');
  grid.innerHTML = options.map(function (opt) {
    return '<button type="button" class="shell-discard-pile-card-item" data-choice-id="' + escapeHtml(opt.id) + '">' +
      (opt.imgUrl ? '<img src="' + opt.imgUrl + '" alt="" loading="lazy">' : '') +
      '<span>' + escapeHtml(opt.label) + '</span></button>';
  }).join('');
  grid.querySelectorAll('[data-choice-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-choice-id');
      var onPickNow = choicePickerOnPick;
      closeChoicePickerModal();
      if (onPickNow) { onPickNow(id); }
    });
  });
  document.getElementById('choicePickerModal').classList.remove('hidden');
}
function closeChoicePickerModal() {
  document.getElementById('choicePickerModal').classList.add('hidden');
  choicePickerOnPick = null;
}

// Pokédex: reveal the top N deck cards, let the player click them in the
// order they want (stamping a position number on each, not a checkmark) --
// onConfirm(orderedIds) fires once every card has a position and OK is
// pressed.
var pokedexState = null;
function openPokedexModal(cards, onConfirm) {
  pokedexState = { cards: cards, order: [], onConfirm: onConfirm };
  renderPokedexModal();
  document.getElementById('pokedexModal').classList.remove('hidden');
}
function closePokedexModal() {
  document.getElementById('pokedexModal').classList.add('hidden');
  pokedexState = null;
}
function renderPokedexModal() {
  var s = pokedexState;
  document.getElementById('pokedexPrompt').textContent =
    'Toca las cartas en el orden en que quieres dejarlas (' + s.order.length + '/' + s.cards.length + ')';
  var grid = document.getElementById('pokedexGrid');
  grid.innerHTML = s.cards.map(function (card) {
    var pos = s.order.indexOf(card.id);
    return '<div class="shell-energy-discard-option' + (pos !== -1 ? ' selected' : '') + '" data-pokedex-card-id="' + card.id + '">' +
      cardImageTag(card.name, '') + '<span>' + (pos !== -1 ? (pos + 1) + '. ' : '') + escapeHtml(translateCardName(card.name)) + '</span></div>';
  }).join('');
  grid.querySelectorAll('[data-pokedex-card-id]').forEach(function (el) {
    el.addEventListener('click', function () {
      var id = el.getAttribute('data-pokedex-card-id');
      var pos = s.order.indexOf(id);
      if (pos !== -1) {
        s.order.splice(pos, 1);
      } else if (s.order.length < s.cards.length) {
        s.order.push(id);
      }
      renderPokedexModal();
    });
  });
  document.getElementById('pokedexConfirm').disabled = s.order.length !== s.cards.length;
}

// Computer Search's discard-2-as-cost step: pick exactly `count` real hand
// cards (by id, not index -- unlike energyDiscardState below, hand cards
// each have their own real id already). onConfirm(ids) fires once that
// many are selected and OK is pressed.
var handDiscardState = null;
function openHandDiscardModal(cards, count, onConfirm) {
  handDiscardState = { cards: cards, count: count, selected: [], onConfirm: onConfirm };
  renderHandDiscardModal();
  document.getElementById('handDiscardModal').classList.remove('hidden');
}
function closeHandDiscardModal() {
  document.getElementById('handDiscardModal').classList.add('hidden');
  handDiscardState = null;
}
function renderHandDiscardModal() {
  var s = handDiscardState;
  document.getElementById('handDiscardPrompt').textContent =
    'Elige ' + s.count + ' cartas de tu mano para descartar (' + s.selected.length + '/' + s.count + ')';
  var grid = document.getElementById('handDiscardGrid');
  grid.innerHTML = s.cards.map(function (card) {
    var selected = s.selected.indexOf(card.id) !== -1;
    return '<div class="shell-energy-discard-option' + (selected ? ' selected' : '') + '" data-hand-card-id="' + card.id + '">' +
      cardImageTag(card.name, '') + '<span>' + escapeHtml(translateCardName(card.name)) + '</span></div>';
  }).join('');
  grid.querySelectorAll('[data-hand-card-id]').forEach(function (el) {
    el.addEventListener('click', function () {
      var id = el.getAttribute('data-hand-card-id');
      var pos = s.selected.indexOf(id);
      if (pos !== -1) {
        s.selected.splice(pos, 1);
      } else if (s.selected.length < s.count) {
        s.selected.push(id);
      }
      renderHandDiscardModal();
    });
  });
  document.getElementById('handDiscardConfirm').disabled = s.selected.length !== s.count;
}

// Energy Retrieval: choose UP TO 2 (0, 1, or 2 -- unlike every other
// discard/search picker here, this is a real "as many as you want, capped
// at 2" choice, not a fixed count) basic Energy cards from the player's
// own discard pile. Confirm is always enabled, even at 0 selected.
var energyRetrievalState = null;
function openEnergyRetrievalModal(cards, onConfirm) {
  energyRetrievalState = { cards: cards, selected: [], onConfirm: onConfirm };
  renderEnergyRetrievalModal();
  document.getElementById('energyRetrievalModal').classList.remove('hidden');
}
function closeEnergyRetrievalModal() {
  document.getElementById('energyRetrievalModal').classList.add('hidden');
  energyRetrievalState = null;
}
function renderEnergyRetrievalModal() {
  var s = energyRetrievalState;
  document.getElementById('energyRetrievalPrompt').textContent =
    'Elige hasta 2 cartas de Energía para recuperar (' + s.selected.length + '/2)';
  var grid = document.getElementById('energyRetrievalGrid');
  grid.innerHTML = s.cards.map(function (card) {
    var selected = s.selected.indexOf(card.id) !== -1;
    return '<div class="shell-energy-discard-option' + (selected ? ' selected' : '') + '" data-discard-card-id="' + card.id + '">' +
      cardImageTag(card.name, '') + '<span>' + escapeHtml(translateCardName(card.name)) + '</span></div>';
  }).join('');
  grid.querySelectorAll('[data-discard-card-id]').forEach(function (el) {
    el.addEventListener('click', function () {
      var id = el.getAttribute('data-discard-card-id');
      var pos = s.selected.indexOf(id);
      if (pos !== -1) {
        s.selected.splice(pos, 1);
      } else if (s.selected.length < 2) {
        s.selected.push(id);
      }
      renderEnergyRetrievalModal();
    });
  });
}

// Reverse of rules-engine.js's ENERGY_TYPE_BY_CARD_NAME -- attachedEnergy
// stores just the type ('Water'), but the discard-choice modal needs the
// real card name to look up its illustration.
var ENERGY_CARD_NAME_BY_TYPE = {
  Grass: 'Grass Energy', Fire: 'Fire Energy', Water: 'Water Energy',
  Lightning: 'Lightning Energy', Psychic: 'Psychic Energy', Fighting: 'Fighting Energy',
  // 'Colorless' only ever appears in attachedEnergy via Double Colorless
  // Energy (every basic Energy card's own type is one of the 6 above) --
  // safe to map unconditionally.
  Colorless: 'Double Colorless Energy'
};

// Which side of the board the player must click next for a given armed
// Trainer -- shown via showTargetHintModal right when the card is armed,
// so the player isn't left guessing which side to click (e.g. Gust of Wind
// needs the RIVAL's Bench specifically, Potion needs one of the player's
// OWN Pokémon). Bill/Professor Oak need no target at all (isNoTargetTrainer
// below), so they're not listed. Super Energy Removal's two separate steps
// (own Pokémon, then the rival's) show their own hint per step instead --
// see its own handler in wireBoardButtons.
var TRAINER_TARGET_HINT = {
  'Potion': 'Elige uno de tus Pokémon',
  'Super Potion': 'Elige uno de tus Pokémon',
  'Switch': 'Elige uno de tus Pokémon de la Banca',
  'PlusPower': 'Elige tu Pokémon Activo',
  'Gust of Wind': 'Elige un Pokémon de la Banca del Rival',
  'Energy Removal': 'Elige un Pokémon del Rival',
  'Defender': 'Elige uno de tus Pokémon',
  'Devolution Spray': 'Elige uno de tus Pokémon con Evolución',
  'Scoop Up': 'Elige uno de tus Pokémon en juego'
};

function showTargetHintModal(text) {
  document.getElementById('targetHintText').textContent = text;
  document.getElementById('targetHintModal').classList.remove('hidden');
}
function closeTargetHintModal() {
  document.getElementById('targetHintModal').classList.add('hidden');
}

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
  grid.innerHTML = p.bench.filter(function (instance) { return instance; }).map(function (instance) {
    return '<button type="button" class="shell-active-choice-card" data-instance-id="' + instance.id + '">' +
      cardImageTag(instance.name, 'shell-board-card-art', isHoloInMatch('player', instance.name)) +
      '<span>' + escapeHtml(translateCardName(instance.name)) + '</span>' +
      '</button>';
  }).join('');
  grid.querySelectorAll('.shell-active-choice-card').forEach(function (btn) {
    btn.addEventListener('click', function () {
      chooseNewActive(gameState, 'player', btn.getAttribute('data-instance-id'));
      afterPlayerAction();
      // Now that the choice is made and the modal is closing, show whatever
      // turn flash runCpuTurn held back for this exact moment (see its own
      // comment) -- if any; a Trainer-triggered active choice (Gust of
      // Wind sniping a Bench Pokémon into a fight it loses, say) never set
      // one, so this is a no-op there.
      if (pendingTurnFlash) {
        showTurnFlash(pendingTurnFlash.text, pendingTurnFlash.colorClass);
        pendingTurnFlash = null;
      }
      // If a checkup at "Terminar turno" is what triggered this (the
      // player's own poisoned/burned Active dying), let the CPU's turn
      // actually start now that the player has picked their replacement --
      // see runCpuTurn/maybeResumeCpuTurn.
      maybeResumeCpuTurn();
    });
  });
  document.getElementById('activeChoiceModal').classList.remove('hidden');
}

// Shows all 6 prize slots (real face-down backs for the ones still on the
// board, an empty gap for ones already taken -- p.prizes is a fixed 6-slot
// array with nulls in place, see rules-engine.js's remainingPrizes) so the
// player picks a specific slot instead of it being auto-resolved. The hand
// stays visible behind this modal (see renderBoard).
function renderPrizeChoiceModal() {
  var p = gameState.players.player;
  var backUrl = cardBackUrlFor('player');
  var grid = document.getElementById('prizeChoiceGrid');
  grid.innerHTML = p.prizes.map(function (card, index) {
    if (!card) { return '<div class="shell-prize-choice-slot taken"></div>'; }
    return '<button type="button" class="shell-prize-choice-slot" data-prize-index="' + index + '">' +
      '<img src="' + backUrl + '" alt="Carta de premio boca abajo"></button>';
  }).join('');
  grid.querySelectorAll('.shell-prize-choice-slot:not(.taken)').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var index = parseInt(btn.getAttribute('data-prize-index'), 10);
      var wonCard = gameState.players.player.prizes[index];
      var wonCardName = wonCard && wonCard.name;
      takePrize(gameState, 'player', index);
      afterPlayerAction();
      // Zoom the card just taken so it's clear which prize was won -- reuses
      // the same enlarge modal as the hand's 🔍 buttons. Prizes are always
      // the player's own, so isHoloInMatch('player', ...) is enough to show
      // the deck's guaranteed Rare Holo (Gyarados for Overgrowth) with its
      // foil here too, same as everywhere else its front face renders.
      // If a checkup at "Terminar turno" is what triggered this prize (the
      // CPU's own poisoned Active finishing itself off), let the CPU's
      // turn actually start once the player closes the card-zoom below --
      // not the instant they pick the prize, while they're still looking
      // at what they won (see closeCardModal/maybeResumeCpuTurn).
      if (wonCardName) {
        var prizeFoil = getPlayerCardFoilTier(wonCardName) || (isHoloInMatch('player', wonCardName) ? 'holo' : null);
        openCardModal(wonCardName, null, prizeFoil);
        onCardModalClose = maybeResumeCpuTurn;
      } else {
        maybeResumeCpuTurn();
      }
    });
  });
  document.getElementById('prizeChoiceModal').classList.remove('hidden');
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
// -- the Bench doesn't display Special Conditions in the real rules (and
// PlusPower can only ever be attached to an Active in the first place).
function cardStatusOverlayHtml(activeInstance) {
  var badges = activeInstance.statusConditions.map(function (s) {
    if (s === 'Poisoned' && activeInstance.severePoison) {
      return pixelStatusBadgeHtml('SeverePoison', 2);
    }
    return pixelStatusBadgeHtml(s, 2);
  }).join('');
  if (activeInstance.plusPowerAttached) { badges += pixelPlusPowerBadgeHtml(2); }
  if (activeInstance.shield && activeInstance.shield.type === 'reduceFlat') { badges += pixelDefenderBadgeHtml(2); }
  if (!badges) { return ''; }
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
    cardImageTag(instance.name, 'shell-board-card-art', mine ? (getPlayerCardFoilTier(instance.name) || isHoloInMatch('player', instance.name)) : isHoloInMatch('cpu', instance.name)) +
    cardEnergiesOverlayHtml(instance.attachedEnergy) + '</div>';
  var hpHtml = '<div class="shell-board-bench-hp"><div class="shell-board-bench-hp-fill' + (mine ? ' mine' : '') + '" style="width:' + pct + '%"></div></div>';
  var nameHtml = '<div class="shell-board-bench-name">' + escapeHtml(translateCardName(instance.name)) + '</div>';
  return '<div class="shell-board-bench-slot">' + cardHtml + hpHtml + nameHtml + '</div>';
}

// data-bench-index carries the exact slot this empty spot is -- both the
// click-to-place handler and the drag-and-drop drop handler use it so a
// Basic lands in whichever specific slot the player picked/dropped on,
// not just "the next free one" (see playBasic's benchIndex param).
function benchEmptyHtml(mine, index) {
  var cls = 'shell-board-bench-empty' + (mine ? ' pickable' : '');
  var cardHtml = '<div class="' + cls + '"' + (mine ? ' data-owner="player" data-bench-index="' + index + '"' : '') + '>BANCA</div>';
  // Reserves the exact same total height as a filled slot (card + HP bar +
  // name label, see benchCardHtml) so placing/removing a Bench Pokémon
  // never changes the row's height -- that mismatch was what made the whole
  // board visibly resize/shrink every time a Pokémon went down.
  var hpHtml = '<div class="shell-board-bench-hp" style="visibility:hidden"></div>';
  var nameHtml = '<div class="shell-board-bench-name" style="visibility:hidden">&nbsp;</div>';
  return '<div class="shell-board-bench-slot">' + cardHtml + hpHtml + nameHtml + '</div>';
}

function benchRowHtml(bench, mine, flipped) {
  var html = '<div class="shell-board-bench-row">';
  for (var i = 0; i < 5; i++) {
    html += bench[i] ? benchCardHtml(bench[i], mine, flipped) : benchEmptyHtml(mine, i);
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
    // Only the player's own empty Active spot is a real drop target (for the
    // very first Basic, or after a knockout with no Bench left) -- the
    // CPU's side renders the exact same "SIN ACTIVO" placeholder inertly.
    var cls = 'shell-board-active-empty' + (mine ? ' pickable' : '');
    var emptyCardHtml = '<div class="' + cls + '"' + (mine ? ' data-owner="player"' : '') + '>SIN ACTIVO</div>';
    // Reserves the same total height as a real Active (card + name plate +
    // HP bar) -- otherwise the whole column got shorter with no Active out,
    // which made the board visibly resize every time a Pokémon went down.
    var emptyPlate = '<div class="shell-board-active-name-plate" style="visibility:hidden">' +
      '<span class="name">&nbsp;</span><span class="hp">&nbsp;</span></div>' +
      '<div class="shell-board-active-hp" style="visibility:hidden"></div>';
    var emptyOrder = mine ? (emptyCardHtml + emptyPlate) : (emptyPlate + emptyCardHtml);
    return '<div class="shell-board-active-col">' + emptyOrder + '</div>';
  }
  var stats = CARD_STATS[activeInstance.name];
  var hp = stats.hp - activeInstance.damage;
  var pct = Math.max(0, Math.round((hp / stats.hp) * 100));
  var nameEs = escapeHtml(translateCardName(activeInstance.name));
  var namePlate = '<div class="shell-board-active-name-plate' + (mine ? ' mine' : '') + '">' +
    '<span class="name">' + nameEs + '</span><span class="hp">' + hp + '/' + stats.hp + '</span></div>' +
    '<div class="shell-board-active-hp"><div class="shell-board-active-hp-fill' + (mine ? ' mine' : '') + '" style="width:' + pct + '%"></div></div>';
  var cardHtml = '<div class="shell-board-active-card' + (mine ? ' mine' : '') + (flipped ? ' flipped' : '') +
    '" data-instance-id="' + activeInstance.id + '" data-card-name="' + escapeHtml(activeInstance.name) + '">' +
    cardImageTag(activeInstance.name, 'shell-board-card-art', mine ? (getPlayerCardFoilTier(activeInstance.name) || isHoloInMatch('player', activeInstance.name)) : isHoloInMatch('cpu', activeInstance.name)) +
    cardEnergiesOverlayHtml(activeInstance.attachedEnergy) +
    cardStatusOverlayHtml(activeInstance) +
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
// createGame). p.prizes is a fixed 6-slot array for the whole match -- a
// taken prize is null in place (see rules-engine.js's remainingPrizes), so
// the slots here never shift; picking which one to take happens in
// renderPrizeChoiceModal(), not by clicking these directly. Clicking one
// here just zooms its face-down back (real prizes stay secret even to
// their own owner until taken, so there's no card front to reveal) --
// mostly so the player can admire their own chosen Protector up close.
function prizeGridHtml(state, ownerId) {
  var p = state.players[ownerId];
  var mine = ownerId === 'player';
  var backUrl = cardBackUrlFor(ownerId);
  var html = '<div class="shell-board-prize-label' + (mine ? ' mine' : '') + '">PREMIOS · ' + remainingPrizes(p) + '</div><div class="shell-board-prize-grid">';
  for (var i = 0; i < 6; i++) {
    if (p.prizes[i]) {
      html += '<div class="shell-board-prize-card" data-prize-back-url="' + escapeHtml(backUrl) + '"><img src="' + backUrl + '" alt="Carta de premio boca abajo"></div>';
    } else {
      html += '<div class="shell-board-prize-card empty"></div>';
    }
  }
  html += '</div>';
  return html;
}

// The "MANO CPU" label lives directly under #app (not nested inside
// .shell-board-hand-cpu) so it isn't clipped by that band's own
// overflow:hidden -- positionCpuHandLabel() (called once the board is in
// the DOM) centers it in the gap between the hand-card fan and the CPU's
// bench row, without touching the bench or hand-card markup/sizing at all.
function cpuHandRowHtml(count) {
  var cards = '';
  for (var i = 0; i < count; i++) { cards += '<div class="shell-board-hand-cpu-card"><img src="' + CARD_BACK_URL + '" alt="Carta boca abajo"></div>'; }
  return '<div class="shell-board-hand-cpu-label"><span>MANO CPU</span><span class="shell-board-hand-cpu-count">' + pixelDigitsHtml(count, 'dano', 2) + '</span></div>' +
    '<div class="shell-board-hand-cpu">' +
    '<div class="shell-board-hand-cpu-fan">' + cards + '</div>' +
    '</div>';
}

// Lines up "MANO CPU"'s vertical center with the CPU bench Pokémon names'
// -- .shell-board-bench-row always renders one (see benchEmptyHtml: even an
// empty slot reserves a hidden .shell-board-bench-name placeholder), and
// the CPU's bench row is unconditionally the first one in the DOM (see
// renderBoard's own comment on the Bench-then-Active vs Active-then-Bench
// ordering), so this never needs to touch bench markup to find it.
function positionCpuHandLabel() {
  var label = document.querySelector('.shell-board-hand-cpu-label');
  var appEl = document.getElementById('app');
  var cpuHandBand = document.querySelector('.shell-board-hand-cpu');
  // The CPU's bench row is unconditionally the first .shell-board-bench-row
  // in the DOM (see renderBoard's comment on the Bench-then-Active vs
  // Active-then-Bench ordering).
  var cpuBenchRow = document.querySelector('.shell-board-bench-row');
  if (!label || !appEl || !cpuHandBand || !cpuBenchRow) { return; }
  var appTop = appEl.getBoundingClientRect().top;
  // Centered in the gap between the bottom of the CPU's hand-card fan and
  // the top of its bench row -- measured live rather than a fixed px value
  // since .shell-board-zone centers its rows (justify-content:center) over
  // however much flexible height is actually left at render time.
  var handBottom = cpuHandBand.getBoundingClientRect().bottom;
  var benchTop = cpuBenchRow.getBoundingClientRect().top;
  var gapCenter = (handBottom + benchTop) / 2;
  var labelHeight = label.getBoundingClientRect().height;
  // +16px nudges it down slightly from dead-center of the gap, per user
  // preference.
  label.style.top = Math.round(gapCenter - appTop - labelHeight / 2 + 16) + 'px';
}

function isPokemonCard(name) {
  var stats = CARD_STATS[name];
  return !!stats && stats.supertype === 'Pokémon';
}

function isEnergyCard(name) {
  var stats = CARD_STATS[name];
  return !!stats && stats.supertype === 'Energy';
}

function handBandHtml(state) {
  var p = state.players.player;
  var cardsHtml = p.hand.map(function (card) {
    // During setup, only Basic Pokémon can be placed -- Energy/Trainer cards
    // can't be used until the match actually starts.
    var disabled = state.phase === 'setup' && !isBasicPokemon(card.name);
    // Basics and Evolutions are draggable straight onto the board (a Bench
    // slot, the empty Active spot, or the Pokémon they evolve); Energy is
    // draggable onto the Pokémon it attaches to. Trainer cards stay
    // click-only (see the USAR/CANCELAR mini-menu in wireBoardButtons).
    var draggable = !disabled && (isPokemonCard(card.name) || isEnergyCard(card.name));
    return '<button type="button" class="shell-board-hand-card-wrap"' + (draggable ? ' draggable="true"' : '') +
      ' data-hand-id="' + card.id + '" data-card-name="' + escapeHtml(card.name) + '"' + (disabled ? ' disabled' : '') + '>' +
      '<div class="shell-board-hand-card">' + cardImageTag(card.name, '', getPlayerCardFoilTier(card.name) || isHoloInMatch('player', card.name)) + '</div>' +
      '<div class="shell-board-hand-card-name">' + escapeHtml(translateCardName(card.name)) + '</div>' +
      '</button>';
  }).join('');
  return '<div class="shell-board-hand-band">' +
    '<div class="shell-board-hand-header"><span class="shell-board-hand-label">TU MANO</span>' +
      '<span class="shell-board-hand-count">' + pixelDigitsHtml(p.hand.length, 'fosforo', 2) + '</span></div>' +
    '<div class="shell-board-hand-cards">' + cardsHtml + '</div>' +
    '</div>';
}

// Column A's lower half: setup's coin-flip button, or (during play) the
// Retirada/Habilidad/Terminar turno grid, plus the player's own profile footer.
// Habilidad is enabled whenever the player has at least 1 Pokémon (Active
// or Bench) with a currently-usable activatable Power (see
// usablePokemonPowers, rules-engine.js) -- Machamp's Strikes Back is
// passive and never makes this list, it just fires automatically inside
// attack().
function renderBoardActions() {
  var s = gameState;
  var p = s.players.player;
  var pendingPlayerPrize = s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';
  var pendingActive = s.pendingActiveChoice === 'player';
  var html = '';

  if (s.phase === 'setup') {
    html += '<div class="shell-board-actions"><button type="button" class="shell-board-action-start" id="startMatchBtn"' + (p.active ? '' : ' disabled') + '>🪙 LANZAR MONEDA Y COMENZAR</button></div>';
  } else if (s.phase === 'playing' && !pendingPlayerPrize && !pendingActive) {
    var canRetreatAny = p.bench.some(function (b) { return b && canRetreat(s, 'player', b.id); });
    var canUsePower = usablePokemonPowers(s, 'player').length > 0;
    html += '<div class="shell-board-actions"><div class="shell-board-actions-grid">' +
      '<button type="button" class="shell-board-action" id="retreatBtn"' + (canRetreatAny ? '' : ' disabled') + '>CAMBIAR POKÉMON</button>' +
      '<button type="button" class="shell-board-action" id="habilidadBtn"' + (canUsePower ? '' : ' disabled title="No tienes Poderes Pokémon disponibles"') + '>HABILIDAD</button>' +
      '<button type="button" class="shell-board-action-gold" id="endTurnBtn">TERMINAR TURNO ▶</button>' +
      '</div></div>';
  }

  html += '<div class="shell-board-viewer-footer">' +
    '<div class="shell-board-viewer-footer-avatar"><img src="' + playerPhotoUrl() + '" alt=""></div>' +
    '<div class="shell-board-viewer-footer-name">' + escapeHtml(playerDisplayName()) + '</div>' +
    '<div class="shell-board-viewer-footer-coin-dot">' + pixelCoinHtml('oro', 2) + '</div>' +
    '<div class="shell-board-viewer-footer-coin-value">' + (econState ? pixelDigitsHtml(econState.coins, 'oro', 2) : '--') + '</div>' +
    '</div>';

  document.getElementById('boardActions').innerHTML = html;
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;

  // #handCardMenu lives outside #app (see index.html), so it survives the
  // innerHTML replacement below on its own -- close it explicitly so a
  // render triggered by something else (e.g. the CPU's turn) can't leave it
  // open and pointing at a card that may no longer even be in hand.
  hideHandCardMenu();

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
  // The hand stays visible during a pending prize choice -- only the
  // Active-choice modal (a full board takeover after being wiped out) hides
  // it, per real rules the hand is never touched by taking a prize.
  if (!pendingActive) {
    boardHtml += handBandHtml(s);
  }
  document.getElementById('app').innerHTML = boardHtml;
  positionCpuHandLabel();

  if (pendingActive) {
    renderActiveChoiceModal();
  } else {
    document.getElementById('activeChoiceModal').classList.add('hidden');
  }

  if (pendingPlayerPrize) {
    renderPrizeChoiceModal();
  } else {
    document.getElementById('prizeChoiceModal').classList.add('hidden');
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
  } else {
    // cpuTakeTurn() (ai.js) always finishes by calling endTurn() itself
    // before returning, so by the time any render happens after it
    // actually ran, s.activePlayerId is already back to 'player' -- it can
    // only still read 'cpu' here in the window right after the player's
    // OWN action already ended their turn engine-side (attack() calls
    // endTurn() internally -- see afterPlayerAction's comment above) but
    // before they've clicked "TERMINAR TURNO" to actually hand control over.
    // The board hasn't changed and the CPU hasn't moved yet in that
    // window, so the header stays "TU TURNO" instead of flipping the
    // instant an attack lands, before the player did anything to end it
    // themselves. (.shell-board-turn-value.cpu's red styling is unused as
    // a result -- left in place in case a future async CPU-turn animation
    // gives it a real moment to show.)
    turnValueEl.textContent = 'TU TURNO';
    turnValueEl.classList.remove('cpu');
  }

  wireBoardButtons();
  drainTrainerPlaysQueue();
}

// Shows "CPU PENSANDO..." (animated dots, see .shell-cpu-thinking-dots) in
// the turn header for the rest of this render cycle -- afterPlayerAction's
// own renderBoard() call overwrites #boardTurnValue's text/class from real
// game state right after runCpuTurn's delay ends, so nothing needs to
// explicitly undo this.
function showCpuThinkingIndicator() {
  var el = document.getElementById('boardTurnValue');
  if (!el) { return; }
  el.innerHTML = 'CPU PENSANDO<span class="shell-cpu-thinking-dots"><span></span><span></span><span></span></span>';
  el.classList.add('cpu');
}

// Runs the CPU's turn after a "thinking" delay whose length depends on the
// chosen difficulty (see CPU_THINK_DELAY_MS/cpuThinkDelayMs) -- Easy
// resolves instantly (0ms), matching its behavior from before difficulty
// tiers existed. The delay is purely a UI-layer pacing effect: ai.js's
// cpuTakeTurn itself stays fully synchronous regardless of difficulty (see
// its own comment), so this is the only place the "thinking" wait lives.
// endTurnBtn is disabled for the duration so a second click during the
// wait can't invoke this twice.
function runCpuTurn() {
  // The player's turn already ended engine-side the moment they attacked
  // (attack() calls endTurn() internally) -- or, if they didn't attack,
  // right here via the click handler's own endTurn(gameState) call, just
  // before this function runs. Either way, this is genuinely "Terminar
  // turno" being processed for real, so the Pokémon Checkup (Poison/
  // Burned/Asleep, both sides) applies now -- attack() itself deliberately
  // held it back when the attacker was the player (see its own comment),
  // so the player never saw status damage resolve before they'd actually
  // handed the turn over. Harmless no-op on turn 1 (coin flip handing the
  // CPU the opening turn): nobody has a status condition yet.
  applyEndOfTurnCheckup(gameState);
  // Render right now so the checkup's damage/status changes actually show
  // up on screen at the click, instead of sitting invisible in state until
  // afterPlayerAction's render much later (after the CPU's whole turn) --
  // which is what made 10+10 poison damage look like it appeared as a
  // single jump of 20 once the CPU's own turn ended, instead of two
  // separate ticks (one now, one then). If this checkup happened to knock
  // out the player's own Active, this same render is what surfaces the
  // "choose a new Active" modal (renderBoard's pendingActiveChoice check)
  // right away too, rather than only once the CPU's turn later resolves.
  renderBoard();
  // The checkup that just ran can knock something out and leave the player
  // with their own choice to make first -- a prize to take (their own
  // Pokémon's poison finishing off the CPU's Active) or a new Active to
  // pick (their own poisoned/burned Active dying instead). Don't let
  // "TURNO DEL RIVAL" and the CPU's whole turn play out while that's still
  // sitting open and untouched -- wait for it to resolve first (see
  // maybeResumeCpuTurn, called from wherever those choices get made).
  if (hasPendingPlayerChoice()) {
    cpuTurnAwaitingPlayerChoice = true;
    return;
  }
  proceedWithCpuTurn();
}

function hasPendingPlayerChoice() {
  return !!gameState.pendingPrizeChoice || gameState.pendingActiveChoice === 'player';
}

// Called after the prize-choice and active-choice modals resolve -- a
// no-op unless runCpuTurn is specifically waiting on one of them (see its
// own comment), and even then only once every such choice is cleared (a
// single checkup can leave both a prize AND a new Active pending at once).
function maybeResumeCpuTurn() {
  if (!cpuTurnAwaitingPlayerChoice || hasPendingPlayerChoice()) { return; }
  cpuTurnAwaitingPlayerChoice = false;
  proceedWithCpuTurn();
}

function proceedWithCpuTurn() {
  var difficulty = getCpuDifficulty();
  var delay = cpuThinkDelayMs(difficulty);
  var endTurnBtn = document.getElementById('endTurnBtn');
  if (endTurnBtn) { endTurnBtn.disabled = true; }
  showTurnFlash('TURNO DEL RIVAL', 'rival');
  if (delay > 0) { showCpuThinkingIndicator(); }
  // From here on the CPU's own clock should be the one draining (including
  // through the "thinking" delay itself -- see currentClockOwner's comment)
  // instead of the player's, which is what tickGameClock's interval was
  // charging up until now click.
  cpuTurnInProgress = true;
  setTimeout(function () {
    cpuTakeTurn(gameState, difficulty);
    cpuTurnInProgress = false;
    var queuedTrainerPlays = gameState.trainerPlaysQueue || [];
    gameState.trainerPlaysQueue = [];
    // Reveal what the CPU actually did in chronological order: any
    // Trainer(s) it played (showTrainerPlaysSequence, ~1.5s each) come
    // first, and only once that finishes does the real board render --
    // this used to run the other way around (afterPlayerAction's render,
    // which can already show a KO'd board and pop the "choose your new
    // Active" modal, fired immediately, with the Gust of Wind/Trainer
    // flash only appearing on top of -- or after -- a result the player
    // couldn't yet explain).
    showTrainerPlaysSequence(queuedTrainerPlays, function () {
      // A short "CPU PENSANDO..." beat before the reveal, even when no
      // Trainer was played -- see CPU_POST_ACTION_PAUSE_MS's own comment.
      showCpuThinkingIndicator();
      setTimeout(function () {
        afterPlayerAction();
        // Skip the flash if that turn just won/lost the match -- there's
        // no "tu turno" coming next (afterPlayerAction already showed the
        // win/loss modal instead of a normal board render above).
        if (getWinner(gameState)) { return; }
        // A KO during the CPU's turn can leave the player forced to pick a
        // new Active (see renderActiveChoiceModal) -- hold the flash for
        // that choice to resolve instead of flashing over their decision.
        if (hasPendingPlayerChoice()) {
          pendingTurnFlash = { text: 'TU TURNO', colorClass: 'mine' };
        } else {
          showTurnFlash('TU TURNO', 'mine');
        }
      }, CPU_POST_ACTION_PAUSE_MS);
    });
  }, delay);
}

// Deliberately does NOT auto-run the CPU's turn. Whatever the player just
// did (attack, retreat, play a Trainer...) may already have ended their
// turn engine-side (attack() calls endTurn() internally), but the CPU only
// actually moves once the player clicks "Terminar turno" -- see
// wireBoardButtons' endTurnBtn handler (runCpuTurn). This lets the player
// review the result of their own action (damage dealt, effects applied,
// etc. in the log) before the board changes again.
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
  // A simultaneous double-knockout (e.g. the CPU's own Active also falls to
  // a status-condition checkup right after its attack KOs the player's last
  // Pokémon) can leave a pendingPrizeChoice/pendingActiveChoice sitting
  // unresolved at the exact moment the match ends -- real rules don't care
  // who still owes a prize once someone has already lost, so clear both
  // instead of letting renderBoard() below pop that modal over "Has
  // Perdido"/"Has Ganado".
  gameState.pendingPrizeChoice = null;
  gameState.pendingActiveChoice = null;
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

// Closes the Trainer mini-menu (see wireBoardButtons) -- also called at the
// top of renderBoard() since #handCardMenu lives outside #app and so
// survives a normal re-render on its own.
function hideHandCardMenu() {
  var menu = document.getElementById('handCardMenu');
  if (menu) { menu.classList.add('hidden'); }
  document.querySelectorAll('.shell-board-hand-card-wrap.armed').forEach(function (el) {
    el.classList.remove('armed');
  });
}

// A small popup next to the card with one confirm action (USAR, currently
// the only card type that still uses this -- Energy is drag-and-drop only,
// see handBandHtml/resolveHandDrop) plus CANCELAR. Confirming calls
// onConfirm, responsible for whatever happens next (dispatching immediately
// for a no-target Trainer, or arming selectedHandId to await a target click).
function showHandCardMenu(anchorBtn, actionLabel, onConfirm) {
  var menu = document.getElementById('handCardMenu');
  menu.innerHTML =
    '<button type="button" class="shell-hand-card-menu-btn confirm" data-menu-action="confirm">' + escapeHtml(actionLabel) + '</button>' +
    '<button type="button" class="shell-hand-card-menu-btn cancel" data-menu-action="cancel">CANCELAR</button>';
  var rect = anchorBtn.getBoundingClientRect();
  menu.style.left = Math.round(rect.left) + 'px';
  menu.style.bottom = Math.round(window.innerHeight - rect.top + 8) + 'px';
  menu.classList.remove('hidden');
  anchorBtn.classList.add('armed');
  menu.querySelector('[data-menu-action="confirm"]').addEventListener('click', function () {
    hideHandCardMenu();
    onConfirm();
  });
  menu.querySelector('[data-menu-action="cancel"]').addEventListener('click', hideHandCardMenu);
}

function wireBoardButtons() {
  var handButtons = document.querySelectorAll('.shell-board-hand-card-wrap');
  var selectedHandId = null;
  var retreatMode = false;
  // Super Energy Removal needs TWO board-card clicks in sequence (your own
  // Pokémon to pay the cost, then the rival's to hit) -- null until the
  // first click's energy-discard modal confirms which own energy to use,
  // same "no renderBoard() in between" rule retreatMode already relies on
  // (renderBoard() re-invokes wireBoardButtons(), which would recreate this
  // closure and silently drop whichever step was already picked).
  var pendingSuperEnergyRemoval = null;
  // Pokémon Powers (HABILIDAD): tracks the in-progress activation, same
  // "no renderBoard() in between steps" rule as pendingSuperEnergyRemoval
  // above -- {ownerId, powerName, step ('from'/'to', Damage Swap/Energy
  // Trans only), fromInstanceId, handEnergyId (Rain Dance), chosenType
  // (Buzzap)}. null when no Power activation is in progress.
  var pendingPowerActivation = null;
  // Pokémon Breeder's own 2-step flow (pick a Stage 2 hand card, then click
  // the matching Basic on the board) -- same "no renderBoard() in between"
  // rule as the vars above. {handId, evolutionHandId} while step 2 (the
  // board click) is still pending; null otherwise.
  var pendingPokemonBreeder = null;

  // Real reported UX bug: arming one multi-step flow (Súper Retirar
  // Energía, a Pokémon Power, Criador Pokémon) and then starting a
  // DIFFERENT action before finishing it used to leave the abandoned one's
  // pending-state variable silently set -- harmless in the sense that the
  // board-click handler's if-chain always checks a fixed order so the
  // wrong effect never actually fired, but confusing (a stray "Elige..."
  // hint could persist, and the abandoned flow just sat there inert with
  // no way to tell it was cancelled). Every entry point that starts a NEW
  // action (a hand card click, CAMBIAR POKÉMON, HABILIDAD) now calls this
  // first, so at most one flow is ever "in progress" at a time.
  function clearPendingFlows() {
    selectedHandId = null;
    retreatMode = false;
    pendingSuperEnergyRemoval = null;
    pendingPowerActivation = null;
    pendingPokemonBreeder = null;
    pendingAttackNeedingTarget = null;
    closeTargetHintModal();
  }

  handButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      showCardInViewer(btn.getAttribute('data-card-name'));
      clearPendingFlows();
      hideHandCardMenu();
      var handId = btn.getAttribute('data-hand-id');
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === handId; });
      if (!handCard) { return; }
      var stats = CARD_STATS[handCard.name];

      if (stats.supertype === 'Trainer') {
        // Trainer cards get an explicit "USAR" + CANCELAR menu next to the
        // card instead of silently entering target-selection mode the
        // instant the card is clicked. Energy is drag-and-drop only now (see
        // handBandHtml/resolveHandDrop) -- no menu, no click-to-select.
        var isNoTargetTrainer = handCard.name === 'Bill' || handCard.name === 'Professor Oak' || handCard.name === 'Lass' ||
          handCard.name === 'Impostor Professor Oak' || handCard.name === 'Full Heal' || handCard.name === 'Pokémon Center';
        showHandCardMenu(btn, 'USAR', function () {
          if (isNoTargetTrainer) {
            var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', handId);
            if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
            selectedHandId = null;
            renderBoard();
          } else if (handCard.name === 'Computer Search') {
            // Two steps, neither of which is a board-click target: first
            // discard 2 OTHER hand cards as the cost (per the real printed
            // text -- "if you can't discard 2 cards, you can't play this
            // card"), then search the deck. Rejected up front (no modal at
            // all) if the hand doesn't have 2 other cards to pay with.
            var otherHandCards = p.hand.filter(function (c) { return c.id !== handId; });
            if (otherHandCards.length < 2) {
              logEvent(gameState, 'No tienes 2 cartas para descartar -- no puedes jugar Búsqueda Computarizada', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openHandDiscardModal(otherHandCards, 2, function (discardHandIds) {
              openDeckSearchModal(p.deck.slice(), function (deckCardId) {
                var result = TRAINER_EFFECTS['Computer Search'](gameState, 'player', handId, deckCardId, discardHandIds);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
            });
          } else if (handCard.name === 'Energy Retrieval') {
            // Two steps: trade 1 OTHER hand card as the cost, then choose
            // UP TO 2 (0, 1, or 2 -- a real choice, not a fixed count) basic
            // Energy cards from your own discard pile.
            var otherHandCardsForTrade = p.hand.filter(function (c) { return c.id !== handId; });
            if (otherHandCardsForTrade.length < 1) {
              logEvent(gameState, 'No tienes otra carta para cambiar -- no puedes jugar Recuperar Energía', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openHandDiscardModal(otherHandCardsForTrade, 1, function (tradeIds) {
              var basicEnergyInDiscard = p.discard.filter(function (c) { return ENERGY_TYPE_BY_CARD_NAME.hasOwnProperty(c.name); });
              openEnergyRetrievalModal(basicEnergyInDiscard, function (retrieveIds) {
                var result = TRAINER_EFFECTS['Energy Retrieval'](gameState, 'player', handId, tradeIds[0], retrieveIds);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
            });
          } else if (handCard.name === 'Item Finder') {
            // Two steps: discard 2 OTHER hand cards as the cost, then pick a
            // real Trainer card (excluding whatever else is in there) from
            // your OWN discard pile -- openDeckSearchModal doesn't care that
            // this pool is the discard pile rather than the deck, it just
            // renders whatever {id,name} cards it's given.
            var otherHandCardsForFinder = p.hand.filter(function (c) { return c.id !== handId; });
            if (otherHandCardsForFinder.length < 2) {
              logEvent(gameState, 'No tienes 2 cartas para descartar -- no puedes jugar Buscador de Objetos', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openHandDiscardModal(otherHandCardsForFinder, 2, function (discardHandIds) {
              var trainersInDiscard = p.discard.filter(function (c) { return CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Trainer'; });
              openDeckSearchModal(trainersInDiscard, function (discardCardId) {
                var result = TRAINER_EFFECTS['Item Finder'](gameState, 'player', handId, discardHandIds, discardCardId);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
            });
          } else if (handCard.name === 'Maintenance') {
            // One step: shuffle exactly 2 OTHER hand cards into the deck,
            // then draw 1 -- reuses the same exact-count picker as Computer
            // Search's discard step even though these cards go to the deck,
            // not the discard pile (the modal's own "para descartar" wording
            // is a harmless simplification for this one rare Trainer).
            var otherHandCardsForMaintenance = p.hand.filter(function (c) { return c.id !== handId; });
            if (otherHandCardsForMaintenance.length < 2) {
              logEvent(gameState, 'No tienes 2 cartas para mezclar -- no puedes jugar Mantenimiento', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openHandDiscardModal(otherHandCardsForMaintenance, 2, function (shuffleHandIds) {
              var result = TRAINER_EFFECTS['Maintenance'](gameState, 'player', handId, shuffleHandIds);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
          } else if (handCard.name === 'Pokémon Trader') {
            // Two steps, both card-picker modals (no board click): a
            // Pokémon card from your own hand, then a Pokémon card from
            // your own deck.
            var pokemonInHandForTrader = p.hand.filter(function (c) { return c.id !== handId && CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Pokémon'; });
            if (pokemonInHandForTrader.length === 0) {
              logEvent(gameState, 'No tienes otra carta de Pokémon para cambiar -- no puedes jugar Intercambiador Pokémon', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openDeckSearchModal(pokemonInHandForTrader, function (tradeHandId) {
              var pokemonInDeck = p.deck.filter(function (c) { return CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Pokémon'; });
              openDeckSearchModal(pokemonInDeck, function (deckCardId) {
                var result = TRAINER_EFFECTS['Pokémon Trader'](gameState, 'player', handId, tradeHandId, deckCardId);
                if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
                selectedHandId = null;
                renderBoard();
              });
            });
          } else if (handCard.name === 'Pokémon Breeder') {
            // Two steps: pick a Stage 2 card from hand (2 evolution hops
            // above some Basic), then click the matching Basic on the
            // board -- see pendingPowerActivation-style tracking below for
            // why this needs a closure var that survives without a
            // renderBoard() in between.
            var stage2Candidates = p.hand.filter(function (c) {
              var stats1 = CARD_STATS[c.name];
              var stage1 = stats1 && stats1.evolvesFrom && CARD_STATS[stats1.evolvesFrom];
              return !!(stage1 && stage1.evolvesFrom);
            });
            if (stage2Candidates.length === 0) {
              logEvent(gameState, 'No tienes una carta de Evolución de 2ª Etapa en tu mano -- no puedes jugar Criador Pokémon', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openDeckSearchModal(stage2Candidates, function (evolutionHandId) {
              pendingPokemonBreeder = { handId: handId, evolutionHandId: evolutionHandId };
              showTargetHintModal('Elige el Pokémon Básico del que evoluciona esa carta');
            });
          } else if (handCard.name === 'Pokémon Flute') {
            var opBasicsInDiscard = gameState.players.cpu.discard.filter(function (c) { return isBasicPokemon(c.name); });
            if (opBasicsInDiscard.length === 0) {
              logEvent(gameState, 'No hay Pokémon Básicos en el descarte rival -- no puedes jugar Flauta Pokémon', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openDeckSearchModal(opBasicsInDiscard, function (opponentDiscardCardId) {
              var result = TRAINER_EFFECTS['Pokémon Flute'](gameState, 'player', handId, opponentDiscardCardId);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
          } else if (handCard.name === 'Revive') {
            var basicsInOwnDiscard = p.discard.filter(function (c) { return isBasicPokemon(c.name); });
            if (basicsInOwnDiscard.length === 0) {
              logEvent(gameState, 'No hay Pokémon Básicos en tu descarte -- no puedes jugar Revivir', 'player');
              selectedHandId = null;
              renderBoard();
              return;
            }
            openDeckSearchModal(basicsInOwnDiscard, function (discardCardId) {
              var result = TRAINER_EFFECTS['Revive'](gameState, 'player', handId, discardCardId);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
          } else if (handCard.name === 'Pokédex') {
            var topOfDeck = p.deck.slice(0, Math.min(5, p.deck.length));
            openPokedexModal(topOfDeck, function (orderedIds) {
              var result = TRAINER_EFFECTS['Pokédex'](gameState, 'player', handId, orderedIds);
              if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
              selectedHandId = null;
              renderBoard();
            });
          } else {
            selectedHandId = handId;
            btn.classList.add('armed');
            // Super Energy Removal's own hint is shown per-step instead
            // (see its own handler below) -- its first step is always
            // "one of your own Pokémon", same text TRAINER_TARGET_HINT
            // would give it anyway.
            var hint = handCard.name === 'Super Energy Removal' ? 'Elige uno de tus Pokémon' : TRAINER_TARGET_HINT[handCard.name];
            if (hint) { showTargetHintModal(hint); }
          }
        });
        return;
      }

      // Energy falls through to here too (drag-and-drop is the main way to
      // attach it now, but click-to-select-then-click-target still works as
      // a fallback, same as Basics/Evolutions below).

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

    // Pokémon (Basic/Evolution) and Energy can be dragged straight onto the
    // board -- Trainer stays click+menu-only (see above).
    if (btn.getAttribute('draggable') === 'true') {
      btn.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', btn.getAttribute('data-hand-id'));
        e.dataTransfer.effectAllowed = 'move';
        btn.classList.add('dragging');
      });
      btn.addEventListener('dragend', function () {
        btn.classList.remove('dragging');
      });
    }
  });

  // Shared by every drop target below. isEmptySlotDrop/benchIndex describe a
  // drop onto an empty Bench slot or the empty Active spot (benchIndex is
  // only meaningful for the former); targetInstanceId describes a drop onto
  // an existing Pokémon (an evolution). Branching on which kind of spot this
  // actually was -- not just on the dragged card's type -- means a Basic
  // dropped on an existing Pokémon does nothing instead of quietly landing
  // in some other slot than the one actually dropped on.
  function resolveHandDrop(handId, isEmptySlotDrop, benchIndex, targetInstanceId) {
    var p = gameState.players.player;
    var handCard = p.hand.find(function (c) { return c.id === handId; });
    if (!handCard) { return; }
    if (isEmptySlotDrop && isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', handId)) {
      playBasic(gameState, 'player', handId, benchIndex);
      afterPlayerAction();
    } else if (targetInstanceId && canEvolve(gameState, 'player', handId, targetInstanceId)) {
      evolve(gameState, 'player', handId, targetInstanceId);
      var evolved = findInstanceEitherSide(targetInstanceId);
      if (evolved) { showCardInViewer(evolved.name, targetInstanceId); }
      afterPlayerAction();
    } else if (targetInstanceId && canAttachEnergy(gameState, 'player', handId, targetInstanceId)) {
      attachEnergy(gameState, 'player', handId, targetInstanceId);
      afterPlayerAction();
    }
  }

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
        if (gameState.activePlayerId === 'cpu') {
          runCpuTurn();
        } else {
          // runCpuTurn's own 'TURNO DEL RIVAL' flash covers the other
          // branch -- this one needs its own "TU TURNO" for the same
          // reason, since winning the opening coin flip never otherwise
          // passes through runCpuTurn/proceedWithCpuTurn at all.
          showTurnFlash('TU TURNO', 'mine');
          afterPlayerAction();
        }
      }
    });
  }

  // "Terminar turno" is context-aware: if it's still the player's turn it
  // ends it (endTurn); if it's already the CPU's turn (their turn started
  // but they haven't moved yet -- see afterPlayerAction's comment) it lets
  // them actually take it (runCpuTurn). Same button, same label, either
  // way the player has to click it before the game state advances again.
  // The two checks are sequential (not else-if) so a single click always
  // fully hands the turn to the CPU -- ending my own turn here (if it was
  // still mine) makes activePlayerId 'cpu' right away, and the very same
  // click already covers that case below, instead of requiring a second
  // press just for the CPU to actually move.
  var endTurnBtn = document.getElementById('endTurnBtn');
  if (endTurnBtn) {
    endTurnBtn.addEventListener('click', function () {
      if (gameState.activePlayerId === 'player') { endTurn(gameState); }
      if (gameState.activePlayerId === 'cpu') { runCpuTurn(); } else { afterPlayerAction(); }
    });
  }

  // "Retirar" starts a target-selection mode instead of listing one button
  // per Bench Pokémon: click Retirar, then click the Bench Pokémon (below)
  // you want to swap in -- handled by the shared bench/active card handler.
  var retreatBtn = document.getElementById('retreatBtn');
  if (retreatBtn) {
    retreatBtn.addEventListener('click', function () {
      clearPendingFlows();
      retreatMode = true;
    });
  }

  // Kicks off the specific target-gathering flow for one Pokémon's Power.
  // Energy Burn needs no target at all (resolves immediately); the other 3
  // activatable Powers need 1-2 more clicks (a board Pokémon and/or a hand
  // Energy card and/or a chosen type) before usePokemonPower() actually
  // runs -- see the board-card click handler below for how each step
  // resolves once pendingPowerActivation is set.
  function startPowerFlow(instance) {
    var powerName = CARD_STATS[instance.name].pokemonPower.name;
    if (powerName === 'Energy Burn') {
      var result = usePokemonPower(gameState, 'player', instance.id, {});
      if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
      renderBoard();
      return;
    }
    if (powerName === 'Damage Swap' || powerName === 'Energy Trans') {
      pendingPowerActivation = { ownerId: instance.id, powerName: powerName, step: 'from' };
      showTargetHintModal(powerName === 'Damage Swap' ? 'Elige el Pokémon con el daño a mover' : 'Elige el Pokémon con la Energía Planta a mover');
      return;
    }
    if (powerName === 'Rain Dance') {
      var waterCards = gameState.players.player.hand.filter(function (c) { return c.name === 'Water Energy'; });
      if (waterCards.length === 0) {
        logEvent(gameState, 'No tienes Energía Agua en la mano -- no puedes usar Rain Dance', 'player');
        renderBoard();
        return;
      }
      openHandDiscardModal(waterCards, 1, function (ids) {
        pendingPowerActivation = { ownerId: instance.id, powerName: 'Rain Dance', handEnergyId: ids[0] };
        showTargetHintModal('Elige uno de tus Pokémon de tipo Agua');
      });
      // The modal's real header still says "para descartar" (shared with
      // Computer Search's step) -- close enough here since the grid/count
      // mechanics (pick exactly 1) are identical; a dedicated prompt isn't
      // worth a second modal for this one Power.
      return;
    }
    if (powerName === 'Buzzap') {
      var typeOptions = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless'].map(function (t) {
        return { id: t, label: BUZZAP_TYPE_NAME_ES[t], imgUrl: 'Tipos/' + ENERGY_CARD_TYPE_ICON[t] + '.png' };
      });
      openChoicePickerModal('Elige un tipo de Energía para Buzzap', typeOptions, function (chosenType) {
        pendingPowerActivation = { ownerId: instance.id, powerName: 'Buzzap', chosenType: chosenType };
        showTargetHintModal('Elige otro de tus Pokémon para adjuntarle 2 Energía');
      });
      return;
    }
  }

  var habilidadBtn = document.getElementById('habilidadBtn');
  if (habilidadBtn) {
    habilidadBtn.addEventListener('click', function () {
      clearPendingFlows();
      var usable = usablePokemonPowers(gameState, 'player');
      if (usable.length === 0) { return; }
      if (usable.length === 1) {
        startPowerFlow(usable[0]);
      } else {
        var options = usable.map(function (instance) {
          return { id: instance.id, label: instance.name + ' (' + CARD_STATS[instance.name].pokemonPower.name + ')', imgUrl: CARD_IMAGE_BY_NAME[instance.name] };
        });
        openChoicePickerModal('Elige qué Poder Pokémon usar', options, function (chosenId) {
          var chosen = usable.find(function (instance) { return instance.id === chosenId; });
          if (chosen) { startPowerFlow(chosen); }
        });
      }
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
      if (pendingAttackNeedingTarget === 'Lure') {
        var onCpuBenchForLure = gameState.players.cpu.bench.some(function (b) { return b && b.id === instanceId; });
        if (!onCpuBenchForLure) {
          logEvent(gameState, 'Elige un Pokémon de la Banca del Rival', 'player');
          renderBoard();
          return;
        }
        pendingAttackNeedingTarget = null;
        attack(gameState, 'player', 'Lure', instanceId);
        afterPlayerAction();
        return;
      }
      if (pendingPowerActivation) {
        var pa = pendingPowerActivation;
        var ownClick = findInstance(gameState.players.player, instanceId);
        if (!ownClick) {
          // Same "log only, keep the flow armed" pattern as Super Energy
          // Removal's own invalid-click case above -- no renderBoard()
          // here, it would wipe this very closure mid-flow.
          logEvent(gameState, 'Elige uno de tus Pokémon', 'player');
          document.getElementById('log').innerHTML = logHtml(gameState);
          return;
        }
        if (pa.powerName === 'Damage Swap' || pa.powerName === 'Energy Trans') {
          if (pa.step === 'from') {
            pa.fromInstanceId = instanceId;
            pa.step = 'to';
            showTargetHintModal(pa.powerName === 'Damage Swap' ? 'Elige el Pokémon que recibirá el daño' : 'Elige el Pokémon que recibirá la Energía');
            return;
          }
          pendingPowerActivation = null;
          var swapResult = usePokemonPower(gameState, 'player', pa.ownerId, { fromInstanceId: pa.fromInstanceId, toInstanceId: instanceId });
          if (swapResult && !swapResult.legal) { logEvent(gameState, swapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Rain Dance') {
          pendingPowerActivation = null;
          var rainResult = usePokemonPower(gameState, 'player', pa.ownerId, { handEnergyId: pa.handEnergyId, targetInstanceId: instanceId });
          if (rainResult && !rainResult.legal) { logEvent(gameState, rainResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Buzzap') {
          pendingPowerActivation = null;
          var buzzapResult = usePokemonPower(gameState, 'player', pa.ownerId, { chosenType: pa.chosenType, targetInstanceId: instanceId });
          if (buzzapResult && !buzzapResult.legal) { logEvent(gameState, buzzapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        return;
      }
      if (pendingPokemonBreeder) {
        var pb = pendingPokemonBreeder;
        pendingPokemonBreeder = null;
        var breederResult = TRAINER_EFFECTS['Pokémon Breeder'](gameState, 'player', pb.handId, pb.evolutionHandId, instanceId);
        if (breederResult && !breederResult.legal) { logEvent(gameState, breederResult.reason, 'player'); }
        selectedHandId = null;
        renderBoard();
        return;
      }
      if (!selectedHandId) { return; }
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      var superPotionTarget = handCard.name === 'Super Potion' ? findInstance(p, instanceId) : null;
      var energyRemovalTarget = handCard.name === 'Energy Removal' ? findInstance(gameState.players.cpu, instanceId) : null;
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
      } else if (energyRemovalTarget && energyRemovalTarget.attachedEnergy.length > 0) {
        // Real card text: "Choose 1 Energy card attached to 1 of your
        // opponent's Pokémon" -- same choice-of-which-energy pattern as
        // Super Potion above, just targeting the rival's Pokémon instead
        // of the player's own.
        var energyRemovalHandId = selectedHandId;
        selectedHandId = null;
        openEnergyDiscardModal(energyRemovalTarget.attachedEnergy.slice(), 1, function (indices) {
          var result = TRAINER_EFFECTS['Energy Removal'](gameState, 'player', energyRemovalHandId, instanceId, indices[0]);
          if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
          renderBoard();
        });
        return;
      } else if (handCard.name === 'Super Energy Removal' && !pendingSuperEnergyRemoval) {
        // Step 1 of 2: click one of YOUR OWN Pokémon (with energy attached)
        // to pay the cost -- see TRAINER_EFFECTS['Super Energy Removal']'s
        // own comment for why the specific energy is a modal choice, same
        // as Super Potion above.
        var ownTarget = findInstance(p, instanceId);
        if (ownTarget && ownTarget.attachedEnergy.length > 0) {
          var superRemovalHandId = selectedHandId;
          var superRemovalOwnId = instanceId;
          openEnergyDiscardModal(ownTarget.attachedEnergy.slice(), 1, function (indices) {
            pendingSuperEnergyRemoval = { handId: superRemovalHandId, ownInstanceId: superRemovalOwnId, ownEnergyIndex: indices[0] };
            logEvent(gameState, 'Elige el Pokémon rival al que quitarle energía', 'player');
            document.getElementById('log').innerHTML = logHtml(gameState);
            showTargetHintModal('Elige un Pokémon del Rival');
          });
        } else {
          logEvent(gameState, 'Elige uno de tus Pokémon con energía adjunta', 'player');
          document.getElementById('log').innerHTML = logHtml(gameState);
        }
        return; // stays armed -- waits for a valid own target (retry) or, once the modal confirms, the rival's target
      } else if (handCard.name === 'Super Energy Removal' && pendingSuperEnergyRemoval) {
        // Step 2 of 2: click the rival Pokémon to actually remove energy from.
        var cpuTarget = findInstance(gameState.players.cpu, instanceId);
        if (!cpuTarget) {
          logEvent(gameState, 'Elige un Pokémon del rival', 'player');
          document.getElementById('log').innerHTML = logHtml(gameState);
          return; // still pending -- wait for a valid rival target
        }
        var pendingRemoval = pendingSuperEnergyRemoval;
        pendingSuperEnergyRemoval = null;
        var removalResult = TRAINER_EFFECTS['Super Energy Removal'](gameState, 'player', pendingRemoval.handId, pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex);
        if (removalResult && !removalResult.legal) { logEvent(gameState, removalResult.reason, 'player'); }
      } else if (TRAINER_EFFECTS[handCard.name]) {
        var result = TRAINER_EFFECTS[handCard.name](gameState, 'player', selectedHandId, instanceId);
        if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
      }
      selectedHandId = null;
      renderBoard();
    });

    // Drag an Evolution card from hand onto its own Active/Bench Pokémon to
    // evolve it (the rival's board is never a legal drop target -- only
    // your own cards render with the .mine class in the first place).
    if (el.classList.contains('mine')) {
      el.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', function () { el.classList.remove('drag-over'); });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('drag-over');
        var handId = e.dataTransfer.getData('text/plain');
        resolveHandDrop(handId, false, null, el.getAttribute('data-instance-id'));
      });
    }
  });

  // Click an empty Bench slot to place the selected Basic there, landing in
  // that exact slot (data-bench-index) instead of just the next free one --
  // same target that a drag-and-drop onto this slot resolves to below.
  document.querySelectorAll('.shell-board-bench-empty.pickable').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!selectedHandId) { return; }
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      if (isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', selectedHandId)) {
        var benchIndex = parseInt(el.getAttribute('data-bench-index'), 10);
        playBasic(gameState, 'player', selectedHandId, benchIndex);
      }
      selectedHandId = null;
      renderBoard();
    });
    el.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drag-over'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      el.classList.remove('drag-over');
      var handId = e.dataTransfer.getData('text/plain');
      var benchIndex = parseInt(el.getAttribute('data-bench-index'), 10);
      resolveHandDrop(handId, true, benchIndex, null);
    });
  });

  // Drop a Basic straight onto the empty Active spot -- the click flow
  // already auto-completes this the instant a Basic is clicked with no
  // Active out (see the hand-card click handler above), but a drag needs an
  // actual drop target since there's no equivalent "pick it up" moment.
  var emptyActive = document.querySelector('.shell-board-active-empty.pickable');
  if (emptyActive) {
    emptyActive.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      emptyActive.classList.add('drag-over');
    });
    emptyActive.addEventListener('dragleave', function () { emptyActive.classList.remove('drag-over'); });
    emptyActive.addEventListener('drop', function (e) {
      e.preventDefault();
      emptyActive.classList.remove('drag-over');
      var handId = e.dataTransfer.getData('text/plain');
      resolveHandDrop(handId, true, null, null);
    });
  }

  document.querySelectorAll('.shell-board-deckbox.clickable').forEach(function (el) {
    el.addEventListener('click', function () {
      openDiscardPileModal(el.getAttribute('data-discard-owner'));
    });
  });

  document.querySelectorAll('.shell-board-prize-card[data-prize-back-url]').forEach(function (el) {
    el.addEventListener('click', function () {
      openCardModal('Carta de premio (boca abajo)', el.getAttribute('data-prize-back-url'));
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

// Whose clock is really running right now. gameState.activePlayerId flips
// to 'cpu' the instant the player's own action ends their turn (attack()
// calls endTurn() internally), well before the CPU is actually handed
// control -- that only happens once the player clicks "TERMINAR TURNO"
// (runCpuTurn sets this true for the duration of the delay + the CPU's
// actual turn). Until then it's still functionally the player's turn --
// same reasoning as the header staying "TU TURNO" during that window (see
// renderBoard's own comment) -- so their own clock should keep draining,
// not the CPU's. Without this, the CPU's bank was already ticking down
// while the player was still reviewing the board, before they'd even
// clicked to hand the turn over.
var cpuTurnInProgress = false;
function currentClockOwner() {
  return (gameState.activePlayerId === 'cpu' && !cpuTurnInProgress) ? 'player' : gameState.activePlayerId;
}

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
  var activeId = currentClockOwner();
  var remaining = s.players[activeId].timeBankMs;
  renderClockDisplay(el, remaining, activeId === 'cpu');
}

function tickGameClock() {
  if (!gameState || gameState.phase !== 'playing' || !gameState.activePlayerId) { return; }
  var now = Date.now();
  var elapsed = clockLastTickAt ? (now - clockLastTickAt) : 0;
  clockLastTickAt = now;
  tickClock(gameState, currentClockOwner(), elapsed);
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
  cpuTurnInProgress = false;
  stopGameClock();
  stopDuelMusic();
  document.getElementById('matchEndMusic').pause();
  document.getElementById('matchEndModal').classList.add('hidden');
  gameState = createGame(Math.random, (econState && econState.activeDeck) || 'overgrowth');
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
          '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 3) + pixelDigitsHtml(100, 'oro', 3) + '</span>' +
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
      : '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 3) + pixelDigitsHtml(o.cost, 'oro', 3) + '</span>' +
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
      // The catalog's own r tag no longer locks in the displayed rarity --
      // every star-tier pull rolls Rare/Holo/Secret independently (see
      // openBooster/pureEconomy.js's RARITY_ROLL), so whether *this* card
      // counts as holo/secret depends only on whether at least one owned
      // copy actually rolled that tier (collectionHolo/collectionSecret).
      var holo = (econState.collectionHolo[key] || 0) > 0;
      var secret = (econState.collectionSecret[key] || 0) > 0;
      all.push({
        setKey: setKey, setTotal: setTotal, num: c.num, name: c.n, rarity: c.r, img: c.img,
        count: (econState.collection[key] || 0), holo: holo, secret: secret
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

// A catalog entry's collection/collectionHolo/collectionSecret counts are
// independent per-copy rolls (see collectionAllCards' own comment) -- the
// same card can genuinely be owned as plain Rare, Rare Holo, AND Secret
// Rare at once. The grid used to show only the single highest tier owned
// (secret > holo > plain), completely hiding whatever other tiers were
// also owned. This splits one catalog entry into one grid cell per tier
// actually owned, each with that tier's own copy count -- an unowned card
// stays a single locked placeholder cell, same as before.
function expandCollectionEntryByTier(c) {
  if (!c.count) { return [c]; }
  var key = c.setKey + '-' + c.num;
  var secretCount = (econState.collectionSecret[key] || 0);
  var holoCount = (econState.collectionHolo[key] || 0);
  var plainCount = c.count - secretCount - holoCount;
  var out = [];
  if (plainCount > 0) { out.push(Object.assign({}, c, { count: plainCount, holo: false, secret: false })); }
  if (holoCount > 0) { out.push(Object.assign({}, c, { count: holoCount, holo: true, secret: false })); }
  if (secretCount > 0) { out.push(Object.assign({}, c, { count: secretCount, holo: false, secret: true })); }
  return out.length ? out : [c];
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
    // Secret takes priority over holo when a card is owned across more
    // than one independently-rolled tier at once (see collectionAllCards)
    // -- the grid cell itself always shows the rarest one owned; click it
    // to see every version (openCollectionVersionsModal, when there's more
    // than one to show).
    var isSecret = owned && c.secret;
    var isHolo = owned && c.holo && !isSecret;
    var tierClass = isSecret ? ' secret' : (isHolo ? ' holo' : '');
    var numLabel = ('000' + c.num).slice(-3) + '/' + c.setTotal;
    return '<div class="shell-collection-cell' + (owned ? '' : ' locked') + tierClass + '" data-set-key="' + c.setKey + '" data-num="' + c.num + '" data-card-name="' + escapeHtml(c.name) + '" data-card-img="' + escapeHtml(c.img || '') + '">' +
      '<div class="shell-collection-cell-art">' +
        (c.img ? '<img src="' + c.img + '" alt="' + escapeHtml(c.name) + '" loading="lazy">' : '') +
        (isSecret ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' : (isHolo ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '')) +
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
      if (!name) { return; }
      var setKey = el.getAttribute('data-set-key');
      var num = el.getAttribute('data-num');
      var entry = filtered.find(function (c) { return c.setKey === setKey && String(c.num) === num; });
      var tiers = entry ? expandCollectionEntryByTier(entry) : [];
      if (tiers.length > 1) {
        openCollectionVersionsModal(entry, tiers);
      } else {
        openCardModal(name, el.getAttribute('data-card-img'), cellFoilTier(el));
      }
    });
  });
}

// Shows every tier actually owned of one card (rare/holo/secret), each its
// own .shell-collection-cell -- only ever opened from the main grid's click
// handler when there's more than one to show (renderCollectionGrid).
function openCollectionVersionsModal(entry, tiers) {
  document.getElementById('collectionVersionsTitle').textContent = translateCardName(entry.name);
  var grid = document.getElementById('collectionVersionsGrid');
  grid.innerHTML = tiers.map(function (t) {
    var isSecret = t.secret;
    var isHolo = t.holo && !isSecret;
    var tierClass = isSecret ? ' secret' : (isHolo ? ' holo' : '');
    var tierLabel = isSecret ? 'SECRETA' : (isHolo ? 'HOLOGRÁFICA' : 'RARA');
    return '<button type="button" class="shell-collection-cell' + tierClass + '" data-card-img="' + escapeHtml(entry.img || '') + '">' +
      '<div class="shell-collection-cell-art">' +
        (entry.img ? '<img src="' + entry.img + '" alt="' + escapeHtml(entry.name) + '" loading="lazy">' : '') +
        (isSecret ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' : (isHolo ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '')) +
        '<span class="shell-collection-cell-count">' + t.count + '</span>' +
      '</div>' +
      '<div class="shell-collection-cell-tier">' + tierLabel + '</div>' +
      '</button>';
  }).join('');
  grid.querySelectorAll('.shell-collection-cell').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openCardModal(entry.name, btn.getAttribute('data-card-img'), cellFoilTier(btn));
    });
  });
  document.getElementById('collectionVersionsModal').classList.remove('hidden');
}
function closeCollectionVersionsModal() {
  document.getElementById('collectionVersionsModal').classList.add('hidden');
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
  Secret: { cls: 'secret', label: 'SECRETA' },
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
  var html = '';
  cards.forEach(function (c) {
    // c.img is this exact card's own art (straight from the set that was
    // actually opened) -- NOT the ambiguous CARD_IMAGE_BY_NAME[c.n] lookup,
    // which silently picks a different set's/rarity's reprint for any of
    // the 34 catalog names that aren't unique (see openCardModal's comment).
    // That mismatch is exactly the "opened a Base pack, got a Fossil-art
    // Haunter" bug this fixes.
    var url = c.img || '';
    // c.pulledRarity is the real, server-decided roll (functions/index.js's
    // openBooster, via drawBoosterCards' RARITY_ROLL) for the pack's one
    // Rare/Rare Holo slot -- this reveal has to match what actually got
    // persisted into collectionHolo/collectionSecret, not a separate
    // client-side roll. Uncommons/Commons have no pulledRarity and fall
    // back to their plain catalog rarity.
    var displayRarityKey = c.pulledRarity === 'secret' ? 'Secret'
      : c.pulledRarity === 'holo' ? 'Rare Holo'
      : c.pulledRarity === 'rare' ? 'Rare'
      : c.r;
    var rarity = BOOSTER_RESULT_RARITY[displayRarityKey] || BOOSTER_RESULT_RARITY.Common;
    var foilHtml = rarity.cls === 'secret' ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>'
      : rarity.cls === 'holo' ? '<div class="shell-booster-result-foil"></div>' + holoStarsHtml() : '';
    html += '<div class="shell-booster-result-card ' + rarity.cls + '" data-card-name="' + escapeHtml(c.n) + '" data-card-img="' + escapeHtml(url) + '">' +
      '<div class="shell-booster-result-card-art">' +
        (url ? '<img src="' + url + '" alt="' + escapeHtml(c.n) + '" loading="lazy">' : '') +
        foilHtml +
      '</div>' +
      '<div class="shell-booster-result-card-label">' + rarity.label + '</div>' +
      '</div>';
  });
  document.getElementById('boosterResultGrid').innerHTML = html;
  document.getElementById('boosterResultTitle').innerHTML =
    pixelDigitsHtml(cards.length, 'fosforo', 3) + ' CARTAS NUEVAS';

  document.getElementById('boosterResultModal').classList.remove('hidden');

  document.querySelectorAll('.shell-booster-result-card').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name, el.getAttribute('data-card-img'), cellFoilTier(el)); }
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

// Display-only Spanish type names for Buzzap's (Electrode) type-choice
// modal -- no real card is named just "Colorless Energy", so this doesn't
// piggyback on translateCardName/TRAINER_NAME_ES like every other
// Spanish-text lookup in this game.
var BUZZAP_TYPE_NAME_ES = {
  Grass: 'Planta', Fire: 'Fuego', Water: 'Agua', Lightning: 'Rayo',
  Psychic: 'Psíquico', Fighting: 'Lucha', Colorless: 'Incoloro'
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

// Real display name per deck, uppercase to match the header's styling --
// keyed generically instead of an if/else chain so a future real deck
// doesn't silently fall through to the wrong name (this exact bug: Zap!
// used to render as "OVERGROWTH" here before this map existed, since the
// old check was only ever deckKey==='blackout'?'BLACKOUT':'OVERGROWTH').
var DECK_DISPLAY_NAME = { overgrowth: 'OVERGROWTH', blackout: 'BLACKOUT', zap: 'ZAP!', brushfire: 'BRUSHFIRE' };
function renderDeckDetail(deckKey) {
  var nameEl = document.getElementById('deckDetailName');
  if (nameEl) { nameEl.textContent = DECK_DISPLAY_NAME[deckKey] || deckKey.toUpperCase(); }
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

  // Same real Rare Holo this deck guarantees in an actual match (see
  // DECK_HOLO_CARD/isHoloInMatch) -- keyed by deckKey here instead of
  // ownerId since this screen shows a decklist, not a live gameState side.
  var deckHoloCard = { overgrowth: 'Gyarados', blackout: 'Hitmonchan', zap: 'Mewtwo', brushfire: 'Ninetales' }[deckKey];
  var html = expandDecklist(DECKLISTS[deckKey]).map(function (card) {
    var img = CARD_IMAGE_BY_NAME[card.name] || '';
    var holo = card.name === deckHoloCard;
    return '<div class="shell-deck-slot' + (holo ? ' holo' : '') + '" data-card-name="' + escapeHtml(card.name) + '">' +
      (img ? '<img src="' + img + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' : '') +
      (holo ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '') +
      '</div>';
  }).join('');
  var grid = document.getElementById('deckGrid');
  grid.innerHTML = html;
  grid.querySelectorAll('.shell-deck-slot').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      if (name) { openCardModal(name, null, cellFoilTier(el)); }
    });
  });
}

// Up to 4 saved custom decks per account (see saveCustomDeck,
// functions/index.js) -- fixed slot ids rather than free-form ones, same
// "4 precons, 4 custom slots" symmetry the account-level cap was chosen
// around.
var CUSTOM_DECK_SLOTS = ['custom-1', 'custom-2', 'custom-3', 'custom-4'];

// Mirrors econState.customDecks into the same DECKLISTS/DECK_DISPLAY_NAME
// objects the 4 precons already live in, so every deck-consuming function
// in this codebase (createGame, expandDecklist, deckComposition,
// selectDeckCard, renderDeckDetail, ...) already just works for a custom
// deck with zero further changes -- called once economy.js's onSnapshot
// listener has fresh data. A slot with no saved deck yet is deleted from
// both objects instead of left stale (matters once a "Nuevo Mazo" save
// picks a specific empty slot and this needs to reflect that immediately).
function registerCustomDecks() {
  var saved = (econState && econState.customDecks) || {};
  CUSTOM_DECK_SLOTS.forEach(function (slot) {
    if (saved[slot]) {
      DECKLISTS[slot] = saved[slot].cards;
      DECK_DISPLAY_NAME[slot] = saved[slot].name;
    } else {
      delete DECKLISTS[slot];
      delete DECK_DISPLAY_NAME[slot];
    }
  });
}

// Injects one .shell-deck-card per saved custom deck slot after the prebuilt
// decks. The static "Crear Nuevo Mazo" card stays first in the list -- re-run
// every time the Decks screen is (re)shown, so it always reflects econState.
// Previously-injected cards (marked via data-custom-slot) are removed
// first rather than left to accumulate stale duplicates.
function renderCustomDeckCards() {
  var list = document.querySelector('.shell-decks-list');
  if (!list) { return; }
  list.querySelectorAll('[data-custom-slot]').forEach(function (el) { el.remove(); });
  var listSpacer = list.querySelector('.shell-decks-spacer');
  var saved = (econState && econState.customDecks) || {};
  CUSTOM_DECK_SLOTS.forEach(function (slot) {
    var deck = saved[slot];
    if (!deck) { return; }
    var comp = deckComposition(slot);
    var el = document.createElement('div');
    el.className = 'shell-deck-card';
    el.setAttribute('data-deck', slot);
    el.setAttribute('data-custom-slot', '1');
    el.innerHTML =
      '<div class="shell-deck-card-stripe deck-placeholder"></div>' +
      '<div class="shell-deck-card-art shell-deck-card-art-placeholder">' + escapeHtml((deck.name || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="shell-deck-card-body">' +
        '<div class="shell-deck-card-name">' + escapeHtml(deck.name.toUpperCase()) + '</div>' +
        '<div class="shell-deck-card-types">MAZO PERSONALIZADO</div>' +
        '<div class="shell-deck-card-spacer"></div>' +
        '<div class="shell-deck-card-footer"><span class="shell-deck-card-count">' + comp.total + ' CARTAS</span></div>' +
      '</div>' +
      '<span class="shell-deck-card-badge" style="display:none;">EN USO</span>';
    el.addEventListener('click', function () { selectDeckCard(slot); });
    if (listSpacer) { list.insertBefore(el, listSpacer); } else { list.appendChild(el); }
  });
}

// Selects deckKey (any real DECKLISTS key -- the 4 precons or a saved
// 'custom-N' slot) as the deck previewed/marked "EN USO" on the Decks
// screen -- moves the .active class + badge between every real, selectable
// shell-deck-card element instead of duplicating them, and refreshes the
// decklist preview to match. Filters by DECKLISTS (not a hardcoded list of
// data-deck values) so a future real deck added the same way this file's
// other multi-deck logic already works (see createGame, rules-engine.js)
// doesn't also need this selector updated -- only the still-unplayable
// "Nuevo Mazo" card (data-deck="new", no real decklist behind it) is
// excluded.
function selectDeckCard(deckKey) {
  document.querySelectorAll('.shell-deck-card[data-deck]').forEach(function (el) {
    var elDeckKey = el.getAttribute('data-deck');
    if (!DECKLISTS[elDeckKey]) { return; }
    var isSelected = elDeckKey === deckKey;
    el.classList.toggle('active', isSelected);
    var badge = el.querySelector('.shell-deck-card-badge');
    if (badge) { badge.style.display = isSelected ? '' : 'none'; }
  });
  renderDeckDetail(deckKey);
  // EDITAR only ever applies to a custom deck the player actually saved --
  // DUPLICAR (see its own click handler) works on any deck, precon or
  // custom, so it stays enabled unconditionally.
  var editBtn = document.getElementById('deckEditBtn');
  if (editBtn) {
    var saved = (econState && econState.customDecks) || {};
    editBtn.disabled = !(CUSTOM_DECK_SLOTS.indexOf(deckKey) !== -1 && saved[deckKey]);
  }
}

function showDecksScreen() {
  // Idempotent and cheap -- called again here (not just from economy.js's
  // onSnapshot listener) so DECKLISTS/DECK_DISPLAY_NAME are guaranteed to
  // already reflect econState.customDecks before renderCustomDeckCards/
  // selectDeckCard below ever touch a 'custom-N' key, regardless of
  // whether the snapshot callback has fired yet at this exact moment.
  registerCustomDecks();
  renderCustomDeckCards();
  selectDeckCard((econState && econState.activeDeck) || 'overgrowth');
  document.getElementById('decksSaveStatus').textContent = '';
  document.getElementById('decksSaveStatus').className = 'shell-decks-save-status';
  document.getElementById('decksScreen').classList.remove('hidden');
}
function hideDecksScreen() {
  document.getElementById('decksScreen').classList.add('hidden');
}

// ── Deck Builder (Fase 4: mazos personalizados) ───────────────────────
// Real 1999 Base Set deck-construction rules, mirrored client-side purely
// for responsive UI feedback (add/remove buttons enable/disable live) --
// the server (saveCustomDeck, functions/index.js) re-validates everything
// independently and is the actual source of truth, same as every other
// write in this game.
var DECK_BUILDER_SIZE = 60;
var DECK_BUILDER_MAX_COPIES = 4;
var DECK_BUILDER_BASIC_ENERGY = ['Grass Energy', 'Fire Energy', 'Water Energy', 'Lightning Energy', 'Psychic Energy', 'Fighting Energy'];

// {cardName: totalOwnedCount}, aggregated across every set/tier -- deck-
// building rules are name-based, not print-based (see ownedCountsByName,
// functions/lib/pureEconomy.js, the server-side equivalent of this).
function ownedCountsByNameClient() {
  var owned = {};
  if (!econState) { return owned; }
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    CARD_CATALOG[setKey].forEach(function (c) {
      var count = econState.collection[setKey + '-' + c.num] || 0;
      if (count > 0) { owned[c.n] = (owned[c.n] || 0) + count; }
    });
  });
  return owned;
}

// {cardName: {total: N, tiers: [{count, holo, secret}]}} -- per-name tier
// breakdown so the deck builder pool can show foil indicators and the
// version modal can offer tier-specific adds. Aggregates across every set.
function ownedTiersByNameClient() {
  var result = {};
  if (!econState) { return result; }
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    CARD_CATALOG[setKey].forEach(function (c) {
      var key = setKey + '-' + c.num;
      var total = econState.collection[key] || 0;
      if (total <= 0) { return; }
      var secretCount = (econState.collectionSecret[key] || 0);
      var holoCount = (econState.collectionHolo[key] || 0);
      var plainCount = total - secretCount - holoCount;
      if (!result[c.n]) { result[c.n] = { total: 0, tiers: [] }; }
      result[c.n].total += total;
      if (plainCount > 0) { result[c.n].tiers.push({ count: plainCount, holo: false, secret: false }); }
      if (holoCount > 0) { result[c.n].tiers.push({ count: holoCount, holo: true, secret: false }); }
      if (secretCount > 0) { result[c.n].tiers.push({ count: secretCount, holo: false, secret: true }); }
    });
  });
  return result;
}

// null (new deck, no slot chosen yet), or one of CUSTOM_DECK_SLOTS while
// editing/saving-over an existing one. cards is {name: count} (a plain map
// is far more convenient to mutate one +1/-1 at a time than an array) --
// only ever converted to the real [{name,count}] array shape right before
// calling saveCustomDeckCloud. tiers is {cardName: {holo, secret}} tracking
// which tier variant the user chose for each card name in the deck.
var deckBuilderState = null;

// initialCards: [{name, count}] (a precon's DECKLISTS entry, an existing
// custom deck's saved cards, or [] for a blank "Nuevo Mazo"). slot: null or
// an existing 'custom-N' (EDITAR only -- DUPLICAR always passes null, even
// when duplicating an existing custom deck, since that's still a NEW deck).
function showDeckBuilderScreen(initialCards, slot, initialName) {
  var cards = {};
  (initialCards || []).forEach(function (c) { cards[c.name] = c.count; });
  deckBuilderState = { slot: slot, cards: cards, tiers: {}, search: '' };
  document.getElementById('deckBuilderName').value = initialName || '';
  document.getElementById('deckBuilderSearch').value = '';
  hideDecksScreen();
  document.getElementById('deckBuilderScreen').classList.remove('hidden');
  renderDeckBuilderScreen();
}
function hideDeckBuilderScreen() {
  document.getElementById('deckBuilderScreen').classList.add('hidden');
  deckBuilderState = null;
}

// Opens a version-picker modal for a card with 2+ owned tiers. Each tier
// is a clickable .shell-collection-cell showing that tier's art + foil +
// count. Clicking one adds the card to the deck with that specific tier
// chosen (tracked in deckBuilderState.tiers[name] for display purposes).
function openDeckBuilderVersionModal(cardName, tiers) {
  document.getElementById('deckBuilderVersionTitle').textContent = translateCardName(cardName);
  var img = CARD_IMAGE_BY_NAME[cardName] || '';
  var grid = document.getElementById('deckBuilderVersionGrid');
  grid.innerHTML = tiers.map(function (t) {
    var isSecret = t.secret;
    var isHolo = t.holo && !isSecret;
    var tierClass = isSecret ? ' secret' : (isHolo ? ' holo' : '');
    var tierLabel = isSecret ? 'SECRETA' : (isHolo ? 'HOLOGRÁFICA' : 'RARA');
    var tierCls = isSecret ? ' secret' : (isHolo ? ' holo' : '');
    return '<div class="shell-collection-cell' + tierClass + '" data-tier-holo="' + (isHolo ? '1' : '0') + '" data-tier-secret="' + (isSecret ? '1' : '0') + '">' +
      '<div class="shell-collection-cell-art">' +
        (img ? '<img src="' + img + '" alt="' + escapeHtml(cardName) + '" loading="lazy">' : '') +
        (isSecret ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' : (isHolo ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '')) +
        '<span class="shell-collection-cell-count">' + t.count + '</span>' +
      '</div>' +
      '<div class="shell-deck-builder-versions-tier' + tierCls + '">' + tierLabel + '</div>' +
      '</div>';
  }).join('');
  grid.querySelectorAll('.shell-collection-cell').forEach(function (el) {
    el.addEventListener('click', function () {
      var isHolo = el.getAttribute('data-tier-holo') === '1';
      var isSecret = el.getAttribute('data-tier-secret') === '1';
      deckBuilderState.cards[cardName] = (deckBuilderState.cards[cardName] || 0) + 1;
      deckBuilderState.tiers[cardName] = { holo: isHolo, secret: isSecret };
      closeDeckBuilderVersionModal();
      renderDeckBuilderScreen();
    });
  });
  document.getElementById('deckBuilderVersionModal').classList.remove('hidden');
}
function closeDeckBuilderVersionModal() {
  document.getElementById('deckBuilderVersionModal').classList.add('hidden');
}

function deckBuilderTotal() {
  var total = 0;
  Object.keys(deckBuilderState.cards).forEach(function (name) { total += deckBuilderState.cards[name]; });
  return total;
}

function deckBuilderHasBasicPokemon() {
  return Object.keys(deckBuilderState.cards).some(function (name) {
    var stats = CARD_STATS[name];
    return stats && stats.supertype === 'Pokémon' && !stats.evolvesFrom;
  });
}

function renderDeckBuilderScreen() {
  var s = deckBuilderState;
  var total = deckBuilderTotal();
  document.getElementById('deckBuilderCount').textContent = total + '/' + DECK_BUILDER_SIZE + ' CARTAS';

  var tierData = ownedTiersByNameClient();
  var search = s.search.toLowerCase();
  var poolNames = Object.keys(tierData).filter(function (name) {
    if (!CARD_STATS[name]) { return false; }
    if (search && translateCardName(name).toLowerCase().indexOf(search) === -1) { return false; }
    return true;
  }).sort(function (a, b) { return translateCardName(a).localeCompare(translateCardName(b)); });

  var poolHtml = poolNames.map(function (name) {
    var info = tierData[name];
    var have = info.total;
    var inDeck = s.cards[name] || 0;
    var isBasicEnergy = DECK_BUILDER_BASIC_ENERGY.indexOf(name) !== -1;
    var cap = isBasicEnergy ? have : Math.min(have, DECK_BUILDER_MAX_COPIES);
    var atCap = inDeck >= cap || total >= DECK_BUILDER_SIZE;
    var img = CARD_IMAGE_BY_NAME[name] || '';
    var tiers = info.tiers;
    var hasMultiTier = tiers.length > 1;
    var highestTier = tiers.reduce(function (best, t) {
      if (t.secret) return 'secret';
      if (t.holo && best !== 'secret') return 'holo';
      return best;
    }, 'plain');
    var tierClass = highestTier !== 'plain' ? ' ' + highestTier : '';
    var tierBadge = '';
    if (hasMultiTier) {
      var badgeCls = highestTier !== 'plain' ? ' ' + highestTier : '';
      tierBadge = '<span class="shell-deck-builder-tier-badge' + badgeCls + '">' + tiers.length + ' VERS.</span>';
    }
    return '<div class="shell-collection-cell' + (atCap ? ' at-cap' : '') + tierClass + '" data-card-name="' + escapeHtml(name) + '" data-multi-tier="' + (hasMultiTier ? '1' : '0') + '">' +
      '<div class="shell-collection-cell-art">' +
        (img ? '<img src="' + img + '" alt="' + escapeHtml(name) + '" loading="lazy">' : '') +
        (inDeck > 0 ? '<span class="shell-deck-builder-cell-indeck">' + inDeck + '</span>' : '') +
        '<span class="shell-collection-cell-count">' + have + '</span>' +
        tierBadge +
      '</div>' +
      '<div class="shell-collection-cell-num">' + escapeHtml(translateCardName(name)) + '</div>' +
      '</div>';
  }).join('');
  var poolGrid = document.getElementById('deckBuilderPoolGrid');
  poolGrid.innerHTML = poolHtml || '<div class="shell-collection-empty">SIN RESULTADOS</div>';
  poolGrid.querySelectorAll('.shell-collection-cell:not(.at-cap)').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      var isMultiTier = el.getAttribute('data-multi-tier') === '1';
      if (isMultiTier) {
        openDeckBuilderVersionModal(name, tierData[name].tiers);
      } else {
        s.cards[name] = (s.cards[name] || 0) + 1;
        var onlyTier = tierData[name].tiers[0];
        if (onlyTier) { s.tiers[name] = { holo: !!onlyTier.holo, secret: !!onlyTier.secret }; }
        renderDeckBuilderScreen();
      }
    });
  });

  var deckNames = Object.keys(s.cards).filter(function (name) { return s.cards[name] > 0; })
    .sort(function (a, b) { return translateCardName(a).localeCompare(translateCardName(b)); });
  var listHtml = deckNames.map(function (name) {
    var t = s.tiers[name];
    var rowCls = t ? (t.secret ? ' secret' : (t.holo ? ' holo' : '')) : '';
    var tierLabel = '';
    if (t) {
      var tierText = t.secret ? 'SECRETA' : (t.holo ? 'HOLOGRÁFICA' : '');
      if (tierText) { tierLabel = '<span class="shell-deck-builder-list-row-tier' + (t.secret ? ' secret' : ' holo') + '">' + tierText + '</span>'; }
    }
    return '<div class="shell-deck-builder-list-row' + rowCls + '" data-card-name="' + escapeHtml(name) + '">' +
      '<span class="shell-deck-builder-list-row-name">' + escapeHtml(translateCardName(name)) + '</span>' +
      tierLabel +
      '<span class="shell-deck-builder-list-row-count">×' + s.cards[name] + '</span>' +
      '</div>';
  }).join('');
  var listGrid = document.getElementById('deckBuilderListGrid');
  listGrid.innerHTML = listHtml || '<div class="shell-deck-builder-list-empty">Todavía no agregaste ninguna carta.</div>';
  listGrid.querySelectorAll('.shell-deck-builder-list-row').forEach(function (el) {
    el.addEventListener('click', function () {
      var name = el.getAttribute('data-card-name');
      s.cards[name] = Math.max(0, (s.cards[name] || 0) - 1);
      if (s.cards[name] === 0) { delete s.cards[name]; delete s.tiers[name]; }
      renderDeckBuilderScreen();
    });
  });

  var status = document.getElementById('deckBuilderStatus');
  var saveBtn = document.getElementById('deckBuilderSaveBtn');
  if (total < DECK_BUILDER_SIZE) {
    status.textContent = 'Te faltan ' + (DECK_BUILDER_SIZE - total) + ' cartas para llegar a 60.';
    saveBtn.disabled = true;
  } else if (total > DECK_BUILDER_SIZE) {
    status.textContent = 'Tienes ' + (total - DECK_BUILDER_SIZE) + ' cartas de más -- un mazo real es de exactamente 60.';
    saveBtn.disabled = true;
  } else if (!deckBuilderHasBasicPokemon()) {
    status.textContent = 'Necesitas al menos 1 Pokémon Básico para poder empezar una partida.';
    saveBtn.disabled = true;
  } else {
    status.textContent = '¡Mazo listo para guardar!';
    saveBtn.disabled = false;
  }
}

// Picks which of the 4 slots a brand-new (slot === null) deck gets saved
// to: the first empty one, or -- if all 4 are already used -- asks the
// player which existing custom deck to overwrite (reusing the same
// generic one-click picker Pokémon Powers already uses for "which
// Pokémon's Power").
function chooseSlotForNewDeckThen(onChosen) {
  var saved = (econState && econState.customDecks) || {};
  var emptySlot = CUSTOM_DECK_SLOTS.find(function (slot) { return !saved[slot]; });
  if (emptySlot) { onChosen(emptySlot); return; }
  var options = CUSTOM_DECK_SLOTS.map(function (slot) {
    return { id: slot, label: saved[slot].name + ' (se reemplazará)' };
  });
  openChoicePickerModal('Ya tienes 4 mazos guardados -- ¿cuál quieres reemplazar?', options, onChosen);
}

function saveDeckBuilderState() {
  var name = document.getElementById('deckBuilderName').value.trim().slice(0, 30) || 'Mi Mazo';
  var cards = Object.keys(deckBuilderState.cards).map(function (n) { return { name: n, count: deckBuilderState.cards[n] }; });
  var status = document.getElementById('deckBuilderStatus');
  var saveBtn = document.getElementById('deckBuilderSaveBtn');

  function doSave(slot) {
    saveBtn.disabled = true;
    status.textContent = 'GUARDANDO...';
    saveCustomDeckCloud(slot, name, cards)
      .then(function () {
        if (econState) {
          econState.customDecks = Object.assign({}, econState.customDecks);
          econState.customDecks[slot] = { name: name, cards: cards };
        }
        registerCustomDecks();
        hideDeckBuilderScreen();
        showDecksScreen();
        selectDeckCard(slot);
      })
      .catch(function (e) {
        saveBtn.disabled = false;
        status.textContent = (e && e.message) || 'No se pudo guardar. Intenta de nuevo.';
      });
  }

  if (deckBuilderState.slot) { doSave(deckBuilderState.slot); } else { chooseSlotForNewDeckThen(doSave); }
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
  pkmntcg_duel: { label: 'Duel', file: 'Songs/Pokemon_TCG.mp3' },
  pkmntcg_club: { label: 'Club Master Duel', file: 'Songs/14 Club Master Duel.mp3' },
  pkmntcg_ronald: { label: 'Ronald', file: "Songs/16 Ronald's Theme.mp3" },
  pkmntcg_grand: { label: 'Gran Master Duel', file: 'Songs/20 Grand Master Duel.mp3' },
  pkmntcg_imakuni: { label: 'Imakuni', file: "Songs/17. Imakuni_'s Theme.mp3" },
  ygofbm_free: { label: 'Free Duel', file: 'Songs/Yugioh_Free_Duel.mp3' },
  ygofbm_prelim: { label: 'Preliminar', file: 'Songs/Yugioh_Preliminares.mp3' },
  ygodlk_tag: { label: 'Tag Duel', file: 'Songs/Ygodlk - Tag Duel.mp3' },
  ygomsd_duel: { label: 'Duel', file: 'Songs/YGOMSD - Duel.mp3' }
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

// 'easy' (default, unchanged from before difficulty tiers existed), 'normal',
// or 'hard' -- see ai.js's cpuTakeTurn. Kept in this browser only
// (localStorage), same as the rest of Configuración's settings.
var CPU_THINK_DELAY_MS = { easy: 0, normal: [1000, 2000], hard: [2000, 5000] };
// A short "beat" held after the CPU's turn resolves (and any Trainer-play
// flashes finish) before the real result -- attack damage, a KO, a forced
// Active choice -- actually renders. Applies to every difficulty, even
// Easy: without it, a turn with no Trainer played (just energy + attack +
// KO) still jumped straight from "TURNO DEL RIVAL" to the final board with
// zero pacing, which read as instant and hard to follow.
var CPU_POST_ACTION_PAUSE_MS = 700;
function getCpuDifficulty() {
  var v = localStorage.getItem('tcg_cpu_difficulty');
  return (v === 'normal' || v === 'hard') ? v : 'easy';
}
function setCpuDifficulty(v) {
  if (v !== 'easy' && v !== 'normal' && v !== 'hard') { return; }
  try { localStorage.setItem('tcg_cpu_difficulty', v); } catch (e) {}
}
function renderCpuDifficultyControl() {
  var current = getCpuDifficulty();
  document.querySelectorAll('#cpuDifficultyControl [data-difficulty]').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-difficulty') === current);
  });
}
// A random delay within the difficulty's range, so the CPU doesn't "think"
// for a suspiciously identical amount of time every single turn.
function cpuThinkDelayMs(difficulty) {
  var range = CPU_THINK_DELAY_MS[difficulty] || 0;
  if (typeof range === 'number') { return range; }
  return Math.round(range[0] + Math.random() * (range[1] - range[0]));
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
  renderCpuDifficultyControl();
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
  // As early as possible -- see preloadCardImages' own comment -- so the
  // browser has as much lead time as it can get before a real match or the
  // Collection screen ever starts needing these images.
  preloadCardImages();

  // Theme init
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('tcg_theme'); } catch (e) {}
  applyTheme(savedTheme !== 'light');

  applyMenuLogo();
  layoutShellStages();
  window.addEventListener('resize', layoutShellStages);

  // Clicking anywhere outside the Trainer mini-menu (or its own hand card,
  // which handles closing it another way) closes it -- wired
  // once here, not inside wireBoardButtons(), since that reruns on every
  // renderBoard() and would otherwise stack up a fresh listener each time.
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('handCardMenu');
    if (!menu || menu.classList.contains('hidden')) { return; }
    if (menu.contains(e.target) || e.target.closest('.shell-board-hand-card-wrap')) { return; }
    hideHandCardMenu();
  });

  // News panel dates -- static placeholder content (no real feed exists
  // yet), so a one-time pass at load is enough; a live feed would call this
  // again after replacing the list's HTML.
  document.querySelectorAll('.shell-news-item-day').forEach(function (el) {
    el.innerHTML = pixelDigitsHtml(el.textContent.trim(), 'plata', 2);
  });

  // Static coin-icon spots (menu balance, shop header, booster modal price) --
  // replaced once here with the pixel-glyph coin; the shop-card and board-
  // footer coins are rendered per-instance in their own template strings
  // since those elements get rebuilt on every render. Sized to match each
  // spot's own balance/price digits right next to it (menuCoinCount/
  // shopCoinBalance render at blockPx 3, boosterModalPrice at 2) -- these
  // used to all share blockPx 2 regardless, so the icon read visibly
  // smaller than its own number in the two bigger spots.
  document.querySelectorAll('.shell-player-coin, .shell-page-coin-dot').forEach(function (el) {
    el.innerHTML = pixelCoinHtml('oro', 3);
  });
  document.querySelectorAll('.shell-shop-coin').forEach(function (el) {
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
  document.querySelectorAll('.shell-deck-card[data-deck]').forEach(function (el) {
    var elDeckKey = el.getAttribute('data-deck');
    if (!DECKLISTS[elDeckKey]) { return; }
    el.addEventListener('click', function () {
      selectDeckCard(elDeckKey);
    });
  });
  document.getElementById('deckNewCard').addEventListener('click', function () {
    showDeckBuilderScreen([], null, '');
  });
  document.getElementById('deckNewCard').addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') { return; }
    event.preventDefault();
    showDeckBuilderScreen([], null, '');
  });
  document.getElementById('deckEditBtn').addEventListener('click', function () {
    var selectedCard = document.querySelector('.shell-deck-card.active[data-deck]');
    var deckKey = selectedCard && selectedCard.getAttribute('data-deck');
    var saved = (econState && econState.customDecks) || {};
    if (!deckKey || !saved[deckKey]) { return; }
    showDeckBuilderScreen(saved[deckKey].cards, deckKey, saved[deckKey].name);
  });
  document.getElementById('deckDuplicateBtn').addEventListener('click', function () {
    var selectedCard = document.querySelector('.shell-deck-card.active[data-deck]');
    var deckKey = (selectedCard && selectedCard.getAttribute('data-deck')) || 'overgrowth';
    if (!DECKLISTS[deckKey]) { return; }
    var baseName = DECK_DISPLAY_NAME[deckKey] || deckKey;
    showDeckBuilderScreen(DECKLISTS[deckKey], null, baseName + ' (Copia)');
  });
  document.getElementById('deckBuilderBackBtn').addEventListener('click', function () {
    hideDeckBuilderScreen();
    showDecksScreen();
  });
  document.getElementById('deckBuilderSaveBtn').addEventListener('click', function () {
    saveDeckBuilderState();
  });
  document.getElementById('deckBuilderSearch').addEventListener('input', function () {
    if (!deckBuilderState) { return; }
    deckBuilderState.search = this.value;
    renderDeckBuilderScreen();
  });
  document.getElementById('deckBuilderVersionClose').addEventListener('click', function () {
    closeDeckBuilderVersionModal();
  });
  document.getElementById('decksSaveBtn').addEventListener('click', function () {
    var btn = document.getElementById('decksSaveBtn');
    var status = document.getElementById('decksSaveStatus');
    var selectedCard = document.querySelector('.shell-deck-card.active[data-deck]');
    var deckKey = (selectedCard && selectedCard.getAttribute('data-deck')) || 'overgrowth';
    btn.disabled = true;
    status.className = 'shell-decks-save-status';
    status.textContent = 'GUARDANDO...';
    updateActiveDeckCloud(deckKey)
      .then(function () {
        if (econState) { econState.activeDeck = deckKey; }
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
  document.querySelectorAll('#cpuDifficultyControl [data-difficulty]').forEach(function (el) {
    el.addEventListener('click', function () {
      setCpuDifficulty(el.getAttribute('data-difficulty'));
      renderCpuDifficultyControl();
    });
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

  document.getElementById('collectionVersionsClose').addEventListener('click', closeCollectionVersionsModal);
  document.querySelector('#collectionVersionsModal .card-modal-backdrop').addEventListener('click', closeCollectionVersionsModal);

  document.querySelector('#deckBuilderVersionModal .card-modal-backdrop').addEventListener('click', closeDeckBuilderVersionModal);

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

  document.getElementById('targetHintOkBtn').addEventListener('click', closeTargetHintModal);
  document.querySelector('#targetHintModal .card-modal-backdrop').addEventListener('click', closeTargetHintModal);

  document.getElementById('deckSearchCancel').addEventListener('click', closeDeckSearchModal);
  document.querySelector('#deckSearchModal .card-modal-backdrop').addEventListener('click', closeDeckSearchModal);

  document.getElementById('choicePickerCancel').addEventListener('click', closeChoicePickerModal);
  document.querySelector('#choicePickerModal .card-modal-backdrop').addEventListener('click', closeChoicePickerModal);

  document.getElementById('pokedexCancel').addEventListener('click', closePokedexModal);
  document.querySelector('#pokedexModal .card-modal-backdrop').addEventListener('click', closePokedexModal);
  document.getElementById('pokedexConfirm').addEventListener('click', function () {
    var s = pokedexState;
    if (!s || s.order.length !== s.cards.length) { return; }
    var orderedIds = s.order.slice();
    var onConfirm = s.onConfirm;
    closePokedexModal();
    onConfirm(orderedIds);
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

  document.getElementById('handDiscardCancel').addEventListener('click', closeHandDiscardModal);
  document.querySelector('#handDiscardModal .card-modal-backdrop').addEventListener('click', closeHandDiscardModal);
  document.getElementById('handDiscardConfirm').addEventListener('click', function () {
    var s = handDiscardState;
    if (!s || s.selected.length !== s.count) { return; }
    var ids = s.selected.slice();
    var onConfirm = s.onConfirm;
    closeHandDiscardModal();
    onConfirm(ids);
  });

  document.getElementById('energyRetrievalCancel').addEventListener('click', closeEnergyRetrievalModal);
  document.querySelector('#energyRetrievalModal .card-modal-backdrop').addEventListener('click', closeEnergyRetrievalModal);
  document.getElementById('energyRetrievalConfirm').addEventListener('click', function () {
    var s = energyRetrievalState;
    if (!s) { return; }
    var ids = s.selected.slice();
    var onConfirm = s.onConfirm;
    closeEnergyRetrievalModal();
    onConfirm(ids);
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
