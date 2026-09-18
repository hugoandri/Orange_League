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
