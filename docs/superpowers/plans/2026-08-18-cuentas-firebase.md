# Cuentas de Usuario + Economía en la Nube (Firebase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the game's `localStorage`-only coins/collection with per-account cloud persistence on Firebase — real user accounts (username + email + password), server-validated purchases/rewards, and username-based login with password reset.

**Architecture:** Firebase Auth (accounts) + Firestore (`users/{uid}`, `usernames/{username}`) + Cloud Functions (the only code allowed to write coins/collection) + Firebase Hosting (serves the existing static site). The game itself (`rules-engine.js`, `card-effects.js`, `ai.js`, the board UI) is untouched; only `economy.js`, `ui.js`'s two award/purchase call sites, and `index.html`/`style.css` (new auth screen) change on the client, plus a new `functions/` folder for the server code.

**Tech Stack:** Firebase Auth, Firestore, Cloud Functions v2 (Node 20), Firebase Hosting, Firebase JS SDK (compat build via CDN for the client, modular npm package for Node-based tests), Firebase Emulator Suite, `@firebase/rules-unit-testing`.

**Spec:** `docs/superpowers/specs/2026-08-18-cuentas-firebase-design.md`

## Global Constraints

- The client (`economy.js`, `ui.js`, `auth-ui.js`) never writes `coins` or `collection` directly — every change goes through a Cloud Function. Firestore rules must deny all client writes to `users/{uid}` (spec §5).
- `usernames/{username}` is never publicly readable — resolved only through the `resolveLoginEmail` Cloud Function (spec §5, §7 — user's explicit "privada" choice).
- Login/password-reset failures always show the same generic message, regardless of whether the username exists (spec §6).
- Login is mandatory to reach `menuScreen` — no guest mode (spec §3).
- New accounts start at 150 coins / empty collection — no migration of existing `localStorage` progress (spec §3).
- The game itself stays a plain-`<script>`, no-build-step static site. The only part of this project with its own `package.json`/`node_modules`/build step is `functions/`.
- All Cloud Function code and tests run against the **Firebase Emulator Suite** during development — never against the real production project (always pass `--project demo-test` when running emulators for tests, per Task 1).
- Booster cost is 100 coins, win reward is 75 coins, loss reward is 0 — must match the existing values in `economy.js` exactly (players' expectations don't change, only where the logic runs).

---

## File Structure

```
tcg-simulador/
  firebase.json              # NEW — Hosting + Functions + emulator config
  .firebaserc                # NEW — points at the Firebase project (Task 1)
  firestore.rules            # NEW — security rules (spec §5)
  firestore.indexes.json     # NEW — empty (no composite queries needed)
  .gitignore                 # NEW
  functions/
    package.json             # NEW
    index.js                 # NEW — exports the 4 callable functions (thin wrappers)
    lib/
      pureEconomy.js         # NEW — computeMatchReward, drawBoosterCards (DOM/Firebase-free, unit-testable)
      cardCatalog.js         # NEW — Node-requirable copy of data-sets.js's CARD_CATALOG
    test/
      rules.test.js          # NEW — Firestore security rules tests
      pureEconomy.test.js    # NEW — plain Node tests for lib/pureEconomy.js
      callable.test.js       # NEW — emulator-based tests for the 4 callable functions (grows across Tasks 4-7)
  firebase-init.js           # NEW — initializes the Firebase app for the client
  auth-ui.js                 # NEW — login/signup/forgot-password behavior + auth gating
  economy.js                 # REWRITTEN — was localStorage-based, becomes Firestore-listener + Cloud Function callers
  ui.js                      # MODIFIED — finishMatch() and openBoosterAndPurchase() call the new economy.js wrappers instead of the old local ones; DOMContentLoaded no longer loads economy state directly
  index.html                 # MODIFIED — new #authScreen markup, #menuScreen starts hidden, new <script> tags
  style.css                  # MODIFIED — #authScreen styles, one new footer button style reuse
  README.md                  # MODIFIED — Task 13, documents the new "how to run" (needs Firebase, not just double-click)
```

---

### Task 1: Firebase project setup + local scaffolding

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules` (default placeholder, rewritten in Task 2), `firestore.indexes.json`, `.gitignore`, `functions/package.json`, `functions/index.js` (placeholder)

**Interfaces:**
- Produces: a real Firebase project (ID captured for Task 8's client config), `firebase.json` with `firestore`, `functions`, and `emulators` blocks (the `hosting` block is added in Task 8).

This task has no code to unit-test — its "test" is that the emulator suite boots. Some steps are commands the human runs themselves (project creation is tied to a real Google account, which can't be scripted unattended).

- [ ] **Step 1: Install the Firebase CLI and log in**

Run (in a terminal, not sandboxed — this opens a browser for Google login):
```bash
npm install -g firebase-tools
firebase --version
firebase login
```
Expected: `firebase login` opens a browser, you approve, and the terminal prints "Success! Logged in as <your-google-email>".

- [ ] **Step 2: Create the Firebase project**

```bash
firebase projects:create --display-name "Pokemon TCG Simulador"
```
This prints a generated project ID (e.g. `pokemon-tcg-simulador-a1b2c`) — write it down, it's needed in Step 3 and Task 8.

- [ ] **Step 3: Enable Email/Password sign-in and register a Web App (console step — the CLI has no command for either)**

1. Open `https://console.firebase.google.com/project/<your-project-id>/authentication/providers`, click "Email/Password", enable it, save.
2. Open `https://console.firebase.google.com/project/<your-project-id>/settings/general`, under "Your apps" click the web icon (`</>`), register an app (any nickname), and copy the `firebaseConfig` object it shows you (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). Save this JSON somewhere — Task 8 pastes it verbatim into `firebase-init.js`.

- [ ] **Step 4: Scaffold the project files with `firebase init`**

From `/Users/hugoandrianoff/Pokemon/tcg-simulador`:
```bash
firebase use --add
# select the project created in Step 2, give it the alias "default"

firebase init firestore functions emulators
```
Answer the prompts:
- Firestore: accept default file names (`firestore.rules`, `firestore.indexes.json`).
- Functions: **JavaScript** (not TypeScript), **no** ESLint, install dependencies now = yes.
- Emulators: select **Authentication, Functions, Firestore, Hosting** (Hosting emulator config is added properly in Task 8, selecting it now just reserves the port), accept default ports, download emulators = yes.

Expected result: `firebase.json`, `.firebaserc`, `firestore.rules` (default "deny all" rules — rewritten in Task 2), `firestore.indexes.json`, `functions/package.json`, `functions/index.js` (a commented-out example) now exist.

- [ ] **Step 5: Set the Functions runtime and replace the placeholder `functions/index.js`**

Edit `functions/package.json` — make sure it has:
```json
{
  "name": "functions",
  "private": true,
  "main": "index.js",
  "engines": { "node": "20" },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0"
  },
  "devDependencies": {
    "firebase": "^10.0.0",
    "@firebase/rules-unit-testing": "^3.0.0"
  }
}
```

Replace `functions/index.js` with just the admin init (functions are added in Tasks 4-7):
```js
const admin = require('firebase-admin');
admin.initializeApp();
```

Run:
```bash
cd functions && npm install && cd ..
```
Expected: installs without error, creates `functions/node_modules/`.

- [ ] **Step 6: Write `.gitignore`**

```
functions/node_modules/
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
*-debug.log
```

- [ ] **Step 7: Write `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 8: Configure emulator ports explicitly in `firebase.json`**

Open `firebase.json` and make sure the `emulators` block reads exactly:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default"
    }
  ],
  "emulators": {
    "auth": { "port": 9099 },
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

- [ ] **Step 9: Verify the emulator suite boots**

Run:
```bash
firebase emulators:start --project demo-test
```
Expected: terminal shows all four emulators (Auth, Functions, Firestore, Hosting) listed as running, and opening `http://127.0.0.1:4000` in a browser shows the Emulator UI. Stop with Ctrl-C.

- [ ] **Step 10: Commit**

```bash
git add firebase.json .firebaserc firestore.rules firestore.indexes.json .gitignore functions/package.json functions/package-lock.json functions/index.js
git commit -m "Scaffold Firebase project (Hosting/Firestore/Functions/emulators)"
```

---

### Task 2: Firestore security rules + rules tests

**Files:**
- Modify: `firestore.rules`
- Create: `functions/test/rules.test.js`

**Interfaces:**
- Produces: the deployed rules that every later Firestore access (client and Functions-via-Admin-SDK, which bypasses rules entirely) relies on for safety.

- [ ] **Step 1: Write the failing rules test**

Create `functions/test/rules.test.js`:
```js
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc('alice-uid').set({
      username: 'alice', coins: 150, collection: {}
    });
    await ctx.firestore().collection('usernames').doc('alice').set({ uid: 'alice-uid' });
  });

  const alice = testEnv.authenticatedContext('alice-uid');
  const bob = testEnv.authenticatedContext('bob-uid');
  const anon = testEnv.unauthenticatedContext();

  await assertSucceeds(alice.firestore().collection('users').doc('alice-uid').get());
  console.log('PASS: owner can read their own user doc');

  await assertFails(bob.firestore().collection('users').doc('alice-uid').get());
  console.log('PASS: another signed-in user cannot read alice\'s doc');

  await assertFails(anon.firestore().collection('users').doc('alice-uid').get());
  console.log('PASS: an unauthenticated client cannot read alice\'s doc');

  await assertFails(alice.firestore().collection('users').doc('alice-uid').update({ coins: 999999 }));
  console.log('PASS: even the owner cannot write their own coins directly');

  await assertFails(alice.firestore().collection('usernames').doc('alice').get());
  console.log('PASS: usernames collection is not client-readable');

  await testEnv.cleanup();
  console.log('ALL RULES TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
firebase emulators:exec --project demo-test --only firestore "node functions/test/rules.test.js"
```
Expected: FAIL — the default `firestore.rules` from `firebase init` denies everything, so the first `assertSucceeds` (owner reading their own doc) fails.

- [ ] **Step 3: Write the real rules**

Replace `firestore.rules` entirely:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;
    }
    match /usernames/{username} {
      allow read: if false;
      allow write: if false;
    }
  }
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run:
```bash
firebase emulators:exec --project demo-test --only firestore "node functions/test/rules.test.js"
```
Expected: five `PASS:` lines, then `ALL RULES TESTS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules functions/test/rules.test.js
git commit -m "Add Firestore security rules: users/{uid} owner-read-only, usernames private"
```

---

### Task 3: Pure economy logic + card catalog for Functions

**Files:**
- Create: `functions/lib/pureEconomy.js`, `functions/lib/cardCatalog.js`, `functions/test/pureEconomy.test.js`

**Interfaces:**
- Produces:
  - `pureEconomy.js` exports `{ BOOSTER_COST, computeMatchReward(result), drawBoosterCards(pool, rng) }`.
  - `cardCatalog.js` exports the same shape as the client's `CARD_CATALOG` global from `data-sets.js`: `{ base: [{n, num, r, img}, ...], jungle: [...], fossil: [...] }`.
- Consumed by: Task 6 (`awardMatchResult` uses `computeMatchReward`), Task 7 (`openBooster` uses `drawBoosterCards` + `cardCatalog`).

- [ ] **Step 1: Write the failing test**

Create `functions/test/pureEconomy.test.js`:
```js
const assert = require('assert');
const { BOOSTER_COST, computeMatchReward, drawBoosterCards } = require('../lib/pureEconomy');

assert.strictEqual(BOOSTER_COST, 100, 'booster costs 100 coins');
console.log('PASS: BOOSTER_COST is 100');

assert.strictEqual(computeMatchReward('win'), 75, 'a win pays 75 coins');
console.log('PASS: win reward is 75');

assert.strictEqual(computeMatchReward('loss'), 0, 'a loss pays 0 coins');
console.log('PASS: loss reward is 0');

var pool = [
  { n: 'RareOne', num: '1', r: 'Rare' },
  { n: 'UncommonOne', num: '2', r: 'Uncommon' },
  { n: 'CommonOne', num: '3', r: 'Common' }
];
var cards = drawBoosterCards(pool, function () { return 0; });
assert.strictEqual(cards.length, 11, 'a booster always has 11 cards');
assert.strictEqual(cards[0].r, 'Rare', 'the first card is always the Rare/Rare Holo slot');
var uncommonCount = cards.filter(function (c) { return c.r === 'Uncommon'; }).length;
var commonCount = cards.filter(function (c) { return c.r === 'Common'; }).length;
assert.strictEqual(uncommonCount, 3, 'exactly 3 Uncommons');
assert.strictEqual(commonCount, 7, 'exactly 7 Commons');
console.log('PASS: drawBoosterCards returns 1 Rare + 3 Uncommon + 7 Common');

console.log('ALL PUREECONOMY TESTS PASSED');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node functions/test/pureEconomy.test.js`
Expected: `Error: Cannot find module '../lib/pureEconomy'`

- [ ] **Step 3: Write `functions/lib/pureEconomy.js`**

```js
var BOOSTER_COST = 100;

function computeMatchReward(result) {
  return result === 'win' ? 75 : 0;
}

function pickRandom(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Mirrors the pack composition of the original client-side buyBooster():
// 1 Rare/Rare Holo + 3 Uncommon + 7 Common, drawn with replacement.
function drawBoosterCards(pool, rng) {
  var rares = pool.filter(function (c) { return c.r === 'Rare' || c.r === 'Rare Holo'; });
  var uncommons = pool.filter(function (c) { return c.r === 'Uncommon'; });
  var commons = pool.filter(function (c) { return c.r === 'Common'; });

  var cards = [];
  cards.push(pickRandom(rares, rng));
  for (var i = 0; i < 3; i++) { cards.push(pickRandom(uncommons, rng)); }
  for (var j = 0; j < 7; j++) { cards.push(pickRandom(commons, rng)); }
  return cards;
}

module.exports = {
  BOOSTER_COST: BOOSTER_COST,
  computeMatchReward: computeMatchReward,
  drawBoosterCards: drawBoosterCards
};
```

- [ ] **Step 4: Generate `functions/lib/cardCatalog.js` from the existing client data**

`data-sets.js` already defines `const CARD_CATALOG = {...}` with no `module.exports` (it's a browser `<script>` global). Generate a Node-requirable copy by appending an export line — run this once from `tcg-simulador/`:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('data-sets.js', 'utf8');
fs.writeFileSync('functions/lib/cardCatalog.js', src + '\nmodule.exports = CARD_CATALOG;\n');
"
```
Expected: `functions/lib/cardCatalog.js` now exists, its content is `data-sets.js`'s content plus one appended `module.exports` line.

Note for whoever maintains this later: `functions/lib/cardCatalog.js` is a **deliberate duplicate** of `data-sets.js`'s catalog, not a shared import — the client (`<script>` tags, no bundler) and the Functions (Node, `require()`) can't share one file format without a bigger refactor of the working client code, which is out of scope here (spec §3, YAGNI). If the card catalog is ever edited, re-run the command above to re-sync `functions/lib/cardCatalog.js`.

- [ ] **Step 5: Run the test again to verify it passes**

Run: `node functions/test/pureEconomy.test.js`
Expected: 5 `PASS:` lines, then `ALL PUREECONOMY TESTS PASSED`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/pureEconomy.js functions/lib/cardCatalog.js functions/test/pureEconomy.test.js
git commit -m "Add pure economy logic + card catalog for Cloud Functions"
```

---

### Task 4: `createAccount` callable function

**Files:**
- Modify: `functions/index.js`
- Create: `functions/test/callable.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (uses `firebase-admin`/`firebase-functions` directly).
- Produces: `exports.createAccount` — callable, unauthenticated, `{ username, email, password }` → `{ uid }` on success; throws `HttpsError` with codes `invalid-argument` or `already-exists` on failure. Consumed by Task 11 (`auth-ui.js`).

- [ ] **Step 1: Write the failing test**

Create `functions/test/callable.test.js`:
```js
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

async function testCreateAccount() {
  const createAccount = httpsCallable(functions, 'createAccount');

  const res = await createAccount({ username: 'testuser1', email: 'testuser1@example.com', password: 'password123' });
  assert.ok(res.data.uid, 'expected a uid back');
  console.log('PASS: createAccount returns a uid');

  try {
    await createAccount({ username: 'testuser1', email: 'other@example.com', password: 'password123' });
    assert.fail('expected duplicate username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/already-exists');
    console.log('PASS: duplicate username is rejected');
  }

  try {
    await createAccount({ username: 'ab', email: 'shortname@example.com', password: 'password123' });
    assert.fail('expected too-short username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: too-short username is rejected');
  }
}

async function main() {
  await testCreateAccount();
  console.log('ALL CALLABLE TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

Add `"firebase": "^10.0.0"` is already in `functions/package.json` devDependencies from Task 1 — this test requires it. Run `cd functions && npm install && cd ..` if it wasn't installed yet.

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/callable.test.js"
```
Expected: FAIL — `createAccount` isn't exported yet, the callable call errors with a "not found" style error.

- [ ] **Step 3: Implement `createAccount` in `functions/index.js`**

```js
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
admin.initializeApp();

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

exports.createAccount = onCall(async (request) => {
  const data = request.data || {};
  const username = (data.username || '').trim().toLowerCase();
  const email = (data.email || '').trim();
  const password = data.password || '';

  if (!USERNAME_RE.test(username)) {
    throw new HttpsError('invalid-argument', 'El usuario debe tener 3-20 letras minúsculas, números o guión bajo.');
  }
  if (!email || email.indexOf('@') === -1) {
    throw new HttpsError('invalid-argument', 'Email inválido.');
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
  }

  const usernameRef = admin.firestore().collection('usernames').doc(username);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(usernameRef);
    if (snap.exists) {
      throw new HttpsError('already-exists', 'Ese usuario ya está en uso.');
    }
    tx.set(usernameRef, { uid: 'pending' });
  });

  var userRecord;
  try {
    userRecord = await admin.auth().createUser({ email: email, password: password });
  } catch (e) {
    await usernameRef.delete();
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Ese email ya está registrado.');
    }
    throw new HttpsError('internal', 'No se pudo crear la cuenta.');
  }

  const uid = userRecord.uid;
  const batch = admin.firestore().batch();
  batch.set(usernameRef, { uid: uid });
  batch.set(admin.firestore().collection('users').doc(uid), {
    username: username,
    coins: 150,
    collection: {},
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await batch.commit();

  return { uid: uid };
});
```

- [ ] **Step 4: Run the test again to verify it passes**

Run:
```bash
firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/callable.test.js"
```
Expected: 3 `PASS:` lines, then `ALL CALLABLE TESTS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js functions/test/callable.test.js
git commit -m "Add createAccount callable function"
```

---

### Task 5: `resolveLoginEmail` callable function

**Files:**
- Modify: `functions/index.js`, `functions/test/callable.test.js`

**Interfaces:**
- Produces: `exports.resolveLoginEmail` — callable, unauthenticated, `{ username }` → `{ email }`; throws `HttpsError('not-found', 'Usuario o contraseña incorrectos.')` if the username doesn't resolve to an account. Consumed by Task 11 (login and forgot-password forms both use it).

- [ ] **Step 1: Add the failing test**

Append to `functions/test/callable.test.js` (add this function, and add its call in `main()` below `await testCreateAccount();`):
```js
async function testResolveLoginEmail() {
  const resolveLoginEmail = httpsCallable(functions, 'resolveLoginEmail');

  const res = await resolveLoginEmail({ username: 'testuser1' });
  assert.strictEqual(res.data.email, 'testuser1@example.com');
  console.log('PASS: resolveLoginEmail finds the email for an existing username');

  try {
    await resolveLoginEmail({ username: 'nosuchuser' });
    assert.fail('expected unknown username to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/not-found');
    console.log('PASS: unknown username returns not-found');
  }
}
```
Update `main()`:
```js
async function main() {
  await testCreateAccount();
  await testResolveLoginEmail();
  console.log('ALL CALLABLE TESTS PASSED');
  process.exit(0);
}
```

- [ ] **Step 2: Run it to verify the new part fails**

Run:
```bash
firebase emulators:exec --project demo-test --only auth,firestore,functions "node functions/test/callable.test.js"
```
Expected: `testCreateAccount` still passes, `testResolveLoginEmail` fails (function not exported).

- [ ] **Step 3: Implement `resolveLoginEmail` in `functions/index.js`**

Add below `exports.createAccount`:
```js
exports.resolveLoginEmail = onCall(async (request) => {
  const username = (((request.data || {}).username) || '').trim().toLowerCase();
  if (!username) {
    throw new HttpsError('not-found', 'Usuario o contraseña incorrectos.');
  }

  const snap = await admin.firestore().collection('usernames').doc(username).get();
  const uid = snap.exists ? snap.data().uid : null;
  if (!uid || uid === 'pending') {
    throw new HttpsError('not-found', 'Usuario o contraseña incorrectos.');
  }

  try {
    const userRecord = await admin.auth().getUser(uid);
    return { email: userRecord.email };
  } catch (e) {
    throw new HttpsError('not-found', 'Usuario o contraseña incorrectos.');
  }
});
```

- [ ] **Step 4: Run the test again to verify it passes**

Run the same emulator command as Step 2.
Expected: both `testCreateAccount` and `testResolveLoginEmail` fully pass, `ALL CALLABLE TESTS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js functions/test/callable.test.js
git commit -m "Add resolveLoginEmail callable function"
```

---

### Task 6: `awardMatchResult` callable function

**Files:**
- Modify: `functions/index.js`, `functions/test/callable.test.js`

**Interfaces:**
- Consumes: `computeMatchReward` from `functions/lib/pureEconomy.js` (Task 3).
- Produces: `exports.awardMatchResult` — callable, **requires auth**, `{ result: 'win' | 'loss' }` → `{ coins }` (new balance). Consumed by Task 12 (`ui.js`'s `finishMatch`).

- [ ] **Step 1: Add the failing test**

Add near the top of `functions/test/callable.test.js` (after the existing imports):
```js
const { signInWithEmailAndPassword } = require('firebase/auth');
```
Append a new test function:
```js
async function testAwardMatchResult() {
  await signInWithEmailAndPassword(auth, 'testuser1@example.com', 'password123');
  const awardMatchResult = httpsCallable(functions, 'awardMatchResult');

  const winRes = await awardMatchResult({ result: 'win' });
  assert.strictEqual(winRes.data.coins, 225, '150 starting + 75 for a win');
  console.log('PASS: a win pays 75 coins on top of the starting balance');

  const lossRes = await awardMatchResult({ result: 'loss' });
  assert.strictEqual(lossRes.data.coins, 225, 'a loss pays 0, balance unchanged');
  console.log('PASS: a loss does not change the balance');

  await auth.signOut();
  try {
    await awardMatchResult({ result: 'win' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: awardMatchResult requires auth');
  }
}
```
Update `main()` to call it after `testResolveLoginEmail()`.

- [ ] **Step 2: Run it to verify it fails**

Run the emulator command from Task 5 Step 2.
Expected: FAIL — `awardMatchResult` isn't exported yet.

- [ ] **Step 3: Implement `awardMatchResult` in `functions/index.js`**

Add the import at the top:
```js
const { computeMatchReward } = require('./lib/pureEconomy');
```
Add the function below `exports.resolveLoginEmail`:
```js
exports.awardMatchResult = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const result = (request.data || {}).result;
  if (result !== 'win' && result !== 'loss') {
    throw new HttpsError('invalid-argument', 'Resultado inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const delta = computeMatchReward(result);

  const newCoins = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.exists ? snap.data().coins : 0;
    const updated = current + delta;
    tx.update(userRef, { coins: updated });
    return updated;
  });

  return { coins: newCoins };
});
```

- [ ] **Step 4: Run the test again to verify it passes**

Run the same emulator command.
Expected: all prior `PASS:` lines plus 3 new ones for `testAwardMatchResult`, `ALL CALLABLE TESTS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js functions/test/callable.test.js
git commit -m "Add awardMatchResult callable function"
```

---

### Task 7: `openBooster` callable function

**Files:**
- Modify: `functions/index.js`, `functions/test/callable.test.js`

**Interfaces:**
- Consumes: `BOOSTER_COST`, `drawBoosterCards` from `functions/lib/pureEconomy.js`, and `functions/lib/cardCatalog.js` (Task 3).
- Produces: `exports.openBooster` — callable, **requires auth**, `{ setKey }` → `{ cards }` (11-card array, same shape as the client's booster reveal already expects: `{n, num, r, img}`). Consumed by Task 12 (`ui.js`'s `openBoosterAndPurchase`).

- [ ] **Step 1: Add the failing test**

Append to `functions/test/callable.test.js`:
```js
async function testOpenBooster() {
  await signInWithEmailAndPassword(auth, 'testuser1@example.com', 'password123');
  const openBooster = httpsCallable(functions, 'openBooster');

  const res = await openBooster({ setKey: 'base' });
  assert.strictEqual(res.data.cards.length, 11, 'a booster has 11 cards');
  console.log('PASS: openBooster returns 11 cards');

  try {
    await openBooster({ setKey: 'not-a-real-set' });
    assert.fail('expected an invalid set to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: an unknown setKey is rejected');
  }

  await auth.signOut();
  try {
    await openBooster({ setKey: 'base' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: openBooster requires auth');
  }
}
```
Update `main()` to call it after `testAwardMatchResult()`.

Note: `testAwardMatchResult` already spent this account down to 225 coins (from 150), so this test doesn't need to assert an exact remaining balance — it only checks the shape of the response and the error cases, keeping it independent of exact prior test ordering side effects.

- [ ] **Step 2: Run it to verify it fails**

Run the emulator command from Task 5 Step 2.
Expected: FAIL — `openBooster` isn't exported yet.

- [ ] **Step 3: Implement `openBooster` in `functions/index.js`**

Add the import at the top:
```js
const { BOOSTER_COST, drawBoosterCards } = require('./lib/pureEconomy');
const CARD_CATALOG = require('./lib/cardCatalog');
```
Add the function below `exports.awardMatchResult`:
```js
exports.openBooster = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const setKey = (request.data || {}).setKey;
  if (!CARD_CATALOG[setKey]) {
    throw new HttpsError('invalid-argument', 'Set inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);

  const cards = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : null;
    if (!data || data.coins < BOOSTER_COST) {
      throw new HttpsError('failed-precondition', 'No tenés suficientes monedas.');
    }
    const drawn = drawBoosterCards(CARD_CATALOG[setKey], Math.random);
    const newCollection = Object.assign({}, data.collection);
    drawn.forEach(function (c) {
      const key = setKey + '-' + c.num;
      newCollection[key] = (newCollection[key] || 0) + 1;
    });
    tx.update(userRef, { coins: data.coins - BOOSTER_COST, collection: newCollection });
    return drawn;
  });

  return { cards: cards };
});
```

- [ ] **Step 4: Run the test again to verify it passes**

Run the same emulator command.
Expected: all prior `PASS:` lines plus 3 new ones for `testOpenBooster`, `ALL CALLABLE TESTS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js functions/test/callable.test.js
git commit -m "Add openBooster callable function"
```

---

### Task 8: Firebase Hosting config + client SDK init

**Files:**
- Modify: `firebase.json` (add `hosting` block)
- Create: `firebase-init.js`
- Modify: `index.html` (add Firebase CDN `<script>` tags + `firebase-init.js`)

**Interfaces:**
- Produces: after `firebase-init.js` runs, the global `firebase` object (from the compat CDN scripts) is initialized and `firebase.auth()`, `firebase.firestore()`, `firebase.functions()` are ready to call. Consumed by every later client task (9-12).

- [ ] **Step 1: Add the `hosting` block to `firebase.json`**

Add this key alongside the existing `firestore`/`functions`/`emulators` keys:
```json
"hosting": {
  "public": ".",
  "ignore": [
    "firebase.json",
    "**/.*",
    "**/node_modules/**",
    "functions/**",
    "docs/**",
    "README.md",
    "PROGRESS.md",
    "tests.html",
    "tests.js",
    "run-tests.js"
  ]
}
```

- [ ] **Step 2: Create `firebase-init.js`**

```js
var firebaseConfig = {
  apiKey: 'REPLACE_WITH_APIKEY_FROM_TASK_1_STEP_3',
  authDomain: 'REPLACE_WITH_AUTHDOMAIN_FROM_TASK_1_STEP_3',
  projectId: 'REPLACE_WITH_PROJECTID_FROM_TASK_1_STEP_3',
  storageBucket: 'REPLACE_WITH_STORAGEBUCKET_FROM_TASK_1_STEP_3',
  messagingSenderId: 'REPLACE_WITH_MESSAGINGSENDERID_FROM_TASK_1_STEP_3',
  appId: 'REPLACE_WITH_APPID_FROM_TASK_1_STEP_3'
};
firebase.initializeApp(firebaseConfig);

// Uncomment to develop against the local Emulator Suite (Task 1) instead
// of the real project -- must match firebase.json's emulator ports:
// firebase.auth().useEmulator('http://127.0.0.1:9099');
// firebase.firestore().useEmulator('127.0.0.1', 8080);
// firebase.functions().useEmulator('127.0.0.1', 5001);
```

Replace the six `REPLACE_WITH_*` values with the exact `firebaseConfig` object copied in Task 1, Step 3.

- [ ] **Step 3: Add the Firebase CDN scripts + `firebase-init.js` to `index.html`**

In `index.html`, right before the existing `<script src="data-sets.js"></script>` line, add:
```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js"></script>
<script src="firebase-init.js"></script>
```

- [ ] **Step 4: Verify it loads with no console errors**

Uncomment the three `useEmulator` lines in `firebase-init.js` (Step 2) for this local check.

Run:
```bash
firebase emulators:start --project demo-test
```
In another terminal, from `tcg-simulador/`:
```bash
python3 -m http.server 8000
```
Open `http://127.0.0.1:8000/index.html` in a browser, open devtools console.
Expected: no red errors. Typing `firebase.auth()`, `firebase.firestore()`, `firebase.functions()` in the console each returns an object (not `undefined`/an error).

Re-comment the three `useEmulator` lines afterward — production `index.html` should talk to the real project by default; developers uncomment them locally as needed.

- [ ] **Step 5: Commit**

```bash
git add firebase.json firebase-init.js index.html
git commit -m "Add Firebase Hosting config and client SDK initialization"
```

---

### Task 9: `#authScreen` markup + CSS

**Files:**
- Modify: `index.html` (new `#authScreen` block, `#menuScreen` starts hidden, logout button in the menu footer)
- Modify: `style.css` (new auth screen styles)

**Interfaces:**
- Produces: the DOM elements Task 11 (`auth-ui.js`) binds to — exact IDs: `authScreen`, `authLoginForm`/`authLoginUsername`/`authLoginPassword`/`authLoginError`/`authLoginSubmit`, `authSignupForm`/`authSignupUsername`/`authSignupEmail`/`authSignupPassword`/`authSignupError`/`authSignupSubmit`, `authForgotForm`/`authForgotUsername`/`authForgotError`/`authForgotMessage`/`authForgotSubmit`, toggle links `authShowSignup`/`authShowForgot`/`authShowLoginFromSignup`/`authShowLoginFromForgot`, and `menuLogoutBtn`.

This task is markup/CSS only — no behavior yet (forms don't submit anywhere, toggle links don't switch panels). That's Task 11.

- [ ] **Step 1: Add `#authScreen` markup to `index.html`, right before `<div id="menuScreen">`**

```html
  <!-- ===== AUTH (login / crear cuenta / olvidé mi contraseña) ===== -->
  <div id="authScreen">
    <div class="auth-card">
      <div class="auth-logo">
        <img class="auth-logo-img" src="https://images.pokemontcg.io/base1/logo.png" alt="Pokémon TCG">
      </div>

      <form id="authLoginForm" class="auth-panel">
        <h2 class="auth-title">Iniciar sesión</h2>
        <label class="auth-label">Usuario
          <input type="text" id="authLoginUsername" class="auth-input" autocomplete="username" required>
        </label>
        <label class="auth-label">Contraseña
          <input type="password" id="authLoginPassword" class="auth-input" autocomplete="current-password" required>
        </label>
        <p class="auth-error" id="authLoginError"></p>
        <button type="submit" class="auth-submit" id="authLoginSubmit">Entrar</button>
        <div class="auth-links">
          <a href="#" id="authShowForgot">Olvidé mi contraseña</a>
          <a href="#" id="authShowSignup">Crear cuenta</a>
        </div>
      </form>

      <form id="authSignupForm" class="auth-panel hidden">
        <h2 class="auth-title">Crear cuenta</h2>
        <label class="auth-label">Usuario
          <input type="text" id="authSignupUsername" class="auth-input" autocomplete="username" required>
        </label>
        <label class="auth-label">Email
          <input type="email" id="authSignupEmail" class="auth-input" autocomplete="email" required>
        </label>
        <label class="auth-label">Contraseña
          <input type="password" id="authSignupPassword" class="auth-input" autocomplete="new-password" required>
        </label>
        <p class="auth-error" id="authSignupError"></p>
        <button type="submit" class="auth-submit" id="authSignupSubmit">Crear cuenta</button>
        <div class="auth-links">
          <a href="#" id="authShowLoginFromSignup">Ya tengo cuenta</a>
        </div>
      </form>

      <form id="authForgotForm" class="auth-panel hidden">
        <h2 class="auth-title">Olvidé mi contraseña</h2>
        <label class="auth-label">Usuario
          <input type="text" id="authForgotUsername" class="auth-input" autocomplete="username" required>
        </label>
        <p class="auth-error" id="authForgotError"></p>
        <p class="auth-message" id="authForgotMessage"></p>
        <button type="submit" class="auth-submit" id="authForgotSubmit">Enviar mail de recuperación</button>
        <div class="auth-links">
          <a href="#" id="authShowLoginFromForgot">Volver a iniciar sesión</a>
        </div>
      </form>
    </div>
  </div>

```

- [ ] **Step 2: Make `#menuScreen` start hidden, and add a logout button to its footer**

In `index.html`, change:
```html
  <div id="menuScreen">
```
to:
```html
  <div id="menuScreen" class="hidden">
```

And change:
```html
    <footer class="menu-footer">
      <span class="menu-version">v1.0 · Overgrowth vs Blackout · Base Set 1998</span>
    </footer>
```
to:
```html
    <footer class="menu-footer">
      <span class="menu-version">v1.0 · Overgrowth vs Blackout · Base Set 1998</span>
      <button type="button" class="menu-footer-btn" id="menuLogoutBtn">Cerrar sesión</button>
    </footer>
```

- [ ] **Step 3: Add auth screen styles to `style.css`**

Append this block after the `/* ===================== MAIN MENU (PTCGO Style) ===================== */` section:
```css
/* ===================== AUTH SCREEN ===================== */
#authScreen{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;
  background:#0b1120;}
#authScreen.hidden{display:none;}
.auth-card{width:340px;max-width:90vw;background:rgba(20,25,40,0.9);border:1px solid rgba(201,168,76,0.2);
  border-radius:12px;padding:28px 24px;backdrop-filter:blur(8px);box-shadow:0 8px 30px rgba(0,0,0,0.4);}
.auth-logo{display:flex;justify-content:center;margin-bottom:20px;}
.auth-logo-img{height:56px;width:auto;object-fit:contain;filter:brightness(1.1);}
.auth-panel.hidden{display:none;}
.auth-title{font-family:'Sora',sans-serif;font-weight:700;font-size:1.1rem;color:#e8dcc0;
  margin:0 0 18px;text-align:center;}
.auth-label{display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:#8a7d5a;
  font-weight:600;margin-bottom:14px;}
.auth-input{padding:10px 12px;border:1px solid rgba(201,168,76,0.2);border-radius:6px;
  background:rgba(11,17,32,0.6);color:#e8dcc0;font-size:0.9rem;}
.auth-input:focus{outline:none;border-color:#c9a84c;}
.auth-submit{width:100%;padding:12px;border:none;border-radius:8px;background:#c9a84c;
  color:#0b1120;font-weight:700;font-size:0.9rem;cursor:pointer;transition:background 0.15s;}
.auth-submit:hover{background:#ddbf66;}
.auth-submit:disabled{background:#4a4328;color:#8a7d5a;cursor:default;}
.auth-links{display:flex;justify-content:space-between;margin-top:14px;font-size:0.75rem;}
.auth-links a{color:#8a7d5a;text-decoration:none;}
.auth-links a:hover{color:#c9a84c;}
.auth-error{color:#e05656;font-size:0.78rem;margin:-6px 0 12px;}
.auth-error:empty{display:none;}
.auth-message{color:#7fd88f;font-size:0.78rem;margin:-6px 0 12px;}
.auth-message:empty{display:none;}
```

- [ ] **Step 4: Verify visually**

Serve the folder (`python3 -m http.server 8000` from `tcg-simulador/`) and open `http://127.0.0.1:8000/index.html`.
Expected: the login card shows (dark navy background, gold accents, username/password fields), the main menu is not visible. Clicking the links does nothing yet (Task 11) — that's expected at this point.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "Add auth screen markup and styles"
```

---

### Task 10: Rewrite `economy.js` for cloud-backed state

**Files:**
- Modify: `economy.js` (full rewrite — removes all `localStorage`/local-computation code)

**Interfaces:**
- Consumes: `firebase.functions()`, `firebase.firestore()` (Task 8).
- Produces: `econState` (same shape as before: `{ coins, collection }`, global, read by `ui.js`'s existing `renderCoinCount()`/`renderShop()`/`renderCollection()`/etc. — unchanged consumers), `initEconomyListener(uid)` → returns an unsubscribe function, `awardMatchResultCloud(result)` → Promise, `openBoosterCloud(setKey)` → Promise resolving to a `cards` array. Consumed by Task 11 (`initEconomyListener`) and Task 12 (`awardMatchResultCloud`, `openBoosterCloud`).

- [ ] **Step 1: Replace the entire contents of `economy.js`**

```js
var econState = null;

function initEconomyListener(uid) {
  econState = null;
  return firebase.firestore().collection('users').doc(uid)
    .onSnapshot(function (snap) {
      var data = snap.data();
      if (!data) { return; }
      econState = { coins: data.coins, collection: data.collection || {} };
      renderCoinCount();
    });
}

function awardMatchResultCloud(result) {
  return firebase.functions().httpsCallable('awardMatchResult')({ result: result });
}

function openBoosterCloud(setKey) {
  return firebase.functions().httpsCallable('openBooster')({ setKey: setKey })
    .then(function (res) { return res.data.cards; });
}
```

- [ ] **Step 2: Manually verify against the emulator**

Uncomment the three `useEmulator` lines in `firebase-init.js` (added in Task 8).

Run:
```bash
firebase emulators:start --project demo-test
```
In another terminal, `cd functions && node test/callable.test.js` was already exercising `createAccount` against this same emulator project — reuse that `testuser1` / `testuser1@example.com` / `password123` account it creates (running that test file signs it out at the end, which is fine here).

Serve the folder and open the page (`python3 -m http.server 8000`, `http://127.0.0.1:8000/index.html`), open devtools console, and run:
```js
firebase.auth().signInWithEmailAndPassword('testuser1@example.com', 'password123')
  .then(function (cred) { return initEconomyListener(cred.user.uid); });
```
Expected: no console errors, and `econState` (typeable directly in the console) becomes `{coins: ..., collection: {...}}` reflecting whatever `functions/test/callable.test.js` left that account at. The coin count element in the (still-hidden) menu DOM updates too — check with `document.getElementById('coin-count').textContent`.

Re-comment the `useEmulator` lines afterward.

- [ ] **Step 3: Commit**

```bash
git add economy.js
git commit -m "Rewrite economy.js: Firestore listener + Cloud Function callers, remove localStorage"
```

---

### Task 11: `auth-ui.js` — signup/login/forgot-password behavior + auth gating

**Files:**
- Create: `auth-ui.js`
- Modify: `index.html` (add the `<script src="auth-ui.js">` tag)

**Interfaces:**
- Consumes: `firebase.auth()`/`firebase.functions()` (Task 8), the DOM IDs from Task 9, `initEconomyListener(uid)` (Task 10), and the existing `showMenu()`/`hideMenu()` from `ui.js` (not used directly — this task toggles `#menuScreen`'s `hidden` class itself, matching how Task 9 set it up, so it doesn't need to coordinate with `ui.js`'s own show/hide helpers, which are for switching between menu and match screens after login, a separate concern).
- Produces: the full login/signup/forgot-password flow; the auth gate that shows `#authScreen` vs `#menuScreen`.

- [ ] **Step 1: Create `auth-ui.js`**

```js
(function () {
  function showPanel(id) {
    ['authLoginForm', 'authSignupForm', 'authForgotForm'].forEach(function (pid) {
      document.getElementById(pid).classList.toggle('hidden', pid !== id);
    });
  }

  function setError(id, message) {
    document.getElementById(id).textContent = message || '';
  }

  function setSubmitting(btnId, isSubmitting, label) {
    var btn = document.getElementById(btnId);
    btn.disabled = isSubmitting;
    btn.textContent = isSubmitting ? 'Un momento…' : label;
  }

  function friendlyCreateAccountError(err) {
    if (err.code === 'functions/already-exists' || err.code === 'functions/invalid-argument') {
      return err.message;
    }
    return 'No se pudo crear la cuenta. Intentá de nuevo.';
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('authShowSignup').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authSignupForm');
    });
    document.getElementById('authShowForgot').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authForgotForm');
    });
    document.getElementById('authShowLoginFromSignup').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authLoginForm');
    });
    document.getElementById('authShowLoginFromForgot').addEventListener('click', function (e) {
      e.preventDefault();
      showPanel('authLoginForm');
    });

    document.getElementById('authLoginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authLoginError', '');
      var username = document.getElementById('authLoginUsername').value.trim().toLowerCase();
      var password = document.getElementById('authLoginPassword').value;
      setSubmitting('authLoginSubmit', true, 'Entrar');
      firebase.functions().httpsCallable('resolveLoginEmail')({ username: username })
        .then(function (res) {
          return firebase.auth().signInWithEmailAndPassword(res.data.email, password);
        })
        .catch(function () {
          setError('authLoginError', 'Usuario o contraseña incorrectos.');
        })
        .then(function () {
          setSubmitting('authLoginSubmit', false, 'Entrar');
        });
    });

    document.getElementById('authSignupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authSignupError', '');
      var username = document.getElementById('authSignupUsername').value.trim().toLowerCase();
      var email = document.getElementById('authSignupEmail').value.trim();
      var password = document.getElementById('authSignupPassword').value;
      setSubmitting('authSignupSubmit', true, 'Crear cuenta');
      firebase.functions().httpsCallable('createAccount')({ username: username, email: email, password: password })
        .then(function () {
          return firebase.auth().signInWithEmailAndPassword(email, password);
        })
        .catch(function (err) {
          setError('authSignupError', friendlyCreateAccountError(err));
        })
        .then(function () {
          setSubmitting('authSignupSubmit', false, 'Crear cuenta');
        });
    });

    document.getElementById('authForgotForm').addEventListener('submit', function (e) {
      e.preventDefault();
      setError('authForgotError', '');
      document.getElementById('authForgotMessage').textContent = '';
      var username = document.getElementById('authForgotUsername').value.trim().toLowerCase();
      setSubmitting('authForgotSubmit', true, 'Enviar mail de recuperación');
      firebase.functions().httpsCallable('resolveLoginEmail')({ username: username })
        .then(function (res) { return firebase.auth().sendPasswordResetEmail(res.data.email); })
        .catch(function () { /* deliberately silent -- same message either way, see below */ })
        .then(function () {
          document.getElementById('authForgotMessage').textContent =
            'Si el usuario existe, te llegará un mail con instrucciones.';
          setSubmitting('authForgotSubmit', false, 'Enviar mail de recuperación');
        });
    });

    document.getElementById('menuLogoutBtn').addEventListener('click', function () {
      firebase.auth().signOut();
    });

    var unsubscribeEconomy = null;
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('menuScreen').classList.remove('hidden');
        unsubscribeEconomy = initEconomyListener(user.uid);
      } else {
        if (unsubscribeEconomy) {
          unsubscribeEconomy();
          unsubscribeEconomy = null;
        }
        document.getElementById('menuScreen').classList.add('hidden');
        document.getElementById('authScreen').classList.remove('hidden');
        showPanel('authLoginForm');
        document.getElementById('authLoginForm').reset();
        document.getElementById('authSignupForm').reset();
        document.getElementById('authForgotForm').reset();
      }
    });
  });
})();
```

- [ ] **Step 2: Add the script tag**

In `index.html`, add right after `<script src="ui.js"></script>`:
```html
<script src="auth-ui.js"></script>
```

- [ ] **Step 3: Manually verify the full flow against the emulator**

Uncomment the three `useEmulator` lines in `firebase-init.js`.

Run `firebase emulators:start --project demo-test`, then serve and open the page as in prior tasks.

Walk through, expecting each to work exactly as described:
1. Page loads → only the login card is visible.
2. Click "Crear cuenta" → signup form shows. Submit with a new username/email/password (6+ chars) → menu appears, coin count shows 150.
3. Click "Cerrar sesión" in the menu footer → back to the login card.
4. Log in with that same username + password → menu appears again with the same coins/collection as before.
5. Click "Olvidé mi contraseña", enter the username, submit → shows the generic "te llegará un mail" message. Open the Emulator UI's Auth tab (`http://127.0.0.1:4000/auth`) — a reset-password action should be visible there for that user (the emulator doesn't actually send real email, but records the action).
6. Try logging in with a wrong password, or a username that doesn't exist → both show the same "Usuario o contraseña incorrectos." message.

Re-comment the `useEmulator` lines afterward.

- [ ] **Step 4: Commit**

```bash
git add auth-ui.js index.html
git commit -m "Add auth-ui.js: login/signup/forgot-password flow and auth gating"
```

---

### Task 12: Wire `ui.js`'s match-end and booster-purchase to the cloud economy

**Files:**
- Modify: `ui.js:446-457` (`finishMatch`), `ui.js` around `openBoosterAndPurchase` (booster shop flow), `ui.js`'s `DOMContentLoaded` handler (remove the old direct economy load)

**Interfaces:**
- Consumes: `awardMatchResultCloud(result)`, `openBoosterCloud(setKey)` (Task 10).

- [ ] **Step 1: Update `finishMatch` in `ui.js`**

Replace:
```js
function finishMatch(winner) {
  matchWinner = winner;
  econState = winner === 'player' ? awardWin(econState) : awardLoss(econState);
  saveEconomy(econState);
  renderCoinCount();
  renderBoard(); // shows the final board state (last action's results); also syncs the header via updateHeaderControls()
```
with:
```js
function finishMatch(winner) {
  matchWinner = winner;
  awardMatchResultCloud(winner === 'player' ? 'win' : 'loss')
    .catch(function (e) { console.error('No se pudo registrar el resultado de la partida', e); });
  renderBoard(); // shows the final board state (last action's results); also syncs the header via updateHeaderControls()
```
(the coin display updates on its own once the Cloud Function's write reaches the client via the `onSnapshot` listener from `economy.js` — no manual `renderCoinCount()` call needed here anymore.)

- [ ] **Step 2: Update `openBoosterAndPurchase` in `ui.js`**

Replace:
```js
function openBoosterAndPurchase() {
  if (!boosterSelectState || boosterSelectState.selectedPack === null) { return; }
  var result = buyBooster(econState, boosterSelectState.setKey, Math.random);
  if (!result) {
    alert('No tienes suficientes monedas.');
    closeBoosterSelectModal();
    return;
  }
  econState = result.economy;
  saveEconomy(econState);
  renderCoinCount();
  closeBoosterSelectModal();
  showBoosterResult(result.cards);
}
```
with:
```js
function openBoosterAndPurchase() {
  if (!boosterSelectState || boosterSelectState.selectedPack === null) { return; }
  var setKey = boosterSelectState.setKey;
  document.getElementById('boosterOpenBtn').disabled = true;
  openBoosterCloud(setKey)
    .then(function (cards) {
      closeBoosterSelectModal();
      showBoosterResult(cards);
    })
    .catch(function (err) {
      alert(err.message || 'No se pudo abrir el sobre.');
      document.getElementById('boosterOpenBtn').disabled = false;
    });
}
```

- [ ] **Step 3: Remove the old direct economy load from `DOMContentLoaded`**

Find, in the `document.addEventListener('DOMContentLoaded', function () { ... })` handler:
```js
  econState = loadEconomy();
  renderCoinCount();
  applyMenuBackground();
```
Remove the first two lines (economy state now comes from `auth-ui.js` → `initEconomyListener` once signed in, not unconditionally at page load):
```js
  applyMenuBackground();
```

- [ ] **Step 4: Manually verify end-to-end**

Uncomment the three `useEmulator` lines in `firebase-init.js`, run the emulator suite, serve and open the page, log in (or create a fresh account).

1. Go to Tienda, buy a booster (needs 100+ coins — create a fresh account for 150, or use the test account from earlier tasks if it still has enough). Expected: the booster reveal shows 11 cards, the coin count drops by 100, and Colección shows the new cards.
2. Try buying a booster with fewer than 100 coins (spend down first). Expected: an alert with "No tenés suficientes monedas.", no coin change.
3. Play a full match to completion (win or surrender). Expected: coins go up by 75 on a win, unchanged on a loss/surrender-as-loss, reflected in the header coin count shortly after the match-end modal appears.

Re-comment the `useEmulator` lines afterward.

- [ ] **Step 5: Commit**

```bash
git add ui.js
git commit -m "Wire finishMatch and booster purchase to the cloud economy"
```

---

### Task 13: Deploy to Firebase Hosting + production smoke test + docs

**Files:**
- Modify: `README.md`

**Interfaces:** none (final integration task).

- [ ] **Step 1: Deploy everything to the real Firebase project**

```bash
firebase deploy --project default
```
Expected: deploys Firestore rules, Cloud Functions, and Hosting; prints a live Hosting URL (`https://<project-id>.web.app`).

- [ ] **Step 2: Production smoke test (spec §10's checklist)**

Open the printed Hosting URL in a real browser (not the emulator) and walk through, exactly as in Task 11 Step 3 and Task 12 Step 4, but for real this time:
1. Create a new account (real email you can check).
2. Log out, log back in with just username + password.
3. Forgot-password end-to-end — check that the reset email actually arrives in the inbox this time (the emulator only simulated it) and that the link works.
4. Buy a booster twice in a quick double-click — confirm only one 100-coin deduction happened (open the Firestore console for that user's doc to check `coins` directly if in doubt).
5. Win a match, confirm +75 coins; lose one, confirm no change.

- [ ] **Step 3: Update `README.md`**

In the "How to play" section, replace the line:
```
No install, no build step, no server. Just open `index.html` in a browser
(double-click it, or `open index.html` on macOS).
```
with:
```
Needs a Firebase account now (see "Accounts & cloud economy" below) —
double-clicking `index.html` directly no longer works because Firebase
Auth requires the page to be served over http(s), not `file://`. For
local development, run `firebase emulators:start` and open
`http://127.0.0.1:5000`; the live version is hosted at the Firebase
Hosting URL from `firebase deploy`.
```

Add a new section after "## Economy":
```markdown
## Accounts & cloud economy

Coins and collection now live per-account in Firestore instead of
`localStorage` — login is required to play. See
`docs/superpowers/specs/2026-08-18-cuentas-firebase-design.md` for the
full design (data model, Cloud Functions, security rules) and
`docs/superpowers/plans/2026-08-18-cuentas-firebase.md` for how it was
built.

To develop locally against the Firebase Emulator Suite instead of the
real project, uncomment the three `useEmulator(...)` lines in
`firebase-init.js`, then run `firebase emulators:start --project
demo-test` and open `http://127.0.0.1:5000`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document Firebase accounts setup and local development in README"
```
