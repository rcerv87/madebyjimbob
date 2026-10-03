-- Conversations in chat (MBJ-222): finding every reply to a message, and replies to those, needs reply_to_id indexed.

-- Up Migration

CREATE INDEX IF NOT EXISTS chat_messages_reply_to ON chat_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS chat_messages_reply_to;
