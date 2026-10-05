// The Library Uploader's side on the site (MBJ-818). The program on JimBob's PC converts each video from his Takeout
// folder (720p, 360p, audio, HLS) and uploads the files straight to R2 with short-lived links from here; the R2 keys
// stay on the server. When a video is done, the site plays it from R2: an existing video switches over, a new one is
// queued for the import helper, which adds its title, chat and comments without downloading the video.

import { pool } from './db.js';
import { presign, s3Request } from '../live-recorder/r2put.mjs';

// Where the library goes: LIBRARY_R2_* (JimBob's bucket), else the site's own R2 settings.
export function libraryStore() {
  const e = process.env;
  const pick = (name) => (e[`LIBRARY_R2_${name}`] || e[`R2_${name}`] || '').trim();
  const account = pick('ACCOUNT_ID');
  const accessKey = pick('ACCESS_KEY_ID');
  const secret = pick('SECRET_ACCESS_KEY');
  const bucket = pick('BUCKET');
  const publicUrl = pick('PUBLIC_URL').replace(/\/+$/, '');
  if (!account || !accessKey || !secret || !bucket || !publicUrl) return null;
  return {
    endpoint: (e.LIBRARY_R2_ENDPOINT || `https://${account}.r2.cloudflarestorage.com`).replace(/\/+$/, ''),
    accessKey,
    secret,
    bucket,
    region: 'auto',
    publicUrl,
  };
}

export const PREFIX = 'library';
const YOUTUBE_ID = /^[\w-]{11}$/;
// The only files an upload may write: the master list, a thumbnail, and each quality's list and pieces.
const FILE = /^(master\.m3u8|thumb\.jpg|(720p|360p|audio)\/(index\.m3u8|seg_\d{5}\.ts))$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

// { youtubeId, fileKey, title, sizeBytes } → { uploadId, prefix, done } (done: already on R2, skip it).
export async function startUpload(user, body) {
  const store = libraryStore();
  if (!store) throw fail(503, 'Library storage isn’t set up yet (LIBRARY_R2_* on the server).');
  const youtubeId = String(body?.youtubeId || '');
  const fileKey = String(body?.fileKey || '').slice(0, 500);
  if (!YOUTUBE_ID.test(youtubeId)) throw fail(400, 'Not a YouTube video id.');
  if (!fileKey) throw fail(400, 'Missing the file’s id.');
  const done = await pool.query(
    `SELECT id FROM library_uploads WHERE youtube_id = $1 AND status = 'done' LIMIT 1`,
    [youtubeId],
  );
  if (done.rows[0]) return { uploadId: done.rows[0].id, prefix: `${PREFIX}/${youtubeId}`, done: true };
  const { rows } = await pool.query(
    `INSERT INTO library_uploads (youtube_id, file_key, title, size_bytes, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (file_key) DO UPDATE SET youtube_id = EXCLUDED.youtube_id, title = EXCLUDED.title
     RETURNING id`,
    [
      youtubeId,
      fileKey,
      body?.title ? String(body.title).slice(0, 300) : null,
      Number(body?.sizeBytes) || null,
      user.id,
    ],
  );
  return { uploadId: rows[0].id, prefix: `${PREFIX}/${youtubeId}`, done: false };
}

async function openUpload(id) {
  const { rows } = await pool.query('SELECT * FROM library_uploads WHERE id = $1', [Number(id) || 0]);
  if (!rows[0]) throw fail(404, 'No such upload.');
  if (rows[0].status === 'done') throw fail(409, 'That video is already uploaded.');
  return rows[0];
}

// { paths: ['720p/seg_00000.ts', …] } (up to 500) → { urls: { path: presigned PUT } }, valid for 6 hours.
export async function signUpload(id, body) {
  const store = libraryStore();
  if (!store) throw fail(503, 'Library storage isn’t set up yet.');
  const up = await openUpload(id);
  const paths = Array.isArray(body?.paths) ? body.paths.map(String) : [];
  if (!paths.length || paths.length > 500) throw fail(400, 'Ask for 1 to 500 files at a time.');
  const bad = paths.find((p) => !FILE.test(p));
  if (bad) throw fail(400, `Not a file an upload can write: ${bad}`);
  const urls = {};
  for (const p of paths) urls[p] = presign(store, 'PUT', `${PREFIX}/${up.youtube_id}/${p}`, 6 * 3600);
  return { urls };
}

// { durationS } → the video on the site: an existing one plays from R2 now; a new one is queued for the import helper.
export async function finishUpload(user, id, body) {
  const store = libraryStore();
  if (!store) throw fail(503, 'Library storage isn’t set up yet.');
  const up = await openUpload(id);
  const prefix = `${PREFIX}/${up.youtube_id}`;
  // The master list goes up last, so its presence means every piece is there.
  await s3Request(store, 'HEAD', `${prefix}/master.m3u8`).catch(() => {
    throw fail(409, 'The video’s files aren’t all uploaded yet.');
  });
  const hlsUrl = `${store.publicUrl}/${prefix}/master.m3u8`;
  const durationS = Math.round(Number(body?.durationS)) || null;
  const { rows: onSite } = await pool.query('SELECT id FROM videos WHERE youtube_id = $1', [up.youtube_id]);
  let videoId = onSite[0]?.id || null;
  let jobId = null;
  if (videoId) {
    await pool.query('UPDATE videos SET hls_url = $2, duration_s = COALESCE(duration_s, $3) WHERE id = $1', [
      videoId,
      hlsUrl,
      durationS,
    ]);
  } else {
    const { rows: waiting } = await pool.query(
      `SELECT id FROM import_jobs WHERE youtube_id = $1 AND status IN ('queued', 'running') LIMIT 1`,
      [up.youtube_id],
    );
    if (waiting[0]) {
      jobId = waiting[0].id;
      await pool.query('UPDATE import_jobs SET hls_url = $2 WHERE id = $1', [jobId, hlsUrl]);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO import_jobs (url, youtube_id, tier, with_comments, status, hls_url, title, requested_by)
         VALUES ($1, $2, 'free', true, 'queued', $3, $4, $5) RETURNING id`,
        [`https://www.youtube.com/watch?v=${up.youtube_id}`, up.youtube_id, hlsUrl, up.title, user.id],
      );
      jobId = rows[0].id;
    }
  }
  await pool.query(
    `UPDATE library_uploads SET status = 'done', finished_at = now(), duration_s = $2, video_id = $3, import_job_id = $4
     WHERE id = $1`,
    [up.id, durationS, videoId, jobId],
  );
  return { videoId, importJobId: jobId, hlsUrl };
}

// What's already uploaded, so a fresh install (or a second computer) skips it: { fileKeys: [...] } → { done: [...] }.
export async function uploadedKeys(body) {
  const keys = Array.isArray(body?.fileKeys) ? body.fileKeys.map(String).slice(0, 2000) : [];
  if (!keys.length) return { done: [] };
  const { rows } = await pool.query(
    `SELECT file_key FROM library_uploads WHERE status = 'done' AND file_key = ANY($1::text[])`,
    [keys],
  );
  return { done: rows.map((r) => r.file_key) };
}

// Titles of the channel's videos (from Studio → From the channel), for matching files that Takeout's CSV doesn't name.
export async function channelTitles() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (youtube_id) youtube_id, title FROM channel_videos WHERE title <> ''`,
  );
  return { videos: rows.map((r) => ({ youtubeId: r.youtube_id, title: r.title })) };
}
