// functions/scripts/sync-shared-engine.js
// Regenerates functions/lib/{dataCards,dataDecks,rulesEngine,cardEffects}.js
// from the repo-root source files of the same game logic, verbatim plus a
// module.exports footer -- see docs/superpowers/specs/2026-08-27-pvp-fase1-design.md
// Section 4 for why this exists (only functions/ gets deployed) and why it's
// generated rather than hand-maintained (these files are ~2550 lines of
// active logic, too large to safely hand-sync forever).
//
// Run manually with `node functions/scripts/sync-shared-engine.js`, and
// automatically before every `firebase deploy` via firebase.json's
// "predeploy" hook. NEVER hand-edit anything under functions/lib/ that this
// script generates -- it will be silently overwritten.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(__dirname, '..', 'lib');

// [rootFile, generatedFile, exportNames]
const FILES = [
  ['data-cards.js', 'dataCards.js', ['CARD_STATS']],
  ['data-decks.js', 'dataDecks.js', ['DECKLISTS', 'PRECON_DECK_KEYS']],
  ['rules-engine.js', 'rulesEngine.js', [
    'createGame', 'startMatch', 'canPlayBasic', 'playBasic', 'canEvolve',
    'evolve', 'canAttachEnergy', 'attachEnergy', 'canRetreat', 'retreat',
    'takePrize', 'chooseNewActive', 'canAttack', 'attack',
    'applyEndOfTurnCheckup', 'endTurn', 'drawForTurnStart', 'getWinner',
    'redactMatchState', 'remainingPrizes', 'benchCount', 'findInstance',
    'submitRpsChoice'
  ]],
  ['card-effects.js', 'cardEffects.js', ['ATTACK_EFFECTS', 'TRAINER_EFFECTS', 'POKEMON_POWER_EFFECTS']]
];

fs.mkdirSync(LIB, { recursive: true });

FILES.forEach(([rootFile, generatedFile, exportNames]) => {
  const src = fs.readFileSync(path.join(ROOT, rootFile), 'utf8');
  const footer = '\nif (typeof module !== \'undefined\') {\n' +
    '  module.exports = { ' + exportNames.join(', ') + ' };\n' +
    '}\n';
  fs.writeFileSync(path.join(LIB, generatedFile), src + footer);
  console.log('Synced ' + rootFile + ' -> functions/lib/' + generatedFile);
});
