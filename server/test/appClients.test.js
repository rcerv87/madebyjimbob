// The phone apps (ADR-014): their pages come from the phone (capacitor://localhost on iPhone, https://localhost on
// Android), so the API answers those origins, and they sign in with a Bearer token instead of a cookie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.js';

let base;
before(async () => {
  ({ base } = await startServer());
});
after(stopServer);

const from = (origin, path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(init.headers || {}) },
  });

test('the apps’ origins may call the API and read the sign-in token; other sites may not', async () => {
  for (const origin of ['capacitor://localhost', 'https://localhost']) {
    const pre = await from(origin, '/auth/sign-in/username', {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(pre.status, 204, origin);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
    assert.equal(pre.headers.get('access-control-allow-credentials'), null, 'no cookies across');
  }
  const other = await from('https://evil.example', '/videos');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const same = await fetch(`${base}/videos`);
  assert.equal(same.headers.get('access-control-allow-origin'), null, 'the website itself needs none');
});

test('an app signs up and signs in with its own origin, then uses the token', async () => {
  const origin = 'capacitor://localhost';
  const up = await from(origin, '/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      email: 'phone_app@test.example',
      password: 'password1234',
      name: 'phone_app',
      username: 'phone_app',
    }),
  });
  assert.equal(up.status, 200, await up.clone().text());
  assert.match(up.headers.get('access-control-expose-headers'), /set-auth-token/);
  assert.ok(up.headers.get('set-auth-token'));

  const signIn = await from(origin, '/auth/sign-in/username', {
    method: 'POST',
    body: JSON.stringify({ username: 'phone_app', password: 'password1234' }),
  });
  assert.equal(signIn.status, 200);
  const token = signIn.headers.get('set-auth-token');
  const me = await (await from(origin, '/me', { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(me.user.username, 'phone_app');

  const out = await from(origin, '/auth/sign-out', {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(out.status, 200);
  const after = await (await from(origin, '/me', { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(after.user, null, 'signing out ends that token');
});
