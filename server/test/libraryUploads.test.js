// The site's side of the Library Uploader (MBJ-818): only Studio accounts, links only for a video's own files, and a
// finished video either switches an existing one to R2 or is queued for the import helper.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';

const realFetch = globalThis.fetch;
const r2 = new Set(); // keys that exist in the fake bucket
function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  if (u.hostname !== 'jb.r2.cloudflarestorage.com') return realFetch(url, opts);
  const key = decodeURIComponent(u.pathname.replace('/madebyjimbob-live/', ''));
  return Promise.resolve(new Response(null, { status: r2.has(key) ? 200 : 404 }));
}

let call;
before(async () => {
  Object.assign(process.env, {
    LIBRARY_R2_ACCOUNT_ID: 'jb',
    LIBRARY_R2_ACCESS_KEY_ID: 'key',
    LIBRARY_R2_SECRET_ACCESS_KEY: 'secret',
    LIBRARY_R2_BUCKET: 'madebyjimbob-live',
    LIBRARY_R2_PUBLIC_URL: 'https://pub-jb.r2.dev/',
  });
  const { base } = await startServer();
  call = client(base);
  globalThis.fetch = fakeFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (k.startsWith('LIBRARY_R2_')) delete process.env[k];
  await stopServer();
});

const post = (path, token, body) => call(path, { method: 'POST', token, body });

describe('Library Uploader (MBJ-818)', () => {
  test('only Studio accounts; upload links only for the video’s own files', async () => {
    const viewer = await signIn(call, 'lib_viewer');
    assert.equal((await post('/studio/library/uploads', viewer, {})).status, 403);
    const admin = await signIn(call, 'test_admin');
    assert.equal(
      (await post('/studio/library/uploads', admin, { youtubeId: 'nope', fileKey: 'k' })).status,
      400,
    );
    const start = await post('/studio/library/uploads', admin, {
      youtubeId: 'LIBNEW00001',
      fileKey: 'takeout-001.zip|videos/a.mp4|123',
      title: 'A new one',
      sizeBytes: 123,
    });
    assert.equal(start.status, 200);
    assert.deepEqual([start.data.prefix, start.data.done], ['library/LIBNEW00001', false]);
    const signed = await post(`/studio/library/uploads/${start.data.uploadId}/sign`, admin, {
      paths: ['720p/seg_00000.ts', 'audio/index.m3u8', 'thumb.jpg', 'master.m3u8'],
    });
    assert.equal(signed.status, 200);
    const url = new URL(signed.data.urls['720p/seg_00000.ts']);
    assert.equal(url.host, 'jb.r2.cloudflarestorage.com');
    assert.equal(url.pathname, '/madebyjimbob-live/library/LIBNEW00001/720p/seg_00000.ts');
    assert.ok(url.searchParams.get('X-Amz-Signature'));
    for (const paths of [['../other/master.m3u8'], ['720p/evil.html'], Array(501).fill('master.m3u8')]) {
      const r = await post(`/studio/library/uploads/${start.data.uploadId}/sign`, admin, { paths });
      assert.equal(r.status, 400, JSON.stringify(paths[0]));
    }
  });

  test('finished: a new video goes to the import helper with its R2 address; never uploaded twice', async () => {
    const admin = await signIn(call, 'test_admin');
    const start = await post('/studio/library/uploads', admin, {
      youtubeId: 'LIBNEW00002',
      fileKey: 'zip|b.mp4|9',
      title: 'Brand new stream',
    });
    const finish = () =>
      post(`/studio/library/uploads/${start.data.uploadId}/finish`, admin, { durationS: 3600 });
    assert.equal((await finish()).status, 409, 'not before the master list is up');
    r2.add('library/LIBNEW00002/master.m3u8');
    const done = await finish();
    assert.equal(done.status, 200);
    assert.equal(done.data.hlsUrl, 'https://pub-jb.r2.dev/library/LIBNEW00002/master.m3u8');
    const { rows: jobs } = await pool.query(
      `SELECT status, hls_url, title FROM import_jobs WHERE youtube_id = 'LIBNEW00002'`,
    );
    assert.deepEqual(jobs, [{ status: 'queued', hls_url: done.data.hlsUrl, title: 'Brand new stream' }]);
    const { claimNext } = await import('../src/imports.js');
    const job = await claimNext();
    assert.equal(job.hlsUrl, done.data.hlsUrl, 'the helper gets the address and skips downloading');
    const again = await post('/studio/library/uploads', admin, {
      youtubeId: 'LIBNEW00002',
      fileKey: 'another-zip|b.mp4|9',
    });
    assert.equal(again.data.done, true);
    const known = await post('/studio/library/uploaded', admin, {
      fileKeys: ['zip|b.mp4|9', 'never|seen|1'],
    });
    assert.deepEqual(known.data.done, ['zip|b.mp4|9']);
  });

  test('finished: a video already on the site switches to the R2 copy, keeping its chat', async () => {
    const admin = await signIn(call, 'test_admin');
    const { rows } = await pool.query(
      `INSERT INTO videos (youtube_id, title, stream_uid) VALUES ('LIBOLD00001', 'Old import', 'cfuid') RETURNING id`,
    );
    const start = await post('/studio/library/uploads', admin, {
      youtubeId: 'LIBOLD00001',
      fileKey: 'zip|old.mp4|5',
    });
    r2.add('library/LIBOLD00001/master.m3u8');
    const done = await post(`/studio/library/uploads/${start.data.uploadId}/finish`, admin, {
      durationS: 1200,
    });
    assert.equal(done.data.videoId, rows[0].id);
    const v = await pool.query('SELECT hls_url, duration_s FROM videos WHERE id = $1', [rows[0].id]);
    assert.deepEqual(v.rows[0], {
      hls_url: 'https://pub-jb.r2.dev/library/LIBOLD00001/master.m3u8',
      duration_s: 1200,
    });
    const page = await call(`/videos/${rows[0].id}`);
    assert.equal(
      page.data.video.hls,
      'https://pub-jb.r2.dev/library/LIBOLD00001/master.m3u8',
      'plays from R2 now',
    );
  });
});
