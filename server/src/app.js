import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { pool } from './db.js';
import { filterText, extractMentions } from './moderation.js';
import { playback } from './stream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIER_RANK = { free: 0, plus: 1, premium: 2 };
const CHAT_WINDOW_MAX = 3000;
const MAX_OFFSET_MS = 2_147_483_647; // chat_messages.offset_ms is INT
const ALLOW_TEST_TIERS = process.env.ALLOW_TEST_TIERS === 'true';
const ADMINS = new Set(
  (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean),
);

const app = express();
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
  const { rows } = await pool.query('SELECT id, min_tier, duration_s FROM videos WHERE id = $1', [id]);
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
    durationS: v.duration_s,
    publishedAt: v.published_at,
    minTier: v.min_tier,
    views: v.views,
    chatCount: Number(v.chat_count || 0),
    thumbnail: playback(v.stream_uid)?.thumbnail || null,
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
app.get(
  '/api/videos',
  wrap(async (_req, res) => {
    const { rows } = await pool.query(`
    SELECT v.*, (SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count
    FROM videos v ORDER BY v.published_at DESC NULLS LAST, v.id DESC`);
    res.json({ videos: rows.map(videoCard) });
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
    res.json({
      video: {
        ...videoCard(v),
        description: v.description,
        youtubeId: v.youtube_id,
        locked: !allowed,
        hls: allowed ? playback(v.stream_uid)?.hls : null,
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

// Chat for a time window of the video: ?from=ms&to=ms
app.get(
  '/api/videos/:id/chat',
  wrap(async (req, res) => {
    const video = await watchableVideo(req, res, await currentUser(req));
    if (!video) return;
    const from = Math.min(MAX_OFFSET_MS, Math.max(0, Number(req.query.from) || 0));
    const to = Math.min(MAX_OFFSET_MS, Number(req.query.to) || from + 120_000);
    const { rows } = await pool.query(
      `SELECT * FROM chat_messages
     WHERE video_id = $1 AND NOT hidden AND offset_ms >= $2 AND offset_ms < $3
     ORDER BY offset_ms, id LIMIT $4`,
      [video.id, from, to, CHAT_WINDOW_MAX],
    );
    res.json({ messages: rows.map(chatRow) });
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

    const { rows } = await pool.query(
      `INSERT INTO chat_messages (video_id, source, user_id, author_name, body, mentions, offset_ms, sent_at)
     VALUES ($1, 'native', $2, $3, $4, $5, $6, now()) RETURNING *`,
      [video.id, user.id, user.username, body, extractMentions(body), offsetMs],
    );
    await pool.query('UPDATE users SET xp = xp + 5 WHERE id = $1', [user.id]);

    const msg = chatRow(rows[0]);
    broadcast(video.id, { type: 'chat', message: msg });
    res.json({ message: msg });
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// ---------- web app ----------
const dist = path.join(__dirname, '../../web/dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
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
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
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
      console.error(err);
    }
  });
  ws.on('close', () => joined && leave(ws, joined));
});

export { app, server, ADMINS };
