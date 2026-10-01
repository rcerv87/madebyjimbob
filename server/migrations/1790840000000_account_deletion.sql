-- Download my data and delete my account (MBJ-118). A deletion request waits 30 days (signing in cancels it),
-- then the account is erased: chat messages and comments stay as "Deleted user", or are blanked and hidden if
-- the member chose to remove them. Their user_id links clear instead of blocking the erase.

-- Up Migration

ALTER TABLE users
  ADD COLUMN deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN delete_content BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX users_deletion_due ON users (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey,
  ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_user_id_fkey,
  ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_type_check,
  ADD CONSTRAINT security_events_type_check CHECK (type IN ('account_created', 'signed_in', 'password_changed',
    'password_reset', 'email_change_requested', 'email_changed', 'email_change_undone', 'deletion_requested',
    'deletion_cancelled'));

-- Down Migration

DELETE FROM security_events WHERE type IN ('deletion_requested', 'deletion_cancelled');
ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_type_check,
  ADD CONSTRAINT security_events_type_check CHECK (type IN ('account_created', 'signed_in', 'password_changed',
    'password_reset', 'email_change_requested', 'email_changed', 'email_change_undone'));
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_user_id_fkey,
  ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey,
  ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
DROP INDEX IF EXISTS users_deletion_due;
ALTER TABLE users DROP COLUMN IF EXISTS delete_content, DROP COLUMN IF EXISTS deletion_requested_at;
