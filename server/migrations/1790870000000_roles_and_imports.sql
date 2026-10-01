-- Studio access by role; adding, replacing, and deleting videos from Studio (MBJ-701, first part of MBJ-102).
-- users.role: 'admin' opens Studio (as does a verified email in ADMIN_EMAILS). import_jobs: YouTube links queued in
-- Studio; the import helper on Ruben's PC claims them, runs the import, and reports progress. import_workers:
-- when each helper last checked in, so Studio can say whether one is running.

-- Up Migration

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'mod', 'admin'));

CREATE TABLE import_jobs (
  id            BIGSERIAL PRIMARY KEY,
  url           TEXT NOT NULL,
  youtube_id    TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'plus', 'premium')),
  with_comments BOOLEAN NOT NULL DEFAULT true,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  step          TEXT,
  title         TEXT,
  error         TEXT,
  video_id      BIGINT REFERENCES videos(id) ON DELETE SET NULL,
  requested_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX import_jobs_queue ON import_jobs (id) WHERE status = 'queued';
CREATE INDEX import_jobs_recent ON import_jobs (created_at DESC);

CREATE TABLE import_workers (
  name      TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id    BIGINT
);

-- Replace video (MBJ-701): a better file (e.g. JimBob's Takeout download) uploaded to Stream; swapped in for
-- stream_uid once Cloudflare has processed it, keeping the video's chat and comments.
ALTER TABLE videos ADD COLUMN replacement_stream_uid TEXT, ADD COLUMN replacement_started_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE videos DROP COLUMN IF EXISTS replacement_started_at, DROP COLUMN IF EXISTS replacement_stream_uid;

DROP TABLE IF EXISTS import_workers;
DROP TABLE IF EXISTS import_jobs;
ALTER TABLE users DROP COLUMN IF EXISTS role;
