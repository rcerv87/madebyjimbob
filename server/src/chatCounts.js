// Each video's visible chat count without counting its messages on every request (migration 1792267123766):
// videos.chat_count plus the video's pending rows in chat_count_deltas, which triggers on chat_messages add and
// chat_count_fold() moves into videos.chat_count every 30 seconds.
import { pool } from './db.js';
import { logger } from './logger.js';

// The exact count for the video aliased `v` in a query, as chat_count.
export const CHAT_COUNT_SQL = `(v.chat_count +
  COALESCE((SELECT sum(d.delta) FROM chat_count_deltas d WHERE d.video_id = v.id), 0))::int AS chat_count`;

// Moves the pending deltas into videos.chat_count. Returns how many delta rows it folded.
export async function foldChatCounts(db = pool) {
  const { rows } = await db.query('SELECT chat_count_fold() AS folded');
  return rows[0].folded;
}

export function startChatCountJob() {
  const run = () => foldChatCounts().catch((err) => logger.warn({ err }, 'chat count fold failed'));
  setInterval(run, 30_000).unref();
}

// The repair, if a count ever drifts: sets each video's kept count so that it plus its pending deltas equals a fresh
// count of its visible messages (one statement, so the messages and the deltas are read at the same moment). Best run
// when nothing is importing. Returns the videos that were wrong, with the old and the corrected number.
export async function recountChat(db = pool) {
  const { rows } = await db.query(
    `WITH actual AS (
       SELECT v.id, v.chat_count AS kept,
         COALESCE((SELECT sum(d.delta) FROM chat_count_deltas d WHERE d.video_id = v.id), 0)::int AS pending,
         (SELECT count(*)::int FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS now
       FROM videos v
     )
     UPDATE videos v SET chat_count = a.now - a.pending FROM actual a
     WHERE v.id = a.id AND a.kept + a.pending <> a.now
     RETURNING v.id, a.kept + a.pending AS was, a.now`,
  );
  return rows.map((r) => ({ videoId: r.id, was: r.was, now: r.now }));
}
