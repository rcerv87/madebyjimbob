// Notes and moment reactions on a video (MBJ-217, MBJ-613), and the minute-by-minute picture they add up to with
// chat activity (the hotspot strip under the player).
//
// Fair counting for reactions: signed-in members only, one reaction per kind per person per minute (a stretch
// counts once in each minute it covers), stretches are capped in length, and someone who marks a great deal of one
// video counts for less per mark, so one person can't paint the whole strip.
import { pool } from './db.js';
import { filterComment } from './moderation.js';

export const REACTIONS = ['funny', 'interesting', 'fire', 'boring', 'cringe'];
export const NOTE_MAX_CHARS = 280;
const MAX_STRETCH_MS = 30 * 60 * 1000;
const MAX_NOTES_PER_VIDEO = 50; // per member
const FULL_WEIGHT_MINUTES = 30; // a member's first 30 marked minutes on a video count in full
const MAX_OFFSET_MS = 24 * 60 * 60 * 1000;
const fail = (status, message) => Object.assign(new Error(message), { status });

// { offsetMs, endMs } → a position inside the video, and an end after it (or null). Throws for nonsense.
function span(video, body) {
  const limit = video.duration_s ? video.duration_s * 1000 : MAX_OFFSET_MS;
  const start = Math.round(Number(body?.offsetMs));
  if (!Number.isFinite(start) || start < 0) throw fail(400, 'That isn’t a moment in the video.');
  const offsetMs = Math.min(start, limit);
  if (body?.endMs == null) return { offsetMs, endMs: null };
  const end = Math.round(Number(body.endMs));
  if (!Number.isFinite(end)) throw fail(400, 'That isn’t a moment in the video.');
  const endMs = Math.min(end, limit);
  if (endMs <= offsetMs) return { offsetMs, endMs: null };
  if (endMs - offsetMs > MAX_STRETCH_MS)
    throw fail(400, 'A stretch can be up to 30 minutes. Mark it in parts.');
  return { offsetMs, endMs };
}

// ---------- notes ----------

const noteRow = (r, viewerId) => ({
  id: Number(r.id),
  offsetMs: Number(r.offset_ms),
  endMs: r.end_ms == null ? null : Number(r.end_ms),
  body: r.body,
  private: r.private,
  author: r.username,
  profile: r.username,
  memberTier: r.tier === 'free' ? null : r.tier,
  mine: viewerId != null && String(r.user_id) === String(viewerId),
  createdAt: r.created_at,
});

// Public notes, plus the viewer's own private ones. In video order.
export async function listNotes(videoId, viewerId = null) {
  const { rows } = await pool.query(
    `SELECT n.*, u.username, u.tier FROM video_notes n JOIN users u ON u.id = n.user_id
     WHERE n.video_id = $1 AND NOT n.hidden AND u.banned_at IS NULL AND (NOT n.private OR n.user_id = $2)
     ORDER BY n.offset_ms, n.id LIMIT 500`,
    [videoId, viewerId],
  );
  return rows.map((r) => noteRow(r, viewerId));
}

export async function addNote(user, video, body) {
  const text = filterComment(typeof body?.text === 'string' ? body.text : '').replace(/\s+/g, ' ');
  if (!text) throw fail(400, 'Write a few words for the note.');
  if (text.length > NOTE_MAX_CHARS) throw fail(400, `Keep notes under ${NOTE_MAX_CHARS} characters.`);
  const { offsetMs, endMs } = span(video, body);
  const { rows: mine } = await pool.query(
    'SELECT count(*) AS n FROM video_notes WHERE video_id = $1 AND user_id = $2',
    [video.id, user.id],
  );
  if (Number(mine[0].n) >= MAX_NOTES_PER_VIDEO)
    throw fail(409, `That’s ${MAX_NOTES_PER_VIDEO} notes on this video. Delete one to add another.`);
  const { rows } = await pool.query(
    `INSERT INTO video_notes (video_id, user_id, offset_ms, end_ms, body, private)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [video.id, user.id, offsetMs, endMs, text, body?.private === true],
  );
  return noteRow({ ...rows[0], username: user.username, tier: user.tier }, user.id);
}

// Your own note, or any note for Studio accounts (theirs is hidden, kept for the record, like comments).
export async function removeNote(user, id) {
  const { rows } = await pool.query(
    'SELECT id, user_id, video_id FROM video_notes WHERE id = $1 AND NOT hidden',
    [id],
  );
  const note = rows[0];
  if (!note) throw fail(404, 'That note is gone.');
  if (String(note.user_id) === String(user.id)) {
    await pool.query('DELETE FROM video_notes WHERE id = $1', [id]);
  } else if (user.isAdmin) {
    await pool.query('UPDATE video_notes SET hidden = true WHERE id = $1', [id]);
  } else throw fail(403, 'You can only delete your own notes.');
  return { ok: true, videoId: note.video_id };
}

// A member's public notes across videos, newest first, for their profile (only videos the viewer's tier can open).
export async function notesBy(userId, tiers, limit = 20) {
  const { rows } = await pool.query(
    `SELECT n.id, n.video_id, v.title AS video_title, n.body, n.offset_ms, n.end_ms, n.created_at
     FROM video_notes n JOIN videos v ON v.id = n.video_id
     WHERE n.user_id = $1 AND NOT n.hidden AND NOT n.private AND NOT v.draft AND v.min_tier = ANY($2::text[])
     ORDER BY n.created_at DESC LIMIT $3`,
    [userId, tiers, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    videoId: r.video_id,
    videoTitle: r.video_title,
    body: r.body,
    offsetMs: Number(r.offset_ms),
    endMs: r.end_ms == null ? null : Number(r.end_ms),
    createdAt: r.created_at,
  }));
}

// ---------- reactions ----------

const reactionRow = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  offsetMs: Number(r.offset_ms),
  endMs: r.end_ms == null ? null : Number(r.end_ms),
});

// One tap: stamps the moment (or stretch). The same kind in the same minute again takes it back.
export async function toggleReaction(user, video, body) {
  if (!REACTIONS.includes(body?.kind)) throw fail(400, 'Pick one of the reactions.');
  const { offsetMs, endMs } = span(video, body);
  const minute = Math.floor(offsetMs / 60000);
  const { rows: had } = await pool.query(
    'DELETE FROM moment_reactions WHERE video_id = $1 AND user_id = $2 AND kind = $3 AND minute = $4 RETURNING id',
    [video.id, user.id, body.kind, minute],
  );
  heatCache.delete(String(video.id));
  // A stretch dragged over a minute that already had this reaction replaces it instead of clearing it.
  if (had.length && endMs == null) return { removed: Number(had[0].id) };
  const { rows } = await pool.query(
    `INSERT INTO moment_reactions (video_id, user_id, kind, offset_ms, end_ms, minute)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [video.id, user.id, body.kind, offsetMs, endMs, minute],
  );
  return { reaction: reactionRow(rows[0]) };
}

export async function myReactions(videoId, userId) {
  if (!userId) return [];
  const { rows } = await pool.query(
    'SELECT id, kind, offset_ms, end_ms FROM moment_reactions WHERE video_id = $1 AND user_id = $2 ORDER BY offset_ms',
    [videoId, userId],
  );
  return rows.map(reactionRow);
}

// ---------- the minute-by-minute picture ----------

// Recomputed at most every 30 seconds per video (and right after a reaction on it).
const heatCache = new Map();
const HEAT_TTL_MS = 30_000;

// { minutes, chat: [n per minute], reactions: [{ minute, kind, score, people }] }: `score` is the weighted count.
export async function heat(video) {
  const key = String(video.id);
  const cached = heatCache.get(key);
  if (cached && Date.now() - cached.at < HEAT_TTL_MS) return cached.value;
  const [chat, reactions] = await Promise.all([
    pool.query(
      `SELECT floor(offset_ms / 60000.0)::int AS minute, count(*)::int AS n FROM chat_messages
       WHERE video_id = $1 AND NOT hidden AND offset_ms >= 0 GROUP BY 1`,
      [video.id],
    ),
    pool.query(
      `WITH marked AS (
         -- every minute each reaction covers, once per person and kind
         SELECT DISTINCT r.user_id, r.kind, m AS minute
         FROM moment_reactions r
         JOIN users u ON u.id = r.user_id AND u.banned_at IS NULL,
           generate_series(r.minute, COALESCE(floor(r.end_ms / 60000.0)::int, r.minute)) AS m
         WHERE r.video_id = $1
       ), weight AS (
         -- heavy marking by one person counts for less per minute
         SELECT user_id, LEAST(1.0, $2::numeric / count(*)) AS w FROM marked GROUP BY user_id
       )
       SELECT marked.minute, marked.kind, round(sum(weight.w), 2)::float AS score,
         count(DISTINCT marked.user_id)::int AS people
       FROM marked JOIN weight USING (user_id) GROUP BY marked.minute, marked.kind ORDER BY 1, 2`,
      [video.id, FULL_WEIGHT_MINUTES],
    ),
  ]);
  const last = Math.max(
    video.duration_s ? Math.ceil(video.duration_s / 60) - 1 : 0,
    ...chat.rows.map((r) => r.minute),
    ...reactions.rows.map((r) => r.minute),
    0,
  );
  const minutes = Math.min(last + 1, 24 * 60);
  const perMinute = new Array(minutes).fill(0);
  for (const r of chat.rows) if (r.minute < minutes) perMinute[r.minute] = r.n;
  const value = {
    minutes,
    chat: perMinute,
    reactions: reactions.rows
      .filter((r) => r.minute < minutes)
      .map((r) => ({ minute: r.minute, kind: r.kind, score: r.score, people: r.people })),
  };
  heatCache.set(key, { at: Date.now(), value });
  if (heatCache.size > 500) heatCache.delete(heatCache.keys().next().value);
  return value;
}
export const clearHeatCache = () => heatCache.clear();
