import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startServer, stopServer, client, signIn, emailFor, seedVideo, pool } from './helpers.js';
import { setTransport } from '../src/email.js';

let call;
let base;
let sent;
before(async () => {
  ({ base } = await startServer());
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

const me = async (token) => (await call('/me', { token })).data.user;
const local = (url) => {
  const u = new URL(url);
  return `${new URL(base).origin}${u.pathname}${u.search}`;
};
const linkIn = (msg) => msg.text.match(/https?:\/\/\S+/)[0];
const follow = async (url) => (await fetch(local(url), { redirect: 'manual' })).headers.get('location');
const verified = (name) => pool.query('UPDATE users SET email_verified = true WHERE username = $1', [name]);
const events = async (token) => (await call('/account/security', { token })).data.events.map((e) => e.type);

describe('account settings need a session', () => {
  test('401 when signed out', async () => {
    for (const path of ['/account/notifications', '/account/security']) {
      assert.equal((await call(path)).status, 401, path);
    }
    assert.equal((await call('/account/email', { method: 'POST', body: {} })).status, 401);
  });
});

describe('notification settings', () => {
  test('everything is on until turned off; bad input is refused', async () => {
    const token = await signIn(call, 'prefs_fan');
    const r = await call('/account/notifications', { token });
    assert.deepEqual(r.data.prefs, {
      mention: { site: true, push: true },
      reply: { site: true, push: true },
    });
    const bad = await call('/account/notifications', {
      method: 'PUT',
      token,
      body: { prefs: { mention: { email: true } } },
    });
    assert.equal(bad.status, 400);
    const saved = await call('/account/notifications', {
      method: 'PUT',
      token,
      body: { prefs: { mention: { site: false } } },
    });
    assert.deepEqual(saved.data.prefs.mention, { site: false, push: true });
    assert.deepEqual(saved.data.prefs.reply, { site: true, push: true });
  });

  test('bell off keeps mentions out of the bell; bell and push off means no notification at all', async () => {
    const quiet = await signIn(call, 'quiet_fan');
    const silent = await signIn(call, 'silent_fan');
    const poster = await signIn(call, 'loud_poster');
    await call('/account/notifications', {
      method: 'PUT',
      token: quiet,
      body: { prefs: { mention: { site: false } } },
    });
    await call('/account/notifications', {
      method: 'PUT',
      token: silent,
      body: { prefs: { mention: { site: false, push: false } } },
    });
    const videoId = await seedVideo();
    const posted = await call(`/videos/${videoId}/chat`, {
      method: 'POST',
      token: poster,
      body: { text: 'hi @quiet_fan and @silent_fan', offsetMs: 1000 },
    });
    assert.equal(posted.status, 200);

    assert.equal((await call('/notifications', { token: quiet })).data.notifications.length, 0);
    assert.equal((await call('/notifications', { token: quiet })).data.unread, 0);
    const { rows } = await pool.query(
      `SELECT u.username, n.in_bell FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE u.username IN ('quiet_fan', 'silent_fan')`,
    );
    assert.deepEqual(
      rows,
      [{ username: 'quiet_fan', in_bell: false }],
      'push-only row kept; none for silent',
    );
  });
});

describe('security history', () => {
  test('lists account creation, sign-ins, and password changes', async () => {
    const token = await signIn(call, 'history_fan');
    const again = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'history_fan', password: 'password1234' },
    });
    const changed = await call('/auth/change-password', {
      method: 'POST',
      token: again.token,
      body: { currentPassword: 'password1234', newPassword: 'another-password-1', revokeOtherSessions: true },
    });
    assert.equal(changed.status, 200);
    assert.equal(await me(token), null, 'other devices are signed out');
    const types = await events(changed.token);
    assert.deepEqual(types, ['password_changed', 'signed_in', 'account_created']);
  });

  test('a wrong current password changes nothing and logs nothing', async () => {
    const token = await signIn(call, 'history_wrong');
    const r = await call('/auth/change-password', {
      method: 'POST',
      token,
      body: { currentPassword: 'not-it-at-all', newPassword: 'another-password-1' },
    });
    assert.notEqual(r.status, 200);
    assert.deepEqual(await events(token), ['account_created']);
  });
});

describe('changing a confirmed email', () => {
  test('needs the password, confirms the new address, and lets the old one undo it', async () => {
    const token = await signIn(call, 'mover');
    await verified('mover');
    sent = [];

    const direct = await call('/auth/change-email', {
      method: 'POST',
      token,
      body: { newEmail: 'x@test.example' },
    });
    assert.equal(direct.status, 403, 'confirmed accounts go through account settings');

    const wrong = await call('/account/email', {
      method: 'POST',
      token,
      body: { newEmail: 'moved@test.example', password: 'nope-nope-nope' },
    });
    assert.equal(wrong.status, 400);
    assert.equal(sent.length, 0);

    const ask = await call('/account/email', {
      method: 'POST',
      token,
      body: { newEmail: 'Moved@Test.example', password: 'password1234' },
    });
    assert.equal(ask.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'moved@test.example');
    assert.equal((await me(token)).email, emailFor('mover'), 'nothing changes until the link is used');

    assert.equal(await follow(linkIn(sent[0])), '/account?email=changed');
    assert.equal(await follow(linkIn(sent[0])), '/account?email=expired', 'the link works once');
    const user = await me(token);
    assert.equal(user.email, 'moved@test.example');
    assert.equal(user.emailVerified, true);

    const notice = sent.find((m) => m.template === 'email_changed');
    assert.equal(notice.to, emailFor('mover'), 'the old address is told');
    assert.equal(await follow(linkIn(notice)), '/?email=restored');
    assert.equal(await me(token), null, 'undo signs out every device');
    const { rows } = await pool.query(`SELECT email FROM users WHERE username = 'mover'`);
    assert.equal(rows[0].email, emailFor('mover'));
    const reset = sent.find((m) => m.template === 'reset_password');
    assert.equal(reset.to, emailFor('mover'), 'and sends a link to choose a new password');
    assert.equal(await follow(linkIn(notice)), '/?email=undo-expired');

    const signedIn = await call('/auth/sign-in/username', {
      method: 'POST',
      body: { username: 'mover', password: 'password1234' },
    });
    assert.deepEqual((await events(signedIn.token)).slice(0, 4), [
      'signed_in',
      'email_change_undone',
      'email_changed',
      'email_change_requested',
    ]);
  });

  test("an address that's taken gets the same answer but no email", async () => {
    await signIn(call, 'owner_of_it');
    const token = await signIn(call, 'wants_it');
    await verified('wants_it');
    sent = [];
    const r = await call('/account/email', {
      method: 'POST',
      token,
      body: { newEmail: emailFor('owner_of_it'), password: 'password1234' },
    });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 0);
  });
});
