// Owned live (ADR-004): OBS streams to an Owncast server; the site asks it whether JimBob is live and passes its
// video along. Two ways to have a server:
//   - OWNCAST_URL set: a fixed server (Ruben's local Docker test).
//   - Go Live in Studio: a Hetzner server created for the stream and deleted afterward (needs HETZNER_API_TOKEN).
// Viewers get the video through /live/hls on this site for now; R2 delivery replaces that before big audiences.
import crypto from 'crypto';
import fs from 'fs';
import { r2Put, s3Request, s3List, presignGet } from '../live-recorder/r2put.mjs';
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
  findLiveImage,
  deleteOldImages,
  snapshotServer,
  getAction,
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

// The archive (ADR-010): Backblaze B2, private. Replays move here from R2 after LIVE_R2_RETAIN_DAYS.
export const b2 = () => {
  const { B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY } = process.env;
  if (!B2_ENDPOINT || !B2_BUCKET || !B2_KEY_ID || !B2_APPLICATION_KEY) return null;
  return {
    endpoint: B2_ENDPOINT.replace(/\/+$/, ''),
    bucket: B2_BUCKET,
    accessKey: B2_KEY_ID,
    secret: B2_APPLICATION_KEY,
  };
};
const RETAIN_DAYS = () => Number(process.env.LIVE_R2_RETAIN_DAYS || 14);
// Recordings' folder in the buckets: 'dvr' for the live site; local testing sets DVR_PREFIX so it never touches it.
const DVR = () => process.env.DVR_PREFIX || 'dvr';

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

// While live with the recorder on: where the whole stream so far can be rewound (MBJ-310).
async function withRewind(status, server = null) {
  if (!status.online) return status;
  const rec = await currentRecording();
  if (!rec?.live || (server && !fromServer(rec, server))) return status;
  const videoId = await liveVideo(rec).catch((err) =>
    logger.warn({ err }, 'could not create the live video'),
  );
  return {
    ...status,
    dvr: {
      url: recordingUrl(rec.id),
      startedAt: rec.startedAt,
      gapS: rec.gapS || 0,
      videoId: videoId ?? null,
      // The recorder publishes cacheable live playlists (MBJ-311).
      edge: Boolean(rec.edge),
    },
  };
}

// Every viewer asks every 10 s, so the answer is shared for 2 s (one lookup for everyone, not one each). At 1,000
// viewers that's ~100 requests a second; the 2026-10-03 load test saw p95 climb to 2.7 s without this.
const STATUS_TTL_MS = Number(process.env.LIVE_STATUS_TTL_MS ?? 2000); // 0 in tests
let shared = null; // { at, promise }

async function freshLiveStatus() {
  const base = await owncastBase();
  if (!base) return { online: false };
  return withRewind(await owncastStatus(base), fixedBase() ? null : await activeServer());
}

export function liveStatus() {
  if (!STATUS_TTL_MS) return freshLiveStatus();
  if (shared && Date.now() - shared.at < STATUS_TTL_MS) return shared.promise;
  const promise = freshLiveStatus();
  shared = { at: Date.now(), promise };
  // A failed lookup isn't shared.
  promise.catch(() => {
    if (shared?.promise === promise) shared = null;
  });
  return promise;
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
    s?.status === 'ready' && s.ip
      ? await withRewind(await owncastStatus(`http://${s.ip}:8080`), s)
      : { online: false };
  // While starting: has Owncast come up yet? (For Studio's step-by-step status.)
  const answering =
    s?.status === 'starting' && s.hetzner_id && s.ip
      ? !(await owncastStatus(`http://${s.ip}:8080`)).error
      : false;
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
          saving: s.status === 'stopping' && Boolean(s.snapshot_action_id),
          created: Boolean(s.hetzner_id),
          answering,
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

// From plain Ubuntu: install Docker, then start Owncast. From the saved image, Docker and the Owncast image are already
// there, so only the old containers and data are cleared (each stream starts fresh). With R2, the recorder (MBJ-310)
// runs next to Owncast and copies every piece of the stream to R2.
const INSTALL_DOCKER = 'package_update: true\npackages: [docker.io]\n';
const recorderFile = (name) =>
  fs.readFileSync(new URL(`../live-recorder/${name}`, import.meta.url)).toString('base64');
function recorderSetup(serverId) {
  const storage = r2();
  if (!storage) return { files: '', run: '' };
  const files = ['r2put.mjs', 'edge.mjs', 'recorder.mjs']
    .map((f) => `  - path: /opt/recorder/${f}\n    encoding: b64\n    content: ${recorderFile(f)}\n`)
    .join('');
  const archive = b2();
  const env = {
    R2_ENDPOINT: storage.endpoint,
    R2_ACCESS_KEY_ID: storage.accessKey,
    R2_SECRET_ACCESS_KEY: storage.secret,
    R2_BUCKET: storage.bucket,
    DVR_PREFIX: DVR(),
    LIVE_SERVER_ID: String(serverId ?? ''),
    // The recorder writes the archive copy to B2 as it records.
    ...(archive && {
      B2_ENDPOINT: archive.endpoint,
      B2_BUCKET: archive.bucket,
      B2_KEY_ID: archive.accessKey,
      B2_APPLICATION_KEY: archive.secret,
    }),
  };
  const envArgs = Object.entries(env)
    .map(([k, v]) => `-e ${k}='${v}'`)
    .join(' ');
  return {
    files: `write_files:\n${files}`,
    run: `  - docker run -d --name recorder --restart on-failure -v /opt/recorder:/app:ro -v /opt/owncast/hls:/hls:ro ${envArgs} node:22-alpine sh -c "apk add --no-cache ffmpeg >/dev/null 2>&1; exec node /app/recorder.mjs"\n`,
  };
}
const cloudInit = (settings, fromImage, serverId) => {
  const recorder = recorderSetup(serverId);
  return `#cloud-config
${fromImage ? '' : INSTALL_DOCKER}${recorder.files}runcmd:
  - systemctl enable --now docker
  - docker rm -f owncast recorder || true
  - rm -rf /opt/owncast
  - docker run -d --name owncast --restart on-failure -p 8080:8080 -p 1935:1935 -v /opt/owncast:/app/data owncast/owncast:latest -adminpassword '${settings.admin_password}'
${recorder.run}`;
};

// ---------- recordings (MBJ-310) ----------

// The newest recording, from dvr/current.json in R2: { id, startedAt, live, endedAt?, durationS? } or null.
// A failed read (R2 busy or rate-limited) falls back to the last good answer for up to 2 minutes, so viewers don't
// lose the chat and rewind controls over one hiccup.
let lastRecording = { at: 0, value: null };
export async function currentRecording() {
  const storage = r2();
  if (!storage) return null;
  try {
    const res = await fetch(`${storage.publicUrl}/${DVR()}/current.json?t=${Date.now()}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`R2 answered ${res.status}`);
    const value = await res.json();
    lastRecording = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.debug({ err }, 'reading the current recording failed');
    return Date.now() - lastRecording.at < 120_000 ? lastRecording.value : null;
  }
}

export const recordingUrl = (id) => `${r2().publicUrl}/${DVR()}/${id}/master.m3u8`;

const etDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

// The video for a recording: made as soon as the stream starts (so live chat has somewhere to live and the stream
// shows in the library), with no length until it ends. Returns its id.
export async function liveVideo(recording) {
  const found = await pool.query('SELECT id, duration_s FROM videos WHERE live_recording_id = $1', [
    recording.id,
  ]);
  if (found.rows[0]) {
    // OBS reconnected after the stream seemed over: it's live again until the recording ends for good.
    if (recording.live && found.rows[0].duration_s)
      await pool.query('UPDATE videos SET duration_s = NULL WHERE id = $1', [found.rows[0].id]);
    return found.rows[0].id;
  }
  const { rows } = await pool.query(
    `INSERT INTO videos (title, kind, published_at, hls_url, live_recording_id)
     VALUES ($1, 'live', $2, $3, $4)
     ON CONFLICT (live_recording_id) DO UPDATE SET live_recording_id = EXCLUDED.live_recording_id RETURNING id`,
    [
      `Live stream · ${etDate(recording.startedAt)}`,
      recording.startedAt,
      recordingUrl(recording.id),
      recording.id,
    ],
  );
  return rows[0].id;
}

// A finished recording: its video gets its length and becomes a replay (once). Returns the id, or null if done before.
export async function saveReplay(recording) {
  if (!recording?.id || recording.live) return null;
  await liveVideo(recording);
  const { rows } = await pool.query(
    `UPDATE videos SET duration_s = $2 WHERE live_recording_id = $1 AND duration_s IS DISTINCT FROM $2 RETURNING id`,
    [recording.id, recording.durationS || 1],
  );
  if (rows[0]) logger.info({ videoId: rows[0].id, recording: recording.id }, 'live replay saved');
  return rows[0]?.id ?? null;
}

const getText = (url) =>
  fetch(url, { signal: AbortSignal.timeout(5000) })
    .then((res) => (res.ok ? res.text() : ''))
    .catch(() => '');

// End stream while OBS is still sending: close the recording's playlists here (the recorder goes away with the
// server), then save the replay.
// Only the running server's recording counts (the bucket holds older ones). The recorder tags it with its server; older
// recordings without a tag count if they started after the server did.
const fromServer = (rec, server) =>
  Boolean(rec?.id) &&
  (rec.server ? rec.server === String(server.id) : new Date(rec.startedAt) >= new Date(server.created_at));

export async function finishRecording(server) {
  const storage = r2();
  const rec = await currentRecording();
  if (!storage || !fromServer(rec, server)) return null;
  if (rec.live) {
    const master = await getText(`${storage.publicUrl}/${DVR()}/${rec.id}/master.m3u8`);
    let durationS = 0;
    const lists = [
      ...[...master.matchAll(/^(\d+)\/index\.m3u8$/gm)].map((m) => m[1]),
      ...(master.includes('URI="audio/index.m3u8"') ? ['audio'] : []),
    ];
    for (const n of lists) {
      const key = `${DVR()}/${rec.id}/${n}/index.m3u8`;
      const list = await getText(`${storage.publicUrl}/${key}?t=${Date.now()}`);
      if (!list) continue;
      const total = [...list.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((sum, m) => sum + Number(m[1]), 0);
      durationS = Math.max(durationS, total);
      if (!list.includes('#EXT-X-ENDLIST'))
        await r2Put(storage, key, `${list.trimEnd()}\n#EXT-X-ENDLIST\n`, 'application/vnd.apple.mpegurl');
    }
    Object.assign(rec, { live: false, endedAt: new Date().toISOString(), durationS: Math.round(durationS) });
    await r2Put(storage, `${DVR()}/current.json`, JSON.stringify(rec), 'application/json');
  }
  return saveReplay(rec);
}

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
    `INSERT INTO live_servers (server_type, ip, started_by, admin_password) VALUES ($1, $2, $3, $4) RETURNING *`,
    [SERVER_TYPE, ip.ip, userId, crypto.randomBytes(18).toString('base64url')],
  );
  const row = rows[0];
  try {
    const image = await findLiveImage().catch(() => null);
    const server = await createServer({
      name: `mbj-live-${row.id}`,
      server_type: SERVER_TYPE,
      image: image ? String(image.id) : 'ubuntu-24.04',
      location: LOCATION,
      user_data: cloudInit(forServer(settings, row), Boolean(image), row.id),
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
  if (s.ready_at)
    await finishRecording(s).catch((err) => logger.warn({ err }, 'could not finish the recording'));
  // No saved image yet and this server got fully set up: save one first (a couple of minutes); the live job deletes
  // the server when the snapshot is done. Viewers already see the stream as ended.
  if (
    s.hetzner_id &&
    s.ready_at &&
    reason !== 'failed' &&
    !(await findLiveImage().catch(() => ({ id: 0 })))
  ) {
    try {
      const action = await snapshotServer(s.hetzner_id);
      await pool.query('UPDATE live_servers SET snapshot_action_id = $2, ended_at = now() WHERE id = $1', [
        s.id,
        action.id,
      ]);
      logger.info({ liveServer: s.id }, 'saving live server image before deleting it');
      return s;
    } catch (err) {
      logger.warn({ err }, 'could not save live server image; deleting anyway');
    }
  }
  if (s.hetzner_id) await deleteServer(s.hetzner_id);
  await pool.query(`UPDATE live_servers SET status = 'stopped', ended_at = now() WHERE id = $1`, [s.id]);
  logger.info({ liveServer: s.id, reason }, 'live server deleted');
  return s;
}

const adminAuth = (settings) => `Basic ${Buffer.from(`admin:${settings.admin_password}`).toString('base64')}`;

// Owncast came up: set the tested quality ladder, lowest delay, and R2. The real stream key goes last, so OBS can't
// connect (and start a stream that the later settings would restart) until everything is in place.
// The settings for one server: its own Owncast admin password (older rows fall back to the shared one).
const forServer = (settings, server) => ({
  ...settings,
  admin_password: server?.admin_password || settings.admin_password,
});

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
let oldImagesGone = false;

export async function tickLive() {
  if (!hetznerConfigured()) return;
  const s = await activeServer();
  if (s?.status === 'starting') {
    const base = `http://${s.ip}:8080`;
    const status = await owncastStatus(base);
    if (!status.error) {
      try {
        const settings = forServer(await liveSettings(), s);
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
  } else if (s?.status === 'stopping' && s.snapshot_action_id) {
    // Waiting for the image to save; delete once it's done, failed, or 20 minutes after End stream.
    const action = await getAction(s.snapshot_action_id).catch(() => ({ status: 'error' }));
    if (action.status !== 'running' || hoursBetween(s.ended_at || s.created_at) * 60 > 20) {
      if (s.hetzner_id) await deleteServer(s.hetzner_id);
      await pool.query(`UPDATE live_servers SET status = 'stopped', ended_at = now() WHERE id = $1`, [s.id]);
      logger.info(
        { liveServer: s.id, snapshot: action.status },
        'live server deleted after saving its image',
      );
    }
  } else if (s?.status === 'ready') {
    const base = `http://${s.ip}:8080`;
    const settings = forServer(await liveSettings(), s);
    if (!(await owncastConfigOk(base, settings))) {
      logger.warn({ liveServer: s.id }, 'owncast settings drifted; setting them again');
      await configureOwncast(base, settings).catch((err) => logger.warn({ err }, 'owncast setup failed'));
    }
    // The recorder closed a recording on its own (OBS stopped): it becomes a video.
    const rec = await currentRecording();
    if (fromServer(rec, s) && !rec.live)
      await saveReplay(rec).catch((err) => logger.warn({ err }, 'could not save the replay'));
    const status = await owncastStatus(base);
    if (status.online)
      await pool.query('UPDATE live_servers SET last_online_at = now() WHERE id = $1', [s.id]);
    const quietSince = status.online ? null : s.last_online_at || s.ready_at;
    if (hoursBetween(s.created_at) >= CAP_HOURS) await endLive('cap');
    else if (quietSince && hoursBetween(quietSince) * 60 >= IDLE_MINUTES) await endLive('idle');
  }
  // Saved images from before v2 are deleted once (they'd start old programs at boot).
  if (!oldImagesGone)
    oldImagesGone = await deleteOldImages()
      .then(() => true)
      .catch(() => false);
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
      // With a recorder that publishes them, each quality plays from its cacheable copy (MBJ-311); else Owncast's own.
      const edge = (await liveStatus().catch(() => null))?.dvr?.edge;
      const list = text.replace(/^\S*?(\d+)\/stream\.m3u8$/gm, (_, n) =>
        edge ? `${storage.publicUrl}/${DVR()}/live/${n}.m3u8` : `${storage.publicUrl}/hls/${n}/stream.m3u8`,
      );
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

// ---------- the archive (MBJ-310, ADR-010) ----------

const TYPES = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  jpg: 'image/jpeg',
  json: 'application/json',
};
const typeOf = (key) => TYPES[key.split('.').pop()] || 'application/octet-stream';

// Replays older than LIVE_R2_RETAIN_DAYS: make sure every file is in B2 (copying any the recorder didn't write there,
// e.g. replays from before B2), switch the video to play from B2, then delete it from R2. Returns how many moved.
export async function archiveReplays() {
  const storage = r2();
  const archive = b2();
  if (!storage || !archive) return 0;
  const { rows } = await pool.query(
    `SELECT id, live_recording_id FROM videos
      WHERE live_recording_id IS NOT NULL AND duration_s IS NOT NULL AND hls_url LIKE $1
        AND published_at < now() - make_interval(days => $2)
      ORDER BY id LIMIT 5`,
    [`${storage.publicUrl}/%`, RETAIN_DAYS()],
  );
  let moved = 0;
  for (const v of rows) {
    const prefix = `${DVR()}/${v.live_recording_id}/`;
    try {
      const inR2 = await s3List(storage, prefix);
      const inB2 = new Set(await s3List(archive, prefix));
      for (const key of inR2.filter((k) => !inB2.has(k))) {
        const body = Buffer.from(await (await s3Request(storage, 'GET', key)).arrayBuffer());
        await r2Put(
          archive,
          key,
          body,
          typeOf(key),
          key.endsWith('.ts') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      }
      const nowInB2 = new Set(await s3List(archive, prefix));
      const missing = inR2.filter((k) => !nowInB2.has(k));
      if (missing.length || !nowInB2.has(`${prefix}master.m3u8`)) {
        logger.warn({ videoId: v.id, missing: missing.length }, 'replay not fully in B2; leaving it in R2');
        continue;
      }
      await pool.query('UPDATE videos SET hls_url = $2 WHERE id = $1', [v.id, `/replay/${v.id}/master.m3u8`]);
      for (const key of inR2) await s3Request(storage, 'DELETE', key);
      moved += 1;
      logger.info({ videoId: v.id, files: inR2.length }, 'replay moved to the archive');
    } catch (err) {
      logger.warn({ err, videoId: v.id }, 'archiving a replay failed; will retry');
    }
  }
  return moved;
}

export function startArchiveJob() {
  if (!r2() || !b2()) return;
  const run = () => archiveReplays().catch((err) => logger.error({ err }, 'archive job failed'));
  setInterval(run, 30 * 60 * 1000).unref();
  setTimeout(run, 60 * 1000).unref();
}

// A replay's file from the archive. Playlists come through here with every video piece as a short-lived signed B2
// link (the bucket is private); other files redirect to a signed link. Returns { status, type?, body?, redirect? }.
export async function archiveFile(recordingId, rest) {
  const archive = b2();
  if (!archive || !/^[\w./-]+$/.test(rest) || rest.includes('..')) return { status: 404 };
  const key = `${DVR()}/${recordingId}/${rest}`;
  if (!rest.endsWith('.m3u8')) return { status: 302, redirect: presignGet(archive, key) };
  let text;
  try {
    text = await (await s3Request(archive, 'GET', key)).text();
  } catch {
    return { status: 404 };
  }
  if (text.includes('#EXTINF')) {
    const dir = rest.includes('/') ? rest.slice(0, rest.lastIndexOf('/') + 1) : '';
    text = text
      .split('\n')
      .map((line) =>
        line && !line.startsWith('#')
          ? presignGet(archive, `${DVR()}/${recordingId}/${dir}${line.trim()}`)
          : line,
      )
      .join('\n');
  }
  return { status: 200, type: 'application/vnd.apple.mpegurl', body: text };
}
