const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seedDb = ctx.firestore();
    await seedDb.collection('users').doc('alice-uid').set({
      username: 'alice', coins: 150, collection: {}
    });
    await seedDb.collection('usernames').doc('alice').set({ uid: 'alice-uid' });
    await seedDb.collection('news').doc('news-1').set({
      title: 'Novedad de prueba', body: 'Cuerpo', tag: 'balance', featured: false
    });
  });

  const aliceDb = testEnv.authenticatedContext('alice-uid').firestore();
  const bobDb = testEnv.authenticatedContext('bob-uid').firestore();
  const anonDb = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(aliceDb.collection('users').doc('alice-uid').get());
  console.log('PASS: owner can read their own user doc');

  await assertFails(bobDb.collection('users').doc('alice-uid').get());
  console.log('PASS: another signed-in user cannot read alice\'s doc');

  await assertFails(anonDb.collection('users').doc('alice-uid').get());
  console.log('PASS: an unauthenticated client cannot read alice\'s doc');

  await assertFails(aliceDb.collection('users').doc('alice-uid').update({ coins: 999999 }));
  console.log('PASS: even the owner cannot write their own coins directly');

  await assertFails(aliceDb.collection('usernames').doc('alice').get());
  console.log('PASS: usernames collection is not client-readable');

  await assertSucceeds(aliceDb.collection('news').doc('news-1').get());
  console.log('PASS: any signed-in player can read the published news');

  await assertFails(anonDb.collection('news').doc('news-1').get());
  console.log('PASS: an unauthenticated client cannot read the news either');

  await assertFails(aliceDb.collection('news').doc('news-1').update({ title: 'Hackeado' }));
  console.log('PASS: even a signed-in player cannot write news directly (only publishNews/updateNewsItem/deleteNewsItem, server-side, can)');

  await testEnv.cleanup();
  console.log('ALL RULES TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
