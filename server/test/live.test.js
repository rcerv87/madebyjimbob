import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, client, signIn, pool } from './helpers.js';
import { tickLive } from '../src/live.js';

let call;
const realFetch = globalThis.fetch;
const IP = '203.0.113.7';
let hetzner; // fake Hetzner state
let owncast; // fake Owncast on the server's IP: null = not up yet

// Our own server goes through; Hetzner's API and the live server's Owncast are faked.
function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  const method = opts.method || 'GET';
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (u.hostname === 'api.hetzner.cloud') {
    hetzner.calls.push(`${method} ${u.pathname}`);
    if (method === 'POST' && u.pathname === '/v1/primary_ips')
      return json(201, { primary_ip: { id: 55, ip: IP } });
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
    return json(404, { error: { message: 'not faked' } });
  }
  if (u.hostname === IP) {
    if (!owncast) return Promise.reject(new Error('connect ECONNREFUSED'));
    if (u.pathname === '/api/status')
      return json(200, { online: owncast.online, lastConnectTime: '2026-10-01T12:00:00Z' });
    if (u.pathname.startsWith('/api/admin/config/')) {
      owncast.config.push(u.pathname.replace('/api/admin/config/', ''));
      return json(200, { success: true });
    }
    if (u.pathname === '/hls/stream.m3u8')
      return Promise.resolve(
        new Response('#EXTM3U\n', { headers: { 'content-type': 'application/x-mpegURL' } }),
      );
  }
  return realFetch(url, opts);
}

before(async () => {
  const { base } = await startServer();
  call = client(base);
  globalThis.fetch = fakeFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  process.env.HETZNER_API_TOKEN = '';
  await stopServer();
});
beforeEach(async () => {
  hetzner = { calls: [], created: [], servers: [] };
  owncast = null;
  process.env.HETZNER_API_TOKEN = 'test-token';
  await pool.query('DELETE FROM live_servers');
  await pool.query('DELETE FROM live_settings');
});

describe('Go Live (owned live, ADR-004)', () => {
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
    assert.match(spec.user_data, new RegExp(`-streamkey '${started.data.obs.streamKey}'`));

    // A second tap doesn't make a second server.
    await call('/studio/live/start', { method: 'POST', token: admin });
    assert.equal(hetzner.created.length, 1);

    // Owncast comes up: the next check sets the tested ladder and delay, and the server is ready.
    owncast = { online: false, config: [] };
    await tickLive();
    assert.deepEqual(owncast.config, ['video/streamoutputvariants', 'video/streamlatencylevel', 'name']);
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
