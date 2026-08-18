# Cuentas de Usuario + Economía en la Nube (Firebase) — Design

Date: 2026-08-18
Status: Approved by user, pending implementation plan
Depends on: `2026-08-16-tcg-simulator-design.md` (the game itself, unchanged)

## 1. Purpose

Today the game is single-player and fully local: coins and card
collection live in the browser's `localStorage` under the key
`tcg_economy`, and there is no concept of a "user" at all. This spec
adds real user accounts and moves coins/collection into a cloud
database (Firebase), so the same player's progress follows them across
devices/browsers, and multiple distinct players can each have their
own persistent account.

This is sub-project 1 of a larger direction. Two follow-up
sub-projects were discussed and are explicitly **out of scope here**,
to be designed separately once this one ships:

- **Sub-project 2 — live PvP multiplayer**: two real players playing
  the same match against each other in real time (today `rules-engine.js`
  runs entirely client-side, trusting local state — this needs its own
  design for turn sync, authority, and disconnect handling).
- **Sub-project 3 — tournaments**: brackets/scheduling built on top of
  accounts (this spec) and live PvP (sub-project 2).

Nothing in this design blocks either follow-up — Cloud Functions run
Node.js, so `rules-engine.js` (already DOM-free per the existing
README) can be reused server-side when sub-project 2 is designed.

## 2. Goals

- A player can create an account (username + real email + password)
  and log in from any device to see their own coins and collection.
- Coins and collection are the source of truth on the server; the
  client never writes them directly, so casually opening devtools
  can't grant free coins or cards.
- Forgot-password works with zero custom email infrastructure, using
  Firebase Auth's own built-in reset-email flow.
- The rest of the game (board, rules engine, AI, UI) is unchanged.
- Still deployable as a mostly-static site: the only new "backend code"
  lives isolated in a `functions/` folder (Cloud Functions), everything
  else stays plain `<script>` tags with no build step.

## 3. Non-goals (this phase)

- Live PvP multiplayer and tournaments (see §1 — separate future specs).
- Importing/migrating any existing `localStorage` progress — new
  accounts start at 150 coins / empty collection, per user decision.
- Guest/no-account play — login is mandatory to reach the menu, per
  user decision (simpler than supporting two parallel data paths).
- Social features (friends, leaderboards, profile pictures tied to
  accounts) — not requested.
- Rate-limiting / App Check hardening on the public Cloud Functions
  beyond what's noted in §7 — acceptable for a small friends/family
  audience; flagged as a future hardening item, not built now.

## 4. Architecture

Firebase project with:

- **Firebase Auth** — session/password management. The account's
  actual Auth email is the player's **real email** (needed so
  Firebase's built-in `sendPasswordResetEmail` can deliver a reset
  link with zero custom email code).
- **Firestore** — `users/{uid}` and `usernames/{username}` documents
  (§5).
- **Cloud Functions** (Node.js, `functions/` folder, its own
  `package.json` — the only part of this project with a build/deploy
  step) — the only thing allowed to write `coins`/`collection`, plus
  the username→email resolution used for login and password reset
  (§7).
- **Firebase Hosting** — serves `index.html` + the existing static
  assets over HTTPS (required for Firebase Auth in production).

The client adds the Firebase JS SDK via `<script>` tags (Firebase ships
a CDN "compat" build for exactly this no-bundler use case), keeping
the "no npm for the game itself" property intact. Only `functions/`
gets its own `package.json` and is deployed separately via the
Firebase CLI.

## 5. Data model (Firestore)

```
users/{uid}
  username: string       // denormalized copy, for display without a lookup
  coins: number           // written only by Cloud Functions
  collection: map         // { cardId: count, ... }, written only by Cloud Functions
  createdAt: timestamp

usernames/{username}      // lowercase, trimmed — reservation + lookup record
  uid: string
```

Firestore security rules:

```
match /users/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;   // Cloud Functions use the Admin SDK, which
                            // bypasses rules entirely — this line blocks
                            // every other path, including the owner.
}
match /usernames/{username} {
  allow read: if false;    // not public — resolved only via Cloud
                            // Function (§7), per user's "privada" choice
  allow write: if false;
}
```

## 6. Account flows

**Create account** — new screen, shown before the main menu, asks for
username + real email + password:

1. Client calls `createAccount({ username, email, password })`.
2. Function validates: username format (lowercase letters/digits/`_`,
   3-20 chars), email looks like an email, password meets Firebase's
   minimum (6 chars); checks `usernames/{username}` doesn't already
   exist.
3. Function creates the Firebase Auth user with the given real email +
   password, creates `users/{uid}` (coins: 150, collection: {}), and
   creates `usernames/{username}` → `{ uid }`, all in one pass (if the
   username was taken between check and write, the whole call fails
   and nothing is left half-created).
4. Client then signs in with `signInWithEmailAndPassword(email, password)`
   directly (it already has the email it just submitted — no lookup
   needed for this one case).

**Log in** — asks for username + password only (not email):

1. Client calls `resolveLoginEmail({ username })` (§7) to get the
   email tied to that username.
2. Client calls `signInWithEmailAndPassword(email, password)`.
3. Any failure (username not found, wrong password) shows the same
   generic message: "Usuario o contraseña incorrectos" — the two
   failure modes are not distinguished, so a login attempt can't be
   used to probe which usernames exist.

**Forgot password**:

1. Client calls `resolveLoginEmail({ username })`.
2. Client calls Firebase Auth's built-in `sendPasswordResetEmail(email)`.
   Firebase sends the reset email itself, using its default template
   (subject/text customizable in the Firebase console) — no email
   provider to configure.
3. Same generic "si el usuario existe, te llegará un mail" message
   either way, so this can't be used to probe usernames either.

Login is required to reach `menuScreen`; an unauthenticated visitor
sees only the login/create-account screen.

## 7. Cloud Functions

All are HTTPS **callable** functions (`firebase.functions().httpsCallable(...)`
from the client), which gives every function `context.auth` — the
caller's verified `uid`, impossible to spoof from the client. Functions
that touch `coins`/`collection` always act on `context.auth.uid`, never
on a `uid` passed in the request body.

| Function | Auth required? | Does |
|---|---|---|
| `createAccount` | no (this *is* signup) | §6, creates the account |
| `resolveLoginEmail` | no | Looks up `usernames/{username}` → `uid` → that user's real email via the Admin SDK (`auth.getUser(uid).email`), returns `{ email }`. Used by both login and forgot-password. Routing this through a Function instead of a publicly-readable Firestore doc (the user's explicit choice) means the `usernames` collection itself is never openly listable/readable — the mapping is only reachable one username at a time, through code we control. |
| `awardMatchResult` | yes | `{ result: 'win' \| 'loss' }` → increments the caller's `coins` by 75 (win) or 0 (loss), inside a Firestore transaction. Replaces the current client-side `awardWin`/`awardLoss` in `economy.js`. |
| `openBooster` | yes | `{ setKey }` → inside a Firestore transaction: reads the caller's `coins`, rejects with an error if `< 100`, deducts 100, draws 11 cards (1 Rare/Rare Holo + 3 Uncommon + 7 Common) from `setKey`'s pool, merges into `collection`, commits, and returns the drawn cards to the client so it can play the existing pack-opening reveal animation. Replaces the current client-side `openBooster` in `economy.js`. The transaction makes a double-click/double-call safe — the second call sees the already-deducted balance. |

The booster-drawing and reward-math logic are kept as small **pure
functions** (no Firestore/Auth calls inside them — same shape as the
current `awardWin`/`awardLoss`/booster logic in `economy.js`), with
each Cloud Function acting as a thin wrapper: read state, call the
pure function, write the result. This is what keeps them unit-testable
the same way as today (§9), and reusable later if sub-project 2 needs
the same reward math for live-match payouts.

## 8. Client changes

- New `authScreen` (login / crear cuenta / olvidé mi contraseña — three
  small forms in one screen, toggled), shown whenever there's no
  signed-in Firebase user; replaces the current "just show the menu"
  startup path.
- `economy.js` stops reading/writing `localStorage`. Instead:
  - Subscribes to `users/{uid}` with `onSnapshot` once signed in, so
    `econState` (coins, collection) always reflects the server —
    including live updates if changed from another tab/device.
  - `awardWin(econ)` / `awardLoss(econ)` are replaced by a call to the
    `awardMatchResult` Cloud Function at the point a match ends.
  - The booster-purchase flow calls the `openBooster` Cloud Function
    instead of drawing cards locally.
- Everything else — `rules-engine.js`, `card-effects.js`, `ai.js`, the
  board/hand/log rendering in `ui.js` — is untouched. In-match game
  state (`gameState`) stays purely client-side and ephemeral, same as
  today.

## 9. Error handling

- **Network/Functions unreachable**: a failed `openBooster` or
  `awardMatchResult` call leaves `coins`/`collection` untouched (the
  transaction never ran) — client shows a retry-able error, no
  optimistic local deduction that could get out of sync.
- **Double-spend / double-click**: prevented server-side by the
  Firestore transaction in `openBooster`, not by disabling the button
  client-side (defense in depth — disabling the button is still worth
  doing for UX, but isn't what makes it safe).
- **Signup validation errors** (username taken, bad email, weak
  password): `createAccount` returns a specific error code the client
  maps to a Spanish message.
- **Login/reset errors**: deliberately generic (§6), by design, not a
  gap.

## 10. Testing

- The pure reward/booster-drawing functions keep working with the
  existing Node `run-tests.js` (`vm` sandbox) setup — no change to how
  today's tests run.
- New coverage for the Functions' plumbing (auth checks, transaction
  behavior, username-uniqueness race) uses the **Firebase Emulator
  Suite** (Auth + Firestore + Functions running locally) — no real
  Firebase project, quota, or cost involved while developing.
- Manual smoke test before shipping: create account, log out, log
  back in with just username+password, forgot-password end-to-end,
  buy a booster twice quickly (confirm only one deduction if that's
  genuinely a double-click, two deductions if genuinely two
  purchases), win/lose a match and confirm the coin change.

## 11. Open items for the implementation plan

- Exact Firebase project setup steps (console project creation, Auth
  provider enablement, `firebase init`) belong in the implementation
  plan, not this design.
- Firebase Hosting deploy process (single `firebase deploy`) to be
  documented in the README alongside the existing "how to run" section.
