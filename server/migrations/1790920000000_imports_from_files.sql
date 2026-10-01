-- Add videos from files (MBJ-701, and the Takeout path in MBJ-806): the file is uploaded from the browser straight
-- to Cloudflare Stream, then the import helper fetches only the YouTube title, chat replay, and comments.
-- stream_uid on the job is that upload; 'uploading' means the browser is still sending it.

-- Up Migration

ALTER TABLE import_jobs ADD COLUMN stream_uid TEXT;
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check,
  ADD CONSTRAINT import_jobs_status_check CHECK (status IN ('uploading', 'queued', 'running', 'done', 'failed', 'cancelled'));

-- Down Migration

DELETE FROM import_jobs WHERE status = 'uploading';
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check,
  ADD CONSTRAINT import_jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled'));
ALTER TABLE import_jobs DROP COLUMN IF EXISTS stream_uid;
