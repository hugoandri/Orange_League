# Starter Deck Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New accounts must permanently choose one of the 4 preconstructed decks the first time they log in; that deck's real 60 cards become part of their owned collection, and the other 3 precons become locked (visible, unselectable) afterward. Existing accounts see zero change.

**Architecture:** A new `chooseStarterDeck` Cloud Function (mirroring `openBooster`'s "server computes the grant, never trusts the client" pattern) transactionally grants the chosen deck's cards and locks `starterDeckChosen` on the user doc. `createAccount` starts stamping new accounts with `starterDeckChosen: null`; existing accounts simply never get this field, which is what exempts them (no migration). The existing `updateActiveDeck` function gets one added check so the lock can't be bypassed by calling it directly. On the client, a new mandatory full-screen (`starterDeckScreen`) blocks the menu until `econState.starterDeckChosen` stops being exactly `null`, and the existing Decks screen gets a small interception in its precon click handler so a locked precon can't be selected as the active deck.

**Tech Stack:** Firebase Cloud Functions (`onCall`, Firestore transactions), plain browser JS (`ui.js`/`economy.js`/`auth-ui.js`), existing `.shell-deck-card`/`.card-modal` CSS conventions.

**Spec:** docs/superpowers/specs/2026-09-18-starter-deck-selection-design.md

## Global Constraints

- The starter deck choice is permanent — no re-choice/reset flow exists anywhere in this plan.
- Existing accounts (created before this feature ships) must see **zero** behavior change — enforced by field-absence (`starterDeckChosen === undefined`), never a migration script.
- All card-grant computation happens server-side only, from a server-side copy of the decklists — the client never supplies card data that gets trusted.
- The mandatory screen cannot be dismissed without choosing — no close button, no backdrop-dismiss, no keyboard-Escape handler.
- `node run-tests.js` must stay 739 PASS / 0 FAIL / exit 0 at the end (this feature touches none of the rules-engine logic that suite covers).

---

## File Structure

- `functions/lib/starterDecks.js` (**new**) — server-side mirror of `data-decks.js`'s 4 precon decklists (`STARTER_DECKLISTS`). `data-decks.js` itself does have a Node-compatible `module.exports`, but Firebase's `functions.source: "functions"` config (`firebase.json`) only ever deploys the `functions/` directory — a `require('../data-decks.js')` from inside `functions/` would work locally but silently break in a real deploy (module not found), so the decklists are copied here instead of required from outside `functions/`.
- `functions/lib/pureEconomy.js` (**modify**) — adds `starterDeckGrants(deckKey, cardCatalogBase)`, a pure function converting a decklist into `{'base-<num>': count}` grants, exported alongside the existing functions.
- `functions/test/starterDeckGrants.test.js` (**new**) — pure unit tests for `starterDeckGrants`, no emulator needed (same style as `functions/test/pureEconomy.test.js`).
- `functions/index.js` (**modify**) — `createAccount` gains one field; new `chooseStarterDeck` onCall function; `updateActiveDeck` gains the lock check.
- `functions/test/starterDeck.test.js` (**new**) — emulator-based integration tests for `chooseStarterDeck` and the `updateActiveDeck` lock (same style as `functions/test/customDeck.test.js`).
- `economy.js` (**modify**) — `econState` gains `starterDeckChosen`; new `chooseStarterDeckCloud(deckKey)` wrapper.
- `index.html` (**modify**) — new `starterDeckScreen` full-screen markup + a small confirm modal (`starterDeckConfirmModal`).
- `shell-theme.css` (**modify**) — styles for the new screen/modal, reusing existing `.shell-deck-card`/`.card-modal` conventions where possible.
- `ui.js` (**modify**) — render/wire the new screen and confirm modal; intercept the Decks screen's precon click handler for locked precons.
- `auth-ui.js` (**modify**) — the post-login gate that shows `starterDeckScreen` instead of the menu when appropriate.

---

### Task 1: Server-side starter decklists + pure grant computation

**Files:**
- Create: `functions/lib/starterDecks.js`
- Modify: `functions/lib/pureEconomy.js`
- Test: `functions/test/starterDeckGrants.test.js`

**Interfaces:**
- Consumes: `CARD_CATALOG.base` (`functions/lib/cardCatalog.js`) — array of `{n, num, st, r, img}`, `n` is the card name (string), `num` is the catalog number (string, e.g. `"1"`).
- Produces: `STARTER_DECKLISTS` (exported from `functions/lib/starterDecks.js`) — `{overgrowth: [...], blackout: [...], zap: [...], brushfire: [...]}`, each an array of `{name, count}`. `starterDeckGrants(deckKey, cardCatalogBase)` (exported from `functions/lib/pureEconomy.js`) — returns `{'base-<num>': count, ...}`. Task 2's `chooseStarterDeck` calls this directly.

- [ ] **Step 1: Create the server-side decklist mirror**

Create `functions/lib/starterDecks.js` with this exact content (a byte-for-byte copy of the 4 precon lists from `data-decks.js`'s `DECKLISTS`, nothing else):

```javascript
// Server-side mirror of the 4 real precon decklists (data-decks.js's own
// DECKLISTS, precon keys only). Firebase only ever deploys the functions/
// directory (functions.source: "functions" in firebase.json) -- a
// require('../data-decks.js') from here would work locally but silently
// break in a real deploy, so this is a deliberate copy, not a shortcut.
// Keep in sync with data-decks.js by hand if those decklists ever change.
const STARTER_DECKLISTS = {
  overgrowth: [
    { name: "Gyarados", count: 1 },
    { name: "Magikarp", count: 2 },
    { name: "Starmie", count: 3 },
    { name: "Staryu", count: 4 },
    { name: "Beedrill", count: 1 },
    { name: "Kakuna", count: 2 },
    { name: "Ivysaur", count: 2 },
    { name: "Weedle", count: 4 },
    { name: "Bulbasaur", count: 4 },
    { name: "Potion", count: 1 },
    { name: "Bill", count: 2 },
    { name: "Super Potion", count: 2 },
    { name: "Switch", count: 2 },
    { name: "Gust of Wind", count: 2 },
    { name: "Water Energy", count: 12 },
    { name: "Grass Energy", count: 16 }
  ],
  blackout: [
    { name: "Hitmonchan", count: 1 },
    { name: "Farfetch'd", count: 2 },
    { name: "Wartortle", count: 2 },
    { name: "Squirtle", count: 4 },
    { name: "Staryu", count: 3 },
    { name: "Onix", count: 3 },
    { name: "Sandshrew", count: 3 },
    { name: "Machoke", count: 2 },
    { name: "Machop", count: 4 },
    { name: "Super Energy Removal", count: 1 },
    { name: "PlusPower", count: 1 },
    { name: "Professor Oak", count: 1 },
    { name: "Gust of Wind", count: 1 },
    { name: "Energy Removal", count: 4 },
    { name: "Fighting Energy", count: 16 },
    { name: "Water Energy", count: 12 }
  ],
  zap: [
    { name: "Mewtwo", count: 1 },
    { name: "Kadabra", count: 1 },
    { name: "Jynx", count: 2 },
    { name: "Haunter", count: 2 },
    { name: "Gastly", count: 3 },
    { name: "Drowzee", count: 2 },
    { name: "Abra", count: 3 },
    { name: "Pikachu", count: 4 },
    { name: "Magnemite", count: 3 },
    { name: "Computer Search", count: 1 },
    { name: "Defender", count: 1 },
    { name: "Super Potion", count: 1 },
    { name: "Professor Oak", count: 1 },
    { name: "Switch", count: 2 },
    { name: "Potion", count: 1 },
    { name: "Gust of Wind", count: 2 },
    { name: "Bill", count: 2 },
    { name: "Lightning Energy", count: 12 },
    { name: "Psychic Energy", count: 16 }
  ],
  brushfire: [
    { name: "Ninetales", count: 1 },
    { name: "Weedle", count: 4 },
    { name: "Tangela", count: 2 },
    { name: "Nidoran ♂", count: 4 },
    { name: "Arcanine", count: 1 },
    { name: "Growlithe", count: 2 },
    { name: "Charmeleon", count: 2 },
    { name: "Vulpix", count: 2 },
    { name: "Charmander", count: 4 },
    { name: "Lass", count: 1 },
    { name: "PlusPower", count: 1 },
    { name: "Energy Retrieval", count: 2 },
    { name: "Switch", count: 1 },
    { name: "Potion", count: 3 },
    { name: "Gust of Wind", count: 1 },
    { name: "Energy Removal", count: 1 },
    { name: "Grass Energy", count: 10 },
    { name: "Fire Energy", count: 18 }
  ]
};

module.exports = { STARTER_DECKLISTS: STARTER_DECKLISTS };
```

- [ ] **Step 2: Write the failing test for `starterDeckGrants`**

Create `functions/test/starterDeckGrants.test.js`:

```javascript
const assert = require('assert');
const { starterDeckGrants } = require('../lib/pureEconomy');
const { STARTER_DECKLISTS } = require('../lib/starterDecks');
const CARD_CATALOG = require('../lib/cardCatalog');

['overgrowth', 'blackout', 'zap', 'brushfire'].forEach(function (deckKey) {
  var grants = starterDeckGrants(deckKey, CARD_CATALOG.base);
  var total = Object.keys(grants).reduce(function (sum, k) { return sum + grants[k]; }, 0);
  assert.strictEqual(total, 60, deckKey + ' grants exactly 60 cards total');
  Object.keys(grants).forEach(function (key) {
    assert.ok(/^base-/.test(key), deckKey + '\'s every grant key is a base-<num> print (got ' + key + ')');
  });
  console.log('PASS: starterDeckGrants(' + deckKey + ') grants exactly 60 base-print cards');
});

// Overgrowth's own decklist has 2 rows for the same eventual card (Weedle
// appears only once, but Water Energy/Grass Energy are single named
// entries too) -- the real cross-check is a card that legitimately repeats
// across two DIFFERENT decklist rows would be wrong; instead assert the
// known, hand-verified shape of one deck's grants directly, catching a
// wrong name->num lookup that a total-count check alone could miss.
var overgrowthGrants = starterDeckGrants('overgrowth', CARD_CATALOG.base);
var bulbasaurNum = CARD_CATALOG.base.find(function (c) { return c.n === 'Bulbasaur'; }).num;
assert.strictEqual(overgrowthGrants['base-' + bulbasaurNum], 4, 'overgrowth grants exactly 4 Bulbasaur');
var gyaradosNum = CARD_CATALOG.base.find(function (c) { return c.n === 'Gyarados'; }).num;
assert.strictEqual(overgrowthGrants['base-' + gyaradosNum], 1, 'overgrowth grants exactly 1 Gyarados');
console.log('PASS: starterDeckGrants(overgrowth) maps specific names to the correct base print counts');

assert.throws(function () { starterDeckGrants('not-a-real-deck', CARD_CATALOG.base); },
  'starterDeckGrants throws on an unknown deckKey (its caller must validate first, same as drawBoosterCards trusting its own caller)');
console.log('PASS: starterDeckGrants throws on an invalid deckKey');

console.log('ALL STARTER DECK GRANTS TESTS PASSED');
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node functions/test/starterDeckGrants.test.js`
Expected: `Error: Cannot find module '../lib/starterDecks'` or `starterDeckGrants is not a function` (whichever import resolves first) — confirms the test is exercising real, not-yet-written code.

- [ ] **Step 4: Implement `starterDeckGrants` in `pureEconomy.js`**

Open `functions/lib/pureEconomy.js`. Add this near `ownedCountsByName` (it's the same name-lookup idea, in reverse):

```javascript
// The inverse of ownedCountsByName: given one of the 4 real starter
// decklists (by name+count, see functions/lib/starterDecks.js) and the
// Base set's own catalog, returns {'base-<num>': count} grants ready to
// merge into a user doc's collection map -- same 'setKey-num' keying
// openBooster already uses. Throws on an unknown deckKey since this is
// only ever called after chooseStarterDeck's own onCall-level validation
// already accepted it (same trust boundary as drawBoosterCards trusting
// its own caller's setKey).
function starterDeckGrants(deckKey, cardCatalogBase) {
  var decklist = STARTER_DECKLISTS[deckKey];
  if (!decklist) { throw new Error('Unknown starter deckKey: ' + deckKey); }
  var nameToNum = {};
  cardCatalogBase.forEach(function (c) { nameToNum[c.n] = c.num; });
  var grants = {};
  decklist.forEach(function (entry) {
    var num = nameToNum[entry.name];
    if (!num) { throw new Error('Starter decklist name not in Base catalog: ' + entry.name); }
    var key = 'base-' + num;
    grants[key] = (grants[key] || 0) + entry.count;
  });
  return grants;
}
```

Add the require at the top of the file (near any existing requires — if this file currently has none, add it as the first line):

```javascript
const { STARTER_DECKLISTS } = require('./starterDecks');
```

Add `starterDeckGrants: starterDeckGrants,` to the `module.exports` object at the bottom of the file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node functions/test/starterDeckGrants.test.js`
Expected: `ALL STARTER DECK GRANTS TESTS PASSED` printed, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/starterDecks.js functions/lib/pureEconomy.js functions/test/starterDeckGrants.test.js
git commit -m "Add server-side starter decklists and pure grant computation"
```

---

### Task 2: `chooseStarterDeck` Cloud Function + `updateActiveDeck` lock

**Files:**
- Modify: `functions/index.js`
- Test: `functions/test/starterDeck.test.js`

**Interfaces:**
- Consumes: `starterDeckGrants(deckKey, cardCatalogBase)` from Task 1. `VALID_DECK_KEYS` (already exists in `functions/index.js`, line ~333: `['overgrowth', 'blackout', 'zap', 'brushfire']`) — reused as-is for both `chooseStarterDeck`'s and `updateActiveDeck`'s validation, no new constant needed.
- Produces: `chooseStarterDeck` onCall (request: `{deckKey: string}`, response: `{collection: object}`) — Task 3's client wrapper calls this by name. The `users/{uid}` doc gains `starterDeckChosen` (set to `null` at creation by `createAccount`, set to the chosen `deckKey` by `chooseStarterDeck`) — Task 3's `econState` reads this field.

- [ ] **Step 1: Write the failing integration tests**

First, confirm the Firebase emulators are runnable: `firebase emulators:start` (from the repo root) should start Auth (9099), Firestore (8080), and Functions (5001) — leave this running in a separate terminal/background process for this whole task. (If you're a subagent without a persistent second terminal, start it with `firebase emulators:start > /tmp/emulators.log 2>&1 &` and poll `curl -sf http://127.0.0.1:5001` until it responds before running tests.)

Create `functions/test/starterDeck.test.js`:

```javascript
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, deleteField } = require('firebase/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'starterDeckApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

// Directly clears a user doc's starterDeckChosen field entirely (bypassing
// firestore.rules) to simulate a grandfathered pre-feature account -- real
// grandfathered accounts simply never had this field written in the first
// place, this is a deterministic stand-in for that same state.
async function makeGrandfathered(uid) {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: { host: '127.0.0.1', port: 8080 }
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ starterDeckChosen: deleteField() });
  });
  await testEnv.cleanup();
}

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const chooseStarterDeck = httpsCallable(functions, 'chooseStarterDeck');
  const updateActiveDeck = httpsCallable(functions, 'updateActiveDeck');

  // --- Fresh account: starterDeckChosen starts out null ---
  const acct1 = await createAccount({ username: 'StarterTester1', email: 'startertester1@example.com', password: 'password123' });
  const uid1 = acct1.data.uid;
  await signInWithEmailAndPassword(auth, 'startertester1@example.com', 'password123');

  const userDocRef1 = doc(db, 'users', uid1);
  const freshSnap = await getDoc(userDocRef1);
  assert.strictEqual(freshSnap.data().starterDeckChosen, null, 'a freshly created account starts with starterDeckChosen: null');
  console.log('PASS: createAccount stamps new accounts with starterDeckChosen: null');

  const chooseRes = await chooseStarterDeck({ deckKey: 'overgrowth' });
  const totalGranted = Object.keys(chooseRes.data.collection).reduce(function (sum, k) { return sum + chooseRes.data.collection[k]; }, 0);
  assert.strictEqual(totalGranted, 60, 'choosing a starter deck grants exactly 60 cards');
  console.log('PASS: chooseStarterDeck grants exactly 60 cards');

  const afterChooseSnap = await getDoc(userDocRef1);
  assert.strictEqual(afterChooseSnap.data().starterDeckChosen, 'overgrowth', 'starterDeckChosen is locked to the chosen deck');
  assert.strictEqual(afterChooseSnap.data().activeDeck, 'overgrowth', 'activeDeck is also set to the chosen deck');
  console.log('PASS: chooseStarterDeck locks starterDeckChosen and sets activeDeck');

  // --- Double-choice is rejected ---
  try {
    await chooseStarterDeck({ deckKey: 'blackout' });
    assert.fail('expected a second chooseStarterDeck call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: chooseStarterDeck rejects a second choice from the same account');
  }

  // --- updateActiveDeck lock: the chosen precon still works, others don't ---
  const stillWorksRes = await updateActiveDeck({ deckKey: 'overgrowth' });
  assert.strictEqual(stillWorksRes.data.activeDeck, 'overgrowth', 'switching to the ALREADY-chosen precon still works (no-op)');
  console.log('PASS: updateActiveDeck still allows the chosen precon');

  try {
    await updateActiveDeck({ deckKey: 'blackout' });
    assert.fail('expected updateActiveDeck to a different, unchosen precon to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: updateActiveDeck rejects switching to a precon other than the one chosen');
  }

  // --- Invalid deckKey ---
  try {
    await chooseStarterDeck({ deckKey: 'not-a-real-deck' });
    assert.fail('expected an invalid deckKey to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: chooseStarterDeck rejects an invalid deckKey');
  }

  await auth.signOut();

  // --- Grandfathered account (no starterDeckChosen field at all) ---
  const acct2 = await createAccount({ username: 'StarterTester2', email: 'startertester2@example.com', password: 'password123' });
  const uid2 = acct2.data.uid;
  await makeGrandfathered(uid2);
  await signInWithEmailAndPassword(auth, 'startertester2@example.com', 'password123');

  try {
    await chooseStarterDeck({ deckKey: 'overgrowth' });
    assert.fail('expected a grandfathered account (no starterDeckChosen field) to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: chooseStarterDeck rejects a grandfathered account with no starterDeckChosen field');
  }

  const grandfatheredUpdateRes = await updateActiveDeck({ deckKey: 'blackout' });
  assert.strictEqual(grandfatheredUpdateRes.data.activeDeck, 'blackout', 'a grandfathered account can still freely switch precons, unaffected by the lock');
  console.log('PASS: updateActiveDeck is unaffected for a grandfathered account (zero behavior change)');

  await auth.signOut();
  try {
    await chooseStarterDeck({ deckKey: 'overgrowth' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: chooseStarterDeck requires auth');
  }

  console.log('ALL STARTER DECK TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node functions/test/starterDeck.test.js` (with emulators running)
Expected: fails on the very first assertion (`createAccount` doesn't yet set `starterDeckChosen`) or with `chooseStarterDeck is not a function`/a 404-style callable-not-found error — confirms the test exercises not-yet-written behavior.

- [ ] **Step 3: Add `starterDeckChosen: null` to `createAccount`**

In `functions/index.js`, find the `createAccount` function's `batch.set` call (around line 112):

```javascript
  batch.set(db.collection('users').doc(uid), {
    username: username,
    coins: 150,
    collection: {},
    createdAt: FieldValue.serverTimestamp()
  });
```

Change it to:

```javascript
  batch.set(db.collection('users').doc(uid), {
    username: username,
    coins: 150,
    collection: {},
    starterDeckChosen: null,
    createdAt: FieldValue.serverTimestamp()
  });
```

- [ ] **Step 4: Add the `chooseStarterDeck` import and function**

Near the top of `functions/index.js`, find the existing destructured require from `./lib/pureEconomy` (around line 5-6):

```javascript
const {
  computeMatchReward, BOOSTER_COST, drawBoosterCards, drawCustomPackCards, PROTECTOR_COST, PROTECTOR_IDS,
  CUSTOM_DECK_SLOTS, ownedCountsByName, supertypeByName, validateCustomDeck
} = require('./lib/pureEconomy');
```

Add `starterDeckGrants` to that list:

```javascript
const {
  computeMatchReward, BOOSTER_COST, drawBoosterCards, drawCustomPackCards, PROTECTOR_COST, PROTECTOR_IDS,
  CUSTOM_DECK_SLOTS, ownedCountsByName, supertypeByName, validateCustomDeck, starterDeckGrants
} = require('./lib/pureEconomy');
```

Add the new function right after `openBooster` (which ends around line 214 with `});`) — it follows the exact same shape (onCall, requires auth, validates input, transactional grant):

```javascript
// The starter-deck counterpart to openBooster: grants a fixed, known
// 60-card decklist instead of a random pull, but the same trust boundary
// applies -- the grant is entirely server-computed (starterDeckGrants,
// pureEconomy.js) from a server-side decklist copy, never from anything
// the client sends. The transaction's own starterDeckChosen check (must be
// exactly null, not absent and not already a string) is the real
// enforcement of "choose once, permanently" -- the client-side mandatory
// screen (ui.js) is UX only.
exports.chooseStarterDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const deckKey = (request.data || {}).deckKey;
  if (VALID_DECK_KEYS.indexOf(deckKey) === -1) {
    throw new HttpsError('invalid-argument', 'Mazo inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const grants = starterDeckGrants(deckKey, CARD_CATALOG.base);

  const newCollection = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : {};
    if (data.starterDeckChosen !== null) {
      throw new HttpsError('failed-precondition', 'Ya elegiste tu mazo inicial.');
    }
    const updatedCollection = Object.assign({}, data.collection);
    Object.keys(grants).forEach(function (key) {
      updatedCollection[key] = (updatedCollection[key] || 0) + grants[key];
    });
    tx.update(userRef, {
      collection: updatedCollection,
      starterDeckChosen: deckKey,
      activeDeck: deckKey
    });
    return updatedCollection;
  });

  return { collection: newCollection };
});
```

Note: `VALID_DECK_KEYS` and `CARD_CATALOG` are already defined earlier in this file (lines ~333 and ~8 respectively) — since `chooseStarterDeck` is being inserted right after `openBooster` (which is defined *before* `VALID_DECK_KEYS` at line 333), either move `VALID_DECK_KEYS`'s declaration up above `openBooster`, or place `chooseStarterDeck` right after `updateActiveDeck` instead (both are valid — placing it after `updateActiveDeck`, around line 364, avoids moving any existing code and is the simpler choice).

- [ ] **Step 5: Add the lock check to `updateActiveDeck`**

In `functions/index.js`, find `updateActiveDeck` (around line 335):

```javascript
exports.updateActiveDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const deckKey = (request.data || {}).deckKey;
  const uid = request.auth.uid;

  if (VALID_DECK_KEYS.indexOf(deckKey) !== -1) {
    await admin.firestore().collection('users').doc(uid).set({ activeDeck: deckKey }, { merge: true });
    return { activeDeck: deckKey };
  }
```

Replace that precon branch (leave the `CUSTOM_DECK_SLOTS` branch below it untouched) with a transactional version that checks the lock:

```javascript
exports.updateActiveDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const deckKey = (request.data || {}).deckKey;
  const uid = request.auth.uid;

  // Once starterDeckChosen is a real deckKey (not null, not absent), the
  // player may only ever have THAT precon as their active deck -- switching
  // to any of the other 3 unpicked precons is blocked here, the real
  // enforcement point (the Decks screen's own click handler, ui.js, is UX
  // only and could be bypassed by calling this function directly). A
  // grandfathered account (starterDeckChosen absent/undefined) is
  // completely unaffected -- the check below only ever fires when the
  // field is a non-null string that differs from the requested deckKey.
  if (VALID_DECK_KEYS.indexOf(deckKey) !== -1) {
    const userRef = admin.firestore().collection('users').doc(uid);
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const uData = snap.exists ? snap.data() : {};
      if (uData.starterDeckChosen && uData.starterDeckChosen !== deckKey) {
        throw new HttpsError('failed-precondition', 'Ya elegiste tu mazo inicial -- no puedes cambiarte a otro precon.');
      }
      tx.set(userRef, { activeDeck: deckKey }, { merge: true });
    });
    return { activeDeck: deckKey };
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node functions/test/starterDeck.test.js` (with emulators still running)
Expected: `ALL STARTER DECK TESTS PASSED` printed, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add functions/index.js functions/test/starterDeck.test.js
git commit -m "Add chooseStarterDeck Cloud Function and lock updateActiveDeck to the chosen precon"
```

---

### Task 3: Client data layer + mandatory starter-deck screen

**Files:**
- Modify: `economy.js`
- Modify: `index.html`
- Modify: `shell-theme.css`
- Modify: `ui.js`
- Modify: `auth-ui.js`

**Interfaces:**
- Consumes: `chooseStarterDeck` onCall from Task 2. `DECKLISTS`/`PRECON_DECK_KEYS`/`DECK_DISPLAY_NAME`/`deckComposition` (all already exist in `data-decks.js`/`ui.js`).
- Produces: `econState.starterDeckChosen` (`undefined | null | string`) — Task 4's Decks-screen lock reads this. `chooseStarterDeckCloud(deckKey)` (economy.js) — thin wrapper, `firebase.functions().httpsCallable('chooseStarterDeck')({deckKey: deckKey})`.

- [ ] **Step 1: Add `starterDeckChosen` to `econState`**

In `economy.js`, find the `econState = {...}` line inside `initEconomyListener` (around line 22):

```javascript
      econState = { coins: data.coins, collection: data.collection || {}, collectionHolo: data.collectionHolo || {}, collectionSecret: data.collectionSecret || {}, activeDeck: data.activeDeck || 'overgrowth', cardBacks: data.cardBacks || [], customDecks: data.customDecks || {}, pendingCodePacks: data.pendingCodePacks || [] };
```

Add `starterDeckChosen: data.starterDeckChosen` — deliberately with **no** `|| default`, so a grandfathered account (field absent in Firestore) keeps `econState.starterDeckChosen === undefined`, distinct from a post-feature account's explicit `null`:

```javascript
      econState = { coins: data.coins, collection: data.collection || {}, collectionHolo: data.collectionHolo || {}, collectionSecret: data.collectionSecret || {}, activeDeck: data.activeDeck || 'overgrowth', cardBacks: data.cardBacks || [], customDecks: data.customDecks || {}, pendingCodePacks: data.pendingCodePacks || [], starterDeckChosen: data.starterDeckChosen };
```

- [ ] **Step 2: Add the `chooseStarterDeckCloud` wrapper**

In `economy.js`, add this near `updateActiveDeckCloud` (whichever exact wrapper style neighbors it uses — match it):

```javascript
function chooseStarterDeckCloud(deckKey) {
  return firebase.functions().httpsCallable('chooseStarterDeck')({ deckKey: deckKey })
    .then(function (res) { return res.data; });
}
```

- [ ] **Step 3: Add the new screen markup to `index.html`**

Add this new screen right before the `<!-- ===== SELECCIÓN DE MAZO ===== -->` / `decksScreen` block (so it's grouped with the other full-screens):

```html
  <!-- ===== MAZO INICIAL (obligatorio, una sola vez) ===== -->
  <div id="starterDeckScreen" class="hidden">
    <div class="shell-viewport">
      <div class="shell-stage">
        <div class="shell-stage-overlay"></div>

        <div class="shell-page">
          <div class="shell-page-header">
            <div class="shell-page-spacer"></div>
            <div class="shell-page-title">ELIGE TU MAZO INICIAL</div>
            <div class="shell-page-spacer"></div>
          </div>

          <p class="shell-starter-deck-intro">Esta elección es permanente -- las 60 cartas del mazo que elijas pasarán a ser tuyas. No podrás elegir otro más adelante.</p>

          <div class="shell-decks-body">
            <div class="shell-starter-deck-grid" id="starterDeckGrid">
              <div class="shell-deck-card" data-starter-deck="overgrowth">
                <div class="shell-deck-card-stripe deck-overgrowth"></div>
                <div class="shell-deck-card-art"><img src="Mazos/overgrowth.png" alt="Caja del mazo Overgrowth"></div>
                <div class="shell-deck-card-body">
                  <div class="shell-deck-card-name">OVERGROWTH</div>
                  <div class="shell-deck-card-types">PLANTA · AGUA</div>
                  <div class="shell-deck-card-spacer"></div>
                  <div class="shell-deck-card-footer"><span class="shell-deck-card-count">60 CARTAS</span></div>
                </div>
                <button type="button" class="shell-starter-deck-pick-btn" data-starter-deck="overgrowth">ELEGIR</button>
              </div>
              <div class="shell-deck-card" data-starter-deck="blackout">
                <div class="shell-deck-card-stripe deck-blackout"></div>
                <div class="shell-deck-card-art"><img src="Mazos/blackout.png" alt="Caja del mazo Blackout"></div>
                <div class="shell-deck-card-body">
                  <div class="shell-deck-card-name">BLACKOUT</div>
                  <div class="shell-deck-card-types">AGUA · LUCHA</div>
                  <div class="shell-deck-card-spacer"></div>
                  <div class="shell-deck-card-footer"><span class="shell-deck-card-count">60 CARTAS</span></div>
                </div>
                <button type="button" class="shell-starter-deck-pick-btn" data-starter-deck="blackout">ELEGIR</button>
              </div>
              <div class="shell-deck-card" data-starter-deck="zap">
                <div class="shell-deck-card-stripe deck-zap"></div>
                <div class="shell-deck-card-art"><img src="Mazos/zap.png" alt="Caja del mazo Zap!"></div>
                <div class="shell-deck-card-body">
                  <div class="shell-deck-card-name">ZAP!</div>
                  <div class="shell-deck-card-types">RAYO · PSÍQUICO</div>
                  <div class="shell-deck-card-spacer"></div>
                  <div class="shell-deck-card-footer"><span class="shell-deck-card-count">60 CARTAS</span></div>
                </div>
                <button type="button" class="shell-starter-deck-pick-btn" data-starter-deck="zap">ELEGIR</button>
              </div>
              <div class="shell-deck-card" data-starter-deck="brushfire">
                <div class="shell-deck-card-stripe deck-brushfire"></div>
                <div class="shell-deck-card-art"><img src="Mazos/brushfire.png" alt="Caja del mazo Brushfire"></div>
                <div class="shell-deck-card-body">
                  <div class="shell-deck-card-name">BRUSHFIRE</div>
                  <div class="shell-deck-card-types">FUEGO · PLANTA</div>
                  <div class="shell-deck-card-spacer"></div>
                  <div class="shell-deck-card-footer"><span class="shell-deck-card-count">60 CARTAS</span></div>
                </div>
                <button type="button" class="shell-starter-deck-pick-btn" data-starter-deck="brushfire">ELEGIR</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="starterDeckConfirmModal" class="card-modal hidden">
    <div class="card-modal-backdrop"></div>
    <div class="shell-modal-card">
      <p class="shell-modal-title">¿SEGURO?</p>
      <p class="shell-modal-text" id="starterDeckConfirmText"></p>
      <div class="shell-modal-actions">
        <button type="button" id="starterDeckConfirmYes" class="shell-modal-btn shell-modal-btn-primary">SÍ, ELEGIR ESTE MAZO</button>
        <button type="button" id="starterDeckConfirmNo" class="shell-modal-btn">VOLVER A MIRAR</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Add CSS for the new screen**

In `shell-theme.css`, add near the existing `.shell-logout`/decks-related rules:

```css
.shell-starter-deck-intro{
  text-align:center;font-size:13px;color:#c9bfae;max-width:640px;margin:0 auto 24px;line-height:1.5;
}
.shell-starter-deck-grid{
  display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:0 40px;
}
.shell-starter-deck-pick-btn{
  margin:12px 16px 16px;padding:10px 0;cursor:pointer;
  font-family:'Silkscreen',monospace;font-size:12px;letter-spacing:.1em;color:#efe9dd;
  border:1px solid #0b0907;border-radius:4px;
  background:linear-gradient(180deg,#4a7a2f,#2f4d1e);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 3px 0 #100e0b;
}
.shell-starter-deck-pick-btn:hover{filter:brightness(1.2);}
.shell-starter-deck-pick-btn:focus-visible{box-shadow:inset 0 0 0 2px #8dff62;}
```

- [ ] **Step 5: Render + wire the new screen in `ui.js`**

Add near `showDecksScreen`/`selectDeckCard` (any reasonable spot in the Decks-related section):

```javascript
function showStarterDeckScreen() {
  document.getElementById('menuScreen').classList.add('hidden');
  document.getElementById('starterDeckScreen').classList.remove('hidden');
}

function hideStarterDeckScreen() {
  document.getElementById('starterDeckScreen').classList.add('hidden');
}

var starterDeckPendingChoice = null;

function wireStarterDeckScreen() {
  document.querySelectorAll('.shell-starter-deck-pick-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var deckKey = btn.getAttribute('data-starter-deck');
      starterDeckPendingChoice = deckKey;
      var name = DECK_DISPLAY_NAME[deckKey] || deckKey;
      document.getElementById('starterDeckConfirmText').textContent =
        'Vas a elegir ' + name + ' como tu mazo inicial. Esta elección es permanente y no podrás cambiarla después. ¿Confirmas?';
      document.getElementById('starterDeckConfirmModal').classList.remove('hidden');
    });
  });

  document.getElementById('starterDeckConfirmNo').addEventListener('click', function () {
    starterDeckPendingChoice = null;
    document.getElementById('starterDeckConfirmModal').classList.add('hidden');
  });

  document.getElementById('starterDeckConfirmYes').addEventListener('click', function () {
    if (!starterDeckPendingChoice) { return; }
    var deckKey = starterDeckPendingChoice;
    var yesBtn = document.getElementById('starterDeckConfirmYes');
    yesBtn.disabled = true;
    chooseStarterDeckCloud(deckKey)
      .then(function (res) {
        if (econState) {
          econState.collection = res.collection;
          econState.starterDeckChosen = deckKey;
          econState.activeDeck = deckKey;
        }
        yesBtn.disabled = false;
        document.getElementById('starterDeckConfirmModal').classList.add('hidden');
        hideStarterDeckScreen();
        showMenu();
      })
      .catch(function (e) {
        yesBtn.disabled = false;
        document.getElementById('starterDeckConfirmText').textContent =
          (e && e.message) || 'No se pudo guardar tu elección. Intenta de nuevo.';
      });
  });
}
```

`ui.js` has exactly one `document.addEventListener('DOMContentLoaded', function () { ... })` block (starts at line 6000) that does all of this kind of one-time button wiring — the `menuDeck`/`decksBackBtn`/`.shell-deck-card[data-deck]` wiring shown in Step 1 above lives inside it (around line 6262). Add `wireStarterDeckScreen();` anywhere inside that same `DOMContentLoaded` callback (e.g. right next to the other Decks-screen wiring), so the listeners are attached exactly once, at startup.

- [ ] **Step 6: Gate the menu in `auth-ui.js`**

In `auth-ui.js`'s `onAuthStateChanged` (around line 305-317), the logged-in branch currently does:

```javascript
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('menuScreen').classList.remove('hidden');
        checkLiveDuelBanner();
        showAccountVerifyingOverlay();
        if (unsubscribeEconomy) { unsubscribeEconomy(); }
        unsubscribeEconomy = initEconomyListener(user.uid, hideAccountVerifyingOverlay);
```

`econState` isn't populated yet at this point (`initEconomyListener` is async) — the gate has to happen in the `onFirstLoad` callback, once `econState` is real. Change it to:

```javascript
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('menuScreen').classList.remove('hidden');
        checkLiveDuelBanner();
        showAccountVerifyingOverlay();
        if (unsubscribeEconomy) { unsubscribeEconomy(); }
        unsubscribeEconomy = initEconomyListener(user.uid, function () {
          hideAccountVerifyingOverlay();
          // econState.starterDeckChosen === null (not undefined) means this
          // account was created after the starter-deck feature shipped and
          // hasn't chosen yet -- a grandfathered account's field is simply
          // absent (undefined), which deliberately does NOT trigger this.
          if (econState && econState.starterDeckChosen === null) {
            showStarterDeckScreen();
          }
        });
```

- [ ] **Step 7: Manual verification**

No automated test harness covers full-screen UI flows in this project (matches this codebase's existing convention — every other screen/modal is manually verified too). Run through this checklist in a real browser against the Firebase emulators (or a test project):

1. Create a brand-new account. Confirm `starterDeckScreen` appears immediately (menu never becomes interactive first) and cannot be dismissed (no close button, clicking the backdrop does nothing).
2. Click "ELEGIR" on any deck. Confirm the confirmation modal appears with the correct deck name in its text.
3. Click "VOLVER A MIRAR". Confirm the confirm modal closes and the starter-deck screen is still showing (choice not yet made).
4. Click "ELEGIR" again, then "SÍ, ELEGIR ESTE MAZO". Confirm: the screen closes, the normal menu appears, and (via the Colección screen or DevTools) the chosen deck's 60 cards are now genuinely present in the player's collection.
5. Log out and back in with the same account. Confirm the starter-deck screen does NOT appear again (already chosen).
6. Using an account that existed before this feature (or one with `starterDeckChosen` manually deleted via the Firestore emulator UI), log in. Confirm the starter-deck screen never appears and the menu behaves exactly as before.

- [ ] **Step 8: Commit**

```bash
git add economy.js index.html shell-theme.css ui.js auth-ui.js
git commit -m "Add the mandatory starter-deck selection screen"
```

---

### Task 4: Decks-screen precon lock + final regression check

**Files:**
- Modify: `ui.js`

**Interfaces:**
- Consumes: `econState.starterDeckChosen` (Task 3), `selectDeckCard(deckKey)` and the existing Decks-screen precon click handler (both already exist, ~line 4222 and ~line 6262).

- [ ] **Step 1: Intercept the Decks-screen precon click handler**

In `ui.js`, find the existing click-wiring loop (around line 6262):

```javascript
  document.querySelectorAll('.shell-deck-card[data-deck]').forEach(function (el) {
    var elDeckKey = el.getAttribute('data-deck');
    if (!DECKLISTS[elDeckKey]) { return; }
    el.addEventListener('click', function () {
      selectDeckCard(elDeckKey);
    });
  });
```

Change the click handler to check the lock first, for precons only (custom decks and the "new deck" card are never affected):

```javascript
  document.querySelectorAll('.shell-deck-card[data-deck]').forEach(function (el) {
    var elDeckKey = el.getAttribute('data-deck');
    if (!DECKLISTS[elDeckKey]) { return; }
    el.addEventListener('click', function () {
      // Once a starter deck is chosen (a real deckKey, not null/undefined),
      // the other 3 precons stay visible but can't become the active deck
      // -- the real enforcement is server-side (updateActiveDeck's own
      // lock, functions/index.js); this is just UX so the player isn't
      // confused by a click that would silently fail on Guardar.
      var chosen = econState && econState.starterDeckChosen;
      var isLockedPrecon = chosen && PRECON_DECK_KEYS.indexOf(elDeckKey) !== -1 && elDeckKey !== chosen;
      if (isLockedPrecon) {
        showTargetHintModal('Ya elegiste tu mazo inicial -- este precon está bloqueado.');
        return;
      }
      selectDeckCard(elDeckKey);
    });
  });
```

- [ ] **Step 2: Manual verification**

1. Using the account from Task 3's checklist (already chose Overgrowth), open the Decks screen. Confirm Blackout/Zap!/Brushfire still appear in the list (box art, name, card count all visible, same as before).
2. Click Blackout. Confirm the hint modal appears ("Ya elegiste tu mazo inicial...") and Blackout does NOT become the previewed/selected deck.
3. Click Overgrowth (the chosen one). Confirm it selects normally, exactly as before this plan.
4. Create and save a custom deck (any of the 4 slots). Confirm selecting it works exactly as before — the lock never applies to custom decks.
5. Using a grandfathered account (no `starterDeckChosen` field), open the Decks screen. Confirm all 4 precons remain freely clickable/selectable, exactly as before this plan.

- [ ] **Step 3: Final regression check**

Run: `node run-tests.js`
Expected: `739 PASS, 0 FAIL`, exit code 0 — this feature doesn't touch `rules-engine.js` or anything else that suite covers, so this is a pure regression check.

- [ ] **Step 4: Commit**

```bash
git add ui.js
git commit -m "Lock the other 3 precons on the Decks screen once a starter deck is chosen"
```
