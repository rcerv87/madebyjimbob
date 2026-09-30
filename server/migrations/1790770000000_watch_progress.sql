-- Where each signed-in viewer stopped in each video, so reopening resumes there (on any device).
-- Signed-out viewers keep this in their browser instead. Feeds watch-time XP later (MBJ-601).

-- Up Migration

CREATE TABLE watch_progress (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id    BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position_ms INT NOT NULL CHECK (position_ms >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

-- Down Migration

DROP TABLE IF EXISTS watch_progress;
