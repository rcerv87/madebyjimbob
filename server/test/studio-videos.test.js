import { test, before, after, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, seedVideo, seedChat, pool } from './helpers.js';
import { youtubeId, claimNext, reportStep, finishJob, heartbeat, requeueRunning } from '../src/imports.js';

let call;
let admin;
before(async () => {
  const { base } = await startServer();
  call = client(base);
  // Studio by role, no admin email needed (npm run set-role).
  admin = await signIn(call, 'studio_owner');
  await pool.query(`UPDATE users SET role = 'admin' WHERE username = 'studio_owner'`);
});
after(stopServer);

// Cloudflare stand-in: the server runs in this process, so stub its calls to api.cloudflare.com only.
const realFetch = globalThis.fetch;
let cfCalls = [];
function stubCloudflare(handler) {
  process.env.CF_ACCOUNT_ID = 'acct';
  process.env.CF_API_TOKEN = 'token';
  cfCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://api.cloudflare.com/')) {
      cfCalls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} });
      return handler(String(url), opts);
    }
    return realFetch(url, opts);
  };
}
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CF_ACCOUNT_ID;
  delete process.env.CF_API_TOKEN;
});

async function videoWithStuff({ uid }) {
  const id = await seedVideo();
  await pool.query('UPDATE videos SET stream_uid = $2, youtube_id = $3 WHERE id = $1', [
    id,
    uid,
    `yt_${uid}`,
  ]);
  await seedChat(id, [{ body: 'hello', offsetMs: 1000 }]);
  return id;
}

describe('Studio access', () => {
  test('the admin role opens Studio; viewers get 403', async () => {
    assert.equal((await call('/me', { token: admin })).data.user.isAdmin, true);
    assert.equal((await call('/studio/overview', { token: admin })).status, 200);
    const viewer = await signIn(call, 'just_a_viewer');
    assert.equal((await call('/studio/overview', { token: viewer })).status, 403);
    assert.equal((await call('/studio/imports', { token: viewer })).status, 403);
  });
});

describe('deleting a video', () => {
  test('removes it and everything on it; keeps its YouTube playlist spot; deletes the Stream file', async () => {
    const id = await videoWithStuff({ uid: 'uid_gone' });
    const viewer = await signIn(call, 'deleting_viewer');
    await call(`/videos/${id}/vote`, { method: 'POST', token: viewer, body: { value: 1 } });
    const { rows: pl } = await pool.query(
      `INSERT INTO playlists (title, source, youtube_id) VALUES ('YT list', 'youtube', 'PL1') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO playlist_items (playlist_id, position, youtube_id, video_id) VALUES ($1, 0, $2, $3)`,
      [pl[0].id, 'yt_uid_gone', id],
    );

    stubCloudflare(() => new Response('{}', { status: 200 }));
    const r = await call(`/studio/videos/${id}`, { method: 'DELETE', token: admin, body: {} });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.stream, { deleted: true });
    assert.equal(cfCalls[0].method, 'DELETE');
    assert.match(cfCalls[0].url, /\/stream\/uid_gone$/);

    assert.equal((await call(`/videos/${id}`)).status, 404);
    for (const t of ['chat_messages', 'video_votes']) {
      assert.equal((await pool.query(`SELECT 1 FROM ${t} WHERE video_id = $1`, [id])).rowCount, 0, t);
    }
    const item = await pool.query('SELECT youtube_id, video_id FROM playlist_items WHERE playlist_id = $1', [
      pl[0].id,
    ]);
    assert.deepEqual(item.rows[0], { youtube_id: 'yt_uid_gone', video_id: null });
  });

  test('without Cloudflare keys the video still goes, and Studio is told the file is still there', async () => {
    const id = await videoWithStuff({ uid: 'uid_kept' });
    const r = await call(`/studio/videos/${id}`, { method: 'DELETE', token: admin, body: {} });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.stream, { deleted: false, reason: 'not-configured' });
    assert.equal(r.data.streamUid, 'uid_kept');
  });

  test('a Stream file another video still uses is not deleted', async () => {
    const a = await videoWithStuff({ uid: 'uid_shared' });
    const b = await seedVideo();
    await pool.query(`UPDATE videos SET stream_uid = 'uid_shared' WHERE id = $1`, [b]);
    stubCloudflare(() => new Response('{}', { status: 200 }));
    const r = await call(`/studio/videos/${a}`, { method: 'DELETE', token: admin, body: {} });
    assert.deepEqual(r.data.stream, { deleted: false, reason: 'shared' });
    assert.equal(cfCalls.length, 0);
  });
});

describe('adding videos (import queue)', () => {
  test('reads YouTube links', () => {
    assert.equal(youtubeId('https://www.youtube.com/watch?v=mzP0tKpIv5w&t=30'), 'mzP0tKpIv5w');
    assert.equal(youtubeId('youtu.be/gdgBIwSAKgg'), 'gdgBIwSAKgg');
    assert.equal(youtubeId('https://www.youtube.com/live/Hz_elPwFwvU?si=x'), 'Hz_elPwFwvU');
    assert.equal(youtubeId('https://youtube.com/shorts/uijhf9xg4u8'), 'uijhf9xg4u8');
    assert.equal(youtubeId('https://www.youtube.com/playlist?list=PL123'), null);
    assert.equal(youtubeId('https://example.com/watch?v=mzP0tKpIv5w'), null);
  });

  test('queues each new link once and says why others were skipped', async () => {
    const onSite = await seedVideo();
    await pool.query(`UPDATE videos SET youtube_id = 'AAAAAAAAAAA' WHERE id = $1`, [onSite]);
    const r = await call('/studio/imports', {
      method: 'POST',
      token: admin,
      body: {
        urls: 'https://youtu.be/BBBBBBBBBBB\nhttps://www.youtube.com/watch?v=BBBBBBBBBBB\nnot a link\nhttps://youtu.be/AAAAAAAAAAA',
        tier: 'plus',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.queued.length, 1);
    assert.equal(r.data.queued[0].tier, 'plus');
    assert.deepEqual(
      r.data.skipped.map((s) => s.reason),
      ['Not a YouTube video link', 'You already have this'],
    );
    const again = await call('/studio/imports', {
      method: 'POST',
      token: admin,
      body: { urls: ['BBBBBBBBBBB'] },
    });
    assert.equal(again.data.skipped[0].reason, 'Already queued');
  });

  test('the helper claims a job, reports steps, and finishes; Studio sees it and whether the helper is on', async () => {
    await pool.query('TRUNCATE import_jobs, import_workers');
    await call('/studio/imports', {
      method: 'POST',
      token: admin,
      body: { urls: 'https://youtu.be/CCCCCCCCCCC' },
    });
    let list = (await call('/studio/imports', { token: admin })).data;
    assert.equal(list.helper, null);

    await heartbeat('test-pc');
    const job = await claimNext();
    assert.equal(job.youtubeId, 'CCCCCCCCCCC');
    assert.equal(await claimNext(), null, 'one job at a time');
    await reportStep(job.id, { step: 'Downloading video', title: 'A stream' });
    list = (await call('/studio/imports', { token: admin })).data;
    assert.equal(list.helper.online, true);
    assert.deepEqual(
      { status: list.jobs[0].status, step: list.jobs[0].step, title: list.jobs[0].title },
      { status: 'running', step: 'Downloading video', title: 'A stream' },
    );
    assert.equal((await call(`/studio/imports/${job.id}`, { method: 'DELETE', token: admin })).status, 409);

    await finishJob(job.id, { ok: false, error: 'yt-dlp: video unavailable' });
    list = (await call('/studio/imports', { token: admin })).data;
    assert.equal(list.jobs[0].status, 'failed');
    assert.match(list.jobs[0].error, /unavailable/);

    assert.equal(
      (await call(`/studio/imports/${job.id}/retry`, { method: 'POST', token: admin })).status,
      200,
    );
    const again = await claimNext();
    assert.equal(again.id, job.id);
    assert.equal(await requeueRunning(), 1, 'a stopped helper puts its job back');
    assert.equal((await call(`/studio/imports/${job.id}`, { method: 'DELETE', token: admin })).status, 200);
    assert.equal((await call('/studio/imports', { token: admin })).data.jobs.length, 0);
  });
});

describe('replacing a video file', () => {
  test('uploads straight to Cloudflare, swaps once ready, keeps chat, deletes the old file', async () => {
    const id = await videoWithStuff({ uid: 'uid_old' });
    assert.equal(
      (await call(`/studio/videos/${id}/replacement`, { method: 'POST', token: admin, body: { size: 1000 } }))
        .status,
      503,
      'needs Cloudflare keys on the server',
    );

    let state = { readyToStream: false, status: { state: 'inprogress', pctComplete: '40' } };
    stubCloudflare((url, opts) => {
      if (url.includes('direct_user=true'))
        return new Response(null, {
          status: 201,
          headers: { Location: 'https://upload.example/tus/abc', 'stream-media-id': 'uid_new' },
        });
      if ((opts.method || 'GET') === 'DELETE') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ result: { ...state, duration: 3600.4 } }), { status: 200 });
    });

    const start = await call(`/studio/videos/${id}/replacement`, {
      method: 'POST',
      token: admin,
      body: { size: 5_000_000_000, name: 'takeout.mp4' },
    });
    assert.deepEqual(start.data, { uploadUrl: 'https://upload.example/tus/abc', uid: 'uid_new' });
    assert.equal(cfCalls[0].headers['Upload-Length'], '5000000000');

    let check = await call(`/studio/videos/${id}/replacement`, { token: admin });
    assert.deepEqual(check.data, { state: 'inprogress', pct: 40 });
    assert.equal(
      (await pool.query('SELECT stream_uid FROM videos WHERE id = $1', [id])).rows[0].stream_uid,
      'uid_old',
    );

    state = { readyToStream: true, status: { state: 'ready' } };
    check = await call(`/studio/videos/${id}/replacement`, { token: admin });
    assert.deepEqual(check.data, { state: 'swapped' });
    const { rows } = await pool.query(
      'SELECT stream_uid, replacement_stream_uid, duration_s FROM videos WHERE id = $1',
      [id],
    );
    assert.deepEqual(rows[0], { stream_uid: 'uid_new', replacement_stream_uid: null, duration_s: 3600 });
    assert.ok(
      cfCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/uid_old')),
      'old file deleted',
    );
    assert.equal((await pool.query('SELECT 1 FROM chat_messages WHERE video_id = $1', [id])).rowCount, 1);
    assert.deepEqual((await call(`/studio/videos/${id}/replacement`, { token: admin })).data, {
      state: 'none',
    });
  });

  test('cancelling deletes the half-done upload', async () => {
    const id = await videoWithStuff({ uid: 'uid_keep' });
    stubCloudflare((url, opts) =>
      url.includes('direct_user=true')
        ? new Response(null, {
            status: 201,
            headers: { Location: 'https://u/x', 'stream-media-id': 'uid_draft' },
          })
        : new Response('{}', { status: opts.method === 'DELETE' ? 200 : 404 }),
    );
    await call(`/studio/videos/${id}/replacement`, { method: 'POST', token: admin, body: { size: 10 } });
    assert.equal(
      (await call(`/studio/videos/${id}/replacement`, { method: 'DELETE', token: admin })).status,
      200,
    );
    assert.ok(cfCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/uid_draft')));
    const { rows } = await pool.query('SELECT stream_uid, replacement_stream_uid FROM videos WHERE id = $1', [
      id,
    ]);
    assert.deepEqual(rows[0], { stream_uid: 'uid_keep', replacement_stream_uid: null });
  });
});

describe('adding from a file (no download; the helper fetches chat and comments)', () => {
  const upload = (body) => call('/studio/imports/file', { method: 'POST', token: admin, body });

  test('needs Cloudflare keys on the server', async () => {
    assert.equal((await upload({ video: 'FILEVIDEO01', size: 10 })).status, 503);
  });

  test('uploads, waits, then hands the helper a job with the file already on Cloudflare', async () => {
    await pool.query('TRUNCATE import_jobs');
    let n = 0;
    stubCloudflare((url, opts) => {
      if (url.includes('direct_user=true')) {
        n += 1;
        return new Response(null, {
          status: 201,
          headers: { Location: `https://upload.example/${n}`, 'stream-media-id': `uid_file_${n}` },
        });
      }
      return new Response('{}', { status: opts.method === 'DELETE' ? 200 : 404 });
    });
    assert.equal((await upload({ video: 'not a link', size: 10 })).status, 400);

    const first = await upload({
      video: 'https://youtu.be/FILEVIDEO01',
      size: 9_000_000_000,
      name: 'Debate.mp4',
      tier: 'plus',
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.uploadUrl, 'https://upload.example/1');
    assert.deepEqual(
      [first.data.job.status, first.data.job.streamUid, first.data.job.tier],
      ['uploading', 'uid_file_1', 'plus'],
    );
    assert.equal(await claimNext(), null, 'the helper waits until the upload finishes');

    // Picking the file again (say the upload was interrupted) starts over and deletes the half-done one.
    const again = await upload({ video: 'FILEVIDEO01', size: 9_000_000_000 });
    assert.equal(again.data.job.streamUid, 'uid_file_2');
    assert.ok(cfCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/uid_file_1')));

    const done = await call(`/studio/imports/${again.data.job.id}/uploaded`, {
      method: 'POST',
      token: admin,
    });
    assert.equal(done.data.job.status, 'queued');
    assert.equal(
      (await call(`/studio/imports/${again.data.job.id}/uploaded`, { method: 'POST', token: admin })).status,
      409,
    );
    const job = await claimNext();
    assert.equal(job.streamUid, 'uid_file_2', 'the helper gets the file id (and passes --stream-uid)');
    assert.equal((await upload({ video: 'FILEVIDEO01', size: 10 })).status, 409, 'already queued');
  });

  test('a video already on the site says so (use Replace video); cancelling deletes the uploaded file', async () => {
    stubCloudflare((url, opts) =>
      url.includes('direct_user=true')
        ? new Response(null, {
            status: 201,
            headers: { Location: 'https://u/x', 'stream-media-id': 'uid_cancel' },
          })
        : new Response('{}', { status: opts.method === 'DELETE' ? 200 : 404 }),
    );
    const onSite = await seedVideo();
    await pool.query(`UPDATE videos SET youtube_id = 'ONSITEFILE1' WHERE id = $1`, [onSite]);
    const dup = await upload({ video: 'ONSITEFILE1', size: 10 });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.videoId, onSite);

    const started = await upload({ video: 'CANCELFILE1', size: 10 });
    assert.equal(
      (await call(`/studio/imports/${started.data.job.id}`, { method: 'DELETE', token: admin })).status,
      200,
    );
    assert.ok(cfCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/uid_cancel')));
  });

  test('replacements finish in the background once Cloudflare is ready', async () => {
    const { finishReplacements } = await import('../src/replacements.js');
    const id = await videoWithStuff({ uid: 'uid_bg_old' });
    await pool.query(`UPDATE videos SET replacement_stream_uid = 'uid_bg_new' WHERE id = $1`, [id]);
    stubCloudflare((url, opts) =>
      (opts.method || 'GET') === 'DELETE'
        ? new Response('{}', { status: 200 })
        : new Response(
            JSON.stringify({ result: { readyToStream: true, status: { state: 'ready' }, duration: 100 } }),
            {
              status: 200,
            },
          ),
    );
    assert.ok((await finishReplacements()) >= 1);
    const { rows } = await pool.query('SELECT stream_uid FROM videos WHERE id = $1', [id]);
    assert.equal(rows[0].stream_uid, 'uid_bg_new');
  });
});
