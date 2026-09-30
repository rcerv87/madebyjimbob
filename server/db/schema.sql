CREATE TABLE IF NOT EXISTS users (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT UNIQUE NOT NULL,
  tier               TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','plus','premium')),
  youtube_channel_id TEXT,
  xp                 INT NOT NULL DEFAULT 0,
  session_token      TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  id           BIGSERIAL PRIMARY KEY,
  youtube_id   TEXT UNIQUE,
  stream_uid   TEXT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  duration_s   INT,
  published_at TIMESTAMPTZ,
  min_tier     TEXT NOT NULL DEFAULT 'free' CHECK (min_tier IN ('free','plus','premium')),
  views        INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One table for every chat source. offset_ms = position in the video,
-- which is what makes replay sync work for imported and native messages alike.
CREATE TABLE IF NOT EXISTS chat_messages (
  id                BIGSERIAL PRIMARY KEY,
  video_id          BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('youtube','rumble','native')),
  external_id       TEXT,
  user_id           BIGINT REFERENCES users(id),
  author_name       TEXT NOT NULL,
  author_channel_id TEXT,
  author_photo      TEXT,
  kind              TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','paid','membership')),
  body              TEXT NOT NULL DEFAULT '',
  amount_text       TEXT,
  mentions          TEXT[] NOT NULL DEFAULT '{}',
  offset_ms         INT NOT NULL,
  sent_at           TIMESTAMPTZ,
  hidden            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS chat_video_offset ON chat_messages (video_id, offset_ms);
CREATE INDEX IF NOT EXISTS chat_author       ON chat_messages (author_name);
CREATE INDEX IF NOT EXISTS chat_mentions     ON chat_messages USING GIN (mentions);

-- MVP: password sign-in (replaced by real auth in MBJ-101)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
