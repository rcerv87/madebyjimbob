import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { promisify } from 'util';
import WebSocket from 'ws';
import { startServer, stopServer, client, signIn, emailFor, seedVideo, pool } from './helpers.js';
import { setTransport } from '../src/email.js';

let call;
let base;
let wsUrl;
let sent;
before(async () => {
  ({ base, wsUrl } = await startServer());
  call = client(base);
});
after(stopServer);
beforeEach(() => {
  sent = [];
  setTransport(async (msg) => {
    sent.push(msg);
    return `re_${crypto.randomUUID()}`;
  });
});

const signUp = (body) =>
  call('/auth/sign-up/email', {
    method: 'POST',
    body: { password: 'password1234', name: body.username, email: emailFor(body.username), ...body },
  });
const me = async (token) => (await call('/me', { token })).data.user;

// Links in emails use the site's address; point them at the test server instead.
const local = (url) => {
  const u = new URL(url);
  return `${new URL(base).origin}${u.pathname}${u.search}`;
};
const linkIn = (msg) => msg.text.match(/https?:\/\/\S+/)[0];

describe('sign-up', () => {
  test('creates an account with a username, and sends a verification email', async () => {
    const r = await signUp({ username: 'New_Fan' });
    assert.equal(r.status, 200);
    assert.ok(r.token);
    const user = await me(r.token);
    assert.equal(user.username, 'New_Fan');
    assert.equal(user.email, 'new_fan@test.example');
    assert.equal(user.emailVerified, false);
    assert.equal(user.tier, 'free');
    assert.equal(user.isAdmin, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].template, 'verify_email');
    assert.equal(sent[0].to, 'new_fan@test.example');
  });

  test('usernames: 3–32 letters, numbers, underscores; unique ignoring case; no reserved or banned names', async () => {
    await signUp({ username: 'taken_name' });
    const cases = {
      'a!b': 'INVALID_USERNAME',
      ab: 'USERNAME_TOO_SHORT',
      ['x'.repeat(33)]: 'USERNAME_TOO_LONG',
      TAKEN_NAME: 'USERNAME_IS_ALREADY_TAKEN',
      admin: 'USERNAME_RESERVED',
      JimBob: 'USERNAME_RESERVED',
      my_badword_name: 'INVALID_USERNAME',
    };
    for (const [username, code] of Object.entries(cases)) {
      const r = await signUp({ username, email: `${crypto.randomUUID()}@test.example` });
      assert.notEqual(r.status, 200, username);
      assert.equal(r.data.code, code, username);
    }
  });

  test('the email can only be used once', async () => {
    await signUp({ username: 'first_owner', email: 'shared@test.example' });
    const r = await signUp({ username: 'second_owner', email: 'Shared@Test.example' });
    assert.notEqual(r.status, 200);
  });

  test('passwords need at least 10 characters', async () => {
    const r = await signUp({ username: 'short_pw', password: 'nine_char' });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'PASSWORD_TOO_SHORT');
  });

  test('nobody can choose their own tier or XP', async () => {
    const r = await signUp({ username: 'sneaky', tier: 'premium', xp: 9999 });
    const user = await me(r.token);
    assert.equal(user.tier, 'free');
    assert.equal(user.xp, 0);
  });

  test('the admin email can take a reserved name, and is an admin only once verified', async () => {
    const r = await signUp({ username: 'jimbob', email: 'jimbob@test.example' });
    assert.equal(r.status, 200);
    assert.equal((await me(r.token)).isAdmin, false);
    assert.equal((await call('/studio/overview', { token: r.token })).status, 403);

    const res = await fetch(local(linkIn(sent.at(-1))), { redirect: 'manual' });
    assert.ok(res.status < 400);
    const user = await me(r.token);
    assert.equal(user.emailVerified, true);
    assert.equal(user.isAdmin, true);
    assert.equal(user.tier, 'premium');
  });
});

describe('sign-in and sign-out', () => {
  test('by username (any case) or email; a wrong password is refused', async () => {
    await signUp({ username: 'Returning' });
    const byName = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'RETURNING', password: 'password1234' },
    });
    assert.equal(byName.status, 200);
    const byEmail = await call('/auth/sign-in/email', {
      method: 'POST',
      body: { email: 'returning@test.example', password: 'password1234' },
    });
    assert.equal(byEmail.status, 200);
    assert.equal((await me(byEmail.token)).username, 'Returning');
    const wrong = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'returning', password: 'not-the-password' },
    });
    assert.equal(wrong.status, 401);
  });

  test('sign-out ends that session', async () => {
    const token = await signIn(call, 'leaving');
    assert.equal((await call('/auth/sign-out', { method: 'POST', token })).status, 200);
    assert.equal(await me(token), null);
  });

  test('the old POC sign-in endpoint is gone', async () => {
    const r = await call('/session', { method: 'POST', body: { username: 'x', password: 'password1234' } });
    assert.equal(r.status, 404);
  });
});

describe('password reset', () => {
  test('emails a one-time link; the new password works and other devices are signed out', async () => {
    const oldToken = await signIn(call, 'forgetful');
    sent = [];
    const ask = await call('/auth/request-password-reset', {
      method: 'POST',
      body: { email: emailFor('forgetful'), redirectTo: '/reset-password' },
    });
    assert.equal(ask.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].template, 'reset_password');

    // The emailed link redirects to our /reset-password page with the token.
    const res = await fetch(local(linkIn(sent[0])), { redirect: 'manual' });
    const token = new URL(res.headers.get('location'), base).searchParams.get('token');
    assert.ok(token);
    const reset = await call('/auth/reset-password', {
      method: 'POST',
      body: { newPassword: 'brand-new-password', token },
    });
    assert.equal(reset.status, 200);
    assert.equal(await me(oldToken), null, 'old sessions are revoked');
    const again = await call('/auth/reset-password', {
      method: 'POST',
      body: { newPassword: 'another-password', token },
    });
    assert.notEqual(again.status, 200, 'the link works once');

    const signedIn = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'forgetful', password: 'brand-new-password' },
    });
    assert.equal(signedIn.status, 200);
  });

  test("doesn't reveal whether an email has an account", async () => {
    const r = await call('/auth/request-password-reset', {
      method: 'POST',
      body: { email: 'nobody@test.example', redirectTo: '/reset-password' },
    });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 0);
  });
});

describe('accounts from the POC', () => {
  test('keep their username and password, and are asked for an email', async () => {
    // What the migration leaves: a placeholder email and the old scrypt$ hash as the credential.
    const salt = crypto.randomBytes(16);
    const hash = await promisify(crypto.scrypt)('old-password-1', salt, 64);
    const { rows } = await pool.query(
      `INSERT INTO users (username, username_key, display_name, email, tier)
       VALUES ('PocUser', 'pocuser', 'PocUser', 'userpoc@no-email.invalid', 'free') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO accounts (user_id, account_id, provider_id, password) VALUES ($1, $2, 'credential', $3)`,
      [rows[0].id, String(rows[0].id), `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`],
    );

    const r = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'pocuser', password: 'old-password-1' },
    });
    assert.equal(r.status, 200);
    const user = await me(r.token);
    assert.equal(user.username, 'PocUser');
    assert.equal(user.email, null, 'placeholder email is hidden, so the site asks for one');

    const change = await call('/auth/change-email', {
      method: 'POST',
      token: r.token,
      body: { newEmail: 'poc.user@test.example', callbackURL: '/' },
    });
    assert.equal(change.status, 200);
    assert.equal((await me(r.token)).email, 'poc.user@test.example');
  });

  test('never get mail at the placeholder address', async () => {
    const { sendEmail } = await import('../src/email.js');
    const r = await sendEmail({ to: 'user1@no-email.invalid', template: 'account_deleted', data: {} });
    assert.equal(r.status, 'suppressed');
    assert.equal(sent.length, 0);
  });
});

describe('live chat socket', () => {
  test('knows who you are from the session cookie', async () => {
    const res = await fetch(`${base}/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin },
      body: JSON.stringify({
        email: emailFor('cookie_fan'),
        password: 'password1234',
        name: 'cookie_fan',
        username: 'cookie_fan',
      }),
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert.match(cookie, /mbj\.session_token=/);
    const { rows } = await pool.query(
      `UPDATE users SET tier = 'premium' WHERE username = 'cookie_fan' RETURNING id`,
    );
    assert.ok(rows[0]);

    const videoId = await seedVideo({ minTier: 'premium' });
    const ws = new WebSocket(wsUrl, { headers: { cookie } });
    await new Promise((r) => ws.once('open', r));
    const reply = new Promise((resolve) => {
      ws.once('message', (m) => resolve(JSON.parse(m)));
      setTimeout(() => resolve('no error'), 500);
    });
    ws.send(JSON.stringify({ type: 'join', videoId }));
    assert.equal(await reply, 'no error', 'premium member joins the premium room');
    ws.close();

    const anon = new WebSocket(wsUrl);
    await new Promise((r) => anon.once('open', r));
    const refused = new Promise((resolve) => anon.once('message', (m) => resolve(JSON.parse(m))));
    anon.send(JSON.stringify({ type: 'join', videoId }));
    assert.equal((await refused).type, 'error');
    anon.close();
  });
});
