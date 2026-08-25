// shell-layout.js -- DOM-free math for the shell redesign. Loaded into the
// Node vm sandbox by run-tests.js (unlike ui.js, which touches `document` at
// load time and can't be), and as a real <script> before ui.js everywhere else.

var SHELL_STAGE_MIN_WIDTH = 1920;
var SHELL_STAGE_MAX_WIDTH = 2560;
var SHELL_STAGE_HEIGHT = 1080;

function computeStageTransform(viewportWidth, viewportHeight) {
  // Elastic-width canvas, per design_handoff_shell_juego_final's "Adaptación
  // a la pantalla" section: height is ALWAYS what drives the scale (never
  // letterboxed left/right on a normal landscape screen); the stage's own
  // width then grows to fill however much real width that scale leaves,
  // clamped to [1920, 2560]. Below 1920 (a viewport narrower than 16:9),
  // scale falls back to being driven by width instead, and bars appear only
  // top/bottom -- never left/right. Beyond 2560 (very ultra-wide), the
  // now-maxed-out stage is centered with bars on both sides rather than
  // stretching the composition apart.
  var scale = viewportHeight / SHELL_STAGE_HEIGHT;
  if (viewportWidth / scale < SHELL_STAGE_MIN_WIDTH) {
    scale = viewportWidth / SHELL_STAGE_MIN_WIDTH;
  }
  var stageWidth = Math.min(Math.max(viewportWidth / scale, SHELL_STAGE_MIN_WIDTH), SHELL_STAGE_MAX_WIDTH);
  var x = (viewportWidth - stageWidth * scale) / 2;
  var y = (viewportHeight - SHELL_STAGE_HEIGHT * scale) / 2;
  return { x: x, y: y, scale: scale, width: stageWidth };
}

function collectionProgress(collection, cardCatalog) {
  var total = 0;
  Object.keys(cardCatalog).forEach(function (setKey) {
    total += cardCatalog[setKey].length;
  });
  var owned = collection ? Object.keys(collection).length : 0;
  return { owned: owned, total: total };
}

// ===== Pixel-bevel digits =====
// Ported from design_handoff_shell_juego_final/Numeros 16 bits.dc.html --
// each digit is drawn as an 8x11-cell grid (a 6x9 stroke plus a 1-cell
// outline ring), not rendered with a font. DOM-free (no `document`): both
// functions below return data/strings only, so ui.js does the actual
// `innerHTML` write.

var PIXEL_DIGIT_GLYPHS = {
  '0': ['.1111.', '11..11', '11..11', '11..11', '11..11', '11..11', '11..11', '11..11', '.1111.'],
  '1': ['..11..', '.111..', '1111..', '..11..', '..11..', '..11..', '..11..', '..11..', '111111'],
  '2': ['.1111.', '11..11', '....11', '....11', '...11.', '..11..', '.11...', '11....', '111111'],
  '3': ['.1111.', '11..11', '....11', '...11.', '..111.', '....11', '....11', '11..11', '.1111.'],
  '4': ['....11', '...111', '..1.11', '.11.11', '11..11', '111111', '111111', '....11', '....11'],
  '5': ['111111', '11....', '11....', '11111.', '....11', '....11', '....11', '11..11', '.1111.'],
  '6': ['..111.', '.11...', '11....', '11....', '11111.', '11..11', '11..11', '11..11', '.1111.'],
  '7': ['111111', '111111', '....11', '...11.', '...11.', '..11..', '..11..', '.11...', '.11...'],
  '8': ['.1111.', '11..11', '11..11', '.1111.', '.1111.', '11..11', '11..11', '11..11', '.1111.'],
  '9': ['.1111.', '11..11', '11..11', '11..11', '.11111', '....11', '....11', '...11.', '.111..'],
  // Colon separator for the duel timer (mm:ss) -- same 6x9 box as the
  // digits so it shares their bevel/outline instead of falling back to a
  // plain-font glyph (buildPixelDigitCells' generic non-digit fallback).
  ':': ['......', '......', '.11...', '.11...', '......', '......', '.11...', '.11...', '......'],
  // Attack-damage modifiers from data-cards.js ("30×", "50-") -- same 6x9
  // bevel treatment as the digits instead of the plain-text fallback, which
  // rendered them in a different font/size/baseline than the digit right
  // next to them and looked broken (this is what the user meant by "el X
  // no quedó bien"). '×' is the real multiplication-sign character the data
  // uses; plain 'x'/'X' and '+' (not in the data yet, but the same family
  // of modifier) share the same shapes for when they show up.
  '×': ['1....1', '.1..1.', '.1..1.', '..11..', '..11..', '..11..', '.1..1.', '.1..1.', '1....1'],
  'x': ['1....1', '.1..1.', '.1..1.', '..11..', '..11..', '..11..', '.1..1.', '.1..1.', '1....1'],
  'X': ['1....1', '.1..1.', '.1..1.', '..11..', '..11..', '..11..', '.1..1.', '.1..1.', '1....1'],
  '-': ['......', '......', '......', '111111', '111111', '......', '......', '......', '......'],
  '+': ['......', '..11..', '..11..', '111111', '111111', '..11..', '..11..', '......', '......'],
  // Coin icon -- same 6x9 stroke/outline box as the digits, the disc sits on
  // the same baseline. rampOffset (buildPixelDigitCells' 4th arg) shifts it
  // down 1 ramp row so the metal starts on a lighter tone, like a numeral.
  'moneda': ['......', '.1111.', '111111', '111111', '11..11', '11..11', '111111', '111111', '.1111.'],
  // Status-condition badge letters (SLP/BRN/PAR/PSN) plus '?' for Confused's
  // "???" -- same 6x9 stroke, rendered in the 'hueso' palette on a colored
  // plate (see PIXEL_STATUS_BADGES).
  'S': ['.1111.', '11..11', '11....', '11....', '.1111.', '....11', '....11', '11..11', '.1111.'],
  'L': ['11....', '11....', '11....', '11....', '11....', '11....', '11....', '11....', '111111'],
  'P': ['11111.', '11..11', '11..11', '11..11', '11111.', '11....', '11....', '11....', '11....'],
  'B': ['11111.', '11..11', '11..11', '11..11', '11111.', '11..11', '11..11', '11..11', '11111.'],
  'R': ['11111.', '11..11', '11..11', '11..11', '11111.', '11.11.', '11..11', '11..11', '11..11'],
  'N': ['11..11', '111.11', '111.11', '11.111', '11.111', '11..11', '11..11', '11..11', '11..11'],
  'A': ['..11..', '.1111.', '11..11', '11..11', '111111', '111111', '11..11', '11..11', '11..11'],
  'C': ['.1111.', '11..11', '11....', '11....', '11....', '11....', '11....', '11..11', '.1111.'],
  'F': ['111111', '11....', '11....', '11111.', '11111.', '11....', '11....', '11....', '11....'],
  '?': ['.1111.', '11..11', '11..11', '....11', '...11.', '..11..', '..11..', '......', '..11..']
};

var PIXEL_DIGIT_PALETTES = {
  oro: { ramp: ['#f4dd9a', '#e8c46a', '#dbb257', '#c99f45', '#b8912f', '#a87f26', '#96701f', '#82601a', '#6d5514'], hi: '#fff6d8', lo: '#5c4610' },
  fosforo: { ramp: ['#b6ff96', '#8dff62', '#77f14f', '#62dd3f', '#4fc832', '#3fb52a', '#329b22', '#26811a', '#1c6614'], hi: '#e8ffdc', lo: '#14520f' },
  dano: { ramp: ['#ff9d8c', '#ff6a5a', '#f45646', '#e64a38', '#d43c2c', '#c02f21', '#ac2418', '#961a10', '#7d120a'], hi: '#ffd9d0', lo: '#5e0d05' },
  plata: { ramp: ['#efe9dd', '#cfc6b6', '#bdb3a1', '#a89e8b', '#948a77', '#7f7664', '#6b6252', '#584f42', '#443c31'], hi: '#ffffff', lo: '#2a251f' },
  brasa: { ramp: ['#ffe1a8', '#ffc46a', '#ffa945', '#f58f2c', '#e2761f', '#c95f16', '#ad4a10', '#8e380b', '#6e2907'], hi: '#fff4d8', lo: '#521c04' },
  // Status-badge letters: nearly white, the color/identity lives on the
  // plate behind them, not the glyph.
  hueso: { ramp: ['#ffffff', '#fbfaf7', '#f5f2ec', '#efebe3', '#e8e3d9', '#e0dacf', '#d7d0c3', '#ccc4b5', '#c0b7a6'], hi: '#ffffff', lo: '#9a9282' }
};

// One badge per real Special Condition (rules-engine.js's statusConditions
// values) -- plate color/outline lifted from the handoff's showcase tile.
var PIXEL_STATUS_BADGES = {
  Asleep: { letters: 'SLP', plateFrom: '#c6c6c6', plateTo: '#6e6e6e', outline: '#2b2b2b' },
  Burned: { letters: 'BRN', plateFrom: '#ffb257', plateTo: '#d2560f', outline: '#5a2408' },
  Paralyzed: { letters: 'PAR', plateFrom: '#ffe561', plateTo: '#e0a80c', outline: '#57400a' },
  Poisoned: { letters: 'PSN', plateFrom: '#b47ce4', plateTo: '#6a2f9e', outline: '#2d1046' },
  Confused: { letters: '???', plateFrom: '#3c3a37', plateTo: '#141312', outline: '#000000' }
};

// Flattens one glyph to its 8x11 cell grid (6x9 stroke + outline ring). The
// outline is computed here, in the data, as a flood fill from outside the
// box inward: only background cells reachable from the border get an
// outline, so enclosed counters (the holes in 0/6/8/9) stay open instead of
// being filled solid -- chaining drop-shadows for the same effect dilates
// the silhouette until it swallows those holes.
function buildPixelDigitCells(ch, paletteName, outlineColor, rampOffset) {
  var rows = PIXEL_DIGIT_GLYPHS[ch];
  if (!rows) { return []; }
  var p = PIXEL_DIGIT_PALETTES[paletteName] || PIXEL_DIGIT_PALETTES.plata;
  var line = outlineColor || '#0a0806';
  function on(x, y) { return x >= 0 && x < 6 && y >= 0 && y < 9 && rows[y].charAt(x) === '1'; }

  var last = [];
  for (var x = 0; x < 6; x++) {
    var l = -1;
    for (var y = 0; y < 9; y++) { if (on(x, y)) { l = y; } }
    last.push(l);
  }

  function key(gx, gy) { return gy * 8 + gx; }
  var outside = {};
  var stack = [];
  for (var gx0 = 0; gx0 < 8; gx0++) { stack.push([gx0, 0]); stack.push([gx0, 10]); }
  for (var gy0 = 0; gy0 < 11; gy0++) { stack.push([0, gy0]); stack.push([7, gy0]); }
  while (stack.length) {
    var top = stack.pop();
    var gx = top[0], gy = top[1];
    if (gx < 0 || gx > 7 || gy < 0 || gy > 10) { continue; }
    if (outside[key(gx, gy)]) { continue; }
    if (on(gx - 1, gy - 1)) { continue; }
    outside[key(gx, gy)] = true;
    stack.push([gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]);
  }

  // The highlight runs along the stroke's top-outer edge: a cell lights up if
  // what's directly above it is background reachable from outside.
  var lit = {};
  for (var ly = 0; ly < 11; ly++) {
    for (var lx = 0; lx < 8; lx++) {
      if (on(lx - 1, ly - 1) && outside[key(lx, ly - 1)]) { lit[key(lx, ly)] = true; }
    }
  }
  // A lit cell with no lit neighbor (ortho or diagonal) reads as a stray
  // speck, not a bevel -- drop it to the ramp's lightest tone instead.
  var lonely = {};
  Object.keys(lit).forEach(function (k) {
    var kk = parseInt(k, 10);
    var gx = kk % 8, gy = (kk - gx) / 8;
    var n = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) { continue; }
        if (lit[key(gx + dx, gy + dy)]) { n++; }
      }
    }
    if (!n) { lonely[k] = true; }
  });

  var cells = [];
  for (var cy = 0; cy < 11; cy++) {
    for (var cx = 0; cx < 8; cx++) {
      var x2 = cx - 1, y2 = cy - 1;
      var k2 = key(cx, cy);
      if (on(x2, y2)) {
        var bg = p.ramp[Math.max(0, Math.min(8, y2 - (rampOffset || 0)))];
        if (lit[k2]) { bg = lonely[k2] ? p.ramp[0] : p.hi; }
        else if (y2 === last[x2] && y2 > 2) { bg = p.lo; }
        cells.push({ bg: bg });
      } else if (outside[k2] && (on(x2 - 1, y2) || on(x2 + 1, y2) || on(x2, y2 - 1) || on(x2, y2 + 1))) {
        cells.push({ bg: line });
      } else {
        cells.push({ bg: 'transparent' });
      }
    }
  }
  return cells;
}

// Renders a string of digits as an inline row of pixel-bevel glyphs.
// blockPx is the size of one cell (each glyph is 8*blockPx wide, 11*blockPx
// tall) -- must be a whole number of pixels, per the source spec ("un
// bloque fraccionario rompe el borde"). Non-digit characters (e.g. a
// leading '-') pass through as plain text sized to roughly match.
function pixelDigitsHtml(str, paletteName, blockPx, outlineColor) {
  var gap = blockPx * 2;
  var parts = String(str).split('').map(function (ch) {
    var cells = buildPixelDigitCells(ch, paletteName, outlineColor);
    if (!cells.length) {
      return '<span style="font-family:\'Silkscreen\',monospace;">' + ch + '</span>';
    }
    var inner = cells.map(function (c) {
      return '<div style="width:' + blockPx + 'px;height:' + blockPx + 'px;background:' + c.bg + ';"></div>';
    }).join('');
    return '<div style="display:grid;grid-template-columns:repeat(8,' + blockPx + 'px);' +
      'grid-auto-rows:' + blockPx + 'px;filter:drop-shadow(0 ' + blockPx + 'px 0 rgba(0,0,0,.5));">' + inner + '</div>';
  });
  return '<span style="display:inline-flex;align-items:flex-end;gap:' + gap + 'px;vertical-align:bottom;">' +
    parts.join('') + '</span>';
}

// Same pixel-glyph coin icon used throughout the shell (menu balance, shop
// header, booster price, board profile footer) -- replaces the old plain
// gradient-circle divs those spots used before.
function pixelCoinHtml(paletteName, blockPx) {
  var cells = buildPixelDigitCells('moneda', paletteName, null, 1);
  var inner = cells.map(function (c) {
    return '<div style="width:' + blockPx + 'px;height:' + blockPx + 'px;background:' + c.bg + ';"></div>';
  }).join('');
  return '<span style="display:inline-grid;grid-template-columns:repeat(8,' + blockPx + 'px);' +
    'grid-auto-rows:' + blockPx + 'px;filter:drop-shadow(0 ' + blockPx + 'px 0 rgba(0,0,0,.5));vertical-align:bottom;">' +
    inner + '</span>';
}

// Shared by pixelStatusBadgeHtml and pixelPlusPowerBadgeHtml below: renders
// any {letters, plateFrom, plateTo, outline} config as one colored plate
// with its glyphs in bone.
function renderPixelBadgePlate(cfg, blockPx, titleText) {
  var gap = Math.max(1, Math.round(blockPx * 0.6));
  var glyphs = cfg.letters.split('').map(function (ch) {
    var cells = buildPixelDigitCells(ch, 'hueso', cfg.outline);
    var inner = cells.map(function (c) {
      return '<div style="width:' + blockPx + 'px;height:' + blockPx + 'px;background:' + c.bg + ';"></div>';
    }).join('');
    return '<div style="display:grid;grid-template-columns:repeat(8,' + blockPx + 'px);grid-auto-rows:' + blockPx + 'px;">' + inner + '</div>';
  }).join('');
  return '<div class="shell-status-badge" style="background:linear-gradient(180deg,' + cfg.plateFrom + ',' + cfg.plateTo + ');" title="' + titleText + '">' +
    '<div style="display:flex;gap:' + gap + 'px;">' + glyphs + '</div>' +
    '</div>';
}

// One small pixel-glyph badge per real Special Condition (rules-engine.js),
// each its own colored plate with the 3-letter/symbol code in bone. Meant
// to sit at the *bottom* of the Active Pokémon's card art (see
// .shell-board-active-status-badges in shell-theme.css) -- opposite corner
// from the attached-energy icons so the two overlays never collide.
function pixelStatusBadgeHtml(statusKey, blockPx) {
  var cfg = PIXEL_STATUS_BADGES[statusKey];
  if (!cfg) { return ''; }
  return renderPixelBadgePlate(cfg, blockPx, statusKey);
}

// Same badge style as the Special Condition ones above, but for PlusPower
// (a Trainer effect, not a real Special Condition -- kept out of
// PIXEL_STATUS_BADGES so "every real Special Condition has a status badge"
// stays a meaningful invariant) -- shows "+10" on whichever Active has it
// attached this turn, per user request ("una ficha con el mismo estilo de
// los estados pero que diga +10").
var PIXEL_PLUSPOWER_BADGE = { letters: '+10', plateFrom: '#ff7ad1', plateTo: '#c8258f', outline: '#4a0d38' };
function pixelPlusPowerBadgeHtml(blockPx) {
  return renderPixelBadgePlate(PIXEL_PLUSPOWER_BADGE, blockPx, 'Más Potencia');
}
