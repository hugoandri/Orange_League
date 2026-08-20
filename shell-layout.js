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
