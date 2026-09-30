-- Account settings (MBJ-106, MBJ-113): a security history per member, one-time tokens for email changes and
-- their undo links, notification preferences, and notifications that skip the bell (push only).

-- Up Migration

CREATE TABLE security_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('account_created', 'signed_in', 'password_changed', 'password_reset',
                                           'email_change_requested', 'email_changed', 'email_change_undone')),
  ip_address TEXT,
  user_agent TEXT,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user ON security_events (user_id, created_at DESC);

CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY, -- sha256 of the token in the emailed link; the token itself is never stored
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('email_change', 'email_undo')),
  data       JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_user ON account_tokens (user_id, purpose);

-- { "mention": { "site": true, "push": true }, "reply": { ... } }; a missing value means on.
ALTER TABLE users ADD COLUMN notification_prefs JSONB NOT NULL DEFAULT '{}';

-- false = the member turned the bell off for this type but still gets push, so the row exists for the push link.
ALTER TABLE notifications ADD COLUMN in_bell BOOLEAN NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE notifications DROP COLUMN IF EXISTS in_bell;
ALTER TABLE users DROP COLUMN IF EXISTS notification_prefs;
DROP TABLE IF EXISTS account_tokens;
DROP TABLE IF EXISTS security_events;
