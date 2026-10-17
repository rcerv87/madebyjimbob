// Each video's chat count is kept, not counted per request (migration 1792267123766): videos.chat_count plus pending
// deltas that triggers add and the fold job moves in. After every kind of change, and after folding, it must equal a
// fresh count of the video's visible messages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, seedVideo, seedChat, signIn, sleep, pool } from './helpers.js';
import { recountChat, foldChatCounts } from '../src/chatCounts.js';
import { eraseAccount } from '../src/deletion.js';

let call;
let base;
before(async () => {
  ({ base } = await startServer());
  call = client(base);
});
after(stopServer);

// What the site shows: the kept count plus the video's pending deltas.
const stored = async (id) =>
  (
    await pool.query(
      `SELECT v.chat_count + COALESCE((SELECT sum(delta) FROM chat_count_deltas d WHERE d.video_id = v.id), 0)::int AS n
       FROM videos v WHERE v.id = $1`,
      [id],
    )
  ).rows[0]?.n;
const actual = async (id) =>
  (await pool.query('SELECT count(*)::int AS n FROM chat_messages WHERE video_id = $1 AND NOT hidden', [id]))
    .rows[0].n;
// Right before folding, and still right after (folding never changes what the site shows).
async function assertRight(ids, what) {
  for (const id of ids) assert.equal(await stored(id), await actual(id), `${what}: video ${id}`);
  await foldChatCounts();
  for (const id of ids) {
    assert.equal(await stored(id), await actual(id), `${what}, folded: video ${id}`);
    const pending = await pool.query('SELECT count(*)::int AS n FROM chat_count_deltas WHERE video_id = $1', [
      id,
    ]);
    assert.equal(pending.rows[0].n, 0, `${what}: nothing pending after folding`);
  }
}
let seq = 0;
// Like import-youtube.js: one multi-row insert, duplicates skipped.
async function importBatch(rows) {
  const params = [];
  const values = rows.map(({ video, hidden = false, externalId }, i) => {
    seq += 1;
    params.push(video, externalId || `batch-${seq}`, `msg ${seq}`, i * 1000, hidden);
    const b = params.length - 5;
    return `($${b + 1}, 'youtube', $${b + 2}, 'Viewer', $${b + 3}, $${b + 4}, $${b + 5})`;
  });
  const res = await pool.query(
    `INSERT INTO chat_messages (video_id, source, external_id, author_name, body, offset_ms, hidden)
     VALUES ${values.join(',')} ON CONFLICT (source, external_id) DO NOTHING`,
    params,
  );
  return res.rowCount;
}

test('posting, imports (duplicates skipped), and messages hidden from the start', async () => {
  const a = await seedVideo();
  const b = await seedVideo();
  await assertRight([a, b], 'new videos');
  const token = await signIn(call, 'cc_poster');
  const r = await call(`/videos/${a}/chat`, {
    method: 'POST',
    token,
    body: { text: 'hello', offsetMs: 1000 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await stored(a), 1);

  assert.equal(
    await importBatch([
      { video: a },
      { video: a },
      { video: b },
      { video: b, hidden: true },
      { video: a, externalId: 'dup' },
    ]),
    5,
  );
  assert.equal(
    await importBatch([{ video: a, externalId: 'dup' }, { video: b }]),
    1,
    'the duplicate is skipped',
  );
  await assertRight([a, b], 'after imports');
  assert.equal(await stored(a), 4);
  assert.equal(await stored(b), 2);
  await seedChat(a, [
    { body: 'hidden one', offsetMs: 5, hidden: true },
    { body: 'shown', offsetMs: 6 },
  ]);
  await assertRight([a], 'one row per statement');
});

test('hiding, unhiding, moving between videos, and repeating them', async () => {
  const a = await seedVideo();
  const b = await seedVideo();
  await importBatch([{ video: a }, { video: a }, { video: a }, { video: b }]);
  const ids = (
    await pool.query('SELECT id FROM chat_messages WHERE video_id = $1 ORDER BY id', [a])
  ).rows.map((r) => r.id);
  await pool.query('UPDATE chat_messages SET hidden = true WHERE id = $1', [ids[0]]);
  await assertRight([a, b], 'hide');
  await pool.query('UPDATE chat_messages SET hidden = true WHERE id = $1', [ids[0]]);
  await assertRight([a, b], 'hide again');
  await pool.query('UPDATE chat_messages SET hidden = false WHERE id = $1', [ids[0]]);
  await assertRight([a, b], 'unhide');
  // Two messages move to b; one of them is hidden in the same statement.
  await pool.query(
    'UPDATE chat_messages SET video_id = $2, hidden = (id = $3) WHERE id = ANY($1::bigint[])',
    [[ids[1], ids[2]], b, ids[2]],
  );
  await assertRight([a, b], 'move');
  assert.deepEqual([await stored(a), await stored(b)], [1, 2]);
  // Changes that don't touch visibility or video leave counts alone (renames run this over a member's messages).
  await pool.query(`UPDATE chat_messages SET author_name = 'Renamed' WHERE video_id = ANY($1::bigint[])`, [
    [a, b],
  ]);
  await assertRight([a, b], 'rename');
});

test('deleting messages and deleting a video', async () => {
  const a = await seedVideo();
  const b = await seedVideo();
  await importBatch([{ video: a }, { video: a }, { video: a, hidden: true }, { video: b }, { video: b }]);
  await pool.query(
    'DELETE FROM chat_messages WHERE id = (SELECT min(id) FROM chat_messages WHERE video_id = $1)',
    [a],
  );
  await pool.query('DELETE FROM chat_messages WHERE video_id = $1 AND hidden', [a]);
  await assertRight([a, b], 'delete messages');
  await pool.query('DELETE FROM videos WHERE id = $1', [a]);
  assert.equal(await stored(a), undefined, 'the video is gone, with its chat');
  await assertRight([b], 'the other video');
});

test('account deletion: messages kept as "Deleted user" still count; removed ones don’t', async () => {
  const v = await seedVideo();
  const keep = await signIn(call, 'cc_keeper');
  const remove = await signIn(call, 'cc_remover');
  for (const [token, text] of [
    [keep, 'kept'],
    [remove, 'removed'],
  ]) {
    const r = await call(`/videos/${v}/chat`, { method: 'POST', token, body: { text, offsetMs: 2000 } });
    assert.equal(r.status, 200);
  }
  assert.equal(await stored(v), 2);
  const idOf = async (u) => (await pool.query('SELECT id FROM users WHERE username = $1', [u])).rows[0].id;
  await pool.query(`UPDATE users SET delete_content = false WHERE username = 'cc_keeper'`);
  await pool.query(`UPDATE users SET delete_content = true WHERE username = 'cc_remover'`);
  await eraseAccount(await idOf('cc_keeper'));
  await assertRight([v], 'kept');
  assert.equal(await stored(v), 2);
  await eraseAccount(await idOf('cc_remover'));
  await assertRight([v], 'removed');
  assert.equal(await stored(v), 1);
});

test('a rolled-back change leaves the count alone; recount-chat repairs a wrong count', async () => {
  const v = await seedVideo();
  await importBatch([{ video: v }, { video: v }]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO chat_messages (video_id, source, author_name, body, offset_ms) VALUES ($1, 'native', 'X', 'x', 1)`,
      [v],
    );
    await c.query('UPDATE chat_messages SET hidden = true WHERE video_id = $1', [v]);
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
  assert.equal(await stored(v), 2);
  await assertRight([v], 'after the rollback');

  // Wrong by hand, with a change still pending: the repair accounts for the pending delta.
  await pool.query('UPDATE videos SET chat_count = 99 WHERE id = $1', [v]);
  await importBatch([{ video: v }]);
  const fixed = await recountChat();
  assert.deepEqual(
    fixed.filter((f) => String(f.videoId) === String(v)),
    [{ videoId: String(v), was: 100, now: 3 }],
  );
  assert.equal((await recountChat()).length, 0, 'nothing left to fix');
  await assertRight([v], 'after the repair');
});

test('the site shows the kept count on cards and the video page', async () => {
  const v = await seedVideo();
  await importBatch([{ video: v }, { video: v }, { video: v }, { video: v, hidden: true }]);
  assert.equal((await call(`/videos/${v}`)).data.video.chatCount, 3);
  const list = (await call('/videos?limit=100')).data.videos;
  assert.equal(list.find((x) => String(x.id) === String(v)).chatCount, 3);
});

test('the Studio dashboard keeps its chat numbers for a while; Refresh recounts; the video list is always current', async () => {
  process.env.STUDIO_CHAT_STATS_MS = '60000';
  try {
    const admin = await signIn(call, 'test_admin');
    const v = await seedVideo();
    const first = (await call('/studio/overview?fresh=1', { token: admin })).data;
    assert.ok(first.chatCountedAt);
    await importBatch([{ video: v }, { video: v }]);
    await pool.query(`UPDATE videos SET title = 'Renamed in Studio' WHERE id = $1`, [v]);
    const cached = (await call('/studio/overview', { token: admin })).data;
    assert.equal(cached.totals.youtubeMsgs, first.totals.youtubeMsgs, 'chat numbers kept');
    assert.equal(cached.videos.find((x) => String(x.id) === String(v)).title, 'Renamed in Studio');
    await sleep(5);
    const fresh = (await call('/studio/overview?fresh=1', { token: admin })).data;
    assert.equal(fresh.totals.youtubeMsgs, first.totals.youtubeMsgs + 2);
    assert.equal(fresh.videos.find((x) => String(x.id) === String(v)).youtubeMsgs, 2);
    assert.notEqual(fresh.chatCountedAt, first.chatCountedAt);
  } finally {
    process.env.STUDIO_CHAT_STATS_MS = '0';
  }
});

test('the health check says which commit is running', async () => {
  assert.deepEqual((await call('/health')).data, { ok: true, version: null });
  process.env.RENDER_GIT_COMMIT = '0123456789abcdef';
  try {
    assert.equal((await call('/health')).data.version, '0123456');
  } finally {
    delete process.env.RENDER_GIT_COMMIT;
  }
});
