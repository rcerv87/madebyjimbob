// Beta feedback (MBJ-819): members send a note from the page they're on (with the page, the video and moment, their
// device, and an optional screenshot); Studio → Feedback lists them as new, seen or done. Off with FEEDBACK=off
// when the beta ends.
import { pool } from './db.js';

export const feedbackEnabled = () => process.env.FEEDBACK !== 'off';
export const FEEDBACK_STATUSES = ['new', 'seen', 'done'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PER_DAY = 30;
const fail = (status, message) => Object.assign(new Error(message), { status });
const short = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '') || null;

// `screenshot` is a data URL ("data:image/jpeg;base64,…") or nothing.
function readScreenshot(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || !IMAGE_TYPES.includes(m[1]))
    throw fail(400, 'The screenshot has to be a JPEG, PNG or WebP picture.');
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw fail(400, 'That screenshot is too big. Try a smaller one, or send the note without it.');
  return { bytes, type: m[1] };
}

export async function sendFeedback(user, body, userAgent) {
  if (!feedbackEnabled()) throw fail(404, 'Feedback is closed.');
  const note = short(body?.note, 2000);
  if (!note) throw fail(400, 'Write a few words about what happened or what you’d like.');
  const shot = readScreenshot(body?.screenshot);
  const { rows: recent } = await pool.query(
    `SELECT count(*) AS n FROM feedback WHERE user_id = $1 AND created_at > now() - interval '1 day'`,
    [user.id],
  );
  if (Number(recent[0].n) >= MAX_PER_DAY)
    throw fail(409, 'That’s a lot of feedback for one day. Thank you! Send more tomorrow.');
  const videoId = /^\d{1,18}$/.test(String(body?.videoId ?? '')) ? String(body.videoId) : null;
  const offsetMs =
    Number.isFinite(Number(body?.offsetMs)) && body?.offsetMs != null ? Number(body.offsetMs) : null;
  const { rows } = await pool.query(
    `INSERT INTO feedback (user_id, note, page, video_id, offset_ms, user_agent, screen, screenshot, screenshot_type)
     VALUES ($1, $2, $3, (SELECT id FROM videos WHERE id = $4), $5, $6, $7, $8, $9) RETURNING id`,
    [
      user.id,
      note,
      short(body?.page, 500),
      videoId,
      videoId && offsetMs != null ? Math.max(0, Math.round(offsetMs)) : null,
      short(userAgent, 400),
      short(body?.screen, 60),
      shot?.bytes ?? null,
      shot?.type ?? null,
    ],
  );
  return { id: Number(rows[0].id) };
}

export async function listFeedback(status) {
  const { rows } = await pool.query(
    `SELECT f.id, f.note, f.page, f.video_id, f.offset_ms, f.user_agent, f.screen, f.status, f.created_at,
       f.screenshot IS NOT NULL AS has_screenshot, u.username, v.title AS video_title
     FROM feedback f JOIN users u ON u.id = f.user_id LEFT JOIN videos v ON v.id = f.video_id
     WHERE f.status = $1 ORDER BY f.created_at DESC LIMIT 200`,
    [status],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    note: r.note,
    page: r.page,
    videoId: r.video_id,
    videoTitle: r.video_title,
    offsetMs: r.offset_ms == null ? null : Number(r.offset_ms),
    userAgent: r.user_agent,
    screen: r.screen,
    status: r.status,
    username: r.username,
    hasScreenshot: r.has_screenshot,
    createdAt: r.created_at,
  }));
}

export async function setFeedbackStatus(actor, id, status) {
  if (!FEEDBACK_STATUSES.includes(status)) throw fail(400, 'Unknown status.');
  const { rowCount } = await pool.query('UPDATE feedback SET status = $2, handled_by = $3 WHERE id = $1', [
    id,
    status,
    actor.id,
  ]);
  if (!rowCount) throw fail(404, 'No such feedback.');
  return { ok: true };
}

export async function feedbackScreenshot(id) {
  const { rows } = await pool.query('SELECT screenshot, screenshot_type FROM feedback WHERE id = $1', [id]);
  return rows[0]?.screenshot ? { bytes: rows[0].screenshot, type: rows[0].screenshot_type } : null;
}

export const newFeedbackCount = async () =>
  Number((await pool.query(`SELECT count(*) AS n FROM feedback WHERE status = 'new'`)).rows[0].n);
