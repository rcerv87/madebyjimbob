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
  return Promise.resolve(
    new Response(null, {
      status: r2.has(key) ? 200 : 404,
      headers: { 'content-length': '163000000', 'last-modified': 'Sat, 10 Oct 2026 12:00:00 GMT' },
    }),
  );
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

describe('Studio → Library uploader', () => {
  test('admins get a download link once the program is published, and see how the upload is going', async () => {
    const admin = await signIn(call, 'test_admin');
    const viewer = await signIn(call, 'wizard_viewer');
    assert.equal((await call('/studio/library/uploader', { token: viewer })).status, 403);

    const before = (await call('/studio/library/uploader', { token: admin })).data;
    assert.equal(before.storageReady, true);
    assert.equal(before.download, null, 'not published yet');
    assert.equal(before.username, 'test_admin');
    assert.equal(before.hasPassword, true);
    assert.deepEqual(before.progress, {
      done: 0,
      uploading: 0,
      lastFinishedAt: null,
      lastTitle: null,
      drafts: 0,
    });

    r2.add('tools/MADEbyJIMBOB-Library-Uploader.zip');
    await pool.query(
      `INSERT INTO library_uploads (youtube_id, file_key, title, status, finished_at)
       VALUES ('WIZARD00001', 'wiz-1', 'First stream', 'done', now()), ('WIZARD00002', 'wiz-2', 'Second', 'uploading', NULL)`,
    );
    const now = (await call('/studio/library/uploader', { token: admin })).data;
    const url = new URL(now.download.url);
    assert.equal(url.pathname, '/madebyjimbob-live/tools/MADEbyJIMBOB-Library-Uploader.zip');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '3600', 'the link lasts an hour');
    assert.equal(now.download.sizeBytes, 163000000);
    assert.equal(now.download.updatedAt, '2026-10-10T12:00:00.000Z');
    assert.equal(now.progress.done, 1);
    assert.equal(now.progress.uploading, 1);
    assert.equal(now.progress.lastTitle, 'First stream');
    await pool.query(`DELETE FROM library_uploads WHERE file_key IN ('wiz-1', 'wiz-2')`);
  });
});

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

describe('Videos that were never on YouTube', () => {
  test('upload as a hidden draft; publishing it in Studio puts it on the site', async () => {
    const admin = await signIn(call, 'test_admin');
    const viewer = await signIn(call, 'draft_viewer');
    const fileKey = '|Not on YouTube/2019_art_stream.mp4|555';

    assert.equal(
      (await post('/studio/library/uploads', admin, { siteOnly: true, fileKey, title: '  ' })).status,
      400,
      'needs a title',
    );
    const start = await post('/studio/library/uploads', admin, {
      siteOnly: true,
      fileKey,
      title: '2019 art stream',
      sizeBytes: 555,
      recordedAt: '2019-03-02T18:00:00.000Z',
    });
    assert.equal(start.status, 200);
    const { prefix } = start.data;
    assert.match(prefix, /^library\/site-[0-9a-f]{20}$/, 'named from the file, not the row');
    assert.equal(start.data.done, false);
    const signed = await post(`/studio/library/uploads/${start.data.uploadId}/sign`, admin, {
      paths: ['master.m3u8'],
    });
    assert.equal(
      new URL(signed.data.urls['master.m3u8']).pathname,
      `/madebyjimbob-live/${prefix}/master.m3u8`,
    );

    r2.add(`${prefix}/master.m3u8`);
    const fin = await post(`/studio/library/uploads/${start.data.uploadId}/finish`, admin, {
      durationS: 1200,
    });
    assert.equal(fin.status, 200);
    assert.equal(fin.data.draft, true);
    assert.equal(fin.data.importJobId, null, 'nothing to fetch from YouTube');
    const id = fin.data.videoId;

    // Hidden from everyone but Studio accounts.
    const listed = async (token) =>
      (await call('/videos', { token })).data.videos.some((v) => String(v.id) === String(id));
    assert.equal(await listed(viewer), false);
    assert.equal(await listed(admin), false, 'not in the public list even for admins');
    assert.equal((await call(`/videos/${id}`, { token: viewer })).status, 404);
    assert.equal((await call(`/videos/${id}`)).status, 404);
    assert.equal((await call(`/videos/${id}/chat?from=0&to=1000`, { token: viewer })).status, 404);
    assert.equal((await call(`/videos/${id}`, { token: admin })).status, 200, 'Studio accounts can preview');

    const overview = (await call('/studio/overview', { token: admin })).data;
    assert.equal(overview.attention.drafts, 1);
    const row = overview.videos.find((v) => String(v.id) === String(id));
    assert.deepEqual([row.title, row.draft, row.durationS], ['2019 art stream', true, 1200]);
    assert.equal(new Date(row.publishedAt).toISOString(), '2019-03-02T18:00:00.000Z', 'dated when made');
    assert.equal((await call('/studio/library/uploader', { token: admin })).data.progress.drafts, 1);

    // The same file again is skipped.
    const again = await post('/studio/library/uploads', admin, { siteOnly: true, fileKey, title: 'x' });
    assert.equal(again.data.done, true);

    const patch = (body) => call(`/studio/videos/${id}`, { method: 'PATCH', token: admin, body });
    assert.equal((await patch({})).status, 400);
    assert.equal((await patch({ title: ' ' })).status, 400);
    assert.equal((await patch({ draft: 'no' })).status, 400);
    assert.equal(
      (await patch({ title: 'Art stream, March 2019', minTier: 'plus', draft: false })).status,
      200,
    );
    assert.equal(await listed(admin), true, 'published');
    assert.equal((await call(`/videos/${id}`)).status, 200, 'visitors can open it (the tier still applies)');
    assert.equal((await call('/studio/overview', { token: admin })).data.attention.drafts, 0);

    // Changing only who can watch still works the old way.
    assert.equal((await patch({ minTier: 'free' })).status, 200);
    const { rows } = await pool.query('SELECT min_tier, draft, title FROM videos WHERE id = $1', [id]);
    assert.deepEqual(rows[0], { min_tier: 'free', draft: false, title: 'Art stream, March 2019' });
  });

  test('a file already matched to a YouTube video is never turned into a site-only one', async () => {
    const admin = await signIn(call, 'test_admin');
    const fileKey = 'takeout-9.zip|videos/known.mp4|77';
    await post('/studio/library/uploads', admin, { youtubeId: 'LIBKNOWN001', fileKey, title: 'Known' });
    const r = await post('/studio/library/uploads', admin, { siteOnly: true, fileKey, title: 'Known' });
    assert.equal(r.status, 409);
  });

  test('deleting a draft in Studio removes it, and the file is not sent again', async () => {
    const admin = await signIn(call, 'test_admin');
    const body = { siteOnly: true, fileKey: '|Not on YouTube/oops.mp4|9', title: 'oops' };
    const start = await post('/studio/library/uploads', admin, body);
    r2.add(`${start.data.prefix}/master.m3u8`);
    const fin = await post(`/studio/library/uploads/${start.data.uploadId}/finish`, admin, { durationS: 5 });
    const del = await call(`/studio/videos/${fin.data.videoId}`, {
      method: 'DELETE',
      token: admin,
      body: {},
    });
    assert.equal(del.status, 200);
    assert.equal((await call(`/videos/${fin.data.videoId}`, { token: admin })).status, 404);
    assert.equal((await post('/studio/library/uploads', admin, body)).data.done, true);
  });
});
