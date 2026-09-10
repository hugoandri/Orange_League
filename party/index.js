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
// getWinner isn't destructured here even though Task 1 exports it --
// redactMatchState (below) already calls it internally as a bare
// identifier within rules-engine.js's own module scope, so nothing
// outside that file ever needs to call it directly.
const {
  createGame, startMatch: engineStartMatch, canPlayBasic, playBasic, canEvolve, evolve,
  canAttachEnergy, attachEnergy, canRetreat, retreat, takePrize, chooseNewActive,
  canAttack, attack, endTurn, drawForTurnStart, redactMatchState, submitRpsChoice,
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
  dealDamage, coinFlip, addStatus, knockOutIfNeeded, translateAttackName
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
    const savedState = await this.room.storage.get('state');
    if (savedState) { this.state = Object.assign({}, savedState, { rng: Math.random }); }
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
        attack(this.state, side, action.attackName, action.targetInstanceId);
        this.attackRound = (this.attackRound || 0) + 1;
        this.lastAttackResult = this.state.lastAttackResult
          ? Object.assign({}, this.state.lastAttackResult, { round: this.attackRound })
          : null;
        this.state.lastAttackResult = null; // never let a stale result leak into a later attack's own check
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
}
