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
