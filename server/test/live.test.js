import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';
import { tickLive } from '../src/live.js';

let call;
const realFetch = globalThis.fetch;
const IP = '203.0.113.7';
let hetzner; // fake Hetzner state
let owncast; // fake Owncast on the server's IP: null = not up yet
let r2; // fake R2: objects by key
let b2; // fake B2: objects by key

// Our own server goes through; Hetzner's API and the live server's Owncast are faked.
function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  const method = opts.method || 'GET';
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (u.hostname === 'api.hetzner.cloud') {
    hetzner.calls.push(`${method} ${u.pathname}`);
    if (method === 'POST' && u.pathname === '/v1/primary_ips')
      return json(201, { primary_ip: { id: 55, ip: IP } });
    if (method === 'GET' && u.pathname === '/v1/primary_ips') return json(200, { primary_ips: [] });
    if (method === 'GET' && u.pathname === '/v1/primary_ips/55')
      return json(200, { primary_ip: { id: 55, ip: IP } });
    if (method === 'POST' && u.pathname === '/v1/servers') {
      const body = JSON.parse(opts.body);
      hetzner.created.push(body);
      const server = { id: 900 + hetzner.created.length, name: body.name };
      hetzner.servers.push(server);
      return json(201, { server });
    }
    if (method === 'GET' && u.pathname === '/v1/servers') return json(200, { servers: hetzner.servers });
    const del = u.pathname.match(/^\/v1\/servers\/(\d+)$/);
    if (method === 'DELETE' && del) {
      hetzner.servers = hetzner.servers.filter((s) => s.id !== Number(del[1]));
      return json(200, { action: {} });
    }
    if (method === 'GET' && u.pathname === '/v1/images') {
      if (!hetzner.imagesFaked) return json(404, { error: { message: 'not faked' } });
      return json(200, { images: hetzner.images });
    }
    const snap = u.pathname.match(/^\/v1\/servers\/(\d+)\/actions\/create_image$/);
    if (method === 'POST' && snap) {
      hetzner.snapshots.push(Number(snap[1]));
      return json(201, { action: { id: 77, status: 'running' } });
    }
    if (method === 'GET' && u.pathname === '/v1/actions/77')
      return json(200, { action: { id: 77, status: hetzner.action } });
    return json(404, { error: { message: 'not faked' } });
  }
  if (u.hostname === IP) {
    if (!owncast) return Promise.reject(new Error('connect ECONNREFUSED'));
    if (u.pathname === '/api/status')
      return json(200, { online: owncast.online, lastConnectTime: '2026-10-01T12:00:00Z' });
    if (u.pathname.startsWith('/api/admin/config/')) {
      const key = u.pathname.replace('/api/admin/config/', '');
      owncast.config.push(key);
      (owncast.values ||= {})[key] = JSON.parse(opts.body).value;
      return json(200, { success: true });
    }
    if (u.pathname === '/api/admin/serverconfig') {
      const v = owncast.values || {};
      return json(200, {
        videoSettings: {
          videoQualityVariants: v['video/streamoutputvariants'] || [{}],
          latencyLevel: v['video/streamlatencylevel'] ?? 2,
        },
        s3: v.s3 || { enabled: false },
        streamKeys: v.streamkeys || [{ key: 'abc123' }],
      });
    }
    if (u.pathname === '/hls/stream.m3u8')
      return Promise.resolve(
        new Response(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://acct.r2.cloudflarestorage.com/madebyjimbob-live/hls/0/stream.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\n1/stream.m3u8\n',
          { headers: { 'content-type': 'application/x-mpegURL' } },
        ),
      );
  }
  if (u.hostname === 'pub-test.r2.dev') {
    if (r2.fail) return Promise.resolve(new Response('', { status: 429 }));
    const body = r2.objects[u.pathname.slice(1)];
    return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : new Response(body));
  }
  // R2's and B2's S3 APIs: upload, read, list, delete.
  const store =
    u.hostname === 'acct.r2.cloudflarestorage.com'
      ? { objects: r2.objects, bucket: '/madebyjimbob-live' }
      : u.hostname === 's3.us-east-005.backblazeb2.com'
        ? { objects: b2.objects, bucket: '/Jimbob-beta' }
        : null;
  if (store) {
    if (u.pathname === store.bucket && u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') || '';
      const keys = Object.keys(store.objects).filter((k) => k.startsWith(prefix));
      const xml = `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`;
      return Promise.resolve(new Response(xml));
    }
    const key = decodeURIComponent(u.pathname.replace(`${store.bucket}/`, ''));
    if (method === 'PUT') {
      store.objects[key] = Buffer.isBuffer(opts.body) ? opts.body.toString() : String(opts.body);
      if (store.objects === r2.objects) r2.puts.push(key);
      return Promise.resolve(new Response('', { status: 200 }));
    }
    if (method === 'DELETE') {
      delete store.objects[key];
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (method === 'GET') {
      const body = store.objects[key];
      return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : new Response(body));
    }
  }
  return realFetch(url, opts);
}

let base;
before(async () => {
  ({ base } = await startServer());
  call = client(base);
  globalThis.fetch = fakeFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  process.env.HETZNER_API_TOKEN = '';
  await stopServer();
});
beforeEach(async () => {
  hetzner = { calls: [], created: [], servers: [], images: [], snapshots: [], action: 'running' };
  owncast = null;
  r2 = { objects: {}, puts: [] };
  b2 = { objects: {} };
  process.env.HETZNER_API_TOKEN = 'test-token';
  await pool.query('DELETE FROM live_servers');
  await pool.query('DELETE FROM live_settings');
});

describe('Go Live (owned live, ADR-004)', () => {
  test('old replays move from R2 to the B2 archive and play from it with signed links (MBJ-310)', async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'madebyjimbob-live',
      R2_PUBLIC_URL: 'https://pub-test.r2.dev/',
      B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
      B2_BUCKET: 'Jimbob-beta',
      B2_KEY_ID: '005aaaaaaaaaaaaaaaaaaaaaa',
      B2_APPLICATION_KEY: 'K005bbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    try {
      const { rows } = await pool.query(
        `INSERT INTO videos (title, kind, duration_s, published_at, hls_url, live_recording_id)
         VALUES ('Live stream · old', 'live', 12, now() - interval '20 days', $1, 'old1') RETURNING id`,
        ['https://pub-test.r2.dev/dvr/old1/master.m3u8'],
      );
      const id = rows[0].id;
      Object.assign(r2.objects, {
        'dvr/old1/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n0/index.m3u8\n',
        'dvr/old1/0/index.m3u8': '#EXTM3U\n#EXTINF:6.000,\n0.ts\n#EXTINF:6.000,\n1.ts\n#EXT-X-ENDLIST\n',
        'dvr/old1/0/0.ts': 'video0',
        'dvr/old1/0/1.ts': 'video1',
        'dvr/old1/thumb.jpg': 'jpg',
      });
      b2.objects['dvr/old1/0/0.ts'] = 'video0'; // the recorder already wrote some of it to B2
      // A recent replay stays in R2.
      await pool.query(
        `INSERT INTO videos (title, kind, duration_s, published_at, hls_url, live_recording_id)
         VALUES ('Live stream · new', 'live', 12, now(), 'https://pub-test.r2.dev/dvr/new1/master.m3u8', 'new1')`,
      );

      const { archiveReplays } = await import('../src/live.js');
      assert.equal(await archiveReplays(), 1);
      assert.deepEqual(Object.keys(b2.objects).sort(), [
        'dvr/old1/0/0.ts',
        'dvr/old1/0/1.ts',
        'dvr/old1/0/index.m3u8',
        'dvr/old1/master.m3u8',
        'dvr/old1/thumb.jpg',
      ]);
      assert.deepEqual(
        Object.keys(r2.objects).filter((k) => k.startsWith('dvr/old1/')),
        [],
        'deleted from R2',
      );

      const video = (await call(`/videos/${id}`)).data.video;
      assert.equal(video.hls, `/replay/${id}/master.m3u8`);
      assert.equal(video.thumbnail, `/replay/${id}/thumb.jpg`);
      const origin = new URL(base).origin;
      const list = await (await realFetch(`${origin}/replay/${id}/0/index.m3u8`)).text();
      assert.match(
        list,
        /^https:\/\/s3\.us-east-005\.backblazeb2\.com\/Jimbob-beta\/dvr\/old1\/0\/0\.ts\?.*X-Amz-Signature=/m,
      );
      assert.match(list, /#EXT-X-ENDLIST/);
      const master = await (await realFetch(`${origin}/replay/${id}/master.m3u8`)).text();
      assert.match(
        master,
        /^0\/index\.m3u8$/m,
        'the master stays relative, so qualities come through here too',
      );
      const thumb = await realFetch(`${origin}/replay/${id}/thumb.jpg`, { redirect: 'manual' });
      assert.equal(thumb.status, 302);
      assert.match(thumb.headers.get('location'), /X-Amz-Signature=/);
      assert.equal((await realFetch(`${origin}/replay/${id}/../secret`)).status, 404);
    } finally {
      process.env.R2_ACCOUNT_ID = '';
      process.env.B2_ENDPOINT = '';
    }
  });

  test('the recorder runs with R2; viewers can rewind; End stream closes the recording and saves the replay (MBJ-310)', async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'madebyjimbob-live',
      R2_PUBLIC_URL: 'https://pub-test.r2.dev/',
    });
    const list = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:6.000,\n0.ts\n#EXTINF:6.000,\n1.ts\n';
    Object.assign(r2.objects, {
      'dvr/current.json': JSON.stringify({
        id: 'rec1',
        startedAt: new Date(Date.now() + 1000).toISOString(),
        live: true,
      }),
      'dvr/rec1/master.m3u8':
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n0/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\n1/index.m3u8\n',
      'dvr/rec1/0/index.m3u8': list,
      'dvr/rec1/1/index.m3u8': list,
    });
    try {
      const admin = await signIn(call, 'test_admin');
      await call('/studio/live/start', { method: 'POST', token: admin });
      assert.match(hetzner.created[0].user_data, /path: \/opt\/recorder\/recorder\.mjs/);
      assert.match(hetzner.created[0].user_data, /--name recorder .*node \/app\/recorder\.mjs/);
      owncast = { online: true, config: [] };
      await tickLive();
      const live = (await call('/live')).data;
      assert.equal(live.dvr.url, 'https://pub-test.r2.dev/dvr/rec1/master.m3u8');
      // R2 busy or rate-limited for a moment: the last good recording is still given, so the chat doesn't vanish.
      r2.fail = true;
      assert.equal((await call('/live')).data.dvr.url, 'https://pub-test.r2.dev/dvr/rec1/master.m3u8');
      r2.fail = false;
      // The stream's video exists while live; chat sent now is live chat and stays with the replay.
      assert.ok(live.dvr.videoId);
      const viewer = await signIn(call, 'live_chatter');
      const sent = await call(`/videos/${live.dvr.videoId}/chat`, {
        method: 'POST',
        token: viewer,
        body: { text: 'hello from the live stream', offsetMs: 9000 },
      });
      assert.equal(sent.status, 200);
      assert.equal(sent.data.message.postedLive, true);

      await call('/studio/live/stop', { method: 'POST', token: admin });
      assert.match(r2.objects['dvr/rec1/0/index.m3u8'], /#EXT-X-ENDLIST\n$/);
      assert.match(r2.objects['dvr/rec1/1/index.m3u8'], /#EXT-X-ENDLIST\n$/);
      const rec = JSON.parse(r2.objects['dvr/current.json']);
      assert.equal(rec.live, false);
      assert.equal(rec.durationS, 12);
      const { rows } = await pool.query(
        `SELECT id, title, kind, duration_s, hls_url FROM videos WHERE live_recording_id = 'rec1'`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, String(live.dvr.videoId), 'the same video, now a replay');
      assert.equal(rows[0].kind, 'live');
      assert.equal(rows[0].duration_s, 12);
      assert.match(rows[0].title, /^Live stream · \w{3} \d{1,2}, \d{4}$/);
      const video = (await call(`/videos/${rows[0].id}`)).data.video;
      const chat = (await call(`/videos/${rows[0].id}/chat?from=0&to=120000`)).data.messages;
      assert.deepEqual(
        chat.map((m) => [m.body, m.offsetMs, m.postedLive]),
        [['hello from the live stream', 9000, true]],
      );
      assert.equal(video.hls, 'https://pub-test.r2.dev/dvr/rec1/master.m3u8');

      // OBS back within 10 minutes: the recorder reopens the same recording; the video is live again, then gets its
      // new length when it ends.
      const { liveVideo, saveReplay: save } = await import('../src/live.js');
      await liveVideo({ ...rec, live: true });
      const reopened = await pool.query('SELECT duration_s FROM videos WHERE id = $1', [rows[0].id]);
      assert.equal(reopened.rows[0].duration_s, null);
      assert.equal(await save({ ...rec, durationS: 40 }), rows[0].id);
      const longer = await pool.query('SELECT duration_s FROM videos WHERE id = $1', [rows[0].id]);
      assert.equal(longer.rows[0].duration_s, 40);
      rec.durationS = 40;

      // Saved once, even if the job sees the finished recording again.
      const { saveReplay } = await import('../src/live.js');
      assert.equal(await saveReplay(rec), null);
    } finally {
      process.env.R2_ACCOUNT_ID = '';
    }
  });

  test('with R2 set, Owncast uploads there and viewers get each quality from R2', async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'madebyjimbob-live',
      R2_PUBLIC_URL: 'https://pub-test.r2.dev/',
    });
    try {
      const admin = await signIn(call, 'test_admin');
      await call('/studio/live/start', { method: 'POST', token: admin });
      owncast = { online: true, config: [] };
      await tickLive();
      assert.ok(owncast.config.includes('s3'));
      const list = await (await realFetch(`${new URL(base).origin}/live/hls/stream.m3u8`)).text();
      assert.match(list, /^https:\/\/pub-test\.r2\.dev\/hls\/0\/stream\.m3u8$/m);
      assert.match(list, /^https:\/\/pub-test\.r2\.dev\/hls\/1\/stream\.m3u8$/m);
      assert.doesNotMatch(list, /cloudflarestorage/);
    } finally {
      process.env.R2_ACCOUNT_ID = '';
    }
  });

  test('rewind only uses the running server’s recording, never another one in the bucket', async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'madebyjimbob-live',
      R2_PUBLIC_URL: 'https://pub-test.r2.dev/',
    });
    try {
      const admin = await signIn(call, 'test_admin');
      await call('/studio/live/start', { method: 'POST', token: admin });
      assert.match(hetzner.created[0].user_data, /-e LIVE_SERVER_ID='\d+'/);
      assert.match(hetzner.created[0].user_data, /-e DVR_PREFIX='dvr'/);
      owncast = { online: true, config: [] };
      await tickLive();
      const serverId = (await pool.query('SELECT id FROM live_servers ORDER BY id DESC LIMIT 1')).rows[0].id;
      const at = new Date(Date.now() + 1000).toISOString();
      // Another server's (or a test's) recording, even a newer one: ignored.
      r2.objects['dvr/current.json'] = JSON.stringify({
        id: 'other',
        startedAt: at,
        live: true,
        server: '999999',
      });
      assert.equal((await call('/live')).data.dvr, undefined);
      r2.objects['dvr/current.json'] = JSON.stringify({
        id: 'mine',
        startedAt: at,
        live: true,
        server: String(serverId),
      });
      assert.equal((await call('/live')).data.dvr.url, 'https://pub-test.r2.dev/dvr/mine/master.m3u8');
      // Owncast's own playlists until the recorder says it publishes cacheable ones (MBJ-311); then those.
      const master = async () => (await realFetch(`${new URL(base).origin}/live/hls/stream.m3u8`)).text();
      assert.match(await master(), /^https:\/\/pub-test\.r2\.dev\/hls\/0\/stream\.m3u8$/m);
      r2.objects['dvr/current.json'] = JSON.stringify({
        id: 'mine',
        startedAt: at,
        live: true,
        edge: true,
        server: String(serverId),
      });
      const list = await master();
      assert.match(list, /^https:\/\/pub-test\.r2\.dev\/dvr\/live\/0\.m3u8$/m);
      assert.match(list, /^https:\/\/pub-test\.r2\.dev\/dvr\/live\/1\.m3u8$/m);
      assert.match(hetzner.created.at(-1).user_data, /path: \/opt\/recorder\/edge\.mjs/);
      await call('/studio/live/stop', { method: 'POST', token: admin });
    } finally {
      process.env.R2_ACCOUNT_ID = '';
    }
  });

  test('a finished recording left in the bucket from before this server is not saved as a video', async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'madebyjimbob-live',
      R2_PUBLIC_URL: 'https://pub-test.r2.dev/',
    });
    r2.objects['dvr/current.json'] = JSON.stringify({
      id: 'old-test',
      startedAt: '2026-01-01T00:00:00Z',
      live: false,
      durationS: 40,
    });
    try {
      const admin = await signIn(call, 'test_admin');
      await call('/studio/live/start', { method: 'POST', token: admin });
      owncast = { online: false, config: [] };
      await tickLive();
      await tickLive();
      await call('/studio/live/stop', { method: 'POST', token: admin });
      const { rows } = await pool.query(`SELECT 1 FROM videos WHERE live_recording_id = 'old-test'`);
      assert.equal(rows.length, 0);
    } finally {
      process.env.R2_ACCOUNT_ID = '';
    }
  });

  test('hidden when no streaming server is set up; only admins can start one', async () => {
    process.env.HETZNER_API_TOKEN = '';
    assert.deepEqual((await call('/live')).data, { configured: false, online: false });
    process.env.HETZNER_API_TOKEN = 'test-token';
    const viewer = await signIn(call, 'live_viewer');
    assert.equal((await call('/studio/live/start', { method: 'POST', token: viewer })).status, 403);
    assert.equal(hetzner.created.length, 0);
  });

  test('Go Live creates one server on the fixed IP, sets Owncast up, and End stream deletes it', async () => {
    const admin = await signIn(call, 'test_admin');
    const started = await call('/studio/live/start', { method: 'POST', token: admin });
    assert.equal(started.status, 200);
    assert.equal(started.data.server.status, 'starting');
    assert.equal(started.data.obs.server, `rtmp://${IP}:1935/live`);
    assert.match(started.data.obs.streamKey, /^[\w-]{16}$/);
    assert.equal(hetzner.created.length, 1);
    const spec = hetzner.created[0];
    assert.equal(spec.server_type, 'cpx31');
    assert.equal(spec.public_net.ipv4, 55);
    assert.doesNotMatch(spec.user_data, /-streamkey/, 'the real key is set only after the settings');
    assert.doesNotMatch(
      spec.user_data,
      /unless-stopped/,
      'nothing restarts by itself when a saved image boots',
    );
    // Its own Owncast password, so the previous Owncast in a saved image can't be mistaken for this one.
    const shared = (await pool.query('SELECT admin_password FROM live_settings')).rows[0].admin_password;
    const own = (await pool.query('SELECT admin_password FROM live_servers ORDER BY id DESC LIMIT 1')).rows[0]
      .admin_password;
    assert.ok(own && own !== shared);
    assert.match(spec.user_data, new RegExp(`-adminpassword '${own}'`));

    // A second tap doesn't make a second server.
    await call('/studio/live/start', { method: 'POST', token: admin });
    assert.equal(hetzner.created.length, 1);

    // Owncast comes up: the next check sets the tested ladder and delay, and the server is ready.
    owncast = { online: false, config: [] };
    await tickLive();
    assert.deepEqual(owncast.config, [
      'video/streamoutputvariants',
      'video/streamlatencylevel',
      'name',
      'streamkeys',
    ]);
    owncast.online = true;
    const live = (await call('/live')).data;
    assert.equal(live.online, true);
    assert.equal(live.hls, '/live/hls/stream.m3u8');
    assert.equal((await call('/studio/live', { token: admin })).data.server.status, 'ready');

    const ended = await call('/studio/live/stop', { method: 'POST', token: admin });
    assert.equal(ended.data.server.status, 'off');
    assert.deepEqual(hetzner.servers, []);
    assert.equal((await call('/live')).data.online, false);
  });

  test('settings that Owncast loses while starting are put back, and OBS’s key waits for them', async () => {
    const admin = await signIn(call, 'test_admin');
    await call('/studio/live/start', { method: 'POST', token: admin });
    owncast = { online: false, config: [] };
    await tickLive();
    assert.equal((await call('/studio/live', { token: admin })).data.server.status, 'ready');
    owncast.values = {}; // Owncast wrote its defaults over everything
    owncast.config = [];
    await tickLive();
    assert.ok(owncast.config.includes('video/streamoutputvariants'), 'set again');
    assert.equal(owncast.config.at(-1), 'streamkeys');
    await call('/studio/live/stop', { method: 'POST', token: admin });
  });

  test('the first End stream saves a faster-start image; later servers start from it', async () => {
    hetzner.imagesFaked = true;
    const admin = await signIn(call, 'test_admin');
    await call('/studio/live/start', { method: 'POST', token: admin });
    assert.equal(hetzner.created[0].image, 'ubuntu-24.04');
    assert.match(hetzner.created[0].user_data, /packages: \[docker\.io\]/);
    owncast = { online: false, config: [] };
    await tickLive();

    const ended = await call('/studio/live/stop', { method: 'POST', token: admin });
    assert.equal(ended.data.server.saving, true);
    assert.equal(hetzner.snapshots.length, 1);
    assert.equal(hetzner.servers.length, 1, 'kept until the image is saved');
    await tickLive();
    assert.equal(hetzner.servers.length, 1);
    hetzner.action = 'success';
    hetzner.images.push({ id: 31337, created: '2026-10-02T06:00:00Z' });
    await tickLive();
    assert.deepEqual(hetzner.servers, []);
    assert.equal((await call('/studio/live', { token: admin })).data.server.status, 'off');

    await call('/studio/live/start', { method: 'POST', token: admin });
    assert.equal(hetzner.created[1].image, '31337');
    assert.doesNotMatch(hetzner.created[1].user_data, /docker\.io/);
    await call('/studio/live/stop', { method: 'POST', token: admin });
    assert.equal(hetzner.snapshots.length, 1, 'only one image is ever saved');
  });

  test('a server idle for 30 minutes, past the hour cap, or unknown to the site is deleted', async () => {
    const admin = await signIn(call, 'test_admin');
    await call('/studio/live/start', { method: 'POST', token: admin });
    owncast = { online: false, config: [] };
    await tickLive();
    await pool.query(`UPDATE live_servers SET ready_at = now() - interval '31 minutes'`);
    await tickLive();
    assert.deepEqual(hetzner.servers, []);
    const { rows } = await pool.query('SELECT status, stop_reason FROM live_servers');
    assert.deepEqual(rows, [{ status: 'stopped', stop_reason: 'idle' }]);

    await call('/studio/live/start', { method: 'POST', token: admin });
    await tickLive();
    await pool.query(
      `UPDATE live_servers SET created_at = now() - interval '8 hours' WHERE status = 'ready'`,
    );
    owncast.online = true;
    await tickLive();
    assert.deepEqual(hetzner.servers, [], 'over the cap even while streaming');

    hetzner.servers.push({ id: 4242, name: 'forgotten' });
    await tickLive();
    assert.deepEqual(hetzner.servers, [], 'stray live server removed');
  });
});

describe('live status under load', () => {
  test('one lookup is shared by everyone asking within 2 seconds', async () => {
    process.env.LIVE_STATUS_TTL_MS = '2000';
    const { liveStatus } = await import(`../src/live.js?shared=${Date.now()}`);
    process.env.LIVE_STATUS_TTL_MS = '0';
    const [a, b] = [liveStatus(), liveStatus()];
    assert.equal(a, b, 'the same answer, not two lookups');
    await a.catch(() => {});
  });
});
