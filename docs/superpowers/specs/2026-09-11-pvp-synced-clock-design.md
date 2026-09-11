# Synced Chess-Clock Timers in PVP — Design

Date: 2026-09-11
Status: Approved by user, pending implementation plan
Depends on: `2026-09-09-partykit-pvp-migration-design.md` (the PartyKit
transport this builds on — `party/index.js`'s `runAction`/`redactedFor`
pattern is extended here, not replaced) and `2026-09-10-pvp-special-attacks-design.md`
(the most recent extension of that same room class, same conventions).
Supersedes: the PVP smoke-test fix that hides `#boardClock` for the
duration of a PVP match (`ui.js`'s `enterPvpMatch`) — a stopgap because
the clock never actually ticked in PVP at all (a static, wrong-font
display was judged worse than nothing). This spec makes it real instead.

## 1. Purpose

Local-vs-CPU play already has a working chess clock: `rules-engine.js`'s
`tickClock`/`DEFAULT_TIME_BANK_MS` (10 minutes per side) and
`getWinner()`'s own rule that a side whose `timeBankMs` reaches 0 loses.
PVP has never ticked this at all — `state.players[side].timeBankMs` sits
frozen at its starting value for the whole match, and the client never
even receives it (`redactMatchState` doesn't expose it). This spec makes
PVP's clock real and server-authoritative: each side's remaining time
actually counts down during their own turn, is visible to both players
for both sides, and running out is a real loss — exactly like local play,
using the exact same underlying rule.

## 2. Goals

- Both players see two separate, always-visible clocks on the board — the
  viewer's own remaining time and their rival's — updating live, using
  the same pixel-glyph font local play's own clock already uses
  (`pixelDigitsHtml`).
- Only the side whose turn it currently is has their clock actually
  ticking; the other side's stays frozen at its banked value — exactly
  the model local play's own single clock already uses, just shown as two
  simultaneous displays instead of one that switches ownership.
- Running out of time is a real loss, server-authoritative: two clients'
  local clocks are never trusted to agree with each other, so the
  server is the sole source of truth for whether a side has actually run
  out.
- `tickClock`/`getWinner` (`rules-engine.js`) are reused verbatim — this
  spec is a transport/timing concern, not a new game rule.

## 3. Non-Goals

- Pokémon Powers, real surrender, and (already shipped) special-effect
  attacks are separate, already-scoped projects — untouched here.
- No change to local-vs-CPU play's own clock — `tickGameClock`/
  `startGameClock`/`stopGameClock` and the single `#boardClock` element
  keep working exactly as they do today for that mode.
- No mid-match time-bank adjustments (increments, "add 30 seconds",
  tournament-style delays) — out of scope; each side simply starts with
  `DEFAULT_TIME_BANK_MS` and it only ever counts down.

## 4. Architecture: timestamp-anchored, computed lazily

PartyKit Durable Objects only run in response to a real message — there's
no free-running server-side timer. Rather than introduce one (PartyKit's
alarm API, `room.storage.setAlarm`, is real but is new, unproven
infrastructure for this project and adds real complexity: scheduling,
rescheduling on every turn change, and reconciling a race between an
alarm firing and a real action arriving at nearly the same moment), this
spec anchors elapsed time to a single timestamp and computes the current
remaining time on demand — the same shape every other piece of ephemeral,
non-deterministic state in this room already uses (e.g. `rng`, kept
outside `state` itself, per `rules-engine.js`'s own established
convention that wall-clock concerns don't belong in the pure game-state
object).

- `this.turnStartedAt` (a new field on the `Server` instance, not
  `state`): set to `Date.now()` whenever a turn actually begins — at
  match start (`engineStartMatch`) and at every real turn handoff
  (`endTurn`, `confirmEndTurn` — the exact two places that already flip
  `activePlayerId`, per the special-attacks plan's own deferred-turn-end
  work).
- At every turn handoff, before flipping to the new active side, the
  server commits the just-finished side's real elapsed time using the
  existing `tickClock(state, endingSide, Date.now() - this.turnStartedAt)`
  — no new function, reused exactly as local play's own
  `ui.js`-side polling already calls it.
- `redactedFor` gains `turnStartedAt: this.turnStartedAt` in its public
  payload (a plain server timestamp — safe to expose to both sides, it's
  not hidden information) alongside the already-present
  `state.players[side].timeBankMs` for both sides (also not currently
  exposed — `redactMatchState` needs one line added: `timeBank: {
  player1: p.timeBankMs, player2: c.timeBankMs }`, mirroring
  `deckCount`'s existing per-side shape). The client computes the *live*
  remaining time itself: `banked - (Date.now() - turnStartedAt)` for
  whichever side is `activePlayerId`, and just `banked` for the other —
  same "client ticks locally between snapshots, corrected by each new
  one" idiom local play's own `tickGameClock`/`renderClocks` already use,
  just reading from the network instead of local `gameState`.
- **Enforcement**: `runAction` gains one check, before its existing
  turn-gate: if the real elapsed time since `turnStartedAt` would already
  drop the active side's `timeBankMs` to 0 or below, commit that via
  `tickClock` right there (so `getWinner()` — already called inside
  `redactedFor` via `redactMatchState`, unchanged — sees the real
  zeroed-out value) before doing anything else. This piggybacks on
  whatever real action arrives next from *either* side; a legitimate
  action from the side that just ran out is itself naturally still
  rejected afterward by the existing turn-gate/`canAttack`/etc, now
  correctly because the match is already over, not because of a
  coincidental race.
- **Closing the "both sides go silent" gap**: the check above only fires
  when *some* action arrives. If both players' clients are simply idle
  when a clock would hit 0, nothing triggers it server-side on its own.
  Each client already computes its own live countdown (previous bullet)
  — the moment either viewer's own local computation shows 0 for
  *either* side, that client sends a new, minimal `{type:
  'claimTimeout'}` action. `party/index.js` handles it by running the
  exact same "commit real elapsed time, let `getWinner()` decide"
  check described above — if time genuinely ran out, the match ends for
  real; if the claim was early (client clock drift), it's a harmless
  no-op (nothing changes, `getWinner()` still returns null). No new trust
  is extended to the client: the server always re-derives the real
  elapsed time from `turnStartedAt` itself, never from anything the
  client claims about *how much* time passed.
- **Reconnects**: `turnStartedAt` is anchored to real time, not to any
  connection being open — a disconnected player's own turn keeps
  counting down against them exactly as it should (closing the app
  can't pause the clock), and reconnecting just resumes receiving the
  same live-computed value. No special-case handling needed.

## 5. Client wiring

`sideHeaderHtml(ownerId)` (`ui.js`) — already rendering each side's
avatar/name/turn-LED — gains a clock element per side, right in that same
header, using `pixelDigitsHtml`/the same rendering approach
`renderClockDisplay` already establishes (same font, same
warning-color-under-30-seconds behavior already built for local play).
Two new elements replace the single shared `#boardClock` for the duration
of a PVP match (unhidden for local play exactly as today; PVP never
touches `#boardClock` itself). A `pvpClockTickInterval` (mirroring local
play's own `CLOCK_TICK_MS`/`clockIntervalId` naming) drives a lightweight
re-render of just the two clock displays between real snapshots, reading
the live-computed value described in Section 4; reset/cleared alongside
every other per-match PVP state in `enterPvpMatch`/`resetPvpMatchState`.
The `claimTimeout` send (Section 4) is wired into that same tick: if the
locally-computed remaining time for either side is ≤ 0 and this client
hasn't already sent one for the current turn, send it once (a boolean
guard, reset on every real turn handoff the client observes, prevents
spamming the server every tick while both sides sit at 0 waiting for a
snapshot to catch up).

## 6. Testing

Same WebSocket-driven pattern the other `party/test/*.test.js` files
already establish, in a new `party/test/clock.test.js`. New scenarios: a
real match's `redactedFor` payload carries both sides' `timeBankMs` and
`turnStartedAt` to both viewers; ending a turn (via `endTurn`) commits
real elapsed wall-clock time into the ending side's `timeBankMs` (checked
with a tolerance, since real network latency means this can't be checked
for an exact millisecond value); a plain action from the *other* side
does not affect the currently-frozen side's own banked time; a timeout is
enforced for real and ends the match with the correct winner — since no
test should wait 10 real minutes, this needs a deterministic way to
start a match with a tiny time bank, most naturally as an identity-level
test override mirroring the already-established `customDeckCards`
mechanism (`party/index.js`'s `onConnect`), e.g. a `testTimeBankMs`
field honored the same way, present only when a test identity sets it.

`node run-tests.js` (739 tests) stays green — this spec adds new
`redactedFor` fields and one new action type, but changes no existing
function's legality/effect logic; `tickClock`/`getWinner` are reused
exactly as they already exist.

## 7. Open questions / explicitly deferred

- Whether `DEFAULT_TIME_BANK_MS` (10 minutes) should ever be
  user-configurable for PVP (e.g. a "blitz" room option) — not
  requested, not in scope; every match uses the same fixed default real
  players will actually get, same as local play today.
- Pokémon Powers and real surrender remain their own, separately-scoped
  follow-up projects (see this session's own brainstorming history) —
  not touched here.
