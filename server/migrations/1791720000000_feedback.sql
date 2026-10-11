-- Beta feedback (MBJ-819): a note from any page, with where it was sent from (page, video and moment, device) and
-- an optional screenshot kept in the row (small, shrunk in the browser). Studio → Feedback works through them.

-- Up Migration

CREATE TABLE feedback (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note            TEXT NOT NULL,
  page            TEXT,            -- path and query it was sent from
  video_id        BIGINT REFERENCES videos(id) ON DELETE SET NULL,
  offset_ms       BIGINT,          -- where the video was
  user_agent      TEXT,
  screen          TEXT,            -- "390x844 @2x"
  screenshot      BYTEA,
  screenshot_type TEXT,            -- image/jpeg | image/png | image/webp
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'done')),
  handled_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_by_status ON feedback (status, created_at DESC);
CREATE INDEX feedback_by_user ON feedback (user_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS feedback;
