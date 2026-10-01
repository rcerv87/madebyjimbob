// Block, mute, and report (MBJ-119). Blocking or muting hides that member's chat, comments, and mentions for
// you (the web app filters by each row's `profile`); blocking also stops them replying to you, and neither sends
// you notifications from them. Moderators and JimBob can't be blocked. Reports go to a queue mods work in Studio.
import { pool } from './db.js';
import { ADMIN_EMAILS } from './auth.js';

export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other'];

async function userByName(username) {
  const { rows } = await pool.query(
    'SELECT id, username, role, email, email_verified FROM users WHERE username_key = lower($1)',
    [String(username || '')],
  );
  return rows[0] || null;
}

// Mods and admins (and JimBob, an admin email) are never hidden.
const isStaff = (u) =>
  u.role === 'admin' ||
  u.role === 'mod' ||
  (u.email_verified && ADMIN_EMAILS.has(String(u.email).toLowerCase()));

// Throws 'not-found', 'self', or 'staff'.
export async function setBlock(userId, username, kind) {
  const target = await userByName(username);
  if (!target) throw new Error('not-found');
  if (String(target.id) === String(userId)) throw new Error('self');
  if (isStaff(target)) throw new Error('staff');
  await pool.query(
    `INSERT INTO user_blocks (user_id, blocked_id, kind) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, blocked_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`,
    [userId, target.id, kind],
  );
}

export async function removeBlock(userId, username) {
  await pool.query(
    'DELETE FROM user_blocks WHERE user_id = $1 AND blocked_id = (SELECT id FROM users WHERE username_key = lower($2))',
    [userId, String(username || '')],
  );
}

// Who this member hides: [{ username, kind, since }].
export async function hiddenBy(userId) {
  const { rows } = await pool.query(
    `SELECT u.username, b.kind, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.user_id = $1 ORDER BY u.username`,
    [userId],
  );
  return rows.map((r) => ({ username: r.username, kind: r.kind, since: r.created_at }));
}

// Has `ownerId` blocked `otherId`? (Then `otherId` can't reply to them.)
export async function hasBlocked(ownerId, otherId) {
  if (!ownerId || !otherId) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM user_blocks WHERE user_id = $1 AND blocked_id = $2 AND kind = 'block'`,
    [ownerId, otherId],
  );
  return rowCount > 0;
}

// Of these would-be recipients, the ones who blocked or muted the actor (they get no notification).
export async function hidingFrom(recipientIds, actorId) {
  if (!recipientIds.length) return new Set();
  const { rows } = await pool.query(
    'SELECT user_id FROM user_blocks WHERE user_id = ANY($1::bigint[]) AND blocked_id = $2',
    [recipientIds, actorId],
  );
  return new Set(rows.map((r) => String(r.user_id)));
}

// Throws 'bad-reason', 'not-found'. Reports a member, optionally about one of their chat messages or comments.
export async function fileReport(reporterId, { username, chatMessageId, commentId, reason, details }) {
  if (!REPORT_REASONS.includes(reason)) throw new Error('bad-reason');
  let target = null;
  let excerpt = null;
  let messageId = null;
  let commentRow = null;
  if (chatMessageId) {
    const { rows } = await pool.query(
      'SELECT id, user_id, author_name, body FROM chat_messages WHERE id = $1',
      [chatMessageId],
    );
    if (!rows[0]) throw new Error('not-found');
    messageId = rows[0].id;
    excerpt = rows[0].body;
    target = { id: rows[0].user_id, username: rows[0].author_name };
  } else if (commentId) {
    const { rows } = await pool.query('SELECT id, user_id, author_name, body FROM comments WHERE id = $1', [
      commentId,
    ]);
    if (!rows[0]) throw new Error('not-found');
    commentRow = rows[0].id;
    excerpt = rows[0].body;
    target = { id: rows[0].user_id, username: rows[0].author_name };
  }
  if (username) {
    const u = await userByName(username);
    if (!u && !target) throw new Error('not-found');
    if (u) target = { id: u.id, username: u.username };
  }
  if (!target) throw new Error('not-found');
  const { rows } = await pool.query(
    `INSERT INTO reports (reporter_id, target_user_id, target_name, chat_message_id, comment_id, reason, details, excerpt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      reporterId,
      target.id || null,
      target.username,
      messageId,
      commentRow,
      reason,
      details ? String(details).slice(0, 1000) : null,
      excerpt ? String(excerpt).slice(0, 500) : null,
    ],
  );
  return rows[0].id;
}

export async function listReports(status = 'open') {
  const { rows } = await pool.query(
    `SELECT r.*, rep.username AS reporter_name,
            coalesce(m.video_id, c.video_id) AS video_id, coalesce(m.offset_ms, c.offset_ms) AS offset_ms,
            (SELECT count(*)::int FROM reports o WHERE o.target_user_id = r.target_user_id) AS reports_on_member
     FROM reports r
     LEFT JOIN users rep ON rep.id = r.reporter_id
     LEFT JOIN chat_messages m ON m.id = r.chat_message_id
     LEFT JOIN comments c ON c.id = r.comment_id
     WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`,
    [status],
  );
  return rows.map((r) => ({
    id: r.id,
    reporter: r.reporter_name,
    target: r.target_name,
    reason: r.reason,
    details: r.details,
    excerpt: r.excerpt,
    chatMessageId: r.chat_message_id,
    commentId: r.comment_id,
    videoId: r.video_id,
    offsetMs: r.offset_ms,
    reportsOnMember: r.reports_on_member,
    status: r.status,
    createdAt: r.created_at,
  }));
}
