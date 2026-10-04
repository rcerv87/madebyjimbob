// The live recorder (MBJ-310) runs next to Owncast on the live server. Owncast keeps only the last few seconds of
// video; this copies every piece to R2 as it's made, joined into ~6-second segments, with a playlist that grows for
// the whole stream. Viewers rewind with it while live, and when the stream ends it becomes the replay.
//
// R2 layout:
//   dvr/current.json             { id, startedAt, live, gapS, endedAt?, durationS? } — the newest recording;
//                                gapS = time skipped while OBS was away, so players can place live on the recording
//   dvr/<id>/master.m3u8         the qualities
//   dvr/<id>/<n>/index.m3u8      one quality's playlist (EVENT; ENDLIST once finished)
//   dvr/<id>/<n>/<seq>.ts        the video
//   dvr/<id>/audio/…             the sound alone (Listen only / podcast mode), cut from the smallest quality
//   dvr/<id>/thumb.jpg           a frame for the replay's card
//   dvr/live/<n>.m3u8            what live viewers play: Owncast's playlists, cached 1 s, uploaded pieces only (edge.mjs)
// With B2 settings, the same files also go to B2 (the archive copy).
//
// Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, HLS_DIR (Owncast's data/hls, read-only).
import { spawn, spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { r2Put, s3Request } from './r2put.mjs';
import { edgePlaylist } from './edge.mjs';

const cfg = {
  endpoint: process.env.R2_ENDPOINT,
  accessKey: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
};
// The archive copy (ADR-010): when B2 settings are given, everything is written to B2 as well, straight from here.
const b2 = process.env.B2_ENDPOINT
  ? {
      endpoint: process.env.B2_ENDPOINT,
      accessKey: process.env.B2_KEY_ID,
      secret: process.env.B2_APPLICATION_KEY,
      bucket: process.env.B2_BUCKET,
    }
  : null;
const HLS = process.env.HLS_DIR || '/hls';
// Where recordings go in the bucket ('dvr' for the live site; tests use their own) and which live server this is, so
// the site only trusts the current server's recording.
const PREFIX = process.env.DVR_PREFIX || 'dvr';
const SERVER_ID = process.env.LIVE_SERVER_ID || '';
// Join Owncast's 1-second pieces into segments this long. Short, so the recording stays ~3-5 s behind live and a
// 10-second rewind lands in it (6-second segments kept it ~10-15 s behind).
const SEGMENT_S = 2;
const QUIET_S = 12; // no new video this long = the stream ended (for now)
const REJOIN_S = 120; // OBS back within this long after that (an internet blip): the same recording continues

// The log also goes to R2 (<prefix>/logs/<server>.log, the last 500 lines, every 30 s when it changed), so a problem on a
// live server can be read without logging in to it.
const logLines = [];
let logDirty = false;
const log = (...a) => {
  const line = [new Date().toISOString(), ...a].join(' ');
  console.log(line);
  logLines.push(line);
  if (logLines.length > 500) logLines.shift();
  logDirty = true;
};
// ffmpeg copies the sound out of each segment (no re-encoding). Without it there's simply no audio-only copy.
const DEBUG = Boolean(process.env.RECORDER_DEBUG);
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;

// The sound of one MPEG-TS segment, as MPEG-TS, keeping its timestamps so segments play back to back.
function audioOf(bytes) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-copyts', '-i', 'pipe:0', '-vn', '-c:a', 'copy'],
      ...['-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1'],
    ]);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}`)),
    );
    ff.stdin.on('error', () => {});
    ff.stdin.end(bytes);
  });
}
// One frame as a 640-wide JPEG, for the replay's thumbnail.
function frameOf(bytes) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', 'scale=640:-2'],
      ...['-q:v', '4', '-f', 'image2', 'pipe:1'],
    ]);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}`)),
    );
    ff.stdin.on('error', () => {});
    ff.stdin.end(bytes);
  });
}

// Writes one object to R2 (what viewers play) and, if set up, B2 (the archive). A B2 hiccup never stops recording.
// The B2 copies go through their own queue, so the R2 copy (what viewers play) never waits on them.
let b2Queue = Promise.resolve();
async function store(key, body, contentType, cacheControl = 'no-cache') {
  await r2Put(cfg, key, body, contentType, cacheControl);
  if (b2)
    b2Queue = b2Queue
      .then(() => r2Put(b2, key, body, contentType, cacheControl))
      .catch((err) => log('B2 copy failed', key, err.message));
}
// The first video timestamp in an MPEG-TS chunk, in seconds (or null). Segment lengths come from these: Owncast's own
// listed lengths are rounded, and on the passed-through quality they drift, which put qualities out of step.
export function firstPts(buf) {
  for (let i = 0; i + 188 <= buf.length; i += 188) {
    if (buf[i] !== 0x47 || !(buf[i + 1] & 0x40)) continue; // sync byte; start of a PES packet
    const adaptation = (buf[i + 3] >> 4) & 3;
    if (adaptation === 2) continue;
    let p = i + 4;
    if (adaptation === 3) p += 1 + buf[p];
    if (buf[p] !== 0 || buf[p + 1] !== 0 || buf[p + 2] !== 1) continue;
    const stream = buf[p + 3];
    if (stream < 0xe0 || stream > 0xef || !(buf[p + 7] & 0x80)) continue; // video, with a PTS
    const b = buf.subarray(p + 9, p + 14);
    return (
      (((b[0] >> 1) & 7) * 2 ** 30 + (b[1] << 22) + ((b[2] >> 1) << 15) + (b[3] << 7) + (b[4] >> 1)) / 90000
    );
  }
  return null;
}

const readText = (f) => fs.readFile(f, 'utf8').catch(() => null);

// Owncast's master playlist → [{ n, info }] (info = the #EXT-X-STREAM-INF line).
function parseMaster(text) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF')) return;
    const m = (lines[i + 1] || '').match(/(\d+)\/stream\.m3u8/);
    if (m) out.push({ n: Number(m[1]), info: line.trim() });
  });
  return out;
}

// One quality's playlist → [{ name, seq, prefix, dur }]. Owncast sometimes labels a stream's last piece far longer
// than it is, so lengths are capped at twice the playlist's stated piece length.
function parseMedia(text) {
  const out = [];
  let dur = 0;
  const target = Number(text.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]) || Infinity;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXTINF:')) dur = Math.min(parseFloat(line.slice(8)), target * 2);
    const m = line.trim().match(/^stream-(\w+)-(\d+)\.ts$/);
    // Owncast's "offline" clip (stream-offline-N.ts, shown while nobody streams) is never recorded: it made 8-second
    // replays at every server start.
    if (m && m[1] !== 'offline') out.push({ name: line.trim(), prefix: m[1], seq: Number(m[2]), dur });
  }
  return out;
}

let rec = null; // the recording in progress
// Pieces already handled, per quality: file name → modified time. Owncast can reuse names after OBS reconnects, so a
// piece is new when its name or its time is.
const handled = new Map();
const bootMs = Date.now();
const quiet = { since: Date.now() };
let last = null; // { rec, finishedAt }: the recording that ended most recently

function playlist(q, ended) {
  const target = Math.ceil(Math.max(SEGMENT_S, ...q.lines.map((l) => l.dur)));
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    // A discontinuity marks where OBS reconnected (the video's clock starts over there).
    ...q.lines.map((l) => `${l.disc ? '#EXT-X-DISCONTINUITY\n' : ''}#EXTINF:${l.dur.toFixed(3)},\n${l.file}`),
    ...(ended ? ['#EXT-X-ENDLIST'] : []),
    '',
  ].join('\n');
}

const putJson = (key, value) => r2Put(cfg, key, JSON.stringify(value), 'application/json');

async function start(prefix, variants) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  rec = {
    ...{ id, prefix, startedAt: new Date().toISOString(), qualities: new Map(), chain: Promise.resolve() },
    gapS: 0,
  };
  for (const v of variants)
    rec.qualities.set(v.n, {
      n: v.n,
      buf: [],
      bufDur: 0,
      seq: 0,
      lines: [],
      prefix,
      lastSeq: -1,
      disc: false,
      runStart: Date.now(),
    });
  // The sound alone comes from the smallest quality (lowest bandwidth).
  const bandwidth = (v) => Number(v.info.match(/BANDWIDTH=(\d+)/)?.[1]) || 0;
  const smallest = variants.reduce((a, b) => (bandwidth(b) < bandwidth(a) ? b : a));
  rec.audio = HAS_FFMPEG ? { from: smallest.n, lines: [] } : null;
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    ...(rec.audio
      ? [
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="listen",NAME="Listen only",DEFAULT=NO,AUTOSELECT=NO,URI="audio/index.m3u8"',
        ]
      : []),
    ...variants.flatMap((v) => [v.info, `${v.n}/index.m3u8`]),
    '',
  ];
  await store(`${PREFIX}/${id}/master.m3u8`, master.join('\n'), 'application/vnd.apple.mpegurl');
  await putJson(`${PREFIX}/current.json`, {
    server: SERVER_ID,
    id,
    startedAt: rec.startedAt,
    live: true,
    edge: edgeReady, // live viewers play dvr/live/<n>.m3u8 once it's published
    gapS: 0,
  });
  log('recording started', id);
}

// Upload what's buffered for one quality as the next segment, then the playlist.
function flush(r, q, ended = false) {
  if (!q.buf.length && !ended) return;
  const bytes = Buffer.concat(q.buf);
  const dur = q.bufDur;
  const disc = bytes.length ? q.disc : false;
  if (bytes.length) q.disc = false;
  q.buf = [];
  q.bufDur = 0;
  // Each quality uploads on its own chain (in order within it), so qualities don't wait on each other.
  queued(q, `quality ${q.n}`, dur);
  q.chain = (q.chain || Promise.resolve())
    .then(async () => {
      let piece = null;
      if (bytes.length) {
        const file = `${q.seq++}.ts`;
        await store(
          `${PREFIX}/${r.id}/${q.n}/${file}`,
          bytes,
          'video/mp2t',
          'public, max-age=31536000, immutable',
        );
        // The previous segment's true length is from its start to this one's (not across an OBS reconnect).
        const start = firstPts(bytes);
        const prev = q.lines.at(-1);
        if (prev && !disc && start !== null && q.lastStart !== null && q.lastStart !== undefined) {
          const real = start - q.lastStart;
          if (real > 0 && real < 60) prev.dur = real;
        }
        q.lastStart = start;
        q.lines.push({ file, dur, disc });
        piece = { bytes, file, dur, disc, start };
        // Thumbnail from the first quality: about 20 seconds in, and again at 5 minutes (past any intro screen).
        const recorded = q.lines.reduce((sum, l) => sum + l.dur, 0);
        if (HAS_FFMPEG && q === r.qualities.values().next().value) {
          const due = (!r.thumbAt && recorded >= 20) || (r.thumbAt && r.thumbAt < 300 && recorded >= 300);
          if (due) {
            r.thumbAt = recorded;
            const jpg = await frameOf(bytes).catch((err) => log('thumbnail failed', err.message));
            if (jpg?.length)
              await store(`${PREFIX}/${r.id}/thumb.jpg`, jpg, 'image/jpeg', 'public, max-age=300');
          }
        }
      }
      await store(`${PREFIX}/${r.id}/${q.n}/index.m3u8`, playlist(q, ended), 'application/vnd.apple.mpegurl');
      if (r.audio?.from === q.n) flushAudio(r, piece, ended);
    })
    .catch((err) => log('upload failed', err.message))
    .finally(() => queued(q, `quality ${q.n}`, -dur));
}

// The sound alone is cut (ffmpeg) and uploaded on its own chain, so its quality never waits on it. (2026-10-04: done in
// line, the smallest quality and the audio fell ~10 minutes behind on a busy server, and End stream lost that much.)
function flushAudio(r, piece, ended) {
  const a = r.audio;
  const dur = piece?.dur || 0;
  queued(a, 'audio', dur);
  a.chain = (a.chain || Promise.resolve())
    .then(async () => {
      const sound = piece && (await audioOf(piece.bytes).catch((err) => log('audio failed', err.message)));
      if (sound?.length) {
        const prev = a.lines.at(-1);
        if (
          prev &&
          !piece.disc &&
          piece.start !== null &&
          a.lastStart !== null &&
          a.lastStart !== undefined
        ) {
          const real = piece.start - a.lastStart;
          if (real > 0 && real < 60) prev.dur = real;
        }
        a.lastStart = piece.start;
        await store(
          `${PREFIX}/${r.id}/audio/${piece.file}`,
          sound,
          'video/mp2t',
          'public, max-age=31536000, immutable',
        );
        a.lines.push({ file: piece.file, dur: piece.dur, disc: piece.disc });
      }
      await store(`${PREFIX}/${r.id}/audio/index.m3u8`, playlist(a, ended), 'application/vnd.apple.mpegurl');
    })
    .catch((err) => log('audio upload failed', err.message))
    .finally(() => queued(a, 'audio', -dur));
}

// Seconds of video waiting in one chain. More than LAG_WARN_S is said in the log (and again once it catches up), so a
// slow server shows up there instead of only as a short replay.
const LAG_WARN_S = 30;
function queued(chain, name, seconds) {
  chain.pending = (chain.pending || 0) + seconds;
  if (!chain.behind && chain.pending > LAG_WARN_S) {
    chain.behind = true;
    log('falling behind:', name, `about ${Math.round(chain.pending)}s waiting to upload`);
  } else if (chain.behind && chain.pending <= SEGMENT_S) {
    chain.behind = false;
    log('caught up:', name);
  }
}

// OBS came back soon after the stream seemed to end: keep adding to the same recording, so viewers can still rewind to
// the start and it stays one replay.
async function reopen(r, prefix) {
  rec = r;
  r.gapS += Math.max(0, (Date.now() - r.lastPieceAt) / 1000);
  for (const q of r.qualities.values())
    Object.assign(q, { prefix, lastSeq: -1, lastPts: null, disc: true, runStart: Date.now() });
  quiet.since = Date.now();
  await putJson(`${PREFIX}/current.json`, {
    server: SERVER_ID,
    id: r.id,
    startedAt: r.startedAt,
    live: true,
    edge: edgeReady, // live viewers play dvr/live/<n>.m3u8 once it's published
    gapS: r.gapS,
  });
  log('recording continued', r.id);
}

async function finish(r) {
  r.lastPieceAt = quiet.since;
  last = { rec: r, finishedAt: Date.now() };
  for (const q of r.qualities.values()) flush(r, q, true);
  await Promise.all([...r.qualities.values()].map((q) => q.chain));
  await r.audio?.chain; // after the qualities, which add the last audio pieces to it
  await b2Queue;
  const durationS = Math.round(
    Math.max(0, ...[...r.qualities.values()].map((q) => q.lines.reduce((s, l) => s + l.dur, 0))),
  );
  await putJson(`${PREFIX}/current.json`, {
    server: SERVER_ID,
    id: r.id,
    startedAt: r.startedAt,
    live: false,
    gapS: r.gapS,
    endedAt: new Date().toISOString(),
    durationS,
  }).catch((err) => log('could not mark finished', err.message));
  log('recording finished', r.id, `${durationS}s`);
}

// The pieces of one quality not handled yet, oldest first: [{ e, mtime }].
async function unhandled(n) {
  const dir = path.join(HLS, String(n));
  const seen = handled.get(n) || new Map();
  handled.set(n, seen);
  const entries = parseMedia((await readText(path.join(dir, 'stream.m3u8'))) || '');
  const listed = new Set(entries.map((e) => e.name));
  for (const name of seen.keys()) if (!listed.has(name)) seen.delete(name); // gone from the playlist
  const out = [];
  for (const e of entries) {
    const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
    if (st && seen.get(e.name) !== st.mtimeMs) out.push({ e, mtime: st.mtimeMs, dir, seen });
  }
  return out;
}

async function tick() {
  const master = await readText(path.join(HLS, 'stream.m3u8'));
  const variants = master ? parseMaster(master) : [];
  if (!variants.length) return;
  // Owncast's qualities changed (e.g. it started on defaults and then got its settings): the old recording's layout no
  // longer fits, so it's closed and a clean one starts.
  if (rec && variants.map((v) => v.n).join() !== [...rec.qualities.keys()].join()) {
    log('qualities changed; starting a new recording');
    const old = rec;
    rec = null;
    await finish(old);
    last = null;
  }
  const firstNew = await unhandled(variants[0].n);
  if (!rec) {
    // Between streams: anything older than the first new piece (or from before the recorder started) belongs to an
    // earlier stream, in every quality, so it's never mixed into the next recording.
    const fresh = firstNew.filter((x) => x.mtime >= bootMs - 2000);
    const cutoff = fresh.length ? Math.min(...fresh.map((x) => x.mtime)) - 1500 : Infinity;
    for (const v of variants)
      for (const x of v.n === variants[0].n ? firstNew : await unhandled(v.n))
        if (x.mtime < cutoff) x.seen.set(x.e.name, x.mtime);
    if (!fresh.length) return;
    if (last && Date.now() - last.finishedAt < REJOIN_S * 1000) await reopen(last.rec, fresh[0].e.prefix);
    else await start(fresh[0].e.prefix, variants);
  }
  let added = false;
  for (const q of rec.qualities.values()) {
    for (const x of await unhandled(q.n)) {
      x.seen.set(x.e.name, x.mtime);
      const bytes = await fs.readFile(path.join(x.dir, x.e.name)).catch(() => null);
      if (!bytes) {
        log('missed piece', q.n, x.e.name);
        continue;
      }
      const pts = firstPts(bytes);
      const quietMs = Date.now() - quiet.since;
      // Owncast sometimes rewrites pieces it already made, under the same names and with no pause (right after OBS
      // connects, and again later, e.g. when its settings change). Their video is earlier than what's already recorded,
      // so they're skipped; recording them again put duplicate seconds in the replay.
      // A full restart (timestamps back near the start) is a new run, handled below, not a copy.
      const rewrite =
        pts !== null &&
        q.lastPts !== null &&
        q.lastPts !== undefined &&
        pts < q.lastPts + 0.5 &&
        pts > q.lastPts - 60 &&
        quietMs < 3000;
      if (rewrite) {
        if (DEBUG) log('skip rewrite', q.n, x.e.name, 'pts', pts, 'last', q.lastPts);
        continue;
      }
      if (DEBUG && (x.e.prefix !== q.prefix || x.e.seq <= q.lastSeq))
        log('join', q.n, x.e.name, 'last', q.lastSeq, 'quiet ms', quietMs);
      // OBS reconnected mid-stream (after a pause; new names, or numbering starting over): close the segment and mark
      // the join.
      if (x.e.prefix !== q.prefix || x.e.seq <= q.lastSeq) {
        flush(rec, q);
        Object.assign(q, { prefix: x.e.prefix, disc: q.disc || q.lastSeq >= 0, runStart: Date.now() });
        // Count the time OBS was away once (from the first quality) and tell players.
        if (q === rec.qualities.values().next().value && q.lastSeq >= 0) {
          rec.gapS += Math.max(0, quietMs / 1000 - 1);
          putJson(`${PREFIX}/current.json`, {
            server: SERVER_ID,
            id: rec.id,
            startedAt: rec.startedAt,
            live: true,
            edge: edgeReady, // live viewers play dvr/live/<n>.m3u8 once it's published
            gapS: rec.gapS,
          }).catch(() => {});
        }
      }
      q.lastSeq = x.e.seq;
      if (pts !== null) q.lastPts = pts;
      q.buf.push(bytes);
      q.bufDur += x.e.dur;
      added = true;
    }
    if (q.bufDur >= SEGMENT_S) flush(rec, q);
  }
  if (added) quiet.since = Date.now();
  else if (Date.now() - quiet.since > QUIET_S * 1000) {
    const old = rec;
    rec = null;
    await finish(old);
  }
}

// Live viewers' playlists (MBJ-311): Owncast's, re-published with a 1-second cache and only uploaded pieces.
const EDGE = `${PREFIX}/live`;
const UP = '../'.repeat(EDGE.split('/').length);
const uploaded = new Set();
const published = new Map();
// The site sends viewers to these only once every quality has one (current.json `edge`), so a problem here can never
// leave viewers without a playlist.
let edgeReady = false;
async function isUploaded(key) {
  if (uploaded.has(key)) return true;
  const ok = await s3Request(cfg, 'HEAD', key).then(
    () => true,
    () => false,
  );
  if (ok) {
    if (uploaded.size > 20000) uploaded.clear();
    uploaded.add(key);
  }
  return ok;
}
async function edgeTick() {
  const master = await readText(path.join(HLS, 'stream.m3u8'));
  const variants = master ? parseMaster(master) : [];
  for (const v of variants) {
    const text = await readText(path.join(HLS, String(v.n), 'stream.m3u8'));
    const out = text && (await edgePlaylist(text, v.n, { isUploaded, up: UP }));
    if (!out || out === published.get(v.n)) continue;
    await r2Put(cfg, `${EDGE}/${v.n}.m3u8`, out, 'application/vnd.apple.mpegurl', 'public, max-age=1');
    published.set(v.n, out);
  }
  if (!edgeReady && variants.length && variants.every((v) => published.has(v.n))) {
    edgeReady = true;
    log('live playlists published');
    if (rec)
      await putJson(`${PREFIX}/current.json`, {
        server: SERVER_ID,
        id: rec.id,
        startedAt: rec.startedAt,
        live: true,
        gapS: rec.gapS,
        edge: true,
      });
  }
}
// Only when the site turns them on (LIVE_EDGE_PLAYLISTS=on): on 2026-10-03 their checks slowed the recorder's uploads.
let edgeBusy = false;
if (process.env.LIVE_EDGE_PLAYLISTS === 'on')
  setInterval(async () => {
    if (edgeBusy) return;
    edgeBusy = true;
    await edgeTick().catch((err) => log('live playlist failed', err.message));
    edgeBusy = false;
  }, 250);

async function shipLog() {
  if (!logDirty) return;
  logDirty = false;
  await r2Put(
    cfg,
    `${PREFIX}/logs/${SERVER_ID || 'unknown'}.log`,
    `${logLines.join('\n')}\n`,
    'text/plain',
  ).catch(() => {
    logDirty = true;
  });
}
setInterval(shipLog, 30_000);
// Whatever stops the recorder is in the log (and docker restarts it).
for (const ev of ['uncaughtException', 'unhandledRejection'])
  process.on(ev, (err) => {
    log(ev, err?.stack || err);
    shipLog().finally(() => process.exit(1));
  });

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  await tick().catch((err) => log('tick failed', err.message));
  busy = false;
}, 500);
log('recorder watching', HLS);
