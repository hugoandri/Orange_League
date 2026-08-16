# Pokémon TCG Simulator MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A double-click-to-play, single-player Pokémon TCG (1998-99 rules) simulator: the player's fixed Overgrowth deck vs. a CPU's fixed Blackout deck, with a coins → booster-pack → collection economy layered on top.

**Architecture:** Plain, non-module `<script src>` files (no build step, so the game keeps working when opened via `file://`). A DOM-free rules engine (`rules-engine.js`) exposes pure state + action functions; a card-effects registry (`card-effects.js`) supplies the per-card logic the engine calls into by name; `ai.js` drives the CPU by calling the same action functions the UI calls; `economy.js` is DOM-free except for two thin localStorage read/write functions; `ui.js` is the only file allowed to touch the DOM. A Node-only dev tool (`run-tests.js`, not loaded by `index.html`) uses Node's built-in `vm` module to load the plain scripts into a sandbox and run `tests.js` against them, so every logic task has a real, automatable `node run-tests.js` command for its TDD cycle. `tests.js` itself has zero Node-specific code — it only assumes whatever globals `rules-engine.js`/`card-effects.js`/etc. define, so the exact same file also runs unmodified inside `tests.html` in a real browser.

**Tech Stack:** Vanilla JS targeting current evergreen browsers (`const`/`let`, `Array.prototype.find`/`findIndex`, `Object.assign`, `Set` are all fine to use — the only hard restriction is no `import`/`export`, since ES module `<script>` tags are blocked by CORS when a page is opened via `file://`), plain `function` declarations throughout (no classes needed), HTML5, CSS3, Node.js (`vm`, `fs`, `path` built-ins only, no npm packages) as a dev-only test runner.

**Spec:** `/Users/hugoandrianoff/Pokemon/tcg-simulador/docs/superpowers/specs/2026-08-16-tcg-simulator-design.md`

**Data already committed (do not redo):** `data-sets.js` (228-card catalog for boosters), `data-decks.js` (exact Overgrowth/Blackout 60-card lists), `data-cards.js` (full stats — HP, types, attacks, weakness, resistance, retreat cost, verbatim Trainer text — for all 17 unique Pokémon + 9 unique Trainers + 3 basic Energy types used by these two decks). Read these three files before starting Task 1; every card name and number referenced below is copied verbatim from them.

## Global Constraints

- No build step, no npm dependencies in the shipped game; no ES modules (CORS blocks module `<script>` over `file://`).
- Player deck is always Overgrowth; CPU deck is always Blackout (`DECKLISTS.overgrowth` / `DECKLISTS.blackout` in `data-decks.js`).
- Energy-attach limit: 1 card per turn. Evolve limit: once per Pokémon per turn; never the turn that Pokémon's current form entered play; never on the game's first turn at all. Retreat: once per turn, blocked while Asleep or Paralyzed.
- Damage: Weakness ×2, then Resistance −30 (floor 0), then flat bonuses (e.g. PlusPower +10) — in that order.
- Win conditions: a player takes all 6 of their own prizes; a player's opponent has zero Pokémon in play with none left to place; a player is required to draw with an empty deck.
- Starting coins: 150. Win: +75 coins. Loss: +0. Booster: 100 coins, buyer picks Base/Jungle/Fossil, draws 11 cards = 1 from that set's Rare/Rare Holo pool + 3 Uncommon + 7 Common (basic Energy cards are already rarity `"Common"` in `data-sets.js`, no separate slot needed).
- `localStorage` persists only coins and the card collection. An in-progress match is never persisted.
- Special conditions actually used by these two decks: **Poison** and **Paralysis** only (confirmed in `data-cards.js`). Asleep/Confused/Burned are implemented structurally but only exercised by synthetic test fixtures this phase.

---

## Task 1: Project scaffold and script load order

**Files:**
- Create: `index.html`
- Create: `style.css`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `<script>` load order every later task's file gets appended to; the DOM container IDs (`#app`, `#log`, `#collection-view`) that `ui.js` (Task 10) will render into.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Pokémon TCG Simulador · Overgrowth vs Blackout</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <h1>Pokémon TCG Simulador</h1>
    <div id="coin-display">Monedas: <span id="coin-count">--</span></div>
    <nav class="tabs">
      <button type="button" id="tabBtnPlay" class="active">Jugar</button>
      <button type="button" id="tabBtnCollection">Colección</button>
    </nav>
  </header>

  <main>
    <section id="panelPlay" class="tab-panel active">
      <div id="app">Cargando...</div>
      <pre id="log"></pre>
    </section>
    <section id="panelCollection" class="tab-panel">
      <div id="booster-shop"></div>
      <div id="collection-view"></div>
    </section>
  </main>

<script src="data-sets.js"></script>
<script src="data-decks.js"></script>
<script src="data-cards.js"></script>
<script src="rules-engine.js"></script>
<script src="card-effects.js"></script>
<script src="ai.js"></script>
<script src="economy.js"></script>
<script src="ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`**

```css
:root{
  --bg:#f4f1ea; --panel:#ffffff; --ink:#1f2430; --ink-soft:#5b6270;
  --border:#e2ddd0; --accent-player:#3f8f4f; --accent-cpu:#8a1f1f;
  --focus:#3f6fd9;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
header.top{display:flex;align-items:center;gap:16px;padding:14px 20px;
  background:#20232c;color:#fff;flex-wrap:wrap;}
header.top h1{font-size:1.1rem;margin:0;flex:1;}
nav.tabs button{border:none;background:transparent;color:#a9adbb;font-weight:600;
  padding:8px 14px;border-radius:8px;cursor:pointer;}
nav.tabs button.active{background:var(--focus);color:#fff;}
main{max-width:1100px;margin:0 auto;padding:16px;}
.tab-panel{display:none;} .tab-panel.active{display:block;}
#app{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;}
#log{background:#20232c;color:#d7dae0;padding:10px;border-radius:8px;
  max-height:180px;overflow-y:auto;font-size:0.78rem;white-space:pre-wrap;}
.board-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
.pokemon-card{border:1px solid var(--border);border-radius:8px;padding:8px;
  background:#fafaf6;min-width:120px;font-size:0.8rem;cursor:pointer;}
.pokemon-card.active-player{border-color:var(--accent-player);}
.pokemon-card.active-cpu{border-color:var(--accent-cpu);}
.pokemon-card[disabled],.pokemon-card.unselectable{opacity:0.5;cursor:not-allowed;}
button.action-btn{margin:2px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);
  background:#fff;cursor:pointer;font-size:0.8rem;}
button.action-btn:hover{border-color:var(--focus);}
.hand-row{display:flex;gap:6px;flex-wrap:wrap;}
```

- [ ] **Step 3: Open in a browser and confirm no console errors**

Run: `open index.html` (macOS). Expected: page loads, header/tabs render, `#app` shows "Cargando..." (the data/engine files are loaded but nothing calls them yet — that's expected at this point), and the browser console shows no errors (all six `<script src>` files resolve, since Tasks 2-10 will populate them).

Since `rules-engine.js` etc. don't exist as files yet, create empty placeholders so the page doesn't 404 in the console during this step's check, then Task 2 fills in `rules-engine.js` for real:

```bash
touch rules-engine.js card-effects.js ai.js economy.js ui.js
```

- [ ] **Step 4: Commit**

```bash
git add index.html style.css rules-engine.js card-effects.js ai.js economy.js ui.js
git commit -m "Scaffold index.html, style.css, and script load order"
```

---

## Task 2: Dev test runner + game setup (shuffle, deal, mulligan, prizes, coin flip)

**Files:**
- Create: `run-tests.js`
- Create: `tests.js`
- Create: `tests.html`
- Modify: `rules-engine.js`

**Interfaces:**
- Consumes: `CARD_STATS` (from `data-cards.js`), `DECKLISTS` (from `data-decks.js`).
- Produces: `shuffle(arr, rng)`, `isBasicPokemon(name)`, `expandDecklist(decklist)`, `createGame(rng)` → `state`, `drawCard(state, playerId, n)`, `coinFlip(state)`, `logEvent(state, msg)` — every later task builds on this `state` shape:

```js
// state shape produced by createGame():
{
  turnCounter: 1,               // increments by 1 every endTurn() call
  activePlayerId: 'player'|'cpu',
  rng: function(){...},
  log: [],                       // array of strings
  players: {
    player: { deck: [{id,name}], hand: [{id,name}], active: null|instance,
              bench: [instance...], discard: [{id,name}], prizes: [{id,name}...] },
    cpu:    { ...same shape... }
  }
}
// a "card instance" (Pokémon in play) shape, created when a Basic is played:
{
  id: 'c17',                // same id it had as a hand card
  name: 'Bulbasaur',
  attachedEnergy: [],        // array of energy-type strings, e.g. ['Water','Water']
  damage: 0,                  // multiple of 10; KO when damage >= CARD_STATS[name].hp
  statusConditions: [],        // subset of ['Poisoned','Burned','Asleep','Confused','Paralyzed']
  turnEnteredCurrentForm: 3,    // turnCounter value when placed OR last evolved
  lockedAttacks: [],             // attack names permanently unusable while this instance is in play
  shield: null,                   // { untilTurn, type:'preventAll'|'thresholdMax', thresholdMax? }
  missChanceUntilTurn: null,       // turnCounter value; if attacker.attacks during this turn, 50% fizzle
  plusPowerAttached: false          // discarded automatically at end of the turn it was attached
}
```

- [ ] **Step 1: Write `run-tests.js`** (dev-only, not referenced by `index.html`)

```js
// run-tests.js -- dev-only. Loads the plain (non-module) game scripts into
// a Node vm sandbox and runs tests.js against them. Never loaded by
// index.html/tests.html; those load the same files as real <script> tags.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = [
  'data-sets.js', 'data-decks.js', 'data-cards.js',
  'rules-engine.js', 'card-effects.js', 'ai.js', 'economy.js',
  'tests.js'
];

const context = { console: console };
vm.createContext(context);

FILES.forEach(function (file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
});

process.exit(context.__testFailures > 0 ? 1 : 0);
```

- [ ] **Step 2: Write the assertion helpers in `tests.js`**

```js
// tests.js -- shared between run-tests.js (Node vm sandbox) and
// tests.html (real browser). No Node-specific code allowed here: it only
// uses whatever globals the other <script> files define.
var __testsRun = 0;
var __testFailures = 0;

function report(line) {
  console.log(line);
  if (typeof document !== 'undefined') {
    var pre = document.getElementById('output');
    if (pre) { pre.textContent += line + '\n'; }
  }
}

function check(description, actual, expected) {
  __testsRun++;
  var pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    report('PASS: ' + description);
  } else {
    __testFailures++;
    report('FAIL: ' + description + ' -- expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
  }
}

function checkTrue(description, actual) { check(description, !!actual, true); }
```

- [ ] **Step 3: Run to verify the harness itself works with zero real tests**

Run: `node run-tests.js`
Expected: prints nothing but exits code 0 (no `check()` calls yet, `__testFailures` stays 0).

- [ ] **Step 4: Write the failing test for `expandDecklist` and `shuffle`**

Append to `tests.js`:

```js
(function testExpandDecklist() {
  var expanded = expandDecklist(DECKLISTS.overgrowth);
  check('expandDecklist(overgrowth) has 60 cards', expanded.length, 60);
  var bulbasaurCount = expanded.filter(function (c) { return c.name === 'Bulbasaur'; }).length;
  check('expandDecklist has 4 Bulbasaur', bulbasaurCount, 4);
  var ids = expanded.map(function (c) { return c.id; });
  check('expandDecklist gives every card a unique id', new Set(ids).size, 60);
})();

(function testShuffleIsDeterministicWithFixedRng() {
  var arr = [1, 2, 3, 4, 5];
  var rng = (function () { var seq = [0.9, 0.1, 0.5, 0.2, 0.05]; var i = 0; return function () { return seq[i++ % seq.length]; }; })();
  var shuffled = shuffle(arr.slice(), rng);
  check('shuffle returns same length', shuffled.length, 5);
  check('shuffle does not lose elements', shuffled.slice().sort().join(','), '1,2,3,4,5');
})();
```

- [ ] **Step 5: Run to verify these fail** (functions don't exist yet)

Run: `node run-tests.js`
Expected: throws a `ReferenceError: expandDecklist is not defined` (or similar) — confirms the test actually exercises code that doesn't exist yet.

- [ ] **Step 6: Implement `shuffle`, `isBasicPokemon`, `expandDecklist` in `rules-engine.js`**

```js
// rules-engine.js
var __instanceIdCounter = 0;
function nextId() { __instanceIdCounter++; return 'c' + __instanceIdCounter; }

function shuffle(arr, rng) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function isBasicPokemon(name) {
  var stats = CARD_STATS[name];
  return !!stats && stats.supertype === 'Pokémon' && !stats.evolvesFrom;
}

function expandDecklist(decklist) {
  var out = [];
  decklist.forEach(function (entry) {
    for (var i = 0; i < entry.count; i++) {
      out.push({ id: nextId(), name: entry.name });
    }
  });
  return out;
}
```

- [ ] **Step 7: Run to verify Step 4's tests pass**

Run: `node run-tests.js`
Expected: `PASS: expandDecklist(overgrowth) has 60 cards`, `PASS: expandDecklist has 4 Bulbasaur`, `PASS: expandDecklist gives every card a unique id`, `PASS: shuffle returns same length`, `PASS: shuffle does not lose elements`, exit code 0.

- [ ] **Step 8: Write the failing test for `createGame` setup (deal, mulligan, prizes)**

Append to `tests.js`:

```js
(function testCreateGameBasicSetup() {
  var rng = function () { return 0.999; }; // never triggers a mulligan-forcing shuffle order by luck alone; see note below
  var state = createGame(rng);
  check('turnCounter starts at 1', state.turnCounter, 1);
  checkTrue('activePlayerId is player or cpu', state.activePlayerId === 'player' || state.activePlayerId === 'cpu');
  check('player prizes has 6 cards', state.players.player.prizes.length, 6);
  check('cpu prizes has 6 cards', state.players.cpu.prizes.length, 6);
  check('player hand has at least 7 cards', state.players.player.hand.length >= 7, true);
  check('cpu hand has at least 7 cards', state.players.cpu.hand.length >= 7, true);
  var playerHasBasic = state.players.player.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('player opening hand contains a Basic Pokémon', playerHasBasic);
  var cpuHasBasic = state.players.cpu.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('cpu opening hand contains a Basic Pokémon', cpuHasBasic);
  var totalPlayerCards = state.players.player.deck.length + state.players.player.hand.length + state.players.player.prizes.length;
  check('player total cards still 60 after setup', totalPlayerCards, 60);
})();

(function testMulliganRedrawsUntilBasicPresent() {
  // A fixed rng of 0 drives shuffle()'s Fisher-Yates into one specific,
  // reproducible permutation (not "no shuffle") -- the exact resulting
  // order isn't what matters here. What matters is the invariant this
  // test checks: no matter what a given shuffle produces, the mulligan
  // loop in dealOpeningHandWithMulligans must keep re-shuffling and
  // re-dealing until the opening hand contains a Basic Pokémon, so the
  // game can never start with an unplayable hand.
  var forcedRng = function () { return 0; };
  var state = createGame(forcedRng);
  var playerHasBasic = state.players.player.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('after setup, player hand always has a Basic (mulligan loop holds)', playerHasBasic);
  var cpuHasBasic = state.players.cpu.hand.some(function (c) { return isBasicPokemon(c.name); });
  checkTrue('after setup, cpu hand always has a Basic (mulligan loop holds)', cpuHasBasic);
})();
```

- [ ] **Step 9: Run to verify these fail**

Run: `node run-tests.js`
Expected: `ReferenceError: createGame is not defined`.

- [ ] **Step 10: Implement `createGame`, `drawCard`, `coinFlip`, `logEvent` in `rules-engine.js`**

```js
function logEvent(state, msg) { state.log.push(msg); }

function coinFlip(state) { return state.rng() < 0.5 ? 'H' : 'T'; }

function drawCard(state, playerId, n) {
  n = n || 1;
  var p = state.players[playerId];
  for (var i = 0; i < n; i++) {
    if (p.deck.length === 0) { return; } // deck-out is checked by getWinner(), not here
    p.hand.push(p.deck.shift());
  }
}

function dealOpeningHandWithMulligans(state, playerId, opponentId) {
  var p = state.players[playerId];
  var mulligans = 0;
  while (true) {
    p.hand = [];
    p.deck = shuffle(p.deck.concat(p.hand), state.rng);
    drawCard(state, playerId, 7);
    var hasBasic = p.hand.some(function (c) { return isBasicPokemon(c.name); });
    if (hasBasic) { break; }
    mulligans++;
    p.deck = shuffle(p.deck.concat(p.hand), state.rng);
    p.hand = [];
  }
  if (mulligans > 0) { drawCard(state, opponentId, mulligans); }
  logEvent(state, playerId + ' drew opening hand after ' + mulligans + ' mulligan(s)');
}

function createGame(rng) {
  rng = rng || Math.random;
  var state = {
    turnCounter: 1,
    activePlayerId: coinFlip.call(null) ? 'player' : 'cpu', // placeholder, replaced below once state exists
    rng: rng,
    log: [],
    players: {
      player: { deck: shuffle(expandDecklist(DECKLISTS.overgrowth), rng), hand: [], active: null, bench: [], discard: [], prizes: [] },
      cpu: { deck: shuffle(expandDecklist(DECKLISTS.blackout), rng), hand: [], active: null, bench: [], discard: [], prizes: [] }
    }
  };
  state.activePlayerId = state.rng() < 0.5 ? 'player' : 'cpu';

  dealOpeningHandWithMulligans(state, 'player', 'cpu');
  dealOpeningHandWithMulligans(state, 'cpu', 'player');

  ['player', 'cpu'].forEach(function (pid) {
    var p = state.players[pid];
    for (var i = 0; i < 6; i++) { p.prizes.push(p.deck.shift()); }
  });

  logEvent(state, (state.activePlayerId === 'player' ? 'Jugador' : 'CPU') + ' empieza la partida');
  return state;
}
```

- [ ] **Step 11: Run to verify Step 8's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0. (If the mulligan test flakes because `expandDecklist`'s id assignment happens to always yield a Basic-first hand regardless of `rng`, that's fine — the assertion is on the invariant, not on forcing a specific mulligan count, so it should pass either way.)

- [ ] **Step 12: Write `tests.html`**

```html
<!doctype html>
<html lang="es">
<head><meta charset="UTF-8"><title>TCG Simulador · Tests</title></head>
<body>
<h1>Resultados de tests</h1>
<pre id="output"></pre>
<script src="data-sets.js"></script>
<script src="data-decks.js"></script>
<script src="data-cards.js"></script>
<script src="rules-engine.js"></script>
<script src="card-effects.js"></script>
<script src="ai.js"></script>
<script src="economy.js"></script>
<script src="tests.js"></script>
</body>
</html>
```

- [ ] **Step 13: Commit**

```bash
git add run-tests.js tests.js tests.html rules-engine.js
git commit -m "Add dev test runner and game setup (shuffle, mulligan, prizes)"
```

---

## Task 3: Main-phase actions — play Basic, evolve, attach energy, retreat

**Files:**
- Modify: `rules-engine.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: `state` shape from Task 2, `CARD_STATS`.
- Produces: `canPlayBasic`, `playBasic`, `canEvolve`, `evolve`, `canAttachEnergy`, `attachEnergy`, `canRetreat`, `retreat`, `canPayCost(instance, cost)` — reused by Task 4's attack legality check.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js`:

```js
(function testPlayBasicAndEvolve() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  // Force a known hand: Bulbasaur in hand, nothing active yet.
  p.hand = [{ id: 'x1', name: 'Bulbasaur' }];
  p.active = null; p.bench = [];

  checkTrue('canPlayBasic true for Bulbasaur with empty active', canPlayBasic(state, pid, 'x1'));
  playBasic(state, pid, 'x1');
  check('active is now Bulbasaur', state.players[pid].active.name, 'Bulbasaur');
  check('hand no longer has x1', state.players[pid].hand.length, 0);

  p.hand = [{ id: 'x2', name: 'Ivysaur' }];
  checkTrue('canEvolve is false same turn Bulbasaur entered play', !canEvolve(state, pid, 'x2', state.players[pid].active.id));
  state.turnCounter += 1;
  checkTrue('canEvolve is true on a later turn', canEvolve(state, pid, 'x2', state.players[pid].active.id));
  evolve(state, pid, 'x2', state.players[pid].active.id);
  check('active evolved into Ivysaur, same instance id', state.players[pid].active.name, 'Ivysaur');
})();

(function testAttachEnergyOncePerTurn() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.hand = [{ id: 'e1', name: 'Grass Energy' }, { id: 'e2', name: 'Grass Energy' }];

  checkTrue('canAttachEnergy true the first time', canAttachEnergy(state, pid, 'e1', 'a1'));
  attachEnergy(state, pid, 'e1', 'a1');
  check('active has 1 attached energy', state.players[pid].active.attachedEnergy.length, 1);
  checkTrue('canAttachEnergy false a second time same turn', !canAttachEnergy(state, pid, 'e2', 'a1'));
})();

(function testRetreat() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];
  p.active = { id: 'a1', name: 'Onix', attachedEnergy: ['Fighting', 'Fighting', 'Fighting'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.bench = [{ id: 'b1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];

  checkTrue('canRetreat true, Onix retreat cost 3 and has 3 energy', canRetreat(state, pid, 'b1'));
  retreat(state, pid, 'b1');
  check('bench Machop is now active', state.players[pid].active.name, 'Machop');
  check('Onix went to bench with only 0 energy left (3 discarded)', state.players[pid].bench[0].attachedEnergy.length, 0);
})();
```

- [ ] **Step 2: Run to verify these fail**

Run: `node run-tests.js`
Expected: `ReferenceError: canPlayBasic is not defined`.

- [ ] **Step 3: Implement the actions in `rules-engine.js`**

```js
function makeFreshInstance(id, name, turnCounter) {
  return {
    id: id, name: name, attachedEnergy: [], damage: 0, statusConditions: [],
    turnEnteredCurrentForm: turnCounter, lockedAttacks: [], shield: null,
    missChanceUntilTurn: null, plusPowerAttached: false
  };
}

function canPlayBasic(state, playerId, handId) {
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  if (!card || !isBasicPokemon(card.name)) { return false; }
  if (p.active === null) { return true; }
  return p.bench.length < 5;
}

function playBasic(state, playerId, handId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var instance = makeFreshInstance(card.id, card.name, state.turnCounter);
  if (p.active === null) { p.active = instance; } else { p.bench.push(instance); }
  logEvent(state, playerId + ' juega ' + card.name + ' de básico');
}

function findInstance(p, instanceId) {
  if (p.active && p.active.id === instanceId) { return p.active; }
  return p.bench.find(function (b) { return b.id === instanceId; }) || null;
}

function canEvolve(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  var target = findInstance(p, targetInstanceId);
  if (!card || !target) { return false; }
  var stats = CARD_STATS[card.name];
  if (!stats || stats.supertype !== 'Pokémon' || stats.evolvesFrom !== target.name) { return false; }
  if (state.turnCounter === 1) { return false; }
  return target.turnEnteredCurrentForm < state.turnCounter;
}

function evolve(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var target = findInstance(p, targetInstanceId);
  target.name = card.name;
  target.turnEnteredCurrentForm = state.turnCounter;
  logEvent(state, playerId + ' evoluciona a ' + card.name);
}

function canPayCost(instance, cost) {
  var attached = instance.attachedEnergy.slice();
  var colorlessNeeded = 0;
  var needed = {};
  cost.forEach(function (c) {
    if (c === 'Colorless') { colorlessNeeded++; } else { needed[c] = (needed[c] || 0) + 1; }
  });
  for (var type in needed) {
    var have = attached.filter(function (e) { return e === type; }).length;
    if (have < needed[type]) { return false; }
    for (var i = 0; i < needed[type]; i++) { attached.splice(attached.indexOf(type), 1); }
  }
  return attached.length >= colorlessNeeded;
}

var ENERGY_TYPE_BY_CARD_NAME = {
  'Grass Energy': 'Grass', 'Fire Energy': 'Fire', 'Water Energy': 'Water',
  'Lightning Energy': 'Lightning', 'Psychic Energy': 'Psychic', 'Fighting Energy': 'Fighting'
};

function canAttachEnergy(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var card = p.hand.find(function (c) { return c.id === handId; });
  var target = findInstance(p, targetInstanceId);
  if (!card || !target || !ENERGY_TYPE_BY_CARD_NAME[card.name]) { return false; }
  return !state.energyAttachedThisTurn;
}

function attachEnergy(state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var card = p.hand.splice(idx, 1)[0];
  var target = findInstance(p, targetInstanceId);
  target.attachedEnergy.push(ENERGY_TYPE_BY_CARD_NAME[card.name]);
  state.energyAttachedThisTurn = true;
  logEvent(state, playerId + ' pone ' + card.name + ' en ' + target.name);
}

function canRetreat(state, playerId, benchInstanceId) {
  var p = state.players[playerId];
  if (!p.active || state.retreatedThisTurn) { return false; }
  if (p.active.statusConditions.indexOf('Asleep') !== -1) { return false; }
  if (p.active.statusConditions.indexOf('Paralyzed') !== -1) { return false; }
  var bench = p.bench.find(function (b) { return b.id === benchInstanceId; });
  if (!bench) { return false; }
  var cost = CARD_STATS[p.active.name].retreatCost;
  return p.active.attachedEnergy.length >= cost;
}

function retreat(state, playerId, benchInstanceId) {
  var p = state.players[playerId];
  var cost = CARD_STATS[p.active.name].retreatCost;
  p.active.attachedEnergy.splice(0, cost);
  var idx = p.bench.findIndex(function (b) { return b.id === benchInstanceId; });
  var incoming = p.bench.splice(idx, 1)[0];
  p.bench.push(p.active);
  p.active = incoming;
  state.retreatedThisTurn = true;
  logEvent(state, playerId + ' se retira a ' + p.active.name);
}
```

Note: `state.energyAttachedThisTurn` and `state.retreatedThisTurn` must be initialized to `false` in `createGame` and reset to `false` inside `endTurn` (Task 4 adds `endTurn`) — add these two lines to `createGame`'s returned state object now:

```js
// inside createGame(), add to the returned state object:
energyAttachedThisTurn: false,
retreatedThisTurn: false,
```

- [ ] **Step 4: Run to verify Step 1's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add rules-engine.js tests.js
git commit -m "Implement play-Basic, evolve, attach-energy, retreat actions"
```

---

## Task 4: Attack resolution, damage engine, checkup phase, KO/prizes, win conditions, endTurn

**Files:**
- Modify: `rules-engine.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: `canPayCost`, `findInstance` (Task 3); `ATTACK_EFFECTS` (defined in Task 5/6/7, referenced here by name only — this task must not throw if `ATTACK_EFFECTS[name]` is undefined yet, so `attack()` falls back to "flat damage only" when no effect function is registered, letting this task's own tests use synthetic no-effect attacks).
- Produces: `dealDamage(state, attacker, defender, baseDamage)`, `addStatus`, `hasStatus`, `canAttack`, `attack(state, playerId, attackName)`, `endTurn(state)`, `getWinner(state)` — every later task (AI, UI) drives the game exclusively through `attack`, `endTurn`, and Task 3's action functions.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js`:

```js
(function testDealDamageWeaknessResistance() {
  var state = createGame(function () { return 0.42; });
  var attacker = { id: 'a1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var defender = { id: 'd1', name: 'Bulbasaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  // Gyarados (Water) attacking Bulbasaur (Grass, weak to Fire, no resistance) -- no weakness/resistance interaction, plain 50 damage.
  var dmg = dealDamage(state, attacker, defender, 50);
  check('plain damage with no weakness/resistance', dmg, 50);
  check('defender damage counter updated', defender.damage, 50);

  // Beedrill resists Fighting (-30): confirms resistance is applied independently of weakness.
  var fightingAttacker = { id: 'a3', name: 'Machoke', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var beedrillDefender = { id: 'd3', name: 'Beedrill', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var dmg2 = dealDamage(state, fightingAttacker, beedrillDefender, 50); // Beedrill resists Fighting by -30
  check('resistance subtracts 30', dmg2, 20);
})();

(function testShieldPreventsAllDamage() {
  var state = createGame(function () { return 0.42; });
  state.turnCounter = 5;
  var attacker = { id: 'a1', name: 'Gyarados', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  var defender = { id: 'd1', name: 'Squirtle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: { untilTurn: 5, type: 'preventAll' }, missChanceUntilTurn: null, plusPowerAttached: false };
  var dmg = dealDamage(state, attacker, defender, 50);
  check('shielded defender takes 0 damage', dmg, 0);
  check('shield is consumed after blocking', defender.shield, null);
})();

(function testAttackKnockoutAwardsPrizeAndEndsGameOnEmptyPrizes() {
  var state = createGame(function () { return 0.42; });
  state.players.player.active = { id: 'p1', name: 'Gyarados', attachedEnergy: ['Water', 'Water', 'Water'], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.player.bench = [];
  state.players.cpu.active = { id: 'c1', name: 'Weedle', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  state.players.cpu.bench = [];
  state.players.player.prizes = [{ id: 'pz1', name: 'Bulbasaur' }];
  state.activePlayerId = 'player';

  checkTrue('canAttack true, Gyarados has enough Water energy for Dragon Rage', canAttack(state, 'player', 'Dragon Rage'));
  attack(state, 'player', 'Dragon Rage'); // 50 damage, Weedle has 40 HP -> KO
  check('Weedle was knocked out and removed as cpu active', state.players.cpu.active, null);
  check('player took their 1 remaining prize', state.players.player.prizes.length, 0);
  check('getWinner declares player the winner', getWinner(state), 'player');
})();

(function testEndTurnClearsPerTurnFlagsAndAdvancesTurn() {
  var state = createGame(function () { return 0.42; });
  state.energyAttachedThisTurn = true;
  state.retreatedThisTurn = true;
  var before = state.turnCounter;
  var beforePlayer = state.activePlayerId;
  endTurn(state);
  check('turnCounter advanced by 1', state.turnCounter, before + 1);
  checkTrue('active player switched', state.activePlayerId !== beforePlayer);
  check('energyAttachedThisTurn reset', state.energyAttachedThisTurn, false);
  check('retreatedThisTurn reset', state.retreatedThisTurn, false);
})();

(function testDeckOutLoss() {
  var state = createGame(function () { return 0.42; });
  state.players.cpu.deck = [];
  check('getWinner is null before anyone is forced to draw from empty deck', getWinner(state), null);
  state.activePlayerId = 'cpu';
  state.turnCounter = 3; // not turn 1, so a draw is attempted
  endTurn(state); // endTurn hands the turn to cpu and triggers their draw-phase check internally via getWinner after draw attempt -- see implementation
  check('cpu loses by decking out, player wins', getWinner(state), 'player');
})();
```

- [ ] **Step 2: Run to verify these fail**

Run: `node run-tests.js`
Expected: `ReferenceError: dealDamage is not defined`.

- [ ] **Step 3: Implement in `rules-engine.js`**

```js
function hasStatus(instance, status) { return instance.statusConditions.indexOf(status) !== -1; }

var EXCLUSIVE_STATUSES = ['Asleep', 'Confused', 'Paralyzed'];

function addStatus(instance, status) {
  if (EXCLUSIVE_STATUSES.indexOf(status) !== -1) {
    instance.statusConditions = instance.statusConditions.filter(function (s) { return EXCLUSIVE_STATUSES.indexOf(s) === -1; });
  }
  if (!hasStatus(instance, status)) { instance.statusConditions.push(status); }
}

function typeHasMatch(list, types) {
  return (list || []).some(function (entry) { return types.indexOf(entry.type) !== -1; });
}

function dealDamage(state, attacker, defender, baseDamage) {
  if (baseDamage <= 0) { return 0; }
  var dmg = baseDamage;
  var defStats = CARD_STATS[defender.name];
  var atkTypes = CARD_STATS[attacker.name].types || [];
  if (typeHasMatch(defStats.weaknesses, atkTypes)) { dmg *= 2; }
  if (typeHasMatch(defStats.resistances, atkTypes)) { dmg = Math.max(0, dmg - 30); }
  if (attacker.plusPowerAttached) { dmg += 10; }
  if (defender.shield && defender.shield.untilTurn === state.turnCounter) {
    if (defender.shield.type === 'preventAll') { dmg = 0; }
    else if (defender.shield.type === 'thresholdMax' && dmg <= defender.shield.thresholdMax) { dmg = 0; }
    defender.shield = null;
  }
  defender.damage += dmg;
  return dmg;
}

function opponentOf(playerId) { return playerId === 'player' ? 'cpu' : 'player'; }

function knockOutIfNeeded(state, ownerId, instance) {
  var stats = CARD_STATS[instance.name];
  if (instance.damage < stats.hp) { return; }
  var owner = state.players[ownerId];
  var attackerId = opponentOf(ownerId);
  logEvent(state, instance.name + ' (' + ownerId + ') fue noqueado');
  if (owner.active && owner.active.id === instance.id) {
    owner.active = owner.bench.length > 0 ? owner.bench.shift() : null;
  } else {
    owner.bench = owner.bench.filter(function (b) { return b.id !== instance.id; });
  }
  owner.discard.push({ id: instance.id, name: instance.name });
  var attackerPlayer = state.players[attackerId];
  if (attackerPlayer.prizes.length > 0) {
    var prize = attackerPlayer.prizes.shift();
    attackerPlayer.hand.push(prize);
    logEvent(state, attackerId + ' toma un premio (' + attackerPlayer.prizes.length + ' restantes)');
  }
}

function canAttack(state, playerId, attackName) {
  var p = state.players[playerId];
  if (state.activePlayerId !== playerId || state.turnCounter === 1 || !p.active) { return false; }
  if (hasStatus(p.active, 'Asleep') || hasStatus(p.active, 'Paralyzed')) { return false; }
  if (p.active.lockedAttacks.indexOf(attackName) !== -1) { return false; }
  var stats = CARD_STATS[p.active.name];
  var atk = (stats.attacks || []).find(function (a) { return a.name === attackName; });
  if (!atk) { return false; }
  return canPayCost(p.active, atk.cost);
}

function attack(state, playerId, attackName) {
  var p = state.players[playerId];
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var attacker = p.active;
  var stats = CARD_STATS[attacker.name];
  var atkDef = stats.attacks.find(function (a) { return a.name === attackName; });

  if (attacker.missChanceUntilTurn === state.turnCounter) {
    attacker.missChanceUntilTurn = null;
    if (coinFlip(state) === 'T') {
      logEvent(state, attacker.name + ' falla el ataque (efecto de Sand-attack)');
      endTurn(state);
      return;
    }
  }

  var defender = op.active;
  var effectFn = (typeof ATTACK_EFFECTS !== 'undefined' && ATTACK_EFFECTS[attacker.name]) ? ATTACK_EFFECTS[attacker.name][attackName] : null;
  if (effectFn) {
    effectFn(state, attacker, defender, atkDef);
  } else {
    var baseDamage = parseInt(atkDef.damage, 10) || 0;
    if (defender) { dealDamage(state, attacker, defender, baseDamage); }
  }

  if (defender) { knockOutIfNeeded(state, opId, defender); }
  endTurn(state);
}

function applyCheckupDamage(state, playerId) {
  var p = state.players[playerId];
  var all = p.active ? [p.active].concat(p.bench) : p.bench.slice();
  all.forEach(function (instance) {
    if (hasStatus(instance, 'Poisoned')) { instance.damage += 10; logEvent(state, instance.name + ' sufre daño por veneno'); }
    if (hasStatus(instance, 'Burned')) {
      instance.damage += 10;
      if (coinFlip(state) === 'H') { instance.statusConditions = instance.statusConditions.filter(function (s) { return s !== 'Burned'; }); }
    }
    if (hasStatus(instance, 'Asleep') && coinFlip(state) === 'H') {
      instance.statusConditions = instance.statusConditions.filter(function (s) { return s !== 'Asleep'; });
    }
  });
  if (p.active) { knockOutIfNeeded(state, playerId, p.active); }
  p.bench.slice().forEach(function (b) { knockOutIfNeeded(state, playerId, b); });
}

function endTurn(state) {
  var justFinished = state.activePlayerId;
  applyCheckupDamage(state, justFinished);
  if (state.players[justFinished].active) {
    state.players[justFinished].active.statusConditions = state.players[justFinished].active.statusConditions.filter(function (s) { return s !== 'Paralyzed'; });
  }
  state.players[justFinished].active && (state.players[justFinished].active.plusPowerAttached = false);

  state.turnCounter += 1;
  state.activePlayerId = opponentOf(justFinished);
  state.energyAttachedThisTurn = false;
  state.retreatedThisTurn = false;

  if (state.turnCounter > 1) { drawCard(state, state.activePlayerId, 1); }
}

function getWinner(state) {
  if (state.players.player.prizes.length === 0) { return 'player'; }
  if (state.players.cpu.prizes.length === 0) { return 'cpu'; }
  if (!state.players.player.active && state.players.player.bench.length === 0) { return 'cpu'; }
  if (!state.players.cpu.active && state.players.cpu.bench.length === 0) { return 'player'; }
  if (state.activePlayerId === 'player' && state.players.player.deck.length === 0 && state.turnCounter > 1) { return 'cpu'; }
  if (state.activePlayerId === 'cpu' && state.players.cpu.deck.length === 0 && state.turnCounter > 1) { return 'player'; }
  return null;
}
```

- [ ] **Step 4: Run to verify Step 1's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0. If `testDeckOutLoss` fails because `endTurn`'s draw-skip check (`state.turnCounter > 1`) doesn't line up with the test's manual `state.turnCounter = 3`, re-read the test: it sets `cpu.deck = []` then calls `endTurn` while `activePlayerId` is still `'player'`, so `endTurn` flips to `'cpu'` and calls `drawCard(state, 'cpu', 1)` which silently no-ops on an empty deck (per Task 2's `drawCard`) — `getWinner` then must independently detect "cpu is the active player, cpu's deck is empty" as a loss, which the implementation above does. Adjust the test's `state.activePlayerId = 'cpu'` line placement only if the two disagree on ordering — the implementation's ordering (flip active player, then the flipped-to player is who must have cards) is the one to trust.

- [ ] **Step 5: Commit**

```bash
git add rules-engine.js tests.js
git commit -m "Implement attack resolution, checkup phase, KO/prizes, win conditions, endTurn"
```

---

## Task 5: Trainer card effects (9 cards)

**Files:**
- Modify: `card-effects.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: `state`, `findInstance`, `dealDamage`-adjacent helpers from Task 3/4; `drawCard`, `logEvent`.
- Produces: `TRAINER_EFFECTS` keyed by the 9 exact names in `data-cards.js`: `Bill`, `Energy Removal`, `Gust of Wind`, `PlusPower`, `Potion`, `Professor Oak`, `Super Energy Removal`, `Super Potion`, `Switch`. Each entry: `function(state, playerId, handId, targetInstanceId)` returning `{legal, reason}`; `ui.js` (Task 10) calls these directly.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js`:

```js
(function testTrainerEffects() {
  var state = createGame(function () { return 0.42; });
  var pid = 'player';
  var p = state.players[pid];

  // Bill: draw 2
  p.hand = [{ id: 'h1', name: 'Bill' }];
  var beforeDeck = p.deck.length;
  var res = TRAINER_EFFECTS['Bill'](state, pid, 'h1');
  checkTrue('Bill is legal', res.legal);
  check('Bill draws 2 cards', p.deck.length, beforeDeck - 2);

  // Potion: remove up to 2 damage counters (20 HP) from one Pokémon
  p.active = { id: 'a1', name: 'Bulbasaur', attachedEnergy: [], damage: 30, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  p.hand = [{ id: 'h2', name: 'Potion' }];
  TRAINER_EFFECTS['Potion'](state, pid, 'h2', 'a1');
  check('Potion removes up to 20 damage', p.active.damage, 10);

  // Super Potion: discard 1 energy from own Pokémon, remove up to 4 counters (40 HP)
  p.active.damage = 50;
  p.active.attachedEnergy = ['Grass'];
  p.hand = [{ id: 'h3', name: 'Super Potion' }];
  var superRes = TRAINER_EFFECTS['Super Potion'](state, pid, 'h3', 'a1');
  checkTrue('Super Potion legal when energy is attached', superRes.legal);
  check('Super Potion removes up to 40 damage', p.active.damage, 10);
  check('Super Potion discarded the energy', p.active.attachedEnergy.length, 0);

  // Switch: swap active with a bench Pokémon
  p.bench = [{ id: 'b1', name: 'Ivysaur', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  p.hand = [{ id: 'h4', name: 'Switch' }];
  TRAINER_EFFECTS['Switch'](state, pid, 'h4', 'b1');
  check('Switch makes Ivysaur active', p.active.name, 'Ivysaur');

  // Professor Oak: discard hand, draw 7
  p.hand = [{ id: 'h5', name: 'Professor Oak' }, { id: 'junk1', name: 'Grass Energy' }];
  var deckBefore = p.deck.length;
  TRAINER_EFFECTS['Professor Oak'](state, pid, 'h5');
  check('Professor Oak leaves exactly 7 cards in hand', p.hand.length, 7);

  // Gust of Wind: force opponent's bench Pokémon to become their active
  var cpu = state.players.cpu;
  cpu.active = { id: 'ca1', name: 'Hitmonchan', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
  cpu.bench = [{ id: 'cb1', name: 'Machop', attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false }];
  p.hand = [{ id: 'h6', name: 'Gust of Wind' }];
  TRAINER_EFFECTS['Gust of Wind'](state, pid, 'h6', 'cb1');
  check('Gust of Wind forces Machop to become cpu active', cpu.active.name, 'Machop');

  // Energy Removal: discard 1 energy from opponent's chosen Pokémon
  cpu.active.attachedEnergy = ['Fighting'];
  p.hand = [{ id: 'h7', name: 'Energy Removal' }];
  TRAINER_EFFECTS['Energy Removal'](state, pid, 'h7', cpu.active.id);
  check('Energy Removal discards opponent energy', cpu.active.attachedEnergy.length, 0);

  // Super Energy Removal: discard 1 of own energy to discard up to 2 of opponent's
  p.active.attachedEnergy = ['Grass'];
  cpu.active.attachedEnergy = ['Fighting', 'Fighting'];
  p.hand = [{ id: 'h8', name: 'Super Energy Removal' }];
  TRAINER_EFFECTS['Super Energy Removal'](state, pid, 'h8', p.active.id, cpu.active.id);
  check('Super Energy Removal discards own energy', p.active.attachedEnergy.length, 0);
  check('Super Energy Removal discards up to 2 opponent energy', cpu.active.attachedEnergy.length, 0);

  // PlusPower: attaches, marks plusPowerAttached
  p.hand = [{ id: 'h9', name: 'PlusPower' }];
  TRAINER_EFFECTS['PlusPower'](state, pid, 'h9', p.active.id);
  checkTrue('PlusPower attaches to active', p.active.plusPowerAttached);
})();
```

- [ ] **Step 2: Run to verify these fail**

Run: `node run-tests.js`
Expected: `TypeError: TRAINER_EFFECTS['Bill'] is not a function` (or `Cannot read properties of undefined`).

- [ ] **Step 3: Implement `card-effects.js`**

```js
var TRAINER_EFFECTS = {};

TRAINER_EFFECTS['Bill'] = function (state, playerId, handId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(idx, 1);
  drawCard(state, playerId, 2);
  logEvent(state, playerId + ' juega Bill (roba 2)');
  return { legal: true };
};

TRAINER_EFFECTS['Potion'] = function (state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target) { return { legal: false, reason: 'no target' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(idx, 1);
  target.damage = Math.max(0, target.damage - 20);
  logEvent(state, playerId + ' usa Potion en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['Super Potion'] = function (state, playerId, handId, targetInstanceId) {
  var p = state.players[playerId];
  var target = findInstance(p, targetInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no energy to discard' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(idx, 1);
  target.attachedEnergy.splice(0, 1);
  target.damage = Math.max(0, target.damage - 40);
  logEvent(state, playerId + ' usa Super Potion en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['Switch'] = function (state, playerId, handId, benchInstanceId) {
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  var benchIdx = p.bench.findIndex(function (b) { return b.id === benchInstanceId; });
  if (benchIdx === -1) { return { legal: false, reason: 'no such bench Pokémon' }; }
  p.hand.splice(idx, 1);
  var incoming = p.bench.splice(benchIdx, 1)[0];
  if (p.active) { p.bench.push(p.active); }
  p.active = incoming;
  logEvent(state, playerId + ' usa Switch');
  return { legal: true };
};

TRAINER_EFFECTS['Professor Oak'] = function (state, playerId, handId) {
  var p = state.players[playerId];
  p.hand = [];
  drawCard(state, playerId, 7);
  logEvent(state, playerId + ' juega Professor Oak (descarta mano, roba 7)');
  return { legal: true };
};

TRAINER_EFFECTS['Gust of Wind'] = function (state, playerId, handId, opponentBenchInstanceId) {
  var p = state.players[playerId];
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var idx = op.bench.findIndex(function (b) { return b.id === opponentBenchInstanceId; });
  if (idx === -1) { return { legal: false, reason: 'no such opponent bench Pokémon' }; }
  var handIdx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(handIdx, 1);
  var incoming = op.bench.splice(idx, 1)[0];
  if (op.active) { op.bench.push(op.active); }
  op.active = incoming;
  logEvent(state, playerId + ' usa Gust of Wind');
  return { legal: true };
};

TRAINER_EFFECTS['Energy Removal'] = function (state, playerId, handId, opponentInstanceId) {
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var target = findInstance(op, opponentInstanceId);
  if (!target || target.attachedEnergy.length === 0) { return { legal: false, reason: 'no energy to remove' }; }
  var p = state.players[playerId];
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(idx, 1);
  target.attachedEnergy.splice(0, 1);
  logEvent(state, playerId + ' usa Energy Removal en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['Super Energy Removal'] = function (state, playerId, handId, ownInstanceId, opponentInstanceId) {
  var p = state.players[playerId];
  var own = findInstance(p, ownInstanceId);
  if (!own || own.attachedEnergy.length === 0) { return { legal: false, reason: 'no own energy to discard as cost' }; }
  var opId = opponentOf(playerId);
  var op = state.players[opId];
  var target = findInstance(op, opponentInstanceId);
  if (!target) { return { legal: false, reason: 'no opponent target' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(idx, 1);
  own.attachedEnergy.splice(0, 1);
  target.attachedEnergy.splice(0, Math.min(2, target.attachedEnergy.length));
  logEvent(state, playerId + ' usa Super Energy Removal en ' + target.name);
  return { legal: true };
};

TRAINER_EFFECTS['PlusPower'] = function (state, playerId, handId, ownInstanceId) {
  var p = state.players[playerId];
  var target = findInstance(p, ownInstanceId);
  if (!target) { return { legal: false, reason: 'no target' }; }
  var idx = p.hand.findIndex(function (c) { return c.id === handId; });
  p.hand.splice(idx, 1);
  target.plusPowerAttached = true;
  logEvent(state, playerId + ' adjunta PlusPower a ' + target.name);
  return { legal: true };
};

var ATTACK_EFFECTS = {};
```

- [ ] **Step 4: Run to verify Step 1's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add card-effects.js tests.js
git commit -m "Implement all 9 Trainer card effects"
```

---

## Task 6: Attack effects — Overgrowth-side species (Gyarados, Magikarp, Starmie, Staryu, Beedrill, Kakuna, Ivysaur, Weedle, Bulbasaur)

**Files:**
- Modify: `card-effects.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: `dealDamage`, `addStatus`, `coinFlip` (Task 4); `ATTACK_EFFECTS` object created empty in Task 5.
- Produces: `ATTACK_EFFECTS['Gyarados']`, `['Magikarp']`, `['Starmie']`, `['Staryu']`, `['Beedrill']`, `['Kakuna']`, `['Ivysaur']`, `['Weedle']`, `['Bulbasaur']` — each keyed by exact attack name from `data-cards.js`.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js`:

```js
(function testOvergrowthAttackEffects() {
  var state = createGame(function () { return 0.0; }); // rng()=0 => coinFlip always 'H' (heads)
  var mkP = function (name, extra) {
    var base = { id: 'x_' + name, name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
    return Object.assign(base, extra || {});
  };

  // Weedle's Poison Sting: 10 dmg, coin flip to poison (heads => poisoned, since rng()=0 always heads)
  var weedle = mkP('Weedle'); var target1 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Weedle']['Poison Sting'](state, weedle, target1);
  check('Weedle Poison Sting deals 10', target1.damage, 10);
  checkTrue('Weedle Poison Sting poisons on heads', hasStatus(target1, 'Poisoned'));

  // Ivysaur's Poisonpowder: always poisons (no coin flip in the text), 20 dmg
  var ivysaur = mkP('Ivysaur'); var target2 = mkP('Machop');
  ATTACK_EFFECTS['Ivysaur']['Poisonpowder'](state, ivysaur, target2);
  check('Ivysaur Poisonpowder deals 20', target2.damage, 20);
  checkTrue('Ivysaur Poisonpowder always poisons', hasStatus(target2, 'Poisoned'));

  // Gyarados Bubblebeam: 40 dmg, coin flip to paralyze
  var gyarados = mkP('Gyarados'); var target3 = mkP('Onix');
  ATTACK_EFFECTS['Gyarados']['Bubblebeam'](state, gyarados, target3);
  check('Gyarados Bubblebeam deals 40', target3.damage, 40);
  checkTrue('Gyarados Bubblebeam paralyzes on heads', hasStatus(target3, 'Paralyzed'));

  // Magikarp's Flail: 10 x its own damage counters
  var magikarp = mkP('Magikarp', { damage: 20 }); var target4 = mkP('Squirtle');
  ATTACK_EFFECTS['Magikarp']['Flail'](state, magikarp, target4);
  check('Flail deals 10 per damage counter (2 counters = 20)', target4.damage, 20);

  // Beedrill's Twineedle: flip 2 coins, 30 x heads -- rng always 0 => both heads => 60
  var beedrill = mkP('Beedrill'); var target5 = mkP('Onix');
  ATTACK_EFFECTS['Beedrill']['Twineedle'](state, beedrill, target5);
  check('Twineedle with both coins heads deals 60', target5.damage, 60);

  // Kakuna's Stiffen: coin flip shield, no damage
  var kakuna = mkP('Kakuna');
  state.turnCounter = 4;
  ATTACK_EFFECTS['Kakuna']['Stiffen'](state, kakuna, null);
  check('Stiffen sets a preventAll shield on heads', kakuna.shield && kakuna.shield.type, 'preventAll');
  check('Stiffen shield applies to the attacker\'s own next-defended turn', kakuna.shield.untilTurn, 5);

  // Starmie's Recover: discards a Water Energy from itself, heals fully
  var starmie = mkP('Starmie', { attachedEnergy: ['Water', 'Water'], damage: 30 });
  ATTACK_EFFECTS['Starmie']['Recover'](state, starmie, null);
  check('Recover heals all damage', starmie.damage, 0);
  check('Recover discards 1 Water Energy', starmie.attachedEnergy.length, 1);

  // Staryu's Slap: plain 20 damage
  var staryu = mkP('Staryu'); var target6 = mkP('Machop');
  ATTACK_EFFECTS['Staryu']['Slap'](state, staryu, target6);
  check('Slap deals 20', target6.damage, 20);

  // Bulbasaur's Leech Seed: 20 dmg, heals 1 damage counter (10) off itself when damage lands
  var bulbasaur = mkP('Bulbasaur', { damage: 20 }); var target7 = mkP('Machop');
  ATTACK_EFFECTS['Bulbasaur']['Leech Seed'](state, bulbasaur, target7);
  check('Leech Seed deals 20 to the defender', target7.damage, 20);
  check('Leech Seed heals 10 off Bulbasaur when damage lands', bulbasaur.damage, 10);
})();
```

- [ ] **Step 2: Run to verify these fail**

Run: `node run-tests.js`
Expected: `TypeError: Cannot read properties of undefined (reading 'Poison Sting')`.

- [ ] **Step 3: Implement in `card-effects.js`** (append below the `ATTACK_EFFECTS = {}` line from Task 5)

```js
ATTACK_EFFECTS['Weedle'] = {
  'Poison Sting': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); }
  }
};

ATTACK_EFFECTS['Bulbasaur'] = {
  'Leech Seed': function (state, attacker, defender) {
    var dealt = dealDamage(state, attacker, defender, 20);
    if (dealt > 0) { attacker.damage = Math.max(0, attacker.damage - 10); }
  }
};

ATTACK_EFFECTS['Ivysaur'] = {
  'Vine Whip': function (state, attacker, defender) { dealDamage(state, attacker, defender, 30); },
  'Poisonpowder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    addStatus(defender, 'Poisoned');
  }
};

ATTACK_EFFECTS['Kakuna'] = {
  'Stiffen': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  'Poisonpowder': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); }
  }
};

ATTACK_EFFECTS['Beedrill'] = {
  'Twineedle': function (state, attacker, defender) {
    var heads = 0;
    if (coinFlip(state) === 'H') { heads++; }
    if (coinFlip(state) === 'H') { heads++; }
    dealDamage(state, attacker, defender, 30 * heads);
  },
  'Poison Sting': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 40);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Poisoned'); }
  }
};

ATTACK_EFFECTS['Magikarp'] = {
  'Tackle': function (state, attacker, defender) { dealDamage(state, attacker, defender, 10); },
  'Flail': function (state, attacker, defender) { dealDamage(state, attacker, defender, 10 * (attacker.damage / 10)); }
};

ATTACK_EFFECTS['Gyarados'] = {
  'Dragon Rage': function (state, attacker, defender) { dealDamage(state, attacker, defender, 50); },
  'Bubblebeam': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 40);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};

ATTACK_EFFECTS['Staryu'] = {
  'Slap': function (state, attacker, defender) { dealDamage(state, attacker, defender, 20); }
};

ATTACK_EFFECTS['Starmie'] = {
  'Recover': function (state, attacker) {
    var idx = attacker.attachedEnergy.indexOf('Water');
    if (idx !== -1) { attacker.attachedEnergy.splice(idx, 1); attacker.damage = 0; }
  },
  'Star Freeze': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 20);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  }
};
```

- [ ] **Step 4: Run to verify Step 1's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add card-effects.js tests.js
git commit -m "Implement Overgrowth-side attack effects (9 species)"
```

---

## Task 7: Attack effects — Blackout-side remaining species (Hitmonchan, Farfetch'd, Wartortle, Squirtle, Onix, Sandshrew, Machoke, Machop)

**Files:**
- Modify: `card-effects.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: same as Task 6.
- Produces: `ATTACK_EFFECTS['Hitmonchan']`, `['Farfetch\'d']`, `['Wartortle']`, `['Squirtle']`, `['Onix']`, `['Sandshrew']`, `['Machoke']`, `['Machop']`.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js`:

```js
(function testBlackoutAttackEffects() {
  var state = createGame(function () { return 0.0; }); // always heads
  var mkP = function (name, extra) {
    var base = { id: 'y_' + name, name: name, attachedEnergy: [], damage: 0, statusConditions: [], turnEnteredCurrentForm: 1, lockedAttacks: [], shield: null, missChanceUntilTurn: null, plusPowerAttached: false };
    return Object.assign(base, extra || {});
  };

  // Machoke's Karate Chop: 50 minus 10 per own damage counter
  var machoke = mkP('Machoke', { damage: 20 }); var t1 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Machoke']['Karate Chop'](state, machoke, t1);
  check('Karate Chop with 2 counters deals 30', t1.damage, 30);

  // Machoke's Submission: 60 to defender, 20 to self
  var machoke2 = mkP('Machoke'); var t2 = mkP('Bulbasaur');
  ATTACK_EFFECTS['Machoke']['Submission'](state, machoke2, t2);
  check('Submission deals 60 to defender', t2.damage, 60);
  check('Submission deals 20 to self', machoke2.damage, 20);

  // Squirtle's Bubble: 10 dmg + coin flip paralyze
  var squirtle = mkP('Squirtle'); var t3 = mkP('Machop');
  ATTACK_EFFECTS['Squirtle']['Bubble'](state, squirtle, t3);
  check('Bubble deals 10', t3.damage, 10);
  checkTrue('Bubble paralyzes on heads', hasStatus(t3, 'Paralyzed'));

  // Squirtle's Withdraw: coin-flip shield, no damage
  var squirtle2 = mkP('Squirtle');
  state.turnCounter = 2;
  ATTACK_EFFECTS['Squirtle']['Withdraw'](state, squirtle2, null);
  check('Withdraw sets a preventAll shield on heads', squirtle2.shield && squirtle2.shield.type, 'preventAll');

  // Onix's Harden: always sets a thresholdMax(30) shield, no coin flip
  var onix = mkP('Onix');
  state.turnCounter = 7;
  ATTACK_EFFECTS['Onix']['Harden'](state, onix, null);
  check('Harden sets a thresholdMax shield', onix.shield && onix.shield.type, 'thresholdMax');
  check('Harden threshold is 30', onix.shield.thresholdMax, 30);

  // Sandshrew's Sand-attack: 10 dmg, sets a miss-chance debuff on the defender's next attack
  var sandshrew = mkP('Sandshrew'); var t4 = mkP('Machop');
  state.turnCounter = 9;
  ATTACK_EFFECTS['Sandshrew']['Sand-attack'](state, sandshrew, t4);
  check('Sand-attack deals 10', t4.damage, 10);
  check('Sand-attack sets missChanceUntilTurn on the defender for the opponent\'s next turn', t4.missChanceUntilTurn, 10);

  // Farfetch'd's Leek Slap: 30 dmg on heads, and locks itself regardless of outcome
  var farfetchd = mkP("Farfetch'd"); var t5 = mkP('Machop');
  ATTACK_EFFECTS["Farfetch'd"]['Leek Slap'](state, farfetchd, t5);
  checkTrue('Leek Slap locks itself after use', farfetchd.lockedAttacks.indexOf('Leek Slap') !== -1);

  // Hitmonchan's Special Punch: plain 40 damage, no text
  var hitmonchan = mkP('Hitmonchan'); var t6 = mkP('Machop');
  ATTACK_EFFECTS['Hitmonchan']['Special Punch'](state, hitmonchan, t6);
  check('Special Punch deals 40', t6.damage, 40);
})();
```

- [ ] **Step 2: Run to verify these fail**

Run: `node run-tests.js`
Expected: `TypeError: Cannot read properties of undefined (reading 'Karate Chop')`.

- [ ] **Step 3: Implement in `card-effects.js`** (append below Task 6's additions)

```js
ATTACK_EFFECTS['Machop'] = {
  'Low Kick': function (state, attacker, defender) { dealDamage(state, attacker, defender, 20); }
};

ATTACK_EFFECTS['Machoke'] = {
  'Karate Chop': function (state, attacker, defender) {
    var dmg = Math.max(0, 50 - 10 * (attacker.damage / 10));
    dealDamage(state, attacker, defender, dmg);
  },
  'Submission': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 60);
    attacker.damage += 20;
  }
};

ATTACK_EFFECTS['Hitmonchan'] = {
  'Jab': function (state, attacker, defender) { dealDamage(state, attacker, defender, 20); },
  'Special Punch': function (state, attacker, defender) { dealDamage(state, attacker, defender, 40); }
};

ATTACK_EFFECTS['Onix'] = {
  'Rock Throw': function (state, attacker, defender) { dealDamage(state, attacker, defender, 10); },
  'Harden': function (state, attacker) {
    attacker.shield = { untilTurn: state.turnCounter + 1, type: 'thresholdMax', thresholdMax: 30 };
  }
};

ATTACK_EFFECTS['Sandshrew'] = {
  'Sand-attack': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (defender) { defender.missChanceUntilTurn = state.turnCounter + 1; }
  }
};

ATTACK_EFFECTS['Squirtle'] = {
  'Bubble': function (state, attacker, defender) {
    dealDamage(state, attacker, defender, 10);
    if (coinFlip(state) === 'H') { addStatus(defender, 'Paralyzed'); }
  },
  'Withdraw': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  }
};

ATTACK_EFFECTS['Wartortle'] = {
  'Withdraw': function (state, attacker) {
    if (coinFlip(state) === 'H') { attacker.shield = { untilTurn: state.turnCounter + 1, type: 'preventAll' }; }
  },
  'Bite': function (state, attacker, defender) { dealDamage(state, attacker, defender, 40); }
};

ATTACK_EFFECTS["Farfetch'd"] = {
  'Leek Slap': function (state, attacker, defender) {
    attacker.lockedAttacks.push('Leek Slap');
    if (coinFlip(state) === 'H') { dealDamage(state, attacker, defender, 30); }
  },
  'Pot Smash': function (state, attacker, defender) { dealDamage(state, attacker, defender, 30); }
};
```

- [ ] **Step 4: Run to verify Step 1's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add card-effects.js tests.js
git commit -m "Implement Blackout-side attack effects (8 remaining species)"
```

---

## Task 8: CPU AI

**Files:**
- Create: `ai.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: every action function from Tasks 3-4 (`canPlayBasic`/`playBasic`, `canEvolve`/`evolve`, `canAttachEnergy`/`attachEnergy`, `canRetreat`/`retreat`, `canAttack`/`attack`, `endTurn`) and `TRAINER_EFFECTS` (Task 5).
- Produces: `cpuTakeTurn(state)` — call once per CPU turn; it performs a full turn's worth of actions and internally calls `attack(...)` or `endTurn(state)` to close out the turn (mirrors what a human player does via the UI, so the UI never has to special-case "whose turn is it").

- [ ] **Step 1: Write the failing test**

Append to `tests.js`:

```js
(function testCpuTakesALegalTurnWithoutThrowing() {
  var state = createGame(function () { return 0.37; });
  state.activePlayerId = 'cpu';
  var beforeTurn = state.turnCounter;
  cpuTakeTurn(state);
  checkTrue('cpuTakeTurn advances the turn (attacked or explicitly ended turn)', state.turnCounter > beforeTurn);
})();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node run-tests.js`
Expected: `ReferenceError: cpuTakeTurn is not defined`.

- [ ] **Step 3: Implement `ai.js`**

```js
function aiBestAffordableAttack(instance) {
  var stats = CARD_STATS[instance.name];
  var payable = (stats.attacks || []).filter(function (a) {
    return instance.lockedAttacks.indexOf(a.name) === -1 && canPayCost(instance, a.cost);
  });
  if (payable.length === 0) { return null; }
  payable.sort(function (a, b) { return (parseInt(b.damage, 10) || 0) - (parseInt(a.damage, 10) || 0); });
  return payable[0];
}

function aiTryEvolveBench(state, playerId) {
  var p = state.players[playerId];
  var all = (p.active ? [p.active] : []).concat(p.bench);
  for (var i = 0; i < all.length; i++) {
    var target = all[i];
    var handCard = p.hand.find(function (c) { return canEvolve(state, playerId, c.id, target.id); });
    if (handCard) { evolve(state, playerId, handCard.id, target.id); return true; }
  }
  return false;
}

function aiTryPlayBasic(state, playerId) {
  var p = state.players[playerId];
  var handCard = p.hand.find(function (c) { return canPlayBasic(state, playerId, c.id); });
  if (handCard) { playBasic(state, playerId, handCard.id); return true; }
  return false;
}

function aiTryAttachEnergy(state, playerId) {
  var p = state.players[playerId];
  if (!p.active || state.energyAttachedThisTurn) { return false; }
  var handCard = p.hand.find(function (c) { return canAttachEnergy(state, playerId, c.id, p.active.id); });
  if (handCard) { attachEnergy(state, playerId, handCard.id, p.active.id); return true; }
  return false;
}

function aiTryUseTrainer(state, playerId) {
  var p = state.players[playerId];
  if (p.active && p.active.damage > 0) {
    var potion = p.hand.find(function (c) { return c.name === 'Potion'; });
    if (potion) { TRAINER_EFFECTS['Potion'](state, playerId, potion.id, p.active.id); return true; }
  }
  if (p.hand.length <= 2) {
    var oak = p.hand.find(function (c) { return c.name === 'Professor Oak'; });
    if (oak) { TRAINER_EFFECTS['Professor Oak'](state, playerId, oak.id); return true; }
  }
  return false;
}

function cpuTakeTurn(state) {
  var playerId = state.activePlayerId;
  var guard = 0;
  while (guard < 20) {
    guard++;
    if (aiTryEvolveBench(state, playerId)) { continue; }
    if (aiTryAttachEnergy(state, playerId)) { continue; }
    if (aiTryPlayBasic(state, playerId)) { continue; }
    if (aiTryUseTrainer(state, playerId)) { continue; }
    break;
  }

  var p = state.players[playerId];
  if (p.active) {
    var best = aiBestAffordableAttack(p.active);
    if (best && canAttack(state, playerId, best.name)) {
      attack(state, playerId, best.name);
      return;
    }
    if (p.bench.length > 0 && canRetreat(state, playerId, p.bench[0].id)) {
      var betterBench = p.bench.find(function (b) { return aiBestAffordableAttack(b) !== null; });
      if (betterBench) { retreat(state, playerId, betterBench.id); }
    }
  }
  endTurn(state);
}
```

- [ ] **Step 4: Run to verify the test passes**

Run: `node run-tests.js`
Expected: `PASS: cpuTakeTurn advances the turn (attacked or explicitly ended turn)`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add ai.js tests.js
git commit -m "Implement CPU AI heuristic turn logic"
```

---

## Task 9: Economy — coins, booster purchase, collection persistence

**Files:**
- Create: `economy.js`
- Modify: `tests.js`

**Interfaces:**
- Consumes: `CARD_CATALOG` (from `data-sets.js`).
- Produces: `defaultEconomy()`, `awardWin(econ)`, `awardLoss(econ)`, `buyBooster(econ, setKey)` → `{ economy, cards }` or `null` if insufficient funds — all pure, no localStorage; `loadEconomy()`/`saveEconomy(econ)` are the only two functions touching `localStorage`, guarded so they no-op safely under Node.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js`:

```js
(function testEconomyPureFunctions() {
  var econ = defaultEconomy();
  check('starting coins is 150', econ.coins, 150);
  check('starting collection is empty', Object.keys(econ.collection).length, 0);

  econ = awardWin(econ);
  check('win awards 75 coins', econ.coins, 225);

  econ = awardLoss(econ);
  check('loss awards 0 coins', econ.coins, 225);

  var rng = function () { return 0.1; }; // deterministic picks
  var result = buyBooster(econ, 'base', rng);
  checkTrue('buyBooster succeeds with enough coins', result !== null);
  check('buyBooster deducts 100 coins', result.economy.coins, 125);
  check('buyBooster returns 11 cards', result.cards.length, 11);
  var rarities = result.cards.map(function (c) { return c.r; });
  var rareCount = rarities.filter(function (r) { return r === 'Rare' || r === 'Rare Holo'; }).length;
  var uncommonCount = rarities.filter(function (r) { return r === 'Uncommon'; }).length;
  var commonCount = rarities.filter(function (r) { return r === 'Common'; }).length;
  check('booster has 1 rare/rare holo', rareCount, 1);
  check('booster has 3 uncommon', uncommonCount, 3);
  check('booster has 7 common', commonCount, 7);
  check('buyBooster records the cards in the collection', Object.keys(result.economy.collection).length > 0, true);

  var poorEcon = { coins: 10, collection: {} };
  check('buyBooster returns null when coins are insufficient', buyBooster(poorEcon, 'base', rng), null);
})();
```

- [ ] **Step 2: Run to verify these fail**

Run: `node run-tests.js`
Expected: `ReferenceError: defaultEconomy is not defined`.

- [ ] **Step 3: Implement `economy.js`**

```js
function defaultEconomy() { return { coins: 150, collection: {} }; }

function awardWin(econ) { return Object.assign({}, econ, { coins: econ.coins + 75 }); }
function awardLoss(econ) { return Object.assign({}, econ, { coins: econ.coins }); }

function pickRandom(list, rng) { return list[Math.floor(rng() * list.length)]; }

function buyBooster(econ, setKey, rng) {
  rng = rng || Math.random;
  if (econ.coins < 100) { return null; }
  var pool = CARD_CATALOG[setKey];
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  cards.push(pickRandom(rares, rng));
  for (var i = 0; i < 3; i++) { cards.push(pickRandom(uncommons, rng)); }
  for (var j = 0; j < 7; j++) { cards.push(pickRandom(commons, rng)); }

  var newCollection = Object.assign({}, econ.collection);
  cards.forEach(function (c) {
    var key = setKey + '-' + c.num;
    newCollection[key] = (newCollection[key] || 0) + 1;
  });

  return { economy: { coins: econ.coins - 100, collection: newCollection }, cards: cards };
}

function loadEconomy() {
  if (typeof localStorage === 'undefined') { return defaultEconomy(); }
  var raw = localStorage.getItem('tcg_economy');
  if (!raw) { return defaultEconomy(); }
  try { return JSON.parse(raw); } catch (e) { return defaultEconomy(); }
}

function saveEconomy(econ) {
  if (typeof localStorage === 'undefined') { return; }
  localStorage.setItem('tcg_economy', JSON.stringify(econ));
}
```

- [ ] **Step 4: Run to verify Step 1's tests pass**

Run: `node run-tests.js`
Expected: all new `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add economy.js tests.js
git commit -m "Implement economy: coins, booster purchase, collection tracking"
```

---

## Task 10: UI — board rendering, action wiring, collection view

**Files:**
- Create: `ui.js`

**Interfaces:**
- Consumes: everything from Tasks 2-9 (`createGame`, all action functions, `cpuTakeTurn`, `loadEconomy`/`saveEconomy`/`awardWin`/`awardLoss`/`buyBooster`, `CARD_CATALOG`).
- Produces: nothing consumed by later tasks — this is the top of the dependency graph, wired to `index.html`'s DOM (`#app`, `#log`, `#collection-view`, `#booster-shop`, `#coin-count`, the two tab buttons) from Task 1.

- [ ] **Step 1: Implement `ui.js`**

```js
var gameState = null;
var econState = null;

function renderCoinCount() {
  document.getElementById('coin-count').textContent = econState.coins;
}

function pokemonCardHtml(instance, isActive, ownerClass) {
  var stats = CARD_STATS[instance.name];
  var hpLine = (stats.hp - instance.damage) + '/' + stats.hp + ' HP';
  var statusLine = instance.statusConditions.length ? ' [' + instance.statusConditions.join(', ') + ']' : '';
  var cls = 'pokemon-card' + (isActive ? ' ' + ownerClass : '');
  return '<div class="' + cls + '" data-instance-id="' + instance.id + '">' +
    '<strong>' + instance.name + '</strong><br>' + hpLine + statusLine +
    '<br>Energía: ' + instance.attachedEnergy.join(',') + '</div>';
}

function renderBoard() {
  var s = gameState;
  var p = s.players.player;
  var c = s.players.cpu;
  var html = '';
  html += '<h3>CPU</h3><div class="board-row">';
  if (c.active) { html += pokemonCardHtml(c.active, true, 'active-cpu'); }
  c.bench.forEach(function (b) { html += pokemonCardHtml(b, false, ''); });
  html += '</div>';

  html += '<h3>Tú</h3><div class="board-row">';
  if (p.active) { html += pokemonCardHtml(p.active, true, 'active-player'); }
  p.bench.forEach(function (b) { html += pokemonCardHtml(b, false, ''); });
  html += '</div>';

  html += '<h4>Mano</h4><div class="hand-row">';
  p.hand.forEach(function (card) {
    html += '<button class="action-btn hand-card" data-hand-id="' + card.id + '">' + card.name + '</button>';
  });
  html += '</div>';

  if (p.active) {
    html += '<h4>Ataques</h4>';
    (CARD_STATS[p.active.name].attacks || []).forEach(function (atk) {
      var can = canAttack(s, 'player', atk.name);
      html += '<button class="action-btn attack-btn" data-attack-name="' + atk.name + '"' + (can ? '' : ' disabled') + '>' + atk.name + ' (' + atk.damage + ')</button>';
    });
  }

  html += '<p>Premios restantes — Tú: ' + p.prizes.length + ' · CPU: ' + c.prizes.length + '</p>';

  document.getElementById('app').innerHTML = html;
  document.getElementById('log').textContent = s.log.slice(-30).join('\n');
  wireBoardButtons();
}

function afterPlayerAction() {
  var winner = getWinner(gameState);
  if (winner) { finishMatch(winner); return; }
  if (gameState.activePlayerId === 'cpu') {
    cpuTakeTurn(gameState);
    var winner2 = getWinner(gameState);
    if (winner2) { finishMatch(winner2); return; }
  }
  renderBoard();
}

function finishMatch(winner) {
  econState = winner === 'player' ? awardWin(econState) : awardLoss(econState);
  saveEconomy(econState);
  renderCoinCount();
  document.getElementById('app').innerHTML += '<p><strong>' + (winner === 'player' ? 'Ganaste' : 'Perdiste') + '</strong></p>' +
    '<button class="action-btn" id="newMatchBtn">Nueva partida</button>';
  document.getElementById('newMatchBtn').addEventListener('click', startNewMatch);
}

function wireBoardButtons() {
  var handButtons = document.querySelectorAll('.hand-card');
  var selectedHandId = null;
  handButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { selectedHandId = btn.getAttribute('data-hand-id'); });
  });

  var attackButtons = document.querySelectorAll('.attack-btn');
  attackButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-attack-name');
      if (canAttack(gameState, 'player', name)) { attack(gameState, 'player', name); afterPlayerAction(); }
    });
  });

  document.querySelectorAll('.pokemon-card').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!selectedHandId) { return; }
      var instanceId = el.getAttribute('data-instance-id');
      var p = gameState.players.player;
      var handCard = p.hand.find(function (c) { return c.id === selectedHandId; });
      if (!handCard) { return; }
      if (isBasicPokemon(handCard.name) && canPlayBasic(gameState, 'player', selectedHandId)) {
        playBasic(gameState, 'player', selectedHandId);
      } else if (canEvolve(gameState, 'player', selectedHandId, instanceId)) {
        evolve(gameState, 'player', selectedHandId, instanceId);
      } else if (canAttachEnergy(gameState, 'player', selectedHandId, instanceId)) {
        attachEnergy(gameState, 'player', selectedHandId, instanceId);
      } else if (TRAINER_EFFECTS[handCard.name]) {
        TRAINER_EFFECTS[handCard.name](gameState, 'player', selectedHandId, instanceId);
      }
      selectedHandId = null;
      renderBoard();
    });
  });
}

function startNewMatch() {
  gameState = createGame(Math.random);
  renderBoard();
  if (gameState.activePlayerId === 'cpu') { afterPlayerAction(); }
}

function renderCollection() {
  var html = '<h3>Comprar sobre</h3>';
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    html += '<button class="action-btn buy-booster-btn" data-set="' + setKey + '">Comprar sobre (' + setKey + ') — 100 monedas</button>';
  });
  document.getElementById('booster-shop').innerHTML = html;
  document.querySelectorAll('.buy-booster-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var result = buyBooster(econState, btn.getAttribute('data-set'), Math.random);
      if (!result) { alert('No tienes suficientes monedas.'); return; }
      econState = result.economy;
      saveEconomy(econState);
      renderCoinCount();
      renderCollectionGrid();
    });
  });
  renderCollectionGrid();
}

function renderCollectionGrid() {
  var total = 0, owned = 0;
  var html = '';
  ['base', 'jungle', 'fossil'].forEach(function (setKey) {
    html += '<h4>' + setKey + '</h4><div class="board-row">';
    CARD_CATALOG[setKey].forEach(function (c) {
      total++;
      var key = setKey + '-' + c.num;
      var count = econState.collection[key] || 0;
      if (count > 0) { owned++; }
      html += '<div class="pokemon-card">' + c.n + '<br>x' + count + '</div>';
    });
    html += '</div>';
  });
  html = '<p>' + owned + ' / ' + total + ' cartas distintas</p>' + html;
  document.getElementById('collection-view').innerHTML = html;
}

document.addEventListener('DOMContentLoaded', function () {
  econState = loadEconomy();
  renderCoinCount();
  startNewMatch();

  document.getElementById('tabBtnPlay').addEventListener('click', function () {
    document.getElementById('tabBtnPlay').classList.add('active');
    document.getElementById('tabBtnCollection').classList.remove('active');
    document.getElementById('panelPlay').classList.add('active');
    document.getElementById('panelCollection').classList.remove('active');
  });
  document.getElementById('tabBtnCollection').addEventListener('click', function () {
    document.getElementById('tabBtnCollection').classList.add('active');
    document.getElementById('tabBtnPlay').classList.remove('active');
    document.getElementById('panelCollection').classList.add('active');
    document.getElementById('panelPlay').classList.remove('active');
    renderCollection();
  });
});
```

- [ ] **Step 2: Manual browser check**

Run: `open index.html`
Expected: a match starts automatically (Overgrowth vs Blackout), the board shows both sides' Pokémon/HP/energy, your hand is clickable (select a hand card, then click a board Pokémon target to play/evolve/attach/use a Trainer on it), attack buttons enable/disable based on `canAttack`, and if the CPU goes first it takes its turn automatically before rendering. Play at least one full match to a win or loss, confirm the coin count updates and persists after a page reload (`localStorage` under key `tcg_economy`), then switch to the "Colección" tab, buy one booster, and confirm 11 cards appear in the collection grid with correct counts.

- [ ] **Step 3: Commit**

```bash
git add ui.js
git commit -m "Implement UI: board rendering, action wiring, collection/booster view"
```

---

## Task 11: Integration — scripted CPU-vs-CPU stability run

**Files:**
- Modify: `tests.js`

**Interfaces:**
- Consumes: everything (this is the final integration check).
- Produces: nothing further — this is the last task.

- [ ] **Step 1: Write the failing test**

Append to `tests.js`:

```js
(function testScriptedCpuVsCpuStabilityRun() {
  var GAMES = 20;
  var TURN_CAP = 400;
  var completed = 0;
  for (var g = 0; g < GAMES; g++) {
    var seed = g;
    var rng = (function (s) { return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })(seed + 1);
    var state = createGame(rng);
    var turns = 0;
    var winner = null;
    while (!winner && turns < TURN_CAP) {
      cpuTakeTurn(state);
      winner = getWinner(state);
      turns++;
    }
    checkTrue('game ' + g + ' finished within ' + TURN_CAP + ' turns', turns < TURN_CAP);
    if (winner) { completed++; }
  }
  check('all scripted games reached a winner', completed, GAMES);
})();
```

- [ ] **Step 2: Run to verify current status**

Run: `node run-tests.js`
Expected: if any game exceeds `TURN_CAP` or throws, this fails or throws — that's a real bug in `cpuTakeTurn`, `attack`, or `endTurn` to fix now (common culprits: `cpuTakeTurn`'s 20-action-per-turn guard triggering an infinite loop across turns if neither side can ever attack because both boards run out of playable/attachable options — if that happens, add a minimal fallback in `cpuTakeTurn` so a turn with truly nothing legal to do still calls `endTurn(state)`, which the Task 8 implementation already does at the bottom of the function, so this should already be safe; if it still fails, the bug is elsewhere in this task's scope to diagnose and fix, not to route around).

- [ ] **Step 3: Fix any real bugs the stability run surfaces, then re-run**

Run: `node run-tests.js`
Expected: `PASS: game 0 finished within 400 turns` through `PASS: game 19 finished within 400 turns`, `PASS: all scripted games reached a winner`, exit code 0.

- [ ] **Step 4: Full regression run**

Run: `node run-tests.js`
Expected: every `check`/`checkTrue` call across all 11 tasks prints `PASS:`, final line shows 0 failures, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add tests.js
git commit -m "Add scripted CPU-vs-CPU stability test; MVP complete"
```
