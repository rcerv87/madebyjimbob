// Linked YouTube and Rumble accounts (MBJ-215). A member asks for a YouTube code, posts it as a comment or in
// live chat on JimBob's channel, and the next import (or the hourly check) links the channel that posted it.
// Matching is by channel id, so it keeps working when they rename on YouTube. The code message is hidden once
// used. Rumble names are confirmed by a moderator in Studio until Rumble chat is imported.
import crypto from 'crypto';
import { pool } from './db.js';
import { logger } from './logger.js';

export const CODE_TTL_DAYS = 14;
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
export const CODE_RE = /\bMBJ-([2-9A-HJKMNP-Z]{6})\b/gi;

export function newCode() {
  const bytes = crypto.randomBytes(6);
  return `MBJ-${[...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
}

// Rumble names: letters, numbers, underscores, dots, hyphens; stored lower-cased for matching.
export const RUMBLE_NAME_RE = /^@?([A-Za-z0-9_.-]{2,50})$/;

export function linkRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    platform: r.platform,
    status: r.status,
    code: r.status === 'pending' ? r.code : null,
    expiresAt: r.status === 'pending' ? r.expires_at : null,
    handle: r.handle,
    verifiedBy: r.verified_by,
    verifiedAt: r.verified_at,
    createdAt: r.created_at,
  };
}

export async function linksFor(userId) {
  const { rows } = await pool.query('SELECT * FROM linked_accounts WHERE user_id = $1', [userId]);
  const by = Object.fromEntries(rows.map((r) => [r.platform, linkRow(r)]));
  return { youtube: by.youtube || null, rumble: by.rumble || null };
}

// A code to post (the same one again while it's still good). Throws 'already-linked'.
export async function startYouTubeLink(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM linked_accounts WHERE user_id = $1 AND platform = 'youtube'`,
    [userId],
  );
  const existing = rows[0];
  if (existing?.status === 'verified') throw new Error('already-linked');
  if (existing && existing.expires_at > new Date()) return linkRow(existing);
  const { rows: saved } = await pool.query(
    `INSERT INTO linked_accounts (user_id, platform, status, code, expires_at)
     VALUES ($1, 'youtube', 'pending', $2, now() + make_interval(days => $3))
     ON CONFLICT (user_id, platform) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at,
       created_at = now()
     RETURNING *`,
    [userId, newCode(), CODE_TTL_DAYS],
  );
  return linkRow(saved[0]);
}

// Looks through YouTube chat and comments imported since the oldest open claim for posted codes, and links
// whoever posted each one. Returns how many links it made. Run after imports and hourly.
export async function verifyYouTubeCodes() {
  const { rows: pending } = await pool.query(
    `SELECT id, user_id, code, created_at FROM linked_accounts
     WHERE platform = 'youtube' AND status = 'pending' AND expires_at > now() ORDER BY created_at`,
  );
  if (!pending.length) return 0;
  const byCode = new Map(pending.map((p) => [p.code.toUpperCase(), p]));
  const { rows: posts } = await pool.query(
    `SELECT 'chat_messages' AS tbl, id, author_channel_id, author_name, body, created_at FROM chat_messages
       WHERE source = 'youtube' AND created_at >= $1 AND body ~* 'MBJ-[A-Z0-9]{6}'
     UNION ALL
     SELECT 'comments', id, author_channel_id, author_name, body, created_at FROM comments
       WHERE source = 'youtube' AND created_at >= $1 AND body ~* 'MBJ-[A-Z0-9]{6}'
     ORDER BY created_at`,
    [pending[0].created_at],
  );
  let linked = 0;
  for (const post of posts) {
    if (!post.author_channel_id) continue;
    for (const [, raw] of post.body.matchAll(CODE_RE)) {
      const claim = byCode.get(`MBJ-${raw.toUpperCase()}`);
      // The code has to have existed before this post was imported.
      if (!claim || post.created_at < claim.created_at) continue;
      byCode.delete(`MBJ-${raw.toUpperCase()}`);
      try {
        const { rowCount } = await pool.query(
          `UPDATE linked_accounts SET status = 'verified', external_id = $2, handle = $3, verified_by = 'code',
             verified_at = now(), code = NULL, expires_at = NULL
           WHERE id = $1 AND status = 'pending'`,
          [claim.id, post.author_channel_id, post.author_name],
        );
        if (!rowCount) continue;
        // The code isn't conversation; take it out of the replay.
        await pool.query(`UPDATE ${post.tbl} SET hidden = true WHERE id = $1`, [post.id]);
        linked += 1;
        logger.info({ userId: claim.user_id }, 'YouTube account linked');
      } catch (err) {
        // That channel is already linked to someone else; leave the claim open.
        if (err.code !== '23505') throw err;
        logger.warn({ userId: claim.user_id }, 'YouTube channel already linked to another member');
      }
    }
  }
  return linked;
}

export async function requestRumbleLink(userId, name) {
  const m = RUMBLE_NAME_RE.exec(String(name || '').trim());
  if (!m) throw new Error('bad-name');
  const handle = m[1];
  const key = handle.toLowerCase();
  const { rowCount: taken } = await pool.query(
    `SELECT 1 FROM linked_accounts WHERE platform = 'rumble' AND status = 'verified' AND external_id = $1
       AND user_id <> $2`,
    [key, userId],
  );
  if (taken) throw new Error('taken');
  const { rows } = await pool.query(
    `INSERT INTO linked_accounts (user_id, platform, status, external_id, handle)
     VALUES ($1, 'rumble', 'pending', $2, $3)
     ON CONFLICT (user_id, platform) DO UPDATE SET status = 'pending', external_id = EXCLUDED.external_id,
       handle = EXCLUDED.handle, verified_by = NULL, verified_at = NULL, created_at = now()
     RETURNING *`,
    [userId, key, handle],
  );
  return linkRow(rows[0]);
}

// Lower-cased handles (without @) that count as this member when someone @mentions them.
export async function linkedHandles(userId) {
  const { rows } = await pool.query(
    `SELECT lower(ltrim(handle, '@')) AS h FROM linked_accounts
     WHERE user_id = $1 AND status = 'verified' AND handle IS NOT NULL`,
    [userId],
  );
  return rows.map((r) => r.h);
}

// Hourly, in case codes arrive by an import that didn't run the check.
export function startLinkCheckJob() {
  const run = () => verifyYouTubeCodes().catch((err) => logger.error({ err }, 'link check failed'));
  setInterval(run, 60 * 60 * 1000).unref();
}
