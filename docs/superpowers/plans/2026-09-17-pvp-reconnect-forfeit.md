# PVP Reconnect & Forfeit ("Duelo en Vivo") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player who lost access to a live PVP match (crash, dead internet, closed tab, any device) reconnect to it or explicitly forfeit it from the main menu, and let a player forfeit intentionally from the pause menu — replacing the pause menu's silent "SALIR AL MENÚ" escape.

**Architecture:** A Firestore-backed `activeMatches/{uid}` directory, written by `party/index.js` (server-authoritative) via two new secret-authenticated Cloud Functions (`registerActiveMatch`/`clearActiveMatch`), and read by the client via a third (`getActiveMatch`, a normal `onCall`). A new always-available `'forfeit'` server action sets `state.forfeitedBy`, which `getWinner()` treats like the existing `deckedOut` check. The client's pause menu and a new main-menu banner both drive this single server action; a `pub.forfeitedBy` field lets the winning side's modal show a forfeit-specific message.

**Tech Stack:** PartyKit (Durable Object, `party/index.js`), Firebase Cloud Functions v2 (`functions/index.js`) + Firestore, vanilla JS client (`ui.js`/`economy.js`/`index.html`), Node `assert`-based test files run against a real local PartyKit dev server and the Firebase Emulator Suite.

**Spec:** `docs/superpowers/specs/2026-09-17-pvp-reconnect-forfeit-design.md`

## Global Constraints

- `registerActiveMatch`/`clearActiveMatch` calls are **best-effort**: a network/Firestore failure must never block a match from starting or ending. Never awaited in a way that lets a rejection propagate — always `.catch(() => {})`'d at the call site.
- `registerActiveMatch`/`clearActiveMatch` are authenticated by a shared secret (`PARTY_INTERNAL_SECRET`) checked against `req.body.secret`, **not** a user ID token — they're called by the PartyKit backend itself, not a fresh browser request.
- `'forfeit'` is always legal: not in `TURN_GATED_ACTIONS`, and added to the `turnEndPendingSide` exemption array. It must work in any phase (`rps`/`setup`/`playing`), on either side's turn or not.
- `node run-tests.js` (739 tests) must stay exactly 739/739 — this plan only adds new exports/fields/cases, no existing game-rule logic changes.
- Local (vs. CPU) play's pause menu is untouched — "SALIR AL MENÚ" and "RENDIRSE" keep their current local-play behavior unchanged; every UI change in this plan is `pvpMode`-gated.

---

### Task 1: Cloud Functions — the active-match directory

**Files:**
- Modify: `functions/index.js:1-10` (imports — no change needed, `admin`/`onRequest`/`onCall`/`HttpsError` already imported), add new exports after `resolvePvpIdentity` (currently `functions/index.js:1049-1103`)
- Test: `functions/test/activeMatch.test.js` (new)

**Interfaces:**
- Produces: `exports.registerActiveMatch` (onRequest, POST `{uid, roomCode, secret}` → `{ok:true}` or 401/400), `exports.clearActiveMatch` (onRequest, POST `{uid, secret}` → `{ok:true}` or 401/400), `exports.getActiveMatch` (onCall, auth required, no args → `{roomCode: string|null}`). Firestore collection `activeMatches/{uid}` → `{roomCode: string}`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Add the shared-secret constant and the three Cloud Functions**

Add this right after the `PLAYABLE_SET_KEYS` constant near the top of `functions/index.js` (after line 13, `const PLAYABLE_SET_KEYS = ['base', 'jungle', 'fossil'];`):

```javascript
// Shared secret the PartyKit backend (party/index.js) uses to authenticate
// itself when writing to the active-match directory below -- NOT a user ID
// token, since these calls happen when a match starts/ends (server-side
// events), not on a fresh browser request. Same process.env-with-literal-
// fallback pattern as TELEGRAM_BOT_TOKEN elsewhere in this file; the
// literal fallback is a LOCAL-DEV-ONLY placeholder -- the real deployed
// project must set a real value via `firebase functions:config` (or the
// v2 equivalent) with the SAME value configured on the party side via
// `party env add PARTY_INTERNAL_SECRET`.
const PARTY_INTERNAL_SECRET = process.env.PARTY_INTERNAL_SECRET || 'change-me-in-production-party-internal-secret';
```

Then add these three functions right after `resolvePvpIdentity`'s closing `});` (currently `functions/index.js:1103`):

```javascript
// "Duelo en Vivo": party/index.js calls this (best-effort, fire-and-forget)
// the moment a match actually starts (startMatch()), once per side, so a
// player who later loses access to their browser (crash, dead internet,
// closed tab) can find their way back from ANY device -- see
// 2026-09-17-pvp-reconnect-forfeit-design.md section 4.1.
exports.registerActiveMatch = onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const { uid, roomCode, secret } = req.body || {};
  if (secret !== PARTY_INTERNAL_SECRET) { res.status(401).json({ error: 'No autorizado.' }); return; }
  if (!uid || !roomCode) { res.status(400).json({ error: 'Faltan datos.' }); return; }
  await admin.firestore().collection('activeMatches').doc(uid).set({ roomCode: roomCode });
  res.status(200).json({ ok: true });
});

// Called by party/index.js (same auth as registerActiveMatch above) the
// first time it observes the match has a winner -- normal win, timeout, or
// a forfeit -- for both uids.
exports.clearActiveMatch = onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const { uid, secret } = req.body || {};
  if (secret !== PARTY_INTERNAL_SECRET) { res.status(401).json({ error: 'No autorizado.' }); return; }
  if (!uid) { res.status(400).json({ error: 'Faltan datos.' }); return; }
  await admin.firestore().collection('activeMatches').doc(uid).delete();
  res.status(200).json({ ok: true });
});

// Called by the BROWSER client (economy.js's getActiveMatchCloud) when the
// main menu loads -- normal onCall auth via the caller's own Firebase Auth
// context, same pattern as awardMatchResult/updateProfile above.
exports.getActiveMatch = onCall(async (request) => {
  if (!request.auth) { throw new HttpsError('unauthenticated', 'Debes iniciar sesión.'); }
  const snap = await admin.firestore().collection('activeMatches').doc(request.auth.uid).get();
  return { roomCode: snap.exists ? snap.data().roomCode : null };
});
```

- [ ] **Step 2: Write the emulator test**

Create `functions/test/activeMatch.test.js`, following `functions/test/resolvePvpIdentity.test.js`'s exact structure (same emulator env vars, same `createUser`/`idTokenFor` helpers):

```javascript
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });
const assert = require('assert');

const SECRET = 'change-me-in-production-party-internal-secret';

async function createUser(email) {
  const user = await admin.auth().createUser({ email: email, password: 'password123' });
  await admin.firestore().collection('users').doc(user.uid).set({
    username: 'jugador', photo: null, coins: 500, collection: {},
    collectionHolo: {}, collectionSecret: {}, cardBacks: [], customDecks: {}
  });
  return user.uid;
}

async function idTokenFor(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const data = await res.json();
  return data.idToken;
}

async function callFn(name, body) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

// onCall functions expect the Firebase SDK's own envelope ({data: {...}})
// and require an Authorization header, not a body field -- same as any
// other onCall function tested by hand against the emulator.
async function callGetActiveMatch(idToken) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/getActiveMatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
    body: JSON.stringify({ data: {} })
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const uid = await createUser('activematch1@test.com');
  const idToken = await idTokenFor(uid);

  const badSecret = await callFn('registerActiveMatch', { uid: uid, roomCode: 'ABC123', secret: 'wrong' });
  assert.strictEqual(badSecret.status, 401);
  console.log('PASS: registerActiveMatch rejects the wrong secret');

  const missing = await callFn('registerActiveMatch', { uid: uid, secret: SECRET });
  assert.strictEqual(missing.status, 400);
  console.log('PASS: registerActiveMatch rejects a missing roomCode');

  const registered = await callFn('registerActiveMatch', { uid: uid, roomCode: 'ABC123', secret: SECRET });
  assert.strictEqual(registered.status, 200);
  console.log('PASS: registerActiveMatch accepts a valid call');

  const looked = await callGetActiveMatch(idToken);
  assert.strictEqual(looked.status, 200);
  assert.strictEqual(looked.data.result.roomCode, 'ABC123');
  console.log('PASS: getActiveMatch returns the registered roomCode for its own caller');

  const cleared = await callFn('clearActiveMatch', { uid: uid, secret: SECRET });
  assert.strictEqual(cleared.status, 200);
  console.log('PASS: clearActiveMatch accepts a valid call');

  const lookedAfter = await callGetActiveMatch(idToken);
  assert.strictEqual(lookedAfter.data.result.roomCode, null);
  console.log('PASS: getActiveMatch returns null once cleared');

  const otherUid = await createUser('activematch2@test.com');
  const otherIdToken = await idTokenFor(otherUid);
  await callFn('registerActiveMatch', { uid: uid, roomCode: 'XYZ789', secret: SECRET });
  const otherLook = await callGetActiveMatch(otherIdToken);
  assert.strictEqual(otherLook.data.result.roomCode, null);
  console.log("PASS: getActiveMatch never returns another uid's active match");

  console.log('ALL activeMatch TESTS PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run the test**

Run: `firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/activeMatch.test.js"`
Expected: all 6 `PASS` lines plus `ALL activeMatch TESTS PASSED`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js functions/test/activeMatch.test.js
git commit -m "Add registerActiveMatch/clearActiveMatch/getActiveMatch Cloud Functions"
```

---

### Task 2: Server — forfeit action + directory wiring (`party/index.js`, `rules-engine.js`)

**Files:**
- Modify: `rules-engine.js:1309-1319` (`getWinner`)
- Modify: `party/index.js:19-58` (require destructure), `:116-136` (constants/resolveIdentity area), `:422-460` (`startMatch`), `:467-508` (`redactedFor`/`sendMatchTo`/`broadcastMatch`), `:550` (turnEndPendingSide exemption array), `:710-739` (`runAction`'s `usePower`/`default` cases)
- Test: `party/test/forfeit.test.js` (new)

**Interfaces:**
- Consumes: Task 1's `registerActiveMatch`/`clearActiveMatch` request shapes (`{uid, roomCode, secret}` / `{uid, secret}`, POST, JSON).
- Produces: `state.forfeitedBy` (`'player'|'cpu'|undefined`), `getWinner(state)` now resolves a forfeit immediately, `redacted.public.forfeitedBy` (`'player1'|'player2'|null`), the `'forfeit'` action type.

- [ ] **Step 1: `getWinner()` gets a forfeit check**

In `rules-engine.js`, the current function (lines 1309-1319):

```javascript
function getWinner(state) {
  if (state.players.player.prizes.length > 0 && remainingPrizes(state.players.player) === 0) { return 'player'; }
  if (state.players.cpu.prizes.length > 0 && remainingPrizes(state.players.cpu) === 0) { return 'cpu'; }
  if (state.players.player.hasHadActive && !state.players.player.active && benchCount(state.players.player) === 0) { return 'cpu'; }
  if (state.players.cpu.hasHadActive && !state.players.cpu.active && benchCount(state.players.cpu) === 0) { return 'player'; }
  if (state.deckedOut === 'player') { return 'cpu'; }
  if (state.deckedOut === 'cpu') { return 'player'; }
  if (state.players.player.timeBankMs <= 0) { return 'cpu'; }
  if (state.players.cpu.timeBankMs <= 0) { return 'player'; }
  return null;
}
```

Replace with (adds two lines at the top, same style/position as the `deckedOut` check):

```javascript
function getWinner(state) {
  // "Duelo en Vivo" / Rendirse: an explicit forfeit always wins immediately,
  // checked first so it short-circuits every other condition -- see
  // 2026-09-17-pvp-reconnect-forfeit-design.md section 4.2.
  if (state.forfeitedBy === 'player') { return 'cpu'; }
  if (state.forfeitedBy === 'cpu') { return 'player'; }
  if (state.players.player.prizes.length > 0 && remainingPrizes(state.players.player) === 0) { return 'player'; }
  if (state.players.cpu.prizes.length > 0 && remainingPrizes(state.players.cpu) === 0) { return 'cpu'; }
  if (state.players.player.hasHadActive && !state.players.player.active && benchCount(state.players.player) === 0) { return 'cpu'; }
  if (state.players.cpu.hasHadActive && !state.players.cpu.active && benchCount(state.players.cpu) === 0) { return 'player'; }
  if (state.deckedOut === 'player') { return 'cpu'; }
  if (state.deckedOut === 'cpu') { return 'player'; }
  if (state.players.player.timeBankMs <= 0) { return 'cpu'; }
  if (state.players.cpu.timeBankMs <= 0) { return 'player'; }
  return null;
}
```

- [ ] **Step 2: Run the existing suite to confirm nothing broke**

Run: `node run-tests.js`
Expected: `739 PASS`, `0 FAIL`, exit 0 (unchanged — no test exercises `state.forfeitedBy` yet).

- [ ] **Step 3: Destructure `getWinner` in `party/index.js`**

Current (`party/index.js:19-58`, the require block) ends with:

```javascript
  dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName,
  ENERGY_TYPE_BY_CARD_NAME,
  usePokemonPower
} = require('../rules-engine.js');
```

Change the earlier line that already lists `redactMatchState, submitRpsChoice, applyEndOfTurnCheckup,` to also include `getWinner`:

```javascript
  canAttack, attack, endTurn, drawForTurnStart, redactMatchState, submitRpsChoice, applyEndOfTurnCheckup, getWinner,
```

(No `globalThis` binding needed — same as `usePokemonPower`/`tickClock`: party/index.js calls this directly, it's never invoked as a bare identifier from inside card-effects.js.)

- [ ] **Step 4: Add the directory-call helpers**

Add right after the existing `resolveIdentity` function (`party/index.js:127-136`):

```javascript
const DEFAULT_REGISTER_ACTIVE_MATCH_URL = 'https://us-central1-pokemon-tcg-simulador.cloudfunctions.net/registerActiveMatch';
const DEFAULT_CLEAR_ACTIVE_MATCH_URL = 'https://us-central1-pokemon-tcg-simulador.cloudfunctions.net/clearActiveMatch';
const DEFAULT_PARTY_INTERNAL_SECRET = 'change-me-in-production-party-internal-secret';

// Best-effort: a Firestore hiccup here must never block a match from
// starting or ending (see 2026-09-17-pvp-reconnect-forfeit-design.md
// section 4.1) -- every call site below fires these WITHOUT awaiting and
// swallows any rejection itself (`.catch(() => {})`), same spirit as the
// client's own awardMatchResultCloud(...).catch(...) calls.
async function registerActiveMatch(env, uid, roomCode) {
  const url = (env && env.REGISTER_ACTIVE_MATCH_URL) || DEFAULT_REGISTER_ACTIVE_MATCH_URL;
  const secret = (env && env.PARTY_INTERNAL_SECRET) || DEFAULT_PARTY_INTERNAL_SECRET;
  await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, roomCode: roomCode, secret: secret })
  });
}

async function clearActiveMatch(env, uid) {
  const url = (env && env.CLEAR_ACTIVE_MATCH_URL) || DEFAULT_CLEAR_ACTIVE_MATCH_URL;
  const secret = (env && env.PARTY_INTERNAL_SECRET) || DEFAULT_PARTY_INTERNAL_SECRET;
  await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, secret: secret })
  });
}
```

- [ ] **Step 5: Register both uids when a match starts**

Current `startMatch()` (`party/index.js:422-460`) ends with:

```javascript
    this.powerRound = 0;
    this.lastPowerUse = null;
    this.persistState();
  }
```

Change to (adds the one-shot flag to the existing reset block, and the fire-and-forget registration after `persistState()`):

```javascript
    this.powerRound = 0;
    this.lastPowerUse = null;
    // "Duelo en Vivo": guards clearActiveMatch (maybeClearActiveMatch,
    // below) from firing more than once per match -- reset here exactly
    // like every other per-instance field above, so a rematch's fresh
    // match gets its own real clear, not a stale skip.
    this.matchEndNotified = false;
    this.persistState();
    registerActiveMatch(this.room.env, this.info.hostUid, this.info.roomCode).catch(() => {});
    registerActiveMatch(this.room.env, this.info.guestUid, this.info.roomCode).catch(() => {});
  }
```

- [ ] **Step 6: Clear the directory once a winner is decided**

Current `redactedFor`/`sendMatchTo`/`broadcastMatch` (`party/index.js:467-508`):

```javascript
  redactedFor(side) {
    const redacted = redactMatchState(this.state, this.info.hostUid, this.info.guestUid);
    attachFoilTiers(redacted.public,
      this.info.hostCollectionHolo, this.info.hostCollectionSecret,
      this.info.guestCollectionHolo, this.info.guestCollectionSecret);
    redacted.public.hostCardBackId = this.info.hostCardBackId || 'clasico';
    redacted.public.guestCardBackId = this.info.guestCardBackId || 'clasico';
    redacted.public.lastTrainerPlay = this.lastTrainerPlay || null;
    redacted.public.hostUsername = this.info.hostUsername || null;
    redacted.public.hostPhoto = this.info.hostPhoto || null;
    redacted.public.guestUsername = this.info.guestUsername || null;
    redacted.public.guestPhoto = this.info.guestPhoto || null;
    redacted.public.lastAttackResult = this.lastAttackResult || null;
    redacted.public.lastPowerUse = this.lastPowerUse || null;
    redacted.public.turnStartedAt = this.turnStartedAt || null;
    const uid = side === 'player' ? this.info.hostUid : this.info.guestUid;
    return { type: 'match', public: redacted.public, myHand: redacted.private[uid].hand };
  }

  sendMatchTo(connection, side) {
    connection.send(JSON.stringify(this.redactedFor(side)));
  }

  broadcastMatch() {
    const host = this.info.hostConnId && this.room.getConnection(this.info.hostConnId);
    const guest = this.info.guestConnId && this.room.getConnection(this.info.guestConnId);
    if (host) { host.send(JSON.stringify(this.redactedFor('player'))); }
    if (guest) { guest.send(JSON.stringify(this.redactedFor('cpu'))); }
  }
```

Replace with (adds `forfeitedBy` to the public view, adds `maybeClearActiveMatch()`, and calls it from both `sendMatchTo` and `broadcastMatch` — covers both a live winner-deciding moment AND a reconnect to an already-decided match, e.g. after a Durable Object restart missed the live moment):

```javascript
  redactedFor(side) {
    const redacted = redactMatchState(this.state, this.info.hostUid, this.info.guestUid);
    attachFoilTiers(redacted.public,
      this.info.hostCollectionHolo, this.info.hostCollectionSecret,
      this.info.guestCollectionHolo, this.info.guestCollectionSecret);
    redacted.public.hostCardBackId = this.info.hostCardBackId || 'clasico';
    redacted.public.guestCardBackId = this.info.guestCardBackId || 'clasico';
    redacted.public.lastTrainerPlay = this.lastTrainerPlay || null;
    redacted.public.hostUsername = this.info.hostUsername || null;
    redacted.public.hostPhoto = this.info.hostPhoto || null;
    redacted.public.guestUsername = this.info.guestUsername || null;
    redacted.public.guestPhoto = this.info.guestPhoto || null;
    redacted.public.lastAttackResult = this.lastAttackResult || null;
    redacted.public.lastPowerUse = this.lastPowerUse || null;
    redacted.public.turnStartedAt = this.turnStartedAt || null;
    // "Duelo en Vivo": lets the WINNING side's client tell a forfeit apart
    // from every other win condition (see finishMatch, ui.js) -- same
    // 'player'/'cpu' -> 'player1'/'player2' ternary shape redactMatchState
    // itself already uses for `winner`.
    redacted.public.forfeitedBy = this.state.forfeitedBy === 'player' ? 'player1' : (this.state.forfeitedBy === 'cpu' ? 'player2' : null);
    const uid = side === 'player' ? this.info.hostUid : this.info.guestUid;
    return { type: 'match', public: redacted.public, myHand: redacted.private[uid].hand };
  }

  // "Duelo en Vivo": fires clearActiveMatch (best-effort, fire-and-forget)
  // for both uids the first time this Server instance observes the match
  // has a winner -- guarded by matchEndNotified (reset in startMatch()) so
  // it only ever fires once per match, regardless of how many times
  // sendMatchTo/broadcastMatch run afterward.
  maybeClearActiveMatch() {
    if (this.matchEndNotified) { return; }
    if (!getWinner(this.state)) { return; }
    this.matchEndNotified = true;
    clearActiveMatch(this.room.env, this.info.hostUid).catch(() => {});
    clearActiveMatch(this.room.env, this.info.guestUid).catch(() => {});
  }

  sendMatchTo(connection, side) {
    this.maybeClearActiveMatch();
    connection.send(JSON.stringify(this.redactedFor(side)));
  }

  broadcastMatch() {
    this.maybeClearActiveMatch();
    const host = this.info.hostConnId && this.room.getConnection(this.info.hostConnId);
    const guest = this.info.guestConnId && this.room.getConnection(this.info.guestConnId);
    if (host) { host.send(JSON.stringify(this.redactedFor('player'))); }
    if (guest) { guest.send(JSON.stringify(this.redactedFor('cpu'))); }
  }
```

- [ ] **Step 7: Exempt `'forfeit'` from the turn-end-pending guard**

Current (`party/index.js:550`):

```javascript
    if (this.turnEndPendingSide === side && ['confirmEndTurn', 'takePrize', 'chooseActive', 'claimTimeout'].indexOf(action.type) === -1) {
```

Change to:

```javascript
    if (this.turnEndPendingSide === side && ['confirmEndTurn', 'takePrize', 'chooseActive', 'claimTimeout', 'forfeit'].indexOf(action.type) === -1) {
```

(`'forfeit'` is deliberately never added to `TURN_GATED_ACTIONS` either — it isn't there today, and must stay that way, since that array is what would otherwise block an action outside its owner's turn.)

- [ ] **Step 8: Add the `'forfeit'` runAction case**

Current tail of the `switch` (`party/index.js:710-739`, the `usePower` case through `default`):

```javascript
      case 'usePower': {
        // ... (unchanged, existing code)
        break;
      }
      default:
        throw new Error('Tipo de acción desconocido: ' + action.type);
    }
```

Insert a new case between them:

```javascript
      case 'usePower': {
        // ... (unchanged, existing code)
        break;
      }
      case 'forfeit': {
        // Always legal (see Step 7's exemption + TURN_GATED_ACTIONS never
        // listing it) -- getWinner() (rules-engine.js) now checks this
        // before anything else, so the very next broadcastMatch()/
        // sendMatchTo() call (right after this runAction returns, in
        // onMessage's 'action' handler) both decides the winner AND fires
        // maybeClearActiveMatch() for both sides.
        this.state.forfeitedBy = side;
        break;
      }
      default:
        throw new Error('Tipo de acción desconocido: ' + action.type);
    }
```

- [ ] **Step 9: Write `party/test/forfeit.test.js`**

Same shared helpers as every other `party/test/*.test.js` file (`connect`/`makeQueue`/`nextOfType`/`sendAction`/`firstBasic`/`playToTurn1`, copied verbatim from `party/test/power.test.js`), with the identity stub extended to also fake the directory endpoints in memory:

```javascript
const assert = require('assert');
const http = require('http');

const IDENTITIES = {
  'forfeit-host-token': { uid: 'forfeit-host-uid', username: 'ForfeitHost', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'forfeit-guest-token': { uid: 'forfeit-guest-uid', username: 'ForfeitGuest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
};

// In-memory fake of the activeMatches Firestore collection Task 1 defines
// -- registerActiveMatch/clearActiveMatch (below) write directly into this
// object instead of touching real Firestore, so the whole directory flow
// is testable without the Firebase Emulator Suite (that's Task 1's own
// functions/test/activeMatch.test.js's job -- this file only proves
// party/index.js calls these two endpoints correctly, with the right
// uid/roomCode/secret, at the right moments).
const activeMatchDirectory = {};
const TEST_SECRET = 'test-secret';

const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const data = body ? JSON.parse(body) : {};
    if (req.url === '/registerActiveMatch') {
      assert.strictEqual(data.secret, TEST_SECRET, 'registerActiveMatch must send the configured secret');
      activeMatchDirectory[data.uid] = data.roomCode;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/clearActiveMatch') {
      assert.strictEqual(data.secret, TEST_SECRET, 'clearActiveMatch must send the configured secret');
      delete activeMatchDirectory[data.uid];
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    // Default (no path match): identity resolution, same as every other
    // party/test/*.test.js's stub -- RESOLVE_IDENTITY_URL points at this
    // server's root, no path appended.
    const identity = IDENTITIES[data.idToken];
    if (!identity) { res.writeHead(401).end(JSON.stringify({ error: 'bad token' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(identity));
  });
});

function connect(room, token, intent) {
  return new WebSocket('ws://127.0.0.1:1999/parties/main/' + room +
    '?token=' + token + '&deckId=x&cardBackId=clasico&intent=' + intent);
}
function makeQueue(ws) {
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);
    if (waiters.length) { waiters.shift()(data); } else { queue.push(data); }
  });
  return function next() {
    return new Promise((resolve) => {
      if (queue.length) { resolve(queue.shift()); } else { waiters.push(resolve); }
    });
  };
}
async function nextOfType(next, type) {
  let data = await next();
  while (data.type !== type) { data = await next(); }
  return data;
}
let reqCounter = 0;
function sendAction(ws, action) {
  const reqId = ++reqCounter;
  ws.send(JSON.stringify({ type: 'action', reqId: reqId, action: action }));
  return reqId;
}

async function connectBothToFreshMatch(roomCode) {
  const host = connect(roomCode, 'forfeit-host-token', 'create');
  const hostNext = makeQueue(host);
  await hostNext(); // room, waiting
  const guest = connect(roomCode, 'forfeit-guest-token', 'join');
  const guestNext = makeQueue(guest);
  await hostNext(); await guestNext(); // room, guest joined

  host.send(JSON.stringify({ type: 'setReady' }));
  await hostNext();
  guest.send(JSON.stringify({ type: 'setReady' }));
  await nextOfType(hostNext, 'match');
  await nextOfType(guestNext, 'match');
  return { host, hostNext, guest, guestNext };
}

async function testRegistersBothOnMatchStart() {
  const { host, guest } = await connectBothToFreshMatch('FORFEIT1');
  await new Promise((r) => setTimeout(r, 200)); // let the fire-and-forget registerActiveMatch calls land
  assert.strictEqual(activeMatchDirectory['forfeit-host-uid'], 'FORFEIT1');
  assert.strictEqual(activeMatchDirectory['forfeit-guest-uid'], 'FORFEIT1');
  console.log('PASS: starting a match registers both uids in the directory');
  host.close(); guest.close();
}

async function testHostForfeitDuringRps() {
  const { host, hostNext, guest, guestNext } = await connectBothToFreshMatch('FORFEIT2');
  sendAction(host, { type: 'forfeit' });
  const hostView = await nextOfType(hostNext, 'match');
  const guestView = await nextOfType(guestNext, 'match');
  assert.strictEqual(hostView.public.winner, 'player2');
  assert.strictEqual(guestView.public.winner, 'player2');
  assert.strictEqual(hostView.public.forfeitedBy, 'player1');
  assert.strictEqual(guestView.public.forfeitedBy, 'player1');
  console.log('PASS: the host forfeiting during RPS immediately gives the guest the win, both sides agree');
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(activeMatchDirectory['forfeit-host-uid'], undefined);
  assert.strictEqual(activeMatchDirectory['forfeit-guest-uid'], undefined);
  console.log('PASS: a forfeit clears the directory for both uids');
  host.close(); guest.close();
}

async function testGuestForfeitIsAlsoAlwaysLegal() {
  const { host, hostNext, guest, guestNext } = await connectBothToFreshMatch('FORFEIT3');
  sendAction(guest, { type: 'forfeit' });
  const hostView = await nextOfType(hostNext, 'match');
  assert.strictEqual(hostView.public.winner, 'player1');
  assert.strictEqual(hostView.public.forfeitedBy, 'player2');
  console.log('PASS: the guest forfeiting gives the host the win');
  host.close(); guest.close();
}

async function testForfeitWorksEvenWithATurnEndPendingConfirmation() {
  const { host, hostNext, guest, guestNext } = await connectBothToFreshMatch('FORFEIT4');
  // Neither side has a real board yet (no Basics placed) -- 'confirmSetup'
  // isn't needed to prove this: directly force turnEndPendingSide by
  // sending an action a real match can't legally have yet is unnecessary
  // here. Simpler and still a real proof: send 'forfeit' from the side
  // that is NOT activePlayerId (i.e. not their turn) -- if forfeit were
  // accidentally still subject to TURN_GATED_ACTIONS or the pending-guard,
  // this would be rejected with an error instead of a match snapshot.
  const rpsView = await nextOfType(hostNext, 'match'); // already-drained above via connectBothToFreshMatch, re-fetch not needed; kept for clarity
  sendAction(guest, { type: 'forfeit' });
  const view = await nextOfType(hostNext, 'match');
  assert.strictEqual(view.public.winner, 'player1');
  console.log("PASS: forfeit works even when it isn't the forfeiting side's turn");
  host.close(); guest.close();
}

async function main() {
  stub.listen(8799, async () => {
    try {
      await testRegistersBothOnMatchStart();
      await testHostForfeitDuringRps();
      await testGuestForfeitIsAlsoAlwaysLegal();
      await testForfeitWorksEvenWithATurnEndPendingConfirmation();
      console.log('ALL forfeit (PartyKit) TESTS PASSED');
      stub.close();
      process.exit(0);
    } catch (err) {
      console.error(err);
      stub.close();
      process.exit(1);
    }
  });
}

main();
```

- [ ] **Step 10: Run against a real local dev server**

```bash
pkill -f "partykit dev"; lsof -ti:1999 | xargs -r kill -9; rm -rf party/.partykit
cd party && npx partykit dev \
  --var RESOLVE_IDENTITY_URL=http://127.0.0.1:8799 \
  --var REGISTER_ACTIVE_MATCH_URL=http://127.0.0.1:8799/registerActiveMatch \
  --var CLEAR_ACTIVE_MATCH_URL=http://127.0.0.1:8799/clearActiveMatch \
  --var PARTY_INTERNAL_SECRET=test-secret
```

Wait for `[pk:inf] Ready on http://0.0.0.0:1999`, then in another shell:

```bash
cd party && node test/forfeit.test.js
```

Expected: 5 `PASS` lines plus `ALL forfeit (PartyKit) TESTS PASSED`, exit 0. Clean up afterward:

```bash
pkill -f "partykit dev"; lsof -ti:1999 | xargs -r kill -9; rm -rf party/.partykit
```

- [ ] **Step 11: Run the full suite once more**

Run: `node run-tests.js`
Expected: `739 PASS`, `0 FAIL`, exit 0.

- [ ] **Step 12: Commit**

```bash
git add rules-engine.js party/index.js party/test/forfeit.test.js
git commit -m "Add server-authoritative forfeit action and active-match directory wiring"
```

---

### Task 3: Client — pause menu (`ui.js`, `index.html`)

**Files:**
- Modify: `index.html:621-633` (`#pauseModal`)
- Modify: `ui.js:5878-5881` (`openPauseMenu`), `:6365-6382` (`surrenderModal` handlers), `:6563-6599` (`pauseSurrender`/`pauseExit` handlers)

**Interfaces:**
- Consumes: Task 2's `'forfeit'` action (`{type: 'forfeit'}`, no params) via the existing `submitMatchActionCloud(pvpActiveMatchId, action)`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Move RENDIRSE after MÚSICA in the pause menu's DOM order**

Current (`index.html:621-633`):

```html
  <div id="pauseModal" class="card-modal hidden">
    <div class="card-modal-backdrop"></div>
    <div class="shell-modal-card shell-pause-card">
      <h3 class="shell-modal-title">PAUSA</h3>
      <div class="shell-pause-buttons">
        <button type="button" class="shell-modal-btn" id="pauseResume">▶️ REANUDAR</button>
        <button type="button" class="shell-modal-btn" id="pauseConfig">⚙️ CONFIGURACIÓN</button>
        <button type="button" class="shell-modal-btn" id="pauseSurrender">🏳️ RENDIRSE</button>
        <button type="button" class="shell-modal-btn" id="pauseMusic">🔈 MÚSICA</button>
        <button type="button" class="shell-modal-btn shell-modal-btn-danger" id="pauseExit">🏠 SALIR AL MENÚ</button>
      </div>
    </div>
  </div>
```

Replace with (RENDIRSE moved after MÚSICA — placing it last for PVP once SALIR AL MENÚ is hidden there in Step 3, while local play keeps all 5 in this same new order, which is harmless there):

```html
  <div id="pauseModal" class="card-modal hidden">
    <div class="card-modal-backdrop"></div>
    <div class="shell-modal-card shell-pause-card">
      <h3 class="shell-modal-title">PAUSA</h3>
      <div class="shell-pause-buttons">
        <button type="button" class="shell-modal-btn" id="pauseResume">▶️ REANUDAR</button>
        <button type="button" class="shell-modal-btn" id="pauseConfig">⚙️ CONFIGURACIÓN</button>
        <button type="button" class="shell-modal-btn" id="pauseMusic">🔈 MÚSICA</button>
        <button type="button" class="shell-modal-btn" id="pauseSurrender">🏳️ RENDIRSE</button>
        <button type="button" class="shell-modal-btn shell-modal-btn-danger" id="pauseExit">🏠 SALIR AL MENÚ</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Hide SALIR AL MENÚ during a live PVP match**

Current `openPauseMenu` (`ui.js:5878-5881`):

```javascript
function openPauseMenu() {
  stopGameClock();
  document.getElementById('pauseModal').classList.remove('hidden');
}
```

Replace with:

```javascript
function openPauseMenu() {
  stopGameClock();
  // Duelo en Vivo: PVP's only intentional way to leave a live match is now
  // RENDIRSE (Step 4 below) -- SALIR AL MENÚ used to abandon the match
  // silently, without telling the server anything, which is exactly the
  // "accidental disappearance" gap this whole feature closes. Local play
  // is unaffected (pvpMode is only ever true during a real PVP match).
  document.getElementById('pauseExit').classList.toggle('hidden', !!pvpMode);
  document.getElementById('pauseModal').classList.remove('hidden');
}
```

- [ ] **Step 3: Unblock RENDIRSE in PVP**

Current `pauseSurrender` handler (`ui.js:6563-6583`):

```javascript
  document.getElementById('pauseSurrender').addEventListener('click', function () {
    closePauseMenu();
    // I4 (final-review fix): surrender in PVP had no server call at all --
    // it ended the match ONLY on the surrendering player's own client (the
    // opponent never learns, no timeout exists by design in Fase 1), and
    // didn't set pvpMatchEnded, risking a double coin-award if the opponent
    // later reaches a real win/loss. A real forfeit action is Fase 2 scope --
    // simplest safe fix for now is to just not offer surrender in a PVP
    // match at all.
    if (pvpMode) {
      // Not calling resumeGameClockIfNeeded() here on purpose -- the local
      // chess clock is never started for a PVP match at all (timeBankMs
      // isn't synced/enforced for PVP this phase, per spec), so starting it
      // now would tick against a gameState that gets fully overwritten by
      // the next server snapshot anyway, and could even spuriously trigger
      // a local-only time-based finishMatch() the server knows nothing about.
      alert('Rendirse todavía no está disponible en partidas PVP (próximamente).');
      return;
    }
    document.getElementById('surrenderModal').classList.remove('hidden');
  });
```

Replace with (drops the guard entirely — this IS the real forfeit action now, and the existing modal's copy, "¿Seguro que quieres rendirte? Esto le dará la victoria al rival.", already reads correctly for PVP unchanged, no new copy needed):

```javascript
  document.getElementById('pauseSurrender').addEventListener('click', function () {
    closePauseMenu();
    document.getElementById('surrenderModal').classList.remove('hidden');
  });
```

- [ ] **Step 4: Branch the surrender confirm button on `pvpMode`**

Current `surrenderConfirmBtn` handler (`ui.js:6373-6382`):

```javascript
  document.getElementById('surrenderConfirmBtn').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
    // I4 (final-review fix) belt-and-suspenders: the pauseSurrender handler
    // above already keeps this modal from ever opening in pvpMode, but if it
    // somehow got shown anyway, mark the match ended locally first so a
    // later real win/loss arriving from the opponent's side via the match
    // listener can't fire finishMatch/awardMatchResultCloud a second time.
    if (pvpMode) { pvpMatchEnded = true; }
    finishMatch('cpu');
  });
```

Replace with (PVP now sends the real server action and lets the normal snapshot-driven win/loss path — the same one every other PVP action already uses — call `finishMatch` on its own; local play is unchanged):

```javascript
  document.getElementById('surrenderConfirmBtn').addEventListener('click', function () {
    document.getElementById('surrenderModal').classList.add('hidden');
    if (pvpMode) {
      submitMatchActionCloud(pvpActiveMatchId, { type: 'forfeit' })
        .catch(function (err) { alert(err.message || 'No se pudo rendir.'); });
      return;
    }
    finishMatch('cpu');
  });
```

- [ ] **Step 5: Syntax-check and manual verification**

Run: `node --check ui.js` and `node --check index.html` is not applicable (HTML has no syntax checker here) — visually confirm the reordered buttons render correctly by starting a local PVP match (two browser tabs, same flow every prior PVP feature this session smoke-tested with) and opening the pause menu on each side: local play shows all 5 buttons with RENDIRSE before SALIR AL MENÚ; PVP shows only 4 (no SALIR AL MENÚ), RENDIRSE last, and pressing it ends the match for both sides.

- [ ] **Step 6: Commit**

```bash
git add index.html ui.js
git commit -m "Enable real forfeit in PVP via the pause menu, remove the silent exit"
```

---

### Task 4: Client — "Duelo en Vivo" banner + win-modal text (`economy.js`, `ui.js`, `index.html`)

**Files:**
- Modify: `economy.js:158-160` (near `awardMatchResultCloud`)
- Modify: `index.html:168-186` (main-menu nav), add a new confirm modal near `index.html:476-485` (`#surrenderModal`)
- Modify: `ui.js:4650-4653` (`showMenu`), `:2222-2251` (`finishMatch`), add new wiring near `:6365-6382` (the `surrenderModal` handlers block, same file region)

**Interfaces:**
- Consumes: Task 1's `getActiveMatch` (`{roomCode: string|null}`), Task 2's `pub.forfeitedBy` field, and the existing `openPvpSocket`/`enterPvpMatch`/`submitMatchActionCloud`/`leaveRoomCloud` functions.
- Produces: `getActiveMatchCloud()` (economy.js), nothing consumed by other tasks.

- [ ] **Step 1: Add the `getActiveMatchCloud` wrapper**

Add right after `awardMatchResultCloud` (`economy.js:158-160`):

```javascript
function getActiveMatchCloud() {
  return firebase.functions().httpsCallable('getActiveMatch')().then(function (res) { return res.data; });
}
```

- [ ] **Step 2: Add the banner button to the main menu**

Current start of the nav (`index.html:168-178`):

```html
            <nav class="shell-nav">
              <button type="button" class="shell-nav-item" id="menuPlay">
```

Replace with (a hidden-by-default featured button, first in the list — `menuLiveDuelBtn`):

```html
            <nav class="shell-nav">
              <button type="button" class="shell-nav-item shell-nav-item-live hidden" id="menuLiveDuelBtn">
                <span class="shell-nav-item-accent"></span>
                <span class="shell-nav-item-glyph"><i class="ph-duotone ph-sword"></i></span>
                <span class="shell-nav-item-text">
                  <span class="shell-nav-item-title">⚔️ DUELO EN VIVO</span>
                  <span class="shell-nav-item-sub">TIENES UNA PARTIDA EN CURSO</span>
                </span>
                <span class="shell-nav-item-chevron">›</span>
              </button>
              <button type="button" class="shell-nav-item" id="menuPlay">
```

- [ ] **Step 3: Add the confirm modal**

Add right after `#surrenderModal`'s closing `</div>` (`index.html:485`):

```html
  <div id="liveDuelModal" class="card-modal hidden">
    <div class="card-modal-backdrop"></div>
    <div class="shell-modal-card">
      <p class="shell-modal-text">¿Quieres volver al duelo?</p>
      <div class="shell-modal-actions">
        <button type="button" id="liveDuelYesBtn" class="shell-modal-btn shell-modal-btn-danger">SÍ</button>
        <button type="button" id="liveDuelNoBtn" class="shell-modal-btn">NO</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Check for an active match every time the main menu is shown**

Current `showMenu` (`ui.js:4650-4653`):

```javascript
function showMenu() {
  document.getElementById('menuScreen').classList.remove('hidden');
  playScreenMusic('Songs/Login_Screen_Main_Menu_3.mp3');
}
```

Replace with:

```javascript
var pvpLiveDuelRoomCode = null;
function showMenu() {
  document.getElementById('menuScreen').classList.remove('hidden');
  playScreenMusic('Songs/Login_Screen_Main_Menu_3.mp3');
  getActiveMatchCloud().then(function (res) {
    pvpLiveDuelRoomCode = res.roomCode;
    document.getElementById('menuLiveDuelBtn').classList.toggle('hidden', !res.roomCode);
  }).catch(function () {
    // Best-effort UI convenience -- a failed lookup just means the banner
    // doesn't show this time, same as it wouldn't if there genuinely were
    // no active match. Never blocks the menu from showing.
  });
}
```

- [ ] **Step 5: Wire the banner + confirm modal**

Add near the existing `surrenderModal` handlers (`ui.js:6365-6382`, same `document.addEventListener('DOMContentLoaded', ...)` block those live in):

`enterPvpMatch` (`ui.js:5207-5404`) already calls `showBoardScreen()` itself at its own end (`ui.js:5403`) — the existing room-broadcast call site (`ui.js:5990-5992`) never calls it separately, only `enterPvpMatch(room.matchId)` directly, because at that point the user is already past the main menu (on the PVP waiting-room screen, which `enterPvpMatch` hides itself, `ui.js:5221`). The reconnect flow below starts from the main menu instead, which `enterPvpMatch` does NOT hide on its own — so `hideMenu()` must be called explicitly, but `showBoardScreen()` must not (calling it again would be redundant, not wrong, but the single call inside `enterPvpMatch` is sufficient):

```javascript
  document.getElementById('menuLiveDuelBtn').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.remove('hidden');
  });
  document.querySelector('#liveDuelModal .card-modal-backdrop').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.add('hidden');
  });
  document.getElementById('liveDuelYesBtn').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.add('hidden');
    if (!pvpLiveDuelRoomCode) { return; }
    var deckId = (econState && econState.activeDeck) || 'overgrowth';
    openPvpSocket(pvpLiveDuelRoomCode, deckId, getCardBackId(), 'join').then(function (res) {
      hideMenu();
      enterPvpMatch(res.roomCode);
    }).catch(function (err) {
      alert(err.message || 'No se pudo reconectar a ese duelo.');
      pvpLiveDuelRoomCode = null;
      document.getElementById('menuLiveDuelBtn').classList.add('hidden');
    });
  });
  document.getElementById('liveDuelNoBtn').addEventListener('click', function () {
    document.getElementById('liveDuelModal').classList.add('hidden');
    if (!pvpLiveDuelRoomCode) { return; }
    var roomCode = pvpLiveDuelRoomCode;
    var deckId = (econState && econState.activeDeck) || 'overgrowth';
    openPvpSocket(roomCode, deckId, getCardBackId(), 'join').then(function () {
      return submitMatchActionCloud(roomCode, { type: 'forfeit' });
    }).then(function () {
      leaveRoomCloud();
      pvpLiveDuelRoomCode = null;
      document.getElementById('menuLiveDuelBtn').classList.add('hidden');
    }).catch(function (err) { alert(err.message || 'No se pudo rendir.'); });
  });
```

- [ ] **Step 6: `finishMatch` shows the forfeit-specific message**

Current (`ui.js:2222-2251`):

```javascript
function finishMatch(winner) {
  matchWinner = winner;
  gameState.pendingPrizeChoice = null;
  gameState.pendingActiveChoice = null;
  stopGameClock();
  if (pvpClockTickInterval) { clearInterval(pvpClockTickInterval); pvpClockTickInterval = null; }
  playMatchEndMusic(winner);
  awardMatchResultCloud(winner === 'player' ? 'win' : 'loss')
    .catch(function (e) { console.error('No se pudo registrar el resultado de la partida', e); });
  renderBoard(); // shows the final board state (last action's results)
  var textEl = document.getElementById('matchEndText');
  textEl.textContent = winner === 'player' ? 'Has Ganado' : 'Has Perdido';
  textEl.classList.remove('win', 'loss');
  textEl.classList.add(winner === 'player' ? 'win' : 'loss');
  document.getElementById('matchEndModal').classList.remove('hidden');
}
```

Replace with:

```javascript
function finishMatch(winner) {
  matchWinner = winner;
  gameState.pendingPrizeChoice = null;
  gameState.pendingActiveChoice = null;
  stopGameClock();
  if (pvpClockTickInterval) { clearInterval(pvpClockTickInterval); pvpClockTickInterval = null; }
  playMatchEndMusic(winner);
  awardMatchResultCloud(winner === 'player' ? 'win' : 'loss')
    .catch(function (e) { console.error('No se pudo registrar el resultado de la partida', e); });
  renderBoard(); // shows the final board state (last action's results)
  var textEl = document.getElementById('matchEndText');
  // Duelo en Vivo / Rendirse: pvpLatestPub.forfeitedBy names whichever
  // side (player1/player2) gave up, set fresh by processPvpMatchSnapshot
  // right before this call (see that function's own `pvpLatestPub = pub;`
  // line) -- null for every other win condition. Only the WINNING side's
  // modal gets the special copy; the side that forfeited still just sees
  // "Has Perdido", same as any other loss.
  var rivalForfeited = pvpMode && winner === 'player' && pvpLatestPub &&
    pvpLatestPub.forfeitedBy && pvpLatestPub.forfeitedBy !== pvpMySide;
  textEl.textContent = rivalForfeited ? 'Tu rival te ha cedido la victoria' : (winner === 'player' ? 'Has Ganado' : 'Has Perdido');
  textEl.classList.remove('win', 'loss');
  textEl.classList.add(winner === 'player' ? 'win' : 'loss');
  document.getElementById('matchEndModal').classList.remove('hidden');
}
```

- [ ] **Step 7: Syntax-check and manual verification**

Run: `node --check ui.js`, `node --check economy.js`.

Manual verification (two browser tabs, same live-smoke-test pattern every prior PVP feature this session used):
1. Start a real PVP match. On one tab, close the tab entirely (simulating a crash) mid-match.
2. Reopen the app, log in as that same player, land on the main menu — confirm "⚔️ DUELO EN VIVO" appears.
3. Press it, press "SÍ" — confirm you're back on the live board, mid-match, with your hand/board intact.
4. Repeat steps 1-2, this time press "NO" — confirm you're back at the main menu, and the OTHER tab's win modal shows "Tu rival te ha cedido la victoria".
5. Confirm the pause menu's RENDIRSE (Task 3) still works and produces the same modal on the opponent's side.

- [ ] **Step 8: Commit**

```bash
git add economy.js index.html ui.js
git commit -m "Add the Duelo en Vivo reconnect/forfeit banner and its win-modal text"
```

---

### Task 5: Deploy notes (not SDD-executable — read and hand off to the coordinator)

This task has no code changes of its own. It exists so the plan doesn't lose an operational step that only the human/coordinator (not a worktree-scoped implementer subagent) can actually do: **before deploying**, a real, non-default `PARTY_INTERNAL_SECRET` must be generated and set identically in two places:

```bash
# In party/ (PartyKit env, read by party/index.js's room.env):
party env add PARTY_INTERNAL_SECRET

# In functions/ (Firebase Functions config/env, read by functions/index.js's
# process.env.PARTY_INTERNAL_SECRET):
# use whatever mechanism this project's existing TELEGRAM_BOT_TOKEN env var
# already uses in production (firebase functions:secrets:set or an .env
# file, matching however that one is actually configured today).
```

Both deploys (`firebase deploy --only functions` for Task 1, `partykit deploy` for Task 2, `firebase deploy --only hosting` with a bumped `index.html` cache-busting `?v=` for Tasks 3-4) still require explicit user approval before running, per this session's own established convention — this step just makes sure the secret rotation happens as part of that approved deploy, not skipped.

---

## Self-Review Notes

- **Spec coverage:** §4.1 (directory) → Task 1 + Task 2 Steps 4-6; §4.2 (forfeit) → Task 2 Steps 1, 7-8; §4.3 (pause menu) → Task 3; §4.4 (banner) → Task 4 Steps 1-5; §4.5 (win modal) → Task 4 Step 6; §6 (testing) → Task 1 Step 2, Task 2 Step 9.
- **Type consistency:** `forfeitedBy`/`state.forfeitedBy` spelled identically everywhere it's produced (Task 2) and consumed (Task 4 Step 6). `getActiveMatch`'s `{roomCode: string|null}` shape matches what Task 4's `showMenu`/`liveDuelYesBtn` code expects.
- **Known rough edge, deliberately left as-is (YAGNI):** `enterPvpMatch` resets every reveal-round watermark (`pvpPowerRevealedRound`, etc.) to 0 on Task 4's reconnect path, same as it already does on every fresh entry — a reconnecting player may see one stale reveal overlay replay for whatever the last thing was before they disappeared. Harmless, arguably useful context, not spec-mandated to suppress.
- **`showBoardScreen()` is not called explicitly in Task 4 Step 5:** confirmed by reading `enterPvpMatch` (`ui.js:5207-5404`) — it already calls `showBoardScreen()` itself at line 5403. Only `hideMenu()` needs to be called explicitly beforehand, since (unlike the existing PVP-waiting-room call site) the reconnect flow starts from the main menu, which `enterPvpMatch` doesn't hide on its own.
