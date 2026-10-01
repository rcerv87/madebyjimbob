// Replacing a video's file (MBJ-701): once Cloudflare has processed the new upload, it's swapped in for the old
// one (chat and comments stay) and the old file is deleted. Studio checks while it's open; a background job
// finishes the rest (bulk replacements from a Takeout folder can take hours to process).
import { pool } from './db.js';
import { logger } from './logger.js';
import { deleteFromStream, streamStatus, streamConfigured } from './stream.js';

// One video: { state: none | queued | inprogress | error | swapped, pct?, error? }.
export async function checkReplacement(videoId) {
  const { rows } = await pool.query('SELECT stream_uid, replacement_stream_uid FROM videos WHERE id = $1', [
    videoId,
  ]);
  const { stream_uid: oldUid, replacement_stream_uid: newUid } = rows[0] || {};
  if (!newUid) return { state: 'none' };
  const status = await streamStatus(newUid);
  if (status.state === 'error') return { state: 'error', error: status.error };
  if (!status.ready) return { state: status.state, pct: status.pct };
  const { rowCount } = await pool.query(
    `UPDATE videos SET stream_uid = $2, replacement_stream_uid = NULL, replacement_started_at = NULL,
       duration_s = COALESCE($3, duration_s)
     WHERE id = $1 AND replacement_stream_uid = $2`,
    [videoId, newUid, status.duration ? Math.round(status.duration) : null],
  );
  if (rowCount && oldUid) {
    const { rowCount: shared } = await pool.query('SELECT 1 FROM videos WHERE stream_uid = $1', [oldUid]);
    if (!shared) await deleteFromStream(oldUid).catch(() => {});
  }
  if (rowCount) logger.info({ videoId }, 'video file replaced');
  return { state: 'swapped' };
}

export async function finishReplacements() {
  if (!streamConfigured()) return 0;
  const { rows } = await pool.query('SELECT id FROM videos WHERE replacement_stream_uid IS NOT NULL');
  let swapped = 0;
  for (const { id } of rows) {
    try {
      if ((await checkReplacement(id)).state === 'swapped') swapped += 1;
    } catch (err) {
      logger.warn({ err, videoId: id }, 'replacement check failed');
    }
  }
  return swapped;
}

export function startReplacementJob() {
  const run = () => finishReplacements().catch((err) => logger.error({ err }, 'replacement job failed'));
  setInterval(run, 5 * 60 * 1000).unref();
}
