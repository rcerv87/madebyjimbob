-- Transcripts (MBJ-604, first part): caption files kept in our own database, so they survive a move
-- off Cloudflare Stream and can power search, recaps, and chapters. One row per video, language,
-- and source; `vtt` is the original caption file, `text` the plain transcript.

-- Up Migration

CREATE TABLE transcripts (
  video_id   BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  language   TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('cloudflare','whisper','manual')),
  label      TEXT,
  vtt        TEXT NOT NULL,
  text       TEXT NOT NULL,
  cue_count  INT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, language, source)
);

-- Down Migration

DROP TABLE IF EXISTS transcripts;
