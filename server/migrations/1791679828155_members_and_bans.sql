-- Studio → Members (MBJ-705, and the last part of MBJ-102): admins change roles and ban members from Studio.
-- A banned account is signed out and can't sign in again (so no chat or comments) until it's unbanned.
-- mod_actions is the log of who did what to whom; hiding messages and timeouts (MBJ-204) will write to it too.

-- Up Migration

ALTER TABLE users
  ADD COLUMN banned_at  TIMESTAMPTZ,
  ADD COLUMN ban_reason TEXT,
  ADD COLUMN banned_by  BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE mod_actions (
  id                       BIGSERIAL PRIMARY KEY,
  actor_id                 BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id           BIGINT REFERENCES users(id) ON DELETE CASCADE,
  target_author_channel_id TEXT,    -- a YouTube or Rumble author without a site account (MBJ-204)
  message_id               BIGINT,  -- the chat message acted on (MBJ-204)
  action                   TEXT NOT NULL, -- role | ban | unban for now
  duration_s               INTEGER, -- timeouts (MBJ-204)
  reason                   TEXT,    -- the ban reason, or "viewer → admin" for a role change
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mod_actions_recent ON mod_actions (created_at DESC);
CREATE INDEX mod_actions_target ON mod_actions (target_user_id);

-- Down Migration

DROP TABLE IF EXISTS mod_actions;
ALTER TABLE users
  DROP COLUMN IF EXISTS banned_by,
  DROP COLUMN IF EXISTS ban_reason,
  DROP COLUMN IF EXISTS banned_at;
