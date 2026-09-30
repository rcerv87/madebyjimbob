import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { pool } from './db.js';
import { filterText, filterComment, extractMentions } from './moderation.js';
import { playback } from './stream.js';
import { logger, httpLogger } from './logger.js';
import {
  addUserSocket,
  removeUserSocket,
  notifyFor,
  notificationRow,
  pushEnabled,
  vapidPublicKey,
} from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIER_RANK = { free: 0, plus: 1, premium: 2 };
const CHAT_WINDOW_MAX = 3000;
const COMMENTS_PAGE = 20;
const COMMENT_MAX_CHARS = 2000;
const MAX_OFFSET_MS = 2_147_483_647; // chat_messages.offset_ms is INT
const ALLOW_TEST_TIERS = process.env.ALLOW_TEST_TIERS === 'true';
const ADMINS = new Set(
  (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean),
);

const app = express();
app.use(httpLogger);
app.use(express.json({ limit: '50kb' }));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

function publicUser(u) {
  if (!u) return null;
  const isAdmin = ADMINS.has(u.username.toLowerCase());
  // Admins see every tier so JimBob and mods can check gated videos.
  return { id: u.id, username: u.username, tier: isAdmin ? 'premium' : u.tier, xp: u.xp, isAdmin };
}

async function userByToken(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT id, username, tier, xp FROM users WHERE session_token = $1', [
    String(token),
  ]);
  return publicUser(rows[0]);
}

function currentUser(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? userByToken(h.slice(7)) : Promise.resolve(null);
}

const canWatch = (user, video) => TIER_RANK[user?.tier || 'free'] >= TIER_RANK[video.min_tier];

// Returns the video row, or null for unknown or malformed ids.
async function findVideo(id) {
  if (!/^\d{1,18}$/.test(String(id))) return null;
  const { rows } = await pool.query('SELECT id, title, min_tier, duration_s FROM videos WHERE id = $1', [id]);
  return rows[0] || null;
}

// Loads the video and checks the viewer's tier; sends the error response and returns null on failure.
async function watchableVideo(req, res, user) {
  const video = await findVideo(req.params.id);
  if (!video) {
    res.status(404).json({ error: 'Video not found.' });
    return null;
  }
  if (!canWatch(user, video)) {
    res.status(403).json({ error: 'This video is for members. Upgrade your tier to see its chat.' });
    return null;
  }
  return video;
}

async function requireAdmin(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to use Studio.' });
    if (!user.isAdmin) return res.status(403).json({ error: 'Studio is only for JimBob and mods.' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function videoCard(v) {
  return {
    id: v.id,
    title: v.title,
    kind: v.kind,
    durationS: v.duration_s,
    publishedAt: v.published_at,
    minTier: v.min_tier,
    views: v.views,
    chatCount: Number(v.chat_count || 0),
    thumbnail: playback(v.stream_uid)?.thumbnail || null,
  };
}

// What a reply quotes: the exact message or comment it answers (joined in as rt_* columns).
const replyTo = (r) =>
  r.rt_id ? { id: r.rt_id, author: r.rt_author, body: r.rt_body, offsetMs: r.rt_offset } : null;

const CHAT_SELECT = `SELECT m.*, rt.id AS rt_id, rt.author_name AS rt_author, left(rt.body, 140) AS rt_body,
    rt.offset_ms AS rt_offset
  FROM chat_messages m LEFT JOIN chat_messages rt ON rt.id = m.reply_to_id AND NOT rt.hidden`;

const COMMENT_SELECT = `SELECT c.*, rt.id AS rt_id, rt.author_name AS rt_author, left(rt.body, 140) AS rt_body,
    rt.offset_ms AS rt_offset,
    (SELECT count(*) FROM comments r WHERE r.parent_id = c.id AND NOT r.hidden) AS reply_count
  FROM comments c LEFT JOIN comments rt ON rt.id = c.reply_to_id AND NOT rt.hidden`;

function commentRow(r) {
  return {
    id: r.id,
    parentId: r.parent_id,
    replyTo: replyTo(r),
    offsetMs: r.offset_ms,
    replyCount: Number(r.reply_count || 0),
    source: r.source,
    author: r.author_name,
    authorPhoto: r.author_photo,
    isCreator: r.author_is_creator,
    body: r.body,
    likes: r.like_count,
    pinned: r.pinned,
    postedAt: r.posted_at,
  };
}

function chatRow(r) {
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    author: r.author_name,
    authorPhoto: r.author_photo,
    body: r.body,
    amount: r.amount_text,
    mentions: r.mentions,
    offsetMs: r.offset_ms,
    postedLive: r.posted_live,
    replyTo: replyTo(r),
  };
}

// ---------- session (MVP: username + password; real auth comes in MBJ-101) ----------
const failedSignIns = new Map(); // lowercased username -> { count, until }

app.get('/api/config', (_req, res) => res.json({ allowTestTiers: ALLOW_TEST_TIERS }));

app.post(
  '/api/session',
  wrap(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      return res.status(400).json({ error: 'Use 3–32 letters, numbers, or underscores.' });
    }
    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    }

    const key = username.toLowerCase();
    const lock = failedSignIns.get(key);
    if (lock && lock.count >= 10 && lock.until > Date.now()) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const testTier = ALLOW_TEST_TIERS && TIER_RANK[req.body.tier] !== undefined ? req.body.tier : null;
    const { rows: existing } = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE lower(username) = $1',
      [key],
    );

    let user;
    if (existing[0]) {
      const found = existing[0];
      // POC accounts have no password yet; the first sign-in sets it.
      if (found.password_hash && !(await checkPassword(password, found.password_hash))) {
        const n = lock && lock.until > Date.now() ? lock.count + 1 : 1;
        failedSignIns.set(key, { count: n, until: Date.now() + 15 * 60_000 });
        return res.status(401).json({ error: 'That username is taken, or the password is wrong.' });
      }
      failedSignIns.delete(key);
      const hash = found.password_hash || (await hashPassword(password));
      const { rows } = await pool.query(
        `UPDATE users SET session_token = $1, password_hash = $2, tier = COALESCE($3, tier)
       WHERE id = $4 RETURNING id, username, tier, xp`,
        [token, hash, testTier, found.id],
      );
      user = rows[0];
    } else {
      const { rows } = await pool.query(
        `INSERT INTO users (username, tier, session_token, password_hash) VALUES ($1, $2, $3, $4)
       RETURNING id, username, tier, xp`,
        [username, testTier || 'free', token, await hashPassword(password)],
      );
      user = rows[0];
    }
    res.json({ token, user: publicUser(user) });
  }),
);

app.delete(
  '/api/session',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (user) await pool.query('UPDATE users SET session_token = NULL WHERE id = $1', [user.id]);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/me',
  wrap(async (req, res) => {
    res.json({ user: await currentUser(req) });
  }),
);

// ---------- videos ----------
// Dashboard: ?kind=video|short|live &members=1 &q=search &sort=new|old|views
// Also returns counts per filter chip for the current search.
const VIDEO_SORTS = {
  new: 'v.published_at DESC NULLS LAST, v.id DESC',
  old: 'v.published_at ASC NULLS LAST, v.id ASC',
  views: 'v.views DESC, v.published_at DESC NULLS LAST, v.id DESC',
};
const likePattern = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

app.get(
  '/api/videos',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    const kind = ['video', 'short', 'live'].includes(req.query.kind) ? req.query.kind : null;
    const members = req.query.members === '1';
    const q = String(req.query.q || '')
      .trim()
      .slice(0, 100);
    const pattern = q ? likePattern(q) : null;
    const order = VIDEO_SORTS[req.query.sort] || VIDEO_SORTS.new;
    const search = `($1::text IS NULL OR v.title ILIKE $1 OR v.description ILIKE $1)`;
    const [list, counts] = await Promise.all([
      pool.query(
        `SELECT v.*, wp.position_ms AS progress_ms,
           (SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count
         FROM videos v LEFT JOIN watch_progress wp ON wp.video_id = v.id AND wp.user_id = $2
         WHERE ${search} AND ($3::text IS NULL OR v.kind = $3) AND (NOT $4 OR v.min_tier <> 'free')
         ORDER BY ${order}`,
        [pattern, user?.id ?? null, kind, members],
      ),
      pool.query(
        `SELECT count(*) AS all,
           count(*) FILTER (WHERE kind = 'video') AS video,
           count(*) FILTER (WHERE kind = 'short') AS short,
           count(*) FILTER (WHERE kind = 'live') AS live,
           count(*) FILTER (WHERE min_tier <> 'free') AS members
         FROM videos v WHERE ${search}`,
        [pattern],
      ),
    ]);
    const c = counts.rows[0];
    res.json({
      videos: list.rows.map((v) => ({ ...videoCard(v), progressMs: v.progress_ms ?? null })),
      counts: {
        all: Number(c.all),
        video: Number(c.video),
        short: Number(c.short),
        live: Number(c.live),
        members: Number(c.members),
      },
    });
  }),
);

// ---------- playlists ----------
// A playlist item matches a video by id (made in Studio) or by YouTube id (imported; the video may
// arrive later). Viewers only see items whose video is on the site.
const PLAYLIST_VIDEOS = `playlist_items pi
  JOIN videos v ON v.id = pi.video_id OR (pi.video_id IS NULL AND v.youtube_id = pi.youtube_id)`;

function playlistCard(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    source: r.source,
    videoCount: Number(r.video_count || 0),
    durationS: Number(r.duration_s || 0),
    thumbnail: playback(r.first_stream_uid)?.thumbnail || null,
    firstVideoId: r.first_video_id ?? null,
    updatedAt: r.updated_at,
  };
}

const PLAYLIST_SUMMARY = `SELECT p.*,
    (SELECT count(*) FROM ${PLAYLIST_VIDEOS} WHERE pi.playlist_id = p.id) AS video_count,
    (SELECT coalesce(sum(v.duration_s), 0) FROM ${PLAYLIST_VIDEOS} WHERE pi.playlist_id = p.id) AS duration_s,
    (SELECT v.stream_uid FROM ${PLAYLIST_VIDEOS} WHERE pi.playlist_id = p.id ORDER BY pi.position LIMIT 1)
      AS first_stream_uid,
    (SELECT v.id FROM ${PLAYLIST_VIDEOS} WHERE pi.playlist_id = p.id ORDER BY pi.position LIMIT 1)
      AS first_video_id
  FROM playlists p`;

app.get(
  '/api/playlists',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(`${PLAYLIST_SUMMARY} ORDER BY p.updated_at DESC, p.id DESC`);
    res.json({ playlists: rows.map(playlistCard).filter((p) => p.videoCount > 0) });
  }),
);

async function playlistVideos(playlistId, userId) {
  const { rows } = await pool.query(
    `SELECT v.*, pi.position, wp.position_ms AS progress_ms,
       (SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count
     FROM ${PLAYLIST_VIDEOS}
     LEFT JOIN watch_progress wp ON wp.video_id = v.id AND wp.user_id = $2
     WHERE pi.playlist_id = $1 ORDER BY pi.position`,
    [playlistId, userId ?? null],
  );
  return rows.map((v) => ({ ...videoCard(v), progressMs: v.progress_ms ?? null }));
}

app.get(
  '/api/playlists/:id',
  wrap(async (req, res) => {
    if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Playlist not found.' });
    const { rows } = await pool.query(`${PLAYLIST_SUMMARY} WHERE p.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Playlist not found.' });
    const user = await currentUser(req);
    res.json({ playlist: playlistCard(rows[0]), videos: await playlistVideos(rows[0].id, user?.id) });
  }),
);

app.get(
  '/api/videos/:id',
  wrap(async (req, res) => {
    if (!(await findVideo(req.params.id))) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query(
      `
    SELECT v.*, (SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count
    FROM videos v WHERE v.id = $1`,
      [req.params.id],
    );
    const v = rows[0];
    const user = await currentUser(req);
    const allowed = canWatch(user, v);
    const progress = user
      ? await pool.query('SELECT position_ms FROM watch_progress WHERE user_id = $1 AND video_id = $2', [
          user.id,
          v.id,
        ])
      : { rows: [] };
    res.json({
      video: {
        ...videoCard(v),
        description: v.description,
        youtubeId: v.youtube_id,
        locked: !allowed,
        hls: allowed ? playback(v.stream_uid)?.hls : null,
        resumeMs: progress.rows[0]?.position_ms ?? null,
      },
    });
  }),
);

app.post(
  '/api/videos/:id/view',
  wrap(async (req, res) => {
    if (!(await findVideo(req.params.id))) return res.status(404).json({ error: 'Video not found.' });
    await pool.query('UPDATE videos SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }),
);

// Save where a signed-in viewer is in the video: { positionMs }. Signed-out viewers keep it locally.
app.put(
  '/api/videos/:id/progress',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to save your place across devices.' });
    const video = await findVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const n = Math.round(Number(req.body.positionMs));
    if (!Number.isFinite(n) || n < 0)
      return res.status(400).json({ error: 'positionMs must be a time in ms.' });
    const positionMs = Math.min(n, video.duration_s ? video.duration_s * 1000 : MAX_OFFSET_MS, MAX_OFFSET_MS);
    await pool.query(
      `INSERT INTO watch_progress (user_id, video_id, position_ms) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, video_id) DO UPDATE SET position_ms = EXCLUDED.position_ms, updated_at = now()`,
      [user.id, video.id, positionMs],
    );
    res.json({ positionMs });
  }),
);

// Chat for a time window of the video: ?from=ms&to=ms
// Or everything newer than a message id, for catching up after a reconnect: ?afterId=123
app.get(
  '/api/videos/:id/chat',
  wrap(async (req, res) => {
    const video = await watchableVideo(req, res, await currentUser(req));
    if (!video) return;
    if (req.query.afterId !== undefined) {
      if (!/^\d{1,18}$/.test(String(req.query.afterId))) {
        return res.status(400).json({ error: 'afterId must be a message id.' });
      }
      const { rows } = await pool.query(
        `${CHAT_SELECT} WHERE m.video_id = $1 AND NOT m.hidden AND m.id > $2 ORDER BY m.id LIMIT $3`,
        [video.id, req.query.afterId, CHAT_WINDOW_MAX],
      );
      return res.json({ messages: rows.map(chatRow) });
    }
    const from = Math.min(MAX_OFFSET_MS, Math.max(0, Number(req.query.from) || 0));
    const to = Math.min(MAX_OFFSET_MS, Number(req.query.to) || from + 120_000);
    // Timestamped comments in the same window show up in the chat feed as comment bubbles.
    const [chat, comments] = await Promise.all([
      pool.query(
        `${CHAT_SELECT} WHERE m.video_id = $1 AND NOT m.hidden AND m.offset_ms >= $2 AND m.offset_ms < $3
         ORDER BY m.offset_ms, m.id LIMIT $4`,
        [video.id, from, to, CHAT_WINDOW_MAX],
      ),
      pool.query(
        `${COMMENT_SELECT} WHERE c.video_id = $1 AND NOT c.hidden AND c.offset_ms >= $2 AND c.offset_ms < $3
         ORDER BY c.offset_ms, c.id LIMIT 500`,
        [video.id, from, to],
      ),
    ]);
    res.json({ messages: chat.rows.map(chatRow), comments: comments.rows.map(commentRow) });
  }),
);

// Post a chat at the viewer's current position in the video
const lastPost = new Map();
app.post(
  '/api/videos/:id/chat',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to chat.' });
    const video = await watchableVideo(req, res, user);
    if (!video) return;

    const body = filterText(req.body.text || '').slice(0, 200);
    if (!body) return res.status(400).json({ error: 'Type a message first.' });

    let target = null;
    if (req.body.replyToId !== undefined && req.body.replyToId !== null) {
      const { rows } = /^\d{1,18}$/.test(String(req.body.replyToId))
        ? await pool.query(
            `SELECT id, user_id, author_name, left(body, 140) AS body, offset_ms FROM chat_messages
             WHERE id = $1 AND video_id = $2 AND NOT hidden`,
            [req.body.replyToId, video.id],
          )
        : { rows: [] };
      if (!rows[0]) return res.status(400).json({ error: 'That message can’t be replied to.' });
      target = rows[0];
    }

    // Claim the slot before any await so parallel requests can't slip through.
    const now = Date.now();
    if (now - (lastPost.get(user.id) || 0) < 1500) {
      return res.status(429).json({ error: 'Slow down — one message every 1.5 seconds.' });
    }
    lastPost.set(user.id, now);

    const maxOffset = video.duration_s ? video.duration_s * 1000 : MAX_OFFSET_MS;
    const offsetMs = Math.min(
      maxOffset,
      MAX_OFFSET_MS,
      Math.max(0, Math.round(Number(req.body.offsetMs) || 0)),
    );

    // Live native chat arrives with Phase 3; until then every native post is replay chat.
    const { rows } = await pool.query(
      `INSERT INTO chat_messages
         (video_id, source, user_id, author_name, body, mentions, offset_ms, sent_at, posted_live, reply_to_id)
       VALUES ($1, 'native', $2, $3, $4, $5, $6, now(), false, $7) RETURNING *`,
      [video.id, user.id, user.username, body, extractMentions(body), offsetMs, target?.id ?? null],
    );
    await pool.query('UPDATE users SET xp = xp + 5 WHERE id = $1', [user.id]);

    const msg = chatRow({
      ...rows[0],
      rt_id: target?.id,
      rt_author: target?.author_name,
      rt_body: target?.body,
      rt_offset: target?.offset_ms,
    });
    broadcast(video.id, { type: 'chat', message: msg });
    res.json({ message: msg });
    notifyFor({
      videoId: video.id,
      videoTitle: video.title,
      actor: user,
      body,
      offsetMs,
      chatMessageId: rows[0].id,
      mentions: rows[0].mentions,
      replyToUserId: target?.user_id,
    }).catch((err) => logger.error({ err }, 'chat notifications failed'));
  }),
);

// ---------- comments ----------
// Top-level comments, a page at a time, each with all its replies: ?sort=top|new&offset=0
app.get(
  '/api/videos/:id/comments',
  wrap(async (req, res) => {
    const video = await watchableVideo(req, res, await currentUser(req));
    if (!video) return;
    const sort = req.query.sort === 'new' ? 'new' : 'top';
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    const order =
      sort === 'new'
        ? 'c.posted_at DESC, c.id DESC'
        : 'c.pinned DESC, c.like_count DESC, c.posted_at DESC, c.id DESC';
    const [page, totals] = await Promise.all([
      pool.query(
        `${COMMENT_SELECT} WHERE c.video_id = $1 AND c.parent_id IS NULL AND NOT c.hidden
         ORDER BY ${order} LIMIT $2 OFFSET $3`,
        [video.id, COMMENTS_PAGE, offset],
      ),
      pool.query(
        `SELECT count(*) AS total, count(*) FILTER (WHERE parent_id IS NULL) AS threads
         FROM comments WHERE video_id = $1 AND NOT hidden`,
        [video.id],
      ),
    ]);
    const ids = page.rows.map((r) => r.id);
    const replies = ids.length
      ? await pool.query(
          `${COMMENT_SELECT} WHERE c.parent_id = ANY($1::bigint[]) AND NOT c.hidden ORDER BY c.posted_at, c.id`,
          [ids],
        )
      : { rows: [] };
    const byParent = new Map(ids.map((id) => [id, []]));
    for (const r of replies.rows) byParent.get(r.parent_id)?.push(commentRow(r));
    const threads = Number(totals.rows[0].threads);
    res.json({
      total: Number(totals.rows[0].total),
      comments: page.rows.map((r) => ({ ...commentRow(r), replies: byParent.get(r.id) })),
      nextOffset: offset + page.rows.length < threads ? offset + page.rows.length : null,
    });
  }),
);

// One whole thread, given any comment in it (e.g. from a comment bubble in the chat).
app.get(
  '/api/videos/:id/comments/:commentId',
  wrap(async (req, res) => {
    const video = await watchableVideo(req, res, await currentUser(req));
    if (!video) return;
    if (!/^\d{1,18}$/.test(req.params.commentId))
      return res.status(404).json({ error: 'Comment not found.' });
    const found = await pool.query(
      'SELECT COALESCE(parent_id, id) AS thread_id FROM comments WHERE id = $1 AND video_id = $2 AND NOT hidden',
      [req.params.commentId, video.id],
    );
    if (!found.rows[0]) return res.status(404).json({ error: 'Comment not found.' });
    const threadId = found.rows[0].thread_id;
    const [top, replies] = await Promise.all([
      pool.query(`${COMMENT_SELECT} WHERE c.id = $1 AND NOT c.hidden`, [threadId]),
      pool.query(`${COMMENT_SELECT} WHERE c.parent_id = $1 AND NOT c.hidden ORDER BY c.posted_at, c.id`, [
        threadId,
      ]),
    ]);
    if (!top.rows[0]) return res.status(404).json({ error: 'Comment not found.' });
    res.json({ comment: { ...commentRow(top.rows[0]), replies: replies.rows.map(commentRow) } });
  }),
);

// Post a native comment: { text, offsetMs?, replyToId? }. replyToId can be any comment on the video;
// the reply joins that comment's thread and quotes it. (parentId is accepted as an older name.)
const lastComment = new Map();
app.post(
  '/api/videos/:id/comments',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to comment.' });
    const video = await watchableVideo(req, res, user);
    if (!video) return;

    const body = filterComment(req.body.text || '');
    if (!body) return res.status(400).json({ error: 'Write a comment first.' });
    if (body.length > COMMENT_MAX_CHARS) {
      return res.status(400).json({ error: `Keep comments under ${COMMENT_MAX_CHARS} characters.` });
    }

    let target = null;
    const replyToId = req.body.replyToId ?? req.body.parentId;
    if (replyToId !== undefined && replyToId !== null) {
      const { rows } = /^\d{1,18}$/.test(String(replyToId))
        ? await pool.query(
            `SELECT id, parent_id, user_id, author_name, left(body, 140) AS body, offset_ms FROM comments
             WHERE id = $1 AND video_id = $2 AND NOT hidden`,
            [replyToId, video.id],
          )
        : { rows: [] };
      if (!rows[0]) return res.status(400).json({ error: 'That comment can’t be replied to.' });
      target = rows[0];
    }

    let offsetMs = null;
    if (req.body.offsetMs !== undefined && req.body.offsetMs !== null) {
      const n = Math.round(Number(req.body.offsetMs));
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'That timestamp isn’t a valid time in the video.' });
      }
      offsetMs = Math.min(n, video.duration_s ? video.duration_s * 1000 : MAX_OFFSET_MS, MAX_OFFSET_MS);
    }

    const now = Date.now();
    if (now - (lastComment.get(user.id) || 0) < 5000) {
      return res.status(429).json({ error: 'Slow down — one comment every 5 seconds.' });
    }
    lastComment.set(user.id, now);

    const { rows } = await pool.query(
      `INSERT INTO comments (video_id, source, parent_id, reply_to_id, user_id, author_name, body, offset_ms)
       VALUES ($1, 'native', $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        video.id,
        target ? (target.parent_id ?? target.id) : null,
        target?.id ?? null,
        user.id,
        user.username,
        body,
        offsetMs,
      ],
    );
    const comment = {
      ...commentRow({
        ...rows[0],
        rt_id: target?.id,
        rt_author: target?.author_name,
        rt_body: target?.body,
        rt_offset: target?.offset_ms,
      }),
      replies: [],
    };
    // Timestamped comments also appear right away in the chat feed of everyone watching.
    if (offsetMs !== null) broadcast(video.id, { type: 'comment', comment });
    res.json({ comment });
    notifyFor({
      videoId: video.id,
      videoTitle: video.title,
      actor: user,
      body,
      offsetMs,
      commentId: rows[0].id,
      mentions: extractMentions(body),
      replyToUserId: target?.user_id,
    }).catch((err) => logger.error({ err }, 'comment notifications failed'));
  }),
);

// ---------- notifications ----------
app.get(
  '/api/notifications',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to see notifications.' });
    const [items, unread] = await Promise.all([
      pool.query(
        `SELECT n.*, v.title AS video_title FROM notifications n JOIN videos v ON v.id = n.video_id
         WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 30`,
        [user.id],
      ),
      pool.query('SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL', [user.id]),
    ]);
    res.json({ unread: Number(unread.rows[0].count), notifications: items.rows.map(notificationRow) });
  }),
);

// Mark read: { ids: [...] } for specific ones, or no ids for all.
app.post(
  '/api/notifications/read',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to see notifications.' });
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.filter((id) => /^\d{1,18}$/.test(String(id)))
      : null;
    await pool.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
      [user.id, ids],
    );
    res.json({ ok: true });
  }),
);

// ---------- push notifications (Web Push) ----------
app.get('/api/push/key', (_req, res) => res.json({ publicKey: vapidPublicKey }));

app.post(
  '/api/push/subscribe',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to turn on notifications.' });
    if (!pushEnabled)
      return res.status(503).json({ error: 'Push notifications aren’t set up on this server yet.' });
    const sub = req.body.subscription || {};
    const endpoint = String(sub.endpoint || '');
    const { p256dh, auth } = sub.keys || {};
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
      return res.status(400).json({ error: 'That push subscription isn’t valid.' });
    }
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [user.id, endpoint, String(p256dh), String(auth)],
    );
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/push/subscribe',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in first.' });
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [
      user.id,
      String(req.body.endpoint || ''),
    ]);
    res.json({ ok: true });
  }),
);

// ---------- studio dashboard (admins only) ----------
app.use('/api/studio', requireAdmin);

app.get(
  '/api/studio/overview',
  wrap(async (_req, res) => {
    const [totals, perVideo, topChatters] = await Promise.all([
      pool.query(`
      SELECT
        (SELECT count(*) FROM videos)                                                    AS videos,
        (SELECT coalesce(sum(views),0) FROM videos)                                      AS views,
        (SELECT count(*) FROM chat_messages WHERE source = 'youtube' AND NOT hidden)     AS youtube_msgs,
        (SELECT count(*) FROM chat_messages WHERE source = 'native' AND NOT hidden)      AS native_msgs,
        (SELECT count(*) FROM chat_messages WHERE kind = 'paid' AND NOT hidden)          AS paid_msgs,
        (SELECT count(DISTINCT author_name) FROM chat_messages WHERE NOT hidden)         AS chatters`),
      pool.query(`
      SELECT v.id, v.title, v.published_at, v.views, v.min_tier, v.duration_s,
        count(c.*) FILTER (WHERE c.source = 'youtube') AS youtube_msgs,
        count(c.*) FILTER (WHERE c.source = 'native')  AS native_msgs,
        count(c.*) FILTER (WHERE c.kind = 'paid')      AS paid_msgs
      FROM videos v LEFT JOIN chat_messages c ON c.video_id = v.id AND NOT c.hidden
      GROUP BY v.id ORDER BY v.published_at DESC NULLS LAST`),
      pool.query(`
      SELECT author_name, source, count(*) AS msgs, count(*) FILTER (WHERE kind = 'paid') AS paid
      FROM chat_messages WHERE NOT hidden
      GROUP BY author_name, source ORDER BY msgs DESC LIMIT 15`),
    ]);
    const t = totals.rows[0];
    res.json({
      totals: {
        videos: Number(t.videos),
        views: Number(t.views),
        youtubeMsgs: Number(t.youtube_msgs),
        nativeMsgs: Number(t.native_msgs),
        paidMsgs: Number(t.paid_msgs),
        chatters: Number(t.chatters),
      },
      videos: perVideo.rows.map((r) => ({
        id: r.id,
        title: r.title,
        publishedAt: r.published_at,
        views: r.views,
        minTier: r.min_tier,
        durationS: r.duration_s,
        youtubeMsgs: Number(r.youtube_msgs),
        nativeMsgs: Number(r.native_msgs),
        paidMsgs: Number(r.paid_msgs),
      })),
      topChatters: topChatters.rows.map((r) => ({
        author: r.author_name,
        source: r.source,
        msgs: Number(r.msgs),
        paid: Number(r.paid),
      })),
    });
  }),
);

app.patch(
  '/api/studio/videos/:id',
  wrap(async (req, res) => {
    const { minTier } = req.body;
    if (TIER_RANK[minTier] === undefined) return res.status(400).json({ error: 'Unknown tier.' });
    if (!(await findVideo(req.params.id))) return res.status(404).json({ error: 'Video not found.' });
    await pool.query('UPDATE videos SET min_tier = $1 WHERE id = $2', [minTier, req.params.id]);
    res.json({ ok: true });
  }),
);

// Studio playlists: JimBob's own playlists are editable; imported YouTube ones stay in sync with
// YouTube (re-run the import) and are read-only here.
app.get(
  '/api/studio/playlists',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `${PLAYLIST_SUMMARY} ORDER BY p.source = 'native' DESC, p.updated_at DESC`,
    );
    const playlists = await Promise.all(
      rows.map(async (r) => ({ ...playlistCard(r), videos: await playlistVideos(r.id) })),
    );
    res.json({ playlists });
  }),
);

function playlistFields(body) {
  const title = body.title === undefined ? undefined : String(body.title).trim().slice(0, 150);
  const description =
    body.description === undefined ? undefined : String(body.description).trim().slice(0, 5000);
  return { title, description };
}

async function nativePlaylist(req, res) {
  if (!/^\d{1,18}$/.test(req.params.id)) {
    res.status(404).json({ error: 'Playlist not found.' });
    return null;
  }
  const { rows } = await pool.query('SELECT id, source FROM playlists WHERE id = $1', [req.params.id]);
  if (!rows[0]) {
    res.status(404).json({ error: 'Playlist not found.' });
    return null;
  }
  if (rows[0].source !== 'native') {
    res
      .status(409)
      .json({ error: 'This playlist comes from YouTube. Change it there and re-run the import.' });
    return null;
  }
  return rows[0];
}

app.post(
  '/api/studio/playlists',
  wrap(async (req, res) => {
    const { title, description } = playlistFields(req.body);
    if (!title) return res.status(400).json({ error: 'Give the playlist a title.' });
    const { rows } = await pool.query(
      `INSERT INTO playlists (source, title, description) VALUES ('native', $1, $2) RETURNING *`,
      [title, description || ''],
    );
    res.json({ playlist: playlistCard(rows[0]) });
  }),
);

app.patch(
  '/api/studio/playlists/:id',
  wrap(async (req, res) => {
    const p = await nativePlaylist(req, res);
    if (!p) return;
    const { title, description } = playlistFields(req.body);
    if (title !== undefined && !title) return res.status(400).json({ error: 'Give the playlist a title.' });
    await pool.query(
      `UPDATE playlists SET title = COALESCE($2, title), description = COALESCE($3, description),
         updated_at = now() WHERE id = $1`,
      [p.id, title ?? null, description ?? null],
    );
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/studio/playlists/:id',
  wrap(async (req, res) => {
    const p = await nativePlaylist(req, res);
    if (!p) return;
    await pool.query('DELETE FROM playlists WHERE id = $1', [p.id]);
    res.json({ ok: true });
  }),
);

// Replace the playlist's videos with this list, in this order: { videoIds: [...] }
app.put(
  '/api/studio/playlists/:id/items',
  wrap(async (req, res) => {
    const p = await nativePlaylist(req, res);
    if (!p) return;
    const ids = Array.isArray(req.body.videoIds) ? req.body.videoIds.map(String) : null;
    if (
      !ids ||
      ids.some((id) => !/^\d{1,18}$/.test(id)) ||
      new Set(ids).size !== ids.length ||
      ids.length > 500
    ) {
      return res.status(400).json({ error: 'videoIds must be a list of different video ids (up to 500).' });
    }
    const { rows } = await pool.query('SELECT count(*) FROM videos WHERE id = ANY($1::bigint[])', [ids]);
    if (Number(rows[0].count) !== ids.length)
      return res.status(400).json({ error: 'Some of those videos don’t exist.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM playlist_items WHERE playlist_id = $1', [p.id]);
      await client.query(
        `INSERT INTO playlist_items (playlist_id, position, video_id)
         SELECT $1, ord - 1, vid FROM unnest($2::bigint[]) WITH ORDINALITY AS x(vid, ord)`,
        [p.id, ids],
      );
      await client.query('UPDATE playlists SET updated_at = now() WHERE id = $1', [p.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true, count: ids.length });
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// ---------- web app ----------
const dist = path.join(__dirname, '../../web/dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body isn’t valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The request is too large.' });
  }
  res.err = err; // pino-http logs it, with stack, on the request's line
  res.status(500).json({
    error: `Something went wrong on the server. If it keeps happening, mention code ${req.id}.`,
  });
});

// ---------- realtime: one room per video ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const rooms = new Map();

function broadcast(videoId, payload) {
  const room = rooms.get(String(videoId));
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const ws of room) if (ws.readyState === 1) ws.send(data);
}

function leave(ws, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(ws);
  if (!room.size) rooms.delete(roomId);
}

wss.on('connection', (ws) => {
  let joined = null;
  let userId = null;
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // { type: 'auth', token }: receive this user's notifications on this socket.
    if (msg.type === 'auth') {
      try {
        const user = await userByToken(msg.token);
        if (userId) removeUserSocket(userId, ws);
        userId = user?.id ?? null;
        if (userId) addUserSocket(userId, ws);
      } catch (err) {
        logger.error({ err }, 'WebSocket auth failed');
      }
      return;
    }
    if (msg.type !== 'join') return;
    try {
      const video = await findVideo(msg.videoId);
      const user = await userByToken(msg.token);
      if (!video || !canWatch(user, video)) {
        ws.send(JSON.stringify({ type: 'error', error: 'You can’t join this chat.' }));
        return;
      }
      if (joined) leave(ws, joined);
      joined = String(video.id);
      if (!rooms.has(joined)) rooms.set(joined, new Set());
      rooms.get(joined).add(ws);
    } catch (err) {
      logger.error({ err, videoId: msg.videoId }, 'WebSocket join failed');
    }
  });
  ws.on('close', () => {
    if (joined) leave(ws, joined);
    if (userId) removeUserSocket(userId, ws);
  });
});

export { app, server, ADMINS };
