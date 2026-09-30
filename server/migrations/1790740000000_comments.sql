-- Video comments (MBJ-210): YouTube comments imported with the video, plus native comments posted
-- on the platform. Separate from chat_messages because comments aren't tied to a playback position
-- and have one level of replies.

-- Up Migration

CREATE TABLE comments (
  id                BIGSERIAL PRIMARY KEY,
  video_id          BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('youtube','rumble','native')),
  external_id       TEXT,
  parent_id         BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  user_id           BIGINT REFERENCES users(id),
  author_name       TEXT NOT NULL,
  author_channel_id TEXT,
  author_photo      TEXT,
  author_is_creator BOOLEAN NOT NULL DEFAULT false,
  body              TEXT NOT NULL,
  like_count        INT NOT NULL DEFAULT 0,
  pinned            BOOLEAN NOT NULL DEFAULT false,
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX comments_video_top ON comments (video_id, like_count DESC, posted_at DESC) WHERE parent_id IS NULL;
CREATE INDEX comments_video_new ON comments (video_id, posted_at DESC) WHERE parent_id IS NULL;
CREATE INDEX comments_parent    ON comments (parent_id, posted_at);

-- Down Migration

DROP TABLE IF EXISTS comments;
