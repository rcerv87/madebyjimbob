-- One conversation across live chat, replay chat, and comments.
-- - chat_messages.posted_live: sent while the stream was live (YouTube replay imports, live native
--   posts) vs. posted later while watching the replay. Viewers toggle "Live only" / "Live + replay".
-- - reply_to_id on chat and comments: the exact message being answered, so replies can quote it.
-- - comments.offset_ms: optional moment in the video; timestamped comments appear in the chat feed.

-- Up Migration

ALTER TABLE chat_messages ADD COLUMN posted_live BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE chat_messages ADD COLUMN reply_to_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL;
-- Every native message so far was posted while watching a replay (live native chat doesn't exist yet).
UPDATE chat_messages SET posted_live = false WHERE source = 'native';

ALTER TABLE comments ADD COLUMN offset_ms INT CHECK (offset_ms >= 0);
ALTER TABLE comments ADD COLUMN reply_to_id BIGINT REFERENCES comments(id) ON DELETE SET NULL;
CREATE INDEX comments_video_offset ON comments (video_id, offset_ms) WHERE offset_ms IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS comments_video_offset;
ALTER TABLE comments DROP COLUMN IF EXISTS reply_to_id;
ALTER TABLE comments DROP COLUMN IF EXISTS offset_ms;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS reply_to_id;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS posted_live;
