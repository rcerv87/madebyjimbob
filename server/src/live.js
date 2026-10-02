// Owned live (ADR-004): OBS streams to an Owncast server; the site asks it whether JimBob is live and passes its
// video along. Two ways to have a server:
//   - OWNCAST_URL set: a fixed server (Ruben's local Docker test).
//   - Go Live in Studio: a Hetzner server created for the stream and deleted afterward (needs HETZNER_API_TOKEN).
// Viewers get the video through /live/hls on this site for now; R2 delivery replaces that before big audiences.
import crypto from 'crypto';
import { pool } from './db.js';
import { logger } from './logger.js';
import {
  hetznerConfigured,
  createServer,
  deleteServer,
  listLiveServers,
  createPrimaryIp,
  getPrimaryIp,
  findLivePrimaryIp,
} from './hetzner.js';

export const SERVER_TYPE = process.env.LIVE_SERVER_TYPE || 'cpx31';
const LOCATION = process.env.LIVE_LOCATION || 'ash';
const HOURLY_USD = Number(process.env.LIVE_HOURLY_USD || 0.118);
const IDLE_MINUTES = 30; // after the stream ends (or never starts)
const CAP_HOURS = 8; // one server never runs longer than this
const READY_TIMEOUT_MINUTES = 10;

// The quality ladder and delay tested on 2026-10-01 (ADR-004): ~4 s behind, ~55–60% of 4 cores.
const VARIANTS = [
  {
    name: '1080p',
    videoPassthrough: true,
    audioPassthrough: true,
    framerate: 30,
    videoBitrate: 6000,
    cpuUsageLevel: 1,
  },
  {
    name: '720p',
    audioPassthrough: true,
    scaledWidth: 1280,
    videoBitrate: 2500,
    framerate: 30,
    cpuUsageLevel: 1,
  },
  {
    name: '360p',
    audioPassthrough: true,
    scaledWidth: 640,
    videoBitrate: 800,
    framerate: 30,
    cpuUsageLevel: 1,
  },
];

// Video to viewers from Cloudflare R2 (free to watch) when the R2_* settings are set; otherwise through this site.
const r2 = () => {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL)
    return null;
  return {
    enabled: true,
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKey: R2_ACCESS_KEY_ID,
    secret: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    region: 'auto',
    acl: '',
    forcePathStyle: true,
    publicUrl: R2_PUBLIC_URL.replace(/\/+$/, ''),
  };
};
export const r2Configured = () => Boolean(r2());

const fixedBase = () => (process.env.OWNCAST_URL || '').replace(/\/+$/, '');
export const liveConfigured = () => Boolean(fixedBase()) || hetznerConfigured();

// ---------- settings and servers ----------

export async function liveSettings() {
  const { rows } = await pool.query('SELECT * FROM live_settings WHERE id = 1');
  if (rows[0]) return rows[0];
  const key = crypto.randomBytes(12).toString('base64url');
  const pass = crypto.randomBytes(18).toString('base64url');
  const { rows: made } = await pool.query(
    `INSERT INTO live_settings (id, stream_key, admin_password) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING *`,
    [key, pass],
  );
  return made[0];
}

export async function activeServer() {
  const { rows } = await pool.query(
    `SELECT * FROM live_servers WHERE status IN ('starting', 'ready', 'stopping') ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] || null;
}

async function owncastBase() {
  if (fixedBase()) return fixedBase();
  const s = await activeServer();
  return s?.status === 'ready' && s.ip ? `http://${s.ip}:8080` : null;
}

// { online, viewers, title, startedAt } from Owncast, or { online: false, error } if it can't be reached.
async function owncastStatus(base) {
  try {
    const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Owncast answered ${res.status}`);
    const s = await res.json();
    return {
      online: Boolean(s.online),
      viewers: s.viewerCount ?? 0,
      title: s.streamTitle || '',
      startedAt: s.online ? s.lastConnectTime || null : null,
    };
  } catch (err) {
    logger.debug({ err }, 'owncast status failed');
    return { online: false, error: 'The streaming server isn’t answering.' };
  }
}

export async function liveStatus() {
  const base = await owncastBase();
  if (!base) return { online: false };
  return owncastStatus(base);
}

const hoursBetween = (a, b) => (new Date(b || Date.now()) - new Date(a)) / 3_600_000;

// This month's server hours and cost, for Studio.
export async function monthUsage() {
  const { rows } = await pool.query(
    `SELECT created_at, ended_at FROM live_servers WHERE created_at >= date_trunc('month', now())`,
  );
  const hours = rows.reduce((sum, r) => sum + Math.ceil(hoursBetween(r.created_at, r.ended_at)), 0);
  return { hours, costUsd: Math.round(hours * HOURLY_USD * 100) / 100 };
}

// What Studio shows: the server's state, the stream, and what OBS needs.
export async function studioLive() {
  if (!liveConfigured()) return { configured: false, online: false };
  const settings = await liveSettings();
  if (fixedBase()) {
    const status = await owncastStatus(fixedBase());
    return {
      configured: true,
      mode: 'fixed',
      server: { status: 'ready' },
      ...status,
      hls: status.online ? '/live/hls/stream.m3u8' : null,
      obs: {
        server: process.env.OWNCAST_RTMP_URL || 'rtmp://localhost:1935/live',
        streamKey: process.env.OWNCAST_STREAM_KEY || '',
      },
    };
  }
  const s = await activeServer();
  const status =
    s?.status === 'ready' && s.ip ? await owncastStatus(`http://${s.ip}:8080`) : { online: false };
  return {
    configured: true,
    mode: 'hetzner',
    server: s
      ? {
          status: s.status,
          createdAt: s.created_at,
          readyAt: s.ready_at,
          type: s.server_type,
          error: s.error,
        }
      : { status: 'off' },
    ...status,
    hls: status.online ? '/live/hls/stream.m3u8' : null,
    obs: { server: settings.ip ? `rtmp://${settings.ip}:1935/live` : null, streamKey: settings.stream_key },
    usage: await monthUsage(),
    limits: { idleMinutes: IDLE_MINUTES, capHours: CAP_HOURS, hourlyUsd: HOURLY_USD },
  };
}

// ---------- Go Live ----------

const cloudInit = (settings) => `#cloud-config
package_update: true
packages: [docker.io]
runcmd:
  - systemctl enable --now docker
  - docker run -d --name owncast --restart unless-stopped -p 8080:8080 -p 1935:1935 -v /opt/owncast:/app/data owncast/owncast:latest -adminpassword '${settings.admin_password}'
`;

async function ensurePrimaryIp(settings) {
  if (settings.primary_ip_id) {
    try {
      const ip = await getPrimaryIp(settings.primary_ip_id);
      return { id: ip.id, ip: ip.ip };
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  // One fixed IP for the project, even if another copy of the site (local testing) made it first.
  const ip = (await findLivePrimaryIp()) || (await createPrimaryIp(LOCATION));
  await pool.query('UPDATE live_settings SET primary_ip_id = $1, ip = $2, updated_at = now() WHERE id = 1', [
    ip.id,
    ip.ip,
  ]);
  return { id: ip.id, ip: ip.ip };
}

export async function goLive(userId) {
  if (!hetznerConfigured())
    throw Object.assign(new Error('Add HETZNER_API_TOKEN to turn on Go Live.'), { status: 503 });
  const running = await activeServer();
  if (running) return running;
  const settings = await liveSettings();
  const ip = await ensurePrimaryIp(settings);
  const { rows } = await pool.query(
    `INSERT INTO live_servers (server_type, ip, started_by) VALUES ($1, $2, $3) RETURNING *`,
    [SERVER_TYPE, ip.ip, userId],
  );
  const row = rows[0];
  try {
    const server = await createServer({
      name: `mbj-live-${row.id}`,
      server_type: SERVER_TYPE,
      image: 'ubuntu-24.04',
      location: LOCATION,
      user_data: cloudInit(settings),
      public_net: { enable_ipv4: true, enable_ipv6: false, ipv4: ip.id },
    });
    await pool.query('UPDATE live_servers SET hetzner_id = $2 WHERE id = $1', [row.id, server.id]);
    logger.info({ liveServer: row.id, hetznerId: server.id }, 'live server created');
  } catch (err) {
    await pool.query(
      `UPDATE live_servers SET status = 'failed', error = $2, stop_reason = 'failed', ended_at = now() WHERE id = $1`,
      [row.id, err.message],
    );
    throw err;
  }
  return activeServer();
}

export async function endLive(reason = 'ended') {
  const s = await activeServer();
  if (!s) return null;
  await pool.query(`UPDATE live_servers SET status = 'stopping', stop_reason = $2 WHERE id = $1`, [
    s.id,
    reason,
  ]);
  if (s.hetzner_id) await deleteServer(s.hetzner_id);
  await pool.query(`UPDATE live_servers SET status = 'stopped', ended_at = now() WHERE id = $1`, [s.id]);
  logger.info({ liveServer: s.id, reason }, 'live server deleted');
  return s;
}

const adminAuth = (settings) => `Basic ${Buffer.from(`admin:${settings.admin_password}`).toString('base64')}`;

// Owncast came up: set the tested quality ladder, lowest delay, and R2. The real stream key goes last, so OBS can't
// connect (and start a stream that the later settings would restart) until everything is in place.
async function configureOwncast(base, settings) {
  const auth = adminAuth(settings);
  const post = (path, value) =>
    fetch(`${base}/api/admin/config/${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
      signal: AbortSignal.timeout(5000),
    }).then((r) => {
      if (!r.ok) throw new Error(`Owncast setup failed (${path}: ${r.status})`);
    });
  await post('video/streamoutputvariants', VARIANTS);
  await post('video/streamlatencylevel', 0);
  await post('name', 'MADEbyJIMBOB');
  const storage = r2();
  if (storage) {
    const { publicUrl, ...config } = storage;
    await post('s3', { ...config, servingEndpoint: publicUrl });
  }
  await post('streamkeys', [{ key: settings.stream_key, comment: 'MADEbyJIMBOB' }]);
}

// Did the settings stick? Owncast still starting up can write its defaults over them.
async function owncastConfigOk(base, settings) {
  try {
    const res = await fetch(`${base}/api/admin/serverconfig`, {
      headers: { Authorization: adminAuth(settings) },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const c = await res.json();
    return (
      c.videoSettings?.videoQualityVariants?.length === VARIANTS.length &&
      c.videoSettings?.latencyLevel === 0 &&
      (!r2() || c.s3?.enabled === true) &&
      (c.streamKeys || []).some((k) => k.key === settings.stream_key)
    );
  } catch {
    return false;
  }
}

// Every 15 seconds: finish starting servers, keep their settings right, delete idle or over-cap ones, and remove any
// stray live server.
export async function tickLive() {
  if (!hetznerConfigured()) return;
  const s = await activeServer();
  if (s?.status === 'starting') {
    const base = `http://${s.ip}:8080`;
    const status = await owncastStatus(base);
    if (!status.error) {
      try {
        const settings = await liveSettings();
        await configureOwncast(base, settings);
        // Ready only once the settings read back correctly; otherwise the next check sets them again.
        if (await owncastConfigOk(base, settings))
          await pool.query(`UPDATE live_servers SET status = 'ready', ready_at = now() WHERE id = $1`, [
            s.id,
          ]);
      } catch (err) {
        logger.warn({ err }, 'owncast setup failed; retrying');
      }
    } else if (hoursBetween(s.created_at) * 60 > READY_TIMEOUT_MINUTES) {
      await pool.query(`UPDATE live_servers SET error = 'The server didn’t start in time.' WHERE id = $1`, [
        s.id,
      ]);
      await endLive('failed');
      await pool.query(`UPDATE live_servers SET status = 'failed' WHERE id = $1`, [s.id]);
    }
  } else if (s?.status === 'ready') {
    const base = `http://${s.ip}:8080`;
    const settings = await liveSettings();
    if (!(await owncastConfigOk(base, settings))) {
      logger.warn({ liveServer: s.id }, 'owncast settings drifted; setting them again');
      await configureOwncast(base, settings).catch((err) => logger.warn({ err }, 'owncast setup failed'));
    }
    const status = await owncastStatus(base);
    if (status.online)
      await pool.query('UPDATE live_servers SET last_online_at = now() WHERE id = $1', [s.id]);
    const quietSince = status.online ? null : s.last_online_at || s.ready_at;
    if (hoursBetween(s.created_at) >= CAP_HOURS) await endLive('cap');
    else if (quietSince && hoursBetween(quietSince) * 60 >= IDLE_MINUTES) await endLive('idle');
  }
  // Anything labeled as a live server that the site doesn't know about gets deleted.
  const current = await activeServer();
  if (current && !current.hetzner_id) return; // Go Live is creating it right now
  for (const server of await listLiveServers()) {
    if (server.id !== Number(current?.hetzner_id)) {
      logger.warn({ hetznerId: server.id }, 'deleting stray live server');
      await deleteServer(server.id);
    }
  }
}

export function startLiveJob() {
  if (!hetznerConfigured()) return;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    await tickLive().catch((err) => logger.error({ err }, 'live job failed'));
    busy = false;
  };
  setInterval(run, 15 * 1000).unref();
  run();
}

// Passes Owncast's video playlists and segments through (/live/hls/...). Fine for small audiences; viewers get
// these from R2 before launch.
export async function proxyHls(req, res) {
  const base = await owncastBase();
  if (!base) return res.status(404).end();
  const rest = req.params[0] || '';
  if (!/^[\w./-]+$/.test(rest) || rest.includes('..')) return res.status(400).end();
  const storage = r2();
  try {
    const up = await fetch(`${base}/hls/${rest}`, { signal: AbortSignal.timeout(10000) });
    // With R2, only this small list of qualities comes from here; each quality's playlist and video come from R2.
    const text = storage && rest === 'stream.m3u8' && up.ok ? await up.text() : null;
    // Only when Owncast is really uploading there; otherwise R2 could still hold an old, finished stream.
    if (text && text.includes('/hls/0/stream.m3u8') && /^https?:\/\//m.test(text)) {
      const list = text.replace(/^\S*?(\d+)\/stream\.m3u8$/gm, `${storage.publicUrl}/hls/$1/stream.m3u8`);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache');
      return res.send(list);
    }
    res.status(up.status);
    res.set('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
    res.set('Cache-Control', rest.endsWith('.m3u8') ? 'no-cache' : 'public, max-age=60');
    res.send(text ?? Buffer.from(await up.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
}
