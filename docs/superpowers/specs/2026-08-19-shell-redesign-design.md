# Shell Visual Redesign — Design Spec

## Overview

The client commissioned a full visual redesign of the game's interface shell
(everything around the cards: menus, board frame, panels, HUD, buttons,
typography) — a 32-bit-console aesthetic (warm brushed metal, bevels,
specular highlights, bitmap type, phosphor green accent). The handoff lives
at `design_handoff_shell_juego_cartas/` (also zipped at
`Juego de cartas Pokémon generación uno.zip`) and covers seven screens: Menú
principal, Selección de mazo, Tablero de duelo, Tienda, Apertura de sobre, Mi
colección, Configuración. **Cards are explicitly out of scope** — they stay
placeholders in the handoff and stay as this project's existing card
rendering everywhere they appear.

**Canonical reference:** `design_handoff_shell_juego_cartas/README.md` (all
colors, type, spacing, shadow recipes, per-screen layout) and
`Shell del Juego.dc.html` (the actual prototype markup — open it in a
browser to see it live; ignore its `.dc.html` template runtime, only the
markup/inline styles matter). This spec does not restate those pixel values
— it records the **adaptation decisions**: what maps to what in this
codebase, what's dropped, what's wired to real data instead of the
prototype's mock data. When writing task briefs from this spec, pull exact
values directly from the handoff README's matching section.

## Scope & Phasing

This is too large for one implementation plan, so it's split into one plan
per screen, executed in this order:

1. **Menú principal** (this plan)
2. Tablero de duelo
3. Tienda
4. Apertura de sobre
5. Mi colección
6. Configuración

**Selección de mazo is out of scope entirely for now.** The handoff's deck
screen assumes three playable decks with editing; the game currently has one
playable deck (Overgrowth) vs. one fixed CPU deck (Blackout) — no
deck-selection feature exists. Building it is a separate future project, not
a reskin. The main menu's nav list reflects this: the handoff's 5 items
(Jugar/Mazos/Tienda/Mi Colección/Configuración) become the 4 that already
exist in this game (`menuPlay`, `menuShop`, `menuCollection`, `menuConfig`).

Each future phase gets its own short design note (an addendum to this file
or a new dated spec, whichever is smaller at the time) plus its own
implementation plan — this file's "Shared Technical Foundation" section
below is the one piece every phase reuses as-is.

## Shared Technical Foundation

New file `shell-theme.css`, loaded after `style.css` in `index.html`. Holds:

- **Design tokens** as CSS custom properties, scoped to a `.shell-stage`
  class (not `:root` — this shell is a distinct visual theme layered over
  the game's existing look, not a site-wide retheme). Values: see the
  handoff README's "Design Tokens" section (color table, type scale,
  spacing scale, shadow/bevel recipes, `clip-path` corner-cut recipes,
  button variants, `@keyframes`).
- **Fixed-canvas scaling shell**, applied per-screen as that screen is
  migrated (not globally on day one — unmigrated screens must keep working
  normally). Structure:
  ```html
  <div class="shell-viewport">      <!-- fills the screen's existing full-viewport container -->
    <div class="shell-stage">       <!-- width:1920px; height:1080px; transform-origin: 0 0 -->
      ...screen content...
    </div>
  </div>
  ```
  ```css
  .shell-viewport{position:absolute;inset:0;overflow:hidden;background:#070706;}
  .shell-stage{width:1920px;height:1080px;position:relative;}
  ```
  JS computes and applies the transform on load and on `resize`. Uses
  `Math.max` (cover) rather than `Math.min` (contain) -- the user tried the
  contain version live and asked for the screen to be filled edge-to-edge
  instead of showing letterbox bars, even at the cost of cropping whichever
  axis overflows:
  ```js
  function layoutShellStage(stageEl) {
    var scale = Math.max(window.innerWidth / 1920, window.innerHeight / 1080);
    var x = (window.innerWidth - 1920 * scale) / 2;
    var y = (window.innerHeight - 1080 * scale) / 2;
    stageEl.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  }
  ```
  Each migrated screen's own root element becomes the `.shell-viewport`
  (`#menuScreen` already is `position:fixed;inset:0`, so it just gains a
  `.shell-stage` child wrapping its actual content, and `layoutShellStage`
  runs whenever that screen becomes visible plus on `resize`).
- **Fonts:** Google Fonts `<link>` tags for `Pixelify Sans` (variable,
  400..700) and `Silkscreen` (400, 700), added to `index.html` `<head>`.
  `font-family: 'Silkscreen', monospace` as the base, scoped to
  `.shell-stage` (not `body`) so unmigrated screens are unaffected.
- **Type icons:** copy the 7 PNGs from
  `design_handoff_shell_juego_cartas/tipos/` into a new project-root
  `Tipos/` folder (mirrors the existing `Cartas/`, `Perfil/`, `Sobres/`
  convention of locally-hosted art).

## Phase 1: Menú Principal — Adaptation Map

| Handoff element | Current code | Decision |
| --- | --- | --- |
| Arte principal (1180×1080, `right:0;top:0`) | Existing "Configurar Portada" background system (`Perfil/Portada_Oficial.jpeg`, user-configurable via `#configBgBtn`) | Keep the configurable-background system as-is; re-box it into the handoff's 1180×1080 right-anchored slot, add the legibility gradient + green halo overlays on top of it. |
| Logotipo (460×150, metal plate) | `.menu-logo-img`, currently the official Pokémon TCG logo image already used on the login screen | Reuse the same logo image already in the project (it's already this project's established brand asset, not a new trademark reproduction). Fit `contain` inside the 460×150 metal-plate hole. |
| 5 ítems de menú (Jugar/Mazos/Tienda/Mi Colección/Configuración) | 4 nav buttons: `menuPlay`, `menuShop`, `menuCollection`, `menuConfig` | Drop "Mazos" (out of scope). Keep the existing 4, restyled to the handoff's row recipe (accent bar, glyph box, label/sublabel, chevron). |
| "MI COLECCIÓN" sublabel: `69 DE 102 CARTAS` (mock) | `econState.collection` (owned card keys) vs. total cards in `CARD_CATALOG`/`data-sets.js` | Compute real owned-count / total-count and render it instead of the mock string. |
| Tarjeta de jugador: avatar 48×48, `JUGADOR` name, `ENTRENADOR · NV 12` sub-line, coin readout | `profileState.photo`/`playerPhotoUrl()`, `profileState.username`/`playerDisplayName()`, `econState.coins` — all already wired via `renderProfile()`/`renderCoinCount()` | Use the real photo/name/coin values (already available, just re-skin the card markup). Sub-line becomes just `ENTRENADOR` — no leveling system exists in this game, so no fake number gets invented. |
| Barra inferior: version string, 7 type-icon row, `CERRAR SESIÓN` | `menu-footer`, `menuLogoutBtn` (both already exist) | Keep both. Add the 7-icon row from `Tipos/*.png` between them — purely decorative, no click behavior (matches the handoff, which doesn't wire these to anything either). |

Everything else in the handoff's Menú principal section (layout, colors,
component recipes, animations) is followed as written in the README/prototype.

## Out of Scope for This Phase

- Any screen besides the main menu (game screen behind it keeps its current
  fluid layout/CSS untouched — `#menuScreen`'s new fixed-canvas shell does
  not leak outside it).
- Keyboard/gamepad navigation and the 2px focus ring (handoff explicitly
  flags this as prototype-mouse-only, to be added "al implementar" — worth
  a follow-up task, not blocking this phase's visual parity goal, but should
  still land before this phase is called done since it's cheap for a menu
  list: note it as a task in the implementation plan rather than dropping it).
- Selección de mazo (see Scope & Phasing above).

## Testing

No card-engine logic changes, so `node run-tests.js` must stay green
throughout (regression guard). There's no automated visual test for CSS/layout
— verification is manual: run `firebase emulators:start`, open
`http://127.0.0.1:5000`, log in, and eyeball the menu at a few window sizes
(confirm the stage fills the viewport edge-to-edge with no bars, no scroll appears, real
coins/photo/username/collection-count show correctly).
