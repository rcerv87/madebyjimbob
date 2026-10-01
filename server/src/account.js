// Account settings API (MBJ-106, MBJ-113): notification preferences, the security history, and changing the
// email of a confirmed account (password first; the new address confirms; the old one gets a 7-day undo link).
// Password changes, devices, and sign-out use Better Auth's endpoints under /api/auth directly.
import crypto from 'crypto';
import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { pool } from './db.js';
import { auth, baseURL, sessionUser } from './auth.js';
import { sendEmail, normalizeEmail } from './email.js';
import { maskEmail } from './emailTemplates.js';
import { logSecurityEvent, requestOrigin } from './security.js';
import { exportData, requestDeletion } from './deletion.js';
import { setBlock, removeBlock, hiddenBy } from './blocks.js';
import { linksFor, requestLink, PLATFORMS } from './links.js';

export const NOTIFICATION_TYPES = ['mention', 'reply'];
export const NOTIFICATION_CHANNELS = ['site', 'push'];
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_UNDO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function requireUser(req, res, next) {
  try {
    const user = await sessionUser(req.headers);
    if (!user) return res.status(401).json({ error: 'Sign in to see your account.' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Every type/channel pair, true unless turned off.
export function fullPrefs(stored = {}) {
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [
      t,
      Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, stored?.[t]?.[c] !== false])),
    ]),
  );
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function createToken(userId, purpose, data, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO account_tokens (token_hash, user_id, purpose, data, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, purpose, data, new Date(Date.now() + ttlMs)],
  );
  return token;
}

// Uses the token (once): returns its row, or null when it's unknown, used, or expired.
async function useToken(token, purpose) {
  const { rows } = await pool.query(
    `UPDATE account_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id, data`,
    [hashToken(token), purpose],
  );
  return rows[0] || null;
}

// A few tries per member per hour for actions that send email or build big responses.
function hourlyLimit(max) {
  const tries = new Map();
  return (userId) => {
    const now = Date.now();
    const recent = (tries.get(userId) || []).filter((t) => now - t < 60 * 60 * 1000);
    recent.push(now);
    tries.set(userId, recent);
    return recent.length > max;
  };
}
const tooManyEmailChanges = hourlyLimit(5);
const tooManyExports = hourlyLimit(5);
const tooManyDeletes = hourlyLimit(5);
const tooManyLinkRequests = hourlyLimit(10);

async function passwordOk(req) {
  try {
    await auth.api.verifyPassword({
      body: { password: String(req.body?.password || '') },
      headers: fromNodeHeaders(req.headers),
    });
    return true;
  } catch {
    return false;
  }
}

router.get(
  '/notifications',
  requireUser,
  wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT notification_prefs FROM users WHERE id = $1', [req.user.id]);
    res.json({ prefs: fullPrefs(rows[0]?.notification_prefs) });
  }),
);

router.put(
  '/notifications',
  requireUser,
  wrap(async (req, res) => {
    const input = req.body?.prefs;
    const valid =
      input &&
      typeof input === 'object' &&
      Object.entries(input).every(
        ([t, ch]) =>
          NOTIFICATION_TYPES.includes(t) &&
          ch &&
          typeof ch === 'object' &&
          Object.entries(ch).every(([c, v]) => NOTIFICATION_CHANNELS.includes(c) && typeof v === 'boolean'),
      );
    if (!valid)
      return res.status(400).json({ error: 'Send { prefs: { mention|reply: { site|push: true|false } } }.' });
    const { rows } = await pool.query('SELECT notification_prefs FROM users WHERE id = $1', [req.user.id]);
    const merged = fullPrefs(rows[0]?.notification_prefs);
    for (const [t, ch] of Object.entries(input)) Object.assign(merged[t], ch);
    await pool.query('UPDATE users SET notification_prefs = $1 WHERE id = $2', [merged, req.user.id]);
    res.json({ prefs: merged });
  }),
);

router.get(
  '/security',
  requireUser,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, type, ip_address, user_agent, detail, created_at FROM security_events
       WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20`,
      [req.user.id],
    );
    res.json({
      events: rows.map((r) => ({
        id: r.id,
        type: r.type,
        ip: r.ip_address,
        userAgent: r.user_agent,
        detail: r.detail,
        createdAt: r.created_at,
      })),
    });
  }),
);

// Step 1: { newEmail, password }. Emails a confirmation link to the new address.
router.post(
  '/email',
  requireUser,
  wrap(async (req, res) => {
    const newEmail = normalizeEmail(req.body?.newEmail);
    if (!newEmail) return res.status(400).json({ error: 'Enter an email address like name@example.com.' });
    if (newEmail === req.user.email?.toLowerCase())
      return res.status(400).json({ error: 'That’s already your email.' });
    if (tooManyEmailChanges(req.user.id))
      return res.status(429).json({ error: 'Too many tries. Wait an hour, then try again.' });
    if (!(await passwordOk(req)))
      return res.status(400).json({ error: 'That password isn’t right. Check it and try again.' });
    // Same answer whether or not the address is taken, so this can't be used to find accounts.
    const { rowCount: taken } = await pool.query('SELECT 1 FROM users WHERE email = $1', [newEmail]);
    if (!taken) {
      const token = await createToken(
        req.user.id,
        'email_change',
        { newEmail, oldEmail: req.user.email },
        EMAIL_CHANGE_TTL_MS,
      );
      await sendEmail({
        to: newEmail,
        template: 'verify_email',
        data: { username: req.user.username, url: `${baseURL}/api/account/email/confirm?token=${token}` },
        userId: req.user.id,
      });
    }
    await logSecurityEvent(req.user.id, 'email_change_requested', {
      ...requestOrigin(req.headers),
      detail: maskEmail(newEmail),
    });
    res.json({ ok: true, sentTo: newEmail });
  }),
);

// Step 2: the link in that email. Switches the account to the new address and tells the old one.
router.get(
  '/email/confirm',
  wrap(async (req, res) => {
    const row = await useToken(req.query.token, 'email_change');
    if (!row) return res.redirect('/account?email=expired');
    const { newEmail, oldEmail } = row.data;
    let updated;
    try {
      updated = await pool.query(
        `UPDATE users SET email = $1, email_verified = true, updated_at = now() WHERE id = $2 AND email = $3
         RETURNING username`,
        [newEmail, row.user_id, oldEmail],
      );
    } catch (err) {
      if (err.code === '23505') return res.redirect('/account?email=taken'); // someone took it meanwhile
      throw err;
    }
    if (!updated.rowCount) return res.redirect('/account?email=expired');
    await logSecurityEvent(row.user_id, 'email_changed', {
      ...requestOrigin(req.headers),
      detail: `${maskEmail(oldEmail)} → ${maskEmail(newEmail)}`,
    });
    const undo = await createToken(row.user_id, 'email_undo', { newEmail, oldEmail }, EMAIL_UNDO_TTL_MS);
    await sendEmail({
      to: oldEmail,
      template: 'email_changed',
      data: {
        username: updated.rows[0].username,
        newEmail,
        undoUrl: `${baseURL}/api/account/email/undo?token=${undo}`,
      },
      userId: row.user_id,
    });
    res.redirect('/account?email=changed');
  }),
);

// The "This wasn't me" link sent to the old address: puts it back, signs out everywhere, and sends a
// link to choose a new password (whoever changed the email probably knows the old one).
router.get(
  '/email/undo',
  wrap(async (req, res) => {
    const row = await useToken(req.query.token, 'email_undo');
    if (!row) return res.redirect('/?email=undo-expired');
    const { newEmail, oldEmail } = row.data;
    try {
      const { rowCount } = await pool.query(
        `UPDATE users SET email = $1, email_verified = true, updated_at = now() WHERE id = $2 AND email = $3`,
        [oldEmail, row.user_id, newEmail],
      );
      if (!rowCount) return res.redirect('/?email=undo-expired');
    } catch (err) {
      if (err.code === '23505') return res.redirect('/?email=undo-expired');
      throw err;
    }
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    await pool.query(`UPDATE account_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [
      row.user_id,
    ]);
    await logSecurityEvent(row.user_id, 'email_change_undone', {
      ...requestOrigin(req.headers),
      detail: `${maskEmail(newEmail)} → ${maskEmail(oldEmail)}`,
    });
    await auth.api.requestPasswordReset({ body: { email: oldEmail, redirectTo: '/reset-password' } });
    res.redirect('/?email=restored');
  }),
);

// Linked YouTube and Rumble accounts (MBJ-215).
router.get(
  '/links',
  requireUser,
  wrap(async (req, res) => res.json(await linksFor(req.user.id))),
);

// { name }: their YouTube @handle or Rumble name. Waits for a moderator in Studio.
router.post(
  '/links/:platform',
  requireUser,
  wrap(async (req, res) => {
    const { platform } = req.params;
    if (!PLATFORMS.includes(platform)) return res.status(404).json({ error: 'Unknown platform.' });
    if (tooManyLinkRequests(req.user.id))
      return res.status(429).json({ error: 'Too many requests. Try again in an hour.' });
    try {
      await requestLink(req.user.id, platform, req.body?.name);
    } catch (err) {
      const where = platform === 'youtube' ? 'YouTube handle (like @name)' : 'Rumble name';
      if (err.message === 'bad-name')
        return res
          .status(400)
          .json({ error: `Enter your ${where}: letters, numbers, dots, dashes, or underscores.` });
      if (err.message === 'taken')
        return res
          .status(409)
          .json({ error: `That ${where.split(' (')[0]} is already linked to another member.` });
      throw err;
    }
    res.json(await linksFor(req.user.id));
  }),
);

// Unlink, or cancel a request.
router.delete(
  '/links/:platform',
  requireUser,
  wrap(async (req, res) => {
    if (!PLATFORMS.includes(req.params.platform)) return res.status(404).json({ error: 'Unknown platform.' });
    await pool.query('DELETE FROM linked_accounts WHERE user_id = $1 AND platform = $2', [
      req.user.id,
      req.params.platform,
    ]);
    res.json(await linksFor(req.user.id));
  }),
);

// Blocked and muted members (MBJ-119).
router.get(
  '/blocks',
  requireUser,
  wrap(async (req, res) => res.json({ hidden: await hiddenBy(req.user.id) })),
);

// { kind: 'block' | 'mute' }
router.put(
  '/blocks/:username',
  requireUser,
  wrap(async (req, res) => {
    const kind = req.body?.kind;
    if (!['block', 'mute'].includes(kind)) return res.status(400).json({ error: 'Choose block or mute.' });
    try {
      await setBlock(req.user.id, req.params.username, kind);
    } catch (err) {
      const why = {
        'not-found': [404, 'No member with that name.'],
        self: [400, 'You can’t block yourself.'],
        staff: [
          400,
          'Moderators and JimBob can’t be blocked or muted. If one of them is a problem, report it.',
        ],
      }[err.message];
      if (why) return res.status(why[0]).json({ error: why[1] });
      throw err;
    }
    res.json({ hidden: await hiddenBy(req.user.id) });
  }),
);

router.delete(
  '/blocks/:username',
  requireUser,
  wrap(async (req, res) => {
    await removeBlock(req.user.id, req.params.username);
    res.json({ hidden: await hiddenBy(req.user.id) });
  }),
);

// What the member's public profile shares (MBJ-116).
router.get(
  '/profile',
  requireUser,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT profile_show_chat, profile_indexable FROM users WHERE id = $1',
      [req.user.id],
    );
    res.json({ showChat: rows[0].profile_show_chat, indexable: rows[0].profile_indexable });
  }),
);

router.put(
  '/profile',
  requireUser,
  wrap(async (req, res) => {
    const { showChat, indexable } = req.body || {};
    if (
      (showChat !== undefined && typeof showChat !== 'boolean') ||
      (indexable !== undefined && typeof indexable !== 'boolean')
    )
      return res.status(400).json({ error: 'Send { showChat?, indexable? } as true or false.' });
    const { rows } = await pool.query(
      `UPDATE users SET profile_show_chat = COALESCE($2, profile_show_chat), profile_indexable = COALESCE($3, profile_indexable)
       WHERE id = $1 RETURNING profile_show_chat, profile_indexable`,
      [req.user.id, showChat ?? null, indexable ?? null],
    );
    res.json({ showChat: rows[0].profile_show_chat, indexable: rows[0].profile_indexable });
  }),
);

// Download my data: everything we hold about the member as a JSON file.
router.get(
  '/export',
  requireUser,
  wrap(async (req, res) => {
    if (tooManyExports(req.user.id))
      return res.status(429).json({ error: 'Too many downloads. Wait an hour, then try again.' });
    const data = await exportData(req.user.id);
    const day = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="madebyjimbob-${req.user.username}-${day}.json"`);
    res.set('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify(data, null, 2));
  }),
);

// Delete my account: { password, deleteContent }. Signs out everywhere; erased in 30 days unless they sign in.
router.post(
  '/delete',
  requireUser,
  wrap(async (req, res) => {
    if (tooManyDeletes(req.user.id))
      return res.status(429).json({ error: 'Too many tries. Wait an hour, then try again.' });
    if (!(await passwordOk(req)))
      return res.status(400).json({ error: 'That password isn’t right. Check it and try again.' });
    const eraseOn = await requestDeletion(req.user, {
      deleteContent: req.body?.deleteContent === true,
      origin: requestOrigin(req.headers),
      siteUrl: baseURL,
    });
    res.json({ ok: true, eraseOn });
  }),
);

export default router;
