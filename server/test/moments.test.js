import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, seedChat, pool } from './helpers.js';

let call;
let admin;
let ann;
let bob;
let videoId;
let clearHeatCache;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  ({ clearHeatCache } = await import('../src/moments.js'));
  admin = await signIn(call, 'test_admin');
  ann = await signIn(call, 'ann_notes');
  bob = await signIn(call, 'bob_notes');
  videoId = await seedVideo({ durationS: 600 }); // 10 minutes
});
after(stopServer);
beforeEach(() => clearHeatCache());

const moments = async (token) => (await call(`/videos/${videoId}/moments`, { token })).data;
const note = (token, body, video = videoId) =>
  call(`/videos/${video}/notes`, { method: 'POST', token, body });
const react = (token, body, video = videoId) =>
  call(`/videos/${video}/reactions`, { method: 'POST', token, body });

test('a note is pinned to a moment or a stretch; public ones show to everyone, private ones only to their writer', async () => {
  assert.equal((await note(null, { text: 'hi', offsetMs: 1000 })).status, 401);
  assert.equal((await note(ann, { text: '   ', offsetMs: 1000 })).status, 400);
  assert.equal((await note(ann, { text: 'x', offsetMs: -5 })).status, 400);
  assert.equal((await note(ann, { text: 'x'.repeat(281), offsetMs: 0 })).status, 400);
  assert.equal(
    (await note(ann, { text: 'x', offsetMs: 0, endMs: 31 * 60 * 1000 }, await seedVideo({ durationS: 9000 })))
      .status,
    400,
  );

  const a = await note(ann, { text: '  This is where he   really goes off  ', offsetMs: 306_000 });
  assert.equal(a.status, 200);
  assert.deepEqual(
    [a.data.note.body, a.data.note.offsetMs, a.data.note.endMs, a.data.note.author, a.data.note.mine],
    ['This is where he really goes off', 306_000, null, 'ann_notes', true],
  );
  const stretch = await note(ann, { text: 'The boring call-in', offsetMs: 120_000, endMs: 240_000 });
  assert.equal(stretch.data.note.endMs, 240_000);
  const past = await note(ann, { text: 'Past the end', offsetMs: 9_999_000 });
  assert.equal(past.data.note.offsetMs, 600_000, 'kept inside the video');
  await note(bob, { text: 'Only for me', offsetMs: 60_000, private: true });
  await note(bob, { text: 'badword here', offsetMs: 61_000 });

  const forVisitor = (await moments(null)).notes;
  assert.deepEqual(
    forVisitor.map((n) => n.body),
    ['******* here', 'The boring call-in', 'This is where he really goes off', 'Past the end'],
    'in video order; private left out; filtered like comments',
  );
  assert.ok(forVisitor.every((n) => n.mine === false));
  const forBob = (await moments(bob)).notes;
  assert.ok(forBob.some((n) => n.body === 'Only for me' && n.private && n.mine));
  assert.equal(
    (await moments(ann)).notes.some((n) => n.body === 'Only for me'),
    false,
  );
});

test('you delete your own notes; Studio accounts can take any down; a banned member’s notes disappear', async () => {
  const mine = (await note(ann, { text: 'Delete me', offsetMs: 5000 })).data.note;
  const del = (token, id) => call(`/notes/${id}`, { method: 'DELETE', token });
  assert.equal((await del(null, mine.id)).status, 401);
  assert.equal((await del(bob, mine.id)).status, 403);
  assert.equal((await del(ann, mine.id)).status, 200);
  assert.equal((await del(ann, mine.id)).status, 404);

  const rude = (await note(bob, { text: 'Rude note', offsetMs: 7000 })).data.note;
  assert.equal((await del(admin, rude.id)).status, 200);
  assert.equal(
    (await moments(bob)).notes.some((n) => n.body === 'Rude note'),
    false,
    'hidden, even from its writer',
  );
  const { rows } = await pool.query('SELECT hidden FROM video_notes WHERE id = $1', [rude.id]);
  assert.deepEqual(rows, [{ hidden: true }], 'kept for the record');

  await pool.query(`UPDATE users SET banned_at = now() WHERE username = 'bob_notes'`);
  assert.equal(
    (await moments(null)).notes.some((n) => n.author === 'bob_notes'),
    false,
  );
  await pool.query(`UPDATE users SET banned_at = NULL WHERE username = 'bob_notes'`);
});

test('notes follow the video’s tier, timeouts, reports, the profile and the data download', async () => {
  const plusVideo = await seedVideo({ minTier: 'plus' });
  assert.equal((await note(ann, { text: 'x', offsetMs: 0 }, plusVideo)).status, 403);
  assert.equal((await call(`/videos/${plusVideo}/moments`, { token: ann })).status, 403);

  await pool.query(`UPDATE users SET timeout_until = now() + interval '1 day' WHERE username = 'bob_notes'`);
  assert.equal((await note(bob, { text: 'x', offsetMs: 0 })).status, 403);
  assert.equal(
    (await react(bob, { kind: 'funny', offsetMs: 0 })).status,
    200,
    'reacting is like a like: still allowed',
  );
  await react(bob, { kind: 'funny', offsetMs: 0 });
  await pool.query(`UPDATE users SET timeout_until = NULL WHERE username = 'bob_notes'`);

  const target = (await moments(null)).notes.find((n) => n.body === 'The boring call-in');
  const report = await call('/reports', {
    method: 'POST',
    token: bob,
    body: { noteId: target.id, reason: 'spam' },
  });
  assert.equal(report.status, 200);
  const listed = (await call('/studio/reports', { token: admin })).data.reports[0];
  assert.equal(listed.target, 'ann_notes');
  assert.match(listed.excerpt, /^Note on video \d+ at 120s: The boring call-in$/);

  const profile = (await call('/profiles/ann_notes')).data.profile;
  assert.deepEqual(profile.notes.map((n) => n.body).sort(), [
    'Past the end',
    'The boring call-in',
    'This is where he really goes off',
  ]);
  assert.equal(String(profile.notes[0].videoId), String(videoId));

  const data = (await call('/account/export', { token: ann })).data;
  assert.equal(data.videoNotes.length, 3);
});

test('one tap stamps a moment; the same tap again takes it back; one per kind per person per minute', async () => {
  assert.equal((await react(null, { kind: 'funny', offsetMs: 0 })).status, 401);
  assert.equal((await react(ann, { kind: 'meh', offsetMs: 0 })).status, 400);

  const first = await react(ann, { kind: 'funny', offsetMs: 125_000 }); // minute 2
  assert.equal(first.status, 200);
  assert.deepEqual([first.data.reaction.kind, first.data.reaction.offsetMs], ['funny', 125_000]);
  await react(ann, { kind: 'fire', offsetMs: 130_000 }); // another kind in the same minute is fine
  const again = await react(ann, { kind: 'funny', offsetMs: 170_000 }); // still minute 2: takes it back
  assert.equal(again.data.removed, first.data.reaction.id);
  await react(ann, { kind: 'funny', offsetMs: 171_000 });
  await react(bob, { kind: 'funny', offsetMs: 140_000 });

  const m = await moments(ann);
  assert.equal(m.minutes, 10);
  assert.deepEqual(m.kinds, ['funny', 'interesting', 'fire', 'boring', 'cringe']);
  assert.deepEqual(
    m.reactions.filter((r) => r.minute === 2),
    [
      { minute: 2, kind: 'fire', score: 1, people: 1 },
      { minute: 2, kind: 'funny', score: 2, people: 2 },
    ],
  );
  assert.deepEqual(m.mine.map((r) => r.kind).sort(), ['fire', 'funny']);
  assert.deepEqual(
    (await moments(null)).mine,
    [],
    'a visitor sees the picture, with no reactions of their own',
  );
});

test('a stretch counts once in each minute it covers; chat activity is counted per minute too', async () => {
  await react(bob, { kind: 'boring', offsetMs: 4 * 60_000 + 5000, endMs: 6 * 60_000 + 30_000 }); // minutes 4, 5, 6
  await react(bob, { kind: 'boring', offsetMs: 5 * 60_000 + 1000 }); // inside it: doesn't count twice
  await seedChat(videoId, [
    { body: 'a', offsetMs: 5 * 60_000 },
    { body: 'b', offsetMs: 5 * 60_000 + 59_000 },
    { body: 'c', offsetMs: 9 * 60_000 },
    { body: 'hidden', offsetMs: 9 * 60_000, hidden: true },
  ]);
  const m = await moments(null);
  assert.deepEqual(
    m.reactions.filter((r) => r.kind === 'boring').map((r) => [r.minute, r.score, r.people]),
    [
      [4, 1, 1],
      [5, 1, 1],
      [6, 1, 1],
    ],
  );
  assert.deepEqual([m.chat[5], m.chat[9], m.chat[0]], [2, 1, 0]);
});

test('someone who marks a whole video counts for less per mark', async () => {
  const long = await seedVideo({ durationS: 3 * 3600 });
  const heavy = await signIn(call, 'heavy_marker');
  const light = await signIn(call, 'light_marker');
  // 60 marked minutes in two 30-minute stretches, against one tap from someone else.
  await react(heavy, { kind: 'boring', offsetMs: 0, endMs: 29 * 60_000 + 59_000 }, long);
  await react(heavy, { kind: 'boring', offsetMs: 30 * 60_000, endMs: 59 * 60_000 + 59_000 }, long);
  await react(light, { kind: 'funny', offsetMs: 10 * 60_000 }, long);
  const m = (await call(`/videos/${long}/moments`)).data;
  const at10 = Object.fromEntries(m.reactions.filter((r) => r.minute === 10).map((r) => [r.kind, r.score]));
  assert.deepEqual(at10, { boring: 0.5, funny: 1 });
  assert.equal(m.minutes, 180);
});
