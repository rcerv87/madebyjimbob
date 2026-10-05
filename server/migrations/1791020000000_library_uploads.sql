-- The Library Uploader (MBJ-818): videos from JimBob's Takeout folder, converted on his PC and uploaded to R2 under
-- library/<youtube id>/. library_uploads tracks each one (which file, which video, done or not); an import job carries
-- the R2 address to the import helper, which adds the title, chat and comments without downloading the video.

-- Up Migration

ALTER TABLE import_jobs ADD COLUMN hls_url TEXT;

CREATE TABLE library_uploads (
  id            BIGSERIAL PRIMARY KEY,
  youtube_id    TEXT NOT NULL,
  file_key      TEXT NOT NULL UNIQUE, -- the uploader's id for the source file (zip, entry, size)
  title         TEXT,
  size_bytes    BIGINT,
  duration_s    INTEGER,
  status        TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'done')),
  video_id      BIGINT REFERENCES videos(id) ON DELETE SET NULL,
  import_job_id BIGINT, -- the import job a new video went to (no foreign key, so finished jobs can be cleared)
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX library_uploads_youtube ON library_uploads (youtube_id);

-- Down Migration

DROP TABLE IF EXISTS library_uploads;
ALTER TABLE import_jobs DROP COLUMN IF EXISTS hls_url;
