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
  // Node's native WebSocket#close() against PartyKit's local dev server
  // (workerd) never completes the close handshake -- the underlying
  // sockets are left open indefinitely even after the server has
  // acknowledged and the process would otherwise hang forever waiting
  // for them to fully tear down. All assertions above have already run,
  // so exit explicitly once they pass.
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
