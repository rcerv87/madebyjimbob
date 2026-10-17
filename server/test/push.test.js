// Notifications in the phone apps (MBJ-405): the app registers its Firebase token, and replies reach it through
// Firebase. A local stand-in plays Google's token endpoint and Firebase; nothing goes to Google.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';
import { startServer, stopServer, client, seedVideo, signIn, sleep, pool } from './helpers.js';
import { forgetCachedFcmToken } from '../src/fcm.js';

let call;
let base;
let fake;
const tokenRequests = [];
const sends = [];
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

before(async () => {
  const s = await startServer();
  base = s.base;
  call = client(base);
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') {
        tokenRequests.push(new URLSearchParams(raw));
        return res.end(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }));
      }
      const body = JSON.parse(raw);
      sends.push({ url: req.url, auth: req.headers.authorization, message: body.message });
      if (body.message.token === 'other-project-phone') {
        res.statusCode = 403;
        return res.end(
          JSON.stringify({
            error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] },
          }),
        );
      }
      if (body.message.token === 'bad-message-phone') {
        res.statusCode = 400;
        return res.end(
          JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' } }),
        );
      }
      if (body.message.token === 'uninstalled-phone') {
        res.statusCode = 404;
        return res.end(
          JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }),
        );
      }
      res.end(JSON.stringify({ name: 'projects/mbj-test/messages/1' }));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakeBase = `http://127.0.0.1:${fake.address().port}`;
  process.env.FCM_API_BASE = fakeBase;
  process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    project_id: 'mbj-test',
    client_email: 'push@mbj-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: `${fakeBase}/token`,
  });
});
after(async () => {
  process.env.FCM_SERVICE_ACCOUNT = '';
  await new Promise((resolve) => fake.close(resolve));
  await stopServer();
});

const register = (token, deviceToken, platform = 'android') =>
  call('/push/device', { method: 'POST', token, body: { token: deviceToken, platform } });
const devicesOf = async (deviceToken) =>
  (await pool.query('SELECT user_id FROM device_tokens WHERE token = $1', [deviceToken])).rows;
// One comment by `to`; each reply to it (from a different member: comments are one per 5 seconds) notifies `to`.
const commentBy = async (to, video) =>
  (await call(`/videos/${video}/comments`, { method: 'POST', token: to, body: { text: 'thoughts?' } })).data
    .comment.id;
const reply = async (from, commentId, video) => {
  const r = await call(`/videos/${video}/comments`, {
    method: 'POST',
    token: from,
    body: { text: 'agreed', replyToId: commentId },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await sleep(300);
};

test('the push key says whether the apps can register', async () => {
  assert.equal((await call('/push/key')).data.native, true);
  process.env.FCM_SERVICE_ACCOUNT = '';
  assert.equal((await call('/push/key')).data.native, false);
  const token = await signIn(call, 'p_off');
  assert.equal((await register(token, 'phone-off')).status, 503);
  process.env.FCM_SERVICE_ACCOUNT = '{"broken": true}';
  assert.equal((await call('/push/key')).data.native, false, 'a key that isn’t a service account is off');
});

test('registering a phone: signed in, a known platform, and the token moves with whoever signs in', async () => {
  assert.equal((await register(null, 'phone-1')).status, 401);
  // Set again for the rest of the file (the test above turned it off).
  process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
    project_id: 'mbj-test',
    client_email: 'push@mbj-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: `${process.env.FCM_API_BASE}/token`,
  });
  const amy = await signIn(call, 'p_amy');
  const ben = await signIn(call, 'p_ben');
  assert.equal((await register(amy, 'phone-1', 'windows')).status, 400);
  assert.equal((await register(amy, '', 'android')).status, 400);
  assert.equal((await register(amy, 'phone-1')).status, 200);
  assert.equal((await register(amy, 'phone-1')).status, 200, 'registering again is fine');
  const [{ user_id: amyId }] = await devicesOf('phone-1');
  await register(ben, 'phone-1');
  const rows = await devicesOf('phone-1');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].user_id, amyId, 'the phone now belongs to Ben');

  // Signing out forgets it; someone else can't remove it.
  await call('/push/device', { method: 'DELETE', token: amy, body: { token: 'phone-1' } });
  assert.equal((await devicesOf('phone-1')).length, 1);
  await call('/push/device', { method: 'DELETE', token: ben, body: { token: 'phone-1' } });
  assert.equal((await devicesOf('phone-1')).length, 0);
});

test('a reply reaches the member’s phone through Firebase, signed with the service account', async () => {
  forgetCachedFcmToken();
  const video = await seedVideo();
  const cal = await signIn(call, 'p_cal');
  const dot = await signIn(call, 'p_dot');
  await register(cal, 'cal-phone');
  const asked = await commentBy(cal, video);
  sends.length = 0;
  tokenRequests.length = 0;
  await reply(dot, asked, video);

  assert.equal(sends.length, 1);
  const { url, auth, message } = sends[0];
  assert.equal(url, '/v1/projects/mbj-test/messages:send');
  assert.equal(auth, 'Bearer fake-access');
  assert.equal(message.token, 'cal-phone');
  assert.equal(message.notification.title, 'p_dot replied to you');
  assert.match(message.notification.body, /agreed/);
  assert.match(message.data.url, new RegExp(`^/watch/${video}\\?.*comment=`));
  assert.equal(message.android.notification.channel_id, 'activity');

  // The access token came from a JWT signed with the key's private key, for Firebase messaging.
  assert.equal(tokenRequests.length, 1);
  const [head, claims, sig] = tokenRequests[0].get('assertion').split('.');
  assert.ok(
    crypto.createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, sig, 'base64url'),
  );
  const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(c.iss, 'push@mbj-test.iam.gserviceaccount.com');
  assert.equal(c.scope, 'https://www.googleapis.com/auth/firebase.messaging');

  // A second reply reuses the access token.
  await reply(await signIn(call, 'p_dee'), asked, video);
  assert.equal(sends.length, 2);
  assert.equal(tokenRequests.length, 1);
});

test('push turned off in settings skips the phone; an uninstalled app is forgotten', async () => {
  const video = await seedVideo();
  const eve = await signIn(call, 'p_eve');
  const fin = await signIn(call, 'p_fin');
  await register(eve, 'eve-phone');
  await pool.query(
    `UPDATE users SET notification_prefs = '{"reply": {"push": false}}' WHERE username = 'p_eve'`,
  );
  const asked = await commentBy(eve, video);
  sends.length = 0;
  await reply(fin, asked, video);
  assert.equal(sends.length, 0);

  await pool.query(`UPDATE users SET notification_prefs = '{}' WHERE username = 'p_eve'`);
  await register(eve, 'uninstalled-phone');
  await register(eve, 'other-project-phone');
  await register(eve, 'bad-message-phone');
  await reply(await signIn(call, 'p_fay'), asked, video);
  assert.deepEqual(sends.map((s) => s.message.token).sort(), [
    'bad-message-phone',
    'eve-phone',
    'other-project-phone',
    'uninstalled-phone',
  ]);
  assert.equal((await devicesOf('uninstalled-phone')).length, 0, 'Firebase said it’s gone');
  assert.equal((await devicesOf('other-project-phone')).length, 0, 'from an earlier Firebase project');
  assert.equal((await devicesOf('bad-message-phone')).length, 1, 'a refused message doesn’t lose the phone');
  assert.equal((await devicesOf('eve-phone')).length, 1);
});

test('the data export lists the phones without their tokens', async () => {
  const gus = await signIn(call, 'p_gus');
  await register(gus, 'gus-phone', 'ios');
  const res = await fetch(`${base}/account/export`, { headers: { Authorization: `Bearer ${gus}` } });
  const data = await res.json();
  assert.equal(data.appNotificationDevices.length, 1);
  assert.equal(data.appNotificationDevices[0].platform, 'ios');
  assert.equal(JSON.stringify(data).includes('gus-phone'), false);
});
