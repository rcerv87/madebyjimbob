-- Link YouTube and Rumble accounts to site members (MBJ-215), so their imported YouTube chat and comments show
-- their site name and tier, and @mentions of their YouTube handle reach them. YouTube links are proven with a
-- one-time code the member posts on JimBob's channel (matched on import, by the poster's channel id); Rumble
-- names are confirmed by a moderator in Studio until Rumble chat is imported.

-- Up Migration

CREATE TABLE linked_accounts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('youtube', 'rumble')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'verified')),
  code        TEXT UNIQUE,  -- pending YouTube link: what the member posts, e.g. MBJ-7KQ2M9
  expires_at  TIMESTAMPTZ,  -- when that code stops working
  external_id TEXT,         -- YouTube channel id (UC…), or the lower-cased Rumble name
  handle      TEXT,         -- the name shown on that platform (@handle)
  verified_by TEXT CHECK (verified_by IN ('code', 'admin')),
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);
-- One member per YouTube channel / Rumble name; also the lookup when showing chat and comments.
CREATE UNIQUE INDEX linked_accounts_verified ON linked_accounts (platform, external_id) WHERE status = 'verified';

-- The code check reads only YouTube rows imported since the oldest open claim.
CREATE INDEX chat_messages_youtube_imported ON chat_messages (created_at) WHERE source = 'youtube';
CREATE INDEX comments_youtube_imported ON comments (created_at) WHERE source = 'youtube';

-- Down Migration

DROP INDEX IF EXISTS comments_youtube_imported;
DROP INDEX IF EXISTS chat_messages_youtube_imported;
DROP TABLE IF EXISTS linked_accounts;
