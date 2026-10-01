// Count one view per viewer (MBJ-216): once per viewer per video per UTC day, so refreshes, resumed sessions,
// and opening the same video in two tabs don't inflate the count.
import crypto from 'crypto';
import { pool } from './db.js';
import { logger } from './logger.js';

const BROWSER_ID = /^[A-Za-z0-9-]{16,64}$/;
// Changes on every restart, so the fallback hashes can't be matched to an IP later.
const SALT = crypto.randomBytes(16).toString('hex');

// Who's watching: the account, else the browser's random id (web app), else a daily hash of address + browser.
export function viewerKey({ userId, browserId, ip, userAgent }) {
  if (userId) return `u:${userId}`;
  if (browserId && BROWSER_ID.test(browserId)) return `b:${browserId}`;
  const day = new Date().toISOString().slice(0, 10);
  const hash = crypto.createHash('sha256').update(`${SALT}|${day}|${ip}|${userAgent}`).digest('hex');
  return `h:${hash.slice(0, 32)}`;
}

// Counts the view if this viewer hasn't been counted on this video today. Returns true when it counted;
// null when the video doesn't exist.
export async function recordView(videoId, key) {
  const { rows } = await pool.query(
    `WITH new_view AS (
       INSERT INTO video_views (video_id, viewer_key) SELECT id, $2 FROM videos WHERE id = $1
       ON CONFLICT DO NOTHING RETURNING video_id
     )
     UPDATE videos SET views = views + 1 WHERE id IN (SELECT video_id FROM new_view) RETURNING id`,
    [videoId, key],
  );
  if (rows.length) return true;
  const { rowCount } = await pool.query('SELECT 1 FROM videos WHERE id = $1', [videoId]);
  return rowCount ? false : null;
}

// Only today's and yesterday's rows matter for de-duplicating.
export async function forgetOldViews() {
  const { rowCount } = await pool.query(
    `DELETE FROM video_views WHERE day < (now() AT TIME ZONE 'UTC')::date - 1`,
  );
  return rowCount;
}

export function startViewCleanup() {
  const run = () => forgetOldViews().catch((err) => logger.error({ err }, 'view cleanup failed'));
  setInterval(run, 60 * 60 * 1000).unref();
}
