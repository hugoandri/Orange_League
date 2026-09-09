# Migrar el transporte de PVP a PartyKit — Design

Date: 2026-09-09
Status: Approved by user, pending implementation plan
Depends on: `2026-08-27-pvp-fase1-design.md` (the Firestore + Cloud
Functions PVP this replaces)
Supersedes: the entire transport layer of that spec (rooms/matches
Firestore collections, `createRoom`/`joinRoom`/`setReady`/
`submitMatchAction`). The rules/redaction logic it introduced —
`rules-engine.js`'s `createGame`/`submitRpsChoice`/`startMatch`/
`redactMatchState`/the generic turn-loop functions — is NOT replaced;
this spec relocates where it runs, unchanged.

## 1. Purpose

The Firestore + Cloud Functions v2 PVP transport (Fase 1 spec) has a
structural delay problem: every single action (place a card, attach
Energy, attack, end turn) is an `onCall` RPC — client → Cloud Function
→ Firestore transaction → response → a *separate* `onSnapshot` round
trip before the board re-renders. Two rounds of patching (pre-warming
the 4 PVP functions on menu-open, batching the extra Firestore reads
`attachFoilTiers` added) measurably helped the worst case (cold start
at match start: ~3.4s → near-instant) but the per-action network floor
(realistically 300ms–1s even warm) and the risk of a fresh cold start
after a long thinking-pause mid-match remain inherent to the
architecture.

This spec replaces that transport with PartyKit (Cloudflare Workers /
Durable Objects, one room per match, WebSocket). A Durable Object holds
the match's live state in memory and pushes each side's redacted view
directly over the open socket the instant a move resolves — no
Cloud Function invocation and no Firestore round trip on the hot path
at all, which removes the delay at its root instead of mitigating it.

There are no real players using PVP today, so this is a direct cutover
with no feature flag and no parallel-running legacy path — simpler to
build and reason about than maintaining two transports at once.

## 2. Goals

- Every PVP action (RPS choice, place a Basic, evolve, attach Energy,
  retreat, end turn, take a prize, choose a new Active, a vanilla
  attack) resolves with no Cloud Function call and no Firestore round
  trip — a WebSocket message in, a WebSocket message out.
- Matchmaking (create/join a room by code, pick a deck/protector,
  ready up) also moves into PartyKit — the room *is* the match from
  creation through the final winner, one Durable Object for its whole
  lifetime.
- Hidden information (each side's real hand contents, the
  not-yet-revealed RPS choice, un-taken prize identities) is exactly as
  protected as it is today: never present in any message the other
  socket receives, not just hidden in the UI.
- Every already-shipped anti-cheat/validation guarantee survives
  unchanged: a claimed protector must be owned (`resolveCardBackId`'s
  logic), a card's foil tier reflects the real account's real
  collection (`foilTierForCard`'s logic), a move is rejected server-side
  exactly as `submitMatchAction`'s switch/guards reject it today.
- `rules-engine.js` keeps being the single source of truth for game
  logic, imported directly by the PartyKit room (not a third synced
  copy) exactly the same way `ui.js` already imports it in the browser.
- Local-vs-CPU play is completely unaffected (it already never touches
  any PVP transport).
- `createRoom`, `joinRoom`, `setReady`, `submitMatchAction`,
  `cleanupExpiredRooms`, and the `rooms`/`matches` Firestore
  collections + their security rules are deleted, not kept alongside as
  dead code.

## 3. Non-Goals (this spec)

- Anything Fase 2 already deferred (special-effect attacks/Trainers/
  Powers), rematch flow, spectating, chat, real server-enforced turn
  clocks. Unchanged scope from the Fase 1 spec, just relocated.
- A feature flag or gradual rollout — direct cutover only (Section 1).
- Any change to the economy/account backend (coins, collection,
  boosters, custom decks, profile) — all of that stays exactly where it
  is today, in Firestore + its existing Cloud Functions.
- Changing how `awardMatchResult` is invoked — the client already calls
  it once it observes `gameState.winner`; that boundary is untouched.
- A Workers-native (no Cloud Functions at all) identity/Firestore path
  — considered and explicitly rejected in favor of the hybrid approach
  below (Section 5), to avoid building and debugging JWT verification
  and service-account-signed Firestore REST calls from a Workers
  runtime, none of which exist in this codebase today.
- Trusting the client's own claim of its equipped protector or foil
  tier at connect time with no server validation — considered and
  rejected, since it would reopen the exact cheating gap
  `resolveCardBackId`/`foilTierForCard` were built to close.

## 4. Repo structure and sharing rules-engine.js

```
tcg-simulador/
├── rules-engine.js               ← unchanged, single source of truth
├── ui.js, economy.js, index.html ← client: WebSocket to PartyKit for
│                                     live match state; Firestore only
│                                     for account/economy (unchanged)
├── functions/
│   └── index.js                  ← createRoom/joinRoom/setReady/
│                                     submitMatchAction DELETED;
│                                     cleanupExpiredRooms DELETED;
│                                     one new function: resolvePvpIdentity
└── party/                        ← new PartyKit project
    ├── partykit.json
    └── src/server.js              ← imports rules-engine.js directly
```

`party/src/server.js` imports `createGame`, `submitRpsChoice`,
`startMatch`, `canPlayBasic`/`playBasic`, `canEvolve`/`evolve`,
`canAttachEnergy`/`attachEnergy`, `canRetreat`/`retreat`, `endTurn`,
`drawForTurnStart`, `takePrize`, `chooseNewActive`, `canAttack`/
`attack`, `redactMatchState` straight from `../../rules-engine.js` —
PartyKit's esbuild-based bundler resolves this at deploy time, so
there is exactly one copy of this file in the whole repo (today there
are two: the root file and `functions/lib/rulesEngine.js`, kept in
sync by `functions/scripts/sync-shared-engine.js`; that sync script and
the `functions/lib/` copy are deleted along with the Cloud Functions
that used them). `CARD_STATS`/`DECKLISTS`/`PRECON_DECK_KEYS`/
`ATTACK_EFFECTS`/`TRAINER_EFFECTS`/`POKEMON_POWER_EFFECTS` are bound
onto `globalThis` before that import, the same pattern
`functions/index.js` already uses for the Node side today (Workers
supports `globalThis` the same way).

## 5. Identity, profile, and economy data: the hybrid approach

PartyKit rooms run on Cloudflare Workers, which cannot run the
Firebase Admin SDK (it needs Node's gRPC/`fs`/etc.). Two ways to give
the room trustworthy identity/profile/collection data were considered:

- **Workers-native**: verify the Firebase ID token against Google's
  public JWKS directly in the Worker, and read/write Firestore via its
  REST API with a service-account-signed OAuth token, also from the
  Worker. Rejected for this migration — real new infrastructure (JWT
  verification, service-account JWT signing for Firestore REST) that
  doesn't exist anywhere in this codebase, with its own sharp edges,
  for a hobby project with no pressing need for zero Firebase
  involvement.
- **Hybrid (chosen)**: keep one small Cloud Function,
  `resolvePvpIdentity({idToken, deckId, cardBackId})`, that reuses the
  *exact* existing Node/Admin-SDK logic (`validateDeckId`,
  `resolveCardBackId`, `fetchProfile`, `fetchDeckCoverName`, plus a
  fetch of `collectionHolo`/`collectionSecret` for the foil-tier logic)
  and returns `{uid, username, photo, deckKey, deckCoverName,
  cardBackId, collectionHolo, collectionSecret}` in one call. The
  PartyKit room calls this **once per socket, on connect** — not once
  per action — and caches the result in the Durable Object's memory
  for the rest of the match.

Because it's cached from connect onward, `attachFoilTiers`-equivalent
logic inside the room costs zero extra network calls per move (today
it costs 2 batched Firestore reads per move). Accepted trade-off: if a
player opens a booster or buys a protector *during* an active match,
the room won't see the change until they reconnect — an edge case that
doesn't matter in practice.

## 6. Matchmaking

Creating a room: the client generates the same random 6-character room
code as today and connects to `wss://<partykit-host>/parties/main/{code}`.
PartyKit creates the Durable Object on first connection — there's no
separate `createRoom` call. The room's `onConnect` calls
`resolvePvpIdentity`; the first socket to connect becomes host, is
recorded with a `createdAt` timestamp.

Joining: the second player connects to the same code. If no host is
recorded yet, the room rejects with "ese código no existe" (mirrors
today's not-found). If `Date.now() - createdAt > ROOM_EXPIRY_MS` and no
guest ever joined, the room rejects with "ese código venció" — same
window as today (`ROOM_EXPIRY_MS`), just checked in-object instead of
by a cron (`cleanupExpiredRooms` is deleted, nothing replaces it —
an abandoned room with no live connections is simply left for
Cloudflare's own Durable Object eviction).

Ready-up: each connected socket sends `{type: 'setReady'}`; the room
tracks this as plain in-memory booleans (no Firestore `hostReady`/
`guestReady` fields). Once both are connected and ready, the room calls
`createGame(Math.random, hostDeckKey, {player: true, cpu: true},
guestDeckKey)` exactly as `setReady` does today, sets `state.phase =
'rps'`, and starts pushing redacted views.

## 7. Live state and actions

Every move the client used to send via `submitMatchActionCloud` is now
a WebSocket message: `{type: 'action', action: {...}}` with the exact
same `action.type`/payload shapes as today
(`placeActive`/`placeBench`/`confirmSetup`/`evolve`/`attachEnergy`/
`retreat`/`endTurn`/`attack`/`takePrize`/`chooseActive`/
`submitRpsChoice`). The room's message handler runs the *same*
switch-case body `submitMatchAction` has today (same `TURN_GATED_ACTIONS`
guard, same per-case legality checks calling into `rules-engine.js`),
mutating the Durable Object's own in-memory `state` directly. No
Firestore transaction is needed for move-vs-move safety: PartyKit
already processes one message at a time per room, so there's no way
for two actions on the same match to race each other — a stronger
guarantee than today's transaction-based one, for free.

After a mutation, the room computes `redactMatchState(state, hostUid,
guestUid)` plus the same foil-tier attachment (now reading from the
cached `resolvePvpIdentity` results instead of a fresh Firestore read),
and sends each connected socket **its own** tailored payload directly
(`socket.send(...)`) — never a broadcast to both. This is the actual
fix: no Cloud Function, no Firestore, just an in-memory mutation and a
direct push over an already-open connection.

The room persists `state` to its own PartyKit storage after each
mutation (same null-out-`rng`-before-persisting /
reattach-`Math.random`-on-load pattern used for Firestore today), so a
hibernated/evicted Durable Object can rehydrate. A socket that drops
and reconnects (re-verified via `resolvePvpIdentity`) is immediately
sent its current redacted view, the same as a fresh `onSnapshot` would
have delivered.

## 8. End of match

Unchanged: when `state.winner` resolves, it's included in the normal
redacted push like any other field. The client (no changes here) sees
`gameState.winner` and calls `awardMatchResult` itself, exactly as it
does today — this boundary was already client-initiated and doesn't
need to move.

## 9. Testing

`functions/test/pvpRoom.test.js` and `pvpMatch.test.js` (which drive
`firebase emulators:exec` + `httpsCallable` against the old
`createRoom`/`joinRoom`/`setReady`/`submitMatchAction`) are deleted and
replaced by an equivalent suite that runs PartyKit's local dev server
(`partykit dev`) and drives it with real WebSocket clients (`ws` or
`partysocket`), asserting the same properties the old suite did: a
rival's hand never appears in the other side's payload, an
out-of-turn action is rejected with the same message, `confirmSetup`
requires both sides to have placed an Active, a KO'd side's foil tier
reflects their real collection, etc. — same scenarios, new transport.

`resolvePvpIdentity` is tested the ordinary way, same
`firebase emulators:exec --only auth,firestore,functions` pattern
already used for the other Cloud Functions.

`node run-tests.js` (the 739 pure `rules-engine.js` tests) is
unaffected — this migration touches transport, not game logic.

## 10. Open questions / explicitly deferred

- Exact PartyKit/Cloudflare account setup and `party/partykit.json`
  config (region, any resource limits) — implementation-plan detail,
  not a design decision.
- Whether `npx partykit deploy` gets folded into a single deploy script
  alongside `firebase deploy --project default`, or stays a separate
  manual step — implementation-plan detail.
- Real server-enforced turn clocks via PartyKit's alarm API
  (`room.storage.setAlarm`) — `timeBankMs` exists in `rules-engine.js`'s
  state already but isn't enforced server-side in Fase 1 PVP either;
  out of scope here too, unchanged from the spec this replaces.
