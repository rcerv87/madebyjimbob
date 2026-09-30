import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer, stopServer, client, seedVideo, signIn, sleep } from './helpers.js';

let call;
let wsUrl;
const sockets = [];

before(async () => {
  const started = await startServer();
  call = client(started.base);
  wsUrl = started.wsUrl;
});
after(async () => {
  for (const ws of sockets) ws.terminate();
  await stopServer();
});

// Opens a socket, joins the room, and collects everything it receives.
async function join(videoId, token) {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  const received = [];
  ws.on('message', (data) => received.push(JSON.parse(data)));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'join', videoId, token }));
  await sleep(150);
  return received;
}

test('broadcasts new chat to everyone in the room', async () => {
  const id = await seedVideo();
  const a = await join(id);
  const b = await join(id);
  const token = await signIn(call, 'broadcaster');
  await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: 'hello room', offsetMs: 5000 } });
  await sleep(150);
  for (const inbox of [a, b]) {
    const msg = inbox.find((m) => m.type === 'chat');
    assert.equal(msg?.message.body, 'hello room');
    assert.equal(msg.message.offsetMs, 5000);
  }
});

test('does not leak chat to other rooms', async () => {
  const room1 = await seedVideo();
  const room2 = await seedVideo();
  const listener = await join(room2);
  const token = await signIn(call, 'room1_poster');
  await call(`/videos/${room1}/chat`, { method: 'POST', token, body: { text: 'only room 1' } });
  await sleep(150);
  assert.equal(listener.filter((m) => m.type === 'chat').length, 0);
});

test('refuses joins below the video tier and never sends them chat', async () => {
  const id = await seedVideo({ minTier: 'premium' });
  const outsider = await join(id, await signIn(call, 'ws_free'));
  const member = await join(id, await signIn(call, 'ws_prem', 'premium'));
  assert.equal(outsider[0]?.type, 'error');
  assert.equal(member.length, 0);

  await call(`/videos/${id}/chat`, {
    method: 'POST',
    token: await signIn(call, 'ws_prem_poster', 'premium'),
    body: { text: 'secret' },
  });
  await sleep(150);
  assert.ok(member.some((m) => m.type === 'chat' && m.message.body === 'secret'));
  assert.ok(!outsider.some((m) => m.type === 'chat'));
});

test('refuses joins for unknown videos', async () => {
  const inbox = await join(999999);
  assert.equal(inbox[0]?.type, 'error');
});
