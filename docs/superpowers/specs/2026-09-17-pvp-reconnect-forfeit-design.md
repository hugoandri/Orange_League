# PVP Reconnect & Forfeit ("Duelo en Vivo") — Design

Date: 2026-09-17
Status: Approved by user, pending implementation plan
Depends on: `2026-09-09-partykit-pvp-migration-design.md` (the PartyKit
transport this builds on — `party/index.js`'s `onConnect`/`runAction`/
`redactedFor`, and the `{type:'action', reqId, action}` protocol).
Supersedes: `ui.js`'s pause-menu `pauseSurrender` handler's current PVP
guard — `alert('Rendirse todavía no está disponible en partidas PVP
(próximamente).')` — and the pause menu's silent "SALIR AL MENÚ" exit
during a live PVP match.

## 1. Purpose

Today, if a player's PC freezes or their internet drops mid-duel, they
lose all access to that match. There is no client-side memory of "I'm in
an active match" (nothing is persisted anywhere), no way to signal to the
server "I'm giving up" (PVP surrender is hard-blocked), and no way for the
other player to see anything happened beyond the existing chess-clock
timeout eventually running out (which requires their own browser to still
be open and running to even notice).

This is a genuinely new subsystem — it was explicitly named as a
follow-up ("real forfeit/surrender is a separate, already-identified
follow-up project") in `2026-09-13-pvp-pokemon-powers-design.md`'s
Non-Goals. This spec is that follow-up.

This spec was split out of a bundled two-part request; the second part,
"Historial de Batallas" (a persistent list of past match results), is
unrelated and out of scope here — it gets its own spec later.

## 2. Goals

- A player who ends up back at the main menu while a match is still
  live (crash, dead internet, closed tab/browser, any device) sees a
  prominent "DUELO EN VIVO" button and can reconnect straight back into
  that match — from any device where they log in with the same account.
- From that same button, a player can instead explicitly give up
  ("No" in the confirm modal), immediately ending the match with a
  forfeit — the opponent doesn't have to wait out the chess clock.
- The opponent's win modal specifically says "Tu rival te ha cedido la
  victoria" when the win came from a forfeit, distinguishing it from an
  ordinary win.
- The existing pause menu's silent "SALIR AL MENÚ" escape (leaves a live
  PVP match without telling the server anything) is removed. The only
  intentional way to leave a live PVP duel becomes the pause menu's
  "RENDIRSE" button, which becomes real in PVP (today it's alert-blocked)
  and sends the same forfeit action as the "No" path above.

## 3. Non-Goals

- No change to how a match is *discovered/joined* in the first place
  (matchmaking, room codes, RPS) — untouched.
- No visual "your opponent is disconnected" indicator on the *other*
  player's screen while someone is away. The existing chess-clock timeout
  remains the only automatic fallback if the away player never comes
  back and never forfeits either; this spec adds a faster, voluntary path
  (forfeit) alongside it, not a replacement for it.
- No change to local (vs. CPU) play's pause menu — "SALIR AL MENÚ" and
  "RENDIRSE" keep working exactly as they do today outside PVP.
- Historial de Batallas (battle history) — separate spec.

## 4. Architecture

### 4.1 The active-match directory (Firestore, server-authoritative)

PartyKit rooms are addressed only by room code — there is no existing way
to ask "which room is uid X currently in?" from a device that never saw
that room code. A small Firestore-backed directory closes this gap,
written by the server (the only party that authoritatively knows when a
match starts and ends), not by the client.

- New Firestore collection: `activeMatches/{uid}` → `{ roomCode }`.
- New Cloud Function `registerActiveMatch` (`onRequest`, same shape as
  the existing `resolvePvpIdentity`): called by `party/index.js` from
  inside `startMatch()` — the function already invoked both when a fresh
  match begins (`'setReady'`'s `justStarted` branch) and on a rematch
  (`'rematch'`'s `rematchStarted` branch) — once for `this.info.hostUid`
  and once for `this.info.guestUid`. A rematch reuses the same room code,
  so calling this again on rematch is naturally idempotent (same value
  written again).
- New Cloud Function `clearActiveMatch` (`onRequest`, same shape): called
  by `party/index.js` the first time it observes the match has ended —
  win, loss, timeout, or the new forfeit (§4.2) — for both uids. Guarded
  by a one-shot flag on the Server instance (same pattern as the client's
  own `pvpMatchEnded`/`pvpClaimedTimeoutFor` guards), reset in
  `startMatch()`, so it fires exactly once per match.
- Both of these are called from the PartyKit backend itself, not with a
  freshly-issued player token, so they're authenticated with a shared
  secret (`PARTY_INTERNAL_SECRET`) checked against `req.body.secret`,
  passed to the party the same way `RESOLVE_IDENTITY_URL` already is
  (via `room.env`, overridable for tests). Without this, any caller could
  point another player's directory entry at an arbitrary room code.
- Both calls are **best-effort**: a network failure talking to Firestore
  must never block a match from starting or ending. Fire the HTTP
  request, log/ignore a failure, move on — the same spirit as the
  client's existing `awardMatchResultCloud(...).catch(...)` calls.
- New Cloud Function `getActiveMatch` (`onCall`, same shape as the
  existing `awardMatchResult`/`updateProfile`/etc. — auth handled
  automatically via the caller's Firebase Auth context, no manual token
  passing): looks up `activeMatches/{context.auth.uid}` and returns
  `{ roomCode }` or `{ roomCode: null }`. Called by the client
  (`economy.js`, alongside the other `httpsCallable` wrappers) once, when
  the main menu loads.

### 4.2 Forfeit becomes a real, always-available action

- `getWinner()` (`rules-engine.js`) gains one new check, in the same
  style and position as the existing `deckedOut` check right next to it:
  ```javascript
  if (state.forfeitedBy === 'player') { return 'cpu'; }
  if (state.forfeitedBy === 'cpu') { return 'player'; }
  ```
  Checked unconditionally (not gated on `state.phase === 'playing'`), so
  a forfeit ends the match cleanly even during RPS or setup.
- A new `'forfeit'` case in `party/index.js`'s `runAction` sets
  `this.state.forfeitedBy = side`. It is deliberately **not** added to
  `TURN_GATED_ACTIONS`, and is added to the `turnEndPendingSide` exemption
  array alongside `confirmEndTurn`/`takePrize`/`chooseActive`/
  `claimTimeout` — a player can always forfeit, whether or not it's their
  turn, and whether or not they owe a turn-end confirmation.
- `redactMatchState` gains one new public field, `forfeitedBy` (mapped to
  `'player1'`/`'player2'` exactly like the existing `winner` field, using
  the same ternary shape), so the client can distinguish a forfeit win
  from every other kind of win.

### 4.3 Client: pause menu (`ui.js`)

- The pause menu's "🏠 SALIR AL MENÚ" button (`pauseExit`) is hidden
  during a live PVP match (any phase from RPS through playing) — it
  keeps working unchanged for local play.
- The pause menu's "RENDIRSE" button (`pauseSurrender`) drops its PVP
  guard. In PVP it's moved to the end of the pause menu's option list,
  and on confirmation (reusing the existing `surrenderModal`, with PVP
  copy) calls `submitMatchActionCloud(pvpActiveMatchId, { type: 'forfeit' })`
  instead of the local-play code path.

### 4.4 Client: the "DUELO EN VIVO" banner (`ui.js` + `economy.js`)

- On main-menu load, call `getActiveMatchCloud()` (new `economy.js`
  wrapper around the `getActiveMatch` `httpsCallable`). If it returns a
  `roomCode`, show a prominent button at the top of the main menu:
  "⚔️ DUELO EN VIVO".
- Pressing it opens a confirm modal: "¿Quieres volver al duelo?" /
  Sí / No.
  - **Sí**: opens the existing PVP socket (`openPvpSocket`) against that
    `roomCode` with the existing reconnect protocol (`onConnect` already
    recognizes a returning `hostUid`/`guestUid` on a `'started'` room and
    resumes them straight into the live match via `sendMatchTo` — no
    server change needed here) and enters the duel screen. Elapsed wall-
    clock time is not refunded; the chess clock was never paused.
  - **No**: opens the same socket just long enough to send
    `{ type: 'forfeit' }`, then returns to the main menu. This is the
    same underlying action the pause menu's "RENDIRSE" now sends.
- If the stored `roomCode` turns out to be stale (the match already ended
  while the player was away, the room expired, etc.), the socket-open or
  the action attempt fails cleanly with an error the existing
  `.catch(alert)` pattern already surfaces — no special handling needed
  beyond what every other PVP action call site already does.

### 4.5 Client: win/loss modal (`ui.js`)

- `finishMatch(winner)` reads `pub.forfeitedBy` (available on
  `pvpLatestPub`, the same object `tickPvpClocks` already reads from).
  If the winner is `'player'` (i.e., you won) and `forfeitedBy` names
  your opponent's side, the modal's text becomes "Tu rival te ha cedido
  la victoria" instead of "Has Ganado". If you lost (including by your
  own forfeit), the modal keeps saying "Has Perdido" unchanged — no
  special-cased losing message.

## 5. Data Flow Summary

1. Match starts (`startMatch()`) → party registers both uids in the
   Firestore directory (best-effort, fire-and-forget).
2. Player's browser dies. Server still thinks they're connected (no
   `onClose` handling exists or is needed — the directory doesn't care
   about socket liveness, only "is there a match for this uid").
3. Player opens the app later, possibly on a different device. Main menu
   calls `getActiveMatch` → gets the `roomCode` back → shows the banner.
4. Player taps the banner → Sí/No:
   - Sí → reconnects via the existing `onConnect` resume path.
   - No → sends `'forfeit'` → `state.forfeitedBy` set → `getWinner()`
     resolves in the opponent's favor → party clears both directory
     entries (one-shot, on first observing the match has a winner).
5. Opponent's next snapshot shows `pub.winner` in their favor and
   `pub.forfeitedBy` naming the player who gave up → their win modal
   shows the forfeit-specific message.

## 6. Testing

New `party/test/forfeit.test.js` (same shape as `attack.test.js`/
`power.test.js`): drives the real WebSocket action API against a local
PartyKit dev server, with the existing local identity-resolution stub
extended to also fake `registerActiveMatch`/`clearActiveMatch`/
`getActiveMatch` in memory (tracked by uid), so the whole flow is
testable without touching real Firebase. Scenarios:

- A match starting registers both uids in the fake directory; a normal
  win clears both.
- `'forfeit'` sent by either side (a) during RPS/setup, (b) mid-game on
  the sender's own turn, (c) mid-game NOT on the sender's turn, (d) while
  a `turnEndPendingSide` confirmation is owed — all four immediately
  resolve `getWinner()` in the other side's favor, and the directory is
  cleared for both uids.
- Both sides receive `forfeitedBy` naming the same side on their next
  snapshot.
- A stale/nonexistent `roomCode` returned by the directory fails to
  reconnect with a clean error, not a crash (simulated by tearing down a
  room after registering it, matching how `attack.test.js`/etc. already
  simulate error paths).

`node run-tests.js` (739 tests) is expected to stay exactly 739/739 —
this only adds new exports/fields and one new `runAction` case, touching
no existing game-rule logic.
