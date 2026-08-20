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

**Canonical reference (current):** `design_handoff_shell_juego_final/README.md`
and its `Shell del Juego.dc.html` — a third handoff revision. The first
(`design_handoff_shell_juego_cartas/`, now a snapshot of an earlier revision)
specified a fixed-1920×1080-canvas menu with a key-art photo on the right; a
second revision (superseded, not kept in the repo) added a "read this before
laying out" scaling section confirming plain `Math.min`/contain + flat
letterbox bars. This final revision changes the canvas model again —
elastic width instead of fixed-then-letterboxed, see "Elastic-width canvas"
below — and replaces the key-art photo slot with a real "Panel de
novedades" (news feed) component. Ignore the `.dc.html` file's own template
runtime; only its markup/inline styles matter. This spec does not restate
those pixel values
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
- **Elastic-width scaling shell**, applied per-screen as that screen is
  migrated (not globally on day one — unmigrated screens must keep working
  normally). Structure:
  ```html
  <div class="shell-viewport">      <!-- fills the screen's existing full-viewport container -->
    <div class="shell-stage">       <!-- height:1080px fixed; width set by JS every load/resize -->
      ...screen content...
    </div>
  </div>
  ```
  Went through three iterations before landing here — see the git history
  on `shell-layout.js`/`ui.js` for the two reverted ones (`Math.max`/cover,
  which cropped the player card and bottom bar on a wide screen; then a
  fixed-1920-canvas `Math.min`/contain with flat letterbox bars, which
  wasted visible width on any wider-than-16:9 screen). The final model,
  per `design_handoff_shell_juego_final/README.md`'s "⚠ Adaptación a la
  pantalla" section: **height always drives the scale**, and the stage's
  own **width grows elastically to fill the real screen**, clamped to
  [1920, 2560] — so a normal landscape window gets no side bars at all.
  Below 1920-equivalent width, scale falls back to being width-driven and
  bars appear only top/bottom (never left/right). Past 2560, the maxed-out
  stage centers with bars on both sides rather than stretching the
  composition further apart. `computeStageTransform()` (`shell-layout.js`)
  returns `{x, y, scale, width}`; `layoutShellStage()` (`ui.js`) applies
  `width` to the stage's own `style.width` in addition to the transform.
  Content that must stay a fixed width (the nav column, the news panel)
  anchors to the stage's left/right edges via plain CSS (`left:104px` /
  `right:96px`, not `left`+`right` together) so it doesn't stretch when the
  stage widens; content that's allowed to grow (the decorative layer
  between the nav and the news panel) uses `left:_px; right:0` so its
  width tracks the elastic stage automatically, no JS needed.

  **The background bleeds; the content doesn't.** `.shell-viewport`
  (unscaled, real screen size) paints the background — in this project,
  the user's own `Tablero/fondo.png` (`cover`, centered) rather than the
  handoff's own gradient+noise-texture recipe, per an explicit later
  request; either way the rule is the same: `.shell-stage` paints **no
  background of its own**. Stacking two independently-sized backgrounds
  (one on the fixed-then-scaled stage, one on the real viewport) is what
  caused a visible seam during an earlier iteration — the fix was moving
  the background down to the unscaled viewport entirely, not patching the
  seam. Each migrated screen's own root element becomes the
  `.shell-viewport` (`#menuScreen` already is `position:fixed;inset:0`, so
  it just gains a `.shell-stage` child wrapping its actual content, and
  `layoutShellStage` runs whenever that screen becomes visible plus on
  `resize`).
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
| Arte principal / (superseded by) Panel de novedades (830×800, `right:96px;top:132px`) + decorative layer (`left:740px;right:0`) | N/A — this was a brand-new component, no prior code to adapt | The original handoff's key-art photo slot was hidden entirely (per an explicit request) before this final revision replaced it outright with a real "Panel de novedades" component. Built with static placeholder entries (5 items, matching the handoff's own admission that its copy is "realistic filler, not final copy") — no real news feed exists in this project; wiring one up is future scope. The decorative layer (grid mask, two concentric rings, 5 ghost type-icons) sits behind the panel, anchored `left:740px;right:0` so its width tracks the elastic stage automatically. |
| Logotipo (460×150, metal plate) | `.menu-logo-img`, currently the official Pokémon TCG logo image already used on the login screen | Reuse the same logo image already in the project (it's already this project's established brand asset, not a new trademark reproduction). Fit `contain` inside the 460×150 metal-plate hole. |
| 5 ítems de menú (Jugar/Mazos/Tienda/Mi Colección/Configuración), icons as Unicode glyphs in the prototype's first two revisions | 4 nav buttons: `menuPlay`, `menuShop`, `menuCollection`, `menuConfig` | Drop "Mazos" (out of scope) — but the user separately asked for a 5th, disabled "MI MAZO" placeholder row (`menuDeck`, `disabled`, no click handler), which stays. Icons: the final handoff revision explicitly calls out Unicode glyphs (⚔ ▦ ◎ ▤ ⚙) as a defect — Silkscreen doesn't cover them, several collapse to the same fallback glyph. Switched to real Phosphor duotone icons (`ph-sword`, `ph-stack`, `ph-storefront`, `ph-grid-four`, `ph-gear-six`), loaded via the same CDN-`<link>` pattern the prototype itself uses. |
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
(confirm scale-to-fit + letterboxing behaves, nothing is ever cropped off-screen, no scroll appears, real
coins/photo/username/collection-count show correctly).
