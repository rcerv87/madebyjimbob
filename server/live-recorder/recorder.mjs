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

// One quality's playlist → [{ name, seq, prefix, dur }]. Owncast sometimes labels a stream's last piece far longer
// than it is, so lengths are capped at twice the playlist's stated piece length.
function parseMedia(text) {
  const out = [];
  let dur = 0;
  const target = Number(text.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]) || Infinity;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXTINF:')) dur = Math.min(parseFloat(line.slice(8)), target * 2);
    const m = line.trim().match(/^stream-(\w+)-(\d+)\.ts$/);
    if (m) out.push({ name: line.trim(), prefix: m[1], seq: Number(m[2]), dur });
  }
  return out;
}

let rec = null; // the recording in progress
// Pieces already handled, per quality: file name → modified time. Owncast can reuse names after OBS reconnects, so a
// piece is new when its name or its time is.
const handled = new Map();
const bootMs = Date.now();
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
  for (const v of variants) rec.qualities.set(v.n, { n: v.n, buf: [], bufDur: 0, seq: 0, lines: [] });
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
    await start(fresh[0].e.prefix, variants);
  } else if (firstNew.some((x) => x.e.prefix !== rec.prefix)) {
    const old = rec;
    rec = null;
    await finish(old); // OBS reconnected: a new recording
    await start(firstNew.find((x) => x.e.prefix !== old.prefix).e.prefix, variants);
  }
  let added = false;
  for (const q of rec.qualities.values()) {
    for (const x of await unhandled(q.n)) {
      x.seen.set(x.e.name, x.mtime);
      if (x.e.prefix !== rec.prefix) continue;
      const bytes = await fs.readFile(path.join(x.dir, x.e.name)).catch(() => null);
      if (!bytes) {
        log('missed piece', q.n, x.e.name);
        continue;
      }
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

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  await tick().catch((err) => log('tick failed', err.message));
  busy = false;
}, 500);
log('recorder watching', HLS);
