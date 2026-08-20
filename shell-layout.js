// shell-layout.js -- DOM-free math for the shell redesign. Loaded into the
// Node vm sandbox by run-tests.js (unlike ui.js, which touches `document` at
// load time and can't be), and as a real <script> before ui.js everywhere else.

var SHELL_STAGE_WIDTH = 1920;
var SHELL_STAGE_HEIGHT = 1080;

function computeStageTransform(viewportWidth, viewportHeight) {
  // Math.min (contain): the whole 1920x1080 canvas always stays fully
  // visible, at the cost of letterbox bars on whichever axis has room to
  // spare. Math.max (cover) was tried and reverted -- filling the screen
  // edge-to-edge on a wider-than-16:9 viewport pushes the vertical axis past
  // the viewport, cropping the player card (near the top) and the bottom
  // bar/logout button (bottom:0) off-screen. Nothing being cut off matters
  // more than eliminating the bars.
  var scale = Math.min(viewportWidth / SHELL_STAGE_WIDTH, viewportHeight / SHELL_STAGE_HEIGHT);
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
