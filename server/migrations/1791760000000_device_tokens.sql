-- Native push for the phone apps (MBJ-405): each app install that turned on notifications registers its Firebase
-- Cloud Messaging token here. A token belongs to one install; signing in on that phone moves it to that account.

-- Up Migration

CREATE TABLE device_tokens (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  token        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user ON device_tokens (user_id);

-- Down Migration

DROP TABLE IF EXISTS device_tokens;
