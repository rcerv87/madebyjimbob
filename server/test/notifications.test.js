import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer, stopServer, client, seedVideo, signIn, sleep } from './helpers.js';

let call;
let wsUrl;
const sockets = [];
before(async () => {
  const s = await startServer();
  call = client(s.base);
  wsUrl = s.wsUrl;
});
after(async () => {
  for (const ws of sockets) ws.terminate();
  await stopServer();
});

const inbox = async (token) => (await call('/notifications', { token })).data;

const comment = (token, id, text, replyToId) =>
  call(`/videos/${id}/comments`, { method: 'POST', token, body: { text, ...(replyToId && { replyToId }) } });

test('chat never notifies: not replies, not @mentions (2026-10-03)', async () => {
  const id = await seedVideo();
  const alice = await signIn(call, 'n_alice');
  const bob = await signIn(call, 'n_bob');
  const original = (
    await call(`/videos/${id}/chat`, {
      method: 'POST',
      token: alice,
      body: { text: 'hot take', offsetMs: 30_000 },
    })
  ).data.message;
  await call(`/videos/${id}/chat`, {
    method: 'POST',
    token: bob,
    body: { text: '@n_alice no way', offsetMs: 35_000, replyToId: original.id },
  });
  await sleep(200);
  assert.equal((await inbox(alice)).unread, 0);
});

test('a comment reply notifies the person replied to, with where; @mentions in comments do not', async () => {
  const id = await seedVideo();
  const carol = await signIn(call, 'n_carol');
  const dave = await signIn(call, 'n_dave');
  const erin = await signIn(call, 'n_erin');
  const c = (await comment(carol, id, 'thoughts?')).data.comment;
  await comment(dave, id, '@n_carol @n_erin @n_dave agreed', c.id);
  await sleep(150);
  const carolBox = await inbox(carol);
  assert.equal(carolBox.notifications.length, 1);
  assert.deepEqual(
    {
      type: carolBox.notifications[0].type,
      where: carolBox.notifications[0].where,
      actor: carolBox.notifications[0].actor,
    },
    { type: 'reply', where: 'comment', actor: 'n_dave' },
  );
  assert.equal(carolBox.notifications[0].excerpt, '@n_carol @n_erin @n_dave agreed');
  assert.equal((await inbox(erin)).unread, 0, 'a mention alone notifies nobody');
  assert.equal((await inbox(dave)).unread, 0, 'never yourself');
});

test('mark one or all as read', async () => {
  const id = await seedVideo();
  const fay = await signIn(call, 'n_fay');
  const gus = await signIn(call, 'n_gus');
  const gil = await signIn(call, 'n_gil');
  const c = (await comment(fay, id, 'my take')).data.comment;
  await comment(gus, id, 'hmm', c.id);
  await comment(gil, id, 'nah', c.id);
  await sleep(150);
  const box = await inbox(fay);
  assert.equal(box.unread, 2);
  await call('/notifications/read', { method: 'POST', token: fay, body: { ids: [box.notifications[0].id] } });
  assert.equal((await inbox(fay)).unread, 1);
  await call('/notifications/read', { method: 'POST', token: fay, body: {} });
  const after = await inbox(fay);
  assert.equal(after.unread, 0);
  assert.ok(after.notifications.every((n) => n.read));
  assert.equal((await call('/notifications')).status, 401);
});

test('open tabs get notifications instantly over the WebSocket', async () => {
  const id = await seedVideo();
  const hal = await signIn(call, 'n_hal');
  const ivy = await signIn(call, 'n_ivy');
  const c = (await comment(hal, id, 'question for all')).data.comment;
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d)));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'auth', token: hal }));
  await sleep(150);
  await comment(ivy, id, 'answer', c.id);
  await sleep(200);
  const n = got.find((m) => m.type === 'notify');
  assert.equal(n?.notification.actor, 'n_ivy');
  assert.equal(n.notification.videoTitle.startsWith('Video'), true);
});

test('push setup reports when keys are not configured', async () => {
  const token = await signIn(call, 'n_push');
  assert.equal((await call('/push/key')).data.publicKey, null);
  const r = await call('/push/subscribe', {
    method: 'POST',
    token,
    body: { subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } } },
  });
  assert.equal(r.status, 503);
  assert.equal((await call('/push/subscribe', { method: 'POST', body: {} })).status, 401);
});
