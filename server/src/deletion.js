// Download my data and delete my account (MBJ-118). A request signs the member out everywhere and waits
// 30 days; signing in again cancels it. Then eraseAccount() removes the account and everything tied to it.
// Their chat messages and comments stay in replays as "Deleted user" (so conversations still make sense),
// or are blanked and hidden if they chose to remove them; rows are kept so other people's replies survive.
import { pool } from './db.js';
import { logger } from './logger.js';
import { sendEmail } from './email.js';
import { logSecurityEvent } from './security.js';

export const DELETION_GRACE_DAYS = 30;
export const DELETED_NAME = 'Deleted user';

export const eraseDate = (requestedAt) =>
  new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);

const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export async function requestDeletion(user, { deleteContent, origin, siteUrl }) {
  const { rows } = await pool.query(
    `UPDATE users SET deletion_requested_at = now(), delete_content = $2 WHERE id = $1
     RETURNING deletion_requested_at`,
    [user.id, Boolean(deleteContent)],
  );
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  await logSecurityEvent(user.id, 'deletion_requested', {
    ...origin,
    detail: deleteContent ? 'messages removed too' : 'messages kept as Deleted user',
  });
  const eraseOn = eraseDate(rows[0].deletion_requested_at);
  if (user.email) {
    await sendEmail({
      to: user.email,
      template: 'account_deletion_requested',
      data: { username: user.username, date: formatDate(eraseOn), cancelUrl: `${siteUrl}/account` },
      userId: user.id,
    });
  }
  return eraseOn;
}

// Called whenever the member signs in: a pending deletion is called off.
export async function cancelDeletionOnSignIn(userId, origin) {
  const { rowCount } = await pool.query(
    `UPDATE users SET deletion_requested_at = NULL, delete_content = false
     WHERE id = $1 AND deletion_requested_at IS NOT NULL`,
    [userId],
  );
  if (rowCount) await logSecurityEvent(userId, 'deletion_cancelled', origin);
  return rowCount > 0;
}

// Erases one account now. Safe to call twice (the second finds nothing).
export async function eraseAccount(userId) {
  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT id, username, email, delete_content FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    user = found.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return false;
    }
    const remove = user.delete_content;
    // Chat and comments: anonymous either way; blank and hidden when they asked for them to go.
    await client.query(
      `UPDATE chat_messages SET author_name = $2, author_photo = NULL, user_id = NULL,
         body = CASE WHEN $3 THEN '' ELSE body END,
         mentions = CASE WHEN $3 THEN '{}' ELSE mentions END,
         hidden = hidden OR $3
       WHERE user_id = $1`,
      [userId, DELETED_NAME, remove],
    );
    await client.query(
      `UPDATE comments SET author_name = $2, author_photo = NULL, user_id = NULL,
         body = CASE WHEN $3 THEN '' ELSE body END,
         hidden = hidden OR $3
       WHERE user_id = $1`,
      [userId, DELETED_NAME, remove],
    );
    // Other people's notifications about them.
    await client.query(
      `UPDATE notifications SET actor_name = $2, excerpt = CASE WHEN $3 THEN '' ELSE excerpt END
       WHERE actor_id = $1`,
      [userId, DELETED_NAME, remove],
    );
    // Sessions, sign-in methods, progress, likes, push, notifications, security history, tokens cascade.
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Last email, then forget every email we sent them (including that one).
  if (user.email) {
    await sendEmail({ to: user.email, template: 'account_deleted', data: { username: user.username } }).catch(
      (err) => logger.warn({ err }, 'account-deleted email failed'),
    );
    await pool.query('DELETE FROM emails WHERE to_email = $1', [String(user.email).toLowerCase()]);
  }
  logger.info({ userId }, 'account erased');
  return true;
}

// Erases every account whose 30 days are up. Returns how many.
export async function eraseDueAccounts(now = new Date()) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE deletion_requested_at IS NOT NULL
       AND deletion_requested_at <= $1::timestamptz - make_interval(days => $2)`,
    [now, DELETION_GRACE_DAYS],
  );
  let erased = 0;
  for (const { id } of rows) {
    try {
      if (await eraseAccount(id)) erased += 1;
    } catch (err) {
      logger.error({ err, userId: id }, 'account erase failed; will retry next run');
    }
  }
  return erased;
}

// Runs a minute after start and then hourly (one server; a missed hour just runs next time).
export function startErasureJob() {
  const run = () => eraseDueAccounts().catch((err) => logger.error({ err }, 'erasure job failed'));
  setTimeout(run, 60_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

// Everything we hold about the member, as one JSON document (no password hashes or session tokens).
export async function exportData(userId) {
  const q = (sql) => pool.query(sql, [userId]).then((r) => r.rows);
  const [profile, comments, chat, likes, progress, notifications, devices, security, emails, links] =
    await Promise.all([
      q(`SELECT id, username, display_name, email, email_verified, image, tier, xp, notification_prefs, created_at,
         deletion_requested_at FROM users WHERE id = $1`),
      q(`SELECT c.id, c.video_id, v.title AS video_title, c.parent_id, c.reply_to_id, c.body, c.offset_ms,
         c.like_count, c.hidden, c.posted_at FROM comments c JOIN videos v ON v.id = c.video_id
       WHERE c.user_id = $1 ORDER BY c.posted_at`),
      q(`SELECT m.id, m.video_id, v.title AS video_title, m.reply_to_id, m.body, m.offset_ms, m.hidden, m.created_at
       FROM chat_messages m JOIN videos v ON v.id = m.video_id WHERE m.user_id = $1 ORDER BY m.created_at`),
      q(`SELECT vv.video_id, v.title AS video_title, CASE WHEN vv.value = 1 THEN 'like' ELSE 'dislike' END AS vote,
         vv.updated_at FROM video_votes vv JOIN videos v ON v.id = vv.video_id WHERE vv.user_id = $1`),
      q(`SELECT wp.video_id, v.title AS video_title, wp.position_ms, wp.updated_at
       FROM watch_progress wp JOIN videos v ON v.id = wp.video_id WHERE wp.user_id = $1`),
      q(`SELECT type, video_id, actor_name, excerpt, offset_ms, read_at, created_at FROM notifications
       WHERE user_id = $1 ORDER BY created_at`),
      q(`SELECT user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = $1`),
      q(`SELECT type, ip_address, user_agent, detail, created_at FROM security_events WHERE user_id = $1
       ORDER BY created_at`),
      q(`SELECT e.template, e.status, e.created_at FROM emails e JOIN users u ON u.id = $1
       WHERE e.user_id = u.id OR e.to_email = u.email ORDER BY e.created_at`),
      q(`SELECT platform, status, handle, external_id, verified_by, verified_at, created_at FROM linked_accounts
         WHERE user_id = $1`),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    site: 'MADEbyJIMBOB',
    profile: profile[0] || null,
    comments,
    chatMessages: chat,
    likes,
    watchProgress: progress,
    notifications,
    signedInDevices: devices,
    securityHistory: security,
    emailsSent: emails,
    linkedAccounts: links,
    // Paid memberships, tips, and receipts appear here once payments exist (MBJ-104, 109).
    payments: [],
  };
}
