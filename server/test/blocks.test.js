import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

let call;
let videoId;
let me;
let pest;
let quiet;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  videoId = await seedVideo();
  me = await signIn(call, 'block_owner');
  pest = await signIn(call, 'block_pest');
  quiet = await signIn(call, 'block_quiet');
});
after(stopServer);

const hide = (token, name, kind) => call(`/account/blocks/${name}`, { method: 'PUT', token, body: { kind } });
const say = (token, text, extra = {}) =>
  call(`/videos/${videoId}/chat`, { method: 'POST', token, body: { text, offsetMs: 1000, ...extra } });
const notes = async (token) => (await call('/notifications', { token })).data.notifications;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('blocking and muting', () => {
  test('block or mute anyone but yourself, moderators, and JimBob; the list comes back on /me', async () => {
    assert.equal((await hide(me, 'block_pest', 'nope')).status, 400);
    assert.equal((await hide(me, 'block_owner', 'block')).status, 400, 'not yourself');
    assert.equal((await hide(me, 'nobody_at_all', 'block')).status, 404);
    await signIn(call, 'test_admin'); // admin by verified email
    assert.equal((await hide(me, 'test_admin', 'block')).status, 400, 'not JimBob or mods');
    await signIn(call, 'block_mod');
    await pool.query(`UPDATE users SET role = 'mod' WHERE username = 'block_mod'`);
    assert.equal((await hide(me, 'block_mod', 'mute')).status, 400);

    assert.equal((await hide(me, 'block_pest', 'block')).status, 200);
    const r = await hide(me, 'block_quiet', 'mute');
    assert.deepEqual(
      r.data.hidden.map((h) => [h.username, h.kind]),
      [
        ['block_pest', 'block'],
        ['block_quiet', 'mute'],
      ],
    );
    const user = (await call('/me', { token: me })).data.user;
    assert.deepEqual(
      user.hidden.map((h) => h.username),
      ['block_pest', 'block_quiet'],
    );
  });

  test('someone you blocked can’t reply to you; someone you muted can (and can’t tell)', async () => {
    const mine = await say(me, 'my take');
    const comment = await call(`/videos/${videoId}/comments`, {
      method: 'POST',
      token: me,
      body: { text: 'my comment' },
    });

    const blockedReply = await say(pest, 'reply', { replyToId: mine.data.message.id });
    assert.equal(blockedReply.status, 403);
    const blockedComment = await call(`/videos/${videoId}/comments`, {
      method: 'POST',
      token: pest,
      body: { text: 'reply', replyToId: comment.data.comment.id },
    });
    assert.equal(blockedComment.status, 403);

    const mutedReply = await say(quiet, 'reply', { replyToId: mine.data.message.id });
    assert.equal(mutedReply.status, 200);
  });

  test('no notifications from people you blocked or muted', async () => {
    const before = (await notes(me)).length;
    await sleep(1600);
    await say(pest, 'hey @block_owner');
    await say(quiet, 'yo @block_owner');
    await sleep(500); // notifications go out just after the post; make sure none arrive
    assert.equal((await notes(me)).length, before);
    // …while someone else's mention still does.
    const other = await signIn(call, 'block_friend');
    await call(`/videos/${videoId}/chat`, {
      method: 'POST',
      token: other,
      body: { text: 'hi @block_owner', offsetMs: 1000 },
    });
    await sleep(500);
    assert.equal((await notes(me)).length, before + 1);
  });

  test('unblocking lets them reply again', async () => {
    assert.equal((await call('/account/blocks/block_pest', { method: 'DELETE', token: me })).status, 200);
    const mine = await say(me, 'open again');
    await sleep(1600);
    assert.equal((await say(pest, 'thanks', { replyToId: mine.data.message.id })).status, 200);
    assert.deepEqual(
      (await call('/account/blocks', { token: me })).data.hidden.map((h) => h.username),
      ['block_quiet'],
    );
  });
});

describe('reports', () => {
  test('members report a message with a reason; it lands in Studio’s queue; mods handle it', async () => {
    await sleep(1600);
    const msg = await say(pest, 'buy cheap followers at spam.example');
    assert.equal(
      (
        await call('/reports', {
          method: 'POST',
          body: { chatMessageId: msg.data.message.id, reason: 'spam' },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call('/reports', {
          method: 'POST',
          token: me,
          body: { chatMessageId: msg.data.message.id, reason: 'meh' },
        })
      ).status,
      400,
    );
    const filed = await call('/reports', {
      method: 'POST',
      token: me,
      body: { chatMessageId: msg.data.message.id, reason: 'spam', details: 'link spam' },
    });
    assert.equal(filed.status, 200);
    assert.equal(
      (
        await call('/reports', {
          method: 'POST',
          token: me,
          body: { username: 'block_pest', reason: 'harassment' },
        })
      ).status,
      200,
    );

    assert.equal((await call('/studio/reports', { token: me })).status, 403);
    const admin = await signIn(call, 'test_admin');
    const open = (await call('/studio/reports', { token: admin })).data.reports;
    const spam = open.find((r) => r.reason === 'spam');
    assert.equal(spam.target, 'block_pest');
    assert.equal(spam.reporter, 'block_owner');
    assert.match(spam.excerpt, /cheap followers/);
    assert.equal(spam.videoId, videoId);
    assert.equal(spam.reportsOnMember, 2);

    assert.equal(
      (
        await call(`/studio/reports/${spam.id}`, {
          method: 'POST',
          token: admin,
          body: { status: 'resolved' },
        })
      ).status,
      200,
    );
    const still = (await call('/studio/reports', { token: admin })).data.reports;
    assert.ok(!still.some((r) => r.id === spam.id));
    const resolved = (await call('/studio/reports?status=resolved', { token: admin })).data.reports;
    assert.ok(resolved.some((r) => r.id === spam.id));
  });
});
