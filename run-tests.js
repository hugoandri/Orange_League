// run-tests.js -- dev-only. Loads the plain (non-module) game scripts into
// a Node vm sandbox and runs tests.js against them. Never loaded by
// index.html/tests.html; those load the same files as real <script> tags.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = [
  'data-sets.js', 'data-decks.js', 'data-cards.js',
  'rules-engine.js', 'card-effects.js', 'ai.js', 'economy.js',
  'shell-layout.js',
  'tests.js'
];

const context = { console: console };
vm.createContext(context);

FILES.forEach(function (file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
});

process.exit(context.__testFailures > 0 ? 1 : 0);
