# PartyKit PVP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Firestore + Cloud Functions v2 PVP transport
(`createRoom`/`joinRoom`/`setReady`/`submitMatchAction`) with a PartyKit
WebSocket room per match, eliminating the per-action RPC + Firestore-listener
delay at its root.

**Architecture:** One PartyKit Durable Object per match, addressed by the
same 6-character room code used today. `rules-engine.js` (unchanged) runs
directly inside it. A single new Cloud Function (`resolvePvpIdentity`)
verifies the caller's Firebase ID token and resolves their profile/deck/
protector/collection data once per connection; the room caches that for the
match's whole lifetime and never calls another Cloud Function again. Every
in-match action becomes a WebSocket message instead of an `onCall` RPC.

**Tech Stack:** PartyKit (Cloudflare Workers/Durable Objects), plain
JavaScript (no TypeScript — matches the rest of this repo), Node 22's native
`WebSocket`/`fetch` globals (no `ws`/`partysocket` npm packages needed
anywhere, client or test harness), Firebase Cloud Functions v2 (unchanged
elsewhere), Firestore (unchanged for account/economy data).

**Spec:** `docs/superpowers/specs/2026-09-09-partykit-pvp-migration-design.md`

## Global Constraints

- No feature flag, no parallel-running legacy path — direct cutover (spec
  Section 1). There are no real PVP players today.
- `rules-engine.js`'s game-logic functions are ported **verbatim** — same
  signatures, same validation, same error messages. This migration changes
  transport, never game rules.
- Local-vs-CPU play must not regress: `node run-tests.js` (739 tests) must
  stay green through every task in this plan.
- No new client-side build tooling. The browser client stays plain
  `<script>` tags; no bundler, no TypeScript, no npm-installed client
  library for the WebSocket connection.
- Every deleted piece of code is actually deleted in this plan, not left
  alongside as dead code (spec Section 2's last bullet).

---

### Task 1: Make the shared game-logic files requireable from Node/Workers

**Files:**
- Modify: `data-cards.js` (append only)
- Modify: `data-decks.js` (append only)
- Modify: `rules-engine.js` (append only)
- Modify: `card-effects.js` (append only)

**Interfaces:**
- Produces: `require('../../data-cards.js')` → `{ CARD_STATS }`;
  `require('../../data-decks.js')` → `{ DECKLISTS, PRECON_DECK_KEYS }`;
  `require('../../rules-engine.js')` → `{ createGame, startMatch,
  canPlayBasic, playBasic, canEvolve, evolve, canAttachEnergy,
  attachEnergy, canRetreat, retreat, takePrize, chooseNewActive, canAttack,
  attack, endTurn, drawForTurnStart, getWinner, redactMatchState,
  submitRpsChoice }`; `require('../../card-effects.js')` → `{
  ATTACK_EFFECTS, TRAINER_EFFECTS, POKEMON_POWER_EFFECTS }`. Task 5 imports
  all of these directly from `party/index.js`.

These 4 files are currently loaded two ways: as plain `<script>` tags in
`index.html` (where `module` is undefined — nothing must change there), and
regenerated with a `module.exports` footer into `functions/lib/*.js` by
`functions/scripts/sync-shared-engine.js` before every deploy. This task
adds that same guarded footer **directly to the root files**, so
`party/index.js` can `require()` them with zero new copies and zero build
step. `functions/scripts/sync-shared-engine.js` and the `functions/lib/`
generated copies still exist and still work after this task (Task 7 retires
them, once nothing needs them anymore).

- [ ] **Step 1: Append the footer to `rules-engine.js`**

Append at the very end of the file:

```javascript

if (typeof module !== 'undefined') {
  module.exports = {
    createGame, startMatch, canPlayBasic, playBasic, canEvolve, evolve,
    canAttachEnergy, attachEnergy, canRetreat, retreat, takePrize,
    chooseNewActive, canAttack, attack, endTurn, drawForTurnStart,
    getWinner, redactMatchState, submitRpsChoice
  };
}
```

- [ ] **Step 2: Append the footer to `data-cards.js`, `data-decks.js`, `card-effects.js`**

Append at the end of `data-cards.js`:

```javascript

if (typeof module !== 'undefined') {
  module.exports = { CARD_STATS };
}
```

Append at the end of `data-decks.js`:

```javascript

if (typeof module !== 'undefined') {
  module.exports = { DECKLISTS, PRECON_DECK_KEYS };
}
```

Append at the end of `card-effects.js`:

```javascript

if (typeof module !== 'undefined') {
  module.exports = { ATTACK_EFFECTS, TRAINER_EFFECTS, POKEMON_POWER_EFFECTS };
}
```

- [ ] **Step 3: Verify each file is now requireable**

Run: `node -e "console.log(Object.keys(require('./rules-engine.js')))"`
Expected: prints the 18 exported names, no error.

Run the same for the other 3 files, confirming their exported keys print
with no error.

- [ ] **Step 4: Verify local-vs-CPU play and the browser are unaffected**

Run: `node run-tests.js`
Expected: all 739 tests still `PASS`, same as before this task (this
suite already `require()`s `rules-engine.js` today for a few of its own
checks — if the footer broke anything about how the file's own top-level
code executes, this would show it immediately).

Open `index.html` in a browser (or just reason about it: `typeof module`
is `undefined` in every browser, so the new `if` blocks never execute
there) — no visual/functional change expected.

- [ ] **Step 5: Commit**

```bash
git add data-cards.js data-decks.js rules-engine.js card-effects.js
git commit -m "Make shared game-logic files requireable from Node/Workers directly"
```

---

### Task 2: Add the `resolvePvpIdentity` Cloud Function

**Files:**
- Modify: `functions/index.js`
- Test: `functions/test/resolvePvpIdentity.test.js` (create)

**Interfaces:**
- Consumes: `admin.firestore()`, `admin.auth()` (already available),
  `validateDeckId(uid, deckId)`, `fetchProfile(uid)`,
  `fetchDeckCoverName(uid, deckId)`, `resolveCardBackId(uid, cardBackId)`
  (all already defined in `functions/index.js` from earlier work this
  session — untouched here).
- Produces: `POST /resolvePvpIdentity` (a plain HTTPS endpoint, not an
  `onCall`, since the caller is the PartyKit Worker, not the Firebase
  client SDK) accepting `{idToken, deckId, cardBackId}` and returning
  `{uid, username, photo, deckKey, deckCoverName, customDeckCards,
  cardBackId, collectionHolo, collectionSecret}` on success (HTTP 200), or
  `{error: <message>}` on failure (HTTP 400/401). Task 4 calls this from
  `party/index.js`'s `onConnect`.

This is a plain `onRequest` function (the same style `telegramWebhook`
already uses in this file) — the caller is a Cloudflare Worker doing a
server-to-server `fetch()`, not a browser, so there's no Firebase App
Check/callable-protocol handshake to satisfy and no CORS headers needed.

- [ ] **Step 1: Write the failing test**

Create `functions/test/resolvePvpIdentity.test.js`:

```javascript
// Same emulator/custom-token pattern as functions/test/giftCodes.test.js.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-test' });
const assert = require('assert');

async function createUser(email, extra) {
  const user = await admin.auth().createUser({ email: email, password: 'password123' });
  await admin.firestore().collection('users').doc(user.uid).set(Object.assign({
    username: 'jugador', photo: null, coins: 500, collection: {},
    collectionHolo: {}, collectionSecret: {}, cardBacks: [], customDecks: {}
  }, extra || {}));
  return user.uid;
}

async function idTokenFor(uid) {
  // The Auth emulator's REST API exchanges a custom token for a real ID
  // token -- admin.auth().createCustomToken() alone isn't verifiable by
  // admin.auth().verifyIdToken() the way a real client-issued ID token is.
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const data = await res.json();
  return data.idToken;
}

async function callResolvePvpIdentity(body) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/resolvePvpIdentity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const uid = await createUser('rpi1@test.com', {
    collectionHolo: { 'base-6': 1 }, collectionSecret: {}
  });
  const idToken = await idTokenFor(uid);

  const badToken = await callResolvePvpIdentity({ idToken: 'not-a-real-token', deckId: 'overgrowth', cardBackId: 'clasico' });
  assert.strictEqual(badToken.status, 401);
  console.log('PASS: an invalid ID token is rejected with 401');

  const badDeck = await callResolvePvpIdentity({ idToken: idToken, deckId: 'not-a-real-deck', cardBackId: 'clasico' });
  assert.strictEqual(badDeck.status, 400);
  console.log('PASS: an invalid deckId is rejected with 400');

  const ok = await callResolvePvpIdentity({ idToken: idToken, deckId: 'overgrowth', cardBackId: 'protector_messi' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.uid, uid);
  assert.strictEqual(ok.data.deckKey, 'overgrowth');
  assert.strictEqual(ok.data.customDeckCards, null);
  console.log('PASS: a real precon deckId resolves deckKey unchanged, customDeckCards null');

  assert.strictEqual(ok.data.cardBackId, 'clasico');
  console.log('PASS: an unowned protector silently falls back to clasico');

  assert.deepStrictEqual(ok.data.collectionHolo, { 'base-6': 1 });
  console.log('PASS: the real collectionHolo comes through unchanged');

  const customUid = await createUser('rpi2@test.com', {
    customDecks: { slot1: { name: 'Mi Mazo', cards: ['Charmander', 'Charmander'], coverName: 'Charmander' } }
  });
  const customIdToken = await idTokenFor(customUid);
  const customRes = await callResolvePvpIdentity({ idToken: customIdToken, deckId: 'custom:slot1', cardBackId: 'clasico' });
  assert.strictEqual(customRes.status, 200);
  assert.strictEqual(customRes.data.deckKey, 'pvp_' + customUid + '_slot1');
  assert.deepStrictEqual(customRes.data.customDeckCards, ['Charmander', 'Charmander']);
  assert.strictEqual(customRes.data.deckCoverName, 'Charmander');
  console.log('PASS: a custom deckId resolves a synthetic key + its real card list + cover name');

  console.log('ALL resolvePvpIdentity TESTS PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails (function doesn't exist yet)**

Run:
```bash
firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/resolvePvpIdentity.test.js"
```
Expected: FAIL — the fetch to `/resolvePvpIdentity` gets a 404 (no such
function deployed to the emulator).

- [ ] **Step 3: Implement `resolvePvpIdentity`**

Add to `functions/index.js`, right after the existing `resolveDeckKeyForMatch`
function (which stays exactly as-is — `setReady` still uses it until Task 7
deletes both):

```javascript
// Server-to-server only (the PartyKit room's own `fetch()`, never a
// browser) -- a plain onRequest endpoint, not onCall, since there's no
// Firebase client SDK on the calling side to attach request.auth
// automatically. Called once per socket, on connect (see
// party/index.js's onConnect) -- never once per action, which is what
// keeps this off PVP's hot path entirely.
exports.resolvePvpIdentity = onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const { idToken, deckId, cardBackId } = req.body || {};

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken || '');
    uid = decoded.uid;
  } catch (err) {
    res.status(401).json({ error: 'Token inválido.' });
    return;
  }

  try {
    await validateDeckId(uid, deckId);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Mazo inválido.' });
    return;
  }

  const profile = await fetchProfile(uid);
  const deckCoverName = await fetchDeckCoverName(uid, deckId);
  const resolvedCardBackId = await resolveCardBackId(uid, cardBackId);
  const userSnap = await admin.firestore().collection('users').doc(uid).get();
  const userData = userSnap.data() || {};

  // Same synthetic-key convention resolveDeckKeyForMatch already used --
  // duplicated here (not calling that function) because it mutates a
  // shared DECKLISTS global that no longer exists in this file after
  // Task 7; the PARTY registers customDeckCards into its OWN DECKLISTS
  // right before calling createGame (see party/index.js, Task 5).
  const customMatch = /^custom:(.+)$/.exec(deckId || '');
  let deckKey = deckId;
  let customDeckCards = null;
  if (customMatch) {
    const saved = (userData.customDecks || {})[customMatch[1]];
    deckKey = 'pvp_' + uid + '_' + customMatch[1];
    customDeckCards = saved.cards;
  }

  res.status(200).json({
    uid: uid, username: profile.username, photo: profile.photo,
    deckKey: deckKey, deckCoverName: deckCoverName, customDeckCards: customDeckCards,
    cardBackId: resolvedCardBackId,
    collectionHolo: userData.collectionHolo || {},
    collectionSecret: userData.collectionSecret || {}
  });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run the same command as Step 2.
Expected: `ALL resolvePvpIdentity TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js functions/test/resolvePvpIdentity.test.js
git commit -m "Add resolvePvpIdentity Cloud Function for the PartyKit migration"
```

---

### Task 3: Scaffold the PartyKit project

**Files:**
- Create: `party/partykit.json`
- Create: `party/package.json`
- Create: `party/index.js`
- Create: `party/test/echo.test.js`

**Interfaces:**
- Produces: a running local dev server at `ws://127.0.0.1:1999/parties/main/<room>`
  that Task 4/5 build real game logic into.

This task only proves the toolchain end-to-end (install, local dev, connect,
echo) with a throwaway handler — no game logic yet.

- [ ] **Step 1: Create `party/package.json`**

```json
{
  "name": "tcg-simulador-party",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "partykit dev",
    "deploy": "partykit deploy"
  },
  "devDependencies": {
    "partykit": "latest"
  }
}
```

- [ ] **Step 2: Create `party/partykit.json`**

```json
{
  "name": "tcg-simulador-pvp",
  "main": "index.js",
  "compatibilityDate": "2026-09-09"
}
```

- [ ] **Step 3: Create a throwaway echo `party/index.js`**

```javascript
export default class Server {
  constructor(room) {
    this.room = room;
  }

  onConnect(connection) {
    connection.send(JSON.stringify({ type: 'echo-ready' }));
  }

  onMessage(message, sender) {
    sender.send(message);
  }
}
```

- [ ] **Step 4: Install and start the local dev server**

Run: `cd party && npm install`
Expected: installs `partykit` into `party/node_modules`, no error.

Run (leave running in the background): `cd party && npm run dev`
Expected: prints a line confirming it's listening, typically on port 1999.

- [ ] **Step 5: Write and run a smoke-test WebSocket client**

Create `party/test/echo.test.js`:

```javascript
const assert = require('assert');

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:1999/parties/main/smoketest');
  const messages = [];
  await new Promise((resolve, reject) => {
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (e) => {
      messages.push(JSON.parse(e.data));
      if (messages.length === 1) { ws.send(JSON.stringify({ hello: 'world' })); }
      if (messages.length === 2) { resolve(); }
    });
  });
  assert.deepStrictEqual(messages[0], { type: 'echo-ready' });
  assert.deepStrictEqual(messages[1], { hello: 'world' });
  ws.close();
  console.log('PASS: connected, received echo-ready, sent a message, got it echoed back');
  console.log('ALL echo smoke tests PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Run: `node party/test/echo.test.js` (with `npm run dev` still running from
Step 4, in another terminal)
Expected: `ALL echo smoke tests PASSED`.

- [ ] **Step 6: Commit**

```bash
git add party/
git commit -m "Scaffold the PartyKit project with a throwaway echo handler"
```

Note: `party/index.js` is fully replaced in Task 4/5 — this step's handler
is not meant to survive.

---

### Task 4: Matchmaking (create/join/ready) in `party/index.js`

**Files:**
- Modify: `party/index.js`
- Test: `party/test/room.test.js` (create)

**Interfaces:**
- Consumes: `resolvePvpIdentity` (Task 2, called via `fetch`).
- Produces: `RoomServer` (the exported default class) handles connection
  URLs shaped `wss://<host>/parties/main/<ROOMCODE>?token=<idToken>&deckId=<deckId>&cardBackId=<cardBackId>&intent=<create|join>`.
  Broadcasts a `{type:'room', ...}` message (field names below) to both
  sides on every room-phase change. Task 5 extends the SAME class with the
  live-match message types once ready-up completes.
- The `{type:'room', ...}` payload's fields (`hostUid`, `guestUid`,
  `hostUsername`, `hostPhoto`, `hostDeckId`, `hostDeckCoverName`,
  `guestUsername`, `guestPhoto`, `guestDeckId`, `guestDeckCoverName`,
  `hostReady`, `guestReady`, `status`, `matchId`) are named to match
  exactly what `ui.js`'s `renderPvpWaitingOpponentFromRoom`/
  `renderPvpWaitingReadyState`/`startPvpRoomWait` already read today — Task
  6 relies on this so `ui.js` needs **zero changes**.

The room's own `ROOM_EXPIRY_MS` mirrors today's constant. Find its current
value first:

- [ ] **Step 1: Read the existing ROOM_EXPIRY_MS constant**

Run: `grep -n "ROOM_EXPIRY_MS" functions/index.js`
Note the exact millisecond value returned — use it verbatim below (do not
guess or re-derive it).

- [ ] **Step 2: Write the failing test**

Create `party/test/room.test.js` (this drives the local dev server the
same way Task 3's smoke test did — start `npm run dev` in `party/` before
running it):

```javascript
const assert = require('assert');

// Real identity resolution isn't available in this local harness
// (resolvePvpIdentity needs a live Firebase Auth+Firestore emulator or
// project) -- party/index.js's onConnect calls RESOLVE_IDENTITY_URL via
// fetch, so this test suite stubs that URL with a tiny local HTTP server
// returning canned identities, keyed by the fake "token" each connection
// sends. This proves the ROOM's own logic (host/guest tracking, ready-up,
// expiry, redaction message shape) independent of resolvePvpIdentity's
// own correctness, which functions/test/resolvePvpIdentity.test.js
// already covers separately.
const http = require('http');
const IDENTITIES = {
  'host-token': { uid: 'host-uid', username: 'Host', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'guest-token': { uid: 'guest-uid', username: 'Guest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'other-token': { uid: 'other-uid', username: 'Other', photo: null, deckKey: 'zap', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
};
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { idToken } = JSON.parse(body);
    const identity = IDENTITIES[idToken];
    if (!identity) { res.writeHead(401).end(JSON.stringify({ error: 'bad token' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(identity));
  });
});

function connect(room, token, intent) {
  return new WebSocket('ws://127.0.0.1:1999/parties/main/' + room +
    '?token=' + token + '&deckId=x&cardBackId=clasico&intent=' + intent);
}
function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener('message', function handler(e) {
      ws.removeEventListener('message', handler);
      resolve(JSON.parse(e.data));
    });
  });
}

async function main() {
  await new Promise((resolve) => stub.listen(8791, resolve));

  const roomCode = 'ROOM01';
  const host = connect(roomCode, 'host-token', 'create');
  const hostRoom1 = await nextMessage(host);
  assert.strictEqual(hostRoom1.type, 'room');
  assert.strictEqual(hostRoom1.hostUid, 'host-uid');
  assert.strictEqual(hostRoom1.guestUid, null);
  assert.strictEqual(hostRoom1.status, 'waiting');
  console.log('PASS: creating a room registers the host and broadcasts status waiting');

  const dupeHost = connect(roomCode, 'other-token', 'create');
  const dupeErr = await nextMessage(dupeHost);
  assert.strictEqual(dupeErr.type, 'error');
  console.log('PASS: create fails against a room that already has a host');

  const badJoin = connect('NOPE99', 'guest-token', 'join');
  const badJoinErr = await nextMessage(badJoin);
  assert.strictEqual(badJoinErr.type, 'error');
  console.log('PASS: joining a nonexistent room code fails');

  const guest = connect(roomCode, 'guest-token', 'join');
  const hostRoom2 = await nextMessage(host); // host is re-broadcast to on guest join
  const guestRoom1 = await nextMessage(guest);
  assert.strictEqual(hostRoom2.guestUid, 'guest-uid');
  assert.strictEqual(guestRoom1.guestUsername, 'Guest');
  assert.strictEqual(guestRoom1.status, 'waiting');
  console.log('PASS: joining sets the guest side and both sockets see it');

  const fullJoin = connect(roomCode, 'other-token', 'join');
  const fullErr = await nextMessage(fullJoin);
  assert.strictEqual(fullErr.type, 'error');
  console.log('PASS: joining an already-full room fails');

  host.send(JSON.stringify({ type: 'setReady' }));
  const hostRoom3 = await nextMessage(host);
  assert.strictEqual(hostRoom3.hostReady, true);
  assert.strictEqual(hostRoom3.status, 'waiting');
  console.log('PASS: one side readying up does not start the match alone');

  guest.send(JSON.stringify({ type: 'setReady' }));
  const hostRoom4 = await nextMessage(host);
  assert.strictEqual(hostRoom4.status, 'started');
  assert.ok(hostRoom4.matchId);
  console.log('PASS: both sides readying up flips status to started with a matchId');

  host.close(); guest.close(); dupeHost.close(); badJoin.close(); fullJoin.close();
  stub.close();
  console.log('ALL PVP ROOM (PartyKit) TESTS PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node party/test/room.test.js`
Expected: FAIL (`party/index.js` is still Task 3's throwaway echo handler).

- [ ] **Step 4: Implement matchmaking in `party/index.js`**

Replace the entire contents of `party/index.js`:

```javascript
// RESOLVE_IDENTITY_URL is overridable via an env var (party env add
// RESOLVE_IDENTITY_URL) so party/test/room.test.js and
// party/test/match.test.js can point it at a local stub instead of the
// real deployed Cloud Function.
const DEFAULT_RESOLVE_IDENTITY_URL = 'https://us-central1-pokemon-tcg-simulador.cloudfunctions.net/resolvePvpIdentity';

// Same window as functions/index.js's ROOM_EXPIRY_MS (confirmed via
// `grep -n ROOM_EXPIRY_MS functions/index.js` in Step 1: `20 * 60 * 1000`)
// -- keep these two literals in sync if that constant ever changes.
const ROOM_EXPIRY_MS = 20 * 60 * 1000;

async function resolveIdentity(env, idToken, deckId, cardBackId) {
  const url = (env && env.RESOLVE_IDENTITY_URL) || DEFAULT_RESOLVE_IDENTITY_URL;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: idToken, deckId: deckId, cardBackId: cardBackId })
  });
  const data = await res.json();
  if (!res.ok) { throw new Error(data.error || 'No se pudo verificar tu cuenta.'); }
  return data;
}

function roomBroadcastPayload(info) {
  return {
    type: 'room',
    hostUid: info.hostUid, guestUid: info.guestUid,
    hostUsername: info.hostUsername, hostPhoto: info.hostPhoto,
    hostDeckId: info.hostDeckId, hostDeckCoverName: info.hostDeckCoverName,
    guestUsername: info.guestUsername || null, guestPhoto: info.guestPhoto || null,
    guestDeckId: info.guestDeckId || null, guestDeckCoverName: info.guestDeckCoverName || null,
    hostReady: info.hostReady, guestReady: info.guestReady,
    status: info.status, matchId: info.status === 'started' ? info.roomCode : null
  };
}

export default class Server {
  constructor(room) {
    this.room = room;
    this.info = null; // set in onStart, or lazily on first onConnect
  }

  async onStart() {
    this.info = (await this.room.storage.get('info')) || null;
  }

  broadcastRoom() {
    const payload = JSON.stringify(roomBroadcastPayload(this.info));
    const host = this.info.hostConnId && this.room.getConnection(this.info.hostConnId);
    const guest = this.info.guestConnId && this.room.getConnection(this.info.guestConnId);
    if (host) { host.send(payload); }
    if (guest) { guest.send(payload); }
  }

  async onConnect(connection, ctx) {
    if (!this.info) { this.info = (await this.room.storage.get('info')) || null; }
    const url = new URL(ctx.request.url);
    const idToken = url.searchParams.get('token');
    const deckId = url.searchParams.get('deckId');
    const cardBackId = url.searchParams.get('cardBackId');
    const intent = url.searchParams.get('intent');

    let identity;
    try {
      identity = await resolveIdentity(this.room.env, idToken, deckId, cardBackId);
    } catch (err) {
      connection.send(JSON.stringify({ type: 'error', message: err.message }));
      connection.close();
      return;
    }

    // Reconnect: either side coming back mid-wait or mid-match.
    if (this.info && this.info.hostUid === identity.uid) {
      this.info.hostConnId = connection.id;
      await this.room.storage.put('info', this.info);
      if (this.info.status === 'started') { this.sendMatchTo(connection, 'player'); } else { this.broadcastRoom(); }
      return;
    }
    if (this.info && this.info.guestUid === identity.uid) {
      this.info.guestConnId = connection.id;
      await this.room.storage.put('info', this.info);
      if (this.info.status === 'started') { this.sendMatchTo(connection, 'cpu'); } else { this.broadcastRoom(); }
      return;
    }

    if (!this.info) {
      if (intent !== 'create') {
        connection.send(JSON.stringify({ type: 'error', message: 'Ese código no existe.' }));
        connection.close();
        return;
      }
      this.info = {
        roomCode: this.room.id, status: 'waiting', createdAt: Date.now(),
        hostUid: identity.uid, hostConnId: connection.id,
        hostUsername: identity.username, hostPhoto: identity.photo,
        hostDeckId: deckId, hostDeckKey: identity.deckKey, hostDeckCoverName: identity.deckCoverName,
        hostCustomDeckCards: identity.customDeckCards,
        hostCardBackId: identity.cardBackId, hostCollectionHolo: identity.collectionHolo, hostCollectionSecret: identity.collectionSecret,
        hostReady: false,
        guestUid: null, guestConnId: null, guestReady: false,
        matchState: null
      };
      await this.room.storage.put('info', this.info);
      this.broadcastRoom();
      return;
    }

    if (intent === 'create') {
      connection.send(JSON.stringify({ type: 'error', message: 'Ese código ya está en uso, probá con otro.' }));
      connection.close();
      return;
    }
    if (this.info.guestUid) {
      connection.send(JSON.stringify({ type: 'error', message: 'Esa sala ya está llena o ya empezó.' }));
      connection.close();
      return;
    }
    if (Date.now() - this.info.createdAt > ROOM_EXPIRY_MS) {
      connection.send(JSON.stringify({ type: 'error', message: 'Ese código venció.' }));
      connection.close();
      return;
    }
    this.info.guestUid = identity.uid;
    this.info.guestConnId = connection.id;
    this.info.guestUsername = identity.username;
    this.info.guestPhoto = identity.photo;
    this.info.guestDeckId = deckId;
    this.info.guestDeckKey = identity.deckKey;
    this.info.guestDeckCoverName = identity.deckCoverName;
    this.info.guestCustomDeckCards = identity.customDeckCards;
    this.info.guestCardBackId = identity.cardBackId;
    this.info.guestCollectionHolo = identity.collectionHolo;
    this.info.guestCollectionSecret = identity.collectionSecret;
    this.info.guestReady = false;
    await this.room.storage.put('info', this.info);
    this.broadcastRoom();
  }

  async onMessage(message, sender) {
    const data = JSON.parse(message);
    if (data.type === 'setReady') {
      if (sender.id === this.info.hostConnId) { this.info.hostReady = true; }
      else if (sender.id === this.info.guestConnId) { this.info.guestReady = true; }
      if (this.info.hostReady && this.info.guestReady && this.info.status === 'waiting') {
        this.startMatch();
      }
      await this.room.storage.put('info', this.info);
      this.broadcastRoom();
      return;
    }
    // 'action' messages are handled once a match exists -- see Task 5,
    // which adds a branch here (`if (data.type === 'action') { ... }`)
    // right above this comment, before the match exists this is a no-op.
  }

  // startMatch/sendMatchTo are implemented in Task 5 -- Task 4 stops here
  // (matchmaking only), so this stub keeps the class syntactically
  // complete and the room.test.js scenarios (which never ready-up on
  // both sides through to a real match phase check) passing.
  startMatch() {
    this.info.status = 'started';
  }
  sendMatchTo(connection, side) {
    // Reconnect mid-match is exercised by match.test.js, Task 5.
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Restart `npm run dev` (in `party/`) so it picks up the new `index.js`, then:
Run: `node party/test/room.test.js`
Expected: `ALL PVP ROOM (PartyKit) TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add party/index.js party/test/room.test.js
git commit -m "Implement PVP matchmaking (create/join/ready) in the PartyKit room"
```

---

### Task 5: Live match state and actions in `party/index.js`

**Files:**
- Modify: `party/index.js`
- Test: `party/test/match.test.js` (create)

**Interfaces:**
- Consumes: `createGame`, `startMatch`, `canPlayBasic`, `playBasic`,
  `canEvolve`, `evolve`, `canAttachEnergy`, `attachEnergy`, `canRetreat`,
  `retreat`, `takePrize`, `chooseNewActive`, `canAttack`, `attack`,
  `endTurn`, `drawForTurnStart`, `redactMatchState`,
  `submitRpsChoice` (Task 1, `require('../rules-engine.js')`);
  `CARD_STATS` (`require('../data-cards.js')`); `DECKLISTS`,
  `PRECON_DECK_KEYS` (`require('../data-decks.js')`); `ATTACK_EFFECTS`
  (`require('../card-effects.js')`).
- Produces: a `{type:'match', public, myHand}` push to each connected
  socket after every state-changing message, matching exactly what
  `ui.js`'s `initPvpMatchListeners` callback (via `economy.js`, Task 6)
  expects — `public` is `redactMatchState`'s own output shape, `myHand` is
  that side's private hand array.

`rules-engine.js`'s functions read `CARD_STATS`/`DECKLISTS`/
`PRECON_DECK_KEYS`/`ATTACK_EFFECTS`/`TRAINER_EFFECTS`/`POKEMON_POWER_EFFECTS`
as bare global identifiers (not module-scoped imports) — same as
`functions/index.js` does today, bind them onto `globalThis` before the
`require('../rules-engine.js')` line runs.

- [ ] **Step 1: Write the failing test**

Create `party/test/match.test.js` (same stub-identity harness as Task 4's
`room.test.js` — copy its `IDENTITIES`/`stub`/`connect`/`nextMessage`
helpers verbatim, on a different stub port, e.g. 8792, and a fresh room
code, e.g. `MATCH01`, to avoid colliding with a still-running
`room.test.js`):

```javascript
const assert = require('assert');
const http = require('http');

const IDENTITIES = {
  'host-token': { uid: 'host-uid', username: 'Host', photo: null, deckKey: 'overgrowth', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} },
  'guest-token': { uid: 'guest-uid', username: 'Guest', photo: null, deckKey: 'blackout', deckCoverName: null, customDeckCards: null, cardBackId: 'clasico', collectionHolo: {}, collectionSecret: {} }
};
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const identity = IDENTITIES[JSON.parse(body).idToken];
    if (!identity) { res.writeHead(401).end(JSON.stringify({ error: 'bad token' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(identity));
  });
});

function connect(room, token, intent) {
  return new WebSocket('ws://127.0.0.1:1999/parties/main/' + room +
    '?token=' + token + '&deckId=x&cardBackId=clasico&intent=' + intent);
}
function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener('message', function handler(e) {
      ws.removeEventListener('message', handler);
      resolve(JSON.parse(e.data));
    });
  });
}
function nextMatchMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener('message', function handler(e) {
      const data = JSON.parse(e.data);
      if (data.type !== 'match') { return; }
      ws.removeEventListener('message', handler);
      resolve(data);
    });
  });
}
let reqCounter = 0;
function sendAction(ws, action) {
  const reqId = ++reqCounter;
  ws.send(JSON.stringify({ type: 'action', reqId: reqId, action: action }));
  return reqId;
}

async function main() {
  await new Promise((resolve) => stub.listen(8792, resolve));
  const roomCode = 'MATCH01';
  const host = connect(roomCode, 'host-token', 'create');
  await nextMessage(host); // room, waiting
  const guest = connect(roomCode, 'guest-token', 'join');
  await nextMessage(host); await nextMessage(guest); // room, guest joined

  host.send(JSON.stringify({ type: 'setReady' }));
  await nextMessage(host);
  guest.send(JSON.stringify({ type: 'setReady' }));
  const hostMatch1 = await nextMatchMessage(host);
  const guestMatch1 = await nextMatchMessage(guest);
  assert.strictEqual(hostMatch1.public.phase, 'rps');
  assert.strictEqual(guestMatch1.public.phase, 'rps');
  console.log('PASS: both sides readying up starts the match in rps phase');

  assert.ok(!JSON.stringify(hostMatch1).includes('"name":"' + guestMatch1.myHand[0].name));
  console.log('PASS: the host\\'s payload never contains the guest\\'s real hand card names');

  sendAction(host, { type: 'submitRpsChoice', choice: 'rock' });
  sendAction(guest, { type: 'submitRpsChoice', choice: 'scissors' });
  let hostMatch2 = await nextMatchMessage(host);
  while (hostMatch2.public.phase === 'rps' && !hostMatch2.public.rpsLastResult) { hostMatch2 = await nextMatchMessage(host); }
  assert.strictEqual(hostMatch2.public.phase, 'setup');
  assert.strictEqual(hostMatch2.public.rpsLastResult.winner, 'player1');
  console.log('PASS: rock beats scissors -- host (player1) is recorded as the RPS winner, phase moves to setup');

  const hostHandCardId = hostMatch2.myHand[0].id;
  sendAction(host, { type: 'placeActive', handCardId: hostHandCardId });
  const hostMatch3 = await nextMatchMessage(host);
  assert.ok(hostMatch3.public.board.player1.active);
  console.log('PASS: placeActive puts the named card onto the board');

  const guestHandCardId = guestMatch1.myHand[0].id;
  sendAction(guest, { type: 'placeActive', handCardId: guestHandCardId });
  await nextMatchMessage(guest);
  sendAction(host, { type: 'confirmSetup' });
  await nextMatchMessage(host);
  sendAction(guest, { type: 'confirmSetup' });
  let hostMatch4 = await nextMatchMessage(host);
  while (hostMatch4.public.phase !== 'playing') { hostMatch4 = await nextMatchMessage(host); }
  assert.strictEqual(hostMatch4.public.activePlayerId, 'player1');
  console.log('PASS: confirmSetup from both sides starts the match -- host (RPS winner) goes first');

  const badReqId = sendAction(guest, { type: 'endTurn' });
  const guestErr = await nextMessage(guest);
  assert.strictEqual(guestErr.type, 'error');
  assert.strictEqual(guestErr.reqId, badReqId);
  console.log('PASS: an out-of-turn action is rejected with the matching reqId');

  host.close(); guest.close();
  stub.close();
  console.log('ALL PVP MATCH (PartyKit) TESTS PASSED');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node party/test/match.test.js`
Expected: FAIL (`onMessage` has no `'action'` branch yet, `startMatch`/
`sendMatchTo` are still Task 4's stubs).

- [ ] **Step 3: Implement live-match logic**

At the top of `party/index.js`, before the `DEFAULT_RESOLVE_IDENTITY_URL`
line, bind the data tables to `globalThis` and require the game logic:

```javascript
const { CARD_STATS } = require('../data-cards.js');
const { DECKLISTS, PRECON_DECK_KEYS } = require('../data-decks.js');
const { ATTACK_EFFECTS, TRAINER_EFFECTS, POKEMON_POWER_EFFECTS } = require('../card-effects.js');
globalThis.CARD_STATS = CARD_STATS;
globalThis.DECKLISTS = DECKLISTS;
globalThis.PRECON_DECK_KEYS = PRECON_DECK_KEYS;
globalThis.ATTACK_EFFECTS = ATTACK_EFFECTS;
globalThis.TRAINER_EFFECTS = TRAINER_EFFECTS;
globalThis.POKEMON_POWER_EFFECTS = POKEMON_POWER_EFFECTS;
// getWinner isn't destructured here even though Task 1 exports it --
// redactMatchState (below) already calls it internally as a bare
// identifier within rules-engine.js's own module scope, so nothing
// outside that file ever needs to call it directly.
const {
  createGame, startMatch: engineStartMatch, canPlayBasic, playBasic, canEvolve, evolve,
  canAttachEnergy, attachEnergy, canRetreat, retreat, takePrize, chooseNewActive,
  canAttack, attack, endTurn, drawForTurnStart, redactMatchState, submitRpsChoice
} = require('../rules-engine.js');
```

`functions/index.js`'s `foilTierForCard` (added earlier this session)
iterates `CARD_CATALOG[setKey]` (from `functions/lib/cardCatalog.js`, a
*different* file from `data-cards.js`), matching each entry's `.n`/`.num`
to build the `setKey-num` lookup key. `party/index.js` needs the same
`CARD_CATALOG` data — `functions/lib/cardCatalog.js` already exports it as
a bare object (`module.exports = CARD_CATALOG;`, confirmed by reading its
last line), so it's requireable as-is, no footer needed:

```javascript
const CARD_CATALOG = require('../functions/lib/cardCatalog.js');

function foilTierForCard(collectionHolo, collectionSecret, cardName) {
  let hasSecret = false, hasHolo = false;
  ['base', 'jungle', 'fossil'].forEach((setKey) => {
    (CARD_CATALOG[setKey] || []).forEach((c) => {
      if (c.n !== cardName) { return; }
      const key = setKey + '-' + c.num;
      if ((collectionSecret[key] || 0) > 0) { hasSecret = true; }
      if ((collectionHolo[key] || 0) > 0) { hasHolo = true; }
    });
  });
  return hasSecret ? 'secret' : (hasHolo ? 'holo' : null);
}

function attachFoilTiers(publicView, hostCollectionHolo, hostCollectionSecret, guestCollectionHolo, guestCollectionSecret) {
  ['player1', 'player2'].forEach((sideKey) => {
    const holo = sideKey === 'player1' ? hostCollectionHolo : guestCollectionHolo;
    const secret = sideKey === 'player1' ? hostCollectionSecret : guestCollectionSecret;
    const board = publicView.board[sideKey];
    [board.active].concat(board.bench).forEach((instance) => {
      if (instance) { instance.foilTier = foilTierForCard(holo, secret, instance.name); }
    });
  });
}

const TURN_GATED_ACTIONS = ['placeActive', 'placeBench', 'evolve', 'attachEnergy', 'retreat', 'endTurn', 'attack'];
```

`functions/lib/cardCatalog.js` is untouched by Task 1/7 (it was never part
of `sync-shared-engine.js`) — safe to require directly from here.

Now add the actual game-logic methods to the `Server` class, replacing the
Task 4 stub `startMatch`/`sendMatchTo` methods and the `onMessage`
placeholder comment:

```javascript
  startMatch() {
    this.info.status = 'started';
    if (this.info.hostCustomDeckCards) { DECKLISTS[this.info.hostDeckKey] = this.info.hostCustomDeckCards; }
    if (this.info.guestCustomDeckCards) { DECKLISTS[this.info.guestDeckKey] = this.info.guestCustomDeckCards; }
    this.state = createGame(Math.random, this.info.hostDeckKey, { player: true, cpu: true }, this.info.guestDeckKey);
    this.persistState();
  }

  async persistState() {
    await this.room.storage.put('state', Object.assign({}, this.state, { rng: null }));
    await this.room.storage.put('info', this.info);
  }

  redactedFor(side) {
    const redacted = redactMatchState(this.state, this.info.hostUid, this.info.guestUid);
    attachFoilTiers(redacted.public,
      this.info.hostCollectionHolo, this.info.hostCollectionSecret,
      this.info.guestCollectionHolo, this.info.guestCollectionSecret);
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

  // Ported verbatim from functions/index.js's submitMatchAction switch
  // (see that file's current lines ~1402-1553 for the full historical
  // rationale comments before Task 7 deletes it) -- same validation, same
  // error messages, same rules-engine.js calls. Only the transport around
  // it changed: a thrown Error here becomes a {type:'error'} message
  // instead of an HttpsError response.
  runAction(side, action) {
    const activeBefore = this.state.activePlayerId;
    if (TURN_GATED_ACTIONS.indexOf(action.type) !== -1 && this.state.phase === 'playing' && activeBefore !== side) {
      throw new Error('No puedes jugar, aún no es tu turno.');
    }
    switch (action.type) {
      case 'placeActive': {
        if (!canPlayBasic(this.state, side, action.handCardId)) { throw new Error('No puedes jugar esa carta ahí.'); }
        if (this.state.players[side].active) { throw new Error('Ya tienes un Pokémon Activo.'); }
        playBasic(this.state, side, action.handCardId, null);
        break;
      }
      case 'placeBench': {
        if (!canPlayBasic(this.state, side, action.handCardId)) { throw new Error('No puedes jugar esa carta ahí.'); }
        if (!this.state.players[side].active) { throw new Error('Debes colocar tu Pokémon Activo primero.'); }
        if (typeof action.benchIndex !== 'number' || this.state.players[side].bench[action.benchIndex]) { throw new Error('Slot de banca inválido u ocupado.'); }
        playBasic(this.state, side, action.handCardId, action.benchIndex);
        break;
      }
      case 'confirmSetup': {
        if (this.state.phase !== 'setup') { throw new Error('La partida ya empezó.'); }
        if (!this.state.players.player.active || !this.state.players.cpu.active) { throw new Error('Ambos jugadores deben colocar su Pokémon Activo antes de confirmar.'); }
        this.state.setupConfirmed = this.state.setupConfirmed || { player: false, cpu: false };
        this.state.setupConfirmed[side] = true;
        if (this.state.setupConfirmed.player && this.state.setupConfirmed.cpu) {
          engineStartMatch(this.state, this.state.activePlayerId);
        }
        break;
      }
      case 'evolve': {
        if (!canEvolve(this.state, side, action.handCardId, action.targetInstanceId)) { throw new Error('Esa evolución no es legal ahí.'); }
        evolve(this.state, side, action.handCardId, action.targetInstanceId);
        break;
      }
      case 'attachEnergy': {
        if (!canAttachEnergy(this.state, side, action.handCardId, action.targetInstanceId)) { throw new Error('No puedes adjuntar esa Energía ahí.'); }
        attachEnergy(this.state, side, action.handCardId, action.targetInstanceId);
        break;
      }
      case 'retreat': {
        if (!canRetreat(this.state, side, action.targetInstanceId)) { throw new Error('No puedes retirarte ahí.'); }
        retreat(this.state, side, action.targetInstanceId, action.discardEnergyIndices);
        break;
      }
      case 'endTurn': {
        if (this.state.phase !== 'playing' || this.state.activePlayerId !== side) { throw new Error('No es tu turno.'); }
        endTurn(this.state);
        break;
      }
      case 'takePrize': {
        if (!this.state.pendingPrizeChoice || this.state.pendingPrizeChoice.playerId !== side) { throw new Error('No tienes un premio pendiente para elegir.'); }
        const prizes = this.state.players[side].prizes;
        if (typeof action.prizeIndex !== 'number' || action.prizeIndex < 0 || action.prizeIndex >= prizes.length || !prizes[action.prizeIndex]) { throw new Error('Índice de premio inválido.'); }
        takePrize(this.state, side, action.prizeIndex);
        break;
      }
      case 'attack': {
        if (!canAttack(this.state, side, action.attackName)) { throw new Error('No puedes usar ese ataque ahora.'); }
        const attackerName = this.state.players[side].active.name;
        if (ATTACK_EFFECTS[attackerName] && ATTACK_EFFECTS[attackerName][action.attackName]) { throw new Error('Ese ataque todavía no está disponible en PVP (Fase 2).'); }
        attack(this.state, side, action.attackName);
        break;
      }
      case 'submitRpsChoice': {
        if (this.state.phase !== 'rps') { throw new Error('La partida no está en la fase de piedra, papel o tijera.'); }
        if (['rock', 'paper', 'scissors'].indexOf(action.choice) === -1) { throw new Error('Elección inválida.'); }
        submitRpsChoice(this.state, side, action.choice);
        break;
      }
      case 'chooseActive': {
        if (this.state.pendingActiveChoice !== side) { throw new Error('No tienes una elección de Activo pendiente.'); }
        const bench = this.state.players[side].bench;
        if (typeof action.benchIndex !== 'number' || !bench[action.benchIndex] || bench[action.benchIndex].id !== action.benchInstanceId) { throw new Error('Selección de banca inválida.'); }
        chooseNewActive(this.state, side, action.benchInstanceId);
        break;
      }
      default:
        throw new Error('Tipo de acción desconocido: ' + action.type);
    }
    // Same turn-start-draw compensation as functions/index.js's
    // submitMatchAction (its own comment, current lines ~1555-1596,
    // explains the full turnCounter/activeBefore reasoning) -- ported
    // verbatim.
    if (this.state.turnCounter > 1 && this.state.activePlayerId !== activeBefore && this.state.activePlayerId !== 'player' && this.state.humanControlled[this.state.activePlayerId]) {
      drawForTurnStart(this.state, this.state.activePlayerId);
    }
  }
```

Replace the `onMessage` method's trailing comment with a real `'action'`
branch:

```javascript
  async onMessage(message, sender) {
    const data = JSON.parse(message);
    if (data.type === 'setReady') {
      if (sender.id === this.info.hostConnId) { this.info.hostReady = true; }
      else if (sender.id === this.info.guestConnId) { this.info.guestReady = true; }
      if (this.info.hostReady && this.info.guestReady && this.info.status === 'waiting') {
        this.startMatch();
      }
      await this.room.storage.put('info', this.info);
      this.broadcastRoom();
      return;
    }
    if (data.type === 'action') {
      const side = sender.id === this.info.hostConnId ? 'player' : 'cpu';
      try {
        this.runAction(side, data.action);
        await this.persistState();
        sender.send(JSON.stringify({ type: 'ack', reqId: data.reqId }));
        this.broadcastMatch();
      } catch (err) {
        sender.send(JSON.stringify({ type: 'error', reqId: data.reqId, message: err.message }));
      }
      return;
    }
  }
```

Finally, `onConnect`'s two reconnect branches already call
`this.sendMatchTo(connection, 'player'|'cpu')` and check
`this.info.status === 'started'` — no change needed there, and load
`this.state` back from storage in `onStart` alongside `this.info`:

```javascript
  async onStart() {
    this.info = (await this.room.storage.get('info')) || null;
    const savedState = await this.room.storage.get('state');
    if (savedState) { this.state = Object.assign({}, savedState, { rng: Math.random }); }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Restart `npm run dev`, then:
Run: `node party/test/match.test.js`
Expected: `ALL PVP MATCH (PartyKit) TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add party/index.js party/test/match.test.js
git commit -m "Implement live PVP match state and actions in the PartyKit room"
```

---

### Task 6: Rewrite the client transport in `economy.js`

**Files:**
- Modify: `economy.js`

**Interfaces:**
- Produces (unchanged signatures — `ui.js` needs zero edits):
  `createRoomCloud(deckId)` → `Promise<{roomCode}>`;
  `joinRoomCloud(roomCode, deckId)` → `Promise<{roomCode}>`;
  `setReadyCloud(roomCode)` → `Promise<void>`;
  `submitMatchActionCloud(matchId, action)` → `Promise<void>`;
  `initPvpRoomListener(roomCode, onUpdate)` → `unsubscribe()` function,
  `onUpdate` called with a `room`-shaped object matching the exact fields
  `ui.js`'s `renderPvpWaitingOpponentFromRoom`/`renderPvpWaitingReadyState`
  already read;
  `initPvpMatchListeners(matchId, myUid, onUpdate)` → `unsubscribe()`
  function, `onUpdate` called with `{public, myHand}`.
- Deletes: `warmupPvpFunctionsCloud` and its call site in `ui.js` (a
  WebSocket-based Worker has no cold start to warm up — see this
  session's earlier delay-fix commits for why it existed).

All 6 functions above share ONE underlying WebSocket per active PVP
session — `createRoomCloud`/`joinRoomCloud` open it, everything else reuses
it. Message dispatch by `type` field is what lets `initPvpRoomListener`'s
and `initPvpMatchListeners`' callbacks both attach to the same socket
without stepping on each other.

- [ ] **Step 1: Find the exact current PVP section to replace**

Run: `grep -n "createRoomCloud\|joinRoomCloud\|setReadyCloud\|submitMatchActionCloud\|initPvpRoomListener\|initPvpMatchListeners\|warmupPvpFunctionsCloud\|WARMUP_PLACEHOLDER_ID" economy.js`

Note the line range this spans (from `createRoomCloud`'s comment through
`initPvpMatchListeners`'s closing brace, plus the separate
`warmupPvpFunctionsCloud` block) — this whole span gets replaced in Step 2.

- [ ] **Step 2: Replace it with the WebSocket transport**

Replace everything from the `createRoomCloud` function through the end of
`initPvpMatchListeners` (found in Step 1), and separately delete the
`WARMUP_PLACEHOLDER_ID`/`pvpFunctionsWarmed`/`warmupPvpFunctionsCloud` block
entirely (no replacement), with:

```javascript
// PartyKit host -- the same one used in production, or 127.0.0.1:1999
// during local development (uncomment the second line and comment the
// first, mirroring firebase-init.js's own useEmulator toggle pattern).
var PVP_PARTY_HOST = 'tcg-simulador-pvp.<your-partykit-subdomain>.partykit.dev';
// var PVP_PARTY_HOST = '127.0.0.1:1999';

var pvpSocket = null;
var pvpRoomHandler = null;
var pvpMatchHandler = null;
var pvpReqCounter = 0;
var pvpPendingActions = {}; // reqId -> {resolve, reject}
// Firestore's onSnapshot always fires immediately with the last-known
// value the instant something subscribes, even if that value arrived
// before the subscription existed -- initPvpRoomListener/
// initPvpMatchListeners below need the exact same behavior, since
// ui.js's startPvpRoomWait only calls initPvpRoomListener INSIDE
// createRoomCloud/joinRoomCloud's OWN .then() callback, i.e. strictly
// AFTER the party's first 'room' message already arrived and resolved
// that promise. Without caching it here, that first message (and for the
// match phase, the first 'match' message, delivered before enterPvpMatch
// ever calls initPvpMatchListeners) would already be lost by the time
// either handler gets registered -- these two variables are that cache.
var pvpLastRoomMessage = null;
var pvpLastMatchMessage = null;

function dispatchPvpMessage(data) {
  if (data.type === 'room') {
    pvpLastRoomMessage = data;
    if (pvpRoomHandler) { pvpRoomHandler(data); }
    return;
  }
  if (data.type === 'match') {
    pvpLastMatchMessage = data;
    if (pvpMatchHandler) { pvpMatchHandler(data); }
    return;
  }
  if (data.type === 'ack') {
    var pendingAck = pvpPendingActions[data.reqId];
    if (pendingAck) { delete pvpPendingActions[data.reqId]; pendingAck.resolve(); }
    return;
  }
  if (data.type === 'error') {
    var pendingErr = data.reqId != null ? pvpPendingActions[data.reqId] : null;
    if (pendingErr) { delete pvpPendingActions[data.reqId]; pendingErr.reject(new Error(data.message)); }
    return;
  }
}

// Opens the one shared PVP socket and resolves once the party's first
// real message arrives (an 'error' rejects, matching today's
// createRoom/joinRoom's own reject-on-invalid-code behavior) -- resolving
// on the bare WebSocket 'open' event isn't enough, since that only proves
// the TCP/TLS handshake succeeded, not that the party's own onConnect
// logic actually accepted this connection (room already taken, code
// doesn't exist, etc. all close the socket AFTER a real 'open'). Every
// message (including this first one) always goes through
// dispatchPvpMessage, so pvpLastRoomMessage/pvpLastMatchMessage are
// populated from the very start, regardless of whether a handler has
// been registered yet.
// Real gap this closes: pressing "back" out of the waiting-room screen
// before a match starts (pvpCreateBackBtn, ui.js) only ever clears
// pvpRoomHandler -- it has no reason to know it should also close a raw
// socket, since Firestore's onSnapshot (what it replaces) had no such
// resource to leak. Rather than teach ui.js about socket lifecycle, every
// fresh create/join here closes out any stale previous connection first,
// so backing out and trying again never accumulates more than one
// briefly-dangling connection (reaped the instant the next attempt
// starts, or by the browser itself on tab/page close either way).
function openPvpSocket(roomCode, deckId, cardBackId, intent) {
  if (pvpSocket) { pvpSocket.close(); pvpSocket = null; }
  pvpLastRoomMessage = null;
  pvpLastMatchMessage = null;
  return firebase.auth().currentUser.getIdToken().then(function (idToken) {
    return new Promise(function (resolve, reject) {
      var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + PVP_PARTY_HOST +
        '/parties/main/' + encodeURIComponent(roomCode) +
        '?token=' + encodeURIComponent(idToken) +
        '&deckId=' + encodeURIComponent(deckId) +
        '&cardBackId=' + encodeURIComponent(cardBackId) +
        '&intent=' + intent;
      var ws = new WebSocket(url);
      var settled = false;
      ws.addEventListener('message', function (e) {
        var data = JSON.parse(e.data);
        if (!settled) {
          settled = true;
          if (data.type === 'error') { ws.close(); reject(new Error(data.message)); return; }
          pvpSocket = ws;
          resolve({ roomCode: roomCode });
        }
        dispatchPvpMessage(data);
      });
      ws.addEventListener('close', function () {
        if (!settled) { settled = true; reject(new Error('No se pudo conectar a la sala.')); }
      });
      ws.addEventListener('error', function () {
        if (!settled) { settled = true; reject(new Error('No se pudo conectar a la sala.')); }
      });
    });
  });
}

// Real simplification from today's behavior: the old server-side
// createRoom retried up to 5 times inside one transaction on a
// collision. A collision here means openPvpSocket rejects (the party's
// onConnect sees an existing host and this client's intent is 'create')
// and the .catch() already wired at both ui.js call sites shows a plain
// alert -- no client-side auto-retry loop. Accepted: the odds are
// 1-in-32^6 (~1 billion), and the user's fix is just pressing "Crear
// Sala" again, which generates a fresh code.
function createRoomCloud(deckId) {
  var roomCode = randomRoomCodeClient();
  return openPvpSocket(roomCode, deckId, getCardBackId(), 'create');
}

function joinRoomCloud(roomCode, deckId) {
  return openPvpSocket(roomCode, deckId, getCardBackId(), 'join');
}

// Same 6-char, 32-symbol alphabet as the server used to generate
// (functions/index.js's now-deleted randomRoomCode) -- generated
// client-side now since PartyKit creates the room on first connection,
// there's no server round trip to ask for a fresh code.
function randomRoomCodeClient() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) { code += alphabet[Math.floor(Math.random() * alphabet.length)]; }
  return code;
}

function setReadyCloud() {
  pvpSocket.send(JSON.stringify({ type: 'setReady' }));
  return Promise.resolve();
}

function submitMatchActionCloud(matchId, action) {
  return new Promise(function (resolve, reject) {
    var reqId = ++pvpReqCounter;
    pvpPendingActions[reqId] = { resolve: resolve, reject: reject };
    pvpSocket.send(JSON.stringify({ type: 'action', reqId: reqId, action: action }));
  });
}

function initPvpRoomListener(roomCode, onUpdate) {
  pvpRoomHandler = onUpdate;
  if (pvpLastRoomMessage) { onUpdate(pvpLastRoomMessage); }
  return function unsubscribe() { pvpRoomHandler = null; };
}

function initPvpMatchListeners(matchId, myUid, onUpdate) {
  pvpMatchHandler = function (data) { onUpdate({ public: data.public, myHand: data.myHand }); };
  if (pvpLastMatchMessage) { pvpMatchHandler(pvpLastMatchMessage); }
  return function unsubscribe() {
    pvpMatchHandler = null;
    if (pvpSocket) { pvpSocket.close(); pvpSocket = null; }
    pvpLastRoomMessage = null;
    pvpLastMatchMessage = null;
  };
}
```

Note the `setReadyCloud` signature drops its `roomCode` parameter (the
already-open `pvpSocket` makes it redundant) — `ui.js`'s one call site
(`setReadyCloud(pvpCurrentRoomCode)`) still works unchanged, the extra
argument is simply ignored by JavaScript.

- [ ] **Step 2: Replace `PVP_PARTY_HOST` with the real deployed host**

This placeholder gets its real value in Task 8, Step 1, once
`party/index.js` is actually deployed and its subdomain is known — leave
the placeholder literal for now, this task's own verification (Step 3
below) only needs `party/index.js` to resolve identity, and a bug here
would surface immediately in Task 8's manual smoke test.

- [ ] **Step 3: Verify nothing else in `economy.js`/`ui.js` broke**

Run: `node --check economy.js && node --check ui.js`
Expected: both OK, no syntax errors.

Run: `node run-tests.js`
Expected: still 739 `PASS` (this task never touches `rules-engine.js` or
any local-vs-CPU code path).

- [ ] **Step 4: Commit**

```bash
git add economy.js
git commit -m "Rewrite PVP client transport to speak WebSocket to the PartyKit room"
```

---

### Task 7: Delete the old Firebase-side PVP transport

**Files:**
- Modify: `functions/index.js`
- Modify: `firebase.json`
- Modify: `firestore.rules`
- Delete: `functions/scripts/sync-shared-engine.js`
- Delete: `functions/lib/dataCards.js`, `functions/lib/dataDecks.js`,
  `functions/lib/rulesEngine.js`, `functions/lib/cardEffects.js`
- Delete: `functions/test/pvpRoom.test.js`, `functions/test/pvpMatch.test.js`

**Interfaces:**
- Nothing produced — this is pure deletion. `functions/index.js` keeps
  every non-PVP export (`createAccount`, `updateProfile`,
  `awardMatchResult`, `openBooster`, `buyCardBack`, etc.) plus the new
  `resolvePvpIdentity` (Task 2) untouched.

- [ ] **Step 1: Delete the 4 PVP Cloud Functions and their PVP-only helpers**

In `functions/index.js`, delete:
- `exports.createRoom`
- `exports.joinRoom`
- `exports.setReady`
- `exports.submitMatchAction`
- `exports.cleanupExpiredRooms` (find it: `grep -n "cleanupExpiredRooms"
  functions/index.js` — it's a separate scheduled function, not touched by
  any task so far)
- `resolveMatchSide`, `persistMatchState`, `resolveDeckKeyForMatch`,
  `attachFoilTiers`, `foilTierForCard`, `TURN_GATED_ACTIONS`,
  `randomRoomCode` (the room-code generator — its client-side replacement,
  `randomRoomCodeClient`, was added in Task 6)
- The requires/globals block: `const { CARD_STATS } = require('./lib/dataCards');`
  through `const { createGame, redactMatchState } = require('./lib/rulesEngine');`
  and all 6 `global.X = X;` lines around them (find them: `grep -n
  "require('./lib/dataCards')\|require('./lib/dataDecks')\|require('./lib/cardEffects')\|require('./lib/rulesEngine')" functions/index.js`)

Keep: `resolveCardBackId`, `FREE_CARD_BACK_IDS` (Task 2's
`resolvePvpIdentity` still uses these), `validateDeckId`, `fetchProfile`,
`fetchDeckCoverName`, `ROOM_EXPIRY_MS`, `PRECON_DECK_KEYS_LIST`,
`CUSTOM_DECK_SLOTS` (used by `validateDeckId`/`resolvePvpIdentity`, and
possibly by unrelated custom-deck-saving functions — verify with `grep -n
"PRECON_DECK_KEYS_LIST\|CUSTOM_DECK_SLOTS" functions/index.js` before
deleting anything with either name, to confirm no non-PVP caller remains).

- [ ] **Step 2: Verify `functions/index.js` still parses and boots**

Run: `node --check functions/index.js`
Expected: OK.

Run: `firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/resolvePvpIdentity.test.js"`
Expected: `ALL resolvePvpIdentity TESTS PASSED` (proves the surviving
`resolveCardBackId`/`validateDeckId`/etc. still work after their PVP-only
neighbors are gone).

Run one more unrelated existing test to confirm nothing else broke, e.g.:
`firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/customDeck.test.js"`
Expected: still passes.

- [ ] **Step 3: Delete the PVP test files and the sync script + its generated files**

```bash
rm functions/test/pvpRoom.test.js functions/test/pvpMatch.test.js
rm functions/scripts/sync-shared-engine.js
rm functions/lib/dataCards.js functions/lib/dataDecks.js functions/lib/rulesEngine.js functions/lib/cardEffects.js
```

- [ ] **Step 4: Remove the now-broken predeploy hook**

In `firebase.json`, delete the `"predeploy"` line inside the `functions`
array entry (it currently reads: `"predeploy": ["node \"$RESOURCE_DIR\"/scripts/sync-shared-engine.js"]`
— find it with `grep -n "predeploy" firebase.json`).

- [ ] **Step 5: Remove the `rooms`/`matches` blocks from `firestore.rules`**

Delete the entire `match /rooms/{roomCode} { ... }` block and the entire
`match /matches/{matchId} { ... }` block (including its nested
`private`/`serverOnly` sub-blocks) — find their exact span with `grep -n
"match /rooms\|match /matches" firestore.rules`.

- [ ] **Step 6: Verify the security rules still compile and nothing else regressed**

Run: `firebase emulators:exec --project demo-test --only firestore "node functions/test/rules.test.js"`
Expected: passes (this file has no `rooms`/`matches` assertions per this
plan's earlier investigation, so removing those blocks shouldn't change
its outcome — this run confirms that assumption held).

Run: `node run-tests.js`
Expected: 739 `PASS`, unaffected (this whole task never touches
`rules-engine.js`).

- [ ] **Step 7: Commit**

```bash
git add -A functions/ firebase.json firestore.rules
git commit -m "Delete the old Firestore + Cloud Functions PVP transport"
```

---

### Task 8: Deploy and smoke-test end to end

**Files:** none (operational task)

- [ ] **Step 1: Deploy the PartyKit project and note its real host**

```bash
cd party && npx partykit deploy
```
Expected output includes the deployed URL, e.g.
`tcg-simulador-pvp.<username>.partykit.dev`.

- [ ] **Step 2: Point the client at the real deployed host**

In `economy.js`, replace the `PVP_PARTY_HOST` placeholder (Task 6, Step 2)
with the real host from Step 1's output (no `https://`/`wss://` prefix,
just the bare host).

- [ ] **Step 3: Deploy Firebase (hosting + functions + rules)**

```bash
firebase deploy --project default
```
Expected: `Deploy complete!`, same as every previous deploy this session.

- [ ] **Step 4: Manual end-to-end smoke test**

Open two browser sessions (or one normal + one incognito) signed in as two
different accounts:
1. Session A: menu → Jugar PVP → Crear Sala → pick a deck → note the room
   code.
2. Session B: menu → Jugar PVP → Buscar Sala → enter that code → pick a
   deck.
3. Both sessions should show each other's real username/photo/deck art in
   the waiting room (same as before this migration).
4. Both press "Iniciar" — RPS screen should appear with **no perceptible
   delay** (this is the entire point of the migration).
5. Play a full opening (place Actives, confirm setup, take a few turns:
   place a Bench Pokémon, attach Energy, attack, end turn) — every action
   should feel instant on both sides.
6. If either side has a real owned Holo/Secret Rare or a purchased
   protector, confirm the OTHER session's board shows it correctly (the
   feature added earlier this session, now running through the new
   transport).
7. Finish the match (or KO down to a winner) — confirm the win/loss modal
   appears and `awardMatchResult` still credits rewards normally.

- [ ] **Step 5: Commit the host-URL fix**

```bash
git add economy.js
git commit -m "Point the PVP client at the deployed PartyKit host"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered section of the design spec maps to a
  task here — repo structure/direct import (Task 1), hybrid identity (Task
  2), matchmaking (Task 4), live state/actions (Task 5), end of match
  (unchanged, verified in Task 8's smoke test), testing (each task's own
  WS-driven suite plus Task 2/7's emulator suites), deletions (Task 7).
- **Type/shape consistency:** `{type:'room', ...}`, `{type:'match', public,
  myHand}`, `{type:'ack', reqId}`, `{type:'error', reqId?, message}` are
  the only 4 message shapes, used identically by `party/index.js` (Tasks
  4-5) and `economy.js` (Task 6) — every field name in `roomBroadcastPayload`
  matches what Task 6's `initPvpRoomListener` passes straight through to
  `ui.js`'s existing (unmodified) `renderPvpWaitingOpponentFromRoom`/
  `renderPvpWaitingReadyState`.
- **No placeholders:** the one bracketed literal left in the plan on
  purpose is `PVP_PARTY_HOST`'s subdomain (Task 6) and `ROOM_EXPIRY_MS`'s
  value (Task 4) — both are explicitly resolved by an early step in their
  own task (read the real constant; deploy and note the real host) rather
  than guessed, since guessing either would risk silently drifting from
  the real, already-shipped value.
