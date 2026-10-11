import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

let call;
let suggestUsername;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  ({ suggestUsername } = await import('../src/auth.js'));
});
after(stopServer);

// What a Google sign-up looks like to our code: a new user with a name and an email but no username.
async function joinWithoutUsername(email, name) {
  const r = await call('/auth/sign-up/email', {
    method: 'POST',
    body: { email, name, password: 'password1234' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.token;
}
const me = async (token) => (await call('/me', { token })).data.user;
const pick = (token, body) => call('/account/username', { method: 'POST', token, body });

test('the Google button stays hidden until the Google keys are set', async () => {
  assert.deepEqual((await call('/sign-in-options')).data, { google: false });
});

test('a made-up username comes from the name, never the email, and is always valid', async () => {
  assert.match(await suggestUsername('Jane O’Neil-Smith'), /^JaneONeilSmith\d{4}$/);
  assert.match(await suggestUsername('李'), /^member\d{4}$/);
  assert.match(await suggestUsername(''), /^member\d{4}$/);
  assert.match(await suggestUsername('x'.repeat(80)), /^x{24}\d{4}$/);
});

test('someone who joins without a username gets one made up and is asked to pick their own', async () => {
  const token = await joinWithoutUsername('secret.address@test.example', 'Sam Rivera');
  const first = await me(token);
  assert.match(first.username, /^SamRivera\d{4}$/);
  assert.equal(first.needsUsername, true);

  const videoId = await seedVideo();
  await call(`/videos/${videoId}/chat`, { method: 'POST', token, body: { text: 'hi', offsetMs: 0 } });

  await signIn(call, 'taken_name');
  assert.match((await pick(token, { username: 'no' })).data.error, /3–32 letters/);
  assert.match((await pick(token, { username: 'Taken_Name' })).data.error, /taken/);
  assert.match((await pick(token, { username: 'admin' })).data.error, /reserved/);
  assert.match((await pick(token, { username: 'badword_fan' })).data.error, /isn’t allowed/);
  assert.equal((await pick(null, { username: 'whoever' })).status, 401);

  const ok = await pick(token, { username: 'SamTheMan' });
  assert.equal(ok.status, 200);
  const now = await me(token);
  assert.equal(now.username, 'SamTheMan');
  assert.equal(now.displayName, 'SamTheMan');
  assert.equal(now.needsUsername, false);
  const { rows } = await pool.query('SELECT author_name FROM chat_messages WHERE user_id = $1', [now.id]);
  assert.deepEqual(rows, [{ author_name: 'SamTheMan' }], 'what they already posted carries the new name');

  assert.equal((await pick(token, { username: 'AnotherName' })).status, 409, 'only once');
  const again = await call('/auth/sign-in/username', {
    method: 'POST',
    body: { username: 'samtheman', password: 'password1234' },
  });
  assert.equal(again.status, 200, 'the new username signs in');
});

test('keeping the made-up username also ends the question', async () => {
  const token = await joinWithoutUsername('keeper@test.example', 'Kee Per');
  const before = await me(token);
  assert.equal((await pick(token, { keep: true })).status, 200);
  const after = await me(token);
  assert.equal(after.username, before.username);
  assert.equal(after.needsUsername, false);
});

test('accounts made the usual way are never asked', async () => {
  const token = await signIn(call, 'regular_joe');
  assert.equal((await me(token)).needsUsername, false);
  assert.equal((await pick(token, { username: 'new_joe' })).status, 409);
});
