import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';

let call;
let admin;
const ids = {};
before(async () => {
  const { base } = await startServer();
  call = client(base);
  admin = await signIn(call, 'test_admin');
  const add = async (key, title, kind, minTier = 'free', views = 0, daysAgo = 1, youtubeId = `yt-${key}`) => {
    const { rows } = await pool.query(
      `INSERT INTO videos (youtube_id, title, description, kind, min_tier, views, duration_s, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, 600, now() - make_interval(days => $7)) RETURNING id`,
      [youtubeId, title, `about ${title}`, kind, minTier, views, daysAgo],
    );
    ids[key] = rows[0].id;
  };
  await add('debate', 'Evolution Debate', 'live', 'free', 50, 3);
  await add('guitar', 'Guitar build day', 'video', 'free', 5, 10);
  await add('short', 'Quick take 50%_off', 'short', 'free', 99, 1);
  await add('members', 'Members Q&A', 'live', 'plus', 10, 2);
});
after(stopServer);

const titles = (r) => r.data.videos.map((v) => v.title);

describe('videos dashboard', () => {
  test('lists everything newest first with counts per chip', async () => {
    const r = await call('/videos');
    assert.deepEqual(titles(r), [
      'Quick take 50%_off',
      'Members Q&A',
      'Evolution Debate',
      'Guitar build day',
    ]);
    assert.deepEqual(r.data.counts, { all: 4, video: 1, short: 1, live: 2, members: 1 });
    assert.equal(r.data.videos[0].kind, 'short');
  });

  test('filters by type and members-only', async () => {
    assert.deepEqual(titles(await call('/videos?kind=live')), ['Members Q&A', 'Evolution Debate']);
    assert.deepEqual(titles(await call('/videos?members=1')), ['Members Q&A']);
    assert.deepEqual(titles(await call('/videos?kind=nonsense')).length, 4);
  });

  test('searches titles and descriptions; % and _ are literal; counts follow the search', async () => {
    const r = await call('/videos?q=debate');
    assert.deepEqual(titles(r), ['Evolution Debate']);
    assert.deepEqual(r.data.counts, { all: 1, video: 0, short: 0, live: 1, members: 0 });
    assert.deepEqual(titles(await call(`/videos?q=${encodeURIComponent('50%_')}`)), ['Quick take 50%_off']);
    assert.deepEqual(titles(await call(`/videos?q=${encodeURIComponent('%')}`)), ['Quick take 50%_off']);
  });

  test('sorts by oldest and most viewed', async () => {
    assert.equal(titles(await call('/videos?sort=old'))[0], 'Guitar build day');
    assert.equal(titles(await call('/videos?sort=views'))[0], 'Quick take 50%_off');
  });
});

describe('playlists', () => {
  test('an imported playlist shows only videos on the site, in order, and fills in later arrivals', async () => {
    const { rows } = await pool.query(
      `INSERT INTO playlists (source, youtube_id, title) VALUES ('youtube', 'PLtest', 'Debates') RETURNING id`,
    );
    const pid = rows[0].id;
    await pool.query(
      `INSERT INTO playlist_items (playlist_id, position, youtube_id) VALUES ($1, 0, 'yt-guitar'), ($1, 1, 'yt-missing'), ($1, 2, 'yt-debate')`,
      [pid],
    );
    let r = await call(`/playlists/${pid}`);
    assert.deepEqual(titles(r), ['Guitar build day', 'Evolution Debate']);
    assert.equal(r.data.playlist.videoCount, 2);
    assert.equal(r.data.playlist.durationS, 1200);

    await pool.query(
      `INSERT INTO videos (youtube_id, title, kind, duration_s) VALUES ('yt-missing', 'Arrived later', 'video', 60)`,
    );
    r = await call(`/playlists/${pid}`);
    assert.deepEqual(titles(r), ['Guitar build day', 'Arrived later', 'Evolution Debate']);
    assert.ok((await call('/playlists')).data.playlists.some((p) => p.id === pid));
  });

  test('empty playlists are hidden from viewers; bad ids 404', async () => {
    await pool.query(
      `INSERT INTO playlists (source, youtube_id, title) VALUES ('youtube', 'PLempty', 'Nothing yet')`,
    );
    assert.ok(!(await call('/playlists')).data.playlists.some((p) => p.title === 'Nothing yet'));
    assert.equal((await call('/playlists/abc')).status, 404);
    assert.equal((await call('/playlists/999999')).status, 404);
  });
});

describe('studio playlists', () => {
  test('admins create, fill, reorder, rename, and delete their own playlists', async () => {
    const made = await call('/studio/playlists', {
      method: 'POST',
      token: admin,
      body: { title: '  Best of  ' },
    });
    assert.equal(made.status, 200);
    const pid = made.data.playlist.id;
    assert.equal(made.data.playlist.title, 'Best of');

    const put = await call(`/studio/playlists/${pid}/items`, {
      method: 'PUT',
      token: admin,
      body: { videoIds: [ids.debate, ids.guitar] },
    });
    assert.equal(put.data.count, 2);
    assert.deepEqual(titles(await call(`/playlists/${pid}`)), ['Evolution Debate', 'Guitar build day']);

    await call(`/studio/playlists/${pid}/items`, {
      method: 'PUT',
      token: admin,
      body: { videoIds: [ids.guitar, ids.debate] },
    });
    assert.deepEqual(titles(await call(`/playlists/${pid}`)), ['Guitar build day', 'Evolution Debate']);

    await call(`/studio/playlists/${pid}`, {
      method: 'PATCH',
      token: admin,
      body: { title: 'Best of 2026' },
    });
    assert.equal((await call(`/playlists/${pid}`)).data.playlist.title, 'Best of 2026');

    const studio = await call('/studio/playlists', { token: admin });
    assert.equal(studio.data.playlists.find((p) => p.id === pid).videos.length, 2);

    assert.equal((await call(`/studio/playlists/${pid}`, { method: 'DELETE', token: admin })).status, 200);
    assert.equal((await call(`/playlists/${pid}`)).status, 404);
  });

  test('rejects bad input, YouTube playlists, and non-admins', async () => {
    assert.equal(
      (await call('/studio/playlists', { method: 'POST', token: admin, body: { title: ' ' } })).status,
      400,
    );
    const pid = (await call('/studio/playlists', { method: 'POST', token: admin, body: { title: 'x' } })).data
      .playlist.id;
    for (const videoIds of [[ids.guitar, ids.guitar], ['abc'], [999999], 'nope']) {
      const r = await call(`/studio/playlists/${pid}/items`, {
        method: 'PUT',
        token: admin,
        body: { videoIds },
      });
      assert.equal(r.status, 400, JSON.stringify(videoIds));
    }
    const yt = (await pool.query(`SELECT id FROM playlists WHERE youtube_id = 'PLtest'`)).rows[0].id;
    assert.equal((await call(`/studio/playlists/${yt}`, { method: 'DELETE', token: admin })).status, 409);
    const viewer = await signIn(call, 'library_viewer');
    assert.equal((await call('/studio/playlists', { token: viewer })).status, 403);
  });

  test('Studio lists every playlist with its own videos, in order', async () => {
    const make = async (title, videoIds) => {
      const pid = (await call('/studio/playlists', { method: 'POST', token: admin, body: { title } })).data
        .playlist.id;
      await call(`/studio/playlists/${pid}/items`, { method: 'PUT', token: admin, body: { videoIds } });
      return pid;
    };
    const a = await make('Two', [ids.guitar, ids.debate]);
    const b = await make('One', [ids.short]);
    const empty = await make('None', []);
    const { data } = await call('/studio/playlists', { token: admin });
    const videosOf = (pid) => titles({ data: data.playlists.find((p) => p.id === pid) });
    assert.deepEqual(videosOf(a), ['Guitar build day', 'Evolution Debate']);
    assert.deepEqual(videosOf(b), ['Quick take 50%_off']);
    assert.deepEqual(videosOf(empty), []);
  });
});
