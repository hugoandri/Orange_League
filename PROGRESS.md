# Simulador Pokémon TCG — Bitácora del proyecto

## De qué trata

Un simulador de un jugador, en el navegador, de las reglas **originales
(1998-99)** del Pokémon Trading Card Game. Se juega abriendo `index.html`
directamente (sin servidor, sin instalación, sin build): vos jugás el mazo
temático de Base Set **Overgrowth** contra una CPU que juega **Blackout**.

Ganar una partida da monedas virtuales, que se pueden gastar en sobres
virtuales (Base, Jungle o Fossil) cuyo contenido se suma a una colección
persistente. Es un proyecto personal, sin build, sin dependencias externas
y sin repositorio remoto.

## Estado actual

- **155/155 tests pasando** (`node run-tests.js`), cubriendo el motor de
  reglas, los efectos de cartas, la IA y 20 partidas simuladas CPU-vs-CPU
  de punta a punta.
- Partida jugable de principio a fin: colocar Pokémon iniciales, tirar la
  moneda, atacar, evolucionar, retirarse, usar cartas de entrenador, tomar
  premios y terminar la partida (ganar/perder/rendirse).
- Todo el texto visible está en español neutro (sin voseo).
- ~59 commits en `main` desde el MVP inicial hasta hoy.

## Cómo está armado

Scripts planos (`<script src>`, sin módulos ES — bloqueados por CORS al
abrir por `file://`), cargados en orden de dependencia:

```
data-*.js       datos estáticos de cartas/mazos/sets
rules-engine.js estado del juego + funciones de acción puras (sin DOM)
card-effects.js efectos de ataques y de cartas de entrenador
ai.js           lógica heurística de la CPU
economy.js      monedas, compra de sobres, colección (localStorage)
ui.js           el único archivo que toca el DOM
```

Ver `README.md` para instrucciones de juego y de tests.

## Historial de avances

### 1. Motor de juego (MVP)
Motor de reglas completo y libre de DOM: mano inicial con mulligan,
banca/activo, evolución (con la regla de "esperar un turno"), energías,
ataques con daño/debilidad/resistencia, condiciones especiales
(Envenenado, Paralizado, Dormido, Quemado, Confundido), retiro, premios,
knockouts y condición de victoria. Los 9 efectos de cartas de entrenador y
los efectos de ataque de las 17 especies de ambos mazos. IA heurística
para la CPU. Economía de monedas + sobres + colección con persistencia en
`localStorage`. Batería de tests en Node (`vm` sandbox) y en navegador.

### 2. Interfaz de juego inicial
Tablero jugable: ilustraciones reales de cartas (con zoom), fase de
preparación antes de tirar la moneda, colocación de banca por click,
layout sin scroll de página completa ("app-shell"), música de fondo.

### 3. Traducción completa al español
Todo el juego (log, ataques, cartas, mensajes de error, botones) traducido
a español, manteniendo los datos de las cartas (`CARD_STATS`) intactos en
inglés como fuente de verdad y agregando diccionarios de traducción solo
para la capa de presentación.

### 4. Rediseño del flujo de turnos
Varias iteraciones hasta llegar al comportamiento actual: atacar termina
tu turno pero **no** le pasa el turno a la CPU hasta que presionás
"Terminar turno" explícitamente (para poder revisar el resultado de tu
ataque); un solo click de "Terminar turno" siempre resuelve el turno
completo de la CPU, sin necesitar un segundo click. Además, la regla de
época: quien empieza la partida también roba carta y puede atacar en el
turno 1 (a diferencia de la regla de torneo posterior).

### 5. Identidad visual y feedback
Fotos de perfil junto a "CPU" y "Tú", luz verde/roja indicando de quién es
el turno, log coloreado por bando (amarillo el mío, naranja el del rival),
línea de log marcando el inicio de cada turno, header con el resultado de
la partida y botón "Rendirse" con confirmación.

### 6. Modales y biblioteca de cartas
Modal para elegir qué energía específica descartar (con ilustraciones) al
retirarse o usar Súper Poción; zoom automático al tomar una carta de
premio; modal de fin de partida ("Has Ganado"/"Has Perdido" con Volver a
jugar/Cancelar); minibiblioteca de cartas en un panel propio (clickeás
cualquier carta, de mano o del tablero, para verla en grande con sus
ataques traducidos) en reemplazo del botón de lupa.

### 7. Mazo y descarte visuales
Pilas de Mazo y Descarte (boca abajo, con su respaldo) junto a la Banca de
cada lado, con la cantidad de cartas; el Descarte se puede abrir en un
modal para ver todo lo descartado en el duelo.

### 8. Ajustes de layout y alineación
Reordenamiento de paneles (minibiblioteca a la izquierda, tablero al
medio, Registro a la derecha), tamaños de banca/premios/mazo/descarte
ajustados para verse parejos y legibles, y corrección de un desalineamiento
de la banca del jugador causado por un side-row sin el mismo ancho de
columna derecha que las demás filas.

## Próximos pasos posibles (no confirmados)

- Más mazos jugables / deck building desde la colección.
- Más efectos de cartas de Jungle/Fossil (hoy solo las ~29 cartas de Base
  Set usadas en Overgrowth/Blackout tienen datos de juego reales; el resto
  del catálogo de las 3 ediciones existe solo como coleccionable).
- Animaciones/sonido más allá de los estados actuales.
