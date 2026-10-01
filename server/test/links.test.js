import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';
import { verifyYouTubeCodes } from '../src/links.js';

let call;
let videoId;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  videoId = await seedVideo();
});
after(stopServer);

let seq = 0;
// What an import leaves: a YouTube chat message or comment with the poster's channel id.
async function imported(table, { channel, name, body, offsetMs = 1000 }) {
  seq += 1;
  const cols =
    table === 'chat_messages'
      ? `(video_id, source, external_id, author_name, author_channel_id, body, offset_ms)`
      : `(video_id, source, external_id, author_name, author_channel_id, body)`;
  const vals =
    table === 'chat_messages' ? `($1, 'youtube', $2, $3, $4, $5, $6)` : `($1, 'youtube', $2, $3, $4, $5)`;
  const params = [videoId, `yt-${seq}`, name, channel, body];
  if (table === 'chat_messages') params.push(offsetMs);
  const { rows } = await pool.query(`INSERT INTO ${table} ${cols} VALUES ${vals} RETURNING id`, params);
  return rows[0].id;
}
const links = async (token) => (await call('/account/links', { token })).data;
const chatAt = async (token) =>
  (await call(`/videos/${videoId}/chat?from=0&to=600000`, { token })).data.messages;

describe('linking a YouTube account with a code', () => {
  test('the code posted on the channel links that channel, and all its messages show the site name', async () => {
    const token = await signIn(call, 'yt_member', 'plus');
    const old = await imported('chat_messages', {
      channel: 'UC_member',
      name: '@MemberOnYT',
      body: 'great stream',
    });

    const start = await call('/account/links/youtube', { method: 'POST', token });
    assert.equal(start.status, 200);
    const { code, status } = start.data.youtube;
    assert.equal(status, 'pending');
    assert.match(code, /^MBJ-[2-9A-HJKMNP-Z]{6}$/);
    assert.equal(
      (await call('/account/links/youtube', { method: 'POST', token })).data.youtube.code,
      code,
      'same code',
    );

    const codePost = await imported('comments', {
      channel: 'UC_member',
      name: '@MemberOnYT',
      body: `linking my account ${code.toLowerCase()} thanks`,
    });
    const checked = await call('/account/links/youtube/check', { method: 'POST', token });
    assert.equal(checked.data.youtube.status, 'verified');
    assert.equal(checked.data.youtube.handle, '@MemberOnYT');
    assert.equal(checked.data.youtube.code, null);

    const hidden = await pool.query('SELECT hidden FROM comments WHERE id = $1', [codePost]);
    assert.equal(hidden.rows[0].hidden, true, 'the code comment leaves the replay');

    const msg = (await chatAt()).find((m) => m.id === old);
    assert.equal(msg.author, 'yt_member', 'earlier messages from that channel show the site name');
    assert.equal(msg.platformName, '@MemberOnYT');
    assert.equal(msg.memberTier, 'plus');
    assert.equal(msg.source, 'youtube');

    assert.deepEqual((await call('/me', { token })).data.user.linkedHandles, ['memberonyt']);
    assert.equal((await call('/account/links/youtube', { method: 'POST', token })).status, 409);
  });

  test('a code posted before it was issued, or a wrong code, links nothing', async () => {
    const token = await signIn(call, 'yt_patient');
    const { code } = (await call('/account/links/youtube', { method: 'POST', token })).data.youtube;
    await imported('comments', { channel: 'UC_patient', name: '@Patient', body: 'MBJ-ZZZZZZ' });
    await pool.query(`UPDATE linked_accounts SET created_at = now() + interval '1 minute' WHERE code = $1`, [
      code,
    ]);
    await imported('comments', { channel: 'UC_patient', name: '@Patient', body: code });
    await verifyYouTubeCodes();
    assert.equal((await links(token)).youtube.status, 'pending');
  });

  test('a channel already linked to someone else stays with them', async () => {
    const first = await signIn(call, 'yt_first');
    const second = await signIn(call, 'yt_second');
    const a = (await call('/account/links/youtube', { method: 'POST', token: first })).data.youtube.code;
    const b = (await call('/account/links/youtube', { method: 'POST', token: second })).data.youtube.code;
    await imported('chat_messages', { channel: 'UC_shared', name: '@Shared', body: a });
    await imported('chat_messages', { channel: 'UC_shared', name: '@Shared', body: b });
    await verifyYouTubeCodes();
    assert.equal((await links(first)).youtube.status, 'verified');
    assert.equal((await links(second)).youtube.status, 'pending');
  });

  test('@mentioning the YouTube handle notifies the member; unlinking puts the YouTube name back', async () => {
    const member = await signIn(call, 'yt_mentioned');
    const fan = await signIn(call, 'yt_mentioner');
    const { code } = (await call('/account/links/youtube', { method: 'POST', token: member })).data.youtube;
    const old = await imported('chat_messages', { channel: 'UC_mentioned', name: '@BigFanYT', body: code });
    const later = await imported('chat_messages', {
      channel: 'UC_mentioned',
      name: '@BigFanYT',
      body: 'hello',
    });
    await verifyYouTubeCodes();
    assert.ok(old);

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
    assert.equal(
      (await call('/account/links/rumble', { method: 'POST', token, body: { name: 'bad name!' } })).status,
      400,
    );
    const asked = await call('/account/links/rumble', {
      method: 'POST',
      token,
      body: { name: '@RumbleFan' },
    });
    assert.equal(asked.data.rumble.status, 'pending');
    assert.equal(asked.data.rumble.handle, 'RumbleFan');

    assert.equal((await call('/studio/links', { token })).status, 403);
    const admin = await signIn(call, 'test_admin');
    const list = (await call('/studio/links', { token: admin })).data.links;
    const request = list.find((l) => l.username === 'rumble_fan');
    assert.equal(request.status, 'pending');
    assert.equal(
      (await call(`/studio/links/${request.id}/approve`, { method: 'POST', token: admin })).status,
      200,
    );
    assert.equal((await links(token)).rumble.status, 'verified');
    assert.equal((await links(token)).rumble.verifiedBy, 'admin');

    const other = await signIn(call, 'rumble_copycat');
    const copy = await call('/account/links/rumble', {
      method: 'POST',
      token: other,
      body: { name: 'rumblefan' },
    });
    assert.equal(copy.status, 409);

    assert.equal((await call(`/studio/links/${request.id}`, { method: 'DELETE', token: admin })).status, 200);
    assert.equal((await links(token)).rumble, null);
  });
});
