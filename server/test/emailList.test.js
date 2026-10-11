import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';

let call;
let base;
let admin;
let importContacts;
before(async () => {
  ({ base } = await startServer());
  call = client(base);
  admin = await signIn(call, 'test_admin');
  ({ importContacts } = await import('../src/emailList.js'));
});
after(stopServer);

const site = () => base.replace(/\/api$/, '');
const marketing = (token, body) =>
  body ? call('/account/marketing', { method: 'PUT', token, body }) : call('/account/marketing', { token });
const verify = (username) =>
  pool.query('UPDATE users SET email_verified = true WHERE username = $1', [username]);
const csv = async () =>
  (await fetch(`${base}/studio/email-list.csv`, { headers: { Authorization: `Bearer ${admin}` } })).text();
const summary = async () => (await call('/studio/email-list', { token: admin })).data;

test('a member opts in (with when and where); only confirmed emails are on the list', async () => {
  const token = await signIn(call, 'news_fan');
  assert.equal((await marketing(null)).status, 401);
  assert.deepEqual((await marketing(token)).data, {
    on: false,
    since: null,
    needsEmail: false,
    needsConfirm: true,
  });
  assert.equal((await marketing(token, { on: 'yes' })).status, 400);

  const on = await marketing(token, { on: true, source: 'signup' });
  assert.equal(on.data.on, true);
  assert.ok(on.data.since);
  const { rows } = await pool.query(
    `SELECT marketing_source, marketing_opt_in_at IS NOT NULL AS stamped FROM users WHERE username = 'news_fan'`,
  );
  assert.deepEqual(rows[0], { marketing_source: 'signup', stamped: true });

  const before = await summary();
  assert.equal(before.total, 0, 'not on the list until the email is confirmed');
  assert.equal(before.waitingToConfirm, 1);
  await verify('news_fan');
  const after = await summary();
  assert.deepEqual([after.total, after.members, after.imported, after.waitingToConfirm], [1, 1, 0, 0]);
  assert.deepEqual(after.bySource, { signup: 1 });
});

test('the export is for admins: a CSV with each person’s unsubscribe link', async () => {
  const viewer = await signIn(call, 'not_staff');
  assert.equal((await call('/studio/email-list', { token: viewer })).status, 403);
  const res = await fetch(`${base}/studio/email-list.csv`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="madebyjimbob-email-list-/);
  const lines = (await res.text()).replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines[0], 'email,name,username,source,opted_in_at,unsubscribe_url');
  assert.equal(lines.length, 2);
  const [email, , username, source, , link] = lines[1].split(',');
  assert.deepEqual([email, username, source], ['news_fan@test.example', 'news_fan', 'signup']);
  assert.match(link, /\/api\/unsubscribe\?e=news_fan%40test\.example&t=[\w-]{32}$/);
});

test('the unsubscribe link asks first, then takes the address off the list; a wrong link does nothing', async () => {
  const link = (await csv()).split('\r\n')[1].split(',').pop();
  const url = site() + new URL(link).pathname.replace(/^\/api/, '/api') + new URL(link).search;

  const bad = await fetch(`${site()}/api/unsubscribe?e=news_fan%40test.example&t=wrong`, { method: 'POST' });
  assert.equal(bad.status, 400);
  assert.equal((await summary()).total, 1);

  const ask = await fetch(url);
  assert.equal(ask.status, 200);
  assert.match(await ask.text(), /<form method="post"[\s\S]*Unsubscribe<\/button>/);
  assert.equal((await summary()).total, 1, 'opening the link alone changes nothing');

  const done = await fetch(url, { method: 'POST' });
  assert.match(await done.text(), /You’re unsubscribed/);
  assert.equal((await summary()).total, 0);
  const token = await signIn(call, 'news_fan');
  assert.equal((await marketing(token)).data.on, false, 'their Account switch is off too');
});

test('the Shopify list comes in: only people who accepted marketing, and never anyone who unsubscribed here', async () => {
  const file = [
    'First Name,Last Name,Email,Accepts Email Marketing,Total Spent',
    'Ann,Lee,Ann.Lee@Example.com,yes,40.00',
    'Bob,"O\'Neil, Jr.",bob@example.com,no,12.00',
    ',,,yes,0',
    '=cmd,Formula,sneaky@example.com,yes,0',
  ].join('\n');
  assert.deepEqual(await importContacts(file), { added: 2, updated: 0, skipped: 2 });
  assert.deepEqual(
    await importContacts(file),
    { added: 0, updated: 2, skipped: 2 },
    'running it twice is safe',
  );
  await assert.rejects(importContacts('Name,Phone\nx,1'), /no "Email" column/);

  const s = await summary();
  assert.deepEqual([s.total, s.members, s.imported], [2, 0, 2]);
  const text = await csv();
  assert.match(text, /ann\.lee@example\.com,Ann Lee,,shopify,/);
  assert.match(text, /sneaky@example\.com,'=cmd Formula,/, 'a name can’t become a spreadsheet formula');

  // Ann unsubscribes; importing the list again doesn't bring her back.
  const link = text
    .split('\r\n')
    .find((l) => l.startsWith('ann.lee'))
    .split(',')
    .pop();
  await fetch(site() + new URL(link).pathname + new URL(link).search, { method: 'POST' });
  assert.deepEqual(await importContacts(file), { added: 0, updated: 1, skipped: 3 });
  assert.equal((await summary()).total, 1);

  // Ann makes an account with that address and says yes: she's on the list once, as a member.
  const ann = await call('/auth/sign-up/email', {
    method: 'POST',
    body: { email: 'ann.lee@example.com', password: 'password1234', name: 'ann_lee', username: 'ann_lee' },
  });
  await verify('ann_lee');
  await marketing(ann.token, { on: true });
  const now = await summary();
  assert.deepEqual([now.total, now.members, now.imported], [2, 1, 1]);
  assert.equal((await csv()).split('\r\n').filter((l) => l.startsWith('ann.lee')).length, 1);
});

test('bounced addresses and banned members are left out', async () => {
  await pool.query(`INSERT INTO email_suppressions (email, reason) VALUES ('sneaky@example.com', 'bounce')`);
  await pool.query(`UPDATE users SET banned_at = now() WHERE username = 'ann_lee'`);
  assert.equal((await summary()).total, 0);
});
