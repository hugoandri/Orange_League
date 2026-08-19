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
