#!/usr/bin/env node
// Import a finished YouTube live stream: video -> Cloudflare Stream, chat replay -> Postgres.
//
// Usage:
//   npm run import:youtube -- <youtube-url> [--tier free|plus|premium] [--stream-uid <uid>] [--chat-only]
//
//   --stream-uid  Video is already on Cloudflare Stream; skip download/upload.
//   --chat-only   Re-import chat for a video already in the database.
//
// Requires yt-dlp and ffmpeg on your PATH.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execFileSync } from 'child_process';
import * as tus from 'tus-js-client';
import { pool, migrate } from '../src/db.js';
import { extractMentions } from '../src/moderation.js';

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
  console.error('Usage: npm run import:youtube -- <youtube-url> [--tier plus] [--stream-uid <uid>] [--chat-only]');
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
if (!fs.existsSync(chatFile)) console.warn('  No chat replay found — the stream may have had chat replay disabled.');

// ---------- 3. video -> Cloudflare Stream ----------
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
    execFileSync('yt-dlp', [
      '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format', 'mp4', '-o', videoFile, url,
    ], { stdio: 'inherit' });
  }
  console.log('Uploading to Cloudflare Stream…');
  streamUid = await uploadToStream(videoFile, meta.title, CF_ACCOUNT_ID, CF_API_TOKEN);
  console.log(`  Stream UID: ${streamUid}`);
}

// ---------- 4. database ----------
await migrate();
const tier = ['free', 'plus', 'premium'].includes(flag('tier')) ? flag('tier') : 'free';
const publishedAt = meta.release_timestamp || meta.timestamp
  ? new Date((meta.release_timestamp || meta.timestamp) * 1000)
  : meta.upload_date ? new Date(`${meta.upload_date.slice(0, 4)}-${meta.upload_date.slice(4, 6)}-${meta.upload_date.slice(6, 8)}`) : null;

const { rows } = await pool.query(
  `INSERT INTO videos (youtube_id, stream_uid, title, description, duration_s, published_at, min_tier)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (youtube_id) DO UPDATE SET
     stream_uid = COALESCE(EXCLUDED.stream_uid, videos.stream_uid),
     title = EXCLUDED.title, description = EXCLUDED.description,
     duration_s = EXCLUDED.duration_s, published_at = EXCLUDED.published_at
   RETURNING id`,
  [ytId, streamUid, meta.title, meta.description || '', Math.round(meta.duration || 0), publishedAt, tier]
);
const videoId = rows[0].id;
console.log(`Video saved as #${videoId}`);

if (fs.existsSync(chatFile)) {
  const count = await importChat(chatFile, videoId);
  console.log(`Imported ${count} chat messages.`);
}

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

function runsToText(runs = []) {
  return runs.map((r) => {
    if (r.text !== undefined) return r.text;
    if (r.emoji) {
      return r.emoji.isCustomEmoji
        ? `:${(r.emoji.shortcuts?.[0] || 'emoji').replace(/:/g, '')}:`
        : r.emoji.emojiId || '';
    }
    return '';
  }).join('');
}

function parseItem(item) {
  const r =
    item.liveChatTextMessageRenderer ||
    item.liveChatPaidMessageRenderer ||
    item.liveChatMembershipItemRenderer;
  if (!r) return null;

  let kind = 'text';
  let body = runsToText(r.message?.runs);
  let amount = null;
  if (item.liveChatPaidMessageRenderer) {
    kind = 'paid';
    amount = r.purchaseAmountText?.simpleText || null;
  } else if (item.liveChatMembershipItemRenderer) {
    kind = 'membership';
    body = [runsToText(r.headerSubtext?.runs), body].filter(Boolean).join(' — ');
  }

  const photos = r.authorPhoto?.thumbnails || [];
  return {
    externalId: r.id,
    author: r.authorName?.simpleText || 'Unknown',
    channelId: r.authorExternalChannelId || null,
    photo: photos[photos.length - 1]?.url || null,
    kind,
    body,
    amount,
    sentAt: r.timestampUsec ? new Date(Number(r.timestampUsec) / 1000) : null,
  };
}

async function importChat(file, videoId) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let batch = [];
  let total = 0;

  const flush = async () => {
    if (!batch.length) return;
    const cols = 11;
    const values = [];
    const params = [];
    batch.forEach((m, i) => {
      const b = i * cols;
      values.push(`(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(',')})`);
      params.push(videoId, 'youtube', m.externalId, m.author, m.channelId, m.photo, m.kind, m.body, m.amount, m.offsetMs, m.sentAt);
    });
    await pool.query(
      `INSERT INTO chat_messages
         (video_id, source, external_id, author_name, author_channel_id, author_photo, kind, body, amount_text, offset_ms, sent_at)
       VALUES ${values.join(',')}
       ON CONFLICT (source, external_id) DO NOTHING`,
      params
    );
    // mentions in a second pass keeps the bulk insert simple
    for (const m of batch) {
      const mentions = extractMentions(m.body);
      if (mentions.length) {
        await pool.query(
          `UPDATE chat_messages SET mentions = $1 WHERE source = 'youtube' AND external_id = $2`,
          [mentions, m.externalId]
        );
      }
    }
    total += batch.length;
    process.stdout.write(`\r  ${total} messages`);
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const replay = obj.replayChatItemAction;
    if (!replay) continue;
    const offsetMs = Math.max(0, Number(replay.videoOffsetTimeMsec) || 0);
    for (const action of replay.actions || []) {
      const item = action.addChatItemAction?.item;
      if (!item) continue;
      const m = parseItem(item);
      if (!m || !m.externalId) continue;
      batch.push({ ...m, offsetMs });
      if (batch.length >= 500) await flush();
    }
  }
  await flush();
  process.stdout.write('\n');
  return total;
}
