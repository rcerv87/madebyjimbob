import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { pool, migrate } from './db.js';
import { filterText, extractMentions } from './moderation.js';
import { playback } from './stream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TIER_RANK = { free: 0, plus: 1, premium: 2 };
const CHAT_WINDOW_MAX = 3000;

const app = express();
app.use(express.json({ limit: '50kb' }));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function currentUser(req) {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const { rows } = await pool.query(
    'SELECT id, username, tier, xp FROM users WHERE session_token = $1',
    [h.slice(7)]
  );
  return rows[0] || null;
}

const canWatch = (user, video) => TIER_RANK[user?.tier || 'free'] >= TIER_RANK[video.min_tier];

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

// ---------- session (POC: pick a username + test tier; real auth comes later) ----------
app.post('/api/session', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Use 3–32 letters, numbers, or underscores.' });
  }
  const tier = TIER_RANK[req.body.tier] !== undefined ? req.body.tier : 'free';
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO users (username, tier, session_token) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET tier = EXCLUDED.tier, session_token = EXCLUDED.session_token
     RETURNING id, username, tier, xp`,
    [username, tier, token]
  );
  res.json({ token, user: rows[0] });
}));

app.get('/api/me', wrap(async (req, res) => {
  res.json({ user: await currentUser(req) });
}));

// ---------- videos ----------
app.get('/api/videos', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*, (SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count
    FROM videos v ORDER BY v.published_at DESC NULLS LAST, v.id DESC`);
  res.json({ videos: rows.map(videoCard) });
}));

app.get('/api/videos/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*, (SELECT count(*) FROM chat_messages c WHERE c.video_id = v.id AND NOT c.hidden) AS chat_count
    FROM videos v WHERE v.id = $1`, [req.params.id]);
  const v = rows[0];
  if (!v) return res.status(404).json({ error: 'Video not found.' });
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
}));

app.post('/api/videos/:id/view', wrap(async (req, res) => {
  await pool.query('UPDATE videos SET views = views + 1 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Chat for a time window of the video: ?from=ms&to=ms
app.get('/api/videos/:id/chat', wrap(async (req, res) => {
  const from = Math.max(0, Number(req.query.from) || 0);
  const to = Number(req.query.to) || from + 120_000;
  const { rows } = await pool.query(
    `SELECT * FROM chat_messages
     WHERE video_id = $1 AND NOT hidden AND offset_ms >= $2 AND offset_ms < $3
     ORDER BY offset_ms, id LIMIT $4`,
    [req.params.id, from, to, CHAT_WINDOW_MAX]
  );
  res.json({ messages: rows.map(chatRow) });
}));

// Post a chat at the viewer's current position in the video
const lastPost = new Map();
app.post('/api/videos/:id/chat', wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to chat.' });

  const now = Date.now();
  if (now - (lastPost.get(user.id) || 0) < 1500) {
    return res.status(429).json({ error: 'Slow down — one message every 1.5 seconds.' });
  }

  const body = filterText(req.body.text || '').slice(0, 200);
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  const offsetMs = Math.max(0, Math.round(Number(req.body.offsetMs) || 0));

  const { rows } = await pool.query(
    `INSERT INTO chat_messages (video_id, source, user_id, author_name, body, mentions, offset_ms, sent_at)
     VALUES ($1, 'native', $2, $3, $4, $5, $6, now()) RETURNING *`,
    [req.params.id, user.id, user.username, body, extractMentions(body), offsetMs]
  );
  await pool.query('UPDATE users SET xp = xp + 5 WHERE id = $1', [user.id]);
  lastPost.set(user.id, now);

  const msg = chatRow(rows[0]);
  broadcast(req.params.id, { type: 'chat', message: msg });
  res.json({ message: msg });
}));

// ---------- studio dashboard ----------
app.get('/api/studio/overview', wrap(async (_req, res) => {
  const [totals, perVideo, topChatters] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*) FROM videos)                                        AS videos,
        (SELECT coalesce(sum(views),0) FROM videos)                          AS views,
        (SELECT count(*) FROM chat_messages WHERE source = 'youtube')        AS youtube_msgs,
        (SELECT count(*) FROM chat_messages WHERE source = 'native')         AS native_msgs,
        (SELECT count(*) FROM chat_messages WHERE kind = 'paid')             AS paid_msgs,
        (SELECT count(DISTINCT author_name) FROM chat_messages)              AS chatters`),
    pool.query(`
      SELECT v.id, v.title, v.published_at, v.views, v.min_tier, v.duration_s,
        count(c.*) FILTER (WHERE c.source = 'youtube') AS youtube_msgs,
        count(c.*) FILTER (WHERE c.source = 'native')  AS native_msgs,
        count(c.*) FILTER (WHERE c.kind = 'paid')      AS paid_msgs
      FROM videos v LEFT JOIN chat_messages c ON c.video_id = v.id
      GROUP BY v.id ORDER BY v.published_at DESC NULLS LAST`),
    pool.query(`
      SELECT author_name, source, count(*) AS msgs, count(*) FILTER (WHERE kind = 'paid') AS paid
      FROM chat_messages GROUP BY author_name, source ORDER BY msgs DESC LIMIT 15`),
  ]);
  const t = totals.rows[0];
  res.json({
    totals: {
      videos: Number(t.videos), views: Number(t.views), youtubeMsgs: Number(t.youtube_msgs),
      nativeMsgs: Number(t.native_msgs), paidMsgs: Number(t.paid_msgs), chatters: Number(t.chatters),
    },
    videos: perVideo.rows.map((r) => ({
      id: r.id, title: r.title, publishedAt: r.published_at, views: r.views, minTier: r.min_tier,
      durationS: r.duration_s, youtubeMsgs: Number(r.youtube_msgs), nativeMsgs: Number(r.native_msgs),
      paidMsgs: Number(r.paid_msgs),
    })),
    topChatters: topChatters.rows.map((r) => ({
      author: r.author_name, source: r.source, msgs: Number(r.msgs), paid: Number(r.paid),
    })),
  });
}));

app.patch('/api/studio/videos/:id', wrap(async (req, res) => {
  const { minTier } = req.body;
  if (TIER_RANK[minTier] === undefined) return res.status(400).json({ error: 'Unknown tier.' });
  await pool.query('UPDATE videos SET min_tier = $1 WHERE id = $2', [minTier, req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

function broadcast(videoId, payload) {
  const room = rooms.get(String(videoId));
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const ws of room) if (ws.readyState === 1) ws.send(data);
}

wss.on('connection', (ws) => {
  let joined = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'join') {
      if (joined) rooms.get(joined)?.delete(ws);
      joined = String(msg.videoId);
      if (!rooms.has(joined)) rooms.set(joined, new Set());
      rooms.get(joined).add(ws);
    }
  });
  ws.on('close', () => joined && rooms.get(joined)?.delete(ws));
});

await migrate();
server.listen(PORT, () => console.log(`MadeByJimBob running on :${PORT}`));
