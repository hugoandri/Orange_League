# Shop Deck Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "MAZOS" tab to the Shop selling the 4 preconstructed decks for 1500 Orbes each; buying one grants its real 60 cards and makes it usable everywhere a deck can be selected (local play, Decks screen, PVP), alongside the player's free starter-deck choice.

**Architecture:** A new `ownedPrecons` array field on the user doc tracks every precon a player has legitimately acquired (seeded with the starter choice, appended to by purchases). A new `buyDeck` Cloud Function mirrors `buyCardBack`'s exact idempotent-purchase shape. The 4 existing places that lock deck selection to the single `starterDeckChosen` value get their check widened to an array-membership test against `ownedPrecons`, guarded by the same `starterDeckChosen &&` short-circuit that already keeps grandfathered accounts fully unaffected.

**Tech Stack:** Firebase Cloud Functions (`onCall`, Firestore transactions), plain browser JS (`ui.js`/`economy.js`), existing `.shell-shop-tab`/`.shell-shop-panel`/`.shell-shop-card` CSS (no new CSS needed — fully reusable as-is).

**Spec:** docs/superpowers/specs/2026-09-22-shop-deck-purchases-design.md

## Global Constraints

- Buying a deck grants the exact same 60 real cards `chooseStarterDeck` already grants — reuse `starterDeckGrants` verbatim, no new grant logic.
- A deck the player already owns (via starter choice OR a previous purchase) must never be charged for again — idempotent (matches `buyCardBack`'s exact pattern: silent success, no error, no charge), not an error.
- Grandfathered accounts (no `starterDeckChosen` field) must see zero behavior change at every one of the 4 lock points — the `starterDeckChosen &&` guard must always be checked BEFORE any `ownedPrecons` membership check, never the reverse.
- `node run-tests.js` must stay 739 PASS / 0 FAIL / exit 0 at the end.

---

## File Structure

- `functions/index.js` (**modify**) — `createAccount` gains `ownedPrecons: []`; `chooseStarterDeck` seeds `ownedPrecons: [deckKey]`; `fetchEconomyConfig` gains `deckCosts`; new `buyDeck` onCall function; `updateActiveDeck` and `validateDeckId`'s precon-lock checks widen from single-value equality to array membership.
- `functions/test/buyDeck.test.js` (**new**) — emulator-based integration tests for the new `buyDeck` function.
- `functions/test/starterDeckOwnership.test.js` (**new**) — emulator-based integration tests proving a second bought deck becomes usable at the 2 server-side lock points (`updateActiveDeck`, `validateDeckId`/`resolvePvpIdentity`), and that a still-unbought third deck stays rejected.
- `economy.js` (**modify**) — `econState` gains `ownedPrecons`; new `buyDeckCloud(deckKey)` wrapper; new `getDeckCost(deckKey)` helper.
- `index.html` (**modify**) — new `data-shop-tab="mazos"` tab button and `shopDecksPanel` panel, following the exact existing PACKS/PROTECTORES structure.
- `ui.js` (**modify**) — `showShopTab` toggles the new panel; new `renderShopDecksGrid()` (mirrors `renderProtectorsGrid()`); the Decks-screen click handler's `isLockedPrecon` check and `renderPvpDeckPicker`'s `lockedPrecon`/`preconKeys` computation widen to array membership.

---

### Task 1: `buyDeck` Cloud Function + `ownedPrecons` seeding

**Files:**
- Modify: `functions/index.js`
- Test: `functions/test/buyDeck.test.js`

**Interfaces:**
- Consumes: `starterDeckGrants(deckKey, cardCatalogBase)` (`functions/lib/pureEconomy.js`, already exists, unchanged), `VALID_DECK_KEYS` (`functions/index.js`, already exists — `['overgrowth', 'blackout', 'zap', 'brushfire']`), `CARD_CATALOG` (already required at the top of the file).
- Produces: `buyDeck` onCall (request: `{deckKey: string}`, response: `{collection: object, ownedPrecons: string[], coins: number}`). `users/{uid}.ownedPrecons` (`string[]`) — Task 2's lock-point updates and Task 3's client both read this field. `createAccount` now seeds `ownedPrecons: []`; `chooseStarterDeck` now seeds `ownedPrecons: [deckKey]` in the same transaction that already sets `starterDeckChosen`.

- [ ] **Step 1: Write the failing test**

Create `functions/test/buyDeck.test.js`:

```javascript
// Tests the new buyDeck Cloud Function: a flat-price (1500 Orbes by
// default), idempotent-if-already-owned purchase of one of the 4 real
// precons -- mirrors buyCardBack's exact shape (functions/index.js),
// tested here the same way functions/test/starterDeck.test.js tests
// chooseStarterDeck.
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'buyDeckApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const chooseStarterDeck = httpsCallable(functions, 'chooseStarterDeck');
  const buyDeck = httpsCallable(functions, 'buyDeck');

  const acct = await createAccount({ username: 'BuyDeckTester1', email: 'buydecktester1@example.com', password: 'password123' });
  const uid = acct.data.uid;
  await signInWithEmailAndPassword(auth, 'buydecktester1@example.com', 'password123');

  const userDocRef = doc(db, 'users', uid);
  const freshSnap = await getDoc(userDocRef);
  assert.deepStrictEqual(freshSnap.data().ownedPrecons, [], 'a freshly created account starts with an empty ownedPrecons array');
  console.log('PASS: createAccount seeds ownedPrecons: []');

  await chooseStarterDeck({ deckKey: 'overgrowth' });
  const afterChooseSnap = await getDoc(userDocRef);
  assert.deepStrictEqual(afterChooseSnap.data().ownedPrecons, ['overgrowth'], 'choosing a starter deck seeds ownedPrecons with that deck');
  console.log('PASS: chooseStarterDeck seeds ownedPrecons: [deckKey]');

  // Coins from chooseStarterDeck's free grant: still 150 (the signup
  // default) since choosing a starter deck has never cost coins.
  const coinsBeforeBuy = afterChooseSnap.data().coins;
  assert.strictEqual(coinsBeforeBuy, 150, 'the starter choice itself is free -- coins are unaffected');

  // --- Not enough coins ---
  try {
    await buyDeck({ deckKey: 'blackout' });
    assert.fail('expected buyDeck to reject an account with insufficient coins (150 < 1500)');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: buyDeck rejects an account with insufficient coins');
  }

  // Give the account enough coins directly (bypassing the real economy
  // flow -- deterministic setup, same technique every other test file in
  // this suite already uses for seeding state).
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ coins: 5000 });
  });
  await testEnv.cleanup();

  // --- Successful purchase ---
  const buyRes = await buyDeck({ deckKey: 'blackout' });
  const totalGranted = Object.keys(buyRes.data.collection).reduce(function (sum, k) { return sum + buyRes.data.collection[k]; }, 0);
  assert.strictEqual(totalGranted, 120, 'after buying a 2nd deck, the collection holds both decks worth of cards (60 + 60 = 120)');
  assert.deepStrictEqual(buyRes.data.ownedPrecons.sort(), ['blackout', 'overgrowth'], 'ownedPrecons now includes both the starter choice and the purchase');
  assert.strictEqual(buyRes.data.coins, 5000 - 1500, 'exactly 1500 coins were deducted');
  console.log('PASS: buyDeck grants 60 cards, adds the deck to ownedPrecons, and deducts exactly 1500 coins');

  // --- Idempotent: buying the same deck again is a no-op, not an error ---
  const rebuyRes = await buyDeck({ deckKey: 'blackout' });
  assert.strictEqual(rebuyRes.data.coins, 5000 - 1500, 'buying an already-owned deck again does not charge a second time');
  assert.deepStrictEqual(rebuyRes.data.ownedPrecons.sort(), ['blackout', 'overgrowth'], 'ownedPrecons is unchanged by a repeat purchase');
  console.log('PASS: buyDeck is idempotent -- buying an already-owned deck again does not charge or error');

  // --- Invalid deckKey ---
  try {
    await buyDeck({ deckKey: 'not-a-real-deck' });
    assert.fail('expected an invalid deckKey to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/invalid-argument');
    console.log('PASS: buyDeck rejects an invalid deckKey');
  }

  await auth.signOut();
  try {
    await buyDeck({ deckKey: 'overgrowth' });
    assert.fail('expected unauthenticated call to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/unauthenticated');
    console.log('PASS: buyDeck requires auth');
  }

  console.log('ALL BUY DECK TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Start the Firebase emulators (leave running for the rest of this task): `firebase emulators:start --project demo-test --only auth,functions,firestore`. The bare `firebase emulators:start` picks up the real `pokemon-tcg-simulador` project id from `.firebaserc` and 404s every callable — always pass `--project demo-test` explicitly. Port 5000 (Hosting) often conflicts with macOS's AirPlay Receiver, hence `--only auth,functions,firestore`.

Run: `node functions/test/buyDeck.test.js`
Expected: fails on the very first assertion (`createAccount` doesn't yet set `ownedPrecons`) or with a "no function named buyDeck" style error.

- [ ] **Step 3: Add `ownedPrecons: []` to `createAccount`**

In `functions/index.js`, find `createAccount`'s `batch.set` call:

```javascript
  batch.set(db.collection('users').doc(uid), {
    username: username,
    coins: 150,
    collection: {},
    starterDeckChosen: null,
    createdAt: FieldValue.serverTimestamp()
  });
```

Add `ownedPrecons: []`:

```javascript
  batch.set(db.collection('users').doc(uid), {
    username: username,
    coins: 150,
    collection: {},
    starterDeckChosen: null,
    ownedPrecons: [],
    createdAt: FieldValue.serverTimestamp()
  });
```

- [ ] **Step 4: Seed `ownedPrecons` in `chooseStarterDeck`**

In `functions/index.js`, find `chooseStarterDeck`'s transaction (`exports.chooseStarterDeck`, the `tx.update` call inside it):

```javascript
    tx.update(userRef, {
      collection: updatedCollection,
      starterDeckChosen: deckKey,
      activeDeck: deckKey
    });
```

Add `ownedPrecons: [deckKey]`:

```javascript
    tx.update(userRef, {
      collection: updatedCollection,
      starterDeckChosen: deckKey,
      activeDeck: deckKey,
      ownedPrecons: [deckKey]
    });
```

(A plain overwrite, not an append, is correct here — this transaction already rejected any account where `starterDeckChosen !== null`, so `ownedPrecons` is guaranteed empty at this point; there is nothing to preserve.)

- [ ] **Step 5: Add `deckCosts` to `fetchEconomyConfig`**

In `functions/index.js`, find `fetchEconomyConfig`:

```javascript
async function fetchEconomyConfig() {
  const snap = await admin.firestore().collection('config').doc('economy').get();
  const data = snap.exists ? snap.data() : {};
  return {
    boosterCosts: Object.assign({ base: 100, jungle: 100, fossil: 100 }, data.boosterCosts || {}),
    protectorCosts: Object.assign({}, data.protectorCosts || {}),
    starsPackages: Object.assign({}, STARS_PACKAGES, data.starsPackages || {})
  };
}
```

Add `deckCosts`:

```javascript
async function fetchEconomyConfig() {
  const snap = await admin.firestore().collection('config').doc('economy').get();
  const data = snap.exists ? snap.data() : {};
  return {
    boosterCosts: Object.assign({ base: 100, jungle: 100, fossil: 100 }, data.boosterCosts || {}),
    protectorCosts: Object.assign({}, data.protectorCosts || {}),
    starsPackages: Object.assign({}, STARS_PACKAGES, data.starsPackages || {}),
    deckCosts: Object.assign({ overgrowth: 1500, blackout: 1500, zap: 1500, brushfire: 1500 }, data.deckCosts || {})
  };
}
```

- [ ] **Step 6: Add the `buyDeck` function**

In `functions/index.js`, add this new function right after `chooseStarterDeck` (which ends with `});` around line 422) — it follows `buyCardBack`'s exact idempotent-purchase shape, but grants a fixed 60-card decklist (via `starterDeckGrants`, already imported) instead of appending a cosmetic id:

```javascript
// A precon a player already owns (via the free starter choice OR a
// previous purchase here) can never be bought again -- mirrors
// buyCardBack's exact idempotent shape (silent success, no charge, no
// error) rather than throwing, so a stale "COMPRAR" button or a double-
// click can never double-charge. The actual card grant reuses
// starterDeckGrants verbatim (the same server-side-only computation
// chooseStarterDeck already relies on) -- buying a deck grants EXACTLY
// what choosing it as your starter deck would have.
exports.buyDeck = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const deckKey = (request.data || {}).deckKey;
  if (VALID_DECK_KEYS.indexOf(deckKey) === -1) {
    throw new HttpsError('invalid-argument', 'Mazo inválido.');
  }

  const userRef = admin.firestore().collection('users').doc(request.auth.uid);
  const ecoConfig = await fetchEconomyConfig();
  const cost = (ecoConfig.deckCosts && typeof ecoConfig.deckCosts[deckKey] === 'number')
    ? ecoConfig.deckCosts[deckKey]
    : 1500;
  const grants = starterDeckGrants(deckKey, CARD_CATALOG.base);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() : null;
    if (!data) {
      throw new HttpsError('failed-precondition', 'Cuenta no encontrada.');
    }
    const owned = Array.isArray(data.ownedPrecons) ? data.ownedPrecons : [];
    if (owned.indexOf(deckKey) !== -1) {
      return { collection: data.collection || {}, ownedPrecons: owned, coins: data.coins };
    }
    if (data.coins < cost) {
      throw new HttpsError('failed-precondition', 'No tienes suficientes Orbes.');
    }
    const updatedCollection = Object.assign({}, data.collection);
    Object.keys(grants).forEach(function (key) {
      updatedCollection[key] = (updatedCollection[key] || 0) + grants[key];
    });
    const newOwnedPrecons = owned.concat([deckKey]);
    const newCoins = data.coins - cost;
    tx.update(userRef, {
      coins: newCoins,
      collection: updatedCollection,
      ownedPrecons: newOwnedPrecons
    });
    return { collection: updatedCollection, ownedPrecons: newOwnedPrecons, coins: newCoins };
  });
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node functions/test/buyDeck.test.js` (emulators still running)
Expected: `ALL BUY DECK TESTS PASSED`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add functions/index.js functions/test/buyDeck.test.js
git commit -m "Add buyDeck Cloud Function and ownedPrecons seeding"
```

---

### Task 2: Widen the 4 lock points from single-value to array membership

**Files:**
- Modify: `functions/index.js` (`updateActiveDeck`, `validateDeckId`)
- Modify: `ui.js` (Decks-screen click handler, `renderPvpDeckPicker`)
- Test: `functions/test/starterDeckOwnership.test.js`

**Interfaces:**
- Consumes: `buyDeck` onCall (Task 1) — this task's test uses it to set up a fixture account that owns 2 precons. `ownedPrecons` field (Task 1) — read (never written) by all 4 sites in this task.
- Produces: nothing new — this task only widens existing checks. Task 3's client relies on `renderPvpDeckPicker`'s and the Decks-screen's widened behavior already being correct by the time it ships the buy UI.

- [ ] **Step 1: Write the failing server-side test**

Create `functions/test/starterDeckOwnership.test.js` (this covers the 2 server-side lock points; the 2 client-side ones from `ui.js` are verified manually in Step 6, matching this codebase's established convention for UI-only logic):

```javascript
// Proves a SECOND owned precon (acquired via buyDeck, not just the free
// starter choice) becomes usable at both server-side lock points --
// updateActiveDeck (local play) and validateDeckId/resolvePvpIdentity
// (PVP room creation/joining) -- while a still-unbought THIRD precon stays
// rejected at both. Complements functions/test/starterDeck.test.js (which
// already covers the single-deck case) and
// functions/test/pvpDeckLock.test.js (which already covers the PVP lock
// point's single-deck case) -- this file is the ownedPrecons-aware
// extension of both, not a replacement.
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' }, 'starterDeckOwnershipApp');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

async function callResolvePvpIdentity(idToken, deckId) {
  const res = await fetch('http://127.0.0.1:5001/demo-test/us-central1/resolvePvpIdentity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: idToken, deckId: deckId, cardBackId: 'clasico' })
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const createAccount = httpsCallable(functions, 'createAccount');
  const chooseStarterDeck = httpsCallable(functions, 'chooseStarterDeck');
  const buyDeck = httpsCallable(functions, 'buyDeck');
  const updateActiveDeck = httpsCallable(functions, 'updateActiveDeck');

  const acct = await createAccount({ username: 'OwnershipTester1', email: 'ownershiptester1@example.com', password: 'password123' });
  const uid = acct.data.uid;
  await signInWithEmailAndPassword(auth, 'ownershiptester1@example.com', 'password123');
  await chooseStarterDeck({ deckKey: 'overgrowth' });

  // Give this account enough coins to buy a 2nd deck.
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8080 } });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(uid).update({ coins: 5000 });
  });
  await testEnv.cleanup();

  await buyDeck({ deckKey: 'blackout' });
  // Now owns: overgrowth (starter) + blackout (bought). zap and brushfire
  // remain unowned.

  // --- updateActiveDeck (local play) ---
  const switchToBoughtRes = await updateActiveDeck({ deckKey: 'blackout' });
  assert.strictEqual(switchToBoughtRes.data.activeDeck, 'blackout', 'a bought (not just starter-chosen) precon is now usable as the local activeDeck');
  console.log('PASS: updateActiveDeck accepts a precon acquired via purchase, not just the starter choice');

  try {
    await updateActiveDeck({ deckKey: 'zap' });
    assert.fail('expected updateActiveDeck to reject a still-unowned precon');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/failed-precondition');
    console.log('PASS: updateActiveDeck still rejects a precon the account has neither chosen nor bought');
  }

  // --- validateDeckId / resolvePvpIdentity (PVP room creation/joining) ---
  const idToken = await auth.currentUser.getIdToken();

  const pvpBoughtRes = await callResolvePvpIdentity(idToken, 'blackout');
  assert.strictEqual(pvpBoughtRes.status, 200, 'a bought precon is now usable in Duelo en Vivo, not just the starter choice');
  console.log('PASS: resolvePvpIdentity accepts a precon acquired via purchase');

  const pvpUnownedRes = await callResolvePvpIdentity(idToken, 'zap');
  assert.strictEqual(pvpUnownedRes.status, 400, 'a still-unowned precon stays rejected in Duelo en Vivo');
  console.log('PASS: resolvePvpIdentity still rejects a precon the account has neither chosen nor bought');

  await auth.signOut();
  console.log('ALL STARTER DECK OWNERSHIP TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node functions/test/starterDeckOwnership.test.js` (emulators running)
Expected: fails at the `updateActiveDeck({deckKey: 'blackout'})` assertion, since that function still only accepts the exact `starterDeckChosen` value (`overgrowth`), rejecting `blackout` even though `buyDeck` already granted it.

- [ ] **Step 3: Widen `updateActiveDeck`'s precon check**

In `functions/index.js`, find `updateActiveDeck`'s transaction:

```javascript
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const uData = snap.exists ? snap.data() : {};
      if (uData.starterDeckChosen && uData.starterDeckChosen !== deckKey) {
        throw new HttpsError('failed-precondition', 'Ya elegiste tu mazo inicial -- no puedes cambiarte a otro precon.');
      }
      tx.set(userRef, { activeDeck: deckKey }, { merge: true });
    });
```

Change the lock check to array membership:

```javascript
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const uData = snap.exists ? snap.data() : {};
      const owned = Array.isArray(uData.ownedPrecons) ? uData.ownedPrecons : [];
      if (uData.starterDeckChosen && owned.indexOf(deckKey) === -1) {
        throw new HttpsError('failed-precondition', 'No eres dueño de ese mazo -- cómpralo en la Tienda o elige el que ya tienes.');
      }
      tx.set(userRef, { activeDeck: deckKey }, { merge: true });
    });
```

(The `uData.starterDeckChosen &&` guard is unchanged and still comes first — a grandfathered account's falsy `starterDeckChosen` short-circuits the whole check before `owned` is ever consulted, exactly as today.)

- [ ] **Step 4: Widen `validateDeckId`'s precon check**

In `functions/index.js`, find `validateDeckId`:

```javascript
async function validateDeckId(uid, deckId) {
  if (PRECON_DECK_KEYS_LIST.indexOf(deckId) !== -1) {
    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    const uData = userSnap.data() || {};
    if (uData.starterDeckChosen && uData.starterDeckChosen !== deckId) {
      throw new HttpsError('invalid-argument', 'Ya elegiste tu mazo inicial -- no puedes usar otro precon en Duelo en Vivo.');
    }
    return;
  }
```

Change the lock check to array membership:

```javascript
async function validateDeckId(uid, deckId) {
  if (PRECON_DECK_KEYS_LIST.indexOf(deckId) !== -1) {
    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    const uData = userSnap.data() || {};
    const owned = Array.isArray(uData.ownedPrecons) ? uData.ownedPrecons : [];
    if (uData.starterDeckChosen && owned.indexOf(deckId) === -1) {
      throw new HttpsError('invalid-argument', 'No eres dueño de ese mazo -- cómpralo en la Tienda o elige el que ya tienes.');
    }
    return;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node functions/test/starterDeckOwnership.test.js` (emulators still running)
Expected: `ALL STARTER DECK OWNERSHIP TESTS PASSED`, exit 0.

Also re-run the 2 existing test files this task's changes touch, to confirm no regression to their own already-passing single-deck cases:
`node functions/test/starterDeck.test.js` and `node functions/test/pvpDeckLock.test.js` — both must still fully pass (their fixture accounts never call `buyDeck`, so `ownedPrecons` stays `[starterDeckChosen]` exactly, and `owned.indexOf(deckKey) === -1` behaves identically to the old `starterDeckChosen !== deckKey` check for a single-element array).

- [ ] **Step 6: Widen the 2 client-side lock points in `ui.js`**

Find the Decks-screen click handler's lock check:

```javascript
      var chosen = econState && econState.starterDeckChosen;
      var isLockedPrecon = chosen && PRECON_DECK_KEYS.indexOf(elDeckKey) !== -1 && elDeckKey !== chosen;
      if (isLockedPrecon) {
        showTargetHintModal('Ya elegiste tu mazo inicial -- este precon está bloqueado.');
        return;
      }
```

Change to array membership:

```javascript
      var chosen = econState && econState.starterDeckChosen;
      var owned = (econState && econState.ownedPrecons) || [];
      var isLockedPrecon = chosen && PRECON_DECK_KEYS.indexOf(elDeckKey) !== -1 && owned.indexOf(elDeckKey) === -1;
      if (isLockedPrecon) {
        showTargetHintModal('No eres dueño de ese mazo -- cómpralo en la Tienda o elige el que ya tienes.');
        return;
      }
```

Find `renderPvpDeckPicker`'s lock computation:

```javascript
  var lockedPrecon = (econState && econState.starterDeckChosen) || null;
  var preconKeys = lockedPrecon ? [lockedPrecon] : PRECON_DECK_KEYS;
```

Change to array membership:

```javascript
  var chosen = (econState && econState.starterDeckChosen) || null;
  var owned = (econState && econState.ownedPrecons) || [];
  var preconKeys = chosen ? PRECON_DECK_KEYS.filter(function (key) { return owned.indexOf(key) !== -1; }) : PRECON_DECK_KEYS;
```

(`chosen` truthy but `owned` somehow empty — an impossible state in practice, since `chooseStarterDeck` always seeds `ownedPrecons` in the same transaction that sets `starterDeckChosen` — would fall back to an empty picker rather than crashing; not a real scenario worth a special case.)

- [ ] **Step 7: Manual verification**

No automated test harness covers this UI logic directly (matches this codebase's established convention). Verify by code inspection, since the actual behavior is now proven server-side by Step 5's test and the client mirrors the identical `chosen && owned.indexOf(x) === -1` shape:

1. Confirm `PRECON_DECK_KEYS` is still in scope at both edited call sites (unchanged from before this task — it's a `data-decks.js` global already used elsewhere in both functions).
2. Confirm `econState.ownedPrecons` is not yet populated by `economy.js` at this point in the plan — Task 3 adds that. This task's `ui.js` changes are correct but inert (an empty `owned` array, `.indexOf` always `-1`) until Task 3 ships the field. This is expected and fine — Task 2 and Task 3 are reviewed independently, and neither task alone is meant to be end-to-end demoable.

- [ ] **Step 8: Commit**

```bash
git add functions/index.js functions/test/starterDeckOwnership.test.js ui.js
git commit -m "Widen the starter-deck lock to a set of owned precons everywhere it's enforced"
```

---

### Task 3: Shop "MAZOS" tab + client data layer + final regression check

**Files:**
- Modify: `economy.js`
- Modify: `index.html`
- Modify: `ui.js`

**Interfaces:**
- Consumes: `buyDeck` onCall (Task 1). `ownedPrecons` field (Task 1) — this task is what finally makes Task 2's already-widened `ui.js` checks live (by populating `econState.ownedPrecons` for the first time). `DECK_DISPLAY_NAME`, `PRECON_DECK_ART`, `PRECON_DECK_KEYS` (`data-decks.js`/`ui.js`, already exist, unchanged).
- Produces: nothing new for a later task — this is the plan's last task.

- [ ] **Step 1: Add `ownedPrecons` to `econState` and the `buyDeckCloud`/`getDeckCost` helpers**

In `economy.js`, find the `econState = {...}` line inside `initEconomyListener`:

```javascript
      econState = { coins: data.coins, collection: data.collection || {}, collectionHolo: data.collectionHolo || {}, collectionSecret: data.collectionSecret || {}, activeDeck: data.activeDeck || 'overgrowth', cardBacks: data.cardBacks || [], customDecks: data.customDecks || {}, pendingCodePacks: data.pendingCodePacks || [], starterDeckChosen: data.starterDeckChosen };
```

Add `ownedPrecons: data.ownedPrecons || []` (WITH a default — unlike `starterDeckChosen`'s deliberate no-default, an absent `ownedPrecons` on a grandfathered account safely means "nothing purchased," and Task 2's lock checks never even consult this field for such an account since their `starterDeckChosen &&` guard short-circuits first):

```javascript
      econState = { coins: data.coins, collection: data.collection || {}, collectionHolo: data.collectionHolo || {}, collectionSecret: data.collectionSecret || {}, activeDeck: data.activeDeck || 'overgrowth', cardBacks: data.cardBacks || [], customDecks: data.customDecks || {}, pendingCodePacks: data.pendingCodePacks || [], starterDeckChosen: data.starterDeckChosen, ownedPrecons: data.ownedPrecons || [] };
```

Add `buyDeckCloud` near `chooseStarterDeckCloud`:

```javascript
function buyDeckCloud(deckKey) {
  return firebase.functions().httpsCallable('buyDeck')({ deckKey: deckKey })
    .then(function (res) { return res.data; });
}
```

In `ui.js`, add `getDeckCost` right after `getProtectorCost` (same file, same section — both are `globalEconomyConfig`-backed price lookups):

```javascript
function getDeckCost(deckKey) {
  if (globalEconomyConfig && globalEconomyConfig.deckCosts && typeof globalEconomyConfig.deckCosts[deckKey] === 'number') {
    return globalEconomyConfig.deckCosts[deckKey];
  }
  return 1500;
}
```

- [ ] **Step 2: Add the MAZOS tab markup to `index.html`**

Find the Shop's tab bar and panels:

```html
          <div class="shell-shop-tabs">
            <button type="button" class="shell-shop-tab active" data-shop-tab="packs">PACKS</button>
            <button type="button" class="shell-shop-tab" data-shop-tab="protectores">PROTECTORES</button>
          </div>

          <div class="shell-shop-body">
            <div class="shell-shop-panel" id="shopPacksPanel">
```

Add the new tab button:

```html
          <div class="shell-shop-tabs">
            <button type="button" class="shell-shop-tab active" data-shop-tab="packs">PACKS</button>
            <button type="button" class="shell-shop-tab" data-shop-tab="protectores">PROTECTORES</button>
            <button type="button" class="shell-shop-tab" data-shop-tab="mazos">MAZOS</button>
          </div>

          <div class="shell-shop-body">
            <div class="shell-shop-panel" id="shopPacksPanel">
```

Find the closing of `shopProtectorsPanel`:

```html
            <div class="shell-shop-panel hidden" id="shopProtectorsPanel">
              <div class="shell-shop-grid" id="shopProtectorsGrid"></div>
            </div>
          </div>
```

Add the new panel right after it, before `</div>` (`.shell-shop-body`'s close):

```html
            <div class="shell-shop-panel hidden" id="shopProtectorsPanel">
              <div class="shell-shop-grid" id="shopProtectorsGrid"></div>
            </div>

            <div class="shell-shop-panel hidden" id="shopDecksPanel">
              <div class="shell-shop-grid" id="shopDecksGrid"></div>
            </div>
          </div>
```

No new CSS is needed — `.shell-shop-panel`, `.shell-shop-panel.hidden`, `.shell-shop-grid`, and `.shell-shop-card` (used in Step 3 below) are already generic, reusable rules in `shell-theme.css` (confirmed: `.shell-shop-panel.hidden{display:none;}` already exists and applies to any element with both classes, not just the existing 2 panels).

- [ ] **Step 3: Wire the tab and add `renderShopDecksGrid` in `ui.js`**

Find `showShopTab`:

```javascript
function showShopTab(tab) {
  document.querySelectorAll('.shell-shop-tab').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-shop-tab') === tab);
  });
  document.getElementById('shopPacksPanel').classList.toggle('hidden', tab !== 'packs');
  document.getElementById('shopProtectorsPanel').classList.toggle('hidden', tab !== 'protectores');
  var orbesPanel = document.getElementById('shopOrbesPanel');
  if (orbesPanel) { orbesPanel.classList.toggle('hidden', tab !== 'orbes'); }
  if (tab === 'protectores') { renderProtectorsGrid(); }
```

Add the new panel's toggle and render call (leave the pre-existing, unrelated `shopOrbesPanel` defensive-null-check line exactly as-is — it belongs to a different, not-yet-fully-wired feature, not something this task touches):

```javascript
function showShopTab(tab) {
  document.querySelectorAll('.shell-shop-tab').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-shop-tab') === tab);
  });
  document.getElementById('shopPacksPanel').classList.toggle('hidden', tab !== 'packs');
  document.getElementById('shopProtectorsPanel').classList.toggle('hidden', tab !== 'protectores');
  document.getElementById('shopDecksPanel').classList.toggle('hidden', tab !== 'mazos');
  var orbesPanel = document.getElementById('shopOrbesPanel');
  if (orbesPanel) { orbesPanel.classList.toggle('hidden', tab !== 'orbes'); }
  if (tab === 'protectores') { renderProtectorsGrid(); }
  if (tab === 'mazos') { renderShopDecksGrid(); }
```

(No change needed to the tab-button click-wiring loop in the `DOMContentLoaded` block — it already iterates every `.shell-shop-tab` element generically and calls `showShopTab(btn.getAttribute('data-shop-tab'))`, so the new MAZOS button just works once it exists in the HTML.)

Add `renderShopDecksGrid()` right after `renderProtectorsGrid()` (same file, same section — mirrors its exact structure: per-item owned-vs-buyable footer, disable-on-click, re-render-on-success, error-and-re-enable-on-failure):

```javascript
function renderShopDecksGrid() {
  var grid = document.getElementById('shopDecksGrid');
  if (!grid || !econState) { return; }

  var owned = econState.ownedPrecons || [];
  grid.innerHTML = PRECON_DECK_KEYS.map(function (key) {
    var art = PRECON_DECK_ART[key] || {};
    var isOwned = owned.indexOf(key) !== -1;
    var cost = getDeckCost(key);
    var footer = isOwned
      ? '<span class="shell-shop-card-owned-label">EN TU COLECCIÓN</span>'
      : '<span class="shell-shop-card-price">' + pixelCoinHtml('oro', 3) + pixelDigitsHtml(cost, 'oro', 3) + '</span>' +
        '<button type="button" class="shell-shop-card-btn" data-buy-deck="' + key + '">COMPRAR</button>';
    return '<div class="shell-shop-card' + (isOwned ? ' shell-shop-card-owned' : '') + '">' +
      '<div class="shell-deck-card-art"><img src="' + art.img + '" alt="' + escapeHtml(DECK_DISPLAY_NAME[key] || key) + '"></div>' +
      '<div class="shell-shop-card-text">' +
        '<div class="shell-shop-card-name">' + escapeHtml((DECK_DISPLAY_NAME[key] || key).toUpperCase()) + '</div>' +
        '<div class="shell-shop-card-desc">' + escapeHtml(art.types || '') + '</div>' +
      '</div>' +
      '<div class="shell-shop-card-footer">' + footer + '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('[data-buy-deck]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var deckKey = btn.getAttribute('data-buy-deck');
      btn.disabled = true;
      btn.textContent = 'COMPRANDO...';
      buyDeckCloud(deckKey)
        .then(function (res) {
          if (econState) {
            econState.collection = res.collection;
            econState.ownedPrecons = res.ownedPrecons;
            econState.coins = res.coins;
          }
          renderShopDecksGrid();
          renderCoinCount();
        })
        .catch(function (err) {
          alert(err.message || 'No se pudo comprar el mazo.');
          btn.disabled = false;
          btn.textContent = 'COMPRAR';
        });
    });
  });
}
```

- [ ] **Step 4: Manual verification**

Firebase emulators still needed (`firebase emulators:start --project demo-test --only auth,functions,firestore`). No browser/display is assumed to be available to whichever agent implements this — do the best real verification possible (serving the app and using a headless browser tool if one is available; otherwise the same honest code-inspection standard the prior plan's Task 3 used: cross-reference every element id the new JS queries against the new HTML, confirm the tab-click wiring loop really does pick up the 3rd button with no code changes, and write up clearly in the report which parts were code-inspected versus actually rendered). Checklist to walk through for real if any rendering is possible at all:

1. Open the Shop, click the MAZOS tab. Confirm all 4 decks show, with the account's already-chosen starter deck showing "EN TU COLECCIÓN" and the other 3 showing a 1500-Orbes "COMPRAR" button.
2. Buy one of the 3 available decks. Confirm it flips to "EN TU COLECCIÓN" immediately, the Orbes balance in the header drops by 1500, and clicking it again does nothing (no button to click).
3. Go to the Decks screen. Confirm the just-bought deck is now selectable (no longer shows the "bloqueado" hint), while the 2 still-unbought precons remain locked.
4. Start creating a PVP room. Confirm the deck picker now offers both the starter deck and the just-bought deck, but not the 2 still-unbought ones.
5. With an account that has fewer than 1500 Orbes, attempt a purchase. Confirm the inline error appears and the button re-enables without charging.
6. Using a grandfathered account (no `starterDeckChosen` field), open the MAZOS tab. Confirm all 4 decks show as purchasable (none pre-owned) — buying one should still work exactly as designed, granting real cards, without disturbing that account's separate, still-unrestricted ability to freely use any precon in local play/PVP/the Decks screen regardless of purchase.

- [ ] **Step 5: Final regression check**

Run: `node run-tests.js`
Expected: `739 PASS, 0 FAIL`, exit code 0 — this feature doesn't touch `rules-engine.js` or anything else that suite covers.

Also re-run every emulator-based test file this plan's 3 tasks touched or extended, to confirm the whole feature is coherent end-to-end: `node functions/test/buyDeck.test.js`, `node functions/test/starterDeckOwnership.test.js`, `node functions/test/starterDeck.test.js`, `node functions/test/pvpDeckLock.test.js` — all 4 must pass cleanly.

- [ ] **Step 6: Commit**

```bash
git add economy.js index.html ui.js
git commit -m "Add the Shop's MAZOS tab for buying additional preconstructed decks"
```
