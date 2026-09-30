#!/usr/bin/env node
// Copies finished caption tracks from Cloudflare Stream into the transcripts table, so captions
// stay ours if video moves off Stream. Safe to re-run: existing rows are refreshed.
//
// Usage:
//   npm run captions:fetch                    save finished captions for every video on Stream
//   npm run captions:fetch -- --video 8       one video (database id)
//   npm run captions:fetch -- --generate      also ask Stream to create English captions for
//                                             videos that have none (Stream must have finished
//                                             processing the video); run again later to save them
import { pool, migrate } from '../src/db.js';
import { vttToText } from '../src/ingest/vtt.js';

const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('Set CF_ACCOUNT_ID and CF_API_TOKEN in .env to read captions from Cloudflare Stream.');
  process.exit(1);
}

const args = process.argv.slice(2);
const generate = args.includes('--generate');
const i = args.indexOf('--video');
const onlyId = i === -1 ? null : args[i + 1];
if (onlyId !== null && !/^\d+$/.test(String(onlyId))) {
  console.error('--video takes a video id from the database, e.g. --video 8');
  process.exit(1);
}

const api = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;
const headers = { Authorization: `Bearer ${CF_API_TOKEN}` };

async function cf(path, as = 'json', method = 'GET') {
  const res = await fetch(`${api}${path}`, { headers, method });
  if (!res.ok) throw new Error(`Cloudflare returned ${res.status} for ${path}`);
  return as === 'json' ? (await res.json()).result : res.text();
}

await migrate();
const { rows: videos } = await pool.query(
  `SELECT id, title, stream_uid FROM videos
   WHERE stream_uid IS NOT NULL AND ($1::bigint IS NULL OR id = $1) ORDER BY id`,
  [onlyId],
);
if (!videos.length)
  console.log(onlyId ? `No video #${onlyId} with a Stream copy.` : 'No videos on Stream yet.');

let saved = 0;
for (const v of videos) {
  const label = `#${v.id} ${v.title.slice(0, 50)}`;
  try {
    const tracks = (await cf(`/${v.stream_uid}/captions`)) || [];
    if (!tracks.length && generate) {
      await cf(`/${v.stream_uid}/captions/en/generate`, 'json', 'POST');
      console.log(`${label}: asked Stream to generate English captions; run again later to save them`);
      continue;
    }
    if (!tracks.length) console.log(`${label}: no captions on Stream (add --generate to create them)`);
    for (const t of tracks) {
      if (t.status && t.status !== 'ready') {
        console.log(`${label}: ${t.language} is ${t.status}, run again later`);
        continue;
      }
      const vtt = await cf(`/${v.stream_uid}/captions/${encodeURIComponent(t.language)}/vtt`, 'text');
      const { text, cueCount } = vttToText(vtt);
      await pool.query(
        `INSERT INTO transcripts (video_id, language, source, label, vtt, text, cue_count)
         VALUES ($1, $2, 'cloudflare', $3, $4, $5, $6)
         ON CONFLICT (video_id, language, source) DO UPDATE SET
           label = EXCLUDED.label, vtt = EXCLUDED.vtt, text = EXCLUDED.text,
           cue_count = EXCLUDED.cue_count, fetched_at = now()`,
        [v.id, t.language, t.label || null, vtt, text, cueCount],
      );
      saved += 1;
      const words = text ? text.split(/\s+/).length : 0;
      console.log(`${label}: saved ${t.language} (${cueCount} cues, ${words.toLocaleString()} words)`);
    }
  } catch (err) {
    console.error(`${label}: ${err.message}`);
    process.exitCode = 1;
  }
}

await pool.end();
console.log(`Done. ${saved} caption track(s) saved.`);
