-- Block, mute, and report (MBJ-119). user_blocks: a member hides another member's chat, comments, and mentions
-- ('block' also stops them replying to you; 'mute' is invisible to them). reports: members flag a member, a chat
-- message, or a comment with a reason; mods work the queue in Studio.

-- Up Migration

CREATE TABLE user_blocks (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('block', 'mute')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id),
  CHECK (user_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked ON user_blocks (blocked_id);

CREATE TABLE reports (
  id              BIGSERIAL PRIMARY KEY,
  reporter_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_name     TEXT NOT NULL, -- kept if the account goes
  chat_message_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
  comment_id      BIGINT REFERENCES comments(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'impersonation', 'other')),
  details         TEXT,
  excerpt         TEXT, -- what the message said when reported
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  handled_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  handled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_open ON reports (created_at DESC) WHERE status = 'open';

-- Down Migration

DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS user_blocks;
