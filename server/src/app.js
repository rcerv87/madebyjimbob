import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { pool } from './db.js';
import { filterText, filterComment, extractMentions } from './moderation.js';
import { playback, deleteFromStream, createDirectUpload, streamStatus, streamConfigured } from './stream.js';
import { queueImports, listImports, jobRow, helperStatus } from './imports.js';
import { parseChannel, requestListing, channelPage, JIMBOB_CHANNEL } from './channel.js';
import { logger, httpLogger } from './logger.js';
import { COLLECTIONS, collectionProducts, artPieces, shopUrl } from './shop.js';
import { pageMeta, renderPage } from './pages.js';
import { toNodeHandler } from 'better-auth/node';
import { auth, sessionUser, ADMIN_EMAILS } from './auth.js';
import accountRouter from './account.js';
import { viewerKey, recordView } from './views.js';
import { findProfile, profileFor } from './profiles.js';
import { hasBlocked, hiddenBy, fileReport, listReports } from './blocks.js';
import { linkedHandles, linkRow, approveLink, findYouTubeChannel } from './links.js';
import {
  addUserSocket,
  removeUserSocket,
  notifyFor,
  notificationRow,
  pushEnabled,
  vapidPublicKey,
} from './notify.js';
import {
  emailEnabled,
  emailFrom,
  sendEmail,
  normalizeEmail,
  verifyWebhook,
  recordEmailEvent,
} from './email.js';
import { TEMPLATES, maskEmail } from './emailTemplates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIER_RANK = { free: 0, plus: 1, premium: 2 };
const CHAT_WINDOW_MAX = 3000;
const COMMENTS_PAGE = 20;
const COMMENT_MAX_CHARS = 2000;
const MAX_OFFSET_MS = 2_147_483_647; // chat_messages.offset_ms is INT

const app = express();
// Behind Render's proxy: trust X-Forwarded-Proto so page URLs (link previews, canonical) use https.
app.set('trust proxy', 1);
app.use(httpLogger);
// The client IP as Express sees it behind Render's proxy, for Better Auth's rate limits and session list.
app.use((req, _res, next) => {
  req.headers['x-mbj-client-ip'] = req.ip;
  next();
});
// Confirmed accounts change email through /api/account/email (password, then an undo link to the old
// address); Better Auth's own change-email is only for accounts that haven't confirmed one yet.
app.post('/api/auth/change-email', async (req, res, next) => {
  try {
    const user = await sessionUser(req.headers);
    if (user?.emailVerified) {
      return res
        .status(403)
        .json({ code: 'USE_ACCOUNT_SETTINGS', message: 'Change your email from Account settings.' });
    }
    next();
  } catch (err) {
    next(err);
  }
});
// Sign-up, sign-in, sign-out, email verification, password reset (Better Auth reads its own body).
app.all('/api/auth/*', toNodeHandler(auth));
app.use(
  express.json({
    limit: '50kb',
    // Webhook signatures are over the exact bytes received.
    verify: (req, _res, buf) => {
      if (req.url.startsWith('/api/webhooks/')) req.rawBody = buf;
    },
  }),
);

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The signed-in user (session cookie, or `Authorization: Bearer` for tests and apps), or null.
const currentUser = (req) => sessionUser(req.headers);

const canWatch = (user, video) => TIER_RANK[user?.tier || 'free'] >= TIER_RANK[video.min_tier];

// A database id from a URL or body: digits only, and short enough for BIGINT.
const isId = (value) => /^\d{1,18}$/.test(String(value));
// Own keys only, so "constructor" or ["plus"] aren't taken for a tier.
const isTier = (value) => typeof value === 'string' && Object.hasOwn(TIER_RANK, value);
// Text from a JSON body; anything else (an object, a number) counts as empty rather than "[object Object]".
const textField = (value) => (typeof value === 'string' ? value : '');

// Returns the video row, or null for unknown or malformed ids.
async function findVideo(id) {
  if (!isId(id)) return null;
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

const CHAT_COUNT =
  '(SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count';
// What a video card needs (not the description, which can be long), plus its chat count.
const CARD_COLUMNS = `v.id, v.title, v.kind, v.duration_s, v.published_at, v.min_tier, v.views, v.stream_uid,
    ${CHAT_COUNT}`;

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

// Imported messages from a linked YouTube/Rumble account carry the member's site name and tier (MBJ-215).
const memberJoin = (
  alias,
) => `LEFT JOIN linked_accounts la ON la.status = 'verified' AND la.platform = ${alias}.source
    AND la.external_id = ${alias}.author_channel_id
  LEFT JOIN users lu ON lu.id = la.user_id`;

const CHAT_SELECT = `SELECT m.*, rt.id AS rt_id, rt.author_name AS rt_author, left(rt.body, 140) AS rt_body,
    rt.offset_ms AS rt_offset, lu.username AS member_name, lu.tier AS member_tier
  FROM chat_messages m LEFT JOIN chat_messages rt ON rt.id = m.reply_to_id AND NOT rt.hidden
  ${memberJoin('m')}`;

// Comments with what each one quotes (rt_*) and its reply count. `from` can narrow the rows first (one
// page of threads), so the quote join only touches those instead of every comment on the site.
const commentSelect = (from = 'comments') => `SELECT c.*, rt.id AS rt_id, rt.author_name AS rt_author,
    left(rt.body, 140) AS rt_body, rt.offset_ms AS rt_offset,
    (SELECT count(*) FROM comments r WHERE r.parent_id = c.id AND NOT r.hidden) AS reply_count,
    lu.username AS member_name, lu.tier AS member_tier
  FROM ${from} c LEFT JOIN comments rt ON rt.id = c.reply_to_id AND NOT rt.hidden
  ${memberJoin('c')}`;
const COMMENT_SELECT = commentSelect();

// The member behind a linked account: shown under their site name, with the platform name kept.
const member = (r) =>
  r.member_name ? { author: r.member_name, platformName: r.author_name, memberTier: r.member_tier } : {};
// The site member behind a message or comment, for their profile card (MBJ-116): native posts and linked accounts.
const profileOf = (r) => r.member_name || (r.source === 'native' && r.user_id ? r.author_name : null);

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
    profile: profileOf(r),
    ...member(r),
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
    profile: profileOf(r),
    ...member(r),
  };
}

// ---------- account ----------
app.get(
  '/api/me',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (user) {
      // Signing in called off a pending account deletion in the last few minutes: the site says so.
      const { rowCount } = await pool.query(
        `SELECT 1 FROM security_events WHERE user_id = $1 AND type = 'deletion_cancelled'
           AND created_at > now() - interval '10 minutes'`,
        [user.id],
      );
      user.deletionCancelled = rowCount > 0;
      user.linkedHandles = await linkedHandles(user.id);
      // Members this viewer blocked or muted: the web app hides their chat and comments (MBJ-119).
      user.hidden = await hiddenBy(user.id);
    }
    res.json({ user });
  }),
);

// Public profile (MBJ-116): anyone can view; activity on videos above the viewer's tier is left out.
app.get(
  '/api/profiles/:username',
  wrap(async (req, res) => {
    const found = await findProfile(req.params.username);
    if (!found) return res.status(404).json({ error: 'No member with that name.' });
    const viewer = await currentUser(req);
    res.json({ profile: await profileFor(found, viewer?.tier || 'free') });
  }),
);

// Report a member, or one of their chat messages or comments (MBJ-119): { username?, chatMessageId?,
// commentId?, reason, details? }. Mods work the queue in Studio.
const reportTries = new Map();
app.post(
  '/api/reports',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to report.' });
    const now = Date.now();
    const recent = (reportTries.get(user.id) || []).filter((t) => now - t < 60 * 60 * 1000);
    if (recent.length >= 10)
      return res.status(429).json({ error: 'That’s a lot of reports. Try again in an hour.' });
    recent.push(now);
    reportTries.set(user.id, recent);
    const { username, chatMessageId, commentId, reason, details } = req.body || {};
    if ((chatMessageId && !isId(chatMessageId)) || (commentId && !isId(commentId)))
      return res.status(400).json({ error: 'That message can’t be reported.' });
    try {
      const id = await fileReport(user.id, { username, chatMessageId, commentId, reason, details });
      res.json({ ok: true, id });
    } catch (err) {
      if (err.message === 'bad-reason')
        return res.status(400).json({ error: 'Pick a reason for the report.' });
      if (err.message === 'not-found')
        return res.status(404).json({ error: 'That member or message is gone.' });
      throw err;
    }
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
        `SELECT ${CARD_COLUMNS}, wp.position_ms AS progress_ms
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

// Playlist videos in order, as cards, keyed by playlist id: one playlist's, or every playlist's
// (playlistId null, for Studio) in a single query.
async function playlistVideos(playlistId, userId) {
  const { rows } = await pool.query(
    `SELECT ${CARD_COLUMNS}, pi.playlist_id, wp.position_ms AS progress_ms
     FROM ${PLAYLIST_VIDEOS}
     LEFT JOIN watch_progress wp ON wp.video_id = v.id AND wp.user_id = $2
     WHERE $1::bigint IS NULL OR pi.playlist_id = $1 ORDER BY pi.playlist_id, pi.position`,
    [playlistId ?? null, userId ?? null],
  );
  const byPlaylist = new Map();
  for (const v of rows) {
    const list = byPlaylist.get(String(v.playlist_id)) || [];
    list.push({ ...videoCard(v), progressMs: v.progress_ms ?? null });
    byPlaylist.set(String(v.playlist_id), list);
  }
  return byPlaylist;
}

app.get(
  '/api/playlists/:id',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Playlist not found.' });
    const [{ rows }, user] = await Promise.all([
      pool.query(`${PLAYLIST_SUMMARY} WHERE p.id = $1`, [req.params.id]),
      currentUser(req),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Playlist not found.' });
    const videos = await playlistVideos(rows[0].id, user?.id);
    res.json({ playlist: playlistCard(rows[0]), videos: videos.get(String(rows[0].id)) || [] });
  }),
);

app.get(
  '/api/videos/:id',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Video not found.' });
    const [{ rows }, user] = await Promise.all([
      pool.query(`SELECT v.*, ${CHAT_COUNT} FROM videos v WHERE v.id = $1`, [req.params.id]),
      currentUser(req),
    ]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'Video not found.' });
    const allowed = canWatch(user, v);
    const [progress, votes] = await Promise.all([
      user
        ? pool.query('SELECT position_ms FROM watch_progress WHERE user_id = $1 AND video_id = $2', [
            user.id,
            v.id,
          ])
        : { rows: [] },
      videoVotes(v.id, user?.id),
    ]);
    res.json({
      video: {
        ...videoCard(v),
        description: v.description,
        youtubeId: v.youtube_id,
        locked: !allowed,
        hls: allowed ? playback(v.stream_uid)?.hls : null,
        resumeMs: progress.rows[0]?.position_ms ?? null,
        likes: votes.likes,
        myVote: votes.myVote,
      },
    });
  }),
);

// Likes are public; dislikes only show in Studio (like YouTube). myVote: 1, -1, or 0.
async function videoVotes(videoId, userId) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE value = 1) AS likes, count(*) FILTER (WHERE value = -1) AS dislikes,
       coalesce(max(value) FILTER (WHERE user_id = $2), 0) AS my_vote
     FROM video_votes WHERE video_id = $1`,
    [videoId, userId ?? null],
  );
  return {
    likes: Number(rows[0].likes),
    dislikes: Number(rows[0].dislikes),
    myVote: Number(rows[0].my_vote),
  };
}

// Thumbs up / down: { value: 1 | -1 | 0 } (0 clears your vote).
app.post(
  '/api/videos/:id/vote',
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to like videos.' });
    const video = await watchableVideo(req, res, user);
    if (!video) return;
    const value = Number(req.body.value);
    if (![1, -1, 0].includes(value)) return res.status(400).json({ error: 'value must be 1, -1, or 0.' });
    if (value === 0) {
      await pool.query('DELETE FROM video_votes WHERE user_id = $1 AND video_id = $2', [user.id, video.id]);
    } else {
      await pool.query(
        `INSERT INTO video_votes (user_id, video_id, value) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, video_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [user.id, video.id, value],
      );
    }
    const votes = await videoVotes(video.id, user.id);
    res.json({ likes: votes.likes, myVote: votes.myVote });
  }),
);

app.post(
  '/api/videos/:id/view',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Video not found.' });
    // Once per viewer per video per day (MBJ-216): the account, or the browser id the web app sends.
    const user = await currentUser(req);
    const key = viewerKey({
      userId: user?.id,
      browserId: req.body?.viewer,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    const counted = await recordView(req.params.id, key);
    if (counted === null) return res.status(404).json({ error: 'Video not found.' });
    res.json({ ok: true, counted });
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
      if (!isId(req.query.afterId)) return res.status(400).json({ error: 'afterId must be a message id.' });
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

    const body = filterText(textField(req.body.text)).slice(0, 200);
    if (!body) return res.status(400).json({ error: 'Type a message first.' });

    let target = null;
    if (req.body.replyToId !== undefined && req.body.replyToId !== null) {
      const { rows } = isId(req.body.replyToId)
        ? await pool.query(
            `SELECT id, user_id, author_name, left(body, 140) AS body, offset_ms FROM chat_messages
             WHERE id = $1 AND video_id = $2 AND NOT hidden`,
            [req.body.replyToId, video.id],
          )
        : { rows: [] };
      if (!rows[0]) return res.status(400).json({ error: 'That message can’t be replied to.' });
      target = rows[0];
      if (await hasBlocked(target.user_id, user.id))
        return res.status(403).json({ error: 'You can’t reply to this person.' });
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
    const pageOfThreads = `(SELECT * FROM comments c WHERE c.video_id = $1 AND c.parent_id IS NULL
        AND NOT c.hidden ORDER BY ${order} LIMIT $2 OFFSET $3)`;
    const [page, totals] = await Promise.all([
      pool.query(`${commentSelect(pageOfThreads)} ORDER BY ${order}`, [video.id, COMMENTS_PAGE, offset]),
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
    if (!isId(req.params.commentId)) return res.status(404).json({ error: 'Comment not found.' });
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

    const body = filterComment(textField(req.body.text));
    if (!body) return res.status(400).json({ error: 'Write a comment first.' });
    if (body.length > COMMENT_MAX_CHARS) {
      return res.status(400).json({ error: `Keep comments under ${COMMENT_MAX_CHARS} characters.` });
    }

    let target = null;
    const replyToId = req.body.replyToId ?? req.body.parentId;
    if (replyToId !== undefined && replyToId !== null) {
      const { rows } = isId(replyToId)
        ? await pool.query(
            `SELECT id, parent_id, user_id, author_name, left(body, 140) AS body, offset_ms FROM comments
             WHERE id = $1 AND video_id = $2 AND NOT hidden`,
            [replyToId, video.id],
          )
        : { rows: [] };
      if (!rows[0]) return res.status(400).json({ error: 'That comment can’t be replied to.' });
      target = rows[0];
      if (await hasBlocked(target.user_id, user.id))
        return res.status(403).json({ error: 'You can’t reply to this person.' });
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

// ---------- shop and art (from JimBob's Shopify store) ----------
app.get('/api/shop/collections', (_req, res) =>
  res.json({ store: shopUrl(), collections: COLLECTIONS.map(({ handle, label }) => ({ handle, label })) }),
);

app.get(
  '/api/shop',
  wrap(async (req, res) => {
    const handle = COLLECTIONS.some((c) => c.handle === req.query.collection) ? req.query.collection : 'all';
    try {
      res.json({ store: shopUrl(), collection: handle, products: await collectionProducts(handle) });
    } catch (err) {
      req.log.warn({ err }, 'store unavailable');
      res.status(502).json({ error: 'The store isn’t responding right now. Try again in a minute.' });
    }
  }),
);

app.get(
  '/api/art',
  wrap(async (req, res) => {
    try {
      res.json({ store: shopUrl(), pieces: await artPieces() });
    } catch (err) {
      req.log.warn({ err }, 'store unavailable');
      res
        .status(502)
        .json({ error: 'The art gallery can’t reach the store right now. Try again in a minute.' });
    }
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
         WHERE n.user_id = $1 AND n.in_bell ORDER BY n.created_at DESC, n.id DESC LIMIT 30`,
        [user.id],
      ),
      pool.query('SELECT count(*) FROM notifications WHERE user_id = $1 AND in_bell AND read_at IS NULL', [
        user.id,
      ]),
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
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((id) => isId(id)) : null;
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

// ---------- email provider webhooks ----------
// Resend reports bounces and spam complaints here; those addresses never get mail again.
app.post(
  '/api/webhooks/resend',
  wrap(async (req, res) => {
    if (!verifyWebhook(req.rawBody, req.headers)) return res.status(401).json({ error: 'Bad signature.' });
    await recordEmailEvent(req.body);
    res.json({ ok: true });
  }),
);

// ---------- studio dashboard (admins only) ----------
app.use('/api/studio', requireAdmin);

app.get(
  '/api/studio/overview',
  wrap(async (_req, res) => {
    // Totals add up the per-video rows; only unique chatters needs its own pass over the chat.
    const [perVideo, chatters, topChatters] = await Promise.all([
      pool.query(`
      SELECT v.id, v.title, v.published_at, v.views, v.min_tier, v.duration_s, v.replacement_stream_uid,
        count(c.*) FILTER (WHERE c.source = 'youtube') AS youtube_msgs,
        count(c.*) FILTER (WHERE c.source = 'native')  AS native_msgs,
        count(c.*) FILTER (WHERE c.kind = 'paid')      AS paid_msgs,
        (SELECT count(*) FROM video_votes vv WHERE vv.video_id = v.id AND vv.value = 1)  AS likes,
        (SELECT count(*) FROM video_votes vv WHERE vv.video_id = v.id AND vv.value = -1) AS dislikes
      FROM videos v LEFT JOIN chat_messages c ON c.video_id = v.id AND NOT c.hidden
      GROUP BY v.id ORDER BY v.published_at DESC NULLS LAST`),
      pool.query('SELECT count(DISTINCT author_name) AS n FROM chat_messages WHERE NOT hidden'),
      pool.query(`
      SELECT author_name, source, count(*) AS msgs, count(*) FILTER (WHERE kind = 'paid') AS paid
      FROM chat_messages WHERE NOT hidden
      GROUP BY author_name, source ORDER BY msgs DESC LIMIT 15`),
    ]);
    const videos = perVideo.rows.map((r) => ({
      id: r.id,
      title: r.title,
      publishedAt: r.published_at,
      views: r.views,
      minTier: r.min_tier,
      replacing: Boolean(r.replacement_stream_uid),
      durationS: r.duration_s,
      youtubeMsgs: Number(r.youtube_msgs),
      nativeMsgs: Number(r.native_msgs),
      paidMsgs: Number(r.paid_msgs),
      likes: Number(r.likes),
      dislikes: Number(r.dislikes),
    }));
    const sum = (key) => videos.reduce((n, v) => n + v[key], 0);
    res.json({
      totals: {
        videos: videos.length,
        views: sum('views'),
        youtubeMsgs: sum('youtubeMsgs'),
        nativeMsgs: sum('nativeMsgs'),
        paidMsgs: sum('paidMsgs'),
        chatters: Number(chatters.rows[0].n),
      },
      videos,
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
    if (!isTier(minTier)) return res.status(400).json({ error: 'Unknown tier.' });
    const { rowCount } = isId(req.params.id)
      ? await pool.query('UPDATE videos SET min_tier = $1 WHERE id = $2', [minTier, req.params.id])
      : { rowCount: 0 };
    if (!rowCount) return res.status(404).json({ error: 'Video not found.' });
    res.json({ ok: true });
  }),
);

// Studio linked accounts (MBJ-215): requests waiting for a moderator (with how much that YouTube handle has
// posted, to help decide), and every confirmed link.
app.get(
  '/api/studio/links',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT la.*, u.username FROM linked_accounts la JOIN users u ON u.id = la.user_id
       ORDER BY la.status = 'pending' DESC, la.verified_at DESC NULLS LAST, la.created_at DESC LIMIT 200`,
    );
    const links = await Promise.all(
      rows.map(async (r) => {
        const seen =
          r.platform === 'youtube' && r.status === 'pending' ? await findYouTubeChannel(r.handle) : null;
        return { ...linkRow(r), username: r.username, messagesSeen: seen?.messages ?? null };
      }),
    );
    res.json({ links });
  }),
);

app.post(
  '/api/studio/links/:id/approve',
  wrap(async (req, res) => {
    if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'No such link.' });
    try {
      if (!(await approveLink(req.params.id)))
        return res.status(404).json({ error: 'That request is gone or already confirmed.' });
    } catch (err) {
      if (err.message === 'taken')
        return res.status(409).json({ error: 'That account is already linked to another member.' });
      throw err;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/studio/links/:id',
  wrap(async (req, res) => {
    if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'No such link.' });
    await pool.query('DELETE FROM linked_accounts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }),
);

// Studio reports (MBJ-119): the queue of reported members and messages; mods mark each handled or dismissed.
// (Hiding messages and banning come with the moderation tools, MBJ-204.)
app.get(
  '/api/studio/reports',
  wrap(async (req, res) => {
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    res.json({ reports: await listReports(status) });
  }),
);

app.post(
  '/api/studio/reports/:id',
  wrap(async (req, res) => {
    const status = req.body?.status;
    if (!['resolved', 'dismissed', 'open'].includes(status))
      return res.status(400).json({ error: 'Unknown status.' });
    if (!isId(req.params.id)) return res.status(404).json({ error: 'No such report.' });
    const { rowCount } = await pool.query(
      `UPDATE reports SET status = $2, handled_by = $3, handled_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END
       WHERE id = $1`,
      [req.params.id, status, req.user.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'No such report.' });
    res.json({ ok: true });
  }),
);

// Studio email: whether sending is on, the templates (preview and send a test), and recent sends.
// Addresses are masked; mods don't need members' full emails.
app.get(
  '/api/studio/email',
  wrap(async (_req, res) => {
    const [recent, suppressed] = await Promise.all([
      pool.query(
        'SELECT id, to_email, template, status, error, created_at FROM emails ORDER BY created_at DESC LIMIT 20',
      ),
      pool.query('SELECT count(*) FROM email_suppressions'),
    ]);
    res.json({
      enabled: emailEnabled,
      from: emailFrom,
      templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label })),
      suppressed: Number(suppressed.rows[0].count),
      recent: recent.rows.map((r) => ({
        id: r.id,
        to: maskEmail(r.to_email),
        template: r.template,
        status: r.status,
        error: r.error,
        createdAt: r.created_at,
      })),
    });
  }),
);

app.get(
  '/api/studio/email/preview/:template',
  wrap(async (req, res) => {
    const tpl = Object.hasOwn(TEMPLATES, req.params.template) && TEMPLATES[req.params.template];
    if (!tpl) return res.status(404).json({ error: 'No email template with that name.' });
    res.json(tpl.render(tpl.sample()));
  }),
);

app.post(
  '/api/studio/email/test',
  wrap(async (req, res) => {
    const { template } = req.body;
    const tpl = Object.hasOwn(TEMPLATES, String(template)) && TEMPLATES[template];
    if (!tpl) return res.status(400).json({ error: 'Pick one of the email templates.' });
    const to = normalizeEmail(req.body.to);
    if (!to) return res.status(400).json({ error: 'Enter an email address like name@example.com.' });
    const { status } = await sendEmail({ to, template, data: tpl.sample(), userId: req.user.id });
    res.json({ status });
  }),
);

// Delete a video (MBJ-701): from the site with its chat, comments, likes, progress, and notifications, and
// (removeFromStream) its file from Cloudflare Stream unless another video on the site uses the same file.
// Its spots in imported YouTube playlists are kept, so it reappears there if it's imported again.
app.delete(
  '/api/studio/videos/:id',
  wrap(async (req, res) => {
    const video = await findVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query('SELECT stream_uid FROM videos WHERE id = $1', [video.id]);
    const uid = rows[0]?.stream_uid;
    await pool.query(
      'UPDATE playlist_items SET video_id = NULL WHERE video_id = $1 AND youtube_id IS NOT NULL',
      [video.id],
    );
    await pool.query('DELETE FROM videos WHERE id = $1', [video.id]);
    req.log.info({ videoId: video.id, title: video.title }, 'video deleted');
    let stream = { deleted: false, reason: 'kept' };
    if (req.body?.removeFromStream !== false && uid) {
      const { rowCount: shared } = await pool.query('SELECT 1 FROM videos WHERE stream_uid = $1', [uid]);
      stream = shared
        ? { deleted: false, reason: 'shared' }
        : await deleteFromStream(uid).catch(() => ({
            deleted: false,
            reason: 'cloudflare-unreachable',
          }));
    }
    res.json({ ok: true, streamUid: uid || null, stream });
  }),
);

// Replace a video's file (MBJ-701), e.g. with JimBob's Takeout download, keeping its chat and comments.
// 1) POST { size, name } → a one-time Cloudflare upload URL the browser sends the file to directly.
// 2) GET (Studio polls) → Cloudflare's progress; once it's ready, the new file is swapped in and the old one deleted.
// 3) DELETE cancels.
const NEED_CF_KEYS =
  'Video files can’t be changed until CF_ACCOUNT_ID and CF_API_TOKEN are set on the server (Render → Environment).';

app.post(
  '/api/studio/videos/:id/replacement',
  wrap(async (req, res) => {
    const video = await findVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    if (!streamConfigured()) return res.status(503).json({ error: NEED_CF_KEYS });
    const size = Number(req.body?.size);
    if (!Number.isSafeInteger(size) || size <= 0)
      return res.status(400).json({ error: 'Pick a video file.' });
    const { uploadUrl, uid } = await createDirectUpload(size, req.body?.name || video.title);
    const { rows } = await pool.query(
      `UPDATE videos SET replacement_stream_uid = $2, replacement_started_at = now() WHERE id = $1
       RETURNING (SELECT replacement_stream_uid FROM videos WHERE id = $1) AS previous`,
      [video.id, uid],
    );
    // An unfinished earlier replacement is abandoned; delete its file.
    if (rows[0]?.previous && rows[0].previous !== uid) deleteFromStream(rows[0].previous).catch(() => {});
    res.json({ uploadUrl, uid });
  }),
);

app.get(
  '/api/studio/videos/:id/replacement',
  wrap(async (req, res) => {
    const video = await findVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query('SELECT stream_uid, replacement_stream_uid FROM videos WHERE id = $1', [
      video.id,
    ]);
    const { stream_uid: oldUid, replacement_stream_uid: newUid } = rows[0];
    if (!newUid) return res.json({ state: 'none' });
    if (!streamConfigured()) return res.status(503).json({ error: NEED_CF_KEYS });
    const status = await streamStatus(newUid);
    if (status.state === 'error') return res.json({ state: 'error', error: status.error });
    if (!status.ready) return res.json({ state: status.state, pct: status.pct });
    const { rowCount } = await pool.query(
      `UPDATE videos SET stream_uid = $2, replacement_stream_uid = NULL, replacement_started_at = NULL,
         duration_s = COALESCE($3, duration_s)
       WHERE id = $1 AND replacement_stream_uid = $2`,
      [video.id, newUid, status.duration ? Math.round(status.duration) : null],
    );
    if (rowCount && oldUid) {
      const { rowCount: shared } = await pool.query('SELECT 1 FROM videos WHERE stream_uid = $1', [oldUid]);
      if (!shared) await deleteFromStream(oldUid).catch(() => {});
    }
    req.log.info({ videoId: video.id }, 'video file replaced');
    res.json({ state: 'swapped' });
  }),
);

app.delete(
  '/api/studio/videos/:id/replacement',
  wrap(async (req, res) => {
    const video = await findVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query(
      `UPDATE videos SET replacement_stream_uid = NULL, replacement_started_at = NULL WHERE id = $1
       RETURNING (SELECT replacement_stream_uid FROM videos WHERE id = $1) AS pending`,
      [video.id],
    );
    if (rows[0]?.pending) await deleteFromStream(rows[0].pending).catch(() => {});
    res.json({ ok: true });
  }),
);

// Add videos (MBJ-701): YouTube links queued here; the import helper on Ruben's PC does the work.
app.get(
  '/api/studio/imports',
  wrap(async (_req, res) => res.json(await listImports())),
);

app.post(
  '/api/studio/imports',
  wrap(async (req, res) => {
    const { urls, tier = 'free', withComments = true } = req.body || {};
    // One link per line (or comma-separated).
    const lines = Array.isArray(urls) ? urls : String(urls || '').split(/[\r\n,]+/);
    if (TIER_RANK[tier] === undefined) return res.status(400).json({ error: 'Unknown tier.' });
    if (lines.length > 200) return res.status(400).json({ error: 'Up to 200 links at a time.' });
    const result = await queueImports(lines, {
      tier,
      withComments: withComments !== false,
      requestedBy: req.user.id,
    });
    if (!result.queued.length && !result.skipped.length)
      return res.status(400).json({ error: 'Paste one or more YouTube video links.' });
    res.json(result);
  }),
);

// From the channel (MBJ-706): the channel's videos, each marked on the site / queued / new, filtered and paged.
app.get(
  '/api/studio/channel',
  wrap(async (req, res) => {
    const channel = parseChannel(req.query.url || JIMBOB_CHANNEL);
    if (!channel)
      return res
        .status(400)
        .json({ error: 'Paste a YouTube channel link, like https://www.youtube.com/@name.' });
    const [page, helper] = await Promise.all([
      channelPage(channel, {
        show: req.query.show === 'all' ? 'all' : 'new',
        kind: String(req.query.kind || 'all'),
        q: String(req.query.q || '').slice(0, 100),
        offset: req.query.offset,
        limit: req.query.limit,
      }),
      helperStatus(),
    ]);
    res.json({ ...page, helper });
  }),
);

// Get a fresh list: right away with a YouTube API key, otherwise the import helper does it.
app.post(
  '/api/studio/channel/refresh',
  wrap(async (req, res) => {
    const channel = parseChannel(req.body?.url || JIMBOB_CHANNEL);
    if (!channel)
      return res
        .status(400)
        .json({ error: 'Paste a YouTube channel link, like https://www.youtube.com/@name.' });
    res.json({ listing: await requestListing(channel, req.user.id) });
  }),
);

// Try a failed import again.
app.post(
  '/api/studio/imports/:id/retry',
  wrap(async (req, res) => {
    if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'No such import.' });
    const { rows } = await pool.query(
      `UPDATE import_jobs SET status = 'queued', step = NULL, error = NULL, started_at = NULL, finished_at = NULL
       WHERE id = $1 AND status IN ('failed', 'cancelled') RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(409).json({ error: 'Only failed or cancelled imports can be retried.' });
    res.json({ job: jobRow(rows[0]) });
  }),
);

// Cancel a queued import, or clear a finished one from the list.
app.delete(
  '/api/studio/imports/:id',
  wrap(async (req, res) => {
    if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'No such import.' });
    const { rows } = await pool.query('SELECT status FROM import_jobs WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'No such import.' });
    if (rows[0].status === 'running')
      return res.status(409).json({ error: 'It’s importing right now. Stop the helper to cancel it.' });
    await pool.query('DELETE FROM import_jobs WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }),
);

// Studio playlists: JimBob's own playlists are editable; imported YouTube ones stay in sync with
// YouTube (re-run the import) and are read-only here.
app.get(
  '/api/studio/playlists',
  wrap(async (_req, res) => {
    const [{ rows }, videos] = await Promise.all([
      pool.query(`${PLAYLIST_SUMMARY} ORDER BY p.source = 'native' DESC, p.updated_at DESC`),
      playlistVideos(null),
    ]);
    res.json({
      playlists: rows.map((r) => ({ ...playlistCard(r), videos: videos.get(String(r.id)) || [] })),
    });
  }),
);

function playlistFields(body) {
  const title = body.title === undefined ? undefined : String(body.title).trim().slice(0, 150);
  const description =
    body.description === undefined ? undefined : String(body.description).trim().slice(0, 5000);
  return { title, description };
}

async function nativePlaylist(req, res) {
  if (!isId(req.params.id)) {
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
    if (!ids || ids.some((id) => !isId(id)) || new Set(ids).size !== ids.length || ids.length > 500) {
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

// ---------- account settings ----------
app.use('/api/account', accountRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// ---------- web app ----------
const dist = path.join(__dirname, '../../web/dist');
// Built JS/CSS have content hashes in their names, so browsers can keep them for a year.
app.use(
  '/assets',
  express.static(path.join(dist, 'assets'), { index: false, immutable: true, maxAge: '365d' }),
);
// Other static files (icons, brand art, manifest, service worker). index: false so "/" goes through
// renderPage below. The service worker must always be re-checked so updates reach people.
app.use(
  express.static(dist, {
    index: false,
    setHeaders(res, filePath) {
      if (/[\\/](sw\.js|manifest\.webmanifest)$/.test(filePath)) res.set('Cache-Control', 'no-cache');
      else if (/[\\/](icons|brand)[\\/]/.test(filePath)) res.set('Cache-Control', 'public, max-age=86400');
    },
  }),
);

app.get('/robots.txt', (_req, res) =>
  res.type('text/plain').send('User-agent: *\nDisallow: /studio\nDisallow: /api/\n'),
);

// Every app page: that page's title, description, and link-preview tags; 404 for unknown pages.
app.get(
  /^(?!\/api).*/,
  wrap(async (req, res) => {
    const siteUrl = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const indexing = process.env.ALLOW_INDEXING === 'true';
    const meta = await pageMeta(req.path);
    if (!indexing || meta.noindex) res.set('X-Robots-Tag', 'noindex');
    res
      .status(meta.status)
      .type('html')
      .send(renderPage(meta, { siteUrl, url: `${siteUrl}${req.originalUrl}`, indexing }));
  }),
);

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

// Who's on this socket: the session cookie sent with the upgrade (web), or a `token` in the message
// (apps and tests, same as a Bearer header).
wss.on('connection', (ws, req) => {
  let joined = null;
  let userId = null;
  const connectionUser = sessionUser(req.headers).catch(() => null);
  const userFor = (msg) =>
    msg.token ? sessionUser({ authorization: `Bearer ${String(msg.token)}` }) : connectionUser;
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // { type: 'auth' }: receive this user's notifications on this socket.
    if (msg.type === 'auth') {
      try {
        const user = await userFor(msg);
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
      const user = await userFor(msg);
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

export { app, server, wss, ADMIN_EMAILS };
