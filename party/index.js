// rules-engine.js's functions read CARD_STATS/DECKLISTS/PRECON_DECK_KEYS/
// ATTACK_EFFECTS/TRAINER_EFFECTS/POKEMON_POWER_EFFECTS as bare global
// identifiers (not module-scoped imports) -- same as functions/index.js
// does today -- so these must be bound onto globalThis before the
// require('../rules-engine.js') line below runs.
const { CARD_STATS } = require('../data-cards.js');
const { DECKLISTS, PRECON_DECK_KEYS } = require('../data-decks.js');
const { ATTACK_EFFECTS, TRAINER_EFFECTS, POKEMON_POWER_EFFECTS } = require('../card-effects.js');
globalThis.CARD_STATS = CARD_STATS;
globalThis.DECKLISTS = DECKLISTS;
globalThis.PRECON_DECK_KEYS = PRECON_DECK_KEYS;
globalThis.ATTACK_EFFECTS = ATTACK_EFFECTS;
globalThis.TRAINER_EFFECTS = TRAINER_EFFECTS;
globalThis.POKEMON_POWER_EFFECTS = POKEMON_POWER_EFFECTS;
// getWinner is destructured below (in addition to redactMatchState already
// calling it internally as a bare identifier within rules-engine.js's own
// module scope) -- maybeClearActiveMatch() (this task, see redactedFor/
// sendMatchTo/broadcastMatch further down) needs to call it directly from
// party/index.js to decide whether the match has a winner yet.
const {
  createGame, startMatch: engineStartMatch, canPlayBasic, playBasic, canEvolve, evolve,
  canAttachEnergy, attachEnergy, canRetreat, retreat, takePrize, chooseNewActive,
  canAttack, attack, endTurn, drawForTurnStart, redactMatchState, submitRpsChoice, applyEndOfTurnCheckup, getWinner,
  // Needed for this task's server-authoritative clock commits (the plain
  // 'endTurn' case, the 'confirmEndTurn' case, and the top-of-runAction
  // timeout check all call this directly) -- same function ui.js's own
  // tickGameClock already calls as a bare global in the browser.
  tickClock,
  // Real bug found while testing Task 2's playTrainer action: card-effects.js's
  // TRAINER_EFFECTS entries call these rules-engine.js internals (findInstance,
  // drawCard, logEvent, etc.) as bare global identifiers too -- same as
  // CARD_STATS/etc. above -- but nothing bound them onto globalThis before now,
  // since no code path had ever actually invoked a TRAINER_EFFECTS function
  // inside this process until playTrainer did. Left unbound, Bill's effect (the
  // simplest Trainer card, just a draw-2) threw "drawCard is not defined" the
  // instant it ran against the local dev server.
  findInstance, opponentOf, translatePlayer, translateCardName,
  logEvent, drawCard, basicFormName, isBasicPokemon, benchCount,
  evolutionTimingAllowed, makeFreshInstance, shuffle,
  discardedEnergyCard, discardedEvolutionCard, allInstances,
  // Same story, one task later: card-effects.js's ATTACK_EFFECTS entries
  // (invoked for real for the first time by removing runAction's old
  // "(Fase 2)" guard on the 'attack' case) call these rules-engine.js
  // internals as bare global identifiers too. Left unbound, Weedle's Poison
  // Sting (the first special-effect attack exercised against the local dev
  // server) threw "dealDamage is not defined" the instant it ran.
  dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName,
  // Real reported bug found while testing the Energy Retrieval fix: its own
  // effect (card-effects.js) references this as a bare identifier too, the
  // same class of gap as the block above -- never exercised against the
  // local dev server before, so it sat undiscovered. Left unbound,
  // retrieving any energy threw "ENERGY_TYPE_BY_CARD_NAME is not defined".
  ENERGY_TYPE_BY_CARD_NAME,
  // party/index.js's new 'usePower' runAction case calls this directly --
  // the same validated single entry point (own-turn check, owner-belongs-
  // to-caller check, Power-exists check, Asleep/Confused/Paralyzed check)
  // local play's own HABILIDAD button already relies on.
  usePokemonPower
} = require('../rules-engine.js');
globalThis.findInstance = findInstance;
globalThis.opponentOf = opponentOf;
globalThis.translatePlayer = translatePlayer;
globalThis.translateCardName = translateCardName;
globalThis.logEvent = logEvent;
globalThis.drawCard = drawCard;
globalThis.basicFormName = basicFormName;
globalThis.isBasicPokemon = isBasicPokemon;
globalThis.benchCount = benchCount;
globalThis.evolutionTimingAllowed = evolutionTimingAllowed;
globalThis.makeFreshInstance = makeFreshInstance;
globalThis.shuffle = shuffle;
globalThis.discardedEnergyCard = discardedEnergyCard;
globalThis.discardedEvolutionCard = discardedEvolutionCard;
globalThis.allInstances = allInstances;
globalThis.dealDamage = dealDamage;
globalThis.coinFlip = coinFlip;
globalThis.addStatus = addStatus;
globalThis.knockOutIfNeeded = knockOutIfNeeded;
globalThis.translateAttackName = translateAttackName;
globalThis.ENERGY_TYPE_BY_CARD_NAME = ENERGY_TYPE_BY_CARD_NAME;

// functions/index.js's foilTierForCard (added earlier this session)
// iterates CARD_CATALOG[setKey] (from functions/lib/cardCatalog.js, a
// *different* file from data-cards.js), matching each entry's .n/.num to
// build the setKey-num lookup key. party/index.js needs the same
// CARD_CATALOG data -- functions/lib/cardCatalog.js already exports it as
// a bare object (module.exports = CARD_CATALOG;), so it's requireable
// as-is, no footer needed.
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
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, roomCode: roomCode, secret: secret })
  });
  // Still fire-and-forget (never awaited at the call sites below, never
  // throws/blocks match start) -- this only adds visibility so a
  // misconfigured secret (e.g. half-rotated, or the 503 from
  // functions/index.js's fail-closed check) doesn't silently degrade
  // "Duelo en Vivo" for everyone with zero signal anywhere.
  if (!res.ok) { console.warn('registerActiveMatch failed', res.status); }
}

async function clearActiveMatch(env, uid) {
  const url = (env && env.CLEAR_ACTIVE_MATCH_URL) || DEFAULT_CLEAR_ACTIVE_MATCH_URL;
  const secret = (env && env.PARTY_INTERNAL_SECRET) || DEFAULT_PARTY_INTERNAL_SECRET;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, secret: secret })
  });
  if (!res.ok) { console.warn('clearActiveMatch failed', res.status); }
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
    status: info.status, matchId: info.status === 'started' ? info.roomCode : null,
    // Real reported bug: "VOLVER A JUGAR" after a match used to always
    // disconnect from PVP and start a local match vs CPU. Rebuilding a
    // real rematch flow (see onMessage's 'rematch'/'leaveRoom' cases)
    // needs the guest's client to be able to tell whether the room's
    // owner is even still around before it tries to rejoin THIS room --
    // these two flags carry that across the same live 'room' broadcast
    // the pre-match waiting screen already listens to.
    hostLeft: !!info.hostLeft, guestLeft: !!info.guestLeft
  };
}

export default class Server {
  constructor(room) {
    this.room = room;
    this.info = null; // set in onStart, or lazily on first onConnect
    // Ephemeral, like this.state.rng -- never persisted (persistState only
    // ever writes this.state). Marks when the CURRENTLY ACTIVE side's
    // clock last started ticking; null until the match's first turn
    // actually begins (confirmSetup's engineStartMatch call, below).
    this.turnStartedAt = null;
  }

  async onStart() {
    this.info = (await this.room.storage.get('info')) || null;
    const savedState = await this.room.storage.get('state');
    if (savedState) {
      this.state = Object.assign({}, savedState, { rng: Math.random });
      // Same reasoning as rng above -- turnStartedAt is ephemeral and was
      // never persisted, so a Durable Object restart mid-turn would
      // otherwise leave it null while phase is already 'playing'. Resetting
      // it here (rather than trying to reconstruct exactly how long the
      // active side had already used) means the sleep/restart itself never
      // counts against either side's clock -- a deliberate, simple choice,
      // same spirit as not trying to reconstruct rng's exact prior state.
      if (this.state.phase === 'playing' && this.state.activePlayerId) { this.turnStartedAt = Date.now(); }
    }
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
      // A genuine reconnect proves the host never really left -- clear any
      // stale 'leaveRoom' flag from a previous tab/socket of theirs (see
      // roomBroadcastPayload's own comment on hostLeft/guestLeft).
      this.info.hostLeft = false;
      await this.room.storage.put('info', this.info);
      if (this.info.status === 'started') { this.sendMatchTo(connection, 'player'); } else { this.broadcastRoom(); }
      return;
    }
    if (this.info && this.info.guestUid === identity.uid) {
      this.info.guestConnId = connection.id;
      this.info.guestLeft = false;
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
        hostTestTimeBankMs: identity.testTimeBankMs || null,
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
    this.info.guestTestTimeBankMs = identity.testTimeBankMs || null;
    this.info.guestCardBackId = identity.cardBackId;
    this.info.guestCollectionHolo = identity.collectionHolo;
    this.info.guestCollectionSecret = identity.collectionSecret;
    this.info.guestReady = false;
    await this.room.storage.put('info', this.info);
    this.broadcastRoom();
  }

  async onMessage(message, sender) {
    // Deferred Minor finding from an earlier task review: a malformed/
    // non-JSON incoming message previously threw out of JSON.parse
    // unhandled, instead of producing a clean error response. Closed here
    // while substantially extending this method anyway.
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      sender.send(JSON.stringify({ type: 'error', message: 'Mensaje inválido.' }));
      return;
    }
    if (data.type === 'setReady') {
      if (sender.id === this.info.hostConnId) { this.info.hostReady = true; }
      else if (sender.id === this.info.guestConnId) { this.info.guestReady = true; }
      const justStarted = this.info.hostReady && this.info.guestReady && this.info.status === 'waiting';
      if (justStarted) { this.startMatch(); }
      await this.room.storage.put('info', this.info);
      this.broadcastRoom();
      // Brief-code fix: broadcastRoom() above only tells both sockets
      // status:'started' -- it never delivers the {type:'match'} payload
      // itself (public/myHand) that the RPS screen needs to render, and
      // nothing else in this class pushes one the instant the match is
      // created (broadcastMatch() is otherwise only called from
      // onConnect's reconnect branches and runAction's 'action' handler).
      // Without this, match.test.js's nextMatchMessage() hangs forever
      // right after both sides ready up.
      if (justStarted) { this.broadcastMatch(); }
      return;
    }
    if (data.type === 'rematch') {
      // Real reported bug: "VOLVER A JUGAR" after a PVP match used to
      // disconnect the player from PVP entirely and start a LOCAL match
      // vs CPU instead (ui.js's matchEndReplayBtn always called
      // startNewMatch(), which itself resets all PVP state as its very
      // first step, regardless of pvpMode). A rematch re-enters THIS SAME
      // room (same code, same connection) back at the pre-match waiting
      // stage -- whichever side sends this first is marked ready
      // immediately (matching the user's "debe estar en listo"
      // requirement, no separate "Iniciar" click needed); the status
      // transition below only fires once, on the FIRST 'rematch' after a
      // finished match -- it also resets BOTH readiness flags, since a
      // stale 'hostReady'/'guestReady' from before the PREVIOUS match
      // started must never silently carry over into this one. Once both
      // sides have sent 'rematch', starts a fresh match exactly like both
      // pressing "Iniciar" would (same justStarted shape as 'setReady'
      // above).
      if (this.info.status === 'started') {
        this.info.status = 'waiting';
        this.info.hostReady = false;
        this.info.guestReady = false;
      }
      if (sender.id === this.info.hostConnId) { this.info.hostReady = true; this.info.hostLeft = false; }
      else if (sender.id === this.info.guestConnId) { this.info.guestReady = true; this.info.guestLeft = false; }
      const rematchStarted = this.info.hostReady && this.info.guestReady && this.info.status === 'waiting';
      if (rematchStarted) { this.startMatch(); }
      await this.room.storage.put('info', this.info);
      this.broadcastRoom();
      if (rematchStarted) { this.broadcastMatch(); }
      return;
    }
    if (data.type === 'leaveRoom') {
      // Sent when a player presses "SALIR" from the match-end modal,
      // right before their own socket disconnects (see ui.js's
      // leaveRoomCloud) -- lets the OTHER side, if they're still looking
      // at the same finished match, learn their room mate is gone. Per
      // the user-specified rule: if the room's OWNER is the one who left,
      // the guest's own later "VOLVER A JUGAR" has no room left to
      // rejoin, and becomes the owner of a brand new one instead (see
      // ui.js's matchEndReplayBtn handler) -- this flag, carried on the
      // 'room' broadcast (roomBroadcastPayload), is how that client
      // learns to take that path instead of waiting forever for a
      // rematch that will never arrive.
      if (sender.id === this.info.hostConnId) { this.info.hostLeft = true; }
      else if (sender.id === this.info.guestConnId) {
        // Real reported bug: the guest leaving used to only ever set this
        // flag -- the host, staying behind and pressing "VOLVER A JUGAR",
        // got stuck forever: their own room broadcast still showed the
        // DEPARTED guest as occupying the room (guestUid/guestConnId were
        // never actually cleared), so no new rival -- the same guest
        // rejoining, or anyone else -- could ever join this room code
        // again (onConnect's join branch rejects whenever guestUid is
        // already set). Actually vacate the slot here (same empty shape
        // as onConnect's own room-creation branch) and drop status back
        // to 'waiting' so the room is immediately open for a real new
        // join, not just carrying a flag nobody reacts to.
        this.info.guestUid = null; this.info.guestConnId = null;
        this.info.guestUsername = null; this.info.guestPhoto = null;
        this.info.guestDeckId = null; this.info.guestDeckKey = null;
        this.info.guestCustomDeckCards = null; this.info.guestTestTimeBankMs = null;
        this.info.guestCardBackId = null; this.info.guestCollectionHolo = null; this.info.guestCollectionSecret = null;
        this.info.guestReady = false;
        this.info.guestLeft = false; // the slot is genuinely empty now, not just "left"
        this.info.status = 'waiting';
        // Refreshed so a legitimately fresh rematch/re-join never gets
        // rejected by onConnect's own ROOM_EXPIRY_MS check against the
        // ORIGINAL room's creation time.
        this.info.createdAt = Date.now();
      }
      await this.room.storage.put('info', this.info);
      this.broadcastRoom();
      return;
    }
    if (data.type === 'peekOwnDeck') {
      const side = sender.id === this.info.hostConnId ? 'player' : 'cpu';
      const cards = this.state.players[side].deck.map((c) => ({ id: c.id, name: c.name }));
      sender.send(JSON.stringify({ type: 'deckPeek', reqId: data.reqId, cards: cards }));
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
        // Real bug found in review: runAction's top-of-function timeout
        // check (this task) can mutate state (tickClock, zeroing a side's
        // timeBankMs) and broadcastMatch() BEFORE later guards in the same
        // call (turnEndPendingSide, TURN_GATED_ACTIONS) still throw for an
        // unrelated reason -- unlike every other runAction case, which
        // always validates before mutating, so a throw used to always mean
        // nothing had changed. persistState() must still run here even
        // though this action itself failed, or the timeout mutation is
        // broadcast to both clients but never written to storage --
        // silently undone by onStart()'s restart-reconstruction if the
        // Durable Object evicts/restarts before any other action
        // successfully completes (plausible once the match is logically
        // over).
        await this.persistState();
        sender.send(JSON.stringify({ type: 'error', reqId: data.reqId, message: err.message }));
      }
      return;
    }
  }

  startMatch() {
    this.info.status = 'started';
    if (this.info.hostCustomDeckCards) { DECKLISTS[this.info.hostDeckKey] = this.info.hostCustomDeckCards; }
    if (this.info.guestCustomDeckCards) { DECKLISTS[this.info.guestDeckKey] = this.info.guestCustomDeckCards; }
    this.state = createGame(Math.random, this.info.hostDeckKey, { player: true, cpu: true }, this.info.guestDeckKey);
    // Test-only override (never set by the real resolveIdentity Cloud
    // Function): lets party/test/clock.test.js start a match with a tiny
    // time bank instead of the real 10 minutes, the only way to test a
    // real timeout without waiting 10 real minutes. Mirrors the existing
    // customDeckCards override (startMatch, a few lines above this) --
    // same mechanism, same reasoning.
    if (this.info.hostTestTimeBankMs) { this.state.players.player.timeBankMs = this.info.hostTestTimeBankMs; }
    if (this.info.guestTestTimeBankMs) { this.state.players.cpu.timeBankMs = this.info.guestTestTimeBankMs; }
    // Real reported bug: a rematch (2nd+ match in the same room, same
    // Server instance) could inherit STALE per-instance fields left over
    // from the PREVIOUS match -- these live on `this`, not `this.state`
    // (which createGame just replaced fresh, above), so nothing else ever
    // reset them. Confirmed: turnEndPendingSide left set (the previous
    // match ended via an attack that KO'd the last Pokémon and decided the
    // winner before confirmEndTurn ever ran -- there was no more turn left
    // to confirm) wrongly blocked the WINNER's very first action in the
    // new match: 'submitRpsChoice' isn't in runAction's own
    // turnEndPendingSide exemption list, so pressing rock/paper/scissors
    // threw "Debes confirmar el fin de tu turno primero." lastAttackResult/
    // lastTrainerPlay left set could similarly replay the OLD match's
    // reveal overlay during the new match's opening RPS/setup phase (both
    // are broadcast on every snapshot unconditionally, via redactedFor) --
    // likely the "board flashed with the previous duel's cards" the same
    // report described.
    this.turnEndPendingSide = null;
    this.turnStartedAt = null;
    this.attackRound = 0;
    this.trainerRound = 0;
    this.lastAttackResult = null;
    this.lastTrainerPlay = null;
    this.powerRound = 0;
    this.lastPowerUse = null;
    // "Duelo en Vivo": guards clearActiveMatch (maybeClearActiveMatch,
    // below) from firing more than once per match -- reset here exactly
    // like every other per-instance field above, so a rematch's fresh
    // match gets its own real clear, not a stale skip.
    this.matchEndNotified = false;
    this.persistState();
    registerActiveMatch(this.room.env, this.info.hostUid, this.info.roomCode).catch((e) => console.warn('registerActiveMatch error', e));
    registerActiveMatch(this.room.env, this.info.guestUid, this.info.roomCode).catch((e) => console.warn('registerActiveMatch error', e));
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
    // Real reported bug: redactMatchState (rules-engine.js) has no concept
    // of card-back/protector choice at all -- redactedFor forgot to carry
    // these through from `this.info` (already resolved once via
    // resolveIdentity at connect time) the way the room-phase broadcast
    // never needed to either, so ui.js's cardBackUrlFor always fell back
    // to the default and neither side ever saw the other's real protector.
    redacted.public.hostCardBackId = this.info.hostCardBackId || 'clasico';
    redacted.public.guestCardBackId = this.info.guestCardBackId || 'clasico';
    redacted.public.lastTrainerPlay = this.lastTrainerPlay || null;
    // Real reported bug, same shape as the hostCardBackId gap above:
    // redactMatchState has no concept of identity either, so the in-match
    // board never learned the rival's real username/photo (only the
    // pre-match waiting-room screen did, from the room-phase broadcast
    // above, which is a separate payload/lifecycle) -- ui.js's board
    // header fell back to the literal 'CPU' bot name and avatar for a real
    // human rival.
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
    // Real reported bug: turnEndPendingSide was never exposed to clients at
    // all -- the end-turn confirm modal only ever showed itself off a
    // purely client-ephemeral flag (ui.js's pvpAttackEndedMyTurn, set the
    // instant a player's OWN attack click fires, never reconstructible
    // from a snapshot) reset on every enterPvpMatch call. A player who
    // disconnected (or reconnected via Duelo en Vivo) while genuinely
    // owing a confirmation came back to a client with no way to ever show
    // that modal again, while this exact guard kept rejecting every other
    // action with "Debes confirmar el fin de tu turno primero." forever --
    // permanently stuck, no escape. Same 'player'/'cpu' -> 'player1'/
    // 'player2' mapping as forfeitedBy/winner just above.
    redacted.public.turnEndPendingSide = this.turnEndPendingSide === 'player' ? 'player1' : (this.turnEndPendingSide === 'cpu' ? 'player2' : null);
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
    clearActiveMatch(this.room.env, this.info.hostUid).catch((e) => console.warn('clearActiveMatch error', e));
    clearActiveMatch(this.room.env, this.info.guestUid).catch((e) => console.warn('clearActiveMatch error', e));
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

  // Ported verbatim from functions/index.js's submitMatchAction switch
  // (see that file's current lines ~1402-1553 for the full historical
  // rationale comments before Task 7 deletes it) -- same validation, same
  // error messages, same rules-engine.js calls. Only the transport around
  // it changed: a thrown Error here becomes a {type:'error'} message
  // instead of an HttpsError response.
  runAction(side, action) {
    const activeBefore = this.state.activePlayerId;
    // Real-time timeout enforcement: checked before anything else, on
    // WHATEVER real action arrives next (from either side) -- if the
    // currently active side's banked time is already exhausted by real
    // elapsed wall-clock time, commit that now via the same tickClock()
    // every other turn-handoff already uses, so getWinner() (called
    // inside redactMatchState, itself called by redactedFor) sees the
    // real zeroed-out value. Broadcasts immediately, right here -- not
    // left to whatever happens with the REST of this action (which might
    // still throw for an unrelated reason further down, e.g. the
    // turnEndPendingSide guard) -- a real timeout must never go unseen by
    // either client just because the action that happened to trigger the
    // check itself got rejected.
    if (this.state.phase === 'playing' && activeBefore && this.turnStartedAt) {
      const elapsed = Date.now() - this.turnStartedAt;
      if (this.state.players[activeBefore].timeBankMs - elapsed <= 0) {
        tickClock(this.state, activeBefore, elapsed);
        this.broadcastMatch();
      }
    }
    // Real reported bug: an attack in PVP used to flip activePlayerId
    // immediately (deferring only the *visible* checkup reveal -- see
    // attack()'s own deferTurnEnd comment, rules-engine.js), which let the
    // rival's own turn-gated actions become legal the instant their
    // snapshot arrived, even while the attacking player was still looking
    // at their own end-of-turn confirm modal. Now activePlayerId itself
    // stays the attacker's own side until 'confirmEndTurn' below actually
    // runs -- which also means canAttack()'s own turn check can no longer
    // catch a second attack/action from that same side in the meantime the
    // way it naturally did before. This blocks everything else from the
    // pending side except confirming, taking an owed prize, or choosing a
    // new Active (a self-KO, e.g. Confusion's self-hit or Selfdestruct,
    // can still need one before the player can confirm at all).
    if (this.turnEndPendingSide === side && ['confirmEndTurn', 'takePrize', 'chooseActive', 'claimTimeout', 'forfeit'].indexOf(action.type) === -1) {
      throw new Error('Debes confirmar el fin de tu turno primero.');
    }
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
        // Real reported bug: this used to require BOTH sides' Active
        // already placed before accepting EITHER side's own confirmation
        // -- so the player who finishes setting up first (a very normal
        // race, since both sides place independently) got their own
        // confirmSetup rejected with "Ambos jugadores deben colocar..."
        // even though THEY had already placed theirs, right as the
        // client's own "esperando al rival" waiting indicator was already
        // covering exactly that situation. Only this side's own Active
        // needs to be placed to record ITS OWN confirmation -- the match
        // still only actually starts once BOTH have confirmed (the check
        // below), and the opponent's own later confirmSetup is gated on
        // THEIR OWN Active the same way, so both are still guaranteed to
        // be placed by the time the match genuinely begins.
        if (!this.state.players[side].active) { throw new Error('Debes colocar tu Pokémon Activo antes de confirmar.'); }
        this.state.setupConfirmed = this.state.setupConfirmed || { player: false, cpu: false };
        this.state.setupConfirmed[side] = true;
        if (this.state.setupConfirmed.player && this.state.setupConfirmed.cpu) {
          engineStartMatch(this.state, this.state.activePlayerId);
          this.turnStartedAt = Date.now();
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
        // Commit the real elapsed time for the side whose turn is
        // genuinely ending, before anything else -- endTurn()/
        // applyEndOfTurnCheckup() below don't touch timeBankMs at all.
        tickClock(this.state, side, Date.now() - this.turnStartedAt);
        endTurn(this.state);
        // No attack was involved -- this click IS the explicit "I'm done"
        // moment (same one local play's own Terminar Turno button already
        // is), so checkup applies immediately, nothing to defer.
        applyEndOfTurnCheckup(this.state);
        this.turnStartedAt = Date.now(); // the NEW active side's clock starts now
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
        // deferTurnEnd=true always, regardless of side -- see attack()'s
        // own comment (rules-engine.js): activePlayerId stays exactly as it
        // is (this side's) until 'confirmEndTurn' below actually runs, so
        // the rival's client can never legally act before the attacking
        // player has actually confirmed.
        attack(this.state, side, action.attackName, action.targetInstanceId, true);
        this.attackRound = (this.attackRound || 0) + 1;
        this.lastAttackResult = this.state.lastAttackResult
          ? Object.assign({}, this.state.lastAttackResult, { round: this.attackRound })
          : null;
        this.state.lastAttackResult = null; // never let a stale result leak into a later attack's own check
        // Set every time an attack ends a turn -- see 'confirmEndTurn' and
        // runAction's own top-of-function guard above, both of which key
        // off this. Not reset anywhere but confirmEndTurn itself: if a
        // second attack (impossible in practice -- the guard above already
        // blocks this same side from attacking again first) or a checkup-
        // caused self-KO -> new-Active flow re-enters this case, the still-
        // pending confirmation is still real and confirmEndTurn should
        // still honor it.
        this.turnEndPendingSide = side;
        break;
      }
      case 'confirmEndTurn': {
        // Idempotency guard: endTurn()/applyEndOfTurnCheckup both mutate
        // state every time they run (turnCounter, poison/burn damage, coin
        // flips for waking/curing) -- NOT safe to call twice for the same
        // pending turn-end (a stray double-click, a retried request).
        // Silently a no-op when nothing is actually pending FOR THIS SIDE,
        // rather than throwing -- the client's own "SÍ"/"NO" buttons both
        // send this exact action (see ui.js's applyPvpEndTurnConfirmDismiss),
        // and either one arriving twice, arriving with nothing pending
        // (e.g. a stale reconnect), or arriving from the wrong side, should
        // never be treated as a real error.
        if (this.turnEndPendingSide === side) {
          this.turnEndPendingSide = null;
          // Same commit as the plain 'endTurn' case above -- the attacking
          // side was still "on the clock" for the whole confirmation
          // window (real chess-clock rule: you're on the clock until your
          // turn is genuinely, fully over).
          tickClock(this.state, side, Date.now() - this.turnStartedAt);
          endTurn(this.state);
          applyEndOfTurnCheckup(this.state);
          this.turnStartedAt = Date.now();
        }
        break;
      }
      case 'claimTimeout': {
        // No-op beyond the top-of-function check above, which already ran
        // for this same action before reaching here -- this action exists
        // purely so an idle client (both sides silent right as a clock
        // hits 0) has a way to nudge the server into re-checking, since
        // nothing else would trigger it on its own. Harmless whether or
        // not time had actually run out (the check above already decided
        // that either way).
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
      case 'playTrainer': {
        const fn = TRAINER_EFFECTS[action.trainerName];
        if (!fn) { throw new Error('Carta de Entrenador desconocida.'); }
        const result = fn.apply(null, [this.state, side, action.handId].concat(action.args || []));
        if (!result.legal) { throw new Error(result.reason); }
        this.trainerRound = (this.trainerRound || 0) + 1;
        this.lastTrainerPlay = { side: side === 'player' ? 'player1' : 'player2', cardName: action.trainerName, targetName: result.targetName || null, round: this.trainerRound };
        break;
      }
      case 'usePower': {
        // Captured BEFORE the effect runs, not after: Buzzap knocks its
        // OWN owner out of play (findInstance would return undefined
        // afterward, since knockOutIfNeeded clears the slot) --
        // ownerBefore/powerBefore are plain values by the time they're
        // actually used below, so the owner leaving play doesn't matter.
        const ownerBefore = findInstance(this.state.players[side], action.ownerInstanceId);
        const powerBefore = ownerBefore && CARD_STATS[ownerBefore.name] && CARD_STATS[ownerBefore.name].pokemonPower;
        const result = usePokemonPower(this.state, side, action.ownerInstanceId, action.params || {});
        if (!result.legal) { throw new Error(result.reason); }
        this.powerRound = (this.powerRound || 0) + 1;
        // params.toInstanceId (Damage Swap/Energy Trans) or
        // params.targetInstanceId (Rain Dance/Buzzap) -- Energy Burn has
        // neither, so targetName stays null. Safe to resolve AFTER the
        // effect ran (unlike ownerBefore above): none of the 5 effects
        // ever remove the TARGET Pokémon from play, only Buzzap removes
        // its own OWNER.
        const targetId = (action.params && (action.params.toInstanceId || action.params.targetInstanceId)) || null;
        const targetInstance = targetId ? findInstance(this.state.players[side], targetId) : null;
        this.lastPowerUse = {
          side: side === 'player' ? 'player1' : 'player2',
          ownerName: ownerBefore.name,
          powerName: powerBefore.name,
          targetName: targetInstance ? targetInstance.name : null,
          round: this.powerRound
        };
        break;
      }
      case 'forfeit': {
        // Always legal (see Step 7's exemption + TURN_GATED_ACTIONS never
        // listing it) -- getWinner() (rules-engine.js) now checks this
        // before anything else, so the very next broadcastMatch()/
        // sendMatchTo() call (right after this runAction returns, in
        // onMessage's 'action' handler) both decides the winner AND fires
        // maybeClearActiveMatch() for both sides.
        // Guard: a stale/duplicate 'forfeit' (e.g. a directory entry that
        // survived a failed best-effort clearActiveMatch -- see
        // registerActiveMatch/clearActiveMatch above -- and the player later
        // pressing "No" on the Duelo en Vivo banner) must never re-open and
        // flip the winner of a match that's already decided.
        if (getWinner(this.state)) { break; }
        this.state.forfeitedBy = side;
        break;
      }
      default:
        throw new Error('Tipo de acción desconocido: ' + action.type);
    }
    // Real reported bug (severe): the host stopped drawing cards at the
    // start of their own turns partway through a match, while the guest
    // kept drawing fine. Root cause: this compensation was "ported
    // verbatim" from functions/index.js's now-deleted submitMatchAction,
    // which excluded the 'player' engine slot from it -- that made sense
    // in THAT architecture (every caller saw their OWN side as 'player',
    // so each caller's own client handled its own draw separately) but not
    // in this one, where redactMatchState's mapping is FIXED (the host is
    // always engine slot 'player', the guest always 'cpu' -- see its own
    // comment) and nothing else EVER draws for the host: ui.js's own
    // client-side drawForTurnStart call is explicitly gated `!pvpMode`
    // (startPlayerTurnWithDraw), and rules-engine.js's startMatch() only
    // ever covers turn 1. The host drew turn 1 (via startMatch) and then
    // never again from turn 3 onward -- exactly the reported symptom.
    if (this.state.turnCounter > 1 && this.state.activePlayerId !== activeBefore && this.state.humanControlled[this.state.activePlayerId]) {
      drawForTurnStart(this.state, this.state.activePlayerId);
    }
  }
}
