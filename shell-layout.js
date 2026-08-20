// shell-layout.js -- DOM-free math for the shell redesign. Loaded into the
// Node vm sandbox by run-tests.js (unlike ui.js, which touches `document` at
// load time and can't be), and as a real <script> before ui.js everywhere else.

var SHELL_STAGE_WIDTH = 1920;
var SHELL_STAGE_HEIGHT = 1080;

function computeStageTransform(viewportWidth, viewportHeight) {
  // Math.max (cover) instead of Math.min (contain): fills the whole
  // viewport with no letterbox bars, cropping whichever axis overflows --
  // matches the request to use the full screen width instead of showing bars.
  var scale = Math.max(viewportWidth / SHELL_STAGE_WIDTH, viewportHeight / SHELL_STAGE_HEIGHT);
  var x = (viewportWidth - SHELL_STAGE_WIDTH * scale) / 2;
  var y = (viewportHeight - SHELL_STAGE_HEIGHT * scale) / 2;
  return { x: x, y: y, scale: scale };
}

function collectionProgress(collection, cardCatalog) {
  var total = 0;
  Object.keys(cardCatalog).forEach(function (setKey) {
    total += cardCatalog[setKey].length;
  });
  var owned = collection ? Object.keys(collection).length : 0;
  return { owned: owned, total: total };
}
