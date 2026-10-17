// Sign in with Google from the phone apps (MBJ-110): the app sends the ID token from the phone's account picker.
// Google is switched on for this file only (helpers.js blanks it); nothing here reaches Google: the tokens are refused
// before any key lookup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, pool } from './helpers.js';

let call;
before(async () => {
  process.env.GOOGLE_CLIENT_ID = 'web-client.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  process.env.GOOGLE_IOS_CLIENT_ID = 'ios-client.apps.googleusercontent.com';
  const { base } = await startServer();
  call = client(base);
});
after(stopServer);

const accounts = async () => (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('the apps get the public client ids for the phone’s Google account picker', async () => {
  assert.deepEqual((await call('/sign-in-options')).data, {
    google: true,
    googleClientId: 'web-client.apps.googleusercontent.com',
    googleIosClientId: 'ios-client.apps.googleusercontent.com',
  });
});

test('a token Google didn’t sign is refused, and no account is made', async () => {
  const before = await accounts();
  const notAToken = await call('/auth/sign-in/social', {
    method: 'POST',
    body: { provider: 'google', idToken: { token: 'not-a-google-token' } },
  });
  assert.equal(notAToken.status, 401);
  assert.equal(notAToken.token, null);
  // Looks like a Google token, but signed with a shared secret instead of Google's key.
  const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: 'web-client.apps.googleusercontent.com',
    sub: '123',
    email: 'someone@test.example',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 600,
  })}.c2lnbmF0dXJl`;
  const r = await call('/auth/sign-in/social', {
    method: 'POST',
    body: { provider: 'google', idToken: { token: forged } },
  });
  assert.equal(r.status, 401);
  assert.equal(r.token, null);
  assert.equal(await accounts(), before);
});
