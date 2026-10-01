#!/usr/bin/env node
// Import a finished YouTube live stream: video -> Cloudflare Stream; chat replay and comments -> Postgres.
//
// Usage:
//   npm run import:youtube -- <youtube-url> [--tier free|plus|premium] [--stream-uid <uid>] [--chat-only] [--no-comments]
//
//   --stream-uid   Video is already on Cloudflare Stream; skip download/upload.
//   --chat-only    Skip the video; re-import chat and comments for a video already in the database.
//   --no-comments  Don't import YouTube comments.
//
// Re-running is safe: chat and comments are de-duplicated by YouTube id (comment like counts refresh).
//
// Requires yt-dlp and ffmpeg on your PATH.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execFileSync } from 'child_process';
import * as tus from 'tus-js-client';
import { pool, migrate } from '../src/db.js';
import { parseReplayLine } from '../src/ingest/youtubeReplay.js';
import { parseComments } from '../src/ingest/youtubeComments.js';
import { videoKind } from '../src/ingest/videoKind.js';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && !isFlagValue(a));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
function isFlagValue(a) {
  const i = args.indexOf(a);
  return i > 0 && ['--tier', '--stream-uid'].includes(args[i - 1]);
}

if (!url) {
  console.error(
    'Usage: npm run import:youtube -- <youtube-url> [--tier plus] [--stream-uid <uid>] [--chat-only] [--no-comments]',
  );
  process.exit(1);
}

const TMP = path.resolve('tmp');
fs.mkdirSync(TMP, { recursive: true });

const ytdlp = (...a) => execFileSync('yt-dlp', a, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });

// ---------- 1. metadata ----------
console.log('Reading video info…');
const meta = JSON.parse(ytdlp('--dump-single-json', '--no-warnings', url));
const ytId = meta.id;
console.log(`  ${meta.title} (${ytId})`);

// ---------- 2. chat replay ----------
console.log('Downloading chat replay…');
const chatFile = path.join(TMP, `${ytId}.live_chat.json`);
try {
  ytdlp('--skip-download', '--write-subs', '--sub-langs', 'live_chat', '-o', path.join(TMP, '%(id)s'), url);
} catch {
  console.warn('  yt-dlp could not fetch chat replay.');
}
if (!fs.existsSync(chatFile))
  console.warn('  No chat replay found — the stream may have had chat replay disabled.');

// ---------- 3. comments ----------
const withComments = flag('no-comments') !== true;
const infoFile = path.join(TMP, `${ytId}.info.json`);
if (withComments) {
  console.log('Downloading comments…');
  try {
    ytdlp(
      '--skip-download',
      '--no-warnings',
      '--write-comments',
      '--write-info-json',
      '-o',
      path.join(TMP, '%(id)s'),
      url,
    );
  } catch {
    console.warn('  yt-dlp could not fetch comments.');
  }
}

// ---------- 4. video -> Cloudflare Stream ----------
let streamUid = typeof flag('stream-uid') === 'string' ? flag('stream-uid') : null;
const chatOnly = flag('chat-only') === true;

if (!streamUid && !chatOnly) {
  const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.error('Set CF_ACCOUNT_ID and CF_API_TOKEN in .env to upload video.');
    process.exit(1);
  }
  const videoFile = path.join(TMP, `${ytId}.mp4`);
  if (!fs.existsSync(videoFile)) {
    console.log('Downloading video (up to 1080p)…');
    execFileSync(
      'yt-dlp',
      [
        '-f',
        'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '--merge-output-format',
        'mp4',
        '-o',
        videoFile,
        url,
      ],
      { stdio: 'inherit' },
    );
  }
  console.log('Uploading to Cloudflare Stream…');
  streamUid = await uploadToStream(videoFile, meta.title, CF_ACCOUNT_ID, CF_API_TOKEN);
  console.log(`  Stream UID: ${streamUid}`);
  console.log('  Captions: once Stream finishes processing, run `npm run captions:fetch -- --generate`.');
}

// ---------- 5. database ----------
await migrate();
const tier = ['free', 'plus', 'premium'].includes(flag('tier')) ? flag('tier') : 'free';
const publishedAt =
  meta.release_timestamp || meta.timestamp
    ? new Date((meta.release_timestamp || meta.timestamp) * 1000)
    : meta.upload_date
      ? new Date(
          `${meta.upload_date.slice(0, 4)}-${meta.upload_date.slice(4, 6)}-${meta.upload_date.slice(6, 8)}`,
        )
      : null;

const { rows } = await pool.query(
  `INSERT INTO videos (youtube_id, stream_uid, title, description, duration_s, published_at, min_tier, kind)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   ON CONFLICT (youtube_id) DO UPDATE SET
     stream_uid = COALESCE(EXCLUDED.stream_uid, videos.stream_uid),
     title = EXCLUDED.title, description = EXCLUDED.description,
     duration_s = EXCLUDED.duration_s, published_at = EXCLUDED.published_at, kind = EXCLUDED.kind
   RETURNING id`,
  [
    ytId,
    streamUid,
    meta.title,
    meta.description || '',
    Math.round(meta.duration || 0),
    publishedAt,
    tier,
    videoKind(meta),
  ],
);
const videoId = rows[0].id;
console.log(`Video saved as #${videoId}`);

if (fs.existsSync(chatFile)) {
  const { seen, inserted } = await importChat(chatFile, videoId);
  const skipped = seen - inserted;
  console.log(`Imported ${inserted} new chat messages${skipped ? ` (${skipped} already imported)` : ''}.`);
}

if (withComments && fs.existsSync(infoFile)) {
  const durationMs = Math.round((meta.duration || 0) * 1000) || Infinity;
  const { topLevel, replies, inserted } = await importComments(infoFile, videoId, durationMs);
  console.log(
    `Imported ${topLevel + replies} comments (${topLevel} threads, ${replies} replies; ${inserted} new).`,
  );
}

// Confirmed YouTube links whose channel first appears in this import get matched now (MBJ-215).
const { resolvePendingChannels } = await import('../src/links.js');
const matched = await resolvePendingChannels();
if (matched)
  console.log(`Matched ${matched} linked YouTube account${matched === 1 ? '' : 's'} to their channel.`);

await pool.end();
console.log('Done.');

// =====================================================================

function uploadToStream(filePath, name, accountId, token) {
  return new Promise((resolve, reject) => {
    let uid = null;
    const upload = new tus.Upload(fs.createReadStream(filePath), {
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
      headers: { Authorization: `Bearer ${token}` },
      chunkSize: 50 * 1024 * 1024,
      uploadSize: fs.statSync(filePath).size,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: { name, filetype: 'video/mp4' },
      onAfterResponse(_req, res) {
        const id = res.getHeader('stream-media-id');
        if (id) uid = id;
      },
      onProgress(sent, total) {
        process.stdout.write(`\r  ${((sent / total) * 100).toFixed(1)}%`);
      },
      onError: reject,
      onSuccess() {
        process.stdout.write('\n');
        resolve(uid || upload.url.split('/').pop().split('?')[0]);
      },
    });
    upload.start();
  });
}

async function importChat(file, videoId) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let batch = [];
  let seen = 0;
  let inserted = 0;

  const flush = async () => {
    if (!batch.length) return;
    const cols = 12;
    const values = [];
    const params = [];
    batch.forEach((m, i) => {
      const b = i * cols;
      values.push(`(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(',')})`);
      params.push(
        videoId,
        'youtube',
        m.externalId,
        m.author,
        m.channelId,
        m.photo,
        m.kind,
        m.body,
        m.amount,
        m.mentions,
        m.offsetMs,
        m.sentAt,
      );
    });
    const res = await pool.query(
      `INSERT INTO chat_messages
         (video_id, source, external_id, author_name, author_channel_id, author_photo, kind, body, amount_text, mentions, offset_ms, sent_at)
       VALUES ${values.join(',')}
       ON CONFLICT (source, external_id) DO NOTHING`,
      params,
    );
    seen += batch.length;
    inserted += res.rowCount;
    process.stdout.write(`\r  ${seen} messages`);
    batch = [];
  };

  for await (const line of rl) {
    for (const m of parseReplayLine(line)) {
      batch.push(m);
      if (batch.length >= 500) await flush();
    }
  }
  await flush();
  process.stdout.write('\n');
  return { seen, inserted };
}

// Upserts YouTube comments: top-level first, then replies linked to their thread by YouTube id, then
// each reply linked to the exact comment it answers. Timestamps typed in comments become offset_ms.
async function importComments(file, videoId, durationMs) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8')).comments || [];
  const { topLevel, replies } = parseComments(list, { durationMs });
  let inserted = 0;

  const upsert = async (batch, withParent) => {
    const values = [];
    const params = [];
    for (const c of batch) {
      const p = (v) => {
        params.push(v);
        return `$${params.length}`;
      };
      const parent = withParent
        ? `(SELECT id FROM comments WHERE source = 'youtube' AND external_id = ${p(c.parentExternalId)})`
        : 'NULL';
      values.push(
        `(${p(videoId)}, 'youtube', ${p(c.externalId)}, ${parent}, ${p(c.author)}, ${p(c.channelId)}, ` +
          `${p(c.photo)}, ${p(c.isCreator)}, ${p(c.body)}, ${p(c.likeCount)}, ${p(c.pinned)}, ` +
          `COALESCE(${p(c.postedAt)}::timestamptz, now()), ${p(c.offsetMs)}::int)`,
      );
    }
    const res = await pool.query(
      `INSERT INTO comments (video_id, source, external_id, parent_id, author_name, author_channel_id,
         author_photo, author_is_creator, body, like_count, pinned, posted_at, offset_ms)
       VALUES ${values.join(',')}
       ON CONFLICT (source, external_id) DO UPDATE SET
         like_count = EXCLUDED.like_count, pinned = EXCLUDED.pinned, body = EXCLUDED.body,
         offset_ms = EXCLUDED.offset_ms
       RETURNING (xmax = 0) AS inserted`,
      params,
    );
    inserted += res.rows.filter((r) => r.inserted).length;
  };

  for (let i = 0; i < topLevel.length; i += 500) await upsert(topLevel.slice(i, i + 500), false);
  for (let i = 0; i < replies.length; i += 500) await upsert(replies.slice(i, i + 500), true);

  // Link replies to what they answer (done after inserting, since that can be another new reply).
  const links = replies.filter((c) => c.replyToExternalId);
  if (links.length) {
    await pool.query(
      `UPDATE comments c SET reply_to_id = t.id
       FROM unnest($1::text[], $2::text[]) AS m(child, target)
       JOIN comments t ON t.source = 'youtube' AND t.external_id = m.target
       WHERE c.source = 'youtube' AND c.external_id = m.child`,
      [links.map((c) => c.externalId), links.map((c) => c.replyToExternalId)],
    );
  }
  return { topLevel: topLevel.length, replies: replies.length, inserted };
}
