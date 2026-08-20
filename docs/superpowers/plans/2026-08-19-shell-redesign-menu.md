# Shell Redesign — Menú Principal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the main menu screen to the 32-bit-console visual design from `design_handoff_shell_juego_cartas/`, on a fixed 1920×1080 canvas that scales to fit the viewport, without touching any other screen or any game logic.

**Architecture:** A new `shell-theme.css` (design tokens + fixed-canvas scaling shell + the menu's component styles) loads after `style.css`. A new DOM-free `shell-layout.js` holds the pure math (scale/position, collection-progress) so it can be unit-tested the same way `rules-engine.js` is. `index.html`'s `#menuScreen` gets new internal markup; `ui.js` gets the wiring (scaling on resize, real data into the new player card / collection subtitle) and loses the now-obsolete drag-to-reposition feature.

**Tech Stack:** Plain HTML/CSS/JS (no build step, matches the rest of the project). Fonts via `@import` in CSS (same pattern `style.css` already uses for Inter/Sora).

**Spec:** `docs/superpowers/specs/2026-08-19-shell-redesign-design.md` (adaptation decisions) plus the canonical visual reference `design_handoff_shell_juego_cartas/README.md` (section "1. Menú principal" and "Design Tokens") and `design_handoff_shell_juego_cartas/Shell del Juego.dc.html` lines 29–114 (exact prototype markup this plan translates into real CSS classes).

## Global Constraints

- No card redesign, no game-logic changes — `node run-tests.js` must stay green after every task.
- Fixed 1920×1080 canvas, scaled with `transform: scale()`, letterboxed — no responsive reflow, no scroll, inside `#menuScreen` only. Every other screen keeps its current fluid CSS untouched.
- "Selección de mazo" is out of scope. The nav list has 4 items (Jugar/Tienda/Mi Colección/Configuración), not 5.
- The existing drag-to-reposition-logo/nav feature (`positionModal`, `configMoveBoth`, `configResetPositions`, and their JS) is removed — approved by the user, obsolete now that layout is pixel-fixed.
- The existing "Configurar Portada" background-image feature is kept, retargeted to the new 1180×1080 key-art box.
- The existing profile widget's click-to-edit behavior (`#menuProfileBtn` opens `#editProfileModal`) is preserved — reuse that id on the new player-card markup, don't rebuild it.
- No fabricated data: no fake level/rank number (no leveling system exists), the collection subtitle uses real owned/total counts.
- Fonts: `Pixelify Sans` (400..700 variable) and `Silkscreen` (400, 700) via Google Fonts, scoped to `.shell-stage` only (not `body`), same `@import` pattern as `style.css` line 1.

---

### Task 1: Pure shell-layout helpers (stage scaling math + collection progress)

**Files:**
- Create: `shell-layout.js`
- Modify: `run-tests.js` (add `'shell-layout.js'` to the `FILES` array)
- Modify: `tests.html` (add `<script src="shell-layout.js"></script>`)
- Test: `tests.js` (append new test blocks)

**Interfaces:**
- Produces: `SHELL_STAGE_WIDTH` (number, `1920`), `SHELL_STAGE_HEIGHT` (number, `1080`), `computeStageTransform(viewportWidth, viewportHeight)` → `{x: number, y: number, scale: number}`, `collectionProgress(collection, cardCatalog)` → `{owned: number, total: number}`.
- Consumes: nothing (pure, no dependency on other files — `cardCatalog` and `collection` are passed in by the caller).

This file is DOM-free on purpose (like `rules-engine.js`) so it can be loaded into the Node `vm` sandbox `run-tests.js` uses — `ui.js` is deliberately excluded from that sandbox (it touches `document` at load time), so any math worth unit-testing has to live outside it.

- [ ] **Step 1: Write the failing tests**

Append to `tests.js` (after the existing IIFEs, before any trailing summary code):

```js
(function testComputeStageTransform() {
  // Width-constrained: viewport narrower (relative to 16:9) than the stage.
  var narrow = computeStageTransform(960, 1080);
  check('computeStageTransform(960,1080) scale', narrow.scale, 0.5);
  check('computeStageTransform(960,1080) x', narrow.x, 0);
  check('computeStageTransform(960,1080) y', narrow.y, 270);

  // Height-constrained: viewport wider (relative to 16:9) than the stage.
  var wide = computeStageTransform(3840, 1080);
  check('computeStageTransform(3840,1080) scale', wide.scale, 1);
  check('computeStageTransform(3840,1080) x', wide.x, 960);
  check('computeStageTransform(3840,1080) y', wide.y, 0);

  // Exact fit.
  var exact = computeStageTransform(1920, 1080);
  check('computeStageTransform(1920,1080) scale', exact.scale, 1);
  check('computeStageTransform(1920,1080) x', exact.x, 0);
  check('computeStageTransform(1920,1080) y', exact.y, 0);
})();

(function testCollectionProgress() {
  var fakeCatalog = { base: [{}, {}, {}], jungle: [{}, {}] };
  var progress = collectionProgress({ 'base-1': 2, 'base-2': 1 }, fakeCatalog);
  check('collectionProgress owned counts distinct keys', progress.owned, 2);
  check('collectionProgress total sums every set', progress.total, 5);

  var empty = collectionProgress({}, fakeCatalog);
  check('collectionProgress owned is 0 for an empty collection', empty.owned, 0);

  var real = collectionProgress({}, CARD_CATALOG);
  check('collectionProgress total matches the real catalog (base+jungle+fossil)', real.total, 228);
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node run-tests.js`
Expected: a `ReferenceError` (or similar) because `computeStageTransform`/`collectionProgress` don't exist yet, OR a require error if `shell-layout.js` isn't in `FILES` yet — add the file (empty) and the `FILES` entry first if needed so the failure is specifically about the missing functions, not the missing file.

- [ ] **Step 3: Create `shell-layout.js` and wire it into both test runners**

`shell-layout.js` (new file, full contents):

```js
// shell-layout.js -- DOM-free math for the shell redesign. Loaded into the
// Node vm sandbox by run-tests.js (unlike ui.js, which touches `document` at
// load time and can't be), and as a real <script> before ui.js everywhere else.

var SHELL_STAGE_WIDTH = 1920;
var SHELL_STAGE_HEIGHT = 1080;

function computeStageTransform(viewportWidth, viewportHeight) {
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
```

In `run-tests.js`, change the `FILES` array from:

```js
const FILES = [
  'data-sets.js', 'data-decks.js', 'data-cards.js',
  'rules-engine.js', 'card-effects.js', 'ai.js', 'economy.js',
  'tests.js'
];
```

to:

```js
const FILES = [
  'data-sets.js', 'data-decks.js', 'data-cards.js',
  'rules-engine.js', 'card-effects.js', 'ai.js', 'economy.js',
  'shell-layout.js',
  'tests.js'
];
```

In `tests.html`, add the script tag after `economy.js` and before `tests.js`:

```html
<script src="economy.js"></script>
<script src="shell-layout.js"></script>
<script src="tests.js"></script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node run-tests.js`
Expected: every `PASS:` line prints, including the new `computeStageTransform`/`collectionProgress` assertions, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add shell-layout.js run-tests.js tests.html tests.js
git commit -m "Add DOM-free shell-layout helpers (stage scaling math, collection progress)"
```

---

### Task 2: Remove the obsolete drag-to-reposition feature

**Files:**
- Modify: `index.html` (remove the `#positionModal` block and the `configMoveBoth`/`configResetPositions` buttons)
- Modify: `ui.js` (remove `applyMenuPositions`, `MENU_LOGO_DEFAULT`, `MENU_NAV_DEFAULT`, `makeDraggable`, `openPositionModal`, `getUntransformedRect`, `closePositionModal`, `savePositionFromModal`, and their event-listener wiring; remove the `applyMenuPositions()`/`applyMenuLogo()` calls tied to the position system — **keep** `applyMenuLogo()` itself and its own call, that one only shows/hides the logo and is unrelated)
- Modify: `style.css` (remove the now-dead CSS for the position modal)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only deletes code. `applyMenuLogo()` stays available for Task 3/4 to keep using (it toggles `.menu-header` display, which Task 3 replaces with the new markup — Task 3 will point it at the new logo element instead).

This is approved, user-facing functionality removal (confirmed with the user): the new menu's layout is pixel-fixed per the hifi handoff, so free dragging no longer applies. The "Configurar Portada" (background image picker) feature is untouched here — it's handled in Task 3.

- [ ] **Step 1: Remove the position-modal markup from `index.html`**

Delete this whole block (currently right after `#configModal`'s closing `</div>`, before `#boosterSelectModal`):

```html
  <div id="positionModal" class="card-modal hidden">
    <div class="card-modal-backdrop"></div>
    <div class="card-modal-content position-modal-content">
      <h3 class="config-title">Posicionar Logo y Opciones</h3>
      <p class="config-desc">Arrastrá el logo y las opciones a donde quieras</p>
      <div class="position-preview" id="positionPreview">
        <div class="pos-logo" id="posDragLogo">POKÉMON TCG</div>
        <div class="pos-nav" id="posDragNav">
          <div class="pos-nav-btn">⚔️ Jugar</div>
          <div class="pos-nav-btn">🛒 Tienda</div>
          <div class="pos-nav-btn">📚 Colección</div>
          <div class="pos-nav-btn">⚙️ Config</div>
        </div>
      </div>
      <div class="config-actions">
        <button type="button" class="pause-btn" id="posSave">💾 Guardar</button>
        <button type="button" class="pause-btn pause-exit" id="posCancel">← Cancelar</button>
      </div>
    </div>
  </div>
```

In the same file, inside `#configModal`'s "Logo y Menú" section, delete just the position button (keep the "Mostrar logo" toggle and its own div):

```html
          <div class="config-position-btns">
            <button type="button" class="pause-btn config-pos-btn" id="configMoveBoth">🏷️ Mover Logo y Opciones</button>
          </div>
          <button type="button" class="pause-btn" id="configResetPositions">📍 Restaurar posiciones</button>
```

- [ ] **Step 2: Remove the drag-position functions from `ui.js`**

Delete these top-level items entirely: the `MENU_LOGO_DEFAULT`/`MENU_NAV_DEFAULT` var declarations, `applyMenuPositions()`, `makeDraggable()`, `openPositionModal()`, `getUntransformedRect()`, `closePositionModal()`, `savePositionFromModal()`.

In the `DOMContentLoaded` handler, delete the call `applyMenuPositions();` (keep `applyMenuLogo();` right below it) and delete this whole block:

```js
  // Position modal
  document.getElementById('configMoveBoth').addEventListener('click', openPositionModal);
  document.getElementById('posSave').addEventListener('click', savePositionFromModal);
  document.getElementById('posCancel').addEventListener('click', closePositionModal);
  document.querySelector('#positionModal .card-modal-backdrop').addEventListener('click', closePositionModal);

  // Reset positions
  document.getElementById('configResetPositions').addEventListener('click', function () {
    localStorage.removeItem('tcg_menu_pos');
    applyMenuPositions();
  });
```

- [ ] **Step 3: Remove the dead CSS from `style.css`**

Delete these lines (position-modal-only rules):

```css
.drag-hint{font-size:0.72rem;color:var(--ink-muted);font-style:italic;margin:4px 0 8px;}
.config-position-btns{display:flex;gap:8px;margin:8px 0;}
.config-pos-btn{flex:1;text-align:center;font-size:0.8rem;padding:10px 8px !important;}
/* Position modal */
.position-modal-content{width:800px;max-width:95vw;padding:0 !important;overflow:hidden;}
.position-preview{position:relative;width:100%;height:450px;
  background:url('Perfil/Portada_Oficial.jpeg') center/100% auto no-repeat;
  background-color:#0b1120;border-radius:0 0 12px 12px;overflow:hidden;cursor:crosshair;}
.pos-logo{position:absolute;top:20px;left:50%;transform:translateX(-50%);
  font-family:'Sora',sans-serif;font-weight:800;font-size:1rem;letter-spacing:0.15em;
  color:#c9a84c;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:6px;
  border:2px solid rgba(201,168,76,0.4);cursor:grab;user-select:none;z-index:2;
  text-shadow:0 0 10px rgba(201,168,76,0.3);transition:border-color 0.15s;}
.pos-logo:active{cursor:grabbing;border-color:var(--primary);}
.pos-nav{position:absolute;top:100px;left:30px;display:flex;flex-direction:column;gap:6px;
  cursor:grab;user-select:none;z-index:2;}
.pos-nav:active{cursor:grabbing;}
.pos-nav-btn{padding:10px 24px;border:1px solid rgba(201,168,76,0.2);border-radius:8px;
  background:rgba(20,25,40,0.85);backdrop-filter:blur(6px);color:#d4c89a;
  font-family:'Sora',sans-serif;font-weight:600;font-size:0.85rem;
  transition:border-color 0.15s;pointer-events:none;}
.pos-logo.dragging,.pos-nav.dragging{opacity:0.8;}
```

- [ ] **Step 4: Run the regression suite**

Run: `node run-tests.js`
Expected: unchanged, every `PASS:` line prints, exit code 0 (this task touches no game logic).

- [ ] **Step 5: Manual check**

Open the game (`firebase emulators:start`, `http://127.0.0.1:5000`), log in, open Configuración: the "Mover Logo y Opciones" button and "Restaurar posiciones" button are gone; "Mostrar logo" toggle and "Configurar Portada" still work as before (position dragging removed, nothing else regressed).

- [ ] **Step 6: Commit**

```bash
git add index.html ui.js style.css
git commit -m "Remove the obsolete drag-to-reposition-logo/nav feature"
```

---

### Task 3: New menu markup + `shell-theme.css`

**Files:**
- Create: `shell-theme.css`
- Modify: `index.html` (replace `#menuScreen`'s inner markup; add the new stylesheet link)
- Modify: `ui.js` (retarget `applyMenuBackground()` at the new key-art element; retarget `applyMenuLogo()` at the new logo element)

**Interfaces:**
- Consumes: `computeStageTransform` (not called yet — Task 4 wires the resize listener), `SHELL_STAGE_WIDTH`/`SHELL_STAGE_HEIGHT` (not directly needed here, the CSS hardcodes `1920px`/`1080px` to match).
- Produces: the DOM ids Task 4 wires up: `shellStage` (the `.shell-stage` element, for the resize handler), `shellKeyart` (background-image target), `menuProfileBtn`/`menuProfileName`/`menuProfilePhoto` (reused, unchanged ids — already wired by `auth-ui.js` and `ui.js`'s `renderProfile()`), `menuCollectionSub` (new — Task 4 fills in the real progress string), `menuPlay`/`menuShop`/`menuCollection`/`menuConfig`/`menuLogoutBtn` (reused, unchanged ids, already wired).

This is the big visual task. Pull every color/size value from `design_handoff_shell_juego_cartas/README.md` ("1. Menú principal" + "Design Tokens") — the values below are already transcribed from there and from the prototype's markup (`Shell del Juego.dc.html` lines 29–114), translated from inline styles into real CSS classes.

- [ ] **Step 1: Create `shell-theme.css`**

```css
@import url('https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&family=Silkscreen:wght@400;700&display=swap');

/* ===== Fixed-canvas scaling shell ===== */
.shell-viewport{position:absolute;inset:0;overflow:hidden;background:#070706;}
.shell-stage{
  width:1920px;height:1080px;position:absolute;left:0;top:0;overflow:hidden;
  transform-origin:0 0;font-family:'Silkscreen',monospace;color:#efe9dd;
  background:radial-gradient(120% 85% at 50% -10%,#332d24 0%,#191612 52%,#0b0a09 100%);
}
.shell-stage-overlay{
  position:absolute;inset:0;pointer-events:none;
  background:
    repeating-linear-gradient(45deg,rgba(255,255,255,.012) 0 2px,transparent 2px 5px),
    radial-gradient(90% 70% at 50% 45%,transparent 40%,rgba(0,0,0,.55) 100%);
}

/* ===== Menú principal ===== */
.shell-menu{position:absolute;inset:0;}

.shell-keyart{position:absolute;right:0;top:0;width:1180px;height:1080px;background-repeat:no-repeat;}
.shell-keyart-veil{
  position:absolute;right:0;top:0;width:1180px;height:1080px;pointer-events:none;
  background:linear-gradient(90deg,#191612 0%,rgba(25,22,18,.92) 22%,rgba(25,22,18,.35) 52%,rgba(25,22,18,0) 78%);
}
.shell-keyart-halo{
  position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(60% 55% at 74% 52%,rgba(141,255,98,.10) 0%,transparent 70%);
}

.shell-left-col{position:absolute;left:104px;top:96px;width:600px;display:flex;flex-direction:column;gap:34px;}
.shell-brand{display:flex;flex-direction:column;gap:14px;}

.shell-logo-plate{
  width:460px;height:150px;position:relative;padding:10px;
  background:
    repeating-linear-gradient(90deg,rgba(255,255,255,.028) 0 1px,transparent 1px 3px),
    linear-gradient(180deg,#3a342c,#221e19);
  border:1px solid #0b0907;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),inset 0 -2px 0 rgba(0,0,0,.55),0 8px 24px rgba(0,0,0,.6);
  clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);
}
.shell-logo-plate img{width:100%;height:100%;object-fit:contain;display:block;}

.shell-setline{display:flex;align-items:center;gap:12px;}
.shell-setline-rule{width:34px;height:2px;background:#e8c46a;}
.shell-setline-text{font-size:15px;letter-spacing:.28em;color:#e8c46a;}

.shell-tagline{font-family:'Pixelify Sans',sans-serif;font-size:20px;line-height:1.5;color:#a49785;max-width:440px;}

.shell-nav{display:flex;flex-direction:column;gap:12px;width:560px;}
.shell-nav-item{
  position:relative;height:82px;width:100%;display:flex;align-items:center;gap:20px;
  padding:0 22px 0 18px;cursor:pointer;text-align:left;border:1px solid #0b0907;
  background:
    repeating-linear-gradient(90deg,rgba(255,255,255,.03) 0 1px,transparent 1px 3px),
    linear-gradient(180deg,#3d372e,#231f1a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -2px 0 rgba(0,0,0,.55),0 4px 0 #110f0c,0 8px 16px rgba(0,0,0,.45);
  clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);
  transition:transform .12s,filter .12s;
  font-family:'Silkscreen',monospace;
}
.shell-nav-item:hover{transform:translateX(10px);filter:brightness(1.28) saturate(1.1);}
.shell-nav-item:focus-visible{outline:2px solid #8dff62;outline-offset:2px;}
.shell-nav-item-accent{
  position:absolute;left:0;top:0;bottom:0;width:5px;
  background:linear-gradient(180deg,#8dff62,#2c8a1c);box-shadow:0 0 14px rgba(141,255,98,.7);
}
.shell-nav-item-glyph{
  width:52px;height:52px;flex:none;display:grid;place-items:center;
  background:linear-gradient(180deg,#15130f,#1f1b16);border:1px solid #0a0806;
  box-shadow:inset 0 3px 8px rgba(0,0,0,.8);font-size:22px;color:#8dff62;
}
.shell-nav-item-text{display:flex;flex-direction:column;gap:6px;flex:1;}
.shell-nav-item-title{
  font-family:'Pixelify Sans',sans-serif;font-size:27px;font-weight:700;letter-spacing:.02em;
  color:#f6f1e6;text-shadow:0 2px 0 rgba(0,0,0,.7);
}
.shell-nav-item-sub{font-size:11px;letter-spacing:.14em;color:#9a8d7c;}
.shell-nav-item-chevron{font-size:20px;color:#6d6155;}

.shell-player-card{
  position:absolute;right:40px;top:36px;display:flex;align-items:center;gap:12px;
  padding:12px 20px 12px 12px;border:1px solid #0b0907;cursor:pointer;
  background:linear-gradient(180deg,#3a342c,#221e19);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 6px 16px rgba(0,0,0,.55);
  clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);
  font-family:'Silkscreen',monospace;
}
.shell-player-avatar{
  width:48px;height:48px;flex:none;background:linear-gradient(180deg,#15130f,#1f1b16);
  border:1px solid #0a0806;box-shadow:inset 0 3px 7px rgba(0,0,0,.8);
}
.shell-player-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
.shell-player-id{display:flex;flex-direction:column;gap:5px;}
.shell-player-name{font-size:14px;letter-spacing:.1em;color:#f6f1e6;text-transform:uppercase;}
.shell-player-role{font-size:10px;letter-spacing:.12em;color:#9a8d7c;text-transform:uppercase;}
.shell-player-divider{width:1px;height:38px;background:#0b0907;box-shadow:1px 0 0 rgba(255,255,255,.08);}
.shell-player-econ{display:flex;align-items:center;gap:8px;}
.shell-player-coin{
  width:20px;height:20px;border-radius:50%;background:linear-gradient(180deg,#f4dd9a,#b8912f);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 0 10px rgba(232,196,106,.5);
}
.shell-player-balance{font-size:16px;color:#e8c46a;}

.shell-bottombar{
  position:absolute;left:0;right:0;bottom:0;height:96px;display:flex;align-items:center;
  justify-content:space-between;padding:0 40px;
  background:linear-gradient(180deg,rgba(11,10,9,0),rgba(11,10,9,.9) 40%);
  border-top:1px solid rgba(255,255,255,.06);
}
.shell-version{font-size:11px;letter-spacing:.16em;color:#6d6155;}
.shell-types{display:flex;align-items:center;gap:18px;}
.shell-type-badge{
  width:52px;height:52px;border-radius:50%;padding:3px;cursor:default;transition:transform .12s;
  background:linear-gradient(180deg,#413a31,#231f1a);border:1px solid #0b0907;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 3px 10px rgba(0,0,0,.6);
}
.shell-type-badge:hover{transform:translateY(-5px);}
.shell-type-badge img{width:100%;height:100%;display:block;border-radius:50%;}
.shell-logout{
  font-size:12px;letter-spacing:.14em;color:#a49785;padding:12px 18px;cursor:pointer;
  border:1px solid #0b0907;font-family:'Silkscreen',monospace;
  background:linear-gradient(180deg,#332e27,#201c18);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 3px 0 #100e0b;
}
.shell-logout:hover{color:#efe9dd;filter:brightness(1.25);}
```

- [ ] **Step 2: Copy the type-icon assets**

```bash
mkdir -p Tipos
cp design_handoff_shell_juego_cartas/tipos/*.png Tipos/
```

- [ ] **Step 3: Replace `#menuScreen`'s inner markup in `index.html`**

Replace everything from `<div id="menuScreen" class="hidden">` through its matching closing `</div>` (currently the block containing `.menu-header`, the old `.menu-profile` button, `.menu-body`, and `.menu-footer`) with:

```html
  <div id="menuScreen" class="hidden">
    <div class="shell-viewport">
      <div class="shell-stage" id="shellStage">
        <div class="shell-stage-overlay"></div>

        <div class="shell-menu">
          <div class="shell-keyart" id="shellKeyart"></div>
          <div class="shell-keyart-veil"></div>
          <div class="shell-keyart-halo"></div>

          <div class="shell-left-col">
            <div class="shell-brand" id="menuLogoWrap">
              <div class="shell-logo-plate">
                <img class="shell-logo-img" src="https://images.pokemontcg.io/base1/logo.png" alt="Pokémon TCG">
              </div>
              <div class="shell-setline">
                <div class="shell-setline-rule"></div>
                <div class="shell-setline-text">BASE SET · 1998</div>
              </div>
              <div class="shell-tagline">Duelo por turnos contra la CPU. 60 cartas, 6 premios, sin piedad.</div>
            </div>

            <nav class="shell-nav">
              <button type="button" class="shell-nav-item" id="menuPlay">
                <span class="shell-nav-item-accent"></span>
                <span class="shell-nav-item-glyph">⚔</span>
                <span class="shell-nav-item-text">
                  <span class="shell-nav-item-title">JUGAR</span>
                  <span class="shell-nav-item-sub">DUELO CONTRA LA CPU</span>
                </span>
                <span class="shell-nav-item-chevron">›</span>
              </button>
              <button type="button" class="shell-nav-item" id="menuShop">
                <span class="shell-nav-item-accent"></span>
                <span class="shell-nav-item-glyph">◎</span>
                <span class="shell-nav-item-text">
                  <span class="shell-nav-item-title">TIENDA</span>
                  <span class="shell-nav-item-sub">SOBRES Y CAJAS</span>
                </span>
                <span class="shell-nav-item-chevron">›</span>
              </button>
              <button type="button" class="shell-nav-item" id="menuCollection">
                <span class="shell-nav-item-accent"></span>
                <span class="shell-nav-item-glyph">▤</span>
                <span class="shell-nav-item-text">
                  <span class="shell-nav-item-title">MI COLECCIÓN</span>
                  <span class="shell-nav-item-sub" id="menuCollectionSub">CARGANDO…</span>
                </span>
                <span class="shell-nav-item-chevron">›</span>
              </button>
              <button type="button" class="shell-nav-item" id="menuConfig">
                <span class="shell-nav-item-accent"></span>
                <span class="shell-nav-item-glyph">⚙</span>
                <span class="shell-nav-item-text">
                  <span class="shell-nav-item-title">CONFIGURACIÓN</span>
                  <span class="shell-nav-item-sub">AUDIO, VÍDEO, PARTIDA</span>
                </span>
                <span class="shell-nav-item-chevron">›</span>
              </button>
            </nav>
          </div>

          <button type="button" class="shell-player-card" id="menuProfileBtn">
            <span class="shell-player-avatar"><img id="menuProfilePhoto" src="Perfil/Jugador.jpg" alt=""></span>
            <span class="shell-player-id">
              <span class="shell-player-name" id="menuProfileName">Jugador</span>
              <span class="shell-player-role">ENTRENADOR</span>
            </span>
            <span class="shell-player-divider"></span>
            <span class="shell-player-econ">
              <span class="shell-player-coin"></span>
              <span class="shell-player-balance" id="coin-count">--</span>
            </span>
          </button>

          <div class="shell-bottombar">
            <div class="shell-version">V1.0 · OVERGROWTH VS BLACKOUT</div>
            <div class="shell-types">
              <div class="shell-type-badge" title="Planta"><img src="Tipos/planta.png" alt="Planta"></div>
              <div class="shell-type-badge" title="Fuego"><img src="Tipos/fuego.png" alt="Fuego"></div>
              <div class="shell-type-badge" title="Agua"><img src="Tipos/agua.png" alt="Agua"></div>
              <div class="shell-type-badge" title="Rayo"><img src="Tipos/rayo.png" alt="Rayo"></div>
              <div class="shell-type-badge" title="Psíquico"><img src="Tipos/psiquico.png" alt="Psíquico"></div>
              <div class="shell-type-badge" title="Lucha"><img src="Tipos/lucha.png" alt="Lucha"></div>
              <div class="shell-type-badge" title="Incoloro"><img src="Tipos/incoloro.png" alt="Incoloro"></div>
            </div>
            <button type="button" class="shell-logout" id="menuLogoutBtn">CERRAR SESIÓN</button>
          </div>
        </div>
      </div>
    </div>
  </div>
```

Note: `id="coin-count"` is reused here deliberately — it's the same id `renderCoinCount()` in `ui.js` already writes to (`document.getElementById('coin-count').textContent = val;`), so the coin balance keeps working with zero JS changes in this task.

In `index.html`'s `<head>`, add the new stylesheet after `style.css`:

```html
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="shell-theme.css">
```

- [ ] **Step 4: Retarget the background/logo-visibility functions in `ui.js`**

Change `applyMenuBackground()`'s target element from `#menuScreen` to `#shellKeyart`. The snippet below is the function's **complete** current body (its closing `}` is the line right after `}` shown here) — the only change anywhere in it is the `getElementById` argument on the first line:

```js
function applyMenuBackground() {
  var el = document.getElementById('shellKeyart');
  if (!el) { return; }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tcg_menu_bg')); } catch (e) {}
  if (saved && saved.img) {
    el.style.backgroundImage = 'url(' + saved.img + ')';
    el.style.backgroundSize = saved.w + '% auto';
    el.style.backgroundPosition = saved.x + '% ' + saved.y + '%';
    el.style.backgroundRepeat = 'no-repeat';
  } else {
    el.style.backgroundImage = 'url(' + MENU_BG_DEFAULT + ')';
    el.style.backgroundSize = '100% auto';
    el.style.backgroundPosition = '50% 50%';
    el.style.backgroundRepeat = 'no-repeat';
  }
}
```

Every other function in `ui.js` is untouched by this step.

Change `applyMenuLogo()` to toggle the new logo wrapper instead of the removed `.menu-header`:

```js
function applyMenuLogo() {
  var show = true;
  try { show = localStorage.getItem('tcg_menu_logo') !== 'hidden'; } catch (e) {}
  var logoWrap = document.getElementById('menuLogoWrap');
  if (logoWrap) { logoWrap.style.display = show ? '' : 'none'; }
}
```

- [ ] **Step 5: Run the regression suite**

Run: `node run-tests.js`
Expected: unchanged, every `PASS:` line prints, exit code 0 (no game-logic files touched).

- [ ] **Step 6: Manual check**

Open the game, log in: the menu shows the new metal-plate look, key-art box, nav list, player card (with placeholder "CARGANDO…" collection subtitle — Task 4 fixes that), bottom bar with 7 type icons and a working "CERRAR SESIÓN" button. Resize the window: content doesn't reflow/scroll (Task 4 adds the actual scale-to-fit transform — until then it may render at native 1920×1080 size, clipped by `overflow:hidden` on `.shell-viewport`, which is expected at this point).

- [ ] **Step 7: Commit**

```bash
git add shell-theme.css index.html ui.js Tipos
git commit -m "Rebuild the main menu with the new shell visual design"
```

---

### Task 4: Wire real data and the scaling transform

**Files:**
- Modify: `ui.js` (`renderProfile()` gains the collection-subtitle update; new `layoutShellStage()`; `DOMContentLoaded` wiring: initial layout call + `resize` listener)

**Interfaces:**
- Consumes: `computeStageTransform(viewportWidth, viewportHeight)` and `collectionProgress(collection, cardCatalog)` from `shell-layout.js` (Task 1); `#shellStage`, `#menuCollectionSub` from Task 3's markup; `econState` (`{coins, collection}`, already a global set by `economy.js`'s Firestore listener); `CARD_CATALOG` (global from `data-sets.js`).
- Produces: `layoutShellStage()` (no args, no return — reads `window.innerWidth/innerHeight`, writes `#shellStage`'s `transform` style).

- [ ] **Step 1: Add `layoutShellStage()` to `ui.js`**

Add this function near `renderProfile()`:

```js
function layoutShellStage() {
  var stage = document.getElementById('shellStage');
  if (!stage) { return; }
  var t = computeStageTransform(window.innerWidth, window.innerHeight);
  stage.style.transform = 'translate(' + t.x + 'px,' + t.y + 'px) scale(' + t.scale + ')';
}
```

- [ ] **Step 2: Wire it into `DOMContentLoaded` and `resize`**

In the `DOMContentLoaded` handler in `ui.js`, right after the existing `applyMenuBackground(); applyMenuPositions(); applyMenuLogo();` lines (note: `applyMenuPositions();` was already deleted in Task 2 — the line should now just be `applyMenuBackground(); applyMenuLogo();`), add:

```js
  applyMenuBackground();
  applyMenuLogo();
  layoutShellStage();
  window.addEventListener('resize', layoutShellStage);
```

- [ ] **Step 3: Add the real collection-progress string to `renderProfile()`**

In `ui.js`, `renderProfile()` currently ends with the `.collection-profile-photo` loop. Add this at the end of the function body (still inside the existing `if (!profileState) { return; }` guard, since it needs to run every time profile/coins data refreshes):

```js
  var collectionSubEl = document.getElementById('menuCollectionSub');
  if (collectionSubEl && econState) {
    var progress = collectionProgress(econState.collection, CARD_CATALOG);
    collectionSubEl.textContent = progress.owned + ' DE ' + progress.total + ' CARTAS';
  }
```

- [ ] **Step 4: Make sure the collection subtitle also updates when coins/collection change, not only profile**

`renderProfile()` is only called from the Firestore `onSnapshot` handler in `economy.js` when `profileState` changes shape — but the same snapshot updates `econState` too, and both are set together in `initEconomyListener()` (see `economy.js`), so every snapshot that changes coins/collection also re-runs `renderProfile()` right after `renderCoinCount()`. No separate wiring is needed — verify this by reading `economy.js`'s `onSnapshot` callback and confirming `renderProfile()` is called unconditionally after `renderCoinCount()` on every snapshot (not gated behind a profile-specific diff).

- [ ] **Step 5: Run the regression suite**

Run: `node run-tests.js`
Expected: unchanged, every `PASS:` line prints, exit code 0.

- [ ] **Step 6: Manual check**

Open the game at a few window sizes (e.g. resize the browser window narrower/wider/shorter): the whole menu scales uniformly and stays centered with letterbox bars, never scrolls. Log in with an account that owns some cards: "MI COLECCIÓN" shows the real `owned DE total CARTAS` (total should read 228). Tab through the menu with the keyboard: each of the 4 nav buttons and the player card get a visible green focus outline in sequence, and Enter/Space activates the focused one (native `<button>` behavior — no extra JS needed).

- [ ] **Step 7: Commit**

```bash
git add ui.js
git commit -m "Wire the scaling transform and real collection-progress data into the new menu"
```

---

### Task 5: Cleanup, docs, final regression

**Files:**
- Modify: `style.css` (remove now-dead old-menu CSS)
- Modify: `README.md` (architecture file table + a short note on the shell redesign)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — cleanup and documentation only.

- [ ] **Step 1: Remove the dead old-menu CSS from `style.css`**

Delete lines 45–104 (from the `/* Background art */` comment through the `.light .menu-profile-name{...}` rule — this spans the old `.menu-bg-art`, `.menu-header`, `.menu-logo`, `.menu-logo-img`, `.menu-body`, `.menu-nav`/`.menu-nav-btn`/`.mnb-*`, `.menu-footer`/`.menu-footer-btn`/`.menu-version`, and every `.light` override of those). **Keep** lines 41–43 (`#menuScreen{...}` and `#menuScreen.hidden{...}` — the show/hide mechanism, untouched since Task 1).

Also delete the now-dead menu-profile-widget rules (search for the `/* ===================== MENU PROFILE WIDGET ===================== */` comment): remove that comment plus the `.menu-profile{...}`, `.menu-profile:hover{...}`, `.menu-profile-name{...}`, `.menu-profile-photo{...}` rules. **Keep** `.profile-edit-preview` and `.profile-edit-preview img` right below them — those style `#editProfileModal`'s photo preview, unrelated to the menu widget, still in use.

- [ ] **Step 2: Update `README.md`**

In the "Architecture" file table, add a row after `ui.js`:

```
shell-layout.js DOM-free math for the shell redesign (stage scale/position, collection progress)
shell-theme.css shell redesign's design tokens + component styles (currently: main menu only)
```

Add a short paragraph after the "## Card images" section:

```markdown
## Shell redesign

The interface shell (menus, board frame, panels, HUD) is being re-skinned
screen-by-screen to a 32-bit-console visual design from a client handoff —
see `docs/superpowers/specs/2026-08-19-shell-redesign-design.md` for the
adaptation decisions and phase order. So far: the main menu only. Every
other screen still uses the original look until its own phase lands.
```

- [ ] **Step 3: Run the full regression suite one more time**

Run: `node run-tests.js`
Expected: every `PASS:` line prints, exit code 0.

- [ ] **Step 4: Manual QA checklist**

With `firebase emulators:start` running and the emulator page open:
- Menu scales to fit and letterboxes correctly at a few window sizes, no scroll.
- Logo, key-art (with your configured background or the default cover), tagline, 4 nav items, player card (photo/username/coins), bottom bar (version text, 7 type icons, logout) all render per the handoff's look.
- Clicking the player card still opens the edit-profile modal (username/photo/password) exactly as before.
- Clicking each of the 4 nav items still navigates correctly (Jugar/Tienda/Mi Colección/Configuración).
- Configuración no longer shows "Mover Logo y Opciones" or "Restaurar posiciones"; "Configurar Portada" still works, now visibly positioned inside the key-art box.
- Keyboard Tab cycles through the 4 nav buttons and the player card with a visible green focus ring; Enter/Space activates the focused item.

- [ ] **Step 5: Commit**

```bash
git add style.css README.md
git commit -m "Clean up dead menu CSS and document the shell redesign"
```
