import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, pool } from './helpers.js';

let site;
let videoId;
let playlistId;
before(async () => {
  const { base } = await startServer();
  site = base.replace(/\/api$/, '');
  const { rows } = await pool.query(
    `INSERT INTO videos (youtube_id, stream_uid, title, description, duration_s, kind)
     VALUES ('pg-1', 'abc123', 'Evolution <Debate> & "More"', $1, 12302, 'live') RETURNING id`,
    ['A long   debate about evolution with callers.\nPart two soon. ' + 'x'.repeat(400)],
  );
  videoId = rows[0].id;
  const pl = await pool.query(
    `INSERT INTO playlists (source, title) VALUES ('native', 'Debates') RETURNING id`,
  );
  playlistId = pl.rows[0].id;
  await pool.query(`INSERT INTO playlist_items (playlist_id, position, video_id) VALUES ($1, 0, $2)`, [
    playlistId,
    videoId,
  ]);
});
after(stopServer);

const get = async (path, headers = {}) => {
  const res = await fetch(site + path, { headers, redirect: 'manual' });
  return { status: res.status, html: await res.text(), headers: res.headers };
};
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];

test('a video page carries its own title, description, image, and URL for link previews', async () => {
  const r = await get(`/watch/${videoId}?t=90`);
  assert.equal(r.status, 200);
  assert.match(r.html, /<title>Evolution &lt;Debate&gt; &amp; &quot;More&quot; · MADEbyJIMBOB<\/title>/);
  assert.equal(meta(r.html, 'property', 'og:type'), 'video.other');
  assert.match(
    meta(r.html, 'name', 'description'),
    /^A long debate about evolution with callers\. Part two soon\./,
  );
  assert.ok(meta(r.html, 'name', 'description').length <= 200);
  assert.match(meta(r.html, 'property', 'og:image'), /abc123\/thumbnails\/thumbnail\.jpg.*height=720/);
  assert.equal(meta(r.html, 'property', 'og:url'), `${site}/watch/${videoId}?t=90`);
  assert.equal(meta(r.html, 'property', 'video:duration'), '12302');
  assert.equal(meta(r.html, 'name', 'twitter:card'), 'summary_large_image');
});

test('section and playlist pages get their own titles; images are absolute', async () => {
  const shop = await get('/shop');
  assert.match(shop.html, /<title>Shop · MADEbyJIMBOB<\/title>/);
  assert.equal(meta(shop.html, 'property', 'og:image'), `${site}/brand/header-art.jpg`);
  const live = await get('/live');
  assert.equal(live.status, 200);
  assert.match(live.html, /<title>JimBob live · MADEbyJIMBOB<\/title>/);
  const pl = await get(`/playlist/${playlistId}`);
  assert.match(pl.html, /<title>Debates · MADEbyJIMBOB<\/title>/);
  assert.match(meta(pl.html, 'property', 'og:image'), /abc123/);
  const home = await get('/');
  assert.match(home.html, /<title>MADEbyJIMBOB<\/title>/);
});

test('unknown pages and missing videos are real 404s', async () => {
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/watch/999999')).status, 404);
  assert.equal((await get('/playlist/999999')).status, 404);
  assert.match((await get('/nope')).html, /Page not found · MADEbyJIMBOB/);
});

test('noindex everywhere until ALLOW_INDEXING=true; Studio always', async () => {
  const r = await get('/');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.equal(meta(r.html, 'name', 'robots'), 'noindex');
  process.env.ALLOW_INDEXING = 'true';
  try {
    const open = await get('/');
    assert.equal(open.headers.get('x-robots-tag'), null);
    assert.equal(meta(open.html, 'name', 'robots'), undefined);
    assert.equal((await get('/studio')).headers.get('x-robots-tag'), 'noindex');
  } finally {
    delete process.env.ALLOW_INDEXING;
  }
});

test('https URLs behind the proxy, and robots.txt', async () => {
  const r = await get('/shop', { 'X-Forwarded-Proto': 'https' });
  assert.match(meta(r.html, 'property', 'og:url'), /^https:\/\//);
  const robots = await get('/robots.txt');
  assert.match(robots.html, /Disallow: \/studio/);
});

test('hashed assets are cached for a year; the service worker is always re-checked', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.resolve('..', 'web', 'dist', 'assets');
  if (!fs.existsSync(dir)) return; // web not built in this environment
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.js'));
  const asset = await fetch(`${site}/assets/${file}`);
  assert.match(asset.headers.get('cache-control'), /max-age=31536000.*immutable/);
  const sw = await fetch(`${site}/sw.js`);
  if (sw.status === 200) assert.equal(sw.headers.get('cache-control'), 'no-cache');
});

test('a "$" in a title or description shows exactly as typed', async () => {
  const { rows } = await pool.query(
    `INSERT INTO videos (youtube_id, title, description) VALUES ('pg-dollar', $1, $2) RETURNING id`,
    ["Win $$$ & $' $& $1", 'Costs $5, $$ and $` too'],
  );
  const r = await get(`/watch/${rows[0].id}`);
  assert.ok(r.html.includes("<title>Win $$$ &amp; $' $&amp; $1 · MADEbyJIMBOB</title>"), r.html);
  assert.equal(meta(r.html, 'property', 'og:title'), "Win $$$ &amp; $' $&amp; $1 · MADEbyJIMBOB");
  assert.equal(meta(r.html, 'name', 'description'), 'Costs $5, $$ and $` too');
  assert.equal((r.html.match(/<\/head>/g) || []).length, 1);
});

test('once SITE_URL is set, pages on the onrender.com address move there; the API still answers', async () => {
  const http = await import('node:http');
  const get = (path, host, method = 'GET') =>
    new Promise((resolve, reject) => {
      const u = new URL(site + path);
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { host } },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode, location: res.headers.location });
        },
      );
      req.on('error', reject);
      req.end();
    });
  assert.equal(
    (await get('/live', 'madebyjimbob.onrender.com')).status,
    200,
    'nothing moves until SITE_URL is set',
  );
  process.env.SITE_URL = 'https://madebyjimbob.app';
  try {
    assert.deepEqual(await get('/watch/12?t=90', 'madebyjimbob.onrender.com'), {
      status: 301,
      location: 'https://madebyjimbob.app/watch/12?t=90',
    });
    assert.equal(
      (await get('/api/health', 'madebyjimbob.onrender.com')).status,
      200,
      'Render’s health check',
    );
    assert.equal((await get('/', 'madebyjimbob.app')).status, 200, 'the new address itself');
    assert.equal((await get('/', 'localhost')).status, 200, 'a developer’s machine');
  } finally {
    delete process.env.SITE_URL;
  }
});

test('the super chat and membership pages are real pages with their own previews', async () => {
  for (const [path, title] of [
    ['/superchat', 'Super chat JimBob'],
    ['/membership', 'Membership'],
    ['/membership/welcome', 'Welcome'],
  ]) {
    const res = await fetch(site + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), new RegExp(`<title>${title} · MADEbyJIMBOB</title>`), path);
  }
});
