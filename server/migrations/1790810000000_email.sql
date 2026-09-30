-- Sending email (MBJ-114): a log of every account email the site sends, and the addresses that must never
-- get mail again (hard bounces and spam complaints, reported by the email provider's webhook).

-- Up Migration

CREATE TABLE emails (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'off', 'suppressed', 'bounced', 'complained')),
  provider_id TEXT UNIQUE,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emails_recent ON emails (created_at DESC);
CREATE INDEX emails_to ON emails (to_email, created_at DESC);

CREATE TABLE email_suppressions (
  email      TEXT PRIMARY KEY, -- lower case
  reason     TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint')),
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS email_suppressions;
DROP TABLE IF EXISTS emails;
