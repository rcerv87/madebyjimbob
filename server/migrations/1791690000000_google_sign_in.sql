-- Sign in with Google (MBJ-110). Someone who joins through Google never typed a username, so they get a made-up one
-- (username_chosen = false) and the site asks them once to pick their own.

-- Up Migration

ALTER TABLE users ADD COLUMN username_chosen BOOLEAN NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS username_chosen;
