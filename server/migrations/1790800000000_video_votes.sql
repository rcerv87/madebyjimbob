-- Thumbs up / down on videos (first piece of MBJ-613). One vote per person per video, changeable.
-- Viewers see the like count; JimBob sees likes and dislikes in Studio.

-- Up Migration

CREATE TABLE video_votes (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  value      SMALLINT NOT NULL CHECK (value IN (1, -1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX video_votes_video ON video_votes (video_id, value);

-- Down Migration

DROP TABLE IF EXISTS video_votes;
