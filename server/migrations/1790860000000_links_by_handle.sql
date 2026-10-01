-- YouTube links work like Rumble (MBJ-215): the member enters their @handle and a moderator confirms it in Studio.
-- The one-time code flow is gone. The channel id is still stored (found from imported chat and comments by
-- handle) so links survive renames on YouTube.

-- Up Migration

DELETE FROM linked_accounts WHERE status = 'pending' AND platform = 'youtube' AND handle IS NULL;
ALTER TABLE linked_accounts DROP COLUMN IF EXISTS code, DROP COLUMN IF EXISTS expires_at;
DROP INDEX IF EXISTS chat_messages_youtube_imported;
DROP INDEX IF EXISTS comments_youtube_imported;
-- Finding a YouTube channel id from a handle.
CREATE INDEX chat_messages_youtube_author ON chat_messages (lower(author_name)) WHERE source = 'youtube';
CREATE INDEX comments_youtube_author ON comments (lower(author_name)) WHERE source = 'youtube';

-- Down Migration

DROP INDEX IF EXISTS comments_youtube_author;
DROP INDEX IF EXISTS chat_messages_youtube_author;
CREATE INDEX IF NOT EXISTS chat_messages_youtube_imported ON chat_messages (created_at) WHERE source = 'youtube';
CREATE INDEX IF NOT EXISTS comments_youtube_imported ON comments (created_at) WHERE source = 'youtube';
ALTER TABLE linked_accounts ADD COLUMN IF NOT EXISTS code TEXT UNIQUE, ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
