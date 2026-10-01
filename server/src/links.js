// Linked YouTube and Rumble accounts (MBJ-215). A member enters their name on that platform and a moderator
// confirms it in Studio (so nobody can claim someone else's name). For YouTube the channel id is looked up
// from imported chat and comments by handle and stored, so the link survives renames on YouTube; links whose
// channel hasn't been seen yet are filled in by the hourly job once that handle shows up in an import.
import { pool } from './db.js';
import { logger } from './logger.js';

export const PLATFORMS = ['youtube', 'rumble'];

// "@Handle", "Handle", or a youtube.com/@Handle / rumble.com/user/Handle link. YouTube handles are 3–30
// letters, numbers, underscores, hyphens, and periods; Rumble names are similar.
const NAME_RE = /^@?([A-Za-z0-9_.-]{2,50})$/;
export function parseName(platform, input) {
  let s = String(input || '').trim();
  const url = s.match(/(?:youtube\.com\/|rumble\.com\/(?:user\/|c\/)?)@?([A-Za-z0-9_.-]+)/i);
  if (url) s = url[1];
  const m = NAME_RE.exec(s);
  if (!m) return null;
  if (platform === 'youtube' && (m[1].length < 3 || m[1].length > 30)) return null;
  return platform === 'youtube' ? `@${m[1]}` : m[1];
}

export function linkRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    platform: r.platform,
    status: r.status,
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

// The YouTube channel behind a handle, from what's been imported: { channelId, handle (as YouTube shows it),
// messages } or null if that handle hasn't posted in JimBob's chat or comments yet.
export async function findYouTubeChannel(handle) {
  const { rows } = await pool.query(
    `SELECT author_channel_id, author_name, count(*)::int AS n FROM (
       SELECT author_channel_id, author_name FROM chat_messages
         WHERE source = 'youtube' AND lower(author_name) = lower($1) AND author_channel_id IS NOT NULL
       UNION ALL
       SELECT author_channel_id, author_name FROM comments
         WHERE source = 'youtube' AND lower(author_name) = lower($1) AND author_channel_id IS NOT NULL
     ) x GROUP BY 1, 2 ORDER BY n DESC LIMIT 1`,
    [handle],
  );
  return rows[0]
    ? { channelId: rows[0].author_channel_id, handle: rows[0].author_name, messages: rows[0].n }
    : null;
}

// The id a link matches messages by: YouTube channel id (when known), lower-cased Rumble name.
async function externalIdFor(platform, handle) {
  if (platform === 'rumble') return handle.toLowerCase();
  return (await findYouTubeChannel(handle))?.channelId || null;
}

// Throws 'bad-name' or 'taken'.
export async function requestLink(userId, platform, input) {
  const handle = parseName(platform, input);
  if (!handle) throw new Error('bad-name');
  const found = platform === 'youtube' ? await findYouTubeChannel(handle) : null;
  const shown = found?.handle || handle;
  const externalId = platform === 'youtube' ? found?.channelId || null : handle.toLowerCase();
  const { rowCount: taken } = await pool.query(
    `SELECT 1 FROM linked_accounts WHERE platform = $1 AND status = 'verified' AND user_id <> $2
       AND (lower(handle) = lower($3) OR (external_id IS NOT NULL AND external_id = $4))`,
    [platform, userId, shown, externalId],
  );
  if (taken) throw new Error('taken');
  const { rows } = await pool.query(
    `INSERT INTO linked_accounts (user_id, platform, status, external_id, handle)
     VALUES ($1, $2, 'pending', $3, $4)
     ON CONFLICT (user_id, platform) DO UPDATE SET status = 'pending', external_id = EXCLUDED.external_id,
       handle = EXCLUDED.handle, verified_by = NULL, verified_at = NULL, created_at = now()
     RETURNING *`,
    [userId, platform, externalId, shown],
  );
  return linkRow(rows[0]);
}

// Studio: confirm a request. Looks the YouTube channel up again (it may have posted since). Throws 'taken'.
export async function approveLink(id) {
  const { rows } = await pool.query(`SELECT * FROM linked_accounts WHERE id = $1 AND status = 'pending'`, [
    id,
  ]);
  const link = rows[0];
  if (!link) return false;
  const externalId = link.external_id || (await externalIdFor(link.platform, link.handle));
  try {
    await pool.query(
      `UPDATE linked_accounts SET status = 'verified', external_id = $2, verified_by = 'admin', verified_at = now()
       WHERE id = $1`,
      [id, externalId],
    );
  } catch (err) {
    if (err.code === '23505') throw new Error('taken');
    throw err;
  }
  return true;
}

// Confirmed YouTube links whose channel hadn't been seen yet: fill in the channel id once it shows up.
export async function resolvePendingChannels() {
  const { rows } = await pool.query(
    `SELECT id, handle FROM linked_accounts WHERE platform = 'youtube' AND external_id IS NULL`,
  );
  let resolved = 0;
  for (const link of rows) {
    const found = await findYouTubeChannel(link.handle);
    if (!found) continue;
    try {
      await pool.query(`UPDATE linked_accounts SET external_id = $2, handle = $3 WHERE id = $1`, [
        link.id,
        found.channelId,
        found.handle,
      ]);
      resolved += 1;
    } catch (err) {
      if (err.code !== '23505') throw err; // that channel is already linked to someone else
    }
  }
  return resolved;
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

export function startLinkCheckJob() {
  const run = () => resolvePendingChannels().catch((err) => logger.error({ err }, 'link check failed'));
  setInterval(run, 60 * 60 * 1000).unref();
}
