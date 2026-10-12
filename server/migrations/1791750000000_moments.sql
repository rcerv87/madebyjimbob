-- Notes and moment reactions (MBJ-217, MBJ-613). Both are pinned to a position in a video (offset_ms), optionally a
-- stretch (end_ms). Notes are short public (or private) pointers like "this is where he really goes off".
-- Reactions are one tap (Funny, Interesting, Fire, Boring, Cringe); added up per minute, with chat activity, they
-- draw the hotspot strip under the player.

-- Up Migration

CREATE TABLE video_notes (
  id         BIGSERIAL PRIMARY KEY,
  video_id   BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offset_ms  BIGINT NOT NULL,
  end_ms     BIGINT,            -- a stretch from offset_ms to here; null = one moment
  body       TEXT NOT NULL,
  private    BOOLEAN NOT NULL DEFAULT false, -- just for the member who wrote it
  hidden     BOOLEAN NOT NULL DEFAULT false, -- taken down by staff
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX video_notes_video ON video_notes (video_id, offset_ms);
CREATE INDEX video_notes_user ON video_notes (user_id, created_at DESC);

CREATE TABLE moment_reactions (
  id         BIGSERIAL PRIMARY KEY,
  video_id   BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('funny', 'interesting', 'fire', 'boring', 'cringe')),
  offset_ms  BIGINT NOT NULL,
  end_ms     BIGINT,            -- a stretch; null = one moment
  minute     INTEGER NOT NULL,  -- floor(offset_ms / 60000): one reaction per kind per person per minute
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, user_id, kind, minute)
);
CREATE INDEX moment_reactions_video ON moment_reactions (video_id);

-- Down Migration

DROP TABLE IF EXISTS moment_reactions;
DROP TABLE IF EXISTS video_notes;
