// Studio → Members (MBJ-705): find any member, change their role, ban or unban them. Every action is logged in
// mod_actions with who did it. A ban signs the member out everywhere and refuses new sign-ins (auth.js), so it
// also ends their chat and comments. Timeouts, highlights and hiding messages come with MBJ-204.
import { pool } from './db.js';
import { ADMIN_EMAILS } from './auth.js';
import { maskEmail } from './emailTemplates.js';
import { currentRecording } from './live.js';

export const ROLES = ['viewer', 'mod', 'admin'];
const TIERS = ['free', 'plus', 'premium'];
const PAGE = 50;
const NO_EMAIL = '@no-email.invalid';

// Admin through the ADMIN_EMAILS setting: Studio can't take that away, only the setting can.
const adminByEmail = (u) => Boolean(u.email_verified && ADMIN_EMAILS.has(String(u.email).toLowerCase()));

const member = (u) => ({
  id: Number(u.id),
  username: u.username,
  displayName: u.display_name,
  // Masked: enough to recognise an account, not enough to copy a list of addresses.
  email: String(u.email).endsWith(NO_EMAIL) ? null : maskEmail(u.email),
  emailVerified: Boolean(u.email_verified),
  tier: u.tier,
  role: u.role,
  adminByEmail: adminByEmail(u),
  bannedAt: u.banned_at,
  banReason: u.ban_reason,
  // Only while it's running: an ended timeout isn't shown.
  timeoutUntil: u.timeout_until && new Date(u.timeout_until) > new Date() ? u.timeout_until : null,
  timeoutReason: u.timeout_until && new Date(u.timeout_until) > new Date() ? u.timeout_reason : null,
  timeoutThisStream: Boolean(u.timeout_stream && u.timeout_until && new Date(u.timeout_until) > new Date()),
  createdAt: u.created_at,
  lastSeenAt: u.last_seen_at,
  chatCount: Number(u.chat_count || 0),
  commentCount: Number(u.comment_count || 0),
});

const COLUMNS = `u.id, u.username, u.display_name, u.email, u.email_verified, u.tier, u.role, u.banned_at,
  u.ban_reason, u.created_at, u.timeout_until, u.timeout_reason, u.timeout_stream,
  (SELECT max(s.updated_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
  (SELECT count(*) FROM chat_messages c WHERE c.user_id = u.id) AS chat_count,
  (SELECT count(*) FROM comments c WHERE c.user_id = u.id) AS comment_count`;

// The list, most recently active first. `filter` is one of all | staff | banned | new (joined in the last 7 days).
export async function listMembers({ q, tier, filter, offset } = {}) {
  const where = [];
  const args = [];
  const search = String(q || '')
    .trim()
    .slice(0, 100);
  if (search) {
    // A whole email address finds its account; a partial one doesn't (emails are masked in the list).
    const like = `%${search
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, search.toLowerCase());
    const n = args.length;
    where.push(
      `(u.username_key LIKE $${n - 1} OR lower(u.display_name) LIKE $${n - 1} OR lower(u.email) = $${n})`,
    );
  }
  if (TIERS.includes(tier)) {
    args.push(tier);
    where.push(`u.tier = $${args.length}`);
  }
  if (filter === 'staff') where.push(`u.role IN ('mod', 'admin')`);
  if (filter === 'banned') where.push('u.banned_at IS NOT NULL');
  if (filter === 'timedout') where.push('u.timeout_until > now()');
  if (filter === 'new') where.push(`u.created_at > now() - interval '7 days'`);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);

  const [{ rows }, total] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM users u ${clause}
       ORDER BY last_seen_at DESC NULLS LAST, u.created_at DESC, u.id DESC
       LIMIT ${PAGE} OFFSET $${args.length + 1}`,
      [...args, start],
    ),
    pool.query(`SELECT count(*) FROM users u ${clause}`, args),
  ]);
  return { members: rows.map(member), total: Number(total.rows[0].count), offset: start, pageSize: PAGE };
}

async function findMember(id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  return rows[0] || null;
}

const log = (db, actorId, targetId, action, reason) =>
  db.query(`INSERT INTO mod_actions (actor_id, target_user_id, action, reason) VALUES ($1, $2, $3, $4)`, [
    actorId,
    targetId,
    action,
    reason,
  ]);

const fail = (status, message) => Object.assign(new Error(message), { status });

// Throws an Error with .status (404, 400 or 409) and a message for the person in Studio.
export async function setRole(actor, id, role) {
  if (!ROLES.includes(role)) throw fail(400, 'Pick member, mod or admin.');
  const target = await findMember(id);
  if (!target) throw fail(404, 'No such member.');
  if (Number(target.id) === Number(actor.id))
    throw fail(409, 'You can’t change your own role. Ask another admin.');
  if (target.banned_at && role !== 'viewer') throw fail(409, 'Unban this member before giving them a role.');
  if (target.role !== role) {
    await pool.query('UPDATE users SET role = $2, updated_at = now() WHERE id = $1', [id, role]);
    await log(pool, actor.id, id, 'role', `${target.role} → ${role}`);
  }
  return member(await findMember(id));
}

export async function banMember(actor, id, reason) {
  const why = String(reason || '')
    .trim()
    .slice(0, 500);
  if (!why) throw fail(400, 'Say why, so other mods know. Members don’t see the reason.');
  const target = await findMember(id);
  if (!target) throw fail(404, 'No such member.');
  if (Number(target.id) === Number(actor.id)) throw fail(409, 'You can’t ban yourself.');
  if (target.role !== 'viewer' || adminByEmail(target))
    throw fail(409, 'Mods and admins can’t be banned. Change their role to member first.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      'UPDATE users SET banned_at = now(), ban_reason = $2, banned_by = $3, updated_at = now() WHERE id = $1',
      [id, why, actor.id],
    );
    // Signed out on every device; auth.js refuses new sign-ins while banned_at is set.
    await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await log(db, actor.id, id, 'ban', why);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
  return member(await findMember(id));
}

export async function unbanMember(actor, id) {
  const target = await findMember(id);
  if (!target) throw fail(404, 'No such member.');
  if (target.banned_at) {
    await pool.query(
      'UPDATE users SET banned_at = NULL, ban_reason = NULL, banned_by = NULL, updated_at = now() WHERE id = $1',
      [id],
    );
    await log(pool, actor.id, id, 'unban', null);
  }
  return member(await findMember(id));
}

// How long a timeout can run: "stream" (until the stream that's live now ends), a week, two weeks, or `until`
// (a date and time). Staff can't be timed out, like bans. The member keeps watching and liking.
const TIMEOUT_DAYS = { week: 7, twoweeks: 14 };
const STREAM_CAP_MS = 12 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 366 * 24 * 60 * 60 * 1000;

const clearTimeouts = (where, args) =>
  pool.query(
    `UPDATE users SET timeout_until = NULL, timeout_reason = NULL, timeout_stream = NULL, timeout_by = NULL
     WHERE ${where}`,
    args,
  );

export async function timeoutMember(actor, id, { length, until, reason } = {}) {
  const why = String(reason || '')
    .trim()
    .slice(0, 500);
  if (!why) throw fail(400, 'Say why, so other mods know. Members don’t see the reason.');
  const target = await findMember(id);
  if (!target) throw fail(404, 'No such member.');
  if (Number(target.id) === Number(actor.id)) throw fail(409, 'You can’t time yourself out.');
  if (target.role !== 'viewer' || adminByEmail(target))
    throw fail(409, 'Mods and admins can’t be timed out. Change their role to member first.');
  if (target.banned_at) throw fail(409, 'This member is banned already.');

  let ends;
  let stream = null;
  if (length === 'stream') {
    const rec = await currentRecording().catch(() => null);
    if (!rec?.live) throw fail(409, 'No stream is live right now. Pick a length of time instead.');
    stream = String(rec.id);
    ends = new Date(Date.now() + STREAM_CAP_MS); // lifted when the stream ends; this is only the backstop
  } else if (TIMEOUT_DAYS[length]) {
    ends = new Date(Date.now() + TIMEOUT_DAYS[length] * 24 * 60 * 60 * 1000);
  } else if (length === 'custom') {
    ends = new Date(until);
    if (Number.isNaN(ends.getTime())) throw fail(400, 'Pick the date and time it ends.');
    if (ends <= new Date()) throw fail(400, 'Pick a time in the future.');
    if (ends - Date.now() > MAX_TIMEOUT_MS)
      throw fail(400, 'A timeout can last up to a year. For longer, ban.');
  } else throw fail(400, 'Pick how long: this stream, 1 week, 2 weeks, or a date.');

  await pool.query(
    `UPDATE users SET timeout_until = $2, timeout_reason = $3, timeout_stream = $4, timeout_by = $5,
       updated_at = now() WHERE id = $1`,
    [id, ends, why, stream, actor.id],
  );
  await pool.query(
    `INSERT INTO mod_actions (actor_id, target_user_id, action, duration_s, reason) VALUES ($1, $2, 'timeout', $3, $4)`,
    [
      actor.id,
      id,
      stream ? null : Math.round((ends - Date.now()) / 1000),
      stream ? `this stream: ${why}` : why,
    ],
  );
  return member(await findMember(id));
}

export async function endTimeout(actor, id) {
  const target = await findMember(id);
  if (!target) throw fail(404, 'No such member.');
  if (target.timeout_until && new Date(target.timeout_until) > new Date()) {
    await clearTimeouts('id = $1', [id]);
    await log(pool, actor.id, id, 'untimeout', null);
  }
  return member(await findMember(id));
}

// The newest actions, for the log under the list.
export async function recentActions(limit = 20) {
  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.reason, a.created_at, actor.username AS actor, target.username AS target
     FROM mod_actions a
     LEFT JOIN users actor ON actor.id = a.actor_id
     LEFT JOIN users target ON target.id = a.target_user_id
     ORDER BY a.created_at DESC, a.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    action: r.action,
    reason: r.reason,
    actor: r.actor,
    target: r.target,
    createdAt: r.created_at,
  }));
}
