-- Real authentication (MBJ-101, ADR-006): Better Auth on our own tables. Users get an email, a verified flag,
-- a display name, and an avatar; sessions, sign-in methods (password, later Google/Apple), and one-time
-- tokens (email verification, password reset) get their own tables. The POC session_token and
-- password_hash columns go away; POC passwords move to `accounts` and keep working.

-- Up Migration

ALTER TABLE users
  ADD COLUMN email          TEXT,
  ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN display_name   TEXT,
  ADD COLUMN image          TEXT,
  ADD COLUMN username_key   TEXT,
  ADD COLUMN updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- The POC matched names case-insensitively but only enforced exact-case uniqueness; rename any later clash.
UPDATE users u SET username = left(u.username, 20) || '_' || u.id
WHERE EXISTS (SELECT 1 FROM users o WHERE lower(o.username) = lower(u.username) AND o.id < u.id);

-- POC accounts have no email; they get a placeholder and are asked for a real one on their next sign-in.
UPDATE users SET
  username_key = lower(username),
  display_name = username,
  email = 'user' || id || '@no-email.invalid';

ALTER TABLE users
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL,
  ALTER COLUMN username_key SET NOT NULL;
CREATE UNIQUE INDEX users_by_email ON users (email);
CREATE UNIQUE INDEX users_by_username_key ON users (username_key);

CREATE TABLE sessions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE accounts (
  id                       BIGSERIAL PRIMARY KEY,
  user_id                  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX accounts_user ON accounts (user_id);

INSERT INTO accounts (user_id, account_id, provider_id, password)
SELECT id, id::text, 'credential', password_hash FROM users WHERE password_hash IS NOT NULL;

CREATE TABLE verifications (
  id         BIGSERIAL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier ON verifications (identifier);

ALTER TABLE users DROP COLUMN session_token, DROP COLUMN password_hash;

-- Down Migration

ALTER TABLE users ADD COLUMN session_token TEXT UNIQUE, ADD COLUMN password_hash TEXT;
UPDATE users u SET password_hash = a.password
FROM accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential' AND a.password LIKE 'scrypt$%';
DROP TABLE IF EXISTS verifications;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS sessions;
DROP INDEX IF EXISTS users_by_username_key;
DROP INDEX IF EXISTS users_by_email;
ALTER TABLE users
  DROP COLUMN email, DROP COLUMN email_verified, DROP COLUMN display_name, DROP COLUMN image,
  DROP COLUMN username_key, DROP COLUMN updated_at;
