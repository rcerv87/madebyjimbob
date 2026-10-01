// Public profiles (MBJ-116): /@username shows who a member is and what they've said in public. Anyone can view
// one. Activity on videos the viewer can't watch (above their tier) is left out, the same as on the videos.
import { pool } from './db.js';

const TIER_RANK = { free: 0, plus: 1, premium: 2 };
const RECENT = 20;

export async function findProfile(username) {
  const { rows } = await pool.query(
    `SELECT id, username, display_name, image, tier, created_at, profile_show_chat, profile_indexable
     FROM users WHERE username_key = lower($1)`,
    [String(username || '')],
  );
  return rows[0] || null;
}

// The profile as the API returns it, for a viewer with this tier.
export async function profileFor(user, viewerTier = 'free') {
  const rank = TIER_RANK[viewerTier] ?? 0;
  const tiers = Object.keys(TIER_RANK).filter((t) => TIER_RANK[t] <= rank);
  const [links, comments, chat, counts] = await Promise.all([
    pool.query(
      `SELECT platform, handle FROM linked_accounts WHERE user_id = $1 AND status = 'verified' ORDER BY platform`,
      [user.id],
    ),
    pool.query(
      `SELECT c.id, c.video_id, v.title AS video_title, left(c.body, 280) AS body, c.offset_ms, c.posted_at,
              c.parent_id
       FROM comments c JOIN videos v ON v.id = c.video_id
       WHERE c.user_id = $1 AND NOT c.hidden AND v.min_tier = ANY($2::text[])
       ORDER BY c.posted_at DESC LIMIT ${RECENT}`,
      [user.id, tiers],
    ),
    user.profile_show_chat
      ? pool.query(
          `SELECT m.id, m.video_id, v.title AS video_title, left(m.body, 280) AS body, m.offset_ms, m.created_at
           FROM chat_messages m JOIN videos v ON v.id = m.video_id
           WHERE m.user_id = $1 AND NOT m.hidden AND v.min_tier = ANY($2::text[])
           ORDER BY m.created_at DESC LIMIT ${RECENT}`,
          [user.id, tiers],
        )
      : { rows: [] },
    pool.query(
      `SELECT (SELECT count(*)::int FROM comments WHERE user_id = $1 AND NOT hidden) AS comments,
              (SELECT count(*)::int FROM chat_messages WHERE user_id = $1 AND NOT hidden) AS chat`,
      [user.id],
    ),
  ]);
  return {
    username: user.username,
    displayName: user.display_name || user.username,
    image: user.image,
    // Only paid tiers show, as a badge (Free is everyone's default).
    tier: user.tier === 'free' ? null : user.tier,
    joinedAt: user.created_at,
    links: Object.fromEntries(links.rows.map((l) => [l.platform, l.handle])),
    counts: counts.rows[0],
    showsChat: user.profile_show_chat,
    comments: comments.rows.map((r) => ({
      id: r.id,
      videoId: r.video_id,
      videoTitle: r.video_title,
      body: r.body,
      offsetMs: r.offset_ms,
      isReply: Boolean(r.parent_id),
      postedAt: r.posted_at,
    })),
    chat: chat.rows.map((r) => ({
      id: r.id,
      videoId: r.video_id,
      videoTitle: r.video_title,
      body: r.body,
      offsetMs: r.offset_ms,
      postedAt: r.created_at,
    })),
  };
}
