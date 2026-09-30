-- Notifications (MBJ-202): someone @mentioned you or replied to you, in chat or comments.
-- push_subscriptions: browsers/phones that asked for push notifications (Web Push).

-- Up Migration

CREATE TABLE notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('mention','reply')),
  video_id        BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  chat_message_id BIGINT REFERENCES chat_messages(id) ON DELETE CASCADE,
  comment_id      BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  actor_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name      TEXT NOT NULL,
  excerpt         TEXT NOT NULL,
  offset_ms       INT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (chat_message_id IS NOT NULL OR comment_id IS NOT NULL)
);
CREATE INDEX notifications_user_recent ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- Down Migration

DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS notifications;
