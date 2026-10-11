import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';

let call;
before(async () => {
  const { base } = await startServer();
  call = client(base);
});
after(stopServer);

test('the welcome checklist follows what the member has actually done, and can be hidden', async () => {
  const token = await signIn(call, 'new_member');
  assert.equal((await call('/account/welcome')).status, 401);
  assert.deepEqual((await call('/account/welcome', { token })).data, {
    emailConfirmed: false,
    pushOn: false,
    youtubeLinked: false,
    member: false,
    dismissed: false,
  });

  const { rows } = await pool.query(`SELECT id FROM users WHERE username = 'new_member'`);
  const id = rows[0].id;
  await pool.query(`UPDATE users SET email_verified = true, tier = 'plus' WHERE id = $1`, [id]);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.example/x', 'k', 'a')`,
    [id],
  );
  await pool.query(
    `INSERT INTO linked_accounts (user_id, platform, status, handle) VALUES ($1, 'youtube', 'pending', '@NewOnYT')`,
    [id],
  );
  const done = (await call('/account/welcome', { token })).data;
  assert.deepEqual(
    [done.emailConfirmed, done.pushOn, done.youtubeLinked, done.member],
    [true, true, true, true],
  );

  assert.equal((await call('/account/welcome/dismiss', { method: 'POST', token })).status, 200);
  assert.equal((await call('/account/welcome', { token })).data.dismissed, true);
});
