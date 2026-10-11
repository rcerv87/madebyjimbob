-- Timeouts (MBJ-705): a lighter option than a ban. A timed-out member stays signed in and can watch and like, but
-- can't chat, comment, or put a message on a super chat until timeout_until. "This stream" stores the stream's
-- recording id; the timeout lifts when that recording ends (with a 12-hour cap in timeout_until as a backstop).

-- Up Migration

ALTER TABLE users
  ADD COLUMN timeout_until  TIMESTAMPTZ,
  ADD COLUMN timeout_reason TEXT,
  ADD COLUMN timeout_stream TEXT,
  ADD COLUMN timeout_by     BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX users_timeout_stream ON users (timeout_stream) WHERE timeout_stream IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS users_timeout_stream;
ALTER TABLE users
  DROP COLUMN IF EXISTS timeout_by,
  DROP COLUMN IF EXISTS timeout_stream,
  DROP COLUMN IF EXISTS timeout_reason,
  DROP COLUMN IF EXISTS timeout_until;
