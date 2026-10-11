import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, pool } from './helpers.js';

let call;
let admin;
let videoId;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  videoId = await seedVideo();
  admin = await signIn(call, 'test_admin');
});
after(stopServer);

const list = async (query = '') => (await call(`/studio/members${query}`, { token: admin })).data;
const find = async (username) => (await list(`?q=${username}`)).members.find((m) => m.username === username);
const post = (path, body, token = admin) => call(path, { method: 'POST', token, body });

test('only admins see the member list; it searches, filters, and masks emails', async () => {
  const viewer = await signIn(call, 'plain_viewer');
  await signIn(call, 'plus_fan', 'plus');
  assert.equal((await call('/studio/members')).status, 401);
  assert.equal((await call('/studio/members', { token: viewer })).status, 403);

  const all = await list();
  assert.equal(all.total, 3);
  const fan = all.members.find((m) => m.username === 'plus_fan');
  assert.equal(fan.tier, 'plus');
  assert.equal(fan.role, 'viewer');
  assert.ok(fan.lastSeenAt, 'last seen comes from their sessions');
  assert.ok(!fan.email.includes('plus_fan@'), 'email is masked');
  assert.equal(all.members.find((m) => m.username === 'test_admin').adminByEmail, true);

  assert.deepEqual(
    (await list('?q=PLUS_')).members.map((m) => m.username),
    ['plus_fan'],
  );
  assert.equal((await list('?q=%25')).total, 0, 'a % is searched for as typed');
  assert.equal((await list('?q=plus_fan@test.example')).total, 1, 'a whole email finds its account');
  assert.equal((await list('?q=fan@test')).total, 0, 'part of an email does not');
  assert.equal((await list('?tier=plus')).total, 1);
  assert.equal((await list('?filter=new')).total, 3);
  assert.equal((await list('?filter=banned')).total, 0);
  assert.equal((await list('?filter=staff')).total, 0);
});

test('an admin makes a member an admin, who can then open Studio; it is logged', async () => {
  const token = await signIn(call, 'new_admin');
  const { id } = await find('new_admin');
  assert.equal((await call('/studio/overview', { token })).status, 403);

  assert.equal((await post(`/studio/members/${id}/role`, { role: 'owner' })).status, 400);
  assert.equal((await post('/studio/members/999999/role', { role: 'mod' })).status, 404);
  assert.equal((await post('/studio/members/abc/role', { role: 'mod' })).status, 404);
  const r = await post(`/studio/members/${id}/role`, { role: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.role, 'admin');
  assert.equal((await call('/studio/overview', { token })).status, 200);
  assert.equal((await list('?filter=staff')).total, 1);

  const me = await find('test_admin');
  assert.equal((await post(`/studio/members/${me.id}/role`, { role: 'viewer' })).status, 409, 'not yourself');

  const back = await post(`/studio/members/${id}/role`, { role: 'viewer' });
  assert.equal(back.data.member.role, 'viewer');
  assert.equal((await call('/studio/overview', { token })).status, 403);

  const { actions } = await list();
  assert.deepEqual(
    actions.slice(0, 2).map((a) => [a.actor, a.action, a.target, a.reason]),
    [
      ['test_admin', 'role', 'new_admin', 'admin → viewer'],
      ['test_admin', 'role', 'new_admin', 'viewer → admin'],
    ],
  );
});

test('a ban signs the member out and stops sign-in, chat and comments; unban lets them back', async () => {
  const token = await signIn(call, 'troublemaker');
  const { id } = await find('troublemaker');
  const say = (t) => post(`/videos/${videoId}/chat`, { text: 'hello', offsetMs: 1000 }, t);
  assert.equal((await say(token)).status, 200);

  assert.equal((await post(`/studio/members/${id}/ban`, { reason: '  ' })).status, 400, 'needs a reason');
  const banned = await post(`/studio/members/${id}/ban`, { reason: 'Spam links' });
  assert.equal(banned.status, 200);
  assert.ok(banned.data.member.bannedAt);
  assert.equal(banned.data.member.banReason, 'Spam links');

  assert.equal((await say(token)).status, 401, 'signed out');
  assert.equal(
    (await post(`/videos/${videoId}/comments`, { text: 'hello' }, token)).status,
    401,
    'comments too',
  );
  const again = await call('/auth/sign-in/username', {
    method: 'POST',
    body: { username: 'troublemaker', password: 'password1234' },
  });
  assert.equal(again.status, 403);
  assert.match(again.data.message, /has been banned/);
  assert.equal((await list('?filter=banned')).total, 1);
  assert.equal(
    (await post(`/studio/members/${id}/role`, { role: 'mod' })).status,
    409,
    'no role while banned',
  );

  const un = await call(`/studio/members/${id}/ban`, { method: 'DELETE', token: admin });
  assert.equal(un.data.member.bannedAt, null);
  const fresh = await signIn(call, 'troublemaker');
  assert.ok(fresh, 'signs in again');

  const { rows } = await pool.query(
    `SELECT action, reason FROM mod_actions WHERE target_user_id = $1 ORDER BY id`,
    [id],
  );
  assert.deepEqual(rows, [
    { action: 'ban', reason: 'Spam links' },
    { action: 'unban', reason: null },
  ]);
});

test('staff and yourself can’t be banned', async () => {
  await signIn(call, 'a_mod');
  const { id } = await find('a_mod');
  await post(`/studio/members/${id}/role`, { role: 'mod' });
  const r = await post(`/studio/members/${id}/ban`, { reason: 'oops' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Change their role to member first/);
  const me = await find('test_admin');
  assert.equal((await post(`/studio/members/${me.id}/ban`, { reason: 'oops' })).status, 409);
});

test('a timeout stops chat, comments and super chat messages, but not watching or liking', async () => {
  const token = await signIn(call, 'hothead');
  const { id } = await find('hothead');
  const say = () => post(`/videos/${videoId}/chat`, { text: 'hello', offsetMs: 1000 }, token);
  const timeout = (body) => post(`/studio/members/${id}/timeout`, body);

  assert.equal((await timeout({ length: 'week' })).status, 400, 'needs a reason');
  assert.equal((await timeout({ length: 'forever', reason: 'x' })).status, 400);
  assert.equal((await timeout({ length: 'custom', until: 'soon', reason: 'x' })).status, 400);
  assert.equal(
    (await timeout({ length: 'custom', until: new Date(Date.now() - 1000).toISOString(), reason: 'x' }))
      .status,
    400,
    'not in the past',
  );
  const noStream = await timeout({ length: 'stream', reason: 'x' });
  assert.equal(noStream.status, 409);
  assert.match(noStream.data.error, /No stream is live/);

  const r = await timeout({ length: 'week', reason: 'Insults in chat' });
  assert.equal(r.status, 200);
  const days = (new Date(r.data.member.timeoutUntil) - Date.now()) / 86400000;
  assert.ok(days > 6.99 && days < 7.01, `about a week, got ${days}`);
  assert.equal(r.data.member.timeoutReason, 'Insults in chat');

  const me = (await call('/me', { token })).data.user;
  assert.ok(me.timeoutUntil, 'still signed in, and told when it ends');
  assert.equal(me.timeoutReason, undefined, 'the reason is for staff only');
  const refused = await say();
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /timed out/);
  assert.equal(refused.data.timeoutUntil, me.timeoutUntil);
  assert.equal((await post(`/videos/${videoId}/comments`, { text: 'hello' }, token)).status, 403);
  assert.equal((await call(`/videos/${videoId}`, { token })).status, 200, 'can still watch');
  assert.equal((await post(`/videos/${videoId}/vote`, { value: 1 }, token)).status, 200, 'can still like');
  assert.equal((await list('?filter=timedout')).total, 1);

  // A custom end, then ended early.
  const until = new Date(Date.now() + 3 * 86400000).toISOString();
  const custom = await timeout({ length: 'custom', until, reason: 'Extended' });
  assert.equal(new Date(custom.data.member.timeoutUntil).toISOString(), until);
  const ended = await call(`/studio/members/${id}/timeout`, { method: 'DELETE', token: admin });
  assert.equal(ended.data.member.timeoutUntil, null);
  assert.equal((await call('/me', { token })).data.user.timeoutUntil, null);
  assert.equal((await say()).status, 200, 'can post again');

  // One that has run out no longer counts.
  await pool.query(
    `UPDATE users SET timeout_until = now() - interval '1 minute', timeout_reason = 'old' WHERE id = $1`,
    [id],
  );
  assert.equal((await find('hothead')).timeoutUntil, null);
  assert.equal((await list('?filter=timedout')).total, 0);

  const { rows } = await pool.query(
    `SELECT action, reason, duration_s IS NOT NULL AS timed FROM mod_actions WHERE target_user_id = $1 ORDER BY id`,
    [id],
  );
  assert.deepEqual(rows, [
    { action: 'timeout', reason: 'Insults in chat', timed: true },
    { action: 'timeout', reason: 'Extended', timed: true },
    { action: 'untimeout', reason: null, timed: false },
  ]);
});

test('"this stream" timeouts end when the stream does; staff can’t be timed out', async () => {
  await signIn(call, 'stream_pest');
  const { id } = await find('stream_pest');
  // As timeoutMember stores it for a live stream (there is no live stream in tests).
  await pool.query(
    `UPDATE users SET timeout_until = now() + interval '12 hours', timeout_reason = 'spam', timeout_stream = 'rec-77'
     WHERE id = $1`,
    [id],
  );
  const during = await find('stream_pest');
  assert.equal(during.timeoutThisStream, true);
  const { saveReplay } = await import('../src/live.js');
  await saveReplay({ id: 'rec-other', live: false, durationS: 10 }).catch(() => {});
  assert.ok((await find('stream_pest')).timeoutUntil, 'another stream ending changes nothing');
  await saveReplay({ id: 'rec-77', live: false, durationS: 10 }).catch(() => {});
  assert.equal((await find('stream_pest')).timeoutUntil, null, 'lifted when that stream ended');

  await signIn(call, 'a_second_mod');
  const mod = await find('a_second_mod');
  await post(`/studio/members/${mod.id}/role`, { role: 'mod' });
  const r = await post(`/studio/members/${mod.id}/timeout`, { length: 'week', reason: 'oops' });
  assert.equal(r.status, 409);
  const self = await find('test_admin');
  assert.equal(
    (await post(`/studio/members/${self.id}/timeout`, { length: 'week', reason: 'x' })).status,
    409,
  );
});
