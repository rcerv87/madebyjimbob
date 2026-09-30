import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, seedVideo, seedChat, signIn, sleep } from './helpers.js';

let call;
let apiBase;
before(async () => {
  const { base } = await startServer();
  apiBase = base;
  call = client(base);
});
after(stopServer);

describe('sign-in', () => {
  test('rejects a bad username or short password', async () => {
    assert.equal(
      (await call('/session', { method: 'POST', body: { username: 'a!', password: 'password123' } })).status,
      400,
    );
    assert.equal(
      (await call('/session', { method: 'POST', body: { username: 'short_pw', password: 'x' } })).status,
      400,
    );
  });

  test('creates an account and signs back in with the same password', async () => {
    const first = await call('/session', {
      method: 'POST',
      body: { username: 'returning', password: 'password123' },
    });
    assert.equal(first.status, 200);
    const again = await call('/session', {
      method: 'POST',
      body: { username: 'returning', password: 'password123' },
    });
    assert.equal(again.status, 200);
    assert.equal(again.data.user.id, first.data.user.id);
    assert.equal((await call('/me', { token: first.data.token })).data.user, null, 'old token is replaced');
    assert.equal((await call('/me', { token: again.data.token })).data.user.username, 'returning');
  });

  test('a taken name needs its password, whatever the case', async () => {
    await signIn(call, 'owner_name');
    const r = await call('/session', {
      method: 'POST',
      body: { username: 'OWNER_NAME', password: 'not-the-password' },
    });
    assert.equal(r.status, 401);
  });

  test('locks a name after 10 wrong passwords', async () => {
    await signIn(call, 'lock_me');
    for (let i = 0; i < 10; i++) {
      await call('/session', { method: 'POST', body: { username: 'lock_me', password: 'wrong-password' } });
    }
    const r = await call('/session', {
      method: 'POST',
      body: { username: 'lock_me', password: 'password123' },
    });
    assert.equal(r.status, 429);
  });

  test('test tiers apply and admins are flagged', async () => {
    const plus = await call('/session', {
      method: 'POST',
      body: { username: 'plus_fan', password: 'password123', tier: 'plus' },
    });
    assert.equal(plus.data.user.tier, 'plus');
    const admin = await call('/session', {
      method: 'POST',
      body: { username: 'test_admin', password: 'password123' },
    });
    assert.equal(admin.data.user.isAdmin, true);
    assert.equal(admin.data.user.tier, 'premium');
  });

  test('sign-out invalidates the token', async () => {
    const token = await signIn(call, 'leaving');
    await call('/session', { method: 'DELETE', token });
    assert.equal((await call('/me', { token })).data.user, null);
  });
});

describe('video access', () => {
  test('bad and unknown ids return 404 JSON', async () => {
    assert.equal((await call('/videos/abc')).status, 404);
    assert.equal((await call('/videos/999999')).status, 404);
    assert.equal((await call('/videos/1;DROP')).status, 404);
    assert.equal((await call('/videos/999999/view', { method: 'POST' })).status, 404);
    const unknown = await call('/does-not-exist');
    assert.equal(unknown.status, 404);
    assert.match(unknown.data.error, /Unknown API endpoint/);
  });

  test('premium video is locked below premium and open at premium', async () => {
    const id = await seedVideo({ minTier: 'premium' });
    const anon = await call(`/videos/${id}`);
    assert.equal(anon.data.video.locked, true);
    assert.equal(anon.data.video.hls, null);
    const free = await call(`/videos/${id}`, { token: await signIn(call, 'free_viewer') });
    assert.equal(free.data.video.locked, true);
    const prem = await call(`/videos/${id}`, { token: await signIn(call, 'prem_viewer', 'premium') });
    assert.equal(prem.data.video.locked, false);
  });
});

describe('chat window', () => {
  test('returns visible messages in [from, to) ordered by offset', async () => {
    const id = await seedVideo();
    await seedChat(id, [
      { body: 'late', offsetMs: 90_000 },
      { body: 'early', offsetMs: 1_000 },
      { body: 'hidden', offsetMs: 2_000, hidden: true },
      { body: 'edge', offsetMs: 120_000 },
    ]);
    const r = await call(`/videos/${id}/chat?from=0&to=120000`);
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.data.messages.map((m) => m.body),
      ['early', 'late'],
    );
    const next = await call(`/videos/${id}/chat?from=120000&to=240000`);
    assert.deepEqual(
      next.data.messages.map((m) => m.body),
      ['edge'],
    );
  });

  test('afterId returns everything newer than a message, for reconnect catch-up', async () => {
    const id = await seedVideo();
    await seedChat(id, [
      { body: 'old', offsetMs: 500_000 },
      { body: 'newer', offsetMs: 1_000 },
      { body: 'hidden', offsetMs: 2_000, hidden: true },
      { body: 'newest', offsetMs: 300_000 },
    ]);
    const all = await call(`/videos/${id}/chat?from=0&to=600000`);
    const oldId = all.data.messages.find((m) => m.body === 'old').id;
    const r = await call(`/videos/${id}/chat?afterId=${oldId}`);
    assert.deepEqual(
      r.data.messages.map((m) => m.body),
      ['newer', 'newest'],
    );
    assert.equal((await call(`/videos/${id}/chat?afterId=abc`)).status, 400);
    const locked = await seedVideo({ minTier: 'premium' });
    assert.equal((await call(`/videos/${locked}/chat?afterId=0`)).status, 403);
  });

  test('is blocked for viewers below the video tier', async () => {
    const id = await seedVideo({ minTier: 'plus' });
    await seedChat(id, [{ body: 'members only', offsetMs: 1_000 }]);
    assert.equal((await call(`/videos/${id}/chat`)).status, 403);
    assert.equal(
      (await call(`/videos/${id}/chat`, { token: await signIn(call, 'free_reader') })).status,
      403,
    );
    const plus = await call(`/videos/${id}/chat`, { token: await signIn(call, 'plus_reader', 'plus') });
    assert.equal(plus.data.messages[0].body, 'members only');
  });
});

describe('chat posting', () => {
  test('requires sign-in and the right tier', async () => {
    const id = await seedVideo({ minTier: 'premium' });
    assert.equal((await call(`/videos/${id}/chat`, { method: 'POST', body: { text: 'hi' } })).status, 401);
    const token = await signIn(call, 'free_poster');
    assert.equal(
      (await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: 'hi' } })).status,
      403,
    );
    assert.equal(
      (await call('/videos/999999/chat', { method: 'POST', token, body: { text: 'hi' } })).status,
      404,
    );
  });

  test('stores the message with mentions, masking, and a clamped offset', async () => {
    const id = await seedVideo({ durationS: 600 });
    const token = await signIn(call, 'poster');
    const r = await call(`/videos/${id}/chat`, {
      method: 'POST',
      token,
      body: { text: '  hey   @JimBob  badword ', offsetMs: 1e13 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.message.body, 'hey @JimBob *******');
    assert.deepEqual(r.data.message.mentions, ['jimbob']);
    assert.equal(r.data.message.offsetMs, 600_000);
    assert.equal(r.data.message.source, 'native');
  });

  test('rejects empty messages', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'empty_poster');
    assert.equal(
      (await call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: '   ' } })).status,
      400,
    );
  });

  test('rate limits to one message per 1.5s, even for parallel requests', async () => {
    const id = await seedVideo();
    const token = await signIn(call, 'fast_poster');
    const post = () =>
      call(`/videos/${id}/chat`, { method: 'POST', token, body: { text: 'spam', offsetMs: 0 } });
    const burst = await Promise.all([post(), post(), post()]);
    assert.deepEqual(burst.map((r) => r.status).sort(), [200, 429, 429]);
    await sleep(1600);
    assert.equal((await post()).status, 200);
  });
});

describe('studio', () => {
  test('is admin-only', async () => {
    assert.equal((await call('/studio/overview')).status, 401);
    const viewer = await signIn(call, 'studio_viewer', 'premium');
    assert.equal((await call('/studio/overview', { token: viewer })).status, 403);
    assert.equal(
      (await call('/studio/videos/1', { method: 'PATCH', token: viewer, body: { minTier: 'free' } })).status,
      403,
    );
  });

  test('admin sees totals and can change a video tier', async () => {
    const admin = await signIn(call, 'test_admin');
    const id = await seedVideo();
    const overview = await call('/studio/overview', { token: admin });
    assert.equal(overview.status, 200);
    assert.ok(overview.data.totals.videos >= 1);
    const bad = await call(`/studio/videos/${id}`, {
      method: 'PATCH',
      token: admin,
      body: { minTier: 'gold' },
    });
    assert.equal(bad.status, 400);
    const ok = await call(`/studio/videos/${id}`, {
      method: 'PATCH',
      token: admin,
      body: { minTier: 'plus' },
    });
    assert.equal(ok.status, 200);
    assert.equal((await call(`/videos/${id}`)).data.video.minTier, 'plus');
  });
});

describe('request handling', () => {
  test('every response carries a request id, reusing a safe incoming one', async () => {
    const fresh = await fetch(`${apiBase}/health`);
    assert.match(fresh.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    const given = await fetch(`${apiBase}/health`, { headers: { 'X-Request-Id': 'trace-123' } });
    assert.equal(given.headers.get('x-request-id'), 'trace-123');
    const unsafe = await fetch(`${apiBase}/health`, { headers: { 'X-Request-Id': 'bad id <script>' } });
    assert.notEqual(unsafe.headers.get('x-request-id'), 'bad id <script>');
  });

  test('malformed JSON is a 400, not a server error', async () => {
    const res = await fetch(`${apiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username": ',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /valid JSON/);
  });

  test('oversized bodies are a 413', async () => {
    const res = await fetch(`${apiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x'.repeat(60_000) }),
    });
    assert.equal(res.status, 413);
  });
});
