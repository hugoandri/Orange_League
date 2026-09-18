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

// True from the moment an attack (or the CPU's whole reveal sequence) starts
// playing out on screen until afterPlayerAction() actually runs. tickGameClock
// (below) polls getWinner() every 250ms independent of any animation -- since
// attack() already mutates gameState synchronously (before the ~2.2s overlay
// even shows), that poll used to catch a match-ending KO and pop "Has Ganado"/
// "Has Perdido" while the attack overlay was still mid-animation. This flag
// makes tickGameClock hold off until the reveal actually finishes.
var revealAnimationInProgress = false;
var visualActivePokemon = null;

// True from the moment the CPU's OWN turn starts revealing what it did
// (proceedWithCpuTurn, right after cpuTakeTurn() itself finishes) until
// afterPlayerAction() runs -- unlike revealAnimationInProgress (which is
// ALSO true during the PLAYER's own attack reveal), this is only ever true
// for the CPU's side, so renderBoard's header can tell the two apart:
// "TURNO CPU" while this is true, "TU TURNO" the rest of the time
// (including during the player's own attack reveal, and the narrow window
// right after the player's own attack silently ended their turn but before
// they've clicked "Terminar Turno" -- see that branch's own comment).
var cpuTurnRevealInProgress = false;

// Menu's "Novedades" panel (see initNewsListener, economy.js, and
// admin.html for how items actually get published). items: [{id, title,
// body, tag, featured, createdAt}], newest first. The most recently
// published item marked featured wins the DESTACADO slot; if none are
// marked, the single newest item overall fills it instead (the panel
// always shows something there rather than an empty box) and is excluded
// from the regular list below it.
var NEWS_MONTH_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
var NEWS_TAG_LABEL = { balance: 'EQUILIBRIO', shop: 'TIENDA', notice: 'AVISO', gift: 'REGALO' };
// Kept up to date on every news snapshot regardless of whether the Novedades
// panel is even visible right now -- the Tienda's "PACK GRATIS" slot
// (renderShopScreen) and its modal (openGiftBoosterModal) both read this
// directly, since a player can have pending gift boosters without ever
// having opened Novedades this session.
var latestNewsItems = [];
// 'booster' (a real base/jungle/fossil set) and 'custompack' (an admin-
// curated customPacks/{packId}, see admin.html's "Packs" tab) both share the
// claim-then-open split: "Reclamar" in Novedades (claimNewsGiftCloud) only
// registers the claim, it doesn't draw anything -- the pack then shows up
// here, in the Tienda's "PACK GRATIS" slot, until the player actually opens
// it (openClaimedGiftCloud). A 'card' gift has no randomness to defer, so
// it's granted the instant it's claimed and never appears in this list.
function isGiftPackKind(gift) {
  return gift && (gift.kind === 'booster' || gift.kind === 'custompack');
}

// Merges the two sources a pending-to-open pack can come from -- a news
// gift (claimed via Novedades, tracked per-newsId) and a redeemed code
// (Configuración's "Canjear código", tracked in econState.pendingCodePacks,
// see redeemGiftCodeCloud) -- into one normalized list the Tienda's "PACK
// GRATIS" slot/modal can render without caring which source it came from.
function pendingGiftBoosters() {
  var fromNews = latestNewsItems
    .filter(function (it) { return isGiftPackKind(it.gift) && it.claimed && !it.opened; })
    .map(function (it) { return { source: 'news', id: it.id, gift: it.gift, label: it.title }; });
  var pendingCodes = (econState && econState.pendingCodePacks) ? econState.pendingCodePacks : [];
  var fromCodes = pendingCodes.map(function (p) {
    return { source: 'code', id: p.code, gift: p.gift, label: 'Código ' + p.code };
  });
  return fromNews.concat(fromCodes);
}

// {name, art} for either a real set's booster or a custom pack, wherever a
// pending gift pack needs to show itself (Tienda's "PACK GRATIS" card, its
// modal's per-row listing).
function giftPackDisplay(gift) {
  if (gift.kind === 'booster') {
    return { name: 'PACK ' + (BOOSTER_NAMES[gift.setKey] || gift.setKey).toUpperCase(), art: BOOSTER_PACKS[gift.setKey][0] };
  }
  var pack = customPacksCache[gift.packId];
  return {
    name: (pack && pack.name) ? pack.name.toUpperCase() : 'PACK ESPECIAL',
    art: (pack && pack.art && pack.art[0]) || ''
  };
}

function renderNewsPanel(items) {
  latestNewsItems = items;
  var badge = document.getElementById('newsBadge');
  var featuredEl = document.getElementById('newsFeatured');
  var listEl = document.getElementById('newsList');
  if (!badge || !featuredEl || !listEl) { return; }

  badge.textContent = items.length + (items.length === 1 ? ' NUEVA' : ' NUEVAS');

  var featured = items.filter(function (it) { return it.featured; })[0] || items[0] || null;

  if (featured) {
    var fd = featured.createdAt;
    var dateStr = fd.getDate() + ' ' + NEWS_MONTH_ES[fd.getMonth()] + ' ' + fd.getFullYear();
    featuredEl.innerHTML =
      '<div class="shell-news-featured-meta">' +
        '<span class="shell-news-chip-featured">DESTACADO</span>' +
        (featured.gift ? '<span class="shell-news-chip-gift">REGALO</span>' : '') +
        '<span class="shell-news-featured-date">' + escapeHtml(dateStr) + '</span>' +
      '</div>' +
      '<div class="shell-news-featured-title">' + escapeHtml(featured.title) + '</div>' +
      '<div class="shell-news-featured-body">' + escapeHtml(featured.body) + '</div>' +
      newsGiftButtonHtml(featured);
  } else {
    featuredEl.innerHTML = '';
  }

  var rest = featured ? items.filter(function (it) { return it.id !== featured.id; }).slice(0, 5) : [];
  listEl.innerHTML = rest.length
    ? rest.map(function (it, i) {
        var d = it.createdAt;
        var tagLabel = NEWS_TAG_LABEL[it.tag] || '';
        return '<div class="shell-news-item' + (i === rest.length - 1 ? ' shell-news-item-last' : '') + '">' +
          '<div class="shell-news-item-date"><span class="shell-news-item-day">' + d.getDate() + '</span><span class="shell-news-item-month">' + NEWS_MONTH_ES[d.getMonth()] + '</span></div>' +
          '<div class="shell-news-item-body">' +
            '<div class="shell-news-item-title">' + escapeHtml(it.title) + '</div>' +
            '<div class="shell-news-item-summary">' + escapeHtml(it.body) + '</div>' +
            newsGiftButtonHtml(it) +
          '</div>' +
          // A "REGALO" category tag already says it -- only add the
          // automatic chip when the admin picked some OTHER category, so a
          // gift-tagged post never shows "REGALO" twice.
          (it.gift && it.tag !== 'gift' ? '<span class="shell-news-item-tag shell-news-item-tag--gift">REGALO</span>' : '') +
          (tagLabel ? '<span class="shell-news-item-tag shell-news-item-tag--' + escapeHtml(it.tag) + '">' + tagLabel + '</span>' : '') +
          '</div>';
      }).join('')
    : (featured ? '' : '<div class="shell-news-empty">Sin novedades todavía.</div>');

  wireNewsGiftButtons(items);
}

function newsGiftButtonHtml(it) {
  if (!it.gift) { return ''; }
  // While the claim check (economy.js's initNewsListener) is still in
  // flight -- right after a fresh page load, before it knows whether this
  // player already claimed it -- show the same muted state as "RECLAMADO"
  // instead of "RECLAMAR", so an already-claimed gift never flashes as
  // reclaimable for the brief window before the real answer arrives.
  if (!it.claimChecked) { return '<button type="button" class="shell-news-gift-btn claimed" disabled>REVISANDO…</button>'; }
  if (it.claimed) { return '<button type="button" class="shell-news-gift-btn claimed" disabled>RECLAMADO</button>'; }
  return '<button type="button" class="shell-news-gift-btn" data-news-gift-id="' + escapeHtml(it.id) + '">🎁 RECLAMAR</button>';
}

function wireNewsGiftButtons(items) {
  document.querySelectorAll('[data-news-gift-id]').forEach(function (btn) {
    var id = btn.getAttribute('data-news-gift-id');
    var item = items.filter(function (it) { return it.id === id; })[0];
    if (!item) { return; }
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'RECLAMANDO…';
      claimNewsGiftCloud(id).then(function (result) {
        item.claimed = true;
        item.opened = result.opened;
        // Only a 'card' gift comes back already opened (real cards to
        // reveal) -- a 'booster'/'custompack' gift is just registered as
        // claimed here, with nothing drawn yet (see claimNewsGift), so
        // there's nothing to reveal until it's opened from the Tienda.
        if (result.opened) { showBoosterResult(result.cards, item.gift.setKey || item.gift.packId); }
        btn.textContent = 'RECLAMADO';
        btn.classList.add('claimed');
        // Keeps the Tienda's "PACK GRATIS" slot (where a claimed-but-
        // unopened pack becomes available to open, see renderShopScreen/
        // openGiftBoosterModal) in sync in case that screen is open behind
        // this one -- a no-op if it isn't (renderShopScreen bails out when
        // its grid isn't in the DOM).
        renderShopScreen();
      }).catch(function (err) {
        if (err && err.code === 'functions/already-exists') {
          item.claimed = true;
          btn.textContent = 'RECLAMADO';
          btn.classList.add('claimed');
        } else {
          alert(err.message || 'No se pudo reclamar el regalo.');
          btn.disabled = false;
          btn.textContent = '🎁 RECLAMAR';
        }
      });
    });
  });
}

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
  var menuUidEl = document.getElementById('menuUserUid');
  if (menuUidEl) {
    var uidVal = (profileState && profileState.uid) || (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) || '';
    if (uidVal) { menuUidEl.textContent = uidVal; }
  }

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
// 'player' always reads the LIVE local choice (getCardBackId()), even in
// PVP, so changing it in Configuración mid-match updates my own view
// instantly instead of waiting on a round-trip. The local CPU bot never
// has a real equipped protector, so its cards stay the fixed default --
// but a real PVP rival does: pvpOpponentCardBackId (set by
// buildPvpGameState from pub.hostCardBackId/guestCardBackId, captured
// server-side at room create/join time -- functions/index.js) carries
// their own real choice, per user request that protectors be visible to
// the opponent instead of always forced to the default.
function cardBackUrlFor(ownerId) {
  if (ownerId === 'player') {
    var mine = CARD_BACK_OPTIONS.filter(function (o) { return o.id === getCardBackId(); })[0];
    return mine ? mine.img : CARD_BACK_URL;
  }
  if (pvpMode && pvpOpponentCardBackId) {
    var theirs = CARD_BACK_OPTIONS.filter(function (o) { return o.id === pvpOpponentCardBackId; })[0];
    return theirs ? theirs.img : CARD_BACK_URL;
  }
  return CARD_BACK_URL;
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
// Every real catalog set, in this exact order -- 'base' first is what
// guarantees Base Set art wins in CARD_IMAGE_BY_NAME's first-wins lookup
// below (see that comment); basep/espromo (Wizards Black Star Promos +
// Special Promos, gift-only, never sold as boosters -- see renderShopScreen,
// which deliberately keeps its own literal ['base','jungle','fossil'] list
// instead of using this one) are appended last so they only ever fill in
// names the 3 real sets don't already cover.
var CARD_SET_KEYS = ['base', 'jungle', 'fossil', 'basep', 'espromo'];

var CARD_IMAGE_BY_NAME = {};
var CARD_SUPERTYPE_BY_NAME = {};
CARD_SET_KEYS.forEach(function (setKey) {
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
  CARD_SET_KEYS.forEach(function (setKey) {
    (CARD_CATALOG[setKey] || []).forEach(function (c) { if (c.img) { urls[c.img] = true; } });
  });
  urls[CARD_BACK_URL] = true;
  CARD_BACK_OPTIONS.forEach(function (o) { if (o.img) { urls[o.img] = true; } });
  Object.keys(BOOSTER_PACKS).forEach(function (setKey) {
    BOOSTER_PACKS[setKey].forEach(function (src) { urls[src] = true; });
  });
  urls['Mazos/overgrowth.png'] = true;
  urls['Mazos/blackout.png'] = true;
  urls['Mazos/zap.png'] = true;
  urls['Mazos/brushfire.png'] = true;
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
    if (entry.kind === 'turn-end' || entry.kind === 'match-start') { cls += ' log-line-turn-end'; }
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
// a match instead of only the deck's one guaranteed holo. Deliberately real
// sets only (NOT CARD_SET_KEYS/basep/espromo) -- promos aren't deck-legal
// (see ownedCountsByNameClient/ownedTiersByNameClient below), so a Secret
// Rare promo Pikachu must never leak its foil onto an unrelated plain
// Base Set Pikachu that's actually in the player's deck.
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

// Real reported bug: the card viewer never showed a Pokémon's Power at
// all (Alakazam's Damage Swap, Blastoise's Rain Dance, Charizard's Energy
// Burn, Machamp's Strikes Back, Venusaur's Energy Trans, Electrode's
// Buzzap) -- only its attack. Printed above the attacks on the real card,
// so shown first here too. Read-only (activating a Power is a separate,
// existing click-to-activate flow on the board itself, see
// pendingPowerActivation) -- reuses the same row classes as a non-
// actionable attack row (viewerAttacksHtml), just with no cost/damage
// columns, since Powers have neither.
function viewerPowerHtml(name) {
  var stats = CARD_STATS[name];
  var power = stats && stats.pokemonPower;
  if (!power) { return ''; }
  var nameEs = translatePowerName(power.name);
  var textEs = translatePowerText(power.name);
  return '<div class="shell-board-viewer-attacks"><div class="shell-board-viewer-attacks-header">PODER POKÉMON</div>' +
    '<div class="shell-board-viewer-attack">' +
      '<div class="shell-board-viewer-attack-body">' +
        '<div class="shell-board-viewer-attack-name">' + escapeHtml(nameEs) + '</div>' +
        (textEs ? '<div class="shell-board-viewer-attack-text">' + escapeHtml(textEs) + '</div>' : '') +
      '</div>' +
    '</div></div>';
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

// Shared by showCardInViewer (left-click) and the board's right-click zoom
// (openCardModal, wireBoardButtons below) -- both need this same "what's
// this instance's real foil tier" computation. instance.foilTier
// (server-set, PVP only -- see benchCardHtml's own comment) reflects the
// real owning account's real collection and takes priority for either
// side; local-vs-CPU play never sets it, so this falls through to the
// exact same local logic as before.
function boardCardFoilTier(name, ownerId, instance) {
  return (instance && instance.foilTier) || (ownerId === 'player' ? (getPlayerCardFoilTier(name) || (isHoloInMatch('player', name) ? 'holo' : null))
    : (ownerId === 'cpu' && isHoloInMatch('cpu', name) ? 'holo' : null));
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
  var viewerFoilTier = boardCardFoilTier(name, viewerOwnerId, instance);
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
    bodyHtml = identityHtml + viewerPowerHtml(name) + viewerAttacksHtml(name, actionableState) + discardBtnHtml + statusHtml + viewerTrioHtml(stats);
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
          // Works identically in PVP now: the Bench click below submits
          // the real chosen target to the server instead of applying it
          // locally.
          pendingAttackNeedingTarget = atkName;
          showTargetHintModal('Elige un Pokémon de la Banca del Rival');
          return;
        }
        if (atkName === 'Metronome') {
          var op = gameState.players[opponentOf('player')];
          var defender = op && op.active;
          var defStats = defender && CARD_STATS[defender.name];
          var rivalAttacks = (defStats && defStats.attacks) || [];
          // Same submit-or-apply split every other targeted attack/Trainer
          // uses -- the modal/auto-pick logic above is identical for PVP
          // and local play, only the final call differs.
          function submitOrApplyMetronome(copiedAtkName) {
            if (pvpMode) {
              pvpAttackEndedMyTurn = true;
              submitMatchActionCloud(pvpActiveMatchId, { type: 'attack', attackName: 'Metronome', targetInstanceId: copiedAtkName })
                .catch(function (err) { pvpAttackEndedMyTurn = false; alert(err.message || 'No se pudo atacar.'); });
              return;
            }
            executePlayerAttack('Metronome', copiedAtkName);
          }
          if (rivalAttacks.length > 1) {
            var options = rivalAttacks.map(function (atk) {
              var dmgText = (atk.damage && atk.damage !== '0') ? ' (' + atk.damage + ' daño)' : '';
              var nameEs = (typeof translateAttackName === 'function') ? translateAttackName(atk.name) : atk.name;
              return {
                id: atk.name,
                label: nameEs.toUpperCase() + dmgText
              };
            });
            openChoicePickerModal('Elige 1 de los ataques de ' + (defender.name || 'rival') + ' para copiar con Metrónomo:', options, submitOrApplyMetronome);
            return;
          } else if (rivalAttacks.length === 1) {
            submitOrApplyMetronome(rivalAttacks[0].name);
            return;
          }
        }
        if (pvpMode) {
          // Armed BEFORE the call, not after it resolves -- attack() ends
          // the turn server-side synchronously as part of this same action,
          // so the very next snapshot can already carry the KO'd prize.
          // Cleared on failure so a rejected attack never leaves it armed
          // for some unrelated later KO.
          pvpAttackEndedMyTurn = true;
          submitMatchActionCloud(pvpActiveMatchId, { type: 'attack', attackName: atkName })
            .catch(function (err) { pvpAttackEndedMyTurn = false; alert(err.message || 'No se pudo atacar.'); });
          return;
        }
        executePlayerAttack(atkName);
      });
    });
  }

  var voluntaryDiscardBtn = document.getElementById('voluntaryDiscardBtn');
  if (voluntaryDiscardBtn) {
    voluntaryDiscardBtn.addEventListener('click', function () {
      // I8 (final-review fix): voluntary discard (Clefairy Doll) is Fase 2
      // scope in PVP -- no submitMatchAction action type exists for it.
      if (pvpMode) {
        alert('Esta función todavía no está disponible en PVP (próximamente).');
        return;
      }
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

// Builds the toast label for one queued CPU-turn action (see ai.js's
// queueCpuAction and card-effects.js's TRAINER_EFFECTS wrapper, both of
// which push onto the same gameState.trainerPlaysQueue) -- kind tells apart
// what's otherwise the same {name, playerId} shape. Defaults to the
// original Trainer-play phrasing when kind is missing/'trainer'.
function cpuActionLabel(play) {
  var mine = play.playerId === 'player';
  switch (play.kind) {
    case 'evolve':
      return (mine ? 'Evolucionas a ' : 'El rival evoluciona a ') + translateCardName(play.fromName) + ' → ' + translateCardName(play.name);
    case 'energy':
      return (mine ? 'Pones ' : 'El rival pone ') + translateCardName(play.name) + ' en ' + translateCardName(play.targetName);
    case 'basic':
      return (mine ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name) + ' de básico';
    case 'retreat':
      return (mine ? 'Retiras a ' : 'El rival retira a ') + translateCardName(play.outName) + ' → sale ' + translateCardName(play.name);
    case 'power':
      return (mine ? 'Usas el Poder ' : 'El rival usa el Poder ') + translatePowerName(play.powerName) + ' de ' + translateCardName(play.name) +
        (play.targetName ? (' en ' + translateCardName(play.targetName)) : '');
    default:
      return (mine ? 'Juegas ' : 'El rival juega ') + translateCardName(play.name) +
        (play.targetName ? (' → sale ' + translateCardName(play.targetName)) : '');
  }
}

// Flashes a just-taken CPU-turn action (Trainer play, evolve, energy
// attach, basic play, or retreat -- see cpuActionLabel) big in the middle
// of the screen for about a second, then calls onDone -- added because
// Trainer plays (both the player's own and the CPU's) were easy to miss
// entirely, buried in the text log; broadened to every action kind after
// the same reported complaint applied even harder to the ones that used to
// get no callout at all (evolve/energy/basic/retreat previously landed on
// the board completely silently, mid-turn, with nothing to read). Non-
// blocking (pointer-events:none) since it's a notice, not a modal the
// player has to dismiss.
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
  label.textContent = cpuActionLabel(play);
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
// wrapper and ai.js's queueCpuAction), showing each queued action in
// sequence rather than all at once -- a single CPU turn can evolve, attach
// energy, play a Basic, retreat, and play more than one Trainer before this
// ever gets a chance to run, and used to reveal all of it in one silent
// instant except whichever Trainer(s) it played.
// onAllDone (optional): called once every queued action has finished
// showing (immediately, synchronously, if the queue was already empty) --
// runCpuTurn uses this to hold "TU TURNO" until everything the CPU just did
// is done flashing, instead of it all appearing over each other in the
// same spot.
function showTrainerPlaysSequence(queue, onAllDone) {
  if (!queue.length) { if (onAllDone) { onAllDone(); } return; }
  var play = queue.shift();
  renderBoard();
  showTrainerPlayedOverlay(play, function () {
    renderBoard();
    showTrainerPlaysSequence(queue, onAllDone);
  });
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

// Both cards front and center for ~2s -- attacker on the left, defender on
// the right with the real final damage number (Weakness/Resistance/
// PlusPower/Defender already applied server-side, see attack()'s own
// comment) and any new Special Condition popping in on top of it. result:
// {attackerName, defenderName, damage, newStatuses, severePoison, missed,
// selfDamage} (gameState.lastAttackResult, rules-engine.js) -- only ever
// set when real damage landed, a new status was actually inflicted
// (Sing/Hypnosis are 0-damage, status-only attacks), the attack missed
// outright (Sand-attack's deferred coin flip, or an all-or-nothing attack's
// own coin flip coming up empty -- Horn Hazard/Leek Slap/Twineedle-style),
// or the attacker hurt itself (Confusion's self-hit, or a normal attack's
// own recoil like Thunder Jolt/Take Down/Selfdestruct), so callers don't
// need to check that themselves; `missed` shows "MISS" in place of the
// damage number for that case, and `selfDamage` shows its own badge on the
// attacker's own card. onDone runs once the overlay has fully faded back
// out.
var attackOverlayHoldTimeout = null;
var attackOverlayFadeTimeout = null;
function showAttackOverlay(result, onDone) {
  var el = document.getElementById('attackOverlay');
  var attackerImg = document.getElementById('attackOverlayAttackerImg');
  var defenderImg = document.getElementById('attackOverlayDefenderImg');
  var dmgEl = document.getElementById('attackOverlayDamage');
  var selfDmgEl = document.getElementById('attackOverlaySelfDamage');
  var statusEl = document.getElementById('attackOverlayStatus');
  var attackerUrl = result && CARD_IMAGE_BY_NAME[result.attackerName];
  var defenderUrl = result && CARD_IMAGE_BY_NAME[result.defenderName];
  if (!el || !attackerImg || !defenderImg || !dmgEl || !selfDmgEl || !statusEl || !attackerUrl || !defenderUrl) { if (onDone) { onDone(); } return; }
  clearTimeout(attackOverlayHoldTimeout);
  clearTimeout(attackOverlayFadeTimeout);
  attackerImg.src = attackerUrl;
  attackerImg.alt = result.attackerName;
  defenderImg.src = defenderUrl;
  defenderImg.alt = result.defenderName;
  // "MISS" for an attack whose own coin flip whiffed entirely (see
  // rules-engine.js's attack()/state.attackMissed); otherwise no damage
  // number for a 0-damage, status-only attack (Sing/Hypnosis) -- "-0" would
  // just be noise when nothing was actually knocked off.
  dmgEl.textContent = result.missed ? 'MISS' : (result.damage > 0 ? '-' + result.damage : '');
  dmgEl.classList.toggle('shell-attack-overlay-miss', !!result.missed);
  // Recoil the attack dealt to itself (Confusion's self-hit, or a normal
  // attack's own recoil like Thunder Jolt/Take Down/Selfdestruct) -- shown
  // on the attacker's own card so it isn't silently missing from the
  // overlay just because it never touched the Defending Pokémon (see
  // rules-engine.js's attack()/selfDamage).
  selfDmgEl.textContent = result.selfDamage > 0 ? '-' + result.selfDamage : '';
  statusEl.innerHTML = (result.newStatuses || []).map(function (s) {
    var badgeKey = (s === 'Poisoned' && result.severePoison) ? 'SeverePoison' : s;
    return pixelStatusBadgeHtml(badgeKey, 3);
  }).join('');
  el.classList.remove('hidden', 'fading');
  attackOverlayHoldTimeout = setTimeout(function () {
    el.classList.add('fading');
    attackOverlayFadeTimeout = setTimeout(function () {
      el.classList.add('hidden');
      el.classList.remove('fading');
      if (onDone) { onDone(); }
    }, 220);
  }, 2000);
}

// Shared by every attack() call site below: pops gameState.lastAttackResult
// (cleared either way, so a later attack with no real damage doesn't
// accidentally replay a stale one) and shows the overlay first if there was
// one, otherwise runs onDone immediately.
function showAttackOverlayIfAny(onDone) {
  var result = gameState.lastAttackResult;
  gameState.lastAttackResult = null;
  if (result) { showAttackOverlay(result, onDone); } else if (onDone) { onDone(); }
}

function executePlayerAttack(atkName, targetInstanceId) {
  // See localAttackEndedMyTurn's own comment -- this function is ONLY ever
  // called for the local player's own attack (the CPU's attacks go through
  // attack(gameState, 'cpu', ...) directly, in ai.js), and only while it's
  // genuinely the player's turn (the attack buttons this is wired to are
  // gated on that already) -- safe to arm unconditionally, every call.
  localAttackEndedMyTurn = true;
  var p = gameState && gameState.players && gameState.players.player;
  var c = gameState && gameState.players && gameState.players.cpu;
  var prePlayerActive = (p && p.active) ? JSON.parse(JSON.stringify(p.active)) : null;
  var preCpuActive = (c && c.active) ? JSON.parse(JSON.stringify(c.active)) : null;
  var prePlayerDiscardCount = (p && p.discard) ? p.discard.length : 0;
  var preCpuDiscardCount = (c && c.discard) ? c.discard.length : 0;
  attack(gameState, 'player', atkName, targetInstanceId);
  revealAnimationInProgress = true;
  visualActivePokemon = {
    player: prePlayerActive,
    cpu: preCpuActive,
    playerDiscardCount: prePlayerDiscardCount,
    cpuDiscardCount: preCpuDiscardCount
  };
  // Real reported bug: attack() above already flips activePlayerId to 'cpu'
  // internally (attacking is your last action) well before this reveal
  // finishes, and endTurnBtn's own handler had no guard against that -- a
  // click here during the ~2s attack overlay read activePlayerId==='cpu'
  // and immediately called runCpuTurn() a second time, racing the reveal
  // that's still in flight (double-applying the end-of-turn checkup, and
  // firing a second "TURNO DEL RIVAL"/CPU turn on top of the first) and
  // collapsing the whole animation-flash-CPU-turn-flash sequence into one
  // instant mess. Nothing re-renders the board (so nothing recreates this
  // exact button) until afterPlayerAction runs at the end of this reveal
  // (see its own comment), so disabling it here holds for the whole window;
  // endTurnBtn's handler also checks revealAnimationInProgress itself as a
  // second line of defense (see its own comment).
  var endTurnBtnDuringReveal = document.getElementById('endTurnBtn');
  if (endTurnBtnDuringReveal) { endTurnBtnDuringReveal.disabled = true; }
  showAttackOverlayIfAny(function () {
    afterPlayerAction();
    maybeShowLocalEndTurnConfirm();
  });
}

// Real reported request: local play never proactively asked "ya atacaste,
// ¿querés terminar tu turno?" the way PVP always does -- the player had to
// notice and click the persistent TERMINAR TURNO board button themselves.
// Mirrors the KO+prize-take flow's own showEndTurnConfirmAfter check
// (renderPrizeChoiceModal's click handler, above) for the plain,
// no-knockout case -- and the delayed case where MY OWN attack forced a
// self-KO (e.g. Confusion), so I owe a new Active choice before anything
// else can happen: renderActiveChoiceModal's own resolution calls this too,
// and localAttackEndedMyTurn (consumed here, not before) makes sure only
// whichever of the two call sites actually clears last is the one that
// fires, exactly the same "wait for every pending choice to clear first"
// rule the KO+prize flow already follows.
function maybeShowLocalEndTurnConfirm() {
  if (!localAttackEndedMyTurn || getWinner(gameState) || gameState.pendingPrizeChoice ||
      gameState.pendingActiveChoice === 'player' || gameState.activePlayerId === 'player') {
    return;
  }
  localAttackEndedMyTurn = false;
  // false, not the default (KO-specific "¡NOQUEASTE UN POKÉMON RIVAL!" text)
  // -- neither call site into this function represents that: a plain attack
  // knocked out nothing, and the self-KO case (Confusion et al.) knocked out
  // MY OWN Pokémon, not the rival's, which that text would misrepresent.
  renderEndTurnConfirm(false);
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

function showTurnFlash(text, colorClass, onDone) {
  var el = document.getElementById('turnFlashOverlay');
  if (!el) { if (onDone) { onDone(); } return; }
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
      if (onDone) { onDone(); }
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
    // Real reported bug: this showed plain art for both sides, regardless
    // of foil. The player's own cards use the player's real owned
    // collection tier (getPlayerCardFoilTier, same as everywhere else);
    // the CPU has no personal collection to check, so its cards use the
    // same match-scoped "is this its deck's one guaranteed Rare Holo"
    // check the live board already uses for the CPU's side (isHoloInMatch)
    // -- there's no secret-tier concept for the CPU.
    var foilTier = ownerId === 'player' ? getPlayerCardFoilTier(card.name) : (isHoloInMatch('cpu', card.name) ? 'holo' : null);
    var tierClass = foilTier === 'secret' ? ' secret' : (foilTier === 'holo' ? ' holo' : '');
    var foilOverlay = foilTier === 'secret'
      ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' + holoStarsHtml()
      : (foilTier === 'holo' ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '');
    return '<div class="shell-discard-pile-card-item' + tierClass + '">' +
      '<div class="shell-discard-pile-card-art"><img src="' + url + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' + foilOverlay + '</div>' +
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
    // Real reported bug: this modal (Computer Search/Pokémon Trader's own
    // deck+hand, Item Finder/Revive's own discard, Pokémon Breeder's hand,
    // Pokémon Flute's rival discard) always showed plain art, regardless
    // of whether the player actually owns a holo/secret copy of that name
    // -- same fix shape as renderDeckDetail's own foil bug.
    var foilTier = getPlayerCardFoilTier(card.name);
    var tierClass = foilTier === 'secret' ? ' secret' : (foilTier === 'holo' ? ' holo' : '');
    var foilOverlay = foilTier === 'secret'
      ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' + holoStarsHtml()
      : (foilTier === 'holo' ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '');
    return '<button type="button" class="shell-discard-pile-card-item' + tierClass + '" data-deck-card-id="' + card.id + '">' +
      '<div class="shell-discard-pile-card-art">' +
        '<img src="' + url + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' + foilOverlay +
      '</div>' +
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
      if (pvpMode) {
        var chosenInstanceId = btn.getAttribute('data-instance-id');
        var chosenBenchIndex = gameState.players.player.bench.findIndex(function (b) { return b && b.id === chosenInstanceId; });
        submitMatchActionCloud(pvpActiveMatchId, { type: 'chooseActive', benchIndex: chosenBenchIndex, benchInstanceId: chosenInstanceId })
          .catch(function (err) { alert(err.message || 'No se pudo elegir Activo.'); });
        return;
      }
      chooseNewActive(gameState, 'player', btn.getAttribute('data-instance-id'));
      afterPlayerAction();
      // Now that the choice is made and the modal is closing, show whatever
      // turn flash runCpuTurn held back for this exact moment (see its own
      // comment) -- if any, and only once every OTHER pending choice from
      // this same checkup (e.g. a prize choice still open) is also resolved
      // (see maybeShowPendingTurnFlash's own comment); a Trainer-triggered
      // active choice (Gust of Wind sniping a Bench Pokémon into a fight it
      // loses, say) never set one, so this is a no-op there.
      maybeShowPendingTurnFlash();
      // If a checkup at "Terminar turno" is what triggered this (the
      // player's own poisoned/burned Active dying), let the CPU's turn
      // actually start now that the player has picked their replacement --
      // see runCpuTurn/maybeResumeCpuTurn.
      maybeResumeCpuTurn();
      // See maybeShowLocalEndTurnConfirm's own comment -- covers the case
      // where it was MY OWN attack that forced this choice (a self-KO, e.g.
      // Confusion), so the confirm modal was held back until now. A no-op
      // whenever this choice came from anything else (the CPU's own attack,
      // a checkup, a Trainer card), since localAttackEndedMyTurn is false then.
      maybeShowLocalEndTurnConfirm();
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
  // Only ever called while gameState.pendingPrizeChoice.playerId === 'player'
  // (see renderBoard's own pendingPlayerPrize gate) -- see
  // localAttackEndedMyTurn's own comment for why this is tracked.
  localMyPrizeChoiceSeen = true;
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
      if (pvpMode) {
        // Real reported bug: taking a prize in PVP never showed the "here's
        // the card you won" zoom local play already has (see this
        // function's local branch below). Prizes are secret server-side
        // until taken -- snapshot my own hand's card ids right now, before
        // submitting; applyPvpSnapshotEffects diffs the next snapshot's
        // myHand against this list to find the card that just arrived.
        pvpPrizeRevealPending = gameState.players.player.hand.map(function (c) { return c.id; });
        submitMatchActionCloud(pvpActiveMatchId, { type: 'takePrize', prizeIndex: index })
          .catch(function (err) { pvpPrizeRevealPending = null; alert(err.message || 'No se pudo tomar el premio.'); });
        return;
      }
      var wonCard = gameState.players.player.prizes[index];
      var wonCardName = wonCard && wonCard.name;
      takePrize(gameState, 'player', index);
      afterPlayerAction();
      // See localAttackEndedMyTurn's own comment -- true only once every
      // prize owed from MY OWN attack this turn has actually been taken
      // (pendingPrizeChoice fully cleared, not just this one slot of a
      // multi-prize KO), my own turn is the one that just ended, and I'm
      // not ALSO stuck on my own "choose new Active" from a simultaneous KO.
      // Real reported bug: taking the LAST prize of the match (the win
      // condition) used to show this right on top of afterPlayerAction's
      // own "Has Ganado" modal above -- !getWinner(gameState) excludes
      // exactly that: the duel is already over, there's no "turn" left to
      // ask about ending.
      var showEndTurnConfirmAfter = !getWinner(gameState) && localAttackEndedMyTurn && localMyPrizeChoiceSeen &&
        !gameState.pendingPrizeChoice && gameState.activePlayerId !== 'player' &&
        gameState.pendingActiveChoice !== 'player';
      if (showEndTurnConfirmAfter) {
        localAttackEndedMyTurn = false;
        localMyPrizeChoiceSeen = false;
      }
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
      // Also resume whatever "TU TURNO" flash/draw a checkup during the
      // CPU's own turn held back for this exact prize (see
      // maybeShowPendingTurnFlash's own comment) -- taking the prize used to
      // never check this at all, leaving the player's turn (and its draw)
      // stuck forever whenever the CPU's own poisoned/burned Active dying
      // was the only pending choice (no Active choice of the player's own to
      // route through renderActiveChoiceModal's equivalent call).
      if (wonCardName) {
        var prizeFoil = getPlayerCardFoilTier(wonCardName) || (isHoloInMatch('player', wonCardName) ? 'holo' : null);
        openCardModal(wonCardName, null, prizeFoil);
        onCardModalClose = function () {
          maybeShowPendingTurnFlash();
          maybeResumeCpuTurn();
          if (showEndTurnConfirmAfter) { renderEndTurnConfirm(); }
        };
      } else {
        maybeShowPendingTurnFlash();
        maybeResumeCpuTurn();
        if (showEndTurnConfirmAfter) { renderEndTurnConfirm(); }
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
//
// instance.foilTier ('holo'/'secret', or absent): only ever set server-side
// (functions/index.js's attachFoilTiers, PVP only) from whichever REAL
// account owns that side, using their actual collectionHolo/
// collectionSecret -- takes priority over the local-only fallbacks below
// (getPlayerCardFoilTier/isHoloInMatch) so a real PVP rival's holo/secret
// rare cards show their real foil to both players, not just the deck's one
// fixed guaranteed Rare Holo. Local-vs-CPU play never sets this field, so
// it's always undefined there and every card falls through to the exact
// same local logic as before.
function benchCardHtml(instance, mine, flipped) {
  if (!instance || !CARD_STATS[instance.name]) { return benchEmptyHtml(mine, 0); }
  var stats = CARD_STATS[instance.name];
  var hp = stats.hp - instance.damage;
  var pct = Math.max(0, Math.round((hp / stats.hp) * 100));
  var cardHtml = '<div class="shell-board-bench-card' + (mine ? ' mine' : '') + (flipped ? ' flipped' : '') +
    '" data-instance-id="' + instance.id + '" data-card-name="' + escapeHtml(instance.name) + '">' +
    cardImageTag(instance.name, 'shell-board-card-art', instance.foilTier || (mine ? (getPlayerCardFoilTier(instance.name) || isHoloInMatch('player', instance.name)) : isHoloInMatch('cpu', instance.name))) +
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
  if (!activeInstance || !CARD_STATS[activeInstance.name]) {
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
    cardImageTag(activeInstance.name, 'shell-board-card-art', activeInstance.foilTier || (mine ? (getPlayerCardFoilTier(activeInstance.name) || isHoloInMatch('player', activeInstance.name)) : isHoloInMatch('cpu', activeInstance.name))) +
    cardEnergiesOverlayHtml(activeInstance.attachedEnergy) +
    cardStatusOverlayHtml(activeInstance) +
    '</div>';
  var order = mine ? (cardHtml + namePlate) : (namePlate + cardHtml);
  return '<div class="shell-board-active-col">' + order + '</div>';
}

function sideHeaderHtml(ownerId) {
  var mine = ownerId === 'player';
  var name = mine ? escapeHtml(playerDisplayName()) : (pvpMode && pvpOpponentName ? escapeHtml(pvpOpponentName) : 'CPU');
  // Real reported bug: this always showed the CPU bot avatar for the
  // opponent slot, even in PVP against a real human -- pvpOpponentPhoto
  // mirrors pvpOpponentName's own pvpMode check right above.
  var avatar = mine ? playerPhotoUrl() : (pvpMode && pvpOpponentPhoto ? pvpOpponentPhoto : PROFILE_PHOTO_URL.cpu);
  var on = gameState.activePlayerId === ownerId;
  // Real reported bug: PVP never showed a real, per-side clock at all --
  // per user request, both players' own timers are always visible, one
  // per side's own header, right next to their avatar/name. Real reported
  // follow-up: local play used to show a single shared clock in its own
  // top-toolbar spot instead (switching color/ownership by whoever's
  // turn it was) -- per later user request, local play now uses this
  // exact same per-side layout too, so both modes look identical here; id
  // lets tickPvpClocks/tickGameClock (below) target each one without
  // re-rendering the whole header on every tick.
  var clockHtml = '<div class="shell-board-side-clock" id="sideClock-' + ownerId + '"></div>';
  return '<div class="shell-board-side-header' + (mine ? ' mine' : '') + '">' +
    '<div class="shell-board-side-avatar"><img src="' + avatar + '" alt=""></div>' +
    '<div class="shell-board-side-name">' + name + '</div>' +
    clockHtml +
    '<div class="shell-board-side-led' + (on ? '' : ' off') + '"></div>' +
    '</div>';
}

// Deck (always face-down, just a count) and Discard pile -- only the count
// matters at a glance; the discard's actual cards are one click away (see
// openDiscardPileModal). Both use the real card back, per user request.
function deckDiscardRowHtml(state, ownerId, overrideDiscardCount) {
  var p = state.players[ownerId];
  var mine = ownerId === 'player';
  var discardCount = (typeof overrideDiscardCount === 'number') ? overrideDiscardCount : p.discard.length;
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
  // Real reported bug: every other face-down zone (deck/discard/prizes,
  // see deckDiscardRowHtml/prizeGridHtml above) already resolves the real
  // opponent protector via cardBackUrlFor('cpu') in PVP -- this one spot
  // was left hardcoded to the fixed default CARD_BACK_URL, so a PVP
  // rival's own equipped protector never showed on their hand-card fan.
  var backUrl = cardBackUrlFor('cpu');
  // Real reported bug: this label always read "MANO CPU", even in PVP
  // against a real rival.
  var label = pvpMode ? 'MANO RIVAL' : 'MANO CPU';
  var cards = '';
  for (var i = 0; i < count; i++) { cards += '<div class="shell-board-hand-cpu-card"><img src="' + backUrl + '" alt="Carta boca abajo"></div>'; }
  return '<div class="shell-board-hand-cpu-label"><span>' + label + '</span><span class="shell-board-hand-cpu-count">' + pixelDigitsHtml(count, 'dano', 2) + '</span></div>' +
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
    // Real PVP already decided who goes first via rock-paper-scissors
    // BEFORE this screen (see createGame's phase:'rps' comment,
    // rules-engine.js) -- this button only confirms both boards are ready,
    // it never flips anything. Local-vs-CPU play has no RPS step, so this
    // button is the actual, literal coin flip there (startMatch's own
    // coinFlip) -- keeping that label accurate for that mode only, per
    // user request to stop the PVP board implying a second coin flip that
    // doesn't happen.
    var startLabel = pvpMode ? 'INICIAR DUELO' : '🪙 LANZAR MONEDA Y COMENZAR';
    html += '<div class="shell-board-actions"><button type="button" class="shell-board-action-start" id="startMatchBtn"' + (p.active ? '' : ' disabled') + '>' + startLabel + '</button></div>';
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

  var pActive = (revealAnimationInProgress && visualActivePokemon && visualActivePokemon.player)
    ? visualActivePokemon.player
    : p.active;
  var cActive = (revealAnimationInProgress && visualActivePokemon && visualActivePokemon.cpu)
    ? visualActivePokemon.cpu
    : c.active;
  var pDiscardCount = (revealAnimationInProgress && visualActivePokemon && typeof visualActivePokemon.playerDiscardCount === 'number')
    ? visualActivePokemon.playerDiscardCount
    : p.discard.length;
  var cDiscardCount = (revealAnimationInProgress && visualActivePokemon && typeof visualActivePokemon.cpuDiscardCount === 'number')
    ? visualActivePokemon.cpuDiscardCount
    : c.discard.length;

  // The CPU's side runs Bench-then-Active (top to bottom) while the
  // player's runs Active-then-Bench, so the two Actives meet in the middle
  // like facing across a real table, instead of both sides reading the
  // same top-to-bottom order as if looking the same direction.
  var boardHtml = cpuHandRowHtml(c.hand.length) +
    '<div class="shell-board-zone">' +
    '<div class="shell-board-centerline"></div><div class="shell-board-centerline-diamond"></div>' +
    benchRowHtml(c.bench, false, true) +
    activeColHtml(cActive, false, true) +
    activeColHtml(pActive, true, false) +
    benchRowHtml(p.bench, true, false) +
    '</div>';

  var pendingPlayerPrize = !revealAnimationInProgress && s.pendingPrizeChoice && s.pendingPrizeChoice.playerId === 'player';
  var pendingActive = !revealAnimationInProgress && s.pendingActiveChoice === 'player';
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
    sideHeaderHtml('cpu') + deckDiscardRowHtml(s, 'cpu', cDiscardCount) + prizeGridHtml(s, 'cpu') +
    '<div class="shell-board-side-spacer"></div>' +
    prizeGridHtml(s, 'player') + deckDiscardRowHtml(s, 'player', pDiscardCount) + sideHeaderHtml('player');
  // The innerHTML write above recreates #sideClock-player/#sideClock-cpu
  // empty (sideHeaderHtml's own markup), and nothing refills them until the
  // next tick (tickPvpClocks every 250ms, or tickGameClock's own interval
  // for local play) -- refill immediately so a re-render never blanks the
  // clocks, even momentarily.
  if (pvpMode) { tickPvpClocks(); } else { renderClocks(); }

  renderBoardActions();
  document.getElementById('log').innerHTML = logHtml(s);

  document.getElementById('boardPhaseText').textContent = s.phase === 'setup' ? 'PREPARACIÓN' : 'FASE PRINCIPAL';
  document.getElementById('boardTurnLabel').textContent = 'TURNO ' + s.turnCounter;
  var turnValueEl = document.getElementById('boardTurnValue');
  if (s.phase === 'setup') {
    turnValueEl.textContent = 'PREPARANDO';
    turnValueEl.classList.remove('cpu');
  } else if (pvpMode) {
    // Real reported bug: every branch below this one is local-vs-CPU-only
    // (cpuTurnInProgress/cpuTurnRevealInProgress never go true in PVP), so
    // a real PVP match always fell through to the plain 'TU TURNO' default,
    // regardless of whose turn it actually was -- per user request, this
    // header must reflect the real rival's turn too, not just mine.
    // s.activePlayerId is already viewer-relative here (buildPvpGameState
    // maps it to 'player'/'cpu' meaning "me"/"my rival", exactly like the
    // rest of gameState), so this reads the same way local play's own
    // checks below do.
    turnValueEl.textContent = s.activePlayerId === 'player' ? 'TU TURNO' : 'TURNO DE TU RIVAL';
    turnValueEl.classList.toggle('cpu', s.activePlayerId !== 'player');
  } else if (cpuTurnInProgress) {
    // Real reported bug: this used to only ever get set by the explicit
    // showCpuThinkingIndicator() calls (proceedWithCpuTurn) -- any OTHER
    // render landing in between (there usually isn't one during this exact
    // window, but a resize/rerender could still sneak one in) fell through
    // to the plain 'TU TURNO' branch below instead, misreporting the CPU's
    // own turn as the player's.
    turnValueEl.innerHTML = 'CPU PENSANDO<span class="shell-cpu-thinking-dots"><span></span><span></span><span></span></span>';
    turnValueEl.classList.add('cpu');
  } else if (cpuTurnRevealInProgress) {
    // Real reported bug: the CPU decided its move already (cpuTurnInProgress
    // just went false) and is now revealing it -- Trainer-plays toasts, the
    // attack overlay -- which used to fall through to the same 'TU TURNO'
    // default below every single one of the renderBoard() calls in between,
    // for the WHOLE rest of the CPU's turn (every render after the delay
    // ended and before afterPlayerAction() finally runs). Genuinely never
    // the player's turn during this window, so it says so instead.
    turnValueEl.textContent = 'TURNO CPU';
    turnValueEl.classList.add('cpu');
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
    // themselves. Also covers the player's own attack overlay/reveal
    // (revealAnimationInProgress without cpuTurnRevealInProgress) -- that's
    // still very much the player's own action playing out, not the CPU's.
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

function hasPendingPlayerChoice() {
  return !!(gameState && (gameState.pendingPrizeChoice || gameState.pendingActiveChoice === 'player'));
}

function maybeResumeCpuTurn() {
  if (!cpuTurnAwaitingPlayerChoice || hasPendingPlayerChoice()) { return; }
  cpuTurnAwaitingPlayerChoice = false;
  proceedWithCpuTurn();
}

// Consumes the "TU TURNO" flash the CPU-turn reveal held back (pendingTurnFlash)
// once EVERY pending player choice from that checkup has actually been
// resolved -- a single checkup can leave both a prize choice (the CPU's own
// poisoned/burned Active finishing itself off) and an active choice (the
// player's own Active dying the same checkup) open at once, and either one's
// modal used to fire this on its own the instant IT closed, regardless of
// the other still being open. That let the player draw for the turn
// (startPlayerTurnWithDraw) while still mid-choice, or -- the reported bug --
// never at all: the prize modal's own handler never checked pendingTurnFlash
// to begin with, so a prize-only checkup (no active choice needed) left
// "TU TURNO" and the turn's draw stuck forever.
function maybeShowPendingTurnFlash() {
  if (!pendingTurnFlash || hasPendingPlayerChoice()) { return; }
  var flash = pendingTurnFlash;
  pendingTurnFlash = null;
  showTurnFlash(flash.text, flash.colorClass, function () {
    if (flash.text === 'TU TURNO') { startPlayerTurnWithDraw(); }
  });
}

function startPlayerTurnWithDraw() {
  if (gameState && gameState.activePlayerId === 'player' && !getWinner(gameState) && !pvpMode) {
    if (gameState.turnCounter > 1) {
      drawForTurnStart(gameState, 'player');
    }
    renderBoard();
  }
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
  // Real reported bug: localAttackEndedMyTurn stayed armed forever after
  // an attack that DIDN'T cause a KO (it's only ever consumed on a matching
  // KO+prize, see its own comment) -- so on some LATER turn where the
  // player didn't attack at all, a Pokémon Checkup KO (their own poisoned
  // Active dying at THIS exact turn-ending moment, awarding a prize) still
  // read as "my own attack just ended my turn" and wrongly popped the
  // confirm. By the time this function ever runs, any prize owed from an
  // attack THIS turn is already resolved (the prize-choice modal blocks
  // reaching "Terminar Turno" until it's taken -- see its own click
  // handler, where this flag actually gets consumed) -- so it's always
  // safe to clear it here, before the checkup below can award an unrelated
  // one of its own.
  localAttackEndedMyTurn = false;
  localMyPrizeChoiceSeen = false;
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

function proceedWithCpuTurn() {
  var difficulty = getCpuDifficulty();
  var delay = cpuThinkDelayMs(difficulty);
  var endTurnBtn = document.getElementById('endTurnBtn');
  if (endTurnBtn) { endTurnBtn.disabled = true; }
  showTurnFlash('TURNO DEL RIVAL', 'rival');
  if (delay > 0) { showCpuThinkingIndicator(); }
  cpuTurnInProgress = true;
  setTimeout(function () {
    try {
      cpuTakeTurn(gameState, difficulty);
    } catch (e) {
      console.error('Error during CPU turn:', e);
    }
    cpuTurnInProgress = false;
    // Captured now (cleared either way) so a later render/attack can't
    // accidentally replay a stale one -- see showAttackOverlayIfAny's own
    // comment for why a single field (not a queue) is enough.
    var cpuAttackResult = gameState.lastAttackResult;
    gameState.lastAttackResult = null;
    var queuedTrainerPlays = gameState.trainerPlaysQueue || [];
    gameState.trainerPlaysQueue = [];
    // Held true for the whole reveal (Trainer plays -> thinking beat ->
    // attack overlay) so tickGameClock's independent poll can't jump ahead
    // of it -- see revealAnimationInProgress's own comment.
    revealAnimationInProgress = true;
    // See cpuTurnRevealInProgress's own comment -- from here through
    // afterPlayerAction(), the header shows "TURNO CPU" instead of
    // renderBoard's default "TU TURNO".
    cpuTurnRevealInProgress = true;
    // Real reported bug: this used to snapshot both Actives from BEFORE
    // cpuTakeTurn() ran at all, then hold the board on that single frozen
    // snapshot through the ENTIRE reveal below -- Trainer-plays sequence
    // included. Energy attached, an evolution, a retreat: all real,
    // already-applied changes to the Active Pokémon this same turn, but
    // invisible until the reveal's very last step reset visualActivePokemon
    // to null. ai.js now snapshots BOTH Actives itself, right before its
    // own attack() call (after every other action already happened) --
    // that's the only moment worth hiding at all (so the attack's own
    // damage/KO doesn't show before its overlay does); null here (no attack
    // this turn) means nothing needs hiding, so the board just shows the
    // real, fully up-to-date state immediately.
    var preAttackSnapshot = gameState.preAttackActiveSnapshot;
    gameState.preAttackActiveSnapshot = null;
    visualActivePokemon = preAttackSnapshot;
    renderBoard();
    try {
      showTrainerPlaysSequence(queuedTrainerPlays, function () {
        // A short "CPU PENSANDO..." beat before the reveal, even when no
        // Trainer was played -- see CPU_POST_ACTION_PAUSE_MS's own comment.
        showCpuThinkingIndicator();
        setTimeout(function () {
          function reveal() {
            try {
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
                showTurnFlash('TU TURNO', 'mine', function () {
                  startPlayerTurnWithDraw();
                });
              }
            } catch (err) {
              console.error('Error during reveal:', err);
              revealAnimationInProgress = false;
              cpuTurnRevealInProgress = false;
              visualActivePokemon = null;
              renderBoard();
            }
          }
          // If the CPU attacked this turn, show the attack overlay (~1s)
          // before revealing the real board -- same reveal-order reasoning
          // as the Trainer-plays sequence above: the player should see the
          // "why" before the resulting board state.
          if (cpuAttackResult) { showAttackOverlay(cpuAttackResult, reveal); } else { reveal(); }
        }, CPU_POST_ACTION_PAUSE_MS);
      });
    } catch (err) {
      console.error('Error during trainer sequence:', err);
      revealAnimationInProgress = false;
      cpuTurnRevealInProgress = false;
      visualActivePokemon = null;
      renderBoard();
    }
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
  revealAnimationInProgress = false;
  cpuTurnRevealInProgress = false;
  visualActivePokemon = null;
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
  // PVP counterpart to stopGameClock() above -- rules-engine.js never moves
  // phase away from 'playing' once a winner is decided, so tickPvpClocks's
  // own phase guard can't stop it on its own; left running, it would keep
  // re-rendering both PVP clocks (and could fire a spurious claimTimeout)
  // against a now-frozen turnStartedAt until the player leaves via
  // Revancha/Cancelar. Only ever non-null during a PVP match, so this is a
  // no-op for local play, same as stopGameClock() is today.
  if (pvpClockTickInterval) { clearInterval(pvpClockTickInterval); pvpClockTickInterval = null; }
  playMatchEndMusic(winner);
  var rewardEl = document.getElementById('matchEndReward');
  rewardEl.classList.add('hidden');
  awardMatchResultCloud(winner === 'player' ? 'win' : 'loss')
    .then(function (res) {
      // Only a win ever has a nonzero delta (see computeMatchReward) -- a
      // loss's own "Has Perdido" text already says enough on its own.
      if (res && res.data && res.data.delta > 0) {
        rewardEl.textContent = 'Orbes: ' + res.data.delta;
        rewardEl.classList.remove('hidden');
      }
    })
    .catch(function (e) { console.error('No se pudo registrar el resultado de la partida', e); });
  renderBoard(); // shows the final board state (last action's results)
  var textEl = document.getElementById('matchEndText');
  // Duelo en Vivo / Rendirse: pvpLatestPub.forfeitedBy names whichever
  // side (player1/player2) gave up, set fresh by processPvpMatchSnapshot
  // right before this call (see that function's own `pvpLatestPub = pub;`
  // line) -- null for every other win condition. Only the WINNING side's
  // modal gets the special copy; the side that forfeited still just sees
  // "Has Perdido", same as any other loss.
  var rivalForfeited = pvpMode && winner === 'player' && pvpLatestPub &&
    pvpLatestPub.forfeitedBy && pvpLatestPub.forfeitedBy !== pvpMySide;
  textEl.textContent = rivalForfeited ? 'Tu rival te ha cedido la victoria' : (winner === 'player' ? 'Has Ganado' : 'Has Perdido');
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

  // Every TRAINER_EFFECTS[name] function shares rules-engine.js's
  // (state, playerId, handId, ...args) shape and already validates
  // legality before mutating (see card-effects.js) -- in PVP that exact
  // same call just needs to happen on the SERVER's real state instead of
  // this client's reconstructed one, which is why this can be one
  // generic helper instead of a bespoke branch per card. Every one of
  // this file's ~15 Trainer-card call sites routes through this.
  function applyOrSubmitTrainerEffect(trainerName, handId, args) {
    if (pvpMode) {
      submitMatchActionCloud(pvpActiveMatchId, { type: 'playTrainer', trainerName: trainerName, handId: handId, args: args || [] })
        .catch(function (err) { alert(err.message || 'Jugada inválida.'); });
      return;
    }
    var result = TRAINER_EFFECTS[trainerName].apply(null, [gameState, 'player', handId].concat(args || []));
    if (result && !result.legal) { logEvent(gameState, result.reason, 'player'); }
    selectedHandId = null;
    renderBoard();
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
            applyOrSubmitTrainerEffect(handCard.name, handId, []);
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
              (pvpMode ? peekOwnDeckCloud() : Promise.resolve(p.deck.slice())).then(function (deckCards) {
                openDeckSearchModal(deckCards, function (deckCardId) {
                  applyOrSubmitTrainerEffect('Computer Search', handId, [deckCardId, discardHandIds]);
                });
              }).catch(function (err) { alert(err.message || 'No se pudo consultar el mazo.'); });
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
                applyOrSubmitTrainerEffect('Energy Retrieval', handId, [tradeIds[0], retrieveIds]);
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
                applyOrSubmitTrainerEffect('Item Finder', handId, [discardHandIds, discardCardId]);
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
              applyOrSubmitTrainerEffect('Maintenance', handId, [shuffleHandIds]);
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
              (pvpMode ? peekOwnDeckCloud() : Promise.resolve(p.deck.slice())).then(function (deckCards) {
                var pokemonInDeck = deckCards.filter(function (c) { return CARD_STATS[c.name] && CARD_STATS[c.name].supertype === 'Pokémon'; });
                openDeckSearchModal(pokemonInDeck, function (deckCardId) {
                  applyOrSubmitTrainerEffect('Pokémon Trader', handId, [tradeHandId, deckCardId]);
                });
              }).catch(function (err) { alert(err.message || 'No se pudo consultar el mazo.'); });
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
              applyOrSubmitTrainerEffect('Pokémon Flute', handId, [opponentDiscardCardId]);
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
              applyOrSubmitTrainerEffect('Revive', handId, [discardCardId]);
            });
          } else if (handCard.name === 'Pokédex') {
            (pvpMode ? peekOwnDeckCloud() : Promise.resolve(p.deck.slice())).then(function (deckCards) {
              var topOfDeck = deckCards.slice(0, Math.min(5, deckCards.length));
              openPokedexModal(topOfDeck, function (orderedIds) {
                applyOrSubmitTrainerEffect('Pokédex', handId, [orderedIds]);
              });
            }).catch(function (err) { alert(err.message || 'No se pudo consultar el mazo.'); });
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
        // C2 (final-review fix): this immediate-play shortcut bypassed the
        // server entirely in PVP -- the drag-and-drop path (resolveHandDrop)
        // was guarded, this click-to-play equivalent wasn't.
        if (pvpMode) {
          submitMatchActionCloud(pvpActiveMatchId, { type: 'placeActive', handCardId: handId })
            .catch(function (err) { alert(err.message || 'Jugada inválida.'); });
          return;
        }
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
    if (pvpMode) {
      var pvpAction = null;
      if (isEmptySlotDrop && isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', handId)) {
        pvpAction = (gameState.players.player.active ? { type: 'placeBench', handCardId: handId, benchIndex: benchIndex } : { type: 'placeActive', handCardId: handId });
      } else if (targetInstanceId && canEvolve(gameState, 'player', handId, targetInstanceId)) {
        pvpAction = { type: 'evolve', handCardId: handId, targetInstanceId: targetInstanceId };
      } else if (targetInstanceId && canAttachEnergy(gameState, 'player', handId, targetInstanceId)) {
        pvpAction = { type: 'attachEnergy', handCardId: handId, targetInstanceId: targetInstanceId };
      }
      if (pvpAction) {
        submitMatchActionCloud(pvpActiveMatchId, pvpAction).catch(function (err) { alert(err.message || 'Jugada inválida.'); });
      }
      return;
    }
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
      if (pvpMode) {
        // Shown right away (before the server even confirms) so pressing
        // INICIAR DUELO always gives immediate feedback -- processPvpMatchSnapshot
        // hides it again the instant the match actually leaves 'setup'
        // (both sides confirmed), and the catch below hides it if this
        // side's own confirm failed outright.
        document.getElementById('pvpWaitingConfirmModal').classList.remove('hidden');
        submitMatchActionCloud(pvpActiveMatchId, { type: 'confirmSetup' })
          .catch(function (err) {
            document.getElementById('pvpWaitingConfirmModal').classList.add('hidden');
            alert(err.message || 'No se pudo confirmar.');
          });
        return;
      }
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
      // Real reported bug: clicking this during the player's own attack
      // overlay (revealAnimationInProgress) or while the CPU's turn is
      // already resolving (cpuTurnInProgress) read the already-flipped
      // activePlayerId and fired a second, overlapping runCpuTurn() call --
      // see executePlayerAttack's own comment for the exact mess that
      // caused. executePlayerAttack already disables this button for the
      // duration too; this is the second line of defense (e.g. a click that
      // landed the same instant the button was disabled).
      if (revealAnimationInProgress || cpuTurnInProgress) { return; }
      if (pvpMode) {
        // Real reported bug: clicking "NO, MIRAR EL CAMPO" on the confirm
        // modal used to still hand the turn to the rival -- fixed (see
        // sendPvpConfirmEndTurn's own comment) so "NO" now genuinely leaves
        // the turn open, tracked by pvpTurnConfirmOwed. This button is the
        // ONLY other way to actually confirm afterward -- a plain 'endTurn'
        // would be rejected server-side once an attack of mine is already
        // pending confirmation (see party/index.js's runAction guard), so
        // this sends the real confirmation instead in that case.
        if (pvpTurnConfirmOwed) { sendPvpConfirmEndTurn(); return; }
        // Normal case: no attack happened this turn, this really is a
        // plain voluntary end-of-turn.
        pvpAttackEndedMyTurn = false;
        pvpMyPrizeChoiceSeen = false;
        submitMatchActionCloud(pvpActiveMatchId, { type: 'endTurn' }).catch(function (err) { alert(err.message || 'No puedes terminar tu turno ahora.'); });
        return;
      }
      // Real reported bug: "HAS TERMINADO TU TURNO" used to log from
      // inside endTurn() itself (rules-engine.js), which fired the instant
      // an attack auto-ended the turn -- visible immediately (the attack
      // overlay/afterPlayerAction render right after), well before the
      // player had actually clicked this button. Logged here instead, at
      // the actual moment of that click, unconditionally -- whether the
      // engine's own endTurn() already ran earlier (from an attack) or
      // runs right now as part of this same click.
      logEvent(gameState, 'HAS TERMINADO TU TURNO', 'player', 'turn-end');
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
      showTargetHintModal('Elige un Pokémon de la Banca');
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
      if (pvpMode) {
        submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: instance.id, params: {} })
          .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
        return;
      }
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
      // Real reported request: Pokémon Powers now work in PVP too --
      // usablePokemonPowers(gameState, 'player') already reads correctly
      // in either mode (gameState is rebuilt from the server's own
      // redacted snapshot in PVP, via buildPvpGameState), so the only
      // thing that ever needed to change is this guard.
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
          if (pvpMode) {
            // Real reported request: let the player choose WHICH attached
            // Energy pays the retreat cost in PVP too, same modal local
            // play already uses -- the server has always accepted
            // action.discardEnergyIndices (see party/index.js's 'retreat'
            // case), only the client never sent it for PVP, silently
            // falling back to "the first `cost` many" instead.
            if (retreatCostNow === 0) {
              submitMatchActionCloud(pvpActiveMatchId, { type: 'retreat', targetInstanceId: instanceId })
                .catch(function (err) { alert(err.message || 'No te puedes retirar.'); });
              return;
            }
            openEnergyDiscardModal(activePokemon.attachedEnergy.slice(), retreatCostNow, function (indices) {
              submitMatchActionCloud(pvpActiveMatchId, { type: 'retreat', targetInstanceId: instanceId, discardEnergyIndices: indices })
                .catch(function (err) { alert(err.message || 'No te puedes retirar.'); });
            });
            return;
          }
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
        if (pvpMode) {
          pvpAttackEndedMyTurn = true;
          submitMatchActionCloud(pvpActiveMatchId, { type: 'attack', attackName: 'Lure', targetInstanceId: instanceId })
            .catch(function (err) { pvpAttackEndedMyTurn = false; alert(err.message || 'No se pudo atacar.'); });
          return;
        }
        executePlayerAttack('Lure', instanceId);
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
          var swapParams = { fromInstanceId: pa.fromInstanceId, toInstanceId: instanceId };
          if (pvpMode) {
            submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: pa.ownerId, params: swapParams })
              .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
            return;
          }
          var swapResult = usePokemonPower(gameState, 'player', pa.ownerId, swapParams);
          if (swapResult && !swapResult.legal) { logEvent(gameState, swapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Rain Dance') {
          pendingPowerActivation = null;
          var rainParams = { handEnergyId: pa.handEnergyId, targetInstanceId: instanceId };
          if (pvpMode) {
            submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: pa.ownerId, params: rainParams })
              .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
            return;
          }
          var rainResult = usePokemonPower(gameState, 'player', pa.ownerId, rainParams);
          if (rainResult && !rainResult.legal) { logEvent(gameState, rainResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        if (pa.powerName === 'Buzzap') {
          pendingPowerActivation = null;
          var buzzapParams = { chosenType: pa.chosenType, targetInstanceId: instanceId };
          if (pvpMode) {
            submitMatchActionCloud(pvpActiveMatchId, { type: 'usePower', ownerInstanceId: pa.ownerId, params: buzzapParams })
              .catch(function (err) { alert(err.message || 'No se pudo usar el Poder.'); });
            return;
          }
          var buzzapResult = usePokemonPower(gameState, 'player', pa.ownerId, buzzapParams);
          if (buzzapResult && !buzzapResult.legal) { logEvent(gameState, buzzapResult.reason, 'player'); }
          afterPlayerAction();
          return;
        }
        return;
      }
      if (pendingPokemonBreeder) {
        var pb = pendingPokemonBreeder;
        pendingPokemonBreeder = null;
        applyOrSubmitTrainerEffect('Pokémon Breeder', pb.handId, [pb.evolutionHandId, instanceId]);
        return;
      }
      if (!selectedHandId) { return; }
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      // C2 (final-review fix, historical): this click-to-select-then-
      // click-target fallback for placeBench/evolve/attachEnergy bypassed
      // the server entirely in PVP -- only the drag-and-drop equivalent
      // (resolveHandDrop) was guarded. Only intercept+return when one of
      // these 3 vanilla actions actually matches -- Trainer-card effects
      // (Super Potion, Energy Removal, Super Energy Removal, and the
      // generic single-target fallback below) now route through
      // applyOrSubmitTrainerEffect themselves, each at their own call
      // site further down, so nothing about THIS specific pvpMode check
      // needs to also handle them.
      if (pvpMode) {
        var pvpBoardClickAction = null;
        if (isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', selectedHandId)) {
          pvpBoardClickAction = { type: 'placeBench', handCardId: selectedHandId, benchIndex: gameState.players.player.bench.indexOf(null) };
        } else if (canEvolve(gameState, 'player', selectedHandId, instanceId)) {
          pvpBoardClickAction = { type: 'evolve', handCardId: selectedHandId, targetInstanceId: instanceId };
        } else if (canAttachEnergy(gameState, 'player', selectedHandId, instanceId)) {
          pvpBoardClickAction = { type: 'attachEnergy', handCardId: selectedHandId, targetInstanceId: instanceId };
        }
        if (pvpBoardClickAction) {
          submitMatchActionCloud(pvpActiveMatchId, pvpBoardClickAction).catch(function (err) { alert(err.message || 'Jugada inválida.'); });
          selectedHandId = null;
          return;
        }
      }
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
          applyOrSubmitTrainerEffect('Super Potion', superPotionHandId, [instanceId, indices[0]]);
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
          applyOrSubmitTrainerEffect('Energy Removal', energyRemovalHandId, [instanceId, indices[0]]);
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
        if (!cpuTarget.attachedEnergy || cpuTarget.attachedEnergy.length === 0) {
          logEvent(gameState, 'Ese Pokémon rival no tiene energías adjuntas', 'player');
          document.getElementById('log').innerHTML = logHtml(gameState);
          return;
        }
        var pendingRemoval = pendingSuperEnergyRemoval;
        pendingSuperEnergyRemoval = null;
        selectedHandId = null;

        var countToDiscard = Math.min(2, cpuTarget.attachedEnergy.length);
        if (cpuTarget.attachedEnergy.length >= 2) {
          openEnergyDiscardModal(cpuTarget.attachedEnergy.slice(), countToDiscard, function (indices) {
            applyOrSubmitTrainerEffect('Super Energy Removal', pendingRemoval.handId, [pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex, indices]);
          });
          return;
        } else {
          applyOrSubmitTrainerEffect('Super Energy Removal', pendingRemoval.handId, [pendingRemoval.ownInstanceId, instanceId, pendingRemoval.ownEnergyIndex, [0]]);
        }
      } else if (TRAINER_EFFECTS[handCard.name]) {
        applyOrSubmitTrainerEffect(handCard.name, selectedHandId, [instanceId]);
        return;
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

  // Real reported request: right-click any card on the board (either
  // side, Active or Bench) to zoom it front-and-center, foil included --
  // a separate listener rather than folding this into the click handler
  // above (which is already a long, stateful click-to-target flow) keeps
  // this simple and independent of any of that state.
  document.querySelectorAll('.shell-board-bench-card, .shell-board-active-card').forEach(function (el) {
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var instanceId = el.getAttribute('data-instance-id');
      var name = el.getAttribute('data-card-name');
      if (!name) { return; }
      var instance = findInstanceEitherSide(instanceId);
      var ownerId = findInstance(gameState.players.player, instanceId) ? 'player' : 'cpu';
      openCardModal(name, null, boardCardFoilTier(name, ownerId, instance));
    });
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
        // C2 (final-review fix): this click-a-specific-empty-bench-slot
        // fallback bypassed the server entirely in PVP.
        if (pvpMode) {
          var pvpBenchAction = gameState.players.player.active
            ? { type: 'placeBench', handCardId: selectedHandId, benchIndex: benchIndex }
            : { type: 'placeActive', handCardId: selectedHandId };
          submitMatchActionCloud(pvpActiveMatchId, pvpBenchAction).catch(function (err) { alert(err.message || 'Jugada inválida.'); });
          selectedHandId = null;
          return;
        }
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

// Real reported request: a real time-of-day clock in the board header
// (right side, #boardWallClock), for both local play and PVP -- distinct
// from the per-side game timers above (those count down the match's own
// time bank; this just shows the real wall-clock time). 'plata' (neutral
// silver, same palette room codes use) keeps it visually distinct from
// the game timers' gold/red. Ticks on its own interval, independent of
// any match lifecycle -- it's always relevant whenever the board is on
// screen, in either mode, so it's started once at page load (below) and
// just left running.
// Real reported follow-up: bigger than the per-side clocks (this one has
// the whole right side of the header to itself, no username fighting it
// for room, unlike SIDE_CLOCK_BLOCK_PX above) -- PERIOD_BLOCK_PX renders
// the smaller AM/PM suffix the same request asked for, same convention as
// a real clock face (12-hour time, not the 24-hour format this used
// before, since AM/PM only makes sense alongside 12-hour hours).
var WALL_CLOCK_BLOCK_PX = 2.2;
var WALL_CLOCK_PERIOD_BLOCK_PX = 1.2;
function formatWallClockTime(d) {
  var hh = d.getHours();
  var mm = d.getMinutes();
  var hh12 = hh % 12;
  if (hh12 === 0) { hh12 = 12; }
  return { time: hh12 + ':' + (mm < 10 ? '0' : '') + mm, period: hh >= 12 ? 'PM' : 'AM' };
}
function renderWallClock() {
  var el = document.getElementById('boardWallClock');
  if (!el) { return; }
  var parts = formatWallClockTime(new Date());
  el.innerHTML = pixelDigitsHtml(parts.time, 'plata', WALL_CLOCK_BLOCK_PX) +
    '<span class="shell-board-wallclock-period">' + pixelDigitsHtml(parts.period, 'plata', WALL_CLOCK_PERIOD_BLOCK_PX) + '</span>';
}

// Real reported bug: per-side clocks (both modes) were too small -- bumped
// up from the original 1 (which just barely avoided crowding the username,
// see below) while shell-theme.css's own side-header shrinks its avatar/
// padding/name font a bit to give the wider digits room without pushing
// the username back into ellipsis-truncation.
var SIDE_CLOCK_BLOCK_PX = 1.4;

// Same pixel-glyph digit rendering the coin/collection counts use (not
// plain browser text) -- per user feedback that the clock looked
// inconsistent next to them.
// blockPx (optional, defaults to 2): every real caller now passes
// SIDE_CLOCK_BLOCK_PX -- both modes render into the same tight per-side
// header spot (.shell-board-side-clock), where the full default size
// crowded the fixed-width digits against .shell-board-side-name's own
// flex:1 sizing, squeezing the username down to near-nothing instead of
// sharing space with it cleanly.
function renderClockDisplay(el, ms, isCpu, blockPx) {
  var low = ms <= 30000;
  el.innerHTML = pixelDigitsHtml(formatClockMs(ms), (isCpu || low) ? 'dano' : 'oro', blockPx || 2);
  el.classList.toggle('cpu', !!isCpu);
  el.classList.toggle('low', low);
}

// Real reported bug: this used to render into one single shared spot
// (the old top-toolbar #boardClock), switching color/ownership between
// whichever side's turn it currently was. Per later user request, local
// play now shows BOTH sides' own remaining time simultaneously, one per
// side's own header -- matching PVP's exact presentation (isCpu always
// false here, red only via renderClockDisplay's own <=30s threshold, same
// color decision as tickPvpClocks' own comment explains). Only the
// DISPLAY changed -- currentClockOwner()/tickGameClock below still decide
// whose time bank actually keeps draining.
function renderClocks() {
  var s = gameState;
  if (!s || s.phase !== 'playing' || !s.activePlayerId) { return; }
  var myEl = document.getElementById('sideClock-player');
  var cpuEl = document.getElementById('sideClock-cpu');
  if (myEl) { renderClockDisplay(myEl, s.players.player.timeBankMs, false, SIDE_CLOCK_BLOCK_PX); }
  if (cpuEl) { renderClockDisplay(cpuEl, s.players.cpu.timeBankMs, false, SIDE_CLOCK_BLOCK_PX); }
}

function tickGameClock() {
  if (!gameState || gameState.phase !== 'playing' || !gameState.activePlayerId) { return; }
  var now = Date.now();
  var elapsed = clockLastTickAt ? (now - clockLastTickAt) : 0;
  clockLastTickAt = now;
  tickClock(gameState, currentClockOwner(), elapsed);
  renderClocks();
  // Don't let this independent 250ms poll race ahead of an attack reveal
  // still animating on screen -- afterPlayerAction() (called once that
  // reveal actually finishes) already re-checks getWinner() itself right
  // after clearing this flag, so nothing is missed, only delayed until the
  // player has actually seen why the match ended.
  if (revealAnimationInProgress) { return; }
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
  resetPvpMatchState();
  matchWinner = null;
  cpuTurnInProgress = false;
  stopGameClock();
  stopDuelMusic();
  document.getElementById('matchEndMusic').pause();
  document.getElementById('matchEndModal').classList.add('hidden');
  gameState = createGame(Math.random, (econState && econState.activeDeck) || 'overgrowth');
  aiSetupBoard(gameState, 'cpu');
  logEvent(gameState, 'Coloca tu Pokémon Activo y, si quieres, tu Banca (máx. 5) antes de empezar.');
  renderBoard();
  // renderClocks() itself no-ops during 'setup' (no activePlayerId yet), so
  // both fresh per-side clocks are primed directly here, AFTER renderBoard
  // (which is what actually creates #sideClock-player/#sideClock-cpu via
  // sideHeaderHtml) -- otherwise they'd stay blank until the first real
  // tick once 'playing' begins.
  var myClockEl = document.getElementById('sideClock-player');
  var cpuClockEl = document.getElementById('sideClock-cpu');
  if (myClockEl) { renderClockDisplay(myClockEl, DEFAULT_TIME_BANK_MS, false, SIDE_CLOCK_BLOCK_PX); }
  if (cpuClockEl) { renderClockDisplay(cpuClockEl, DEFAULT_TIME_BANK_MS, false, SIDE_CLOCK_BLOCK_PX); }
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
  playScreenMusic('Songs/Booster Pack Bazaar.mp3');
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
  var orbesPanel = document.getElementById('shopOrbesPanel');
  if (orbesPanel) { orbesPanel.classList.toggle('hidden', tab !== 'orbes'); }
  if (tab === 'protectores') { renderProtectorsGrid(); }
  if (tab === 'orbes') { renderOrbesShopGrid(); }
}

// Only updates the coin balance -- called on every Firestore snapshot
// (economy.js). Deliberately NOT rebuilding the card grid here: that would
// re-roll each card's random cover art out from under the player while
// they're looking at the screen, e.g. right after a purchase updates coins.
function updateShopBalance() {
  var balanceEl = document.getElementById('shopCoinBalance');
  if (balanceEl && econState) { balanceEl.innerHTML = pixelDigitsHtml(econState.coins, 'oro', 3); }
}

function getBoosterCost(setKey) {
  if (globalEconomyConfig && globalEconomyConfig.boosterCosts && typeof globalEconomyConfig.boosterCosts[setKey] === 'number') {
    return globalEconomyConfig.boosterCosts[setKey];
  }
  return 100;
}

function getProtectorCost(id) {
  if (globalEconomyConfig && globalEconomyConfig.protectorCosts && typeof globalEconomyConfig.protectorCosts[id] === 'number') {
    return globalEconomyConfig.protectorCosts[id];
  }
  var opt = CARD_BACK_OPTIONS.filter(function (o) { return o.id === id; })[0];
  return (opt && opt.cost) ? opt.cost : 75;
}

function getStarsShopPackages() {
  if (globalEconomyConfig && globalEconomyConfig.starsPackages) {
    var pkgs = globalEconomyConfig.starsPackages;
    return Object.keys(pkgs).map(function (k) { return pkgs[k]; });
  }
  return STARS_SHOP_PACKAGES;
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
    var packPrice = getBoosterCost(setKey);
    html +=
      '<div class="shell-shop-card" data-set="' + setKey + '">' +
        '<div class="shell-shop-card-art"><img src="' + randomPack + '" alt="' + BOOSTER_NAMES[setKey] + '"></div>' +
        '<div class="shell-shop-card-text">' +
          '<div class="shell-shop-card-name">PACK ' + BOOSTER_NAMES[setKey].toUpperCase() + '</div>' +
          '<div class="shell-shop-card-desc">11 CARTAS + 1 ENERGÍA</div>' +
        '</div>' +
        '<div class="shell-shop-card-footer">' +
          '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 3) + pixelDigitsHtml(packPrice, 'oro', 3) + '</span>' +
          '<button type="button" class="shell-shop-card-btn">ABRIR</button>' +
        '</div>' +
      '</div>';
  });
  // This 4th slot doubles as the entry point for any pending news-gift
  // packs (see claimNewsGiftCloud/pendingGiftBoosters), falling back to an
  // explicit "no tienes packs de regalo" state once none are left to claim
  // (previously a generic "coming soon" placeholder, back before gifting
  // was a real feature).
  var pending = pendingGiftBoosters();
  if (pending.length) {
    var giftPack = giftPackDisplay(pending[0].gift).art;
    html +=
      '<div class="shell-shop-card" id="giftBoosterShopCard">' +
        '<div class="shell-shop-card-art"><img src="' + giftPack + '" alt="Pack gratis"></div>' +
        '<div class="shell-shop-card-text">' +
          '<div class="shell-shop-card-name">PACK GRATIS</div>' +
          '<div class="shell-shop-card-desc">' + pending.length + (pending.length === 1 ? ' PACK PENDIENTE' : ' PACKS PENDIENTES') + '</div>' +
        '</div>' +
        '<div class="shell-shop-card-footer">' +
          '<button type="button" class="shell-shop-card-btn" id="giftBoosterShopBtn">ABRIR</button>' +
        '</div>' +
      '</div>';
  } else {
    html +=
      '<div class="shell-shop-card shell-shop-card-disabled">' +
        '<div class="shell-shop-card-art"><span class="shell-shop-card-placeholder">SIN REGALOS</span></div>' +
        '<div class="shell-shop-card-text">' +
          '<div class="shell-shop-card-name">PACK GRATIS</div>' +
          '<div class="shell-shop-card-desc">NO TIENES PACKS DE REGALOS</div>' +
        '</div>' +
        '<div class="shell-shop-card-footer">' +
          '<button type="button" class="shell-shop-card-btn" disabled>NO DISPONIBLE</button>' +
        '</div>' +
      '</div>';
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.shell-shop-card[data-set]').forEach(function (card) {
    card.querySelector('.shell-shop-card-btn').addEventListener('click', function () {
      openBoosterSelectModal(card.getAttribute('data-set'));
    });
  });
  var giftBtn = document.getElementById('giftBoosterShopBtn');
  if (giftBtn) { giftBtn.addEventListener('click', openGiftBoosterModal); }
}

function openGiftBoosterModal() {
  renderGiftBoosterModalList();
  document.getElementById('giftBoosterModal').classList.remove('hidden');
}

function closeGiftBoosterModal() {
  document.getElementById('giftBoosterModal').classList.add('hidden');
}

function renderGiftBoosterModalList() {
  var listEl = document.getElementById('giftBoosterModalList');
  if (!listEl) { return; }
  var pending = pendingGiftBoosters();
  if (!pending.length) {
    closeGiftBoosterModal();
    return;
  }
  listEl.innerHTML = pending.map(function (it) {
    var display = giftPackDisplay(it.gift);
    return '<div class="shell-gift-booster-row">' +
      '<img src="' + display.art + '" alt="' + escapeHtml(display.name) + '">' +
      '<div class="shell-gift-booster-row-text">' +
        '<div class="shell-gift-booster-row-name">' + escapeHtml(display.name) + '</div>' +
        '<div class="shell-gift-booster-row-source">' + escapeHtml(it.label) + '</div>' +
      '</div>' +
      '<button type="button" class="shell-shop-card-btn" data-open-gift-source="' + escapeHtml(it.source) + '" data-open-gift-id="' + escapeHtml(it.id) + '">ABRIR</button>' +
    '</div>';
  }).join('');
  listEl.querySelectorAll('[data-open-gift-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-open-gift-id');
      var source = btn.getAttribute('data-open-gift-source');
      var item = pending.filter(function (it) { return it.id === id && it.source === source; })[0];
      if (!item) { return; }
      btn.disabled = true;
      btn.textContent = 'ABRIENDO…';
      var openPromise = source === 'code' ? openCodePackCloud(id) : openClaimedGiftCloud(id);
      openPromise.then(function (cards) {
        markGiftPackOpened(item);
        closeGiftBoosterModal();
        showBoosterResult(cards, item.gift.setKey || item.gift.packId);
        renderShopScreen();
        // The Novedades panel's own DOM was built before this open (its
        // "RECLAMADO" state doesn't change here, but re-rendering keeps
        // latestNewsItems' own mutation visible if the player goes back) --
        // cheap no-op otherwise.
        renderNewsPanel(latestNewsItems);
      }).catch(function (err) {
        if (err && err.code === 'functions/already-exists') {
          markGiftPackOpened(item);
          renderGiftBoosterModalList();
        } else {
          alert(err.message || 'No se pudo abrir el pack.');
          btn.disabled = false;
          btn.textContent = 'ABRIR';
        }
      });
    });
  });
}

// Marks a pending pack as opened in whichever underlying store it actually
// came from (see pendingGiftBoosters) so it stops showing as pending right
// away, instead of waiting for the next Firestore snapshot to confirm it.
function markGiftPackOpened(item) {
  if (item.source === 'news') {
    var newsItem = latestNewsItems.filter(function (it) { return it.id === item.id; })[0];
    if (newsItem) { newsItem.opened = true; }
  } else if (econState && econState.pendingCodePacks) {
    econState.pendingCodePacks = econState.pendingCodePacks.filter(function (p) { return p.code !== item.id; });
  }
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
    var cost = getProtectorCost(o.id);
    var footer = owned
      ? '<span class="shell-shop-card-owned-label">EN TU COLECCIÓN</span>'
      : '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 3) + pixelDigitsHtml(cost, 'oro', 3) + '</span>' +
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

// ===== Telegram Stars Orbes Shop =====
var STARS_SHOP_PACKAGES = [
  {
    id: 'orbes_100',
    title: '100 ORBES',
    subtitle: 'BOLSA BÁSICA',
    coins: 100,
    stars: 15,
    tag: null
  },
  {
    id: 'orbes_550',
    title: '550 ORBES',
    subtitle: 'SACO DE ORBES',
    coins: 550,
    stars: 65,
    tag: '+10% EXTRA'
  },
  {
    id: 'orbes_1400',
    title: '1,400 ORBES',
    subtitle: 'COFRE DE ORBES',
    coins: 1400,
    stars: 140,
    tag: '+16% EXTRA'
  },
  {
    id: 'orbes_3600',
    title: '3,600 ORBES',
    subtitle: 'TESORO DE LA LIGA',
    coins: 3600,
    stars: 320,
    tag: 'MEJOR VALOR · +20%'
  }
];

function renderOrbesShopGrid() {
  var grid = document.getElementById('shopOrbesGrid');
  if (!grid) { return; }

  var packages = getStarsShopPackages();
  grid.innerHTML = packages.map(function (pkg) {
    var tagHtml = pkg.tag ? '<div class="shell-shop-card-badge">' + escapeHtml(pkg.tag) + '</div>' : '';
    return '<div class="shell-shop-card shell-stars-card" data-package-id="' + pkg.id + '">' +
      tagHtml +
      '<div class="shell-shop-card-art stars-art">' +
        '<div class="shell-stars-orb-icon">' + pixelCoinHtml('oro', 6) + '</div>' +
      '</div>' +
      '<div class="shell-shop-card-text">' +
        '<div class="shell-shop-card-name">' + escapeHtml(pkg.title) + '</div>' +
        '<div class="shell-shop-card-desc">' + escapeHtml(pkg.subtitle || pkg.description || '') + '</div>' +
      '</div>' +
      '<div class="shell-shop-card-footer">' +
        '<span class="shell-stars-card-price">⭐️ ' + pkg.stars + ' STARS</span>' +
        '<button type="button" class="shell-shop-card-btn shell-stars-btn" data-buy-stars="' + pkg.id + '">COMPRAR</button>' +
      '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('[data-buy-stars]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-buy-stars');
      btn.disabled = true;
      btn.textContent = 'GENERANDO...';
      buyOrbesWithStars(id, function () {
        btn.disabled = false;
        btn.textContent = 'COMPRAR';
      });
    });
  });
}

function buyOrbesWithStars(packageId, onComplete) {
  if (!firebase.auth().currentUser) {
    alert('Debes iniciar sesión para comprar Orbes.');
    if (onComplete) { onComplete(); }
    return;
  }

  createStarsInvoiceCloud(packageId)
    .then(function (res) {
      if (onComplete) { onComplete(); }
      if (!res || !res.invoiceLink) {
        alert('No se pudo generar la factura en Telegram.');
        return;
      }

      // Check if running inside Telegram Mini App (TMA)
      if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openInvoice === 'function') {
        window.Telegram.WebApp.openInvoice(res.invoiceLink, function (status) {
          if (status === 'paid') {
            alert('¡Pago completado! Tus Orbes han sido acreditados a tu cuenta.');
          } else if (status === 'failed') {
            alert('El pago no pudo completarse.');
          }
        });
      } else {
        // In external web browser: open Telegram invoice link
        window.open(res.invoiceLink, '_blank');
        alert('Se ha abierto la factura en Telegram.\n\nCompleta el pago con tus Estrellas ⭐ y tus Orbes se acreditarán automáticamente en cuanto se confirme.');
      }
    })
    .catch(function (err) {
      if (onComplete) { onComplete(); }
      alert(err.message || 'Error al conectar con Telegram Stars.');
    });
}

// Tracks where the collection screen was opened from, mirroring shopReturnTo.
var collectionReturnTo = 'menu';
var collectionFilters = { search: '', rarity: null };

var COLLECTION_RARITIES = [
  { key: 'Common', label: 'COMÚN', color: '#8dff62' },
  { key: 'Uncommon', label: 'INFRECUENTE', color: '#8dff62' },
  { key: 'Rare', label: 'RARA', color: '#e8c46a' },
  { key: 'Rare Holo', label: 'HOLOGRÁFICA', color: '#ff8a72' },
  // basep/espromo (Wizards Black Star Promos + Special Promos) are all
  // catalogued with r:"Promo" (see data-sets.js) since they're gift-only,
  // never pulled from a real booster -- this is their own filter bucket
  // rather than folding them into "Rare" so a claimed gift card is easy to
  // find without implying it was a normal booster pull.
  { key: 'Promo', label: 'PROMO', color: '#c9a6ff' }
];

function showCollectionScreen(returnTo) {
  collectionReturnTo = returnTo;
  collectionFilters = { search: '', rarity: null };
  var searchInput = document.getElementById('collectionSearch');
  if (searchInput) { searchInput.value = ''; }
  document.getElementById('collectionScreen').classList.remove('hidden');
  playScreenMusic('Songs/Mi Colección.mp3');
  renderCollectionScreen();
}

function hideCollectionScreen() {
  document.getElementById('collectionScreen').classList.add('hidden');
}

// Flattens the 3-set catalog into one list, joined with real owned counts.
function collectionAllCards() {
  var all = [];
  CARD_SET_KEYS.forEach(function (setKey) {
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
  document.getElementById('boosterModalTitle').textContent = 'PACK ' + BOOSTER_NAMES[setKey].toUpperCase();
  // Real reported bug: this used to hardcode 100 regardless of the real
  // configured cost (getBoosterCost, same function the Tienda grid itself
  // already uses) -- an admin-set discount/price change on a pack showed
  // correctly on the shop card but reverted to a stale "100" the instant
  // this modal opened, right before the real (server-authoritative, see
  // economy.js's openBoosterCloud) charge went through.
  document.getElementById('boosterModalPrice').innerHTML = pixelDigitsHtml(getBoosterCost(setKey), 'oro', 2);
  document.getElementById('boosterModalGrid').innerHTML = html;
  document.getElementById('boosterOpenBtn').disabled = true;
  document.getElementById('boosterSelectedInfo').textContent = 'TOCA UN PACK PARA SELECCIONARLO';
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
      alert(err.message || 'No se pudo abrir el pack.');
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
  // Reused for news-gift reveals (see claimNewsGift/renderNewsPanel) --
  // 'basep'/'espromo' gift cards have no purchasable pack art in
  // BOOSTER_PACKS, so "ABRIR OTRO" has nothing real to reopen for them.
  boosterResultSetKey = BOOSTER_PACKS[setKey] ? setKey : null;
  document.getElementById('boosterResultAgain').style.display = boosterResultSetKey ? '' : 'none';
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
    pixelDigitsHtml(cards.length, 'fosforo', 3) + ' CARTA' + (cards.length === 1 ? '' : 'S') + ' NUEVA' + (cards.length === 1 ? '' : 'S');

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

  // Real reported bug: this used to ONLY ever mark the deck's own single
  // guaranteed Rare Holo (deckHoloCard, precons only) -- every other card
  // always rendered plain, regardless of whether the player's own
  // collection actually owns a holo or secret copy of it, and custom
  // decks (no deckHoloCard entry at all) never showed ANY foil. Same
  // precedence as the live match board (showCardInViewer/benchCardHtml/
  // activeColHtml, all via getPlayerCardFoilTier): the player's own real
  // owned tier wins when they have one, falling back to the deck's
  // guaranteed holo (precons only) otherwise.
  var deckHoloCard = { overgrowth: 'Gyarados', blackout: 'Hitmonchan', zap: 'Mewtwo', brushfire: 'Ninetales' }[deckKey];
  var html = expandDecklist(DECKLISTS[deckKey]).map(function (card) {
    var img = CARD_IMAGE_BY_NAME[card.name] || '';
    var foilTier = getPlayerCardFoilTier(card.name) || (card.name === deckHoloCard ? 'holo' : null);
    var tierClass = foilTier === 'secret' ? ' secret' : (foilTier === 'holo' ? ' holo' : '');
    var foilOverlay = foilTier === 'secret'
      ? '<div class="shell-secret-foil-a"></div><div class="shell-secret-foil-b"></div>' + holoStarsHtml()
      : (foilTier === 'holo' ? '<div class="shell-collection-cell-foil"></div>' + holoStarsHtml() : '');
    return '<div class="shell-deck-slot' + tierClass + '" data-card-name="' + escapeHtml(card.name) + '">' +
      (img ? '<img src="' + img + '" alt="' + escapeHtml(card.name) + '" loading="lazy">' : '') +
      foilOverlay +
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
    // deck.coverName (optional): a card name the player picked, from the
    // ones actually in this deck, as its cover photo (see the Deck
    // Builder's own PORTADA DEL MAZO box) -- falls back to the plain
    // initial-letter placeholder for a deck saved before this existed, or
    // one where the player never bothered picking a cover.
    var coverImg = deck.coverName && CARD_IMAGE_BY_NAME[deck.coverName];
    var artHtml = coverImg
      ? '<div class="shell-deck-card-art"><img src="' + coverImg + '" alt="" loading="lazy"></div>'
      : '<div class="shell-deck-card-art shell-deck-card-art-placeholder">' + escapeHtml((deck.name || '?').charAt(0).toUpperCase()) + '</div>';
    el.innerHTML =
      '<div class="shell-deck-card-stripe deck-placeholder"></div>' +
      artHtml +
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
  playScreenMusic('Songs/Deck Builder Serenade.mp3');
}
function hideDecksScreen() {
  document.getElementById('decksScreen').classList.add('hidden');
}

// ── Mazo inicial obligatorio (una sola vez, cuenta nueva) ─────────────
function showStarterDeckScreen() {
  document.getElementById('menuScreen').classList.add('hidden');
  document.getElementById('starterDeckScreen').classList.remove('hidden');
}

function hideStarterDeckScreen() {
  document.getElementById('starterDeckScreen').classList.add('hidden');
}

var starterDeckPendingChoice = null;

function wireStarterDeckScreen() {
  document.querySelectorAll('.shell-starter-deck-pick-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var deckKey = btn.getAttribute('data-starter-deck');
      starterDeckPendingChoice = deckKey;
      var name = DECK_DISPLAY_NAME[deckKey] || deckKey;
      document.getElementById('starterDeckConfirmText').textContent =
        'Vas a elegir ' + name + ' como tu mazo inicial. Esta elección es permanente y no podrás cambiarla después. ¿Confirmas?';
      document.getElementById('starterDeckConfirmModal').classList.remove('hidden');
    });
  });

  document.getElementById('starterDeckConfirmNo').addEventListener('click', function () {
    starterDeckPendingChoice = null;
    document.getElementById('starterDeckConfirmModal').classList.add('hidden');
  });

  document.getElementById('starterDeckConfirmYes').addEventListener('click', function () {
    if (!starterDeckPendingChoice) { return; }
    var deckKey = starterDeckPendingChoice;
    var yesBtn = document.getElementById('starterDeckConfirmYes');
    yesBtn.disabled = true;
    chooseStarterDeckCloud(deckKey)
      .then(function (res) {
        if (econState) {
          econState.collection = res.collection;
          econState.starterDeckChosen = deckKey;
          econState.activeDeck = deckKey;
        }
        yesBtn.disabled = false;
        document.getElementById('starterDeckConfirmModal').classList.add('hidden');
        hideStarterDeckScreen();
        showMenu();
      })
      .catch(function (e) {
        yesBtn.disabled = false;
        document.getElementById('starterDeckConfirmText').textContent =
          (e && e.message) || 'No se pudo guardar tu elección. Intenta de nuevo.';
      });
  });
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

// Deck-building eligibility is Base Set only -- CARD_STATS (data-cards.js)
// only ever implemented Base's own 102 cards, never Jungle or Fossil (real,
// collectible, purchasable sets, just with no actual playable rules behind
// them here). Real reported bug: this used to include jungle/fossil too,
// so owning ONLY a Jungle-print copy of a name that happens to also exist
// in Base (Pikachu is a genuinely different real card in each, not a
// reprint) still made that name deck-buildable, using Base's own gameplay
// stats for a card this game never actually implemented. Matches
// DECK_LEGAL_SET_KEYS/DECK_LEGAL_CARD_CATALOG, functions/index.js's
// server-side equivalent (saveCustomDeck) -- kept as a literal list here
// too rather than a shared constant, same as every other CARD_SET_KEYS-
// adjacent literal in this file (see CARD_SET_KEYS's own comment).
var DECK_LEGAL_SET_KEYS = ['base'];

// {cardName: totalOwnedCount}, aggregated across every deck-legal set/tier
// -- deck-building rules are name-based, not print-based (see
// ownedCountsByName, functions/lib/pureEconomy.js, the server-side
// equivalent of this).
function ownedCountsByNameClient() {
  var owned = {};
  if (!econState) { return owned; }
  DECK_LEGAL_SET_KEYS.forEach(function (setKey) {
    CARD_CATALOG[setKey].forEach(function (c) {
      var count = econState.collection[setKey + '-' + c.num] || 0;
      if (count > 0) { owned[c.n] = (owned[c.n] || 0) + count; }
    });
  });
  return owned;
}

// {cardName: {total: N, tiers: [{count, holo, secret, img}]}} -- per-name
// tier breakdown so the deck builder pool can show foil indicators and the
// version modal can offer tier-specific adds. Deck-legal sets only, same
// reason as ownedCountsByNameClient above.
// Each tier carries its own real print's img -- real reported bug: a name
// shared across more than one set used to have every tier here collapse to
// plain {count, holo, secret} with no idea which print it came from, so
// openDeckBuilderVersionModal fell back to a single by-name image lookup
// for the whole modal -- CARD_IMAGE_BY_NAME's own first-wins order ('base'
// first) meant a Jungle print always displayed with Base's art instead of
// its own. Now moot for deck-legal sets (there's only one), but kept for
// any future deck-legal set that shares a name with a non-legal one.
function ownedTiersByNameClient() {
  var result = {};
  if (!econState) { return result; }
  DECK_LEGAL_SET_KEYS.forEach(function (setKey) {
    CARD_CATALOG[setKey].forEach(function (c) {
      var key = setKey + '-' + c.num;
      var total = econState.collection[key] || 0;
      if (total <= 0) { return; }
      var secretCount = (econState.collectionSecret[key] || 0);
      var holoCount = (econState.collectionHolo[key] || 0);
      var plainCount = total - secretCount - holoCount;
      if (!result[c.n]) { result[c.n] = { total: 0, tiers: [] }; }
      result[c.n].total += total;
      if (plainCount > 0) { result[c.n].tiers.push({ count: plainCount, holo: false, secret: false, img: c.img }); }
      if (holoCount > 0) { result[c.n].tiers.push({ count: holoCount, holo: true, secret: false, img: c.img }); }
      if (secretCount > 0) { result[c.n].tiers.push({ count: secretCount, holo: false, secret: true, img: c.img }); }
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
// supertypeFilter: null (no filter) or 'Pokémon'/'Trainer'/'Energy' --
// single-select, same toggle-off-on-repeat-click UX as Mi Colección's own
// rarity filter (renderCollectionScreen). typeFilters: [] (no filter) or a
// list of CARD_STATS types[] values (e.g. ['Fire','Water']) -- multi-select
// (a Pokémon pool card matches if its type is in this list), since the
// user asked to filter by "tipo o tipos" (one or several types at once).
var deckBuilderState = null;

// initialCards: [{name, count}] (a precon's DECKLISTS entry, an existing
// custom deck's saved cards, or [] for a blank "Nuevo Mazo"). slot: null or
// an existing 'custom-N' (EDITAR only -- DUPLICAR always passes null, even
// when duplicating an existing custom deck, since that's still a NEW deck).
// initialCoverName: the previously-chosen cover card's name (EDITAR/
// DUPLICAR), or null/undefined for a blank "Nuevo Mazo".
function showDeckBuilderScreen(initialCards, slot, initialName, initialCoverName) {
  var cards = {};
  (initialCards || []).forEach(function (c) { cards[c.name] = c.count; });
  deckBuilderState = { slot: slot, cards: cards, tiers: {}, search: '', coverName: initialCoverName || null, supertypeFilter: null, typeFilters: [] };
  document.getElementById('deckBuilderName').value = initialName || '';
  document.getElementById('deckBuilderSearch').value = '';
  hideDecksScreen();
  document.getElementById('deckBuilderScreen').classList.remove('hidden');
  renderDeckBuilderCover();
  renderDeckBuilderScreen();
}
function hideDeckBuilderScreen() {
  document.getElementById('deckBuilderScreen').classList.add('hidden');
  deckBuilderState = null;
}

// PORTADA DEL MAZO: pick a cover photo from among the cards CURRENTLY in
// the deck-in-progress -- reuses openDeckSearchModal (already source-
// agnostic, just needs {id, name} objects) with id set to the card's own
// name, since these are plain distinct names, not real per-instance ids.
function renderDeckBuilderCover() {
  var s = deckBuilderState;
  // A card removed from the deck-in-progress can no longer be its cover --
  // clear it rather than keep showing a photo for something not actually
  // in the deck.
  if (s.coverName && !(s.cards[s.coverName] > 0)) { s.coverName = null; }
  var btn = document.getElementById('deckBuilderCoverBtn');
  var img = s.coverName && CARD_IMAGE_BY_NAME[s.coverName];
  btn.innerHTML = img
    ? '<img src="' + img + '" alt="' + escapeHtml(s.coverName) + '">'
    : '<span class="shell-deck-builder-cover-placeholder">+<br>ELEGIR<br>FOTO</span>';
}

function openDeckBuilderCoverPicker() {
  var s = deckBuilderState;
  var namesInDeck = Object.keys(s.cards).filter(function (name) { return s.cards[name] > 0; });
  if (namesInDeck.length === 0) {
    logEvent(gameState, 'Agrega cartas a tu mazo antes de elegir una portada', 'player');
    return;
  }
  var pool = namesInDeck.map(function (name) { return { id: name, name: name }; });
  openDeckSearchModal(pool, function (chosenName) {
    s.coverName = chosenName;
    renderDeckBuilderCover();
  });
}

// Opens a version-picker modal for a card with 2+ owned tiers. Each tier
// is a clickable .shell-collection-cell showing that tier's art + foil +
// count. Clicking one adds the card to the deck with that specific tier
// chosen (tracked in deckBuilderState.tiers[name] for display purposes).
function openDeckBuilderVersionModal(cardName, tiers) {
  document.getElementById('deckBuilderVersionTitle').textContent = translateCardName(cardName);
  var grid = document.getElementById('deckBuilderVersionGrid');
  grid.innerHTML = tiers.map(function (t) {
    var isSecret = t.secret;
    var isHolo = t.holo && !isSecret;
    var tierClass = isSecret ? ' secret' : (isHolo ? ' holo' : '');
    var tierLabel = isSecret ? 'SECRETA' : (isHolo ? 'HOLOGRÁFICA' : 'RARA');
    var tierCls = isSecret ? ' secret' : (isHolo ? ' holo' : '');
    // Real reported bug: this used to show one shared CARD_IMAGE_BY_NAME
    // lookup for every tier tile, which for a name owned across more than
    // one real set (e.g. Pikachu: a genuinely different card in Base vs
    // Jungle) always rendered Base's art on every tile, even a Jungle-print
    // copy -- see ownedTiersByNameClient's own comment. t.img is that
    // specific tier's own real print now.
    var img = t.img || '';
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

var DECK_BUILDER_SUPERTYPES = [
  { key: 'Pokémon', label: 'POKÉMON' },
  { key: 'Trainer', label: 'ENTRENADOR' },
  { key: 'Energy', label: 'ENERGÍA' }
];

// Single-select supertype filter (Pokémon / Entrenador / Energía) for the
// deck builder pool -- same toggle-off-on-repeat-click UX as Mi Colección's
// own rarity filter (renderCollectionScreen). ownedNames: the pool's full
// owned+deck-legal name list, unfiltered by search/typeFilters -- counts
// here are static per category, same convention as the rarity filter's own
// counts (against the full collection, not the currently-typed search).
function renderDeckBuilderSupertypeFilter(ownedNames) {
  var s = deckBuilderState;
  var html = DECK_BUILDER_SUPERTYPES.map(function (st) {
    var count = ownedNames.filter(function (name) { return CARD_STATS[name].supertype === st.key; }).length;
    var active = s.supertypeFilter === st.key;
    return '<button type="button" class="shell-collection-rarity-row' + (active ? ' active' : '') + '" data-supertype="' + st.key + '">' +
      '<span class="shell-collection-rarity-name">' + st.label + '</span>' +
      '<span class="shell-collection-rarity-count">' + count + '</span>' +
      '</button>';
  }).join('');
  var list = document.getElementById('deckBuilderSupertypeList');
  list.innerHTML = html;
  list.querySelectorAll('.shell-collection-rarity-row').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-supertype');
      s.supertypeFilter = s.supertypeFilter === key ? null : key;
      renderDeckBuilderScreen();
    });
  });
}

// Multi-select Pokémon-type filter for the deck builder pool -- unlike the
// supertype filter above, more than one type can be active at once (a pool
// card matches if it has ANY of the selected types), per the user's
// explicit ask to filter by "tipo o tipos" (one or several types at once).
// Reuses ENERGY_CARD_TYPE_ICON/BUZZAP_TYPE_NAME_ES rather than a new
// lookup -- same 7 real types, same icons, already defined for the
// Buzzap/energy-badge UI elsewhere in this file.
function renderDeckBuilderTypeFilter(ownedNames) {
  var s = deckBuilderState;
  var html = Object.keys(ENERGY_CARD_TYPE_ICON).map(function (type) {
    var count = ownedNames.filter(function (name) { return (CARD_STATS[name].types || []).indexOf(type) !== -1; }).length;
    var active = s.typeFilters.indexOf(type) !== -1;
    var label = BUZZAP_TYPE_NAME_ES[type];
    return '<button type="button" class="shell-deck-builder-type-badge' + (active ? ' active' : '') + '" data-type="' + type + '" title="' + label + '">' +
      '<img src="Tipos/' + ENERGY_CARD_TYPE_ICON[type] + '.png" alt="' + label + '">' +
      '<span class="shell-deck-builder-type-badge-count">' + count + '</span>' +
      '</button>';
  }).join('');
  var list = document.getElementById('deckBuilderTypeList');
  list.innerHTML = html;
  list.querySelectorAll('.shell-deck-builder-type-badge').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var type = btn.getAttribute('data-type');
      var idx = s.typeFilters.indexOf(type);
      if (idx === -1) { s.typeFilters.push(type); } else { s.typeFilters.splice(idx, 1); }
      renderDeckBuilderScreen();
    });
  });
}

function renderDeckBuilderScreen() {
  var s = deckBuilderState;
  var total = deckBuilderTotal();
  document.getElementById('deckBuilderCount').textContent = total + '/' + DECK_BUILDER_SIZE + ' CARTAS';
  renderDeckBuilderCover();

  var tierData = ownedTiersByNameClient();
  var ownedNames = Object.keys(tierData).filter(function (name) { return !!CARD_STATS[name]; });
  renderDeckBuilderSupertypeFilter(ownedNames);
  renderDeckBuilderTypeFilter(ownedNames);

  var search = s.search.toLowerCase();
  var poolNames = ownedNames.filter(function (name) {
    if (search && translateCardName(name).toLowerCase().indexOf(search) === -1) { return false; }
    if (s.supertypeFilter && CARD_STATS[name].supertype !== s.supertypeFilter) { return false; }
    if (s.typeFilters.length) {
      var types = CARD_STATS[name].types || [];
      if (!types.some(function (t) { return s.typeFilters.indexOf(t) !== -1; })) { return false; }
    }
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
  var coverName = deckBuilderState.coverName || null;
  var status = document.getElementById('deckBuilderStatus');
  var saveBtn = document.getElementById('deckBuilderSaveBtn');

  function doSave(slot) {
    saveBtn.disabled = true;
    status.textContent = 'GUARDANDO...';
    saveCustomDeckCloud(slot, name, cards, coverName)
      .then(function () {
        if (econState) {
          econState.customDecks = Object.assign({}, econState.customDecks);
          econState.customDecks[slot] = { name: name, cards: cards, coverName: coverName };
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
var pvpLiveDuelRoomCode = null;
// Duelo en Vivo: shared by showMenu() (in-app navigation back to the menu)
// AND auth-ui.js's onAuthStateChanged handler (the menu's very FIRST
// appearance after a fresh page load/refresh -- that path used to set
// #menuScreen visible directly, never calling showMenu() at all, so a
// player who refreshed mid-crash to reach exactly this screen never had
// their active match looked up the one time it mattered most).
function checkLiveDuelBanner() {
  getActiveMatchCloud().then(function (res) {
    pvpLiveDuelRoomCode = res.roomCode;
    document.getElementById('menuLiveDuelBtn').classList.toggle('hidden', !res.roomCode);
  }).catch(function () {
    // Best-effort UI convenience -- a failed lookup just means the banner
    // doesn't show this time, same as it wouldn't if there genuinely were
    // no active match. Never blocks the menu from showing.
  });
}
function showMenu() {
  document.getElementById('menuScreen').classList.remove('hidden');
  playScreenMusic('Songs/Login_Screen_Main_Menu_3.mp3');
  checkLiveDuelBanner();
}
function hideMenu() {
  document.getElementById('menuScreen').classList.add('hidden');
}

// ── PVP: sala (crear/unirse) ──────────────────────────────────────
// Minimal deck picker for PVP room setup: precon keys + the player's own
// saved custom decks (same universe validateDeckId, functions/index.js,
// accepts) -- reuses PRECON_DECK_KEYS/DECK_DISPLAY_NAME/econState.customDecks,
// already available client-side (see registerCustomDecks, ui.js:3309) --
// deliberately NOT reusing the full Decks screen's rich card list/detail
// view, just enough to pick a deckId.
// Same box art/stripe-color/types-label the real "Mi Mazo" screen already
// uses for these 4 precons (index.html's own static #decksScreen markup) --
// mirrored here so the PVP picker looks and feels like the rest of the app
// instead of a plain list of text buttons.
var PRECON_DECK_ART = {
  overgrowth: { img: 'Mazos/overgrowth.png', stripe: 'deck-overgrowth', types: 'PLANTA · AGUA' },
  blackout: { img: 'Mazos/blackout.png', stripe: 'deck-blackout', types: 'AGUA · LUCHA' },
  zap: { img: 'Mazos/zap.png', stripe: 'deck-zap', types: 'RAYO · PSÍQUICO' },
  brushfire: { img: 'Mazos/brushfire.png', stripe: 'deck-brushfire', types: 'FUEGO · PLANTA' }
};
function renderPvpDeckPicker(containerId, onPicked) {
  var el = document.getElementById(containerId);
  if (!el) { return; }
  var options = PRECON_DECK_KEYS.map(function (key) {
    var art = PRECON_DECK_ART[key] || {};
    return { id: key, label: DECK_DISPLAY_NAME[key] || key, img: art.img, stripe: art.stripe || '', types: art.types || '' };
  });
  var saved = (econState && econState.customDecks) || {};
  CUSTOM_DECK_SLOTS.forEach(function (slot) {
    if (saved[slot]) {
      var deck = saved[slot];
      options.push({
        id: 'custom:' + slot, label: deck.name, types: 'MAZO PERSONALIZADO',
        img: deck.coverName && CARD_IMAGE_BY_NAME[deck.coverName]
      });
    }
  });
  el.innerHTML = '<div class="pvp-deck-grid">' + options.map(function (o) {
    var artHtml = o.img
      ? '<div class="shell-deck-card-art"><img src="' + escapeHtml(o.img) + '" alt="" loading="lazy"></div>'
      : '<div class="shell-deck-card-art shell-deck-card-art-placeholder">' + escapeHtml((o.label || '?').charAt(0).toUpperCase()) + '</div>';
    return '<button type="button" class="shell-deck-card pvp-deck-option" data-pvp-deck-id="' + escapeHtml(o.id) + '" aria-pressed="false">' +
      (o.stripe ? '<div class="shell-deck-card-stripe ' + o.stripe + '"></div>' : '') +
      artHtml +
      '<div class="shell-deck-card-body">' +
        '<div class="shell-deck-card-name">' + escapeHtml((o.label || '').toUpperCase()) + '</div>' +
        '<div class="shell-deck-card-types">' + escapeHtml(o.types) + '</div>' +
      '</div>' +
      '<span class="pvp-deck-option-state">ELEGIR</span>' +
      '</button>';
  }).join('') + '</div>' +
    '<div class="pvp-deck-confirm-bar"><span data-pvp-selection>SELECCIONA UN MAZO PARA CONTINUAR</span>' +
    '<button type="button" data-pvp-confirm disabled>CONFIRMAR MAZO <b>→</b></button></div>';
  var selectedDeckId = null;
  var selection = el.querySelector('[data-pvp-selection]');
  var confirm = el.querySelector('[data-pvp-confirm]');
  el.querySelectorAll('[data-pvp-deck-id]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectedDeckId = btn.getAttribute('data-pvp-deck-id');
      el.querySelectorAll('[data-pvp-deck-id]').forEach(function (option) {
        var selected = option === btn;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      selection.textContent = 'MAZO SELECCIONADO: ' + btn.querySelector('.shell-deck-card-name').textContent;
      confirm.disabled = false;
    });
  });
  confirm.addEventListener('click', function () {
    if (!selectedDeckId) { return; }
    confirm.disabled = true;
    confirm.textContent = 'CONFIRMANDO…';
    var result = onPicked(selectedDeckId);
    if (result && typeof result.catch === 'function') {
      result.catch(function () {
        confirm.disabled = false;
        confirm.innerHTML = 'CONFIRMAR MAZO <b>→</b>';
      });
    }
  });
}

// Resolves a deckId (as stored on the rooms/{roomCode} doc's hostDeckId/
// guestDeckId fields) to display art -- precons resolve the same for any
// viewer (PRECON_DECK_ART is a fixed table), but a custom deck only
// resolves when it's MY OWN (econState.customDecks is scoped to the signed-
// in user by firestore.rules, same as everywhere else in this file) --
// there is no server-side plumbing (unlike hostPhoto/guestPhoto below) to
// see the OPPONENT's custom deck art, so that case falls back to null and
// the caller just leaves that deck slot hidden.
// coverNameOverride: for a CUSTOM deck that isn't the local player's own
// (the PVP opponent's), econState.customDecks has no entry for it at all --
// that object only ever holds MY OWN saved decks. The caller passes the
// cover card's name straight from the room doc instead (hostDeckCoverName/
// guestDeckCoverName, captured server-side at createRoom/joinRoom) so it
// can still be resolved through the same CARD_IMAGE_BY_NAME lookup. Omit it
// (or pass a falsy value) for MY OWN deck, where the local lookup already
// works.
function pvpDeckArtFor(deckId, coverNameOverride) {
  if (!deckId) { return null; }
  var art = PRECON_DECK_ART[deckId];
  if (art) { return { img: art.img }; }
  if (deckId.indexOf('custom:') === 0) {
    var coverName = coverNameOverride;
    if (!coverName) {
      var slot = deckId.slice('custom:'.length);
      var saved = (econState && econState.customDecks) || {};
      var deck = saved[slot];
      coverName = deck && deck.coverName;
    }
    if (coverName && CARD_IMAGE_BY_NAME[coverName]) {
      return { img: CARD_IMAGE_BY_NAME[coverName] };
    }
  }
  return null;
}

function setPvpWaitingDeckSlot(wrapId, imgId, deckId, coverNameOverride) {
  var wrap = document.getElementById(wrapId);
  var art = pvpDeckArtFor(deckId, coverNameOverride);
  if (art) {
    document.getElementById(imgId).src = art.img;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

// Called the instant the "esperando a un rival" screen appears (both for
// the host, right after creating the room, and the guest, right after
// joining it) -- shows MY OWN photo/deck immediately since those never
// depend on the network round-trip, and resets the opponent slot to its
// unknown state (spinner, no deck) until a room snapshot says otherwise.
function renderPvpWaitingMine(deckId) {
  document.getElementById('pvpWaitingMyPhoto').src = playerPhotoUrl();
  document.getElementById('pvpCreateWaitingName').textContent = playerDisplayName();
  setPvpWaitingDeckSlot('pvpWaitingMyDeckWrap', 'pvpWaitingMyDeckArt', deckId);
  document.getElementById('pvpWaitingOpponentSpinner').classList.remove('hidden');
  document.getElementById('pvpWaitingOpponentPhoto').classList.add('hidden');
  document.getElementById('pvpWaitingOpponentName').textContent = 'ESPERANDO…';
  document.getElementById('pvpWaitingOpponentDeckWrap').classList.add('hidden');
  // Ready state always starts fresh here (red ✕ + "ESPERANDO" on both sides,
  // Iniciar hidden) -- renderPvpWaitingReadyState takes over from the very
  // first room snapshot onward.
  document.getElementById('pvpWaitingMyStatus').textContent = 'ESPERANDO';
  document.getElementById('pvpWaitingOpponentStatus').textContent = 'ESPERANDO';
  setPvpReadyBadge('pvpWaitingMyReadyBadge', false);
  setPvpReadyBadge('pvpWaitingOpponentReadyBadge', false);
  var startBtn = document.getElementById('pvpStartMatchBtn');
  startBtn.classList.add('hidden');
  startBtn.disabled = false;
  document.getElementById('pvpStartHint').classList.add('hidden');
}

// Red ✕ / green ✓ next to a waiting-room player's status text (see the
// .pvp-ready-badge CSS rule, shell-theme.css). Only visual state, never the
// source of truth -- that's always the room doc's hostReady/guestReady,
// re-applied here on every snapshot by renderPvpWaitingReadyState.
function setPvpReadyBadge(elId, isReady) {
  var el = document.getElementById(elId);
  el.textContent = isReady ? '✓' : '✕';
  el.classList.toggle('is-ready', isReady);
}

// Fired on every rooms/{roomCode} snapshot (initPvpRoomListener, alongside
// renderPvpWaitingOpponentFromRoom) -- renders both sides' ready badges/
// status text from room.hostReady/guestReady, and shows the local "Iniciar"
// button only once the opponent has actually joined (oppUid present).
// Per user request, the match no longer starts the instant the second
// player picks a deck: each side must explicitly click Iniciar (which
// calls setReadyCloud, wired below) -- the room only flips to 'started'
// once BOTH sides have done so (functions/index.js's setReady).
function renderPvpWaitingReadyState(room) {
  var myUid = firebase.auth().currentUser && firebase.auth().currentUser.uid;
  var iAmHost = room.hostUid === myUid;
  var oppUid = iAmHost ? room.guestUid : room.hostUid;
  var myReady = !!(iAmHost ? room.hostReady : room.guestReady);
  var oppReady = !!(iAmHost ? room.guestReady : room.hostReady);

  setPvpReadyBadge('pvpWaitingMyReadyBadge', myReady);
  document.getElementById('pvpWaitingMyStatus').textContent = myReady ? 'LISTO' : 'ESPERANDO';

  var startBtn = document.getElementById('pvpStartMatchBtn');
  var startHint = document.getElementById('pvpStartHint');
  if (!oppUid) {
    // Real reported bug: a rival leaving (SALIR) after a match, while I'd
    // already pressed "VOLVER A JUGAR" and was sitting on this waiting
    // screen, used to leave their ready badge/status frozen on whatever it
    // showed right before they left -- this early return never reset it
    // back to the same "nobody's here yet" state renderPvpWaitingMine sets
    // up initially.
    setPvpReadyBadge('pvpWaitingOpponentReadyBadge', false);
    document.getElementById('pvpWaitingOpponentStatus').textContent = 'ESPERANDO';
    startBtn.classList.add('hidden');
    startHint.classList.add('hidden');
    return;
  }
  setPvpReadyBadge('pvpWaitingOpponentReadyBadge', oppReady);
  document.getElementById('pvpWaitingOpponentStatus').textContent = oppReady ? 'LISTO' : 'ESPERANDO';

  startBtn.classList.remove('hidden');
  startBtn.disabled = myReady;
  startHint.classList.toggle('hidden', !myReady);
}

// Fired on every rooms/{roomCode} snapshot (initPvpRoomListener) while the
// waiting screen is up -- fills in the opponent's real photo/name/deck the
// moment they've joined (room.guestUid or, for the guest's own brief look
// at this same screen, room.hostUid is already present from the very first
// snapshot). hostPhoto/guestPhoto fall back to the same default trainer
// avatar any player without a custom photo gets (PROFILE_PHOTO_URL.player)
// -- the opponent here is always a real human, never the local CPU bot, so
// falling back to PROFILE_PHOTO_URL.cpu (as this used to) showed a real
// person as the bot avatar whenever they hadn't set a custom photo.
function renderPvpWaitingOpponentFromRoom(room) {
  var myUid = firebase.auth().currentUser && firebase.auth().currentUser.uid;
  var iAmHost = room.hostUid === myUid;
  var oppUid = iAmHost ? room.guestUid : room.hostUid;
  if (!oppUid) {
    // Real reported bug: this used to just return, leaving the rival's
    // STALE photo/name on screen forever once they left (SALIR) -- the
    // server now actually vacates a departed guest's slot (party/index.js's
    // 'leaveRoom' case), but nothing here ever reset the DISPLAY back to
    // the same placeholder/spinner state renderPvpWaitingMine originally
    // set up, so the room visibly looked "full" even once it was open
    // again for a new rival.
    document.getElementById('pvpWaitingOpponentSpinner').classList.remove('hidden');
    document.getElementById('pvpWaitingOpponentPhoto').classList.add('hidden');
    document.getElementById('pvpWaitingOpponentName').textContent = 'ESPERANDO…';
    document.getElementById('pvpWaitingOpponentDeckWrap').classList.add('hidden');
    return;
  }
  var oppName = iAmHost ? room.guestUsername : room.hostUsername;
  var oppPhoto = (iAmHost ? room.guestPhoto : room.hostPhoto) || PROFILE_PHOTO_URL.player;
  var oppDeckId = iAmHost ? room.guestDeckId : room.hostDeckId;
  // Cover art for a CUSTOM deck (unlike a precon) lives in the deck owner's
  // own econState.customDecks, which this client never has for the
  // opponent's account -- hostDeckCoverName/guestDeckCoverName (captured
  // server-side at createRoom/joinRoom, see functions/index.js) carry it
  // across instead, same pattern as hostUsername/hostPhoto above.
  var oppDeckCoverName = iAmHost ? room.guestDeckCoverName : room.hostDeckCoverName;
  document.getElementById('pvpWaitingOpponentSpinner').classList.add('hidden');
  var oppImg = document.getElementById('pvpWaitingOpponentPhoto');
  oppImg.src = oppPhoto;
  oppImg.classList.remove('hidden');
  document.getElementById('pvpWaitingOpponentName').textContent = oppName || 'Rival';
  // Ready/not-ready status text is owned by renderPvpWaitingReadyState
  // (called right alongside this from the same room-snapshot callback) --
  // this function only ever fills in identity/deck art.
  setPvpWaitingDeckSlot('pvpWaitingOpponentDeckWrap', 'pvpWaitingOpponentDeckArt', oppDeckId, oppDeckCoverName);
}

var pvpActiveMatchId = null;
var pvpMySide = null; // 'player1' | 'player2'
var pvpMatchUnsubscribe = null;
var pvpMode = false;
// Set at both deck-picker callback sites (pvpCreateRoomBtn/pvpJoinCodeInput
// below) -- kept around (deliberately NOT cleared by resetPvpMatchState)
// so a later "VOLVER A JUGAR" rematch, or a guest becoming the new room
// owner after the old one left, can reuse the same deck without asking
// again. See matchEndReplayBtn's own comment for the full rematch flow.
var pvpCurrentDeckId = null;
// Firestore's onSnapshot can re-deliver a snapshot after the match has
// already ended (e.g. on reconnect) -- guards finishMatch/awardMatchResultCloud
// against firing more than once for the same match.
var pvpMatchEnded = false;
// Guards startDuelMusic() (processPvpMatchSnapshot) against restarting the
// track from 0:00 on every single snapshot once phase is 'playing' -- it
// must fire exactly once, the instant BOTH sides have pressed INICIAR
// DUELO, not on every subsequent action's snapshot.
var pvpDuelMusicStarted = false;
// Real reported bug: local play shows a hint the instant the board appears
// in 'setup' phase ("Coloca tu Pokémon Activo..."), but PVP showed nothing
// at all -- fires once per match, the first snapshot seen in 'setup'.
var pvpSetupHintShown = false;
// Real reported bug: local play flashes a big "TU TURNO"/"TURNO DEL RIVAL"
// banner every time control changes hands (showTurnFlash) -- PVP only ever
// had the small header text (boardTurnValue), never this. null until the
// first 'playing'-phase snapshot is seen, so the very first snapshot never
// spuriously flashes (nothing actually "changed" yet).
var pvpLastActivePlayerId = null;

// Real reported bug: PVP had no real, ticking clock at all. pvpClockTickInterval
// drives a lightweight re-render of just the two #sideClock-player/
// #sideClock-cpu elements (sideHeaderHtml) between real snapshots,
// computing the live remaining time from
// pub.timeBank/pub.turnStartedAt (Task 1) the same way local play's own
// tickGameClock computes it from local gameState -- corrected fresh every
// time a real snapshot arrives (pvpLatestPub, set on every snapshot,
// mirrors pvpRpsLatestMatchData's own "always current" role for the other
// reveal gates).
var pvpClockTickInterval = null;
var pvpLatestPub = null;
// Guards claimTimeout from being sent more than once per observed
// timeout -- reset every time a NEW turnStartedAt is seen (a real turn
// handoff happened), so it can fire again for a later, different timeout.
var pvpClaimedTimeoutFor = null;

function tickPvpClocks() {
  if (!pvpLatestPub || pvpLatestPub.phase !== 'playing' || !pvpLatestPub.activePlayerId ||
      !pvpLatestPub.timeBank || !pvpLatestPub.turnStartedAt) { return; }
  var hostMs = pvpLatestPub.timeBank.player1;
  var guestMs = pvpLatestPub.timeBank.player2;
  var elapsedSinceStart = Date.now() - pvpLatestPub.turnStartedAt;
  if (pvpLatestPub.activePlayerId === 'player1') { hostMs = Math.max(0, hostMs - elapsedSinceStart); }
  else { guestMs = Math.max(0, guestMs - elapsedSinceStart); }
  // pvpMySide/'player'/'cpu' -- same viewer-relative mapping buildPvpGameState
  // already uses everywhere else in this file.
  var myMs = pvpMySide === 'player1' ? hostMs : guestMs;
  var rivalMs = pvpMySide === 'player1' ? guestMs : hostMs;
  var myEl = document.getElementById('sideClock-player');
  var rivalEl = document.getElementById('sideClock-cpu');
  // Real reported bug: renderClockDisplay's isCpu param was originally
  // meant for local play's single CPU-vs-player clock ("whose time is
  // this" -> red for the CPU, gold for the player) -- passing it based on
  // "is this side active right now" here meant a viewer's OWN clock turned
  // red the instant it wasn't their turn (frozen, still plenty of time
  // left), while their rival's turned red on the viewer's own turn --
  // losing the real "you're running low" warning entirely. Per user
  // request, PVP never passes isCpu at all: both clocks stay gold, turning
  // red only via renderClockDisplay's own internal `low` threshold
  // (<=30s), regardless of whose turn it is.
  if (myEl) { renderClockDisplay(myEl, myMs, false, SIDE_CLOCK_BLOCK_PX); }
  if (rivalEl) { renderClockDisplay(rivalEl, rivalMs, false, SIDE_CLOCK_BLOCK_PX); }

  var activeMs = pvpLatestPub.activePlayerId === 'player1' ? hostMs : guestMs;
  if (activeMs <= 0 && pvpClaimedTimeoutFor !== pvpLatestPub.turnStartedAt) {
    pvpClaimedTimeoutFor = pvpLatestPub.turnStartedAt;
    submitMatchActionCloud(pvpActiveMatchId, { type: 'claimTimeout' }).catch(function () {});
  }
}

// Rock-paper-scissors reveal gate (see renderRpsReveal/processPvpMatchSnapshot
// below) -- pub.rpsRound (rules-engine.js) increments every time a round
// resolves (tie or real winner). pvpRpsRevealedRound tracks the last round
// this client has already shown a reveal for, so a re-delivered snapshot
// (reconnect, etc.) never replays it. pvpRpsRevealTimer is non-null exactly
// while the reveal is on screen -- new snapshots that land during that
// window are stashed in pvpRpsLatestMatchData instead of being acted on
// immediately, so the reveal always gets its full time on screen even if
// the match has already moved on server-side.
var pvpRpsRevealedRound = 0;
var pvpRpsRevealTimer = null;
var pvpRpsLatestMatchData = null;

// Sibling to the RPS-reveal gate above, same shape -- lastTrainerPlay.round
// (party/index.js) increments every successful playTrainer action; this
// tracks the last round already shown so a re-delivered snapshot (e.g. on
// reconnect) never replays a reveal that already happened.
var pvpTrainerRevealedRound = 0;

// Sibling to pvpTrainerRevealedRound above, same shape -- lastPowerUse.round
// (party/index.js) increments every successful usePower action.
var pvpPowerRevealedRound = 0;

// Sibling to pvpTrainerRevealedRound above, same shape -- lastAttackResult.round
// (party/index.js) increments every successful attack action (special-
// effect or vanilla); this tracks the last round already shown so a
// re-delivered snapshot never replays a reveal that already happened.
var pvpAttackRevealedRound = 0;

// Real reported bug: all 4 *RevealedRound watermarks above reset to 0 on
// every enterPvpMatch call, including a Duelo en Vivo reconnect -- so the
// FIRST snapshot after reconnecting always looked "new" for whatever
// round each already sat at server-side (an attack the OTHER player made
// while this player was disconnected, or even one from before they ever
// disappeared), replaying it right as the reconnected player took their
// own, completely unrelated next action (placing a Pokémon triggered the
// attack overlay, with no attack involved at all). Set alongside those 4
// resets in enterPvpMatch; consumed on the very first snapshot the
// listener callback below processes, seeding each watermark to whatever
// round the server already reports instead of 0 -- "catch up silently,
// don't replay" -- then never touched again, so every later GENUINE new
// round still reveals normally.
var pvpRevealCatchupPending = false;

// End-of-turn confirm (renderEndTurnConfirm, below) -- attack() always ends
// the turn the instant it's submitted (server-side in PVP; see functions/
// index.js's own comment on this -- the exact same rule applies locally,
// rules-engine.js's attack() itself always calls endTurn()), so a KO'd
// Pokémon's prize gets taken AFTER the turn has already silently passed to
// the CPU/rival. Without this, the board would go straight from "you just
// KO'd something" to "their turn" with no acknowledgment.
//
// PVP and local-vs-CPU each get their own pair of these flags (pub.* vs
// gameState.* have different shapes, so it's simplest to track them
// independently) but drive the exact same renderEndTurnConfirm/modal:
// *AttackEndedMyTurn is armed the moment I submit a real attack while it's
// genuinely my turn; *MyPrizeChoiceSeen tracks whether THIS attack actually
// opened a prize choice for me (as opposed to a plain non-KO attack, which
// should show no modal at all). Both are consumed (reset) the instant the
// modal is shown, so it only ever fires once per KO.
var pvpAttackEndedMyTurn = false;
var pvpMyPrizeChoiceSeen = false;
var localAttackEndedMyTurn = false;
var localMyPrizeChoiceSeen = false;
// True while the confirm modal is up in PVP -- the board already reflects
// the attack's own result (damage/status/KO) by the time it shows
// (rendered once, right before). The RIVAL genuinely IS waiting on this
// player's own confirmation now (party/index.js keeps activePlayerId
// exactly as it was until 'confirmEndTurn' actually runs), so no real
// moves of theirs can arrive during this window at all -- but a
// reconnect's own resend of the current snapshot still could, so this
// still buffers into pvpEndTurnLatestData instead of applying it out from
// under the modal, applied once the player dismisses it either way (see
// the two handlers, DOMContentLoaded).
var pvpEndTurnConfirmPending = false;
// True from the moment this modal is first shown until the player has
// actually sent 'confirmEndTurn' to the server -- "SÍ" sends it right
// away and clears this; "NO, MIRAR EL CAMPO" only hides the modal,
// deliberately leaving this true (nothing was confirmed, real rules: my
// turn hasn't ended yet). The persistent "Terminar Turno" board button
// checks this: while true, clicking it sends 'confirmEndTurn' (the only
// thing the server will actually accept from me right now -- see
// party/index.js's runAction, which rejects a plain 'endTurn' once an
// attack of mine is already pending confirmation) instead of its normal
// plain 'endTurn'.
var pvpTurnConfirmOwed = false;
// Real reported bug: taking a prize in PVP never showed the "here's the
// card you won" zoom modal local play already has (renderPrizeChoiceModal's
// own local branch, openCardModal). Prizes stay secret until taken, so the
// only way to know which card just arrived is diffing my own hand -- set
// to my hand's card ids right before submitting 'takePrize'; the first
// card in a later snapshot's myHand that ISN'T in this list is the one I
// just won (see applyPvpSnapshotEffects). null the rest of the time.
var pvpPrizeRevealPending = null;
var pvpEndTurnLatestData = null;

// C5 (final-review fix): pvpMode used to only ever get set to true (in the
// match listener callback below) and never back to false anywhere -- not on
// match end, not on returning to the menu, not on starting a fresh local
// match -- which permanently broke local-vs-CPU play (every guarded handler
// kept routing through submitMatchActionCloud) for the rest of the page
// session after any PVP match. Called at every point that leaves a PVP
// match behind: starting a fresh local match (startNewMatch), and every
// "return to menu" handler (matchEndCancelBtn, pauseExit).
function resetPvpMatchState() {
  pvpMode = false;
  pvpActiveMatchId = null;
  pvpMySide = null;
  pvpMatchEnded = false;
  pvpOpponentName = null;
  pvpOpponentPhoto = null;
  pvpDuelMusicStarted = false;
  pvpSetupHintShown = false;
  pvpLastActivePlayerId = null;
  if (pvpClockTickInterval) { clearInterval(pvpClockTickInterval); pvpClockTickInterval = null; }
  pvpLatestPub = null;
  pvpClaimedTimeoutFor = null;
  if (pvpMatchUnsubscribe) { pvpMatchUnsubscribe(); pvpMatchUnsubscribe = null; }
  if (pvpRpsRevealTimer) { clearTimeout(pvpRpsRevealTimer); pvpRpsRevealTimer = null; }
  pvpRpsRevealedRound = 0;
  pvpRpsLatestMatchData = null;
  pvpTrainerRevealedRound = 0;
  pvpPowerRevealedRound = 0;
  pvpAttackRevealedRound = 0;
  pvpAttackEndedMyTurn = false;
  pvpMyPrizeChoiceSeen = false;
  pvpEndTurnConfirmPending = false;
  pvpTurnConfirmOwed = false;
  pvpPrizeRevealPending = null;
  pvpEndTurnLatestData = null;
  // Also called at the start of a fresh LOCAL match (startNewMatch) -- reset
  // the local end-turn-confirm flags here too so a match ending mid-KO
  // never leaves either armed for the next one.
  localAttackEndedMyTurn = false;
  localMyPrizeChoiceSeen = false;
  var endTurnModal = document.getElementById('endTurnConfirmModal');
  if (endTurnModal) { endTurnModal.classList.add('hidden'); }
  hideRpsScreen();
  var waitingConfirmModal = document.getElementById('pvpWaitingConfirmModal');
  if (waitingConfirmModal) { waitingConfirmModal.classList.add('hidden'); }
}

// Reshapes {public, myHand} (from initPvpMatchListeners) into the same
// gameState shape renderBoard()/showAttackOverlay()/etc. already know how
// to read locally -- 'me'/'opponent' keys stand in for 'player'/'cpu' so
// none of the existing render code needs to change; wireBoardButtons'
// PVP guards are the only code that needs to know pvpMySide at all.
// Real display name for the board's opponent slot in PVP (sideHeaderHtml
// reads this instead of the hardcoded 'CPU' literal whenever pvpMode is on)
// -- set by buildPvpGameState below, the only place that has pub.hostUsername/
// guestUsername available.
var pvpOpponentName = null;
// Real reported bug: sideHeaderHtml showed the CPU bot avatar for a real
// PVP rival -- pub.hostPhoto/guestPhoto (party/index.js's redactedFor) now
// carries it the same way pvpOpponentName above already does for the name.
var pvpOpponentPhoto = null;
// The rival's real equipped protector for this match (functions/index.js's
// setReady copies hostCardBackId/guestCardBackId onto the match doc from
// whichever room field matches their side) -- read by cardBackUrlFor
// above. Falls back to the default card back if the match predates this
// field or the id isn't a real option.
var pvpOpponentCardBackId = null;
function buildPvpGameState(data, mySide) {
  var pub = data.public;
  var oppSide = mySide === 'player1' ? 'player2' : 'player1';
  pvpOpponentName = (oppSide === 'player1' ? pub.hostUsername : pub.guestUsername) || 'Rival';
  pvpOpponentPhoto = (oppSide === 'player1' ? pub.hostPhoto : pub.guestPhoto) || PROFILE_PHOTO_URL.player;
  pvpOpponentCardBackId = (oppSide === 'player1' ? pub.hostCardBackId : pub.guestCardBackId) || DEFAULT_CARD_BACK_ID;
  // "Jugador"/"CPU" in log text always literally mean the host/guest engine
  // slots respectively (translatePlayer, rules-engine.js -- a fixed
  // convention, not viewer-relative), so the real-username substitution is
  // the same fixed mapping for every viewer: host's name always replaces
  // "Jugador", guest's name always replaces "CPU". Global regex (not a
  // single replace) since some lines narrate both sides at once (e.g. the
  // rock-paper-scissors resolution).
  var hostName = pub.hostUsername || 'Jugador';
  var guestName = pub.guestUsername || 'Rival';
  function withRealNames(msg) {
    return msg.split('Jugador').join(hostName).split('CPU').join(guestName);
  }
  // Log entries carry ENGINE-internal ownerId ('player' = host, 'cpu' =
  // guest) -- unlike activePlayerId/pendingActiveChoice, redactMatchState
  // does NOT translate these to player1/player2 terms, so the translation
  // here has to use the engine-side mapping instead of the player1/player2
  // one everything else in this function uses. For the host (mySide ===
  // 'player1', engineMySide === 'player') this is a no-op (player->player,
  // cpu->cpu); only the guest's view actually swaps 'player'/'cpu' so their
  // own actions show as "mine" (green) instead of "rival" (red).
  var engineMySide = mySide === 'player1' ? 'player' : 'cpu';
  var engineOppSide = engineMySide === 'player' ? 'cpu' : 'player';
  function boardSide(sideKey, hand) {
    var b = pub.board[sideKey];
    // prizes: p.prizes/c.prizes are a FIXED 6-slot array server-side (a
    // taken prize is set to null IN PLACE, never spliced out -- see
    // rules-engine.js's takePrize/knockOutIfNeeded and its own comment on
    // remainingPrizes) -- the prize-choice modal sends the CLIENT array's
    // index straight back as prizeIndex, so rebuilding a merely-compacted
    // array here (one entry per remaining prize) would desync from the
    // server's real slot indices the instant the FIRST prize is taken.
    // pub.prizeSlots is the per-slot presence mask redactMatchState emits
    // for exactly this reason -- rebuild the same 6-length sparse shape.
    var prizes = pub.prizeSlots[sideKey].map(function (present) { return present ? {} : null; });
    // hand: the opponent's real hand contents never reach this client at
    // all (hand is always null for that side, see the boardSide(oppSide,
    // null) call below) -- but their real hand SIZE is public information
    // (pub.handCount), so populate that many face-down placeholders instead
    // of an always-empty array, matching how the CPU's hand already renders
    // face-down locally today.
    var handArr = hand || new Array(pub.handCount[sideKey]).fill({ id: null, name: null });
    return {
      active: b.active, bench: b.bench, hand: handArr,
      discard: pub.discard[sideKey], prizes: prizes,
      deck: new Array(pub.deckCount[sideKey]).fill({}),
      hasHadActive: !!b.active || pub.turnCounter > 1
    };
  }
  return {
    phase: pub.phase,
    turnCounter: pub.turnCounter,
    activePlayerId: pub.activePlayerId === mySide ? 'player' : 'cpu',
    winner: pub.winner === mySide ? 'player' : (pub.winner === oppSide ? 'cpu' : null),
    pendingPrizeChoice: pub.pendingPrizeChoice ? { playerId: pub.pendingPrizeChoice.side === mySide ? 'player' : 'cpu', count: pub.pendingPrizeChoice.count } : null,
    pendingActiveChoice: pub.pendingActiveChoice === mySide ? 'player' : (pub.pendingActiveChoice === oppSide ? 'cpu' : null),
    log: pub.log.map(function (entry) {
      var translatedOwnerId = entry.ownerId === engineMySide ? 'player' : (entry.ownerId === engineOppSide ? 'cpu' : entry.ownerId);
      return Object.assign({}, entry, { ownerId: translatedOwnerId, msg: withRealNames(entry.msg) });
    }),
    players: {
      player: boardSide(mySide, data.myHand),
      cpu: boardSide(oppSide, null) // opponent's hand contents never arrive client-side at all
    }
  };
}

function enterPvpMatch(matchId) {
  pvpActiveMatchId = matchId;
  pvpMatchEnded = false;
  pvpRpsRevealedRound = 0;
  if (pvpRpsRevealTimer) { clearTimeout(pvpRpsRevealTimer); pvpRpsRevealTimer = null; }
  pvpTrainerRevealedRound = 0;
  pvpPowerRevealedRound = 0;
  pvpAttackRevealedRound = 0;
  pvpRevealCatchupPending = true;
  pvpAttackEndedMyTurn = false;
  pvpMyPrizeChoiceSeen = false;
  pvpEndTurnConfirmPending = false;
  pvpTurnConfirmOwed = false;
  pvpPrizeRevealPending = null;
  pvpEndTurnLatestData = null;
  document.getElementById('pvpCreateScreen').classList.add('hidden');
  // Real reported bug (first pass): starting duel music here, the moment
  // the match SCREEN is entered, fired it during the RPS reveal and the
  // setup/placement screen too -- before the duel has actually started.
  // Per user follow-up, it must wait for BOTH sides to actually press
  // INICIAR DUELO (phase leaves 'setup') -- see processPvpMatchSnapshot's
  // own pvpDuelMusicStarted guard below, which is where it fires now.
  pvpDuelMusicStarted = false;
  pvpSetupHintShown = false;
  pvpLastActivePlayerId = null;
  if (pvpClockTickInterval) { clearInterval(pvpClockTickInterval); pvpClockTickInterval = null; }
  pvpLatestPub = null;
  pvpClaimedTimeoutFor = null;
  pvpClockTickInterval = setInterval(tickPvpClocks, CLOCK_TICK_MS);
  pvpClaimedTimeoutFor = null;
  var myUid = firebase.auth().currentUser.uid;
  // Real reported bug: after a same-room rematch, the host's client
  // never actually transitioned to the fresh match's RPS screen -- it
  // just sat frozen on the PREVIOUS match's board, exactly as it looked
  // right before "VOLVER A JUGAR" was pressed. Root cause: enterPvpMatch
  // only ever ran ONCE per real socket connection before the rematch
  // feature existed, so this old cleanup line -- calling the PREVIOUS
  // match's own unsubscribe() -- was harmless (pvpMatchUnsubscribe was
  // always null the first time). initPvpMatchListeners's own unsubscribe
  // (economy.js) does more than drop the handler reference, though: it
  // also CLOSES pvpSocket entirely (the right behavior for actually
  // leaving PVP, see resetPvpMatchState's own call to it) -- calling it
  // here, right as the server was about to send the fresh match's first
  // 'rps'-phase snapshot over that same socket, killed the connection
  // before it could ever arrive. Removed: initPvpMatchListeners already
  // reassigns pvpMatchHandler unconditionally on its own next line, so
  // this call was never actually needed for cleanup, only harmful here.
  pvpMatchUnsubscribe = initPvpMatchListeners(matchId, myUid, function (data) {
    pvpMySide = data.public.players.player1 === myUid ? 'player1' : 'player2';
    pvpMode = true;
    pvpRpsLatestMatchData = data;
    var pub = data.public;
    if (pvpRevealCatchupPending) {
      pvpRevealCatchupPending = false;
      pvpRpsRevealedRound = pub.rpsRound || 0;
      pvpTrainerRevealedRound = pub.lastTrainerPlay ? pub.lastTrainerPlay.round : 0;
      pvpPowerRevealedRound = pub.lastPowerUse ? pub.lastPowerUse.round : 0;
      pvpAttackRevealedRound = pub.lastAttackResult ? pub.lastAttackResult.round : 0;
    }
    // A freshly-resolved RPS round (tie or real winner) always arrives in
    // the SAME snapshot as the phase change it causes (rules-engine.js
    // resolves both synchronously) -- intercepting it here, before the
    // phase check below, is what lets renderRpsReveal actually get its
    // full time on screen instead of being skipped straight past.
    if (pub.rpsLastResult && pub.rpsRound > pvpRpsRevealedRound) {
      pvpRpsRevealedRound = pub.rpsRound;
      renderRpsReveal(pub);
      if (pvpRpsRevealTimer) { clearTimeout(pvpRpsRevealTimer); }
      pvpRpsRevealTimer = setTimeout(function () {
        pvpRpsRevealTimer = null;
        processPvpMatchSnapshot(pvpRpsLatestMatchData);
      }, 2400);
      return;
    }
    if (pvpRpsRevealTimer) { return; } // reveal still on screen -- pvpRpsLatestMatchData already updated above

    if (pub.lastTrainerPlay && pub.lastTrainerPlay.round > pvpTrainerRevealedRound) {
      pvpTrainerRevealedRound = pub.lastTrainerPlay.round;
      var play = {
        kind: 'trainer',
        name: pub.lastTrainerPlay.cardName,
        playerId: pub.lastTrainerPlay.side === pvpMySide ? 'player' : 'cpu',
        targetName: pub.lastTrainerPlay.targetName
      };
      showTrainerPlayedOverlay(play, function () {
        processPvpMatchSnapshot(pvpRpsLatestMatchData);
      });
      return;
    }

    if (pub.lastPowerUse && pub.lastPowerUse.round > pvpPowerRevealedRound) {
      pvpPowerRevealedRound = pub.lastPowerUse.round;
      var powerPlay = {
        kind: 'power',
        name: pub.lastPowerUse.ownerName,
        powerName: pub.lastPowerUse.powerName,
        playerId: pub.lastPowerUse.side === pvpMySide ? 'player' : 'cpu',
        targetName: pub.lastPowerUse.targetName
      };
      showTrainerPlayedOverlay(powerPlay, function () {
        processPvpMatchSnapshot(pvpRpsLatestMatchData);
      });
      return;
    }

    // Real reported bug (attack-reveal gate below): an attack, unlike a
    // Trainer play or an RPS round, can knock out a Pokémon and open the
    // prize-choice/end-turn-confirm flow -- this used to run inline here,
    // right after processPvpMatchSnapshot(data), which only ever happens
    // on the DIRECT (non-reveal) path. Extracted so the attack-reveal
    // gate's own deferred completion can call it too, on whichever
    // snapshot is current by the time the reveal finishes.
    function applyPvpSnapshotEffects(matchData) {
      var mpub = matchData.public;
      // Real reported bug: this modal used to only ever fire gated on
      // pvpMyPrizeChoiceSeen having been set (i.e. only when my own attack
      // actually knocked something out AND I'd already taken the prize) --
      // a routine attack that didn't KO anything never set that flag, so
      // this never fired at all, meaning confirmEndTurn never got sent and
      // the deferred Pokémon Checkup (see rules-engine.js's attack()) never
      // actually applied for the overwhelming majority of turns. Worse: the
      // persistent "Terminar Turno" button can't help either once an attack
      // already ended the turn server-side (plain 'endTurn' is turn-gated,
      // see TURN_GATED_ACTIONS -- the server rejects it as "no es tu
      // turno"), so there was literally no way to reach this moment for a
      // non-KO attack. Now tracked only to pick the modal's copy (a real
      // knockout still gets its own "¡NOQUEASTE...!" text), never to gate
      // whether it shows at all -- it shows for every attack of mine that
      // ended my turn, the instant any KO of mine is done being resolved
      // (immediately if there wasn't one).
      if (mpub.pendingPrizeChoice && mpub.pendingPrizeChoice.side === pvpMySide) {
        pvpMyPrizeChoiceSeen = true;
      }
      processPvpMatchSnapshot(matchData);
      // Real reported bug: taking a prize in PVP never zoomed the card just
      // won, unlike local play (renderPrizeChoiceModal's own local branch).
      // pvpPrizeRevealPending holds the hand's card ids from right before
      // 'takePrize' was submitted -- the first card in THIS snapshot's
      // myHand that wasn't in that list is the one that just arrived.
      // Mirrors the local branch's onCardModalClose idiom: defer everything
      // below (including the end-turn-confirm tail) until the player
      // dismisses the zoom, then re-run this same function on the latest
      // cached snapshot -- pvpPrizeRevealPending is null by then, so this
      // block is skipped and the tail logic below runs normally.
      if (pvpPrizeRevealPending) {
        var pendingHandIds = pvpPrizeRevealPending;
        var wonPrizeCard = matchData.myHand.filter(function (c) { return pendingHandIds.indexOf(c.id) === -1; })[0];
        if (wonPrizeCard) {
          pvpPrizeRevealPending = null;
          var wonPrizeFoil = getPlayerCardFoilTier(wonPrizeCard.name) || (isHoloInMatch('player', wonPrizeCard.name) ? 'holo' : null);
          openCardModal(wonPrizeCard.name, null, wonPrizeFoil);
          onCardModalClose = function () { applyPvpSnapshotEffects(pvpRpsLatestMatchData); };
          return;
        }
      }
      // pendingActiveChoice !== pvpMySide guards against stacking this on
      // top of my OWN still-open "choose new Active" modal -- a
      // simultaneous KO (my own Active also fell, e.g. to a checkup)
      // leaves that one blocking first; this waits for it to clear like
      // everything else does. !mpub.winner guards against stacking this
      // on top of the win/loss modal processPvpMatchSnapshot just showed
      // -- taking the LAST prize of the match ends the duel, not just the
      // turn. Real reported bug: this used to also require
      // mpub.activePlayerId !== pvpMySide (the turn having ALREADY passed)
      // -- but the server (party/index.js) no longer flips activePlayerId
      // at all until confirmEndTurn actually runs, specifically so the
      // rival can't act early; requiring it here was checking for
      // something that can now never become true, so this modal would
      // never have fired again. activePlayerId staying mine IS the
      // expected state at this exact moment now.
      //
      // Real reported bug: a Confused self-hit (or any other self-KO,
      // e.g. Selfdestruct) awards the PRIZE to the RIVAL, not me (real
      // rule -- knockOutIfNeeded, rules-engine.js, always credits the
      // KO'd Pokémon's OWNER's opponent). This check used to block on
      // !mpub.pendingPrizeChoice generically -- any pending prize, not
      // just my own -- so it waited forever on a prize that was never
      // mine to take, deadlocking the whole match (I'd already resolved
      // my own pendingActiveChoice; the rival's own pendingPrizeChoice
      // has nothing to do with whether MY turn can end). Only a prize
      // choice that's actually MINE should hold this back.
      var myPrizeStillPending = !!(mpub.pendingPrizeChoice && mpub.pendingPrizeChoice.side === pvpMySide);
      // Duelo en Vivo: pvpAttackEndedMyTurn alone can never fire again for
      // a player who reconnected while genuinely owing a confirmation (it
      // resets on every enterPvpMatch, see its own declaration) -- but a
      // real one is server-truth now (party/index.js's redactedFor), so
      // recovering it here directly closes that stuck state. Guarded by
      // !pvpEndTurnConfirmPending so this never re-fires the modal on a
      // LATER snapshot arriving while it's already up (mpub.turnEndPendingSide
      // stays true server-side for the whole window the confirmation is
      // owed, unlike pvpAttackEndedMyTurn's own one-shot nature).
      var recoveringPendingConfirm = !pvpEndTurnConfirmPending && mpub.turnEndPendingSide === pvpMySide;
      if (!mpub.winner && (pvpAttackEndedMyTurn || recoveringPendingConfirm) && !myPrizeStillPending && mpub.pendingActiveChoice !== pvpMySide) {
        var hadKnockout = pvpMyPrizeChoiceSeen;
        pvpAttackEndedMyTurn = false;
        pvpMyPrizeChoiceSeen = false;
        pvpEndTurnConfirmPending = true;
        pvpTurnConfirmOwed = true;
        renderEndTurnConfirm(hadKnockout);
      }
    }

    if (pub.lastAttackResult && pub.lastAttackResult.round > pvpAttackRevealedRound) {
      pvpAttackRevealedRound = pub.lastAttackResult.round;
      showAttackOverlay(pub.lastAttackResult, function () {
        applyPvpSnapshotEffects(pvpRpsLatestMatchData);
      });
      return;
    }

    if (pvpEndTurnConfirmPending) { pvpEndTurnLatestData = data; return; }

    applyPvpSnapshotEffects(data);
  });
  showBoardScreen();
}

// Everything enterPvpMatch's listener used to do directly -- split out so
// the RPS-reveal gate above can defer it until the reveal has had its time
// on screen, rather than racing it.
function processPvpMatchSnapshot(data) {
  var pub = data.public;
  // A forfeit (or, in principle, any winner) can be decided while still in
  // 'rps' -- getWinner() (rules-engine.js) checks forfeitedBy regardless of
  // phase. Without the "&& !pub.winner" guard here, a match decided during
  // RPS would render the RPS screen forever and never reach the
  // winner-handling logic below, stranding both players with no way back to
  // the main menu (RENDIRSE is the only exit from PVP -- see pause menu).
  if (pub.phase === 'rps' && !pub.winner) {
    renderRpsScreen(pub);
    return;
  }
  hideRpsScreen();
  // Real reported bug: local play shows this same hint (as a log line) the
  // instant the board appears in 'setup' -- PVP never showed anything,
  // leaving the player to guess what to do. Reuses the generic hint modal
  // (targetHintModal) local play's own Trainer-targeting flows already use
  // -- same OK/backdrop dismissal, no new markup needed.
  if (pub.phase === 'setup' && !pvpSetupHintShown) {
    pvpSetupHintShown = true;
    // Real reported bug: "y si quieres, tu Banca" read as optional/vague --
    // per user request, spelled out as 3 concrete steps instead.
    showTargetHintModal('Baja tus Pokémon Básicos: elige uno como tu Activo y el resto en la Banca (máx. 5).');
  }
  // Only ever shown by startMatchBtn's own click handler above (confirmSetup)
  // while phase is still 'setup' -- once it's anything else (always
  // 'playing' by the time this runs), both sides have confirmed and the
  // match has actually started, so there's nothing left to wait on.
  if (pub.phase !== 'setup') {
    document.getElementById('pvpWaitingConfirmModal').classList.add('hidden');
    // Real reported bug: this used to fire the instant the match SCREEN
    // was entered (enterPvpMatch), well before the duel itself actually
    // started -- per user request, it now waits for the same signal the
    // waiting modal above does: phase has left 'setup', meaning both
    // sides already pressed INICIAR DUELO.
    if (!pvpDuelMusicStarted) {
      pvpDuelMusicStarted = true;
      startDuelMusic();
    }
  }
  gameState = buildPvpGameState(data, pvpMySide);
  pvpLatestPub = pub;
  // Real reported bug: local play flashes a big "TU TURNO"/"TURNO DEL
  // RIVAL" banner every time control changes hands, including right when
  // the very first turn of the match starts -- PVP only ever had the small
  // header text. A first fix here still missed the very first flash: RPS's
  // own winner is already recorded as activePlayerId during 'setup' (well
  // before 'playing' starts, see engineStartMatch/rules-engine.js), so
  // pvpLastActivePlayerId got contaminated with that same value while
  // still in 'setup' -- by the time 'playing' actually began, nothing
  // looked "changed" anymore. Both the comparison AND the update below now
  // only ever run while phase is genuinely 'playing', so
  // pvpLastActivePlayerId stays null through 'rps'/'setup' and the first
  // real turn always reads as a genuine change.
  if (pub.phase === 'playing' && gameState.activePlayerId) {
    // Real reported bug: a match-ending checkup KO (e.g. poison finishing
    // off the last Pokémon at turn handoff) can flip activePlayerId in the
    // SAME snapshot that also sets gameState.winner -- this flash used to
    // fire unconditionally, overlapping its own 1.25s-long overlay
    // ("TURNO DE TU RIVAL") on top of finishMatch's "Has Ganado" modal
    // below. The duel is already over, so there's no real "turn" left to
    // announce.
    if (gameState.activePlayerId !== pvpLastActivePlayerId && !gameState.winner) {
      showTurnFlash(gameState.activePlayerId === 'player' ? 'TU TURNO' : 'TURNO DEL RIVAL',
        gameState.activePlayerId === 'player' ? 'mine' : 'rival');
    }
    pvpLastActivePlayerId = gameState.activePlayerId;
  }
  if (gameState.winner && !pvpMatchEnded) {
    pvpMatchEnded = true;
    finishMatch(gameState.winner);
  } else if (!gameState.winner) {
    renderBoard();
  }
}

// Purely an acknowledgment beat, shown on top of the already-updated board
// (see enterPvpMatch's own comment) -- by the time this appears, the turn
// has ALREADY ended server-side (attack() always ends it the instant it's
// submitted, KO or not -- functions/index.js), so neither button changes
// anything about the match itself. It just stops the board from silently
// handing over to the rival's turn, with nothing marking the moment, right
// as the player is still looking at what they just knocked out.
// hadKnockout (default true, matching local play's own 2 call sites which
// are BOTH already KO-specific): PVP's own call site (below) passes this
// explicitly, since -- unlike local play -- PVP shows this same modal for
// EVERY attack that ends the player's turn, not just ones that knocked
// something out (see applyPvpSnapshotEffects's own comment on why the
// modal used to only ever fire for the KO case, leaving a routine attack
// with no real "your turn ended" moment at all in PVP).
function renderEndTurnConfirm(hadKnockout) {
  var modal = document.getElementById('endTurnConfirmModal');
  if (!modal) { return; }
  var titleEl = modal.querySelector('.shell-modal-title');
  var textEl = modal.querySelector('.shell-modal-text');
  if (hadKnockout === false) {
    if (titleEl) { titleEl.textContent = 'TU ATAQUE TERMINÓ TU TURNO'; }
    if (textEl) { textEl.textContent = '¿Quieres pasarle el turno a tu rival?'; }
  } else {
    if (titleEl) { titleEl.textContent = '¡NOQUEASTE UN POKÉMON RIVAL!'; }
    if (textEl) { textEl.textContent = 'Ya tomaste tu premio y tu turno ha terminado. ¿Quieres pasarle el turno a tu rival?'; }
  }
  modal.classList.remove('hidden');
}

var RPS_EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
var RPS_LABEL_ES = { rock: 'PIEDRA', paper: 'PAPEL', scissors: 'TIJERA' };

// Rock-paper-scissors: shown instead of the normal board while phase is
// 'rps' (see createGame/submitRpsChoice, rules-engine.js) -- deliberately
// reads the raw public doc directly rather than going through
// buildPvpGameState, since this isn't board state at all. rpsSubmitted is
function renderRpsScreen(pub) {
  document.getElementById('pvpRpsScreen').classList.remove('hidden');
  document.getElementById('pvpRpsReveal').classList.add('hidden');
  var mySubmitted = pub.rpsSubmitted[pvpMySide];
  document.getElementById('pvpRpsChoices').classList.toggle('hidden', mySubmitted);
  document.getElementById('pvpRpsWaiting').classList.toggle('hidden', !mySubmitted);
  var hostName = pub.hostUsername || 'Jugador 1';
  var guestName = pub.guestUsername || 'Jugador 2';
  var hostEl = document.getElementById('pvpRpsHostName');
  if (hostEl) { hostEl.textContent = hostName; }
  var guestEl = document.getElementById('pvpRpsGuestName');
  if (guestEl) { guestEl.textContent = guestName; }
  // "LISTO" tag next to each side's own name -- host is always player1,
  // guest always player2 (see redactMatchState, rules-engine.js), so this
  // is a direct, non-viewer-relative mapping unlike pvpMySide below.
  document.getElementById('pvpRpsHostReadyTag').classList.toggle('hidden', !pub.rpsSubmitted.player1);
  document.getElementById('pvpRpsGuestReadyTag').classList.toggle('hidden', !pub.rpsSubmitted.player2);
  var matchupEl = document.getElementById('pvpRpsMatchup');
  if (matchupEl) {
    matchupEl.textContent = mySubmitted
      ? 'Tu jugada ha sido enviada. Esperando a tu rival…'
      : 'Elige tu jugada. Quien gane la ronda tomará el primer turno.';
  }
}
function hideRpsScreen() {
  var el = document.getElementById('pvpRpsScreen');
  if (el) { el.classList.add('hidden'); }
}

// Shown for a fixed window (see enterPvpMatch's reveal gate) once both
// sides have chosen -- a "zoom" of both picks plus the round's outcome,
// before the client acts on whatever the server already resolved:
// re-prompting on a tie, or handing off to the board on a real win.
function renderRpsReveal(pub) {
  document.getElementById('pvpRpsScreen').classList.remove('hidden');
  document.getElementById('pvpRpsChoices').classList.add('hidden');
  document.getElementById('pvpRpsWaiting').classList.add('hidden');
  var result = pub.rpsLastResult;
  var myChoice = result[pvpMySide];
  var oppSide = pvpMySide === 'player1' ? 'player2' : 'player1';
  var oppChoice = result[oppSide];

  document.getElementById('pvpRpsRevealMyLabel').textContent = 'TÚ';
  document.getElementById('pvpRpsRevealMyEmoji').textContent = RPS_EMOJI[myChoice] || '';
  document.getElementById('pvpRpsRevealMyChoice').textContent = RPS_LABEL_ES[myChoice] || '';

  // pvpOpponentName (buildPvpGameState) isn't set yet the first time this
  // fires -- that only runs once the phase leaves 'rps' -- so read the
  // opponent's name straight off the room-level fields instead, same as
  // renderRpsScreen's hostName/guestName above.
  var oppName = oppSide === 'player1' ? pub.hostUsername : pub.guestUsername;
  document.getElementById('pvpRpsRevealOppLabel').textContent = (oppName || 'RIVAL').toUpperCase();
  document.getElementById('pvpRpsRevealOppEmoji').textContent = RPS_EMOJI[oppChoice] || '';
  document.getElementById('pvpRpsRevealOppChoice').textContent = RPS_LABEL_ES[oppChoice] || '';

  var outcomeEl = document.getElementById('pvpRpsRevealOutcome');
  if (result.winner === null) {
    outcomeEl.textContent = '¡EMPATE! Volviendo a elegir…';
  } else if (result.winner === pvpMySide) {
    outcomeEl.textContent = '¡TÚ INICIAS!';
  } else {
    outcomeEl.textContent = 'TU RIVAL INICIA';
  }

  // Re-triggers the CSS zoom-in keyframe animation even if the previous
  // round used the exact same choices/outcome (a repeat tie, say) --
  // simply toggling .hidden off wouldn't restart an animation still
  // "finished" on those same elements from last time.
  var revealBox = document.getElementById('pvpRpsReveal');
  revealBox.classList.remove('hidden');
  document.querySelectorAll('#pvpRpsReveal .rps-reveal-emoji').forEach(function (el) {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  });
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
  if (gameState && gameState.phase === 'playing' && !getWinner(gameState)) {
    startGameClock();
    // Resumes (not restarts) the duel track from wherever it was paused --
    // covers returning here from Configuración, which deliberately plays no
    // music of its own (stopScreenMusic) while it's open.
    var bg = document.getElementById('bgMusic');
    if (bg.paused) { bg.play().catch(function () {}); }
  }
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
  orange_duel: { label: 'Duel Music', file: 'Songs/Duel_Music.mp3' },
  orange_duel2: { label: 'Duel Music 2', file: 'Songs/Duel_Music_2.mp3' },
  orange_duel3: { label: 'Duel Music 3', file: 'Songs/Duel_Music_3.mp3' },
  orange_duel4: { label: 'Duel Music 4', file: 'Songs/Duel_Music_4.mp3' },
  orange_duel5: { label: 'Duel Music 5', file: 'Songs/Duel_Music_5.mp3' },
  orange_duel6: { label: 'Duel Music 6', file: 'Songs/Duel_Music_6.mp3' },
  orange_duel9: { label: 'Duel Music 9', file: 'Songs/Duel_Music_9.mp3' },
  orange_determination: { label: 'Determination Battle', file: 'Songs/Determination Battle.mp3' },
  orange_determined: { label: 'Determined Duelist', file: 'Songs/Determined Duelist.mp3' },
  orange_hard: { label: 'Some Hard Duel', file: 'Songs/Some Hard Duel.mp3' },
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
var DUEL_MUSIC_DEFAULT = 'orange_duel';
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

// Whichever non-duel screen's ambient track is playing right now on
// #bgMusic (login, main menu, tienda, colección, mi mazo) -- tracked
// separately from bg.src itself since the browser re-encodes spaces/accents
// in that property (e.g. "Mi Colección.mp3" -> "...Mi%20Colecci%C3%B3n.mp3"),
// making a plain substring check against the raw filename unreliable.
// Cleared by startDuelMusic()/playMatchEndMusic() so returning to any of
// these screens after a match always restarts the right track instead of
// leaving the duel/fanfare audio playing underneath.
var currentScreenMusicFile = null;
function playScreenMusic(file) {
  var bg = document.getElementById('bgMusic');
  if (currentScreenMusicFile === file && !bg.paused) { return; }
  currentScreenMusicFile = file;
  bg.src = file;
  bg.loop = true;
  bg.volume = getMusicVolume() / 100;
  bg.currentTime = 0;
  bg.play().catch(function () {});
}
// Configuración plays no music of its own, on purpose -- whatever screen
// the player returns to afterward (showMenu, etc.) already calls
// playScreenMusic itself and restarts correctly, since this clears
// currentScreenMusicFile the same way entering a duel does.
function stopScreenMusic() {
  currentScreenMusicFile = null;
  document.getElementById('bgMusic').pause();
}

// Called once the coin flip actually starts the duel (startMatchBtn) --
// loops for the whole match, real volume from the Música slider.
function startDuelMusic() {
  currentScreenMusicFile = null;
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
  currentScreenMusicFile = null;
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
  stopScreenMusic();
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
  // Duelo en Vivo: PVP's only intentional way to leave a live match is now
  // RENDIRSE (Step 4 below) -- SALIR AL MENÚ used to abandon the match
  // silently, without telling the server anything, which is exactly the
  // "accidental disappearance" gap this whole feature closes. Local play
  // is unaffected (pvpMode is only ever true during a real PVP match).
  document.getElementById('pauseExit').classList.toggle('hidden', !!pvpMode);
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

  // Real reported request: a real time-of-day clock in the board header,
  // both modes -- independent of any match's own lifecycle (unlike every
  // other interval in this file), so it's simplest to just start it once,
  // here, and let it run for the rest of the page session.
  renderWallClock();
  setInterval(renderWallClock, 15000);

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
  var menuPvpBtn = document.getElementById('menuPvp');
  if (menuPvpBtn) {
    menuPvpBtn.addEventListener('click', function () {
      document.getElementById('pvpModal').classList.remove('hidden');
      playScreenMusic('Songs/PVP_MUSIC_MATCHMAKING.mp3');
    });
  }
  var pvpModalClose = document.getElementById('pvpModalClose');
  if (pvpModalClose) {
    pvpModalClose.addEventListener('click', function () {
      document.getElementById('pvpModal').classList.add('hidden');
      playScreenMusic('Songs/Login_Screen_Main_Menu_3.mp3');
    });
  }

  var pvpCreateRoomBtn = document.getElementById('pvpCreateRoomBtn');
  if (pvpCreateRoomBtn) {
    pvpCreateRoomBtn.addEventListener('click', function () {
      document.getElementById('pvpModal').classList.add('hidden');
      document.getElementById('pvpCreateScreen').classList.remove('hidden');
      document.getElementById('pvpCreateDeckPicker').classList.remove('hidden');
      document.getElementById('pvpCreateWaiting').classList.add('hidden');
      renderPvpDeckPicker('pvpCreateDeckList', function (deckId) {
        pvpCurrentDeckId = deckId;
        return createRoomCloud(deckId).then(function (res) {
          document.getElementById('pvpCreateDeckPicker').classList.add('hidden');
          document.getElementById('pvpCreateWaiting').classList.remove('hidden');
          renderPvpWaitingMine(deckId);
          document.getElementById('pvpRoomCodeDisplay').textContent = res.roomCode;
          startPvpRoomWait(res.roomCode, deckId);
        }).catch(function (err) { alert(err.message || 'No se pudo crear la sala.'); });
      });
    });
  }

  var pvpRoomUnsubscribe = null;
  var pvpCurrentRoomCode = null;
  function startPvpRoomWait(roomCode, deckId) {
    if (pvpRoomUnsubscribe) { pvpRoomUnsubscribe(); }
    pvpCurrentRoomCode = roomCode;
    pvpRoomUnsubscribe = initPvpRoomListener(roomCode, function (room) {
      if (!room) { return; }
      renderPvpWaitingOpponentFromRoom(room);
      renderPvpWaitingReadyState(room);
      if (room.status === 'started' && room.matchId) {
        pvpRoomUnsubscribe();
        enterPvpMatch(room.matchId);
      }
    });
    // No auto-ready call here -- per user request, picking a deck no longer
    // readies you up by itself (that used to send both players straight
    // into rock-paper-scissors the instant the second one picked a deck,
    // with no real chance to back out). Each side now has to explicitly
    // click "Iniciar" (pvpStartMatchBtn below), which calls setReadyCloud;
    // the room only flips to 'started' once BOTH sides have done so
    // (functions/index.js's setReady).
  }

  var pvpStartMatchBtn = document.getElementById('pvpStartMatchBtn');
  if (pvpStartMatchBtn) {
    pvpStartMatchBtn.addEventListener('click', function () {
      if (!pvpCurrentRoomCode || pvpStartMatchBtn.disabled) { return; }
      pvpStartMatchBtn.disabled = true;
      setReadyCloud(pvpCurrentRoomCode).catch(function (err) {
        pvpStartMatchBtn.disabled = false;
        alert(err.message || 'No se pudo iniciar el duelo.');
      });
    });
  }

  var pvpCreateBackBtn = document.getElementById('pvpCreateBackBtn');
  if (pvpCreateBackBtn) {
    pvpCreateBackBtn.addEventListener('click', function () {
      if (pvpRoomUnsubscribe) { pvpRoomUnsubscribe(); pvpRoomUnsubscribe = null; }
      pvpCurrentRoomCode = null;
      document.getElementById('pvpCreateScreen').classList.add('hidden');
      showMenu();
    });
  }

  var pvpJoinRoomBtn = document.getElementById('pvpJoinRoomBtn');
  if (pvpJoinRoomBtn) {
    pvpJoinRoomBtn.addEventListener('click', function () {
      document.getElementById('pvpModal').classList.add('hidden');
      document.getElementById('pvpJoinScreen').classList.remove('hidden');
      document.getElementById('pvpJoinCodeStep').classList.remove('hidden');
      document.getElementById('pvpJoinDeckPicker').classList.add('hidden');
      document.getElementById('pvpJoinCodeInput').value = '';
      document.getElementById('pvpJoinCodeStatus').textContent = '';
    });
  }

  var pvpJoinCodeInput = document.getElementById('pvpJoinCodeInput');
  if (pvpJoinCodeInput) {
    pvpJoinCodeInput.addEventListener('input', function () {
      var code = pvpJoinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      pvpJoinCodeInput.value = code;
      if (code.length === 6) {
        document.getElementById('pvpJoinCodeStep').classList.add('hidden');
        document.getElementById('pvpJoinDeckPicker').classList.remove('hidden');
        renderPvpDeckPicker('pvpJoinDeckList', function (deckId) {
          pvpCurrentDeckId = deckId;
          return joinRoomCloud(code, deckId).then(function () {
            document.getElementById('pvpJoinScreen').classList.add('hidden');
            document.getElementById('pvpCreateScreen').classList.remove('hidden');
            document.getElementById('pvpCreateDeckPicker').classList.add('hidden');
            document.getElementById('pvpCreateWaiting').classList.remove('hidden');
            // Real reported bug: renderPvpWaitingMine unconditionally resets
            // the opponent slot to its unknown/spinner state -- it must run
            // BEFORE startPvpRoomWait (same order the create-room flow above
            // already uses), otherwise it wipes out the opponent info that
            // initPvpRoomListener renders synchronously from the room
            // broadcast the join call itself already received (economy.js's
            // fire-immediately-with-last-known-value replay). With the old
            // order, the guest's screen got stuck on "ESPERANDO" forever
            // since no further room broadcast arrives once both sides are
            // already connected.
            renderPvpWaitingMine(deckId);
            document.getElementById('pvpRoomCodeDisplay').textContent = code;
            startPvpRoomWait(code, deckId);
          }).catch(function (err) {
            document.getElementById('pvpJoinDeckPicker').classList.add('hidden');
            document.getElementById('pvpJoinCodeStep').classList.remove('hidden');
            document.getElementById('pvpJoinCodeStatus').textContent = err.message || 'No se pudo unir a la sala.';
          });
        });
      }
    });
  }

  var pvpJoinBackBtn = document.getElementById('pvpJoinBackBtn');
  if (pvpJoinBackBtn) {
    pvpJoinBackBtn.addEventListener('click', function () {
      document.getElementById('pvpJoinScreen').classList.add('hidden');
      showMenu();
    });
  }

  document.querySelectorAll('#pvpRpsChoices [data-rps-choice]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      submitMatchActionCloud(pvpActiveMatchId, { type: 'submitRpsChoice', choice: btn.getAttribute('data-rps-choice') })
        .catch(function (err) { alert(err.message || 'No se pudo enviar tu elección.'); });
    });
  });

  // PVP: just hides the modal and catches the board up to whatever's
  // arrived since (buffered in pvpEndTurnLatestData while it was up, see
  // enterPvpMatch's own comment) -- shared by both buttons. Does NOT send
  // anything to the server by itself: confirmEndTurn (the real "yes, my
  // turn is over now") is a separate, explicit step -- see
  // sendPvpConfirmEndTurn below, called only by "SÍ".
  function dismissPvpEndTurnConfirmModal() {
    pvpEndTurnConfirmPending = false;
    var latest = pvpEndTurnLatestData;
    pvpEndTurnLatestData = null;
    if (latest) { processPvpMatchSnapshot(latest); }
  }
  // Real reported bug: this used to fire unconditionally on EITHER button
  // (the modal used to be purely cosmetic -- the turn had already passed
  // server-side by the time it could even show, so there was nothing left
  // to actually confirm). Now that the server genuinely holds the turn
  // open until this fires (party/index.js's 'confirmEndTurn', see
  // rules-engine.js's attack()/deferTurnEnd), sending it from "NO, MIRAR
  // EL CAMPO" was a second real reported bug on its own: clicking "No" —
  // meaning "don't end my turn yet, let me look" — still handed the turn
  // to the rival. Only "SÍ, TERMINAR TURNO" calls this now; pvpTurnConfirmOwed
  // (see its own declaration) stays true after "NO" specifically so the
  // persistent "Terminar Turno" board button knows to send this same
  // action (not a plain 'endTurn', which the server would now reject —
  // see runAction's own guard) whenever the player eventually IS ready.
  function sendPvpConfirmEndTurn() {
    pvpTurnConfirmOwed = false;
    submitMatchActionCloud(pvpActiveMatchId, { type: 'confirmEndTurn' })
      .catch(function (err) { pvpTurnConfirmOwed = true; alert(err.message || 'No se pudo confirmar el fin de turno.'); });
  }
  var endTurnConfirmYesBtn = document.getElementById('endTurnConfirmYes');
  if (endTurnConfirmYesBtn) {
    endTurnConfirmYesBtn.addEventListener('click', function () {
      document.getElementById('endTurnConfirmModal').classList.add('hidden');
      if (pvpMode) { dismissPvpEndTurnConfirmModal(); sendPvpConfirmEndTurn(); return; }
      if (revealAnimationInProgress || cpuTurnInProgress) { return; }
      logEvent(gameState, 'HAS TERMINADO TU TURNO', 'player', 'turn-end');
      if (gameState.activePlayerId === 'player') { endTurn(gameState); }
      if (gameState.activePlayerId === 'cpu') { runCpuTurn(); } else { afterPlayerAction(); }
    });
  }
  var endTurnConfirmNoBtn = document.getElementById('endTurnConfirmNo');
  if (endTurnConfirmNoBtn) {
    endTurnConfirmNoBtn.addEventListener('click', function () {
      document.getElementById('endTurnConfirmModal').classList.add('hidden');
      // pvpTurnConfirmOwed deliberately stays true here -- see its own
      // declaration and sendPvpConfirmEndTurn's comment above.
      if (pvpMode) { dismissPvpEndTurnConfirmModal(); }
    });
  }

  wireStarterDeckScreen();

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
    showDeckBuilderScreen(saved[deckKey].cards, deckKey, saved[deckKey].name, saved[deckKey].coverName);
  });
  document.getElementById('deckDuplicateBtn').addEventListener('click', function () {
    var selectedCard = document.querySelector('.shell-deck-card.active[data-deck]');
    var deckKey = (selectedCard && selectedCard.getAttribute('data-deck')) || 'overgrowth';
    if (!DECKLISTS[deckKey]) { return; }
    var baseName = DECK_DISPLAY_NAME[deckKey] || deckKey;
    // Only a custom deck can have a coverName (precons use their own real
    // box art, not this feature) -- undefined for a precon is fine,
    // showDeckBuilderScreen already treats a falsy 4th arg as "no cover yet".
    var saved = (econState && econState.customDecks) || {};
    var existingCover = saved[deckKey] && saved[deckKey].coverName;
    showDeckBuilderScreen(DECKLISTS[deckKey], null, baseName + ' (Copia)', existingCover);
  });
  document.getElementById('deckBuilderCoverBtn').addEventListener('click', function () {
    openDeckBuilderCoverPicker();
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

  // Canjear código -- a 'card' gift is granted instantly and reveals right
  // here (reuses the same showBoosterResult grid claimNewsGift's card
  // branch already uses); a 'booster'/'custompack' gift is only registered
  // (nothing drawn yet, see redeemGiftCodeCloud) and instead shows up in
  // the Tienda's "PACK GRATIS" slot, same as a claimed news pack gift.
  document.getElementById('configCancelCodeBtn').addEventListener('click', function () {
    document.getElementById('configCodeInput').value = '';
    var statusEl = document.getElementById('configCodeStatus');
    statusEl.textContent = '';
    statusEl.className = 'shell-config-code-status';
  });
  document.getElementById('configRedeemCodeBtn').addEventListener('click', function () {
    var input = document.getElementById('configCodeInput');
    var statusEl = document.getElementById('configCodeStatus');
    var code = input.value.trim();
    if (!code) {
      statusEl.className = 'shell-config-code-status error';
      statusEl.textContent = 'Ingresá un código.';
      return;
    }
    var btn = document.getElementById('configRedeemCodeBtn');
    btn.disabled = true;
    statusEl.className = 'shell-config-code-status';
    statusEl.textContent = 'Canjeando…';
    redeemGiftCodeCloud(code).then(function (result) {
      btn.disabled = false;
      input.value = '';
      statusEl.className = 'shell-config-code-status ok';
      statusEl.textContent = '¡Código canjeado!';
      if (result.kind === 'card') {
        showBoosterResult(result.cards, null);
      } else {
        document.getElementById('codeRedeemModalText').textContent =
          'Tu pack está esperando en la Tienda (PACK GRATIS) para que lo abras.';
        document.getElementById('codeRedeemModal').classList.remove('hidden');
      }
    }).catch(function (err) {
      btn.disabled = false;
      statusEl.className = 'shell-config-code-status error';
      statusEl.textContent = err.message || 'No se pudo canjear el código.';
    });
  });
  document.getElementById('codeRedeemModalClose').addEventListener('click', function () {
    document.getElementById('codeRedeemModal').classList.add('hidden');
  });
  document.querySelector('#codeRedeemModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('codeRedeemModal').classList.add('hidden');
  });
  document.getElementById('codeRedeemModalGotoShop').addEventListener('click', function () {
    document.getElementById('codeRedeemModal').classList.add('hidden');
    hideConfigScreen();
    showMenu();
    showShopScreen('menu');
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
    if (pvpMode) {
      submitMatchActionCloud(pvpActiveMatchId, { type: 'forfeit' })
        .catch(function (err) { alert(err.message || 'No se pudo rendir.'); });
      return;
    }
    finishMatch('cpu');
  });

  document.getElementById('menuLiveDuelBtn').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.remove('hidden');
  });
  document.querySelector('#liveDuelModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.add('hidden');
  });
  document.getElementById('liveDuelYesBtn').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.add('hidden');
    if (!pvpLiveDuelRoomCode) { return; }
    // A reconnect's own deckId is never actually applied to the match --
    // onConnect's reconnect branch (party/index.js) resumes purely off
    // identity.uid, ignoring every other resolveIdentity field -- but
    // resolveIdentity's own validateDeckId (functions/index.js) still runs
    // UNCONDITIONALLY before that branch is ever reached, so any deckId
    // sent here still has to be one that validates for this uid right now.
    // econState.activeDeck can legitimately be invalid at this exact
    // moment (not yet loaded after a fresh page refresh -- precisely the
    // scenario this whole feature targets -- or since edited/deleted), so
    // a real reported bug: reconnecting with a custom deck as the current
    // active deck failed with "Mazo inválido." A known-good precon key
    // sidesteps this entirely, since the value is provably never used.
    var deckId = 'overgrowth';
    openPvpSocket(pvpLiveDuelRoomCode, deckId, getCardBackId(), 'join').then(function (res) {
      hideMenu();
      enterPvpMatch(res.roomCode);
    }).catch(function (err) {
      alert(err.message || 'No se pudo reconectar a ese duelo.');
      pvpLiveDuelRoomCode = null;
      document.getElementById('menuLiveDuelBtn').classList.add('hidden');
    });
  });
  document.getElementById('liveDuelNoBtn').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.add('hidden');
    if (!pvpLiveDuelRoomCode) { return; }
    var roomCode = pvpLiveDuelRoomCode;
    // Same reasoning as liveDuelYesBtn above -- this deckId is never
    // actually applied either (this socket only lives long enough to send
    // 'forfeit'), so a known-good precon key sidesteps validateDeckId
    // rejecting a stale/not-yet-loaded econState.activeDeck.
    var deckId = 'overgrowth';
    openPvpSocket(roomCode, deckId, getCardBackId(), 'join').then(function () {
      return submitMatchActionCloud(roomCode, { type: 'forfeit' });
    }).then(function () {
      leaveRoomCloud();
      pvpLiveDuelRoomCode = null;
      document.getElementById('menuLiveDuelBtn').classList.add('hidden');
    }).catch(function (err) { alert(err.message || 'No se pudo rendir.'); });
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
    if (!pvpMode) { startNewMatch(); return; }
    // Real reported bug: this used to unconditionally fall through to
    // startNewMatch() above even in PVP -- that function's own very first
    // step is resetPvpMatchState(), which closes the shared PVP socket,
    // so "VOLVER A JUGAR" silently dropped the player out of PVP and into
    // a fresh LOCAL match vs CPU instead of back into a room screen. Per
    // the user's own specified rules: the room OWNER (host, pvpMySide ===
    // 'player1') always rejoins THIS SAME room, marked ready right away;
    // the guest does too, UNLESS the host has already left
    // (pvpLastRoomMessage.hostLeft, kept live by the 'leaveRoom' broadcast
    // matchEndCancelBtn's PVP branch sends below) -- in that case there's
    // no room left to rejoin, so the guest becomes the owner of a brand
    // new one instead, exactly like pressing "Crear Sala" fresh.
    var iAmHost = pvpMySide === 'player1';
    var hostGone = !iAmHost && pvpLastRoomMessage && pvpLastRoomMessage.hostLeft;
    var deckId = pvpCurrentDeckId;
    if (hostGone) {
      resetPvpMatchState(); // safe here -- about to open a BRAND NEW socket anyway
      hideBoardScreen();
      document.getElementById('pvpCreateScreen').classList.remove('hidden');
      document.getElementById('pvpCreateDeckPicker').classList.add('hidden');
      document.getElementById('pvpCreateWaiting').classList.remove('hidden');
      createRoomCloud(deckId).then(function (res) {
        renderPvpWaitingMine(deckId);
        document.getElementById('pvpRoomCodeDisplay').textContent = res.roomCode;
        startPvpRoomWait(res.roomCode, deckId);
      }).catch(function (err) { alert(err.message || 'No se pudo crear la sala.'); showMenu(); });
      return;
    }
    // Same-room rematch: deliberately does NOT call resetPvpMatchState --
    // it would close the shared pvpSocket the 'rematch' message below and
    // the room-wait listener both still need. Clearing pvpLastMatchMessage
    // stops initPvpMatchListeners (called once the room flips back to
    // 'started') from replaying this now-finished match's own stale last
    // snapshot into the freshly rematched one for a frame before the real
    // new snapshot arrives -- enterPvpMatch itself (called by
    // startPvpRoomWait below once both sides are ready) already
    // re-initializes every other per-match flag the same way it does for
    // a brand new match.
    // Real reported bug: pressing this on BOTH accounts left the game
    // "mareado" (rapidly flipping screens) and stuck, unresponsive, on the
    // just-finished match's board. Root cause: pvpLastRoomMessage was
    // still caching the ORIGINAL pre-match 'room' broadcast (status
    // 'started', this SAME room code as matchId -- the last 'room' message
    // this client ever saw, since no further room broadcasts happen during
    // actual gameplay). startPvpRoomWait below calls initPvpRoomListener,
    // which replays whatever's cached IMMEDIATELY and SYNCHRONOUSLY -- so
    // it re-entered enterPvpMatch with the OLD, already-finished match's
    // data a split second after this handler had just torn down the board
    // to show the waiting screen, well before the real 'rematch' round
    // trip could ever complete. Must be cleared here too, exactly like
    // pvpLastMatchMessage above, so the replay is a genuine no-op until
    // the real post-rematch room broadcast arrives.
    var myRoomCode = pvpActiveMatchId;
    pvpLastMatchMessage = null;
    pvpLastRoomMessage = null;
    rematchCloud();
    hideBoardScreen();
    document.getElementById('pvpCreateScreen').classList.remove('hidden');
    document.getElementById('pvpCreateDeckPicker').classList.add('hidden');
    document.getElementById('pvpCreateWaiting').classList.remove('hidden');
    renderPvpWaitingMine(deckId);
    document.getElementById('pvpRoomCodeDisplay').textContent = myRoomCode;
    startPvpRoomWait(myRoomCode, deckId);
  });
  document.getElementById('matchEndCancelBtn').addEventListener('click', function () {
    document.getElementById('matchEndModal').classList.add('hidden');
    // Lets a room mate still looking at their own match-end modal learn
    // I'm gone (see leaveRoomCloud/party/index.js's 'leaveRoom' case) --
    // sent BEFORE resetPvpMatchState below closes the socket.
    if (pvpMode) { leaveRoomCloud(); }
    resetPvpMatchState();
    hideBoardScreen();
    showMenu();
  });
  // Real reported bug: clicking the backdrop used to dismiss this modal
  // the same way every other modal's backdrop does -- but the match is
  // genuinely over once this shows (win or loss), and dismissing it left
  // the board sitting there fully clickable/playable with nothing left to
  // legitimately do. Deliberately no backdrop-click handler here: "VOLVER
  // A JUGAR"/"SALIR" (matchEndReplayBtn/matchEndCancelBtn above) are the
  // only ways out.

  // Booster select modal
  document.getElementById('boosterModalClose').addEventListener('click', closeBoosterSelectModal);
  document.querySelector('#boosterSelectModal .card-modal-backdrop').addEventListener('click', closeBoosterSelectModal);
  document.getElementById('boosterOpenBtn').addEventListener('click', openBoosterAndPurchase);

  // Gift booster modal (Tienda's "PACK GRATIS" slot)
  document.getElementById('giftBoosterModalClose').addEventListener('click', closeGiftBoosterModal);
  document.querySelector('#giftBoosterModal .card-modal-backdrop').addEventListener('click', closeGiftBoosterModal);

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
    resetPvpMatchState();
    hideBoardScreen();
    showMenu();
  });
});
