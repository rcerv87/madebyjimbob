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
