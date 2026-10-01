import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

let call;
let origin;
let free;
let premiumVideo;
let freeVideo;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  origin = new URL(base).origin;
  freeVideo = await seedVideo();
  premiumVideo = await seedVideo({ minTier: 'premium' });
  // A Plus member who commented on a free and a premium video, and chatted.
  const author = await signIn(call, 'ProfileFan', 'premium');
  await call(`/videos/${freeVideo}/comments`, {
    method: 'POST',
    token: author,
    body: { text: 'Great debate', offsetMs: 65_000 },
  });
  // (Comments are one per 5 seconds, so this one goes straight in.)
  await pool.query(
    `INSERT INTO comments (video_id, source, user_id, author_name, body)
     SELECT $1, 'native', id, username, 'Members only thought' FROM users WHERE username = 'ProfileFan'`,
    [premiumVideo],
  );
  await call(`/videos/${freeVideo}/chat`, {
    method: 'POST',
    token: author,
    body: { text: 'hello chat', offsetMs: 1000 },
  });
  await pool.query(`UPDATE users SET tier = 'plus' WHERE username = 'ProfileFan'`);
  await pool.query(
    `INSERT INTO linked_accounts (user_id, platform, status, external_id, handle, verified_by, verified_at)
     SELECT id, 'youtube', 'verified', 'UC_profilefan', '@FanOnYT', 'admin', now() FROM users WHERE username = 'ProfileFan'`,
  );
  free = await signIn(call, 'profile_viewer');
});
after(stopServer);

const profile = (name, token) => call(`/profiles/${name}`, { token });

describe('public profiles', () => {
  test('anyone can see one: name, joined date, paid tier badge, linked accounts, recent comments', async () => {
    const r = await profile('profilefan');
    assert.equal(r.status, 200);
    const p = r.data.profile;
    assert.equal(p.username, 'ProfileFan');
    assert.equal(p.displayName, 'ProfileFan');
    assert.equal(p.tier, 'plus');
    assert.ok(p.joinedAt);
    assert.deepEqual(p.links, { youtube: '@FanOnYT' });
    assert.deepEqual(
      p.comments.map((c) => [c.body, c.videoId, c.offsetMs]),
      [['Great debate', freeVideo, 65_000]],
      'the premium video’s comment is left out for a signed-out viewer',
    );
    assert.equal((await profile('nobody_here')).status, 404);
  });

  test('activity on members videos shows to viewers who can watch them', async () => {
    const premium = await signIn(call, 'profile_premium', 'premium');
    const p = (await profile('ProfileFan', premium)).data.profile;
    assert.deepEqual(p.comments.map((c) => c.body).sort(), ['Great debate', 'Members only thought']);
    assert.equal((await profile('ProfileFan', free)).data.profile.comments.length, 1);
  });

  test('chat messages show only once the member turns that on', async () => {
    assert.deepEqual((await profile('ProfileFan')).data.profile.chat, []);
    const owner = await signIn(call, 'ProfileFan');
    assert.equal(
      (await call('/account/profile', { method: 'PUT', token: owner, body: { showChat: 'yes' } })).status,
      400,
    );
    const saved = await call('/account/profile', { method: 'PUT', token: owner, body: { showChat: true } });
    assert.deepEqual(saved.data, { showChat: true, indexable: false });
    assert.deepEqual((await call('/account/profile', { token: owner })).data, {
      showChat: true,
      indexable: false,
    });
    assert.deepEqual(
      (await profile('ProfileFan')).data.profile.chat.map((m) => m.body),
      ['hello chat'],
    );
  });

  test('chat and comments say whose profile to open', async () => {
    const chat = await call(`/videos/${freeVideo}/chat?from=0&to=600000`);
    assert.equal(chat.data.messages.find((m) => m.body === 'hello chat').profile, 'ProfileFan');
    const comments = await call(`/videos/${freeVideo}/comments`);
    assert.equal(comments.data.comments.find((c) => c.body === 'Great debate').profile, 'ProfileFan');
  });

  test('the page has its own title and stays out of search unless the member allows it', async () => {
    const page = await fetch(`${origin}/@ProfileFan`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<title>ProfileFan \(@ProfileFan\)/);
    assert.match(html, /noindex/);
    assert.equal((await fetch(`${origin}/@nobody_here`)).status, 404);
  });
});
