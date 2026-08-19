const { initializeApp } = require('firebase/app');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const assert = require('assert');

const app = initializeApp({ projectId: 'demo-test', apiKey: 'demo-key' });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

async function main() {
  const resolveLoginEmail = httpsCallable(functions, 'resolveLoginEmail');

  // Every call shares the same rate-limit bucket in a fresh emulator (keyed by
  // caller IP), regardless of whether the username exists -- the rate-limit
  // check runs before the username lookup.
  for (var i = 0; i < 20; i++) {
    try {
      await resolveLoginEmail({ username: 'nosuchuser' });
      assert.fail('expected an unknown username to be rejected as not-found');
    } catch (e) {
      assert.strictEqual(e.code, 'functions/not-found', 'the first 20 calls should fail on "not found", not the rate limit');
    }
  }
  console.log('PASS: 20 calls in the window all resolve normally (not rate-limited yet)');

  try {
    await resolveLoginEmail({ username: 'nosuchuser' });
    assert.fail('expected the 21st call in the window to be rate-limited');
  } catch (e) {
    assert.strictEqual(e.code, 'functions/resource-exhausted');
    console.log('PASS: the 21st call in the window is rate-limited');
  }

  console.log('ALL RATE LIMIT TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
