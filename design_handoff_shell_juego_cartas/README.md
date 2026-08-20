# Handoff: Shell de interfaz — juego de cartas Pokémon (generación 1)

## Overview

Rediseño completo del *shell* de interfaz de un juego de cartas coleccionables por turnos
contra CPU, ambientado en la primera generación (Base Set, 1998–99). El objetivo estético es
un juego bien producido de la era 32-bit (PS1 / N64): metal cepillado cálido, biseles, luces
especulares, tipografía bitmap, y un verde fósforo como color de acción.

Cubre siete pantallas: **Menú principal, Selección de mazo, Tablero de duelo, Tienda,
Apertura de sobre, Mi colección y Configuración.**

> **Antes de escribir una línea de layout, lee «⚠ Adaptación a la pantalla» más abajo.** El
> diseño es un lienzo fijo de 1920×1080 que se escala con letterbox; si se implementa como una
> página responsive, se cortan los laterales.

Alcance explícito acordado con el cliente: **las cartas no se rediseñan.** Todas las cartas
aparecen como marcadores de posición (rectángulos con trama diagonal y la etiqueta `CARTA`).
El trabajo es todo lo que rodea a las cartas: marcos, fondos, menús, paneles, HUD, botones,
tipografía y disposición del tablero.

---

## About the Design Files

Los archivos de este paquete son **referencias de diseño creadas en HTML**: prototipos que
muestran el aspecto y el comportamiento previstos. **No son código de producción para copiar
directamente.**

La tarea es **recrear estos diseños en el entorno del código destino** (React, Vue, Unity UI,
Godot, SwiftUI, nativo…) usando los patrones y librerías ya establecidos en ese proyecto. Si
todavía no hay entorno, elige el marco más adecuado al proyecto (para un juego de cartas 2D
es razonable un motor con UI declarativa, o React si es web) e impleméntalo allí.

Nota técnica sobre el prototipo: el archivo `.dc.html` usa un pequeño runtime propio con
plantillas (`{{ hole }}`, `<sc-if>`, `<sc-for>`) y una clase de lógica. **Ignora ese runtime**;
lo relevante es el marcado, los estilos en línea y el modelo de estado descrito más abajo.

## Fidelity

**Alta fidelidad (hifi).** Colores, tipografías, tamaños, sombras y estados están definitivos.
La UI debe recrearse fielmente con las librerías del codebase destino.

Dos matices:
- Las **cartas** son marcadores de posición intencionados. Sustitúyelas por el render real de
  carta que ya exista en el proyecto, respetando las cajas y proporciones indicadas.
- El **logotipo** y el **arte principal** del menú son huecos vacíos a rellenar con material
  del cliente. No hay logotipo diseñado en este paquete (no se pueden reproducir marcas de
  terceros); usa el arte propio del proyecto.

---

## ⚠ Adaptación a la pantalla — LEE ESTO ANTES DE MAQUETAR

Este diseño **no es responsive**. Es un lienzo de resolución fija, como un juego de consola.
La forma correcta de adaptarlo a cualquier pantalla es **escalar el lienzo completo y dejar
bandas negras** (letterbox / pillarbox). Nunca recortar, nunca reflujo.

**Síntoma de implementación incorrecta:** se cortan los laterales izquierdo y derecho (o el
borde superior/inferior). Eso significa que se usó `max()` en vez de `min()` al calcular la
escala, o `object-fit: cover`, o se dejó el lienzo a 1920px de ancho sin escalar dentro de un
contenedor más estrecho con `overflow: hidden`.

**La regla, con una sola fórmula:**

```js
const scale = Math.min(viewportWidth / 1920, viewportHeight / 1080);   // min, NUNCA max
```

`min` garantiza que el lado más restrictivo entre completo; el otro lado sobra y se rellena con
el color de letterbox `#070706`. Con `max`, el lado excedente se sale del contenedor y se
recorta: eso es exactamente el defecto reportado.

**Implementación de referencia (web):**

```html
<div id="viewport">          <!-- ocupa toda la ventana; overflow:hidden -->
  <div id="stage">…</div>    <!-- 1920×1080 fijos, escalado por transform -->
</div>
```

```css
#viewport {
  position: relative;
  width: 100%;
  height: 100vh;         /* o 100dvh en móvil */
  overflow: hidden;
  background: #070706;   /* el color de las bandas */
}
#stage {
  position: absolute;
  left: 0; top: 0;
  width: 1920px;         /* SIEMPRE 1920×1080, sin media queries */
  height: 1080px;
  transform-origin: 0 0; /* imprescindible: sin esto el centrado no cuadra */
  overflow: hidden;
}
```

```js
function fit() {
  const vp = document.getElementById('viewport');
  const st = document.getElementById('stage');
  const w = vp.clientWidth, h = vp.clientHeight;
  const s = Math.min(w / 1920, h / 1080) || 1;
  const x = (w - 1920 * s) / 2;   // centrado horizontal → pillarbox
  const y = (h - 1080 * s) / 2;   // centrado vertical  → letterbox
  st.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}
fit();
addEventListener('resize', fit);
```

**Puntos donde suele romperse:**

1. `transform-origin` distinto de `0 0` — el `translate` calculado deja de coincidir y el
   escenario se desplaza fuera del contenedor.
2. Centrar con `display: grid; place-items: center` **además** del `translate` — el centrado se
   aplica dos veces y el escenario se va de cuadro. Elige uno: o `translate` manual con
   `transform-origin: 0 0` (recomendado, es lo que hace el prototipo), o `place-items: center`
   con `transform-origin: center center` y solo `scale()`.
3. Escalar con `zoom` o con `width: 100%` en lugar de `transform: scale()` — provoca reflujo y
   rompe todas las medidas absolutas del diseño.
4. Media queries o breakpoints. **No hay ninguno.** Si aparece un breakpoint en la
   implementación, es un error de interpretación.
5. `overflow` sin definir en el contenedor exterior — el escenario asoma y aparecen barras de
   scroll.

**Equivalentes en otros entornos:**

- **Unity UI:** `Canvas Scaler` → `Scale With Screen Size`, `Reference Resolution` 1920×1080,
  `Screen Match Mode` = **Expand** (equivale a `min`; `Shrink` recorta).
- **Godot:** `Stretch Mode` = `canvas_items`, `Aspect` = **keep** (no `keep_width`/`keep_height`).
- **React Native / móvil:** contenedor con la relación 16:9 centrada, escalado por `transform`.
- **SwiftUI:** `.aspectRatio(16/9, contentMode: .fit)` — `.fit`, nunca `.fill`.

**Si de verdad hace falta soportar relaciones de aspecto muy distintas** (móvil vertical, por
ejemplo), eso es un rediseño, no una adaptación: hay que redistribuir las cuatro columnas del
tablero y volver a presupuestar el alto. Consúltalo con el diseñador antes de improvisarlo.

---

## Lienzo y escalado

- Lienzo de diseño fijo: **1920 × 1080 px**. Todas las medidas de este documento son en ese lienzo.
- El escenario se escala uniformemente al viewport con la fórmula de la sección anterior
  (`min`, letterbox). No hay breakpoints ni layout fluido.

### Capas de fondo del escenario

1. Base: `radial-gradient(120% 85% at 50% -10%, #332d24 0%, #191612 52%, #0b0a09 100%)`
2. Superpuesta (no interactiva, `pointer-events:none`, cubre todo el escenario):
   `repeating-linear-gradient(45deg, rgba(255,255,255,.012) 0 2px, transparent 2px 5px)` +
   `radial-gradient(90% 70% at 50% 45%, transparent 40%, rgba(0,0,0,.55) 100%)`

---

## Design Tokens

### Color

| Rol | Hex | Uso |
| --- | --- | --- |
| Fondo exterior | `#070706` | Letterbox alrededor del escenario |
| Escenario oscuro | `#0b0a09` | Extremo del degradado de fondo |
| Grafito medio | `#191612` | Fondo medio, laterales de raíles |
| Grafito panel | `#221e19` | Fondo de raíles y paneles |
| Metal claro | `#413a31` / `#3a342c` | Tope del degradado de placas metálicas |
| Metal oscuro | `#251f1a` / `#221e19` | Base del degradado de placas metálicas |
| Hueco / inset | `#0f0d0b` · `#14120f` · `#15130f` | Fondos hundidos (barras, listas, visores) |
| Línea de corte | `#0b0907` · `#0a0806` | Bordes de 1px de todas las placas |
| Sombra de relieve | `#110f0c` · `#100e0b` | Borde inferior de 3–4px de los botones |
| Texto primario | `#efe9dd` | Cuerpo general |
| Texto fuerte | `#f6f1e6` | Títulos y nombres |
| Texto secundario | `#d6cbb9` | Etiquetas de botones secundarios |
| Texto atenuado | `#a49785` · `#9a8d7c` | Subtítulos, notas |
| Texto tenue | `#8a7e6f` · `#6d6155` | Metadatos, unidades |
| Texto muy tenue | `#5c5348` · `#4f4740` · `#4a4239` | Placeholders, huecos vacíos |
| **Acción (verde fósforo)** | `#8dff62` | Acento primario: acciones, HP propio, foco |
| Verde profundo | `#2c8a1c` | Base del degradado verde |
| Verde texto sobre verde | `#0d2a06` | Texto sobre botón verde |
| Verde borde/relieve | `#0e2c07` / `#16480d` | Borde y sombra del botón verde |
| **Oro (secundario)** | `#e8c46a` | Acento secundario: economía, rareza, avisos |
| Oro claro | `#f4dd9a` | Tope del degradado dorado |
| Oro profundo | `#b8912f` | Base del degradado dorado |
| Oro texto/borde | `#2b2005` / `#4a3a0c` / `#6d5514` | Texto, borde y relieve del botón dorado |
| **Rojo oponente** | `#ff8a72` | Todo lo perteneciente a la CPU |
| Rojo daño | `#ff6a5a` → `#a02012` | Contador de daño, degradado |
| Rojo barra HP | `#c0392b` | Base de la barra de HP del oponente |
| Rojo panel CPU | `#3a2a26` → `#241715` | Placas del lado CPU |
| Rojo destructivo | `#4a2a24` → `#2a1714`, texto `#ffb0a4` | «Borrar datos» |
| Dorso de carta CPU | `#3b1f1c` / `#2a1512` | Trama del dorso rojo |
| Dorso de carta propio | `#1c3b1d` / `#122a13` | Trama del dorso verde |
| Verde panel propio | `#2a3a26` → `#172415` | Placas del lado del jugador |
| Relleno de carta | `#241f1a` (neutro) · `#20241c` (propio) | Marcador de posición de carta |

Tipos de energía (iconos, ver *Assets*):
`planta #62c23c` · `fuego #e0452a` · `agua #3aa0e0` · `rayo #e8c46a` ·
`psíquico #a35fd6` · `lucha #c1682c` · `incoloro #cfc6b6`

### Tipografía

Dos familias bitmap de Google Fonts:

```
Pixelify Sans (400..700 variable)  →  --font-display
Silkscreen (400, 700)              →  --font-ui
```

`font-family` global del escenario: `'Silkscreen', monospace`, color `#efe9dd`.

| Rol | Familia | Tamaño | Peso | Letter-spacing |
| --- | --- | --- | --- | --- |
| Título de pantalla | Pixelify Sans | 30px | 700 | .04em |
| Título de héroe (tienda) | Pixelify Sans | 38px | 700 | .02em |
| Cifra grande / VS | Pixelify Sans | 34–52px | 700 | — |
| Botón primario | Pixelify Sans | 21–26px | 700 | .06–.08em |
| Nombre de carta / mazo | Pixelify Sans | 22–24px | 700 | .02em |
| Daño de ataque | Pixelify Sans | 24–26px | 700 | — |
| Ítem de menú | Pixelify Sans | 27px | 700 | .02em |
| Etiqueta de sección | Silkscreen | 10–12px | 400 | .20–.24em |
| Etiqueta de botón | Silkscreen | 11–13px | 400 | .10–.14em |
| Cuerpo / lista | Silkscreen | 11–13px | 400 | .02–.08em |
| Mínimo absoluto | Silkscreen | **10px** | 400 | .02–.14em |

Regla: **nunca por debajo de 10px.** Los textos de línea larga (descripciones de ataque)
llevan `line-height: 1.55–1.7`; las etiquetas cortas, 1.5.

### Espaciado

Escala usada (px): `4 · 5 · 6 · 8 · 9 · 10 · 12 · 14 · 18 · 20 · 22 · 26 · 28 · 32 · 34 · 40`.
Padding de raíl 10–14px · padding de panel 18–26px · padding de página 32–40px.
Gap entre cartas de banca 10px · entre cartas de mano 8px · entre paneles 22–28px.

### Radios

**Cero radios.** El sistema no usa `border-radius` salvo:
- `50%` en fichas de energía, avatares circulares y la moneda.
- El corte de esquina de las placas se hace con `clip-path`, no con radios (ver más abajo).

### Sombras y relieve (el lenguaje visual central)

Tres materiales, cada uno con una receta fija.

**A. Placa metálica** (paneles, botones, cabeceras):
```css
background:
  repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 3px),
  linear-gradient(180deg, #3d372e, #231f1a);
border: 1px solid #0b0907;
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.18),    /* luz especular superior */
  inset 0 -2px 0 rgba(0,0,0,.55),         /* corte inferior */
  0 4px 0 #110f0c,                        /* relieve sólido */
  0 8px 16px rgba(0,0,0,.45);             /* sombra proyectada */
```
La primera capa de `background` (rayas verticales de 1px cada 3px) es el **cepillado del
metal**; presente en casi todas las placas.

**B. Hueco / inset** (barras de progreso, listas, visores, campos):
```css
background: linear-gradient(180deg, #15130f, #1d1a15);   /* o plano #0f0d0b */
border: 1px solid #0a0806;
box-shadow: inset 0 2px 6px rgba(0,0,0,.9);              /* hasta inset 0 3px 12px */
```

**C. Corte de esquina biselado** (`clip-path`) — dos variantes:
```css
/* esquina superior-izquierda + inferior-derecha, 12–14px */
clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
/* chaflán trapezoidal, para el indicador de turno */
clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 100%, 0 100%);
```

**Botones — receta completa**

| Variante | Fondo | Borde | Sombra | Texto |
| --- | --- | --- | --- | --- |
| Primario (verde) | `linear-gradient(180deg,#8dff62,#2c8a1c)` | `1px #0e2c07` | `inset 0 2px 0 rgba(255,255,255,.5), 0 3px 0 #16480d, 0 0 24px rgba(141,255,98,.28)` | `#0d2a06` |
| Confirmar (dorado) | `linear-gradient(180deg,#f4dd9a,#b8912f)` | `1px #4a3a0c` | `inset 0 2px 0 rgba(255,255,255,.5), 0 3px 0 #6d5514` | `#2b2005` |
| Secundario (metal) | `linear-gradient(180deg,#413a31,#251f1a)` | `1px #0b0907` | `inset 0 1px 0 rgba(255,255,255,.18), 0 3px 0 #100e0b` | `#d6cbb9` |
| Destructivo | `linear-gradient(180deg,#4a2a24,#2a1714)` | `1px #0b0907` | `inset 0 1px 0 rgba(255,255,255,.14), 0 3px 0 #180d0b` | `#ffb0a4` |

Estados:
- Hover metal / secundario: `filter: brightness(1.3)`
- Hover verde / dorado: `filter: brightness(1.1–1.14)`
- Hover ítem de menú: `transform: translateX(10px); filter: brightness(1.28) saturate(1.1)`, transición `.12s`
- Hover carta de mano: `transform: translateY(-20px)`, transición `.14s`, más contorno dorado
  `box-shadow: 0 0 0 1px #e8c46a, 0 0 22px rgba(232,196,106,.45), 0 10px 20px rgba(0,0,0,.7)`
- Hover carta de banca: `filter: brightness(1.3–1.35)`
- Hover ficha de energía: `transform: translateY(-5px)`
- Hover fila de ataque: `background: rgba(141,255,98,.09)`
- Hover miniatura de colección: `transform: translateY(-6px)`, transición `.12s`
- Foco de teclado (a implementar en el codebase): contorno de 2px `#8dff62` con offset 2px.
  El prototipo es de ratón; **añade navegación por teclado/gamepad al implementar.**

### Animaciones

```css
@keyframes glowPulse {  /* Pokémon activo propio, 2.6s ease-in-out infinite */
  0%,100% { box-shadow: 0 0 0 1px #8dff62, 0 0 18px rgba(141,255,98,.45); }
  50%     { box-shadow: 0 0 0 1px #8dff62, 0 0 34px rgba(141,255,98,.85); }
}
@keyframes sheen {      /* brillo que barre sobres y banner, 2.8–3.6s ease-in-out infinite */
  0%   { transform: translateX(-140%) skewX(-18deg); }
  100% { transform: translateX(240%)  skewX(-18deg); }
}
@keyframes bob {        /* sobre sin abrir, 3s ease-in-out infinite */
  0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); }
}
@keyframes blink {      /* LED de fase y aviso «TOCAR PARA ABRIR», 1.4–1.5s steps(1,end) infinite */
  0%,49% { opacity: 1; } 50%,100% { opacity: .25; }
}
@keyframes holo {       /* foil de carta holográfica, 3.4s linear infinite */
  0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; }
}
```

El elemento de brillo (`sheen`) es un hijo absoluto de 120–130px de ancho, altura completa,
`background: linear-gradient(120deg, rgba(255,255,255,.16–.28), transparent)`, dentro de un
padre con `overflow: hidden`.

---

## Screens / Views

### 1. Menú principal

**Propósito:** punto de entrada; elegir modo, ver economía y progreso.

**Layout:** una sola capa absoluta sobre el escenario.
- Arte principal: bloque de **1180 × 1080** anclado a `right: 0; top: 0`. Encima, un velo de
  legibilidad `linear-gradient(90deg, #191612 0%, rgba(25,22,18,.92) 22%, rgba(25,22,18,.35) 52%, rgba(25,22,18,0) 78%)`
  y un halo verde `radial-gradient(60% 55% at 74% 52%, rgba(141,255,98,.10) 0%, transparent 70%)`.
- Columna izquierda: `left: 104px; top: 96px; width: 600px`, flex column, `gap: 34px`.
- Barra inferior: alto **96px**, `padding: 0 40px`, fondo
  `linear-gradient(180deg, rgba(11,10,9,0), rgba(11,10,9,.9) 40%)`, borde superior
  `1px rgba(255,255,255,.06)`.
- Tarjeta de jugador: `right: 40px; top: 36px`.

**Componentes:**

*Hueco de logotipo* — placa metálica de **460 × 150**, padding 10px, corte de esquina 14px.
El contenido es material del cliente (`fit: contain`).

*Línea de conjunto* — regla de 34 × 2px en `#e8c46a` + texto `BASE SET · 1998`, Silkscreen
15px, `letter-spacing: .28em`, color `#e8c46a`.

*Bajada* — Pixelify Sans 20px, `line-height: 1.5`, color `#a49785`, `max-width: 440px`.
Texto exacto: «Duelo por turnos contra la CPU. 60 cartas, 6 premios, sin piedad.»

*Ítems de menú* — 5 filas de **560 × 82**, `gap: 12px`, placa metálica con corte de esquina 12px.
Cada fila lleva:
- Barra de acento a la izquierda: 5px de ancho, altura completa,
  `linear-gradient(180deg,#8dff62,#2c8a1c)`, `box-shadow: 0 0 14px rgba(141,255,98,.7)`.
- Cuadro de glifo hundido de 52 × 52, glifo 22px en `#8dff62`.
- Etiqueta Pixelify Sans 27px/700 con `text-shadow: 0 2px 0 rgba(0,0,0,.7)`; subetiqueta
  Silkscreen 11px `.14em` en `#9a8d7c`.
- Chevron `›` 20px en `#6d6155` a la derecha.

Contenido exacto (etiqueta / subetiqueta / glifo / destino):

| Etiqueta | Subetiqueta | Glifo | Destino |
| --- | --- | --- | --- |
| JUGAR | DUELO CONTRA LA CPU | ⚔ | Tablero de duelo |
| MAZOS | CONSTRUIR Y ELEGIR | ▦ | Selección de mazo |
| TIENDA | SOBRES Y CAJAS | ◎ | Tienda |
| MI COLECCIÓN | 69 DE 102 CARTAS | ▤ | Mi colección |
| CONFIGURACIÓN | AUDIO, VÍDEO, PARTIDA | ⚙ | Configuración |

*Tarjeta de jugador* — placa metálica con corte 12px, padding `12px 20px 12px 12px`, gap 14px:
avatar hundido de 48 × 48 (`AVA` 12px `#6d6155`), bloque `JUGADOR` 14px `.1em` +
`ENTRENADOR · NV 12` 10px `.12em` `#9a8d7c`, separador vertical de 1px × 38px, moneda de 20px
(círculo dorado con `inset 0 1px 0 rgba(255,255,255,.6)` y halo
`0 0 10px rgba(232,196,106,.5)`) y la cifra `150` 16px en `#e8c46a`.

*Barra inferior* — a la izquierda `v1.0 · OVERGROWTH vs BLACKOUT` 11px `.16em` `#6d6155`;
al centro la **fila de los 7 tipos** (fichas de 52 × 52, `border-radius: 50%`, padding 3px,
placa metálica, icono al 100%); a la derecha `CERRAR SESIÓN` como botón secundario.

---

### 2. Selección de mazo

**Propósito:** elegir el mazo activo y revisar su composición antes de duelar.

**Layout:** cabecera de **84px** + cuerpo en dos columnas (`gap: 28px`,
`padding: 32px 40px 40px`): izquierda fija **480px**, derecha flexible.

**Cabecera** (patrón compartido por Mazos, Tienda, Colección y Configuración):
`linear-gradient(180deg,#2c2721,#17140f)`, borde inferior `1px #0b0907`,
`box-shadow: 0 4px 14px rgba(0,0,0,.5)`, `padding: 0 40px`, `gap: 22px`. Contiene el botón
`◀ VOLVER` (secundario, `padding: 12px 18px`, 12px `.14em`), el título Pixelify Sans 30px/700,
un espaciador y metadatos a la derecha (`3 MAZOS · 60/60 CARTAS`, 12px `.14em` `#9a8d7c`).

**Columna izquierda** — 3 tarjetas de mazo de **150px** de alto, placa metálica con corte 12px,
padding 16px, gap 18px:
- Franja de color de 12px a la izquierda con halo del mismo color.
- Carta destacada de 82 × 114, trama diagonal `#1c1915`/`#141210`, texto `CARTA DEST.` 9px.
- Nombre Pixelify Sans 24px/700; tipos 11px `.1em` `#9a8d7c`; fila de estadísticas 11px `.1em`:
  victorias en `#8dff62`, derrotas en `#ff6a5a`, recuento en `#6d6155`.
- Insignia `EN USO` (solo el activo): `right: 14px; top: 14px`, texto 10px `.14em` `#0d2a06`
  sobre `#8dff62`, `padding: 5px 9px`, halo `0 0 16px rgba(141,255,98,.6)`.

Datos: `OVERGROWTH` PLANTA · AGUA, 12 V / 4 D, `#62c23c` · `BLACKOUT` RAYO · INCOLORO,
8 V / 7 D, `#e8c46a` · `BRUSHFIRE` FUEGO · LUCHA, 5 V / 9 D, `#e0452a`. Todos 60 cartas.

Debajo, empujado al fondo, el botón primario **COMENZAR DUELO ▶** de 82px, Pixelify Sans
26px/700 `.08em`, corte de esquina 14px, halo `0 0 30px rgba(141,255,98,.35)`.

**Columna derecha** — panel hundido, padding 24px, gap 20px:
- Cabecera: kicker `MAZO SELECCIONADO` 11px `.2em` `#e8c46a` + nombre Pixelify Sans 34px/700;
  a la derecha botones secundarios `EDITAR` y `DUPLICAR` (11px `.12em`, `padding: 11px 16px`).
- Tres barras de composición (`gap: 28px`): etiqueta 11px `.12em` + valor, y barra de 12px de
  alto (hueco con padding 2px, relleno verde con halo). Valores:
  POKÉMON 22 (37%) · ENTRENADOR 16 (27%) · ENERGÍA 22 (37%).
- Fila `ENERGÍAS`: chips con icono de tipo de 22px + recuento 12px. Datos: planta 14, agua 8.
- Rejilla de 60 huecos: `grid-template-columns: repeat(12, 1fr)`, `gap: 9px`,
  `aspect-ratio: 5/7`, trama diagonal sobre uno de cinco tonos rotativos
  (`#2a2a1e · #1f2a2a · #2a1f1f · #26221c · #1c2226`). Hover `scale(1.14)`.

---

### 3. Tablero de duelo

**Propósito:** la pantalla de juego. Es la vista más importante y la que debe respetar
exactamente la disposición del cliente.

**Layout:** barra superior de **62px** + cuerpo `flex: 1` en **cuatro columnas**:

| # | Columna | Ancho | Contenido |
| --- | --- | --- | --- |
| A | Visor de carta | **430px** fijo | Carta a tamaño grande + acciones |
| B | Tablero | flexible | Mano CPU, bancas, activos, mano propia |
| C | Premios y mazos | **260px** fijo | Premios / mazo / descarte de ambos |
| D | Registro | **330px** fijo | Historial de la partida |

Presupuesto vertical del cuerpo (1080 − 62 = **1018px**, sin scroll):
mano CPU **56px** · zona de juego **768px** (flexible) · mano propia **192px**.

**Barra superior** — `linear-gradient(180deg,#2c2721,#17140f)`, borde inferior `1px #0b0907`,
`box-shadow: 0 4px 16px rgba(0,0,0,.6)`, `z-index: 6`, `padding: 0 24px`, `gap: 18px`:
- Botón `◀` de 40 × 38 (secundario).
- Píldora de fase: hueco `#0f0d0b`, LED de 9px `#8dff62` con halo y animación `blink`,
  texto `FASE PRINCIPAL` 12px `.16em` `#8dff62`.
- Centro: placa con chaflán trapezoidal, `TURNO 04` 12px `.16em` `#9a8d7c`, separador de 1px,
  `TU TURNO` Pixelify Sans 22px/700 `#8dff62` con `text-shadow: 0 0 14px rgba(141,255,98,.6)`.
- Derecha: reloj `0:42` 12px `.14em` `#e8c46a` en hueco; botón `✕` de 40 × 38.

**A · Visor de carta** (`width: 430px`, fondo `linear-gradient(90deg,#241f1a,#191612)`,
borde derecho `1px #0b0907`, `box-shadow: 4px 0 18px rgba(0,0,0,.55)`, padding 12px, gap 6px):
- Kicker: cuadrado de 7px `#e8c46a` con halo + `CARTA SELECCIONADA` 11px `.22em` `#a49785`.
- **Marco de carta grande**: placa metálica de **300 × 420**, padding 6px, centrada; dentro, el
  hueco de carta de 288 × 408 con trama y leyenda. Escuadras de registro de 16px en las
  esquinas superior-izquierda e inferior-derecha, `2px solid #e8c46a`.
- Fila de identidad: placa verde (`linear-gradient(180deg,#2a3a26,#172415)`) con corte 10px,
  `padding: 9px 12px`, gap 12px — icono de tipo 26px, nombre Pixelify Sans 24px/700,
  etapa `BÁSICO` 10px `.12em` `#8a7e6f`, HP Pixelify Sans 22px/700 `#8dff62` con el máximo en
  12px `#6d6155`.
- **Panel de ataques** (hueco): cabecera `ATAQUES` 10px `.22em`; cada fila `padding: 8px 11px`,
  gap 11px — columna de coste de 56px con fichas de energía de 24px, nombre 13px `#f6f1e6`,
  descripción 10px `line-height: 1.55–1.7` `#8a7e6f`, daño Pixelify Sans 24px/700 `#8dff62`
  alineado arriba. **Esta es la razón de ser de la columna:** cabe el texto completo de
  habilidades largas sin truncar.
  Contenido: `BOFETÓN` (coste agua, 20, «Sin efecto adicional.») y `GIRO RÁPIDO` (coste agua +
  incoloro, 30, «Lanza una moneda. Si sale cara, este ataque hace 10 puntos de daño más. Si
  sale cruz, Staryu queda confundido al final del turno.»).
- Tres cuadros hundidos iguales (`flex: 1`, `padding: 6px`, gap 5px): `DEBILIDAD` (icono
  planta 22px), `RESISTENCIA` (guion `—` 13px `#4a4239`), `RETIRADA` (icono incoloro 22px).
  Etiquetas 9px `.14em` `#8a7e6f`.
- Espaciador flexible, y luego la **rejilla de acciones** (`repeat(2,1fr)`, `gap: 6px`):
  `ATACAR` primario a dos columnas, 50px, Pixelify Sans 21px/700 · `RETIRADA` y `HABILIDAD`
  secundarios de 40px · `PASAR TURNO ▶` dorado a dos columnas, 40px, 12px `.14em`.
- Pie: placa metálica con avatar de 38px, nombre `DARKSPOON` 13px `#8dff62`, moneda de 17px y
  saldo `300` Pixelify Sans 18px/700 `#e8c46a`. Contorno de foco
  `0 0 0 1px rgba(141,255,98,.2)`.

**B · Tablero** — el fondo es una **mesa en perspectiva**: contenedor con `perspective: 1400px`
y dentro una capa `left:-10%; right:-10%; top:5%; bottom:17%` con
`transform: rotateX(24deg)`, `transform-origin: 50% 100%` y estas capas de fondo:
```
radial-gradient(70% 60% at 50% 50%, rgba(141,255,98,.06), transparent 70%),
repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 92px),
repeating-linear-gradient(0deg,  rgba(255,255,255,.03) 0 1px, transparent 1px 92px),
linear-gradient(180deg, #221e19, #14120f)
```
más `border: 2px solid rgba(255,255,255,.06)` y `box-shadow: inset 0 0 120px rgba(0,0,0,.85)`.
Encima, un velo `linear-gradient(180deg, rgba(11,10,9,.5), transparent 24%, transparent 76%, rgba(11,10,9,.5))`.

Filas, de arriba abajo:

1. **Mano de la CPU** — banda de 56px con `overflow: hidden`. El abanico se posiciona en
   `top: -64px` y se recorta: solo asoman los bordes inferiores de las cartas. Cada dorso mide
   **88 × 123**, `margin-left: -20px` (solape), trama `repeating-linear-gradient(135deg,#3b1f1c 0 6px,#2a1512 6px 12px)`,
   etiqueta `DORSO` 10px `.1em` `#7a4a42` abajo. A la izquierda, la etiqueta `MANO CPU`
   10px `.2em` `#ff8a72` y el contador en una placa roja de 28 × 28, Pixelify Sans 16px/700
   `#ffd9cf`. **Valor mostrado: 5.**
2. **Zona de juego** (`flex: 1`, centrada, `gap: 4px`) con dos adornos absolutos: la **línea
   central** (`left/right: 24px`, 1px, `linear-gradient(90deg, transparent, rgba(232,196,106,.35) 20%, rgba(232,196,106,.35) 80%, transparent)`)
   y un **rombo** central de 9px `#e8c46a` rotado 45° con halo `0 0 12px rgba(232,196,106,.7)`.
   Contiene cuatro filas, todas centradas sobre el mismo eje vertical:
   - **Banca CPU**: 5 huecos de 84px de ancho, `gap: 10px`. Ocupado: carta de **84 × 112** con
     trama, barra de HP de 84 × 6 (relleno rojo) y nombre 10px `#a49785`. Vacío: recuadro
     discontinuo `1px dashed #3a342c` con `BANCA` 10px `#4a4239`.
     Datos: STARYU 100%, MAGIKARP 55%, y tres vacíos.
   - **Activo CPU**: barra de nombre de 200px (placa roja, corte 8px superior-izquierdo)
     con `MACHOP` 11px y `50/50` 11px `#ff8a72`; carta de **116 × 162** con contorno rojo
     `0 0 0 1px rgba(255,138,114,.55), 0 0 22px rgba(255,138,114,.28), 0 8px 20px rgba(0,0,0,.75)`;
     contador de daño circular de 38px en `right/top: -12px`
     (`linear-gradient(180deg,#ff6a5a,#a02012)`, borde `2px #12100d`, cifra Pixelify Sans
     17px/700 blanca); debajo, energías adheridas (icono de 22px + hueco discontinuo de 20px).
   - **Activo propio**: espejo exacto del anterior, invertido en el eje vertical (energías
     arriba, carta al medio, barra de nombre abajo con el corte 8px en la inferior-derecha).
     Carta de 116 × 162 con `animation: glowPulse`. Datos: `WEEDLE` `40/40` en `#8dff62`,
     energía planta + un hueco.
   - **Banca propia**: espejo de la banca CPU (nombre arriba, barra, carta abajo), tramas y
     barras en verde. Datos: BULBASAUR 100%, STARYU 80%, MAGIKARP 100%, dos vacíos.

   Los dos activos quedan **enfrentados a través de la línea central**: es un requisito
   explícito del cliente.
3. **Mano propia** — banda de **192px**, `overflow: hidden`, fondo
   `linear-gradient(180deg, rgba(11,10,9,0), rgba(20,18,15,.92) 32%, #17140f)`, borde superior
   `1px rgba(255,255,255,.06)`. Cabecera: `MANO · 7` 10px `.24em` `#e8c46a` + regla que se
   desvanece. Cartas de **100 × 140**, `gap: 8px`, con el icono de tipo de 20px en
   `left/top: 4px` y el nombre debajo (10px `#a49785`). Hover: `translateY(-20px)` + contorno
   dorado.
   Contenido: BULBASAUR (planta), STARYU (agua), CAMBIO (incoloro), ENERGÍA (planta),
   MAGIKARP (agua), BILL (incoloro), ENERGÍA (agua).

**C · Premios y mazos** (`width: 260px`, `linear-gradient(180deg,#221e19,#191612)`, borde
izquierdo `1px #0b0907`, padding 10px, gap 8px). Simétrica respecto al centro: bloque CPU
arriba, espaciador flexible, bloque propio abajo.
- Cabecera de jugador: placa (roja arriba, verde abajo) con avatar de 34px, nombre 13px y LED
  de 9px con halo (`#ff6a5a` / `#8dff62`).
- Fila mazo + descarte: dos cuadros hundidos de padding 6px, cada uno con una carta de
  **58 × 81** (mazo con trama; descarte con recuadro discontinuo) y etiqueta 10px
  (`MAZO 47`, `DESC. 0`).
- Etiqueta `PREMIOS · 6` 9px `.2em` (roja / verde).
- Rejilla de premios: `repeat(2, 58px)`, `gap: 6px`, seis cartas de 58 × 81 con la trama del
  bando correspondiente.

**Esto corrige el defecto que el cliente señaló en su captura:** premios, mazo y activos
comparten ejes; los bloques de ambos jugadores son idénticos y simétricos.

**D · Registro** (`width: 330px`, `linear-gradient(270deg,#221e19,#191612)`, borde izquierdo
`1px #0b0907`, `box-shadow: -4px 0 16px rgba(0,0,0,.5)`, padding 10px): un panel hundido a
altura completa. Cabecera: cuadrado de 7px `#8dff62` con halo + `REGISTRO` 11px `.22em`.
Cuerpo `padding: 10px 12px`, `gap: 7px`; cada línea es `[turno] [texto]`, 11px,
`line-height: 1.5`, con el turno en `#4f4740`.

Contenido exacto (español neutro — **sin voseo**, requisito del cliente):

| Turno | Texto | Color |
| --- | --- | --- |
| T1 | Jugador roba su mano inicial. | `#8a7e6f` |
| T1 | CPU roba su mano inicial (mulligans: 0). | `#8a7e6f` |
| T2 | CPU juega Onix de básico. | `#ff8a72` |
| T2 | CPU juega Staryu a la banca. | `#ff8a72` |
| T3 | Coloca a Squirtle como Activo. | `#8dff62` |
| T3 | Adjunta Energía Agua a Squirtle. | `#8dff62` |
| T4 | CPU ataca con Onix — Lanzarrocas. | `#ff8a72` |
| T4 | Squirtle recibe 20 de daño. | `#e8c46a` |
| T4 | Tu turno. Elige un ataque. | `#efe9dd` |

Convención de color del registro: gris para lo neutro, rojo para acciones de la CPU, verde
para acciones del jugador, oro para daño y eventos de azar.

---

### 4. Tienda

**Propósito:** comprar sobres y cajas con la moneda del juego.

**Layout:** cabecera de 84px (con el saldo a la derecha: hueco con moneda de 22px y cifra
Pixelify Sans 24px/700 `#e8c46a`) + cuerpo `padding: 32px 40px 40px`, `gap: 28px`.

*Banner de oferta* — alto **170px**, `overflow: hidden`,
`background: linear-gradient(90deg,#2a2419,#3a3120 55%,#221e19)`, placa con luz superior.
Lleva el brillo `sheen` de 120px a 3.6s. Contenido: kicker `OFERTA DE LANZAMIENTO` 11px
`.24em` `#e8c46a`; título `CAJA BASE · 12 SOBRES` Pixelify Sans 38px/700; nota
`GARANTIZA 2 HOLOGRÁFICAS` 12px `.1em` `#a49785`; a la derecha precio anterior `720` 13px
`#6d6155` tachado sobre `540` Pixelify Sans 34px/700 `#e8c46a`, y el botón dorado `COMPRAR`
(`padding: 18px 34px`, Pixelify Sans 22px/700).

*Rejilla de sobres* — `repeat(4, 1fr)`, `gap: 22px`. Cada tarjeta es una placa metálica con
corte 14px, padding 18px, gap 14px:
- Visor hundido flexible con halo de color propio
  (`radial-gradient(70% 50% at 50% 30%, <glow>, transparent 70%)`) y, al centro, el arte del
  sobre: `width: 58%`, `aspect-ratio: 2/3`, trama diagonal sobre el color base, leyenda
  `ARTE SOBRE` 9px `#cfc6b6`.
- Nombre Pixelify Sans 22px/700; descripción 10px `.1em` `#9a8d7c` `line-height: 1.6`.
- Pie: moneda de 17px + precio Pixelify Sans 22px/700 `#e8c46a`; botón primario verde `ABRIR`
  (`padding: 12px 20px`, 12px `.1em`) que lleva a la pantalla de apertura.

| Nombre | Descripción | Precio | Base | Halo |
| --- | --- | --- | --- | --- |
| SOBRE BASE | 11 CARTAS + 1 ENERGÍA | 60 | `#3a3120` | `rgba(232,196,106,.16)` |
| SOBRE PLANTA | SESGADO A TIPO PLANTA | 75 | `#243020` | `rgba(98,194,60,.16)` |
| SOBRE FUEGO | SESGADO A TIPO FUEGO | 75 | `#3a2320` | `rgba(224,69,42,.16)` |
| SOBRE HOLO | 1 HOLOGRÁFICA GARANTIZADA | 180 | `#2a2438` | `rgba(163,95,214,.18)` |

---

### 5. Apertura de sobre

**Propósito:** el momento de recompensa. Dos estados en la misma pantalla.

Fondo propio: `radial-gradient(70% 60% at 50% 44%, #2a2418 0%, #141210 55%, #080807 100%)`.
Cabecera ligera (sin placa): botón `◀ TIENDA` + título `SOBRE BASE SET` Pixelify Sans 26px/700.

**Estado A — cerrado.** Centrado, `gap: 38px`:
- Sobre de **330 × 470**, `overflow: hidden`, `cursor: pointer`, `animation: bob 3s`,
  fondo `repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 8px, transparent 8px 16px), linear-gradient(160deg,#4a3f1f,#2a2318 60%,#3a3120)`,
  borde `2px #0a0806`, `box-shadow: 0 24px 60px rgba(0,0,0,.8), inset 0 2px 0 rgba(255,255,255,.2)`.
  Lleva el brillo `sheen` de 130px a 2.8s y la leyenda `ARTE DEL SOBRE / 330 × 470`.
- Aviso `TOCAR PARA ABRIR` 14px `.28em` `#e8c46a` con `animation: blink 1.5s`.

**Estado B — abierto.** Centrado, `gap: 44px`:
- Título `10 CARTAS NUEVAS` Pixelify Sans 34px/700 + subtítulo
  `1 HOLOGRÁFICA · 3 INFRECUENTES` 11px `.24em` `#e8c46a`.
- Fila de 10 cartas de **142 × 198**, `gap: 14px`, hover `translateY(-14px)`. Etiqueta de
  rareza debajo, 9px `.14em`.
  - Común (índices 0–5): sombra normal, etiqueta `COMÚN` `#6d6155`.
  - Infrecuente (6–8): etiqueta `INFRECUENTE` `#8dff62`.
  - Holográfica (9): sombra
    `0 0 0 1px #e8c46a, 0 0 30px rgba(232,196,106,.55), 0 8px 18px rgba(0,0,0,.7)`, etiqueta
    `HOLOGRÁFICA` `#e8c46a`, **y una capa de foil** superpuesta:
    `linear-gradient(115deg, rgba(255,120,220,.28), rgba(120,220,255,.28), rgba(255,240,120,.28), rgba(160,255,140,.28), rgba(255,120,220,.28))`
    con `background-size: 200% 100%`, `animation: holo 3.4s linear infinite`,
    `mix-blend-mode: screen`, `pointer-events: none`.
- Acciones: primario `AÑADIR A LA COLECCIÓN` (`padding: 19px 40px`, Pixelify Sans 22px/700) y
  secundario `ABRIR OTRO` (`padding: 19px 34px`, 13px `.12em`), que vuelve al estado A.

**Al implementar**, esta pantalla pide una secuencia real: rasgado del sobre, cartas que se
revelan una a una (voltear al hacer clic), y un realce sonoro/visual en la holográfica. El
prototipo muestra los dos extremos, no la coreografía intermedia.

---

### 6. Mi colección

**Propósito:** ver el progreso del set y filtrar cartas.

**Layout:** cabecera de 84px + cuerpo en dos columnas (`gap: 26px`,
`padding: 28px 40px 34px`): izquierda fija **290px**, derecha flexible.

Cabecera, a la derecha: `BASE SET` 11px `.16em` `#9a8d7c`, barra de progreso de 280 × 14
(hueco con relleno verde al 68%) y la cifra `69/102` — `69` en Pixelify Sans 22px/700
`#8dff62`, `/102` en 14px `#6d6155`.

**Panel de filtros** (izquierda, `gap: 22px`):
- `BUSCAR` — etiqueta 10px `.22em` `#e8c46a` + campo hundido de 46px con placeholder
  `NOMBRE DE CARTA…` 12px `#5c5348`.
- `TIPO` — rejilla envolvente de 7 botones de **56 × 56** (placa metálica, icono de 34px,
  hover `brightness(1.4)`), `gap: 9px`.
- `RAREZA` — 4 filas de `padding: 12px 14px` (placa metálica plana), nombre 11px `.1em`
  `#d6cbb9` y recuento a la derecha: COMÚN 44/48 `#8dff62` · INFRECUENTE 19/32 `#8dff62` ·
  RARA 5/16 `#e8c46a` · HOLOGRÁFICA 1/6 `#ff8a72`.
- Espaciador, y al fondo un panel hundido: `DUPLICADAS` 10px `.2em` `#8a7e6f`, cifra `41`
  Pixelify Sans 28px/700 `#e8c46a`, nota «Canjeables por monedas en la tienda.» 10px
  `line-height: 1.7` `#6d6155`.

**Rejilla de cartas** (derecha, panel hundido de padding 20px):
`repeat(8, 1fr)`, `gap: 16px`, `aspect-ratio: 5/7`, hover `translateY(-6px)`.
- Poseída: opacidad 1, etiqueta `#6d6155`, e insignia de recuento en `right/bottom: -5px`
  (mín. 24px de ancho, 24px de alto, `padding: 0 5px`, texto 11px `#0d2a06` sobre `#8dff62`,
  borde `2px #12100d`).
- No poseída: opacidad `.42`, etiqueta `#3a342c`, y velo `rgba(8,8,7,.66)` con un `?` de 16px
  `#4a4239`.
- Debajo, el número de la carta: `001/102`, 9px `.06em` `#8a7e6f`, centrado.
- Regla de datos del prototipo: se poseen todas menos las de índice `i % 5 === 3`; el recuento
  es `1 + (i % 4)`.

---

### 7. Configuración

**Propósito:** audio, partida, vídeo y cuenta.

**Layout:** cabecera de 84px + rejilla `repeat(2, 1fr)`, `gap: 26px`,
`padding: 34px 40px 40px`, `align-content: start`. Cuatro paneles: los dos primeros son placas
metálicas con corte 14px y padding 26px; los dos últimos, paneles hundidos con padding 26px.

**Panel AUDIO** (kicker: regla de 26 × 2px `#8dff62` + `AUDIO` 12px `.24em` `#8dff62`) — tres
deslizadores. Cada uno: fila de etiqueta 12px `.1em` `#d6cbb9` + valor `#8dff62`; carril
hundido de 26px con padding 3px, relleno verde con halo `0 0 12px rgba(141,255,98,.45)` al
ancho porcentual, y un **tirador** de 16 × 34 en `top: -4px`, `margin-left: -8px`
(`linear-gradient(180deg,#6d6155,#2a251f)`, borde `1px #0a0806`,
`inset 0 1px 0 rgba(255,255,255,.4), 0 3px 7px rgba(0,0,0,.7)`).
Valores iniciales: MÚSICA 70, EFECTOS 85, VOZ 45. Se fija por clic en el carril
(`pct = (clientX − rect.left) / rect.width`, redondeado, acotado a 0–100).

**Panel PARTIDA** (kicker en `#e8c46a`):
- `VELOCIDAD DE LA CPU` — control segmentado en un hueco con padding 3px: tres opciones de
  44px (`LENTA`, `NORMAL`, `RÁPIDA`), 11px `.12em`. La activa lleva el degradado verde,
  texto `#0d2a06` y `inset 0 1px 0 rgba(255,255,255,.45)`; las inactivas, fondo transparente
  y texto `#8a7e6f`. Por defecto: **NORMAL**.
- Cuatro conmutadores, cada uno `padding: 13px 0` con borde inferior `1px rgba(0,0,0,.4)`:
  etiqueta 12px `.08em` `#d6cbb9` + nota 9px `#8a7e6f`; a la derecha, la pista de **76 × 32**
  (hueco, padding 3px) con un tirador de 34px de ancho que cambia de lado
  (`justify-content: flex-end` encendido / `flex-start` apagado) y de color (degradado verde /
  `linear-gradient(180deg,#6d6155,#2a251f)`).

  | Etiqueta | Nota | Por defecto |
  | --- | --- | --- |
  | ANIMACIONES DE ATAQUE | DESACTIVAR ACELERA LOS TURNOS | encendido |
  | PASAR TURNO AUTOMÁTICO | AL QUEDARSE SIN ACCIONES | apagado |
  | CONFIRMAR ATAQUES | PIDE CONFIRMACIÓN ANTES DE ATACAR | encendido |
  | REGISTRO EXTENDIDO | MUESTRA TIRADAS DE MONEDA | encendido |

**Panel VÍDEO** — `VÍDEO` 12px `.24em` `#9a8d7c` + dos desplegables (huecos de 44px,
`min-width: 180px`, texto 12px `#d6cbb9` con un `▾` `#6d6155`): `RESOLUCIÓN` = `1920 × 1080`,
`MODO` = `PANTALLA COMPLETA`. *En el prototipo no abren; impleméntalos como `select` real.*

**Panel CUENTA** — avatar de 56px, nombre `JUGADOR` 14px `.08em`, estado
`SESIÓN INICIADA · NV 12` 10px `#8a7e6f`; y dos botones de 50px:
`CAMBIAR NOMBRE` (secundario) y `BORRAR DATOS` (destructivo).

---

## Interactions & Behavior

### Navegación

Una sola pantalla visible a la vez, conmutada por `screen`:

```
menu ──▶ duel          (JUGAR)
     ──▶ decks         (MAZOS)      ──▶ duel   (COMENZAR DUELO)
     ──▶ shop          (TIENDA)     ──▶ pack   (ABRIR)  ──▶ collection (AÑADIR)
     ──▶ collection    (MI COLECCIÓN)
     ──▶ settings      (CONFIGURACIÓN)
```
Todas las pantallas menos el menú tienen `◀ VOLVER` al menú. El tablero usa `◀` (volver) y `✕`
(que en el prototipo abre Configuración; en producción debería ser «abandonar partida» con
confirmación). La apertura de sobre vuelve a la tienda.

### Estados no cubiertos por el prototipo

Impleméntalos siguiendo el mismo lenguaje visual:
- **Carga:** pantalla de carga entre menú y duelo (barra hundida con relleno verde).
- **Fin de partida:** victoria / derrota, con recuento de premios.
- **Error:** compra sin saldo suficiente (usa la variante destructiva).
- **Vacío:** mazo incompleto (<60 cartas) al intentar duelar; colección filtrada sin resultados.
- **Validación:** el botón `COMENZAR DUELO` debe deshabilitarse (opacidad ~45%, sin hover) si
  el mazo no es legal.
- **Confirmación:** `BORRAR DATOS` y `ATACAR` (cuando `CONFIRMAR ATAQUES` está activo)
  necesitan un diálogo modal.

### Transiciones

Todas las transiciones del prototipo son cortas y mecánicas: `.10s`–`.14s`, sin curva
declarada (por defecto `ease`). Las animaciones ambientales usan `ease-in-out` (`bob`,
`sheen`, `glowPulse`), `linear` (`holo`) y `steps(1, end)` (`blink`, para que parpadee como un
LED y no se desvanezca).

### Accesibilidad y entrada

El prototipo asume ratón. Al implementar, añade:
- Navegación por teclado y gamepad (D-pad) con un cursor de selección visible.
- Anillo de foco: 2px `#8dff62`, offset 2px.
- El texto de 10px es el mínimo del sistema y ya está al límite; no lo reduzcas al portar.

---

## State Management

Estado del prototipo (todo local, sin datos remotos):

| Variable | Tipo | Inicial | Notas |
| --- | --- | --- | --- |
| `screen` | enum | `'menu'` | `menu · decks · duel · shop · pack · collection · settings` |
| `deck` | int | `0` | Índice del mazo activo (0–2) |
| `packOpen` | bool | `false` | Estado A/B de la apertura de sobre |
| `vol` | `{musica, efectos, voz}` | `{70, 85, 45}` | 0–100 |
| `speed` | int | `1` | 0 lenta · 1 normal · 2 rápida |
| `flags` | `{animaciones, autopase, confirmar, registro}` | `{true, false, true, true}` | Conmutadores de partida |

Transiciones: los ítems de menú y botones de navegación fijan `screen`; las tarjetas de mazo
fijan `deck`; el sobre alterna `packOpen`; los deslizadores calculan el porcentaje desde la
posición del clic; el segmentado fija `speed`; los conmutadores invierten su bandera.

**Lo que falta para un juego real** (fuera del alcance del prototipo, pero que la UI ya prevé):
el estado de partida (mano, banca, activos, premios, mazo, descarte, energías adheridas, daño,
turno, fase, temporizador), el motor de reglas y la IA de la CPU, la colección persistida, el
saldo de monedas y el inventario de sobres. Los datos que aparecen en pantalla son fijos y
sirven de contrato: ese es el conjunto de campos que la UI necesita recibir.

---

## Assets

### Iconos de tipo — `tipos/*.png`

Siete PNG cuadrados con transparencia, recortados del PNG que aportó el cliente y encuadrados
en un círculo: `planta · fuego · agua · rayo · psiquico · lucha · incoloro`
(~164 px de lado, listos para mostrarse a 20–34px). Se muestran siempre con
`border-radius: 50%` y `display: block`.

**Procedencia:** los recortó el diseñador a partir de la hoja que subió el cliente. La octava
casilla de esa hoja era una firma y se excluyó deliberadamente. Se usan tal cual en las cinco
zonas donde aparece un tipo: barra del menú, chips de energía del mazo, filtros de la
colección, marca de esquina en las cartas de la mano y costes de ataque / energías adheridas
en el tablero.

**Al implementar**, considera pasarlos a SVG o a un atlas de sprites: son elementos de
interfaz repetidos y se benefician del escalado nítido.

### Fuentes

Google Fonts: `Pixelify Sans` (variable 400..700) y `Silkscreen` (400, 700). En un juego
empaquetado, vendorízalas en lugar de cargarlas por CDN.

### Huecos por rellenar (material del cliente)

| Hueco | Tamaño | Dónde |
| --- | --- | --- |
| Arte principal | 1180 × 1080 (recorte `cover`) | Menú, mitad derecha |
| Logotipo | 460 × 150 (`contain`) | Menú, arriba a la izquierda |
| Arte de sobre (tienda) | proporción 2:3 | Cuatro tarjetas de la tienda |
| Arte de sobre (apertura) | 330 × 470 | Sobre cerrado |
| Cartas | ver medidas por zona | Todas las pantallas |

**No hay logotipo diseñado en este paquete.** Los elementos de marca de Pokémon son propiedad
de The Pokémon Company y no se reprodujeron; usa el arte propio del proyecto.

### Cartas — medidas por zona

| Zona | Tamaño | Proporción |
| --- | --- | --- |
| Visor (columna A) | 288 × 408 | ≈ 5:7 |
| Activo (tablero) | 116 × 162 | ≈ 5:7 |
| Banca (tablero) | 84 × 112 | 3:4 |
| Mano propia | 100 × 140 | ≈ 5:7 |
| Mano CPU (dorso) | 88 × 123 | ≈ 5:7 |
| Premios / mazo / descarte | 58 × 81 | ≈ 5:7 |
| Apertura de sobre | 142 × 198 | ≈ 5:7 |
| Rejilla de colección | `aspect-ratio: 5/7` | 5:7 |
| Rejilla de mazo (60) | `aspect-ratio: 5/7` | 5:7 |
| Carta destacada de mazo | 82 × 114 | ≈ 5:7 |

La proporción canónica es **5:7**; solo la banca del tablero se aparta (3:4) para ganar altura
vertical. Trama del marcador de posición:
`repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 6px, transparent 6px 12px)` sobre el
color de relleno (5px/10px en las cartas pequeñas).

---

## Files

| Archivo | Qué es |
| --- | --- |
| `Shell del Juego.dc.html` | Las siete pantallas, en un solo archivo. Ábrelo en el navegador. |
| `tipos/*.png` | Los siete iconos de tipo (ver *Assets*). |
| `image-slot.js` | Componente auxiliar del prototipo para los huecos de imagen arrastrables. **No lo portes**: es solo para poder probar el arte en el prototipo. |
| `support.js` | Runtime del prototipo (plantillas y lógica). **No lo portes.** |

Cómo leer `Shell del Juego.dc.html`: siete bloques separados por comentarios
`<!-- ==== NOMBRE ==== -->`, uno por pantalla, en el orden de este documento. Los estilos van
en línea; lo único global es el bloque `<style>` de la cabecera (resets, `@keyframes` y colores
de enlace). La clase de lógica al final del archivo contiene el estado y los datos de ejemplo
tabulados arriba.

---

## Nota sobre el sistema de diseño

Este proyecto tiene vinculado el sistema de diseño **Broadsheet** (serif de periódico sobre
papel, acentos cian y magenta, sin cajas ni reglas). La dirección visual aquí descrita —
consola 32-bit, metal cálido, tipografía bitmap, verde fósforo — es **incompatible** con
Broadsheet, y responde a una decisión explícita del cliente para este producto. El shell
mantiene su propia identidad; los tokens de este documento son la fuente de verdad para
implementarlo. Si el codebase destino ya usa Broadsheet para otras superficies (web,
marketing), trata este shell como un tema aparte, no como una desviación a corregir.
