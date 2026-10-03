// Notifications: someone @mentioned you or replied to you, in chat or comments.
// Stored in `notifications`, sent instantly to the recipient's open tabs (WebSocket), and pushed to
// phones/browsers that turned on push (Web Push, when VAPID keys are configured).
import webpush from 'web-push';
import { pool } from './db.js';
import { logger } from './logger.js';
import { hidingFrom } from './blocks.js';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
export const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@madebyjimbob.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}
export const vapidPublicKey = pushEnabled ? VAPID_PUBLIC_KEY : null;

// Open sockets per signed-in user (registered by the WebSocket server).
const userSockets = new Map();

export function addUserSocket(userId, ws) {
  const key = String(userId);
  if (!userSockets.has(key)) userSockets.set(key, new Set());
  userSockets.get(key).add(ws);
}

export function removeUserSocket(userId, ws) {
  const set = userSockets.get(String(userId));
  if (!set) return;
  set.delete(ws);
  if (!set.size) userSockets.delete(String(userId));
}

export function notificationRow(r) {
  return {
    id: r.id,
    type: r.type,
    where: r.comment_id ? 'comment' : 'chat',
    videoId: r.video_id,
    videoTitle: r.video_title,
    actor: r.actor_name,
    excerpt: r.excerpt,
    offsetMs: r.offset_ms,
    commentId: r.comment_id,
    read: Boolean(r.read_at),
    createdAt: r.created_at,
  };
}

// Link a notification opens: the video at that moment (and the comment thread, for comments).
export function notificationUrl(n) {
  const params = new URLSearchParams();
  if (n.offsetMs !== null && n.offsetMs !== undefined) params.set('t', String(Math.floor(n.offsetMs / 1000)));
  if (n.commentId) params.set('comment', String(n.commentId));
  // Mentions and replies from the site are replay chat, hidden in Live only; show them.
  else params.set('chat', 'all');
  const q = params.toString();
  return `/watch/${n.videoId}${q ? `?${q}` : ''}`;
}

export function notificationText(n) {
  const place = n.where === 'comment' ? 'a comment' : 'chat';
  const title = n.type === 'reply' ? `${n.actor} replied to you` : `${n.actor} mentioned you in ${place}`;
  return { title, body: `${n.videoTitle ? `${n.videoTitle}: ` : ''}${n.excerpt}` };
}

async function push(userId, n) {
  if (!pushEnabled) return;
  const { rows } = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId],
  );
  const { title, body } = notificationText(n);
  const payload = JSON.stringify({ title, body, url: notificationUrl(n), tag: `n${n.id}` });
  await Promise.all(
    rows.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          {
            TTL: 60 * 60 * 24,
          },
        );
      } catch (err) {
        // 404/410: the browser dropped this subscription; forget it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        } else {
          logger.warn({ err, userId }, 'push failed');
        }
      }
    }),
  );
}

function deliver(userId, n, { bell = true, push: toPush = true } = {}) {
  const set = bell && userSockets.get(String(userId));
  if (set) {
    const data = JSON.stringify({ type: 'notify', notification: n });
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }
  if (toPush) push(userId, n).catch((err) => logger.warn({ err }, 'push failed'));
}

// Called after a comment is saved: a reply notifies the author of what was answered (and @mentions, when a caller
// passes them; none do since 2026-10-03, when chat and mentions stopped notifying). Never yourself, and one
// notification per person per post.
export async function notifyFor({
  videoId,
  videoTitle,
  actor,
  body,
  offsetMs,
  chatMessageId,
  commentId,
  mentions,
  replyToUserId,
}) {
  const recipients = new Map();
  if (replyToUserId && String(replyToUserId) !== String(actor.id))
    recipients.set(String(replyToUserId), 'reply');
  if (mentions?.length) {
    // Site usernames, and YouTube/Rumble handles linked to a member (MBJ-215).
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE lower(username) = ANY($1::text[])
       UNION SELECT user_id FROM linked_accounts
         WHERE status = 'verified' AND lower(ltrim(handle, '@')) = ANY($1::text[])`,
      [mentions],
    );
    for (const r of rows) {
      const id = String(r.id);
      if (id !== String(actor.id) && !recipients.has(id)) recipients.set(id, 'mention');
    }
  }
  if (!recipients.size) return [];
  // Nobody hears from someone they blocked or muted (MBJ-119).
  for (const id of await hidingFrom([...recipients.keys()], actor.id)) recipients.delete(id);
  if (!recipients.size) return [];

  // Account settings: the bell and push can each be off per type (a missing setting means on).
  const { rows: prefRows } = await pool.query(
    'SELECT id, notification_prefs FROM users WHERE id = ANY($1::bigint[])',
    [[...recipients.keys()]],
  );
  const prefsOf = new Map(prefRows.map((r) => [String(r.id), r.notification_prefs || {}]));
  const wants = (id, channel) => prefsOf.get(id)?.[recipients.get(id)]?.[channel] !== false;
  const ids = [...recipients.keys()].filter((id) => wants(id, 'site') || wants(id, 'push'));
  if (!ids.length) return [];
  const types = ids.map((id) => recipients.get(id));
  const inBell = ids.map((id) => wants(id, 'site'));
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, in_bell, video_id, chat_message_id, comment_id, actor_id, actor_name, excerpt, offset_ms)
     SELECT u, t, b, $4, $5, $6, $7, $8, $9, $10 FROM unnest($1::bigint[], $2::text[], $3::boolean[]) AS x(u, t, b)
     RETURNING *`,
    [
      ids,
      types,
      inBell,
      videoId,
      chatMessageId ?? null,
      commentId ?? null,
      actor.id,
      actor.username,
      body.slice(0, 140),
      offsetMs ?? null,
    ],
  );
  const created = rows.map((r) => notificationRow({ ...r, video_title: videoTitle }));
  rows.forEach((r, i) =>
    deliver(r.user_id, created[i], { bell: r.in_bell, push: wants(String(r.user_id), 'push') }),
  );
  return created;
}
