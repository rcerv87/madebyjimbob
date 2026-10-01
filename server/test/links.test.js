import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';
import { resolvePendingChannels } from '../src/links.js';

let call;
let videoId;
let admin;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  videoId = await seedVideo();
  admin = await signIn(call, 'test_admin');
});
after(stopServer);

let seq = 0;
// What an import leaves: a YouTube chat message with the poster's channel id and @handle.
async function imported({ channel, name, body = 'hi', offsetMs = 1000 }) {
  seq += 1;
  const { rows } = await pool.query(
    `INSERT INTO chat_messages (video_id, source, external_id, author_name, author_channel_id, body, offset_ms)
     VALUES ($1, 'youtube', $2, $3, $4, $5, $6) RETURNING id`,
    [videoId, `yt-${seq}`, name, channel, body, offsetMs],
  );
  return rows[0].id;
}
const links = async (token) => (await call('/account/links', { token })).data;
const ask = (token, platform, name) =>
  call(`/account/links/${platform}`, { method: 'POST', token, body: { name } });
const chatAt = async () => (await call(`/videos/${videoId}/chat?from=0&to=600000`)).data.messages;
async function approve(username, platform) {
  const list = (await call('/studio/links', { token: admin })).data.links;
  const request = list.find((l) => l.username === username && l.platform === platform);
  return {
    request,
    res: await call(`/studio/links/${request.id}/approve`, { method: 'POST', token: admin }),
  };
}

describe('linking a YouTube account by handle', () => {
  test('a moderator confirms it; then that channel’s messages show the site name and tier', async () => {
    const token = await signIn(call, 'yt_member', 'plus');
    const old = await imported({ channel: 'UC_member', name: '@MemberOnYT', body: 'great stream' });

    assert.equal((await ask(token, 'youtube', 'not a handle!')).status, 400);
    const asked = await ask(token, 'youtube', 'https://www.youtube.com/@memberonyt');
    assert.equal(asked.status, 200);
    assert.equal(asked.data.youtube.status, 'pending');
    assert.equal(asked.data.youtube.handle, '@MemberOnYT', 'uses the handle as YouTube shows it');
    assert.equal(
      (await chatAt()).find((m) => m.id === old).author,
      '@MemberOnYT',
      'nothing changes until confirmed',
    );

    assert.equal((await call('/studio/links', { token })).status, 403);
    const { request, res } = await approve('yt_member', 'youtube');
    assert.equal(request.messagesSeen, 1, 'Studio sees how much that handle has posted');
    assert.equal(res.status, 200);
    assert.equal((await links(token)).youtube.status, 'verified');

    const msg = (await chatAt()).find((m) => m.id === old);
    assert.equal(msg.author, 'yt_member');
    assert.equal(msg.platformName, '@MemberOnYT');
    assert.equal(msg.memberTier, 'plus');
    assert.deepEqual((await call('/me', { token })).data.user.linkedHandles, ['memberonyt']);

    // Renamed on YouTube later: still them, because the link follows the channel id.
    const renamed = await imported({ channel: 'UC_member', name: '@NewNameYT', body: 'new name' });
    assert.equal((await chatAt()).find((m) => m.id === renamed).author, 'yt_member');
  });

  test('a handle that has not posted yet is matched to its channel once it shows up in an import', async () => {
    const token = await signIn(call, 'yt_newcomer');
    await ask(token, 'youtube', '@BrandNewViewer');
    await approve('yt_newcomer', 'youtube');
    const first = await imported({
      channel: 'UC_newcomer',
      name: '@BrandNewViewer',
      body: 'first time here',
    });
    assert.equal((await chatAt()).find((m) => m.id === first).author, '@BrandNewViewer');
    assert.equal(await resolvePendingChannels(), 1);
    assert.equal((await chatAt()).find((m) => m.id === first).author, 'yt_newcomer');
  });

  test('one member per YouTube account', async () => {
    const first = await signIn(call, 'yt_first');
    const second = await signIn(call, 'yt_second');
    await imported({ channel: 'UC_shared', name: '@SharedHandle' });
    await ask(first, 'youtube', '@SharedHandle');
    await approve('yt_first', 'youtube');
    assert.equal((await ask(second, 'youtube', '@sharedhandle')).status, 409);
  });

  test('@mentioning the YouTube handle notifies the member; unlinking puts the YouTube name back', async () => {
    const member = await signIn(call, 'yt_mentioned');
    const fan = await signIn(call, 'yt_mentioner');
    const later = await imported({ channel: 'UC_mentioned', name: '@BigFanYT', body: 'hello' });
    await ask(member, 'youtube', '@BigFanYT');
    await approve('yt_mentioned', 'youtube');

    await call(`/videos/${videoId}/chat`, {
      method: 'POST',
      token: fan,
      body: { text: 'good point @BigFanYT', offsetMs: 2000 },
    });
    const notes = (await call('/notifications', { token: member })).data.notifications;
    assert.equal(notes[0]?.type, 'mention');
    assert.equal(notes[0]?.actor, 'yt_mentioner');

    await call('/account/links/youtube', { method: 'DELETE', token: member });
    assert.equal((await links(member)).youtube, null);
    assert.equal((await chatAt()).find((m) => m.id === later).author, '@BigFanYT');
  });
});

describe('linking a Rumble name', () => {
  test('waits for a moderator in Studio; names are one member each', async () => {
    const token = await signIn(call, 'rumble_fan');
    assert.equal((await ask(token, 'rumble', 'bad name!')).status, 400);
    const asked = await ask(token, 'rumble', '@RumbleFan');
    assert.equal(asked.data.rumble.status, 'pending');
    assert.equal(asked.data.rumble.handle, 'RumbleFan');

    const { request, res } = await approve('rumble_fan', 'rumble');
    assert.equal(res.status, 200);
    assert.equal((await links(token)).rumble.status, 'verified');
    assert.equal((await links(token)).rumble.verifiedBy, 'admin');

    const other = await signIn(call, 'rumble_copycat');
    assert.equal((await ask(other, 'rumble', 'rumblefan')).status, 409);

    assert.equal((await call(`/studio/links/${request.id}`, { method: 'DELETE', token: admin })).status, 200);
    assert.equal((await links(token)).rumble, null);
  });
});
