// The live recorder (MBJ-310) runs next to Owncast on the live server. Owncast keeps only the last few seconds of
// video; this copies every piece to R2 as it's made, joined into ~6-second segments, with a playlist that grows for
// the whole stream. Viewers rewind with it while live, and when the stream ends it becomes the replay.
//
// R2 layout:
//   dvr/current.json             { id, startedAt, live, endedAt?, durationS? } — the newest recording
//   dvr/<id>/master.m3u8         the qualities
//   dvr/<id>/<n>/index.m3u8      one quality's playlist (EVENT; ENDLIST once finished)
//   dvr/<id>/<n>/<seq>.ts        the video
//
// Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, HLS_DIR (Owncast's data/hls, read-only).
import fs from 'fs/promises';
import path from 'path';
import { r2Put } from './r2put.mjs';

const cfg = {
  endpoint: process.env.R2_ENDPOINT,
  accessKey: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
};
const HLS = process.env.HLS_DIR || '/hls';
const SEGMENT_S = 6; // join Owncast's 1-second pieces into segments this long
const QUIET_S = 12; // no new video this long = the stream ended

const log = (...a) => console.log(new Date().toISOString(), ...a);
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

// One quality's playlist → [{ name, seq, prefix, dur }].
function parseMedia(text) {
  const out = [];
  let dur = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    const m = line.trim().match(/^stream-(\w+)-(\d+)\.ts$/);
    if (m) out.push({ name: line.trim(), prefix: m[1], seq: Number(m[2]), dur });
  }
  return out;
}

let rec = null; // the recording in progress
const done = new Set(); // streams already recorded (Owncast's last playlist stays after OBS stops)
const quiet = { since: Date.now() };

function playlist(q, ended) {
  const target = Math.ceil(Math.max(SEGMENT_S, ...q.lines.map((l) => l.dur)));
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    ...q.lines.map((l) => `#EXTINF:${l.dur.toFixed(3)},\n${l.file}`),
    ...(ended ? ['#EXT-X-ENDLIST'] : []),
    '',
  ].join('\n');
}

const putJson = (key, value) => r2Put(cfg, key, JSON.stringify(value), 'application/json');

async function start(prefix, variants) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  rec = { id, prefix, startedAt: new Date().toISOString(), qualities: new Map(), chain: Promise.resolve() };
  for (const v of variants)
    rec.qualities.set(v.n, { n: v.n, lastSeq: -1, buf: [], bufDur: 0, seq: 0, lines: [] });
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    ...variants.flatMap((v) => [v.info, `${v.n}/index.m3u8`]),
    '',
  ];
  await r2Put(cfg, `dvr/${id}/master.m3u8`, master.join('\n'), 'application/vnd.apple.mpegurl');
  await putJson('dvr/current.json', { id, startedAt: rec.startedAt, live: true });
  log('recording started', id);
}

// Upload what's buffered for one quality as the next segment, then the playlist.
function flush(r, q, ended = false) {
  if (!q.buf.length && !ended) return;
  const bytes = Buffer.concat(q.buf);
  const dur = q.bufDur;
  q.buf = [];
  q.bufDur = 0;
  r.chain = r.chain
    .then(async () => {
      if (bytes.length) {
        const file = `${q.seq++}.ts`;
        await r2Put(
          cfg,
          `dvr/${r.id}/${q.n}/${file}`,
          bytes,
          'video/mp2t',
          'public, max-age=31536000, immutable',
        );
        q.lines.push({ file, dur });
      }
      await r2Put(cfg, `dvr/${r.id}/${q.n}/index.m3u8`, playlist(q, ended), 'application/vnd.apple.mpegurl');
    })
    .catch((err) => log('upload failed', err.message));
}

async function finish(r) {
  done.add(r.prefix);
  for (const q of r.qualities.values()) flush(r, q, true);
  await r.chain;
  const durationS = Math.round(
    Math.max(0, ...[...r.qualities.values()].map((q) => q.lines.reduce((s, l) => s + l.dur, 0))),
  );
  await putJson('dvr/current.json', {
    id: r.id,
    startedAt: r.startedAt,
    live: false,
    endedAt: new Date().toISOString(),
    durationS,
  }).catch((err) => log('could not mark finished', err.message));
  log('recording finished', r.id, `${durationS}s`);
}

async function tick() {
  const master = await readText(path.join(HLS, 'stream.m3u8'));
  const variants = master ? parseMaster(master) : [];
  if (!variants.length) return;
  const first = parseMedia((await readText(path.join(HLS, String(variants[0].n), 'stream.m3u8'))) || '');
  const prefix = first.at(-1)?.prefix;
  if (prefix && prefix !== rec?.prefix && !done.has(prefix)) {
    if (rec) {
      const old = rec;
      rec = null;
      await finish(old); // OBS reconnected: a new recording
    }
    await start(prefix, variants);
  }
  if (!rec) return;
  let added = false;
  for (const q of rec.qualities.values()) {
    const dir = path.join(HLS, String(q.n));
    const entries = parseMedia((await readText(path.join(dir, 'stream.m3u8'))) || '').filter(
      (e) => e.prefix === rec.prefix && e.seq > q.lastSeq,
    );
    for (const e of entries) {
      const bytes = await fs.readFile(path.join(dir, e.name)).catch(() => null);
      q.lastSeq = e.seq;
      if (!bytes) {
        log('missed piece', q.n, e.name);
        continue;
      }
      q.buf.push(bytes);
      q.bufDur += e.dur;
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

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  await tick().catch((err) => log('tick failed', err.message));
  busy = false;
}, 500);
log('recorder watching', HLS);
