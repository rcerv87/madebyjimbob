-- Videos section (MBJ-801/802): each video's type for the dashboard filters, and playlists.
-- playlist_items keeps YouTube ids too, so a YouTube playlist remembers videos that haven't been
-- imported yet and shows them once they are.

-- Up Migration

ALTER TABLE videos ADD COLUMN kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video','short','live'));
CREATE INDEX videos_kind ON videos (kind);

CREATE TABLE playlists (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('youtube','native')),
  youtube_id  TEXT UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE playlist_items (
  playlist_id BIGINT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position    INT NOT NULL,
  youtube_id  TEXT,
  video_id    BIGINT REFERENCES videos(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, position),
  CHECK (youtube_id IS NOT NULL OR video_id IS NOT NULL)
);
CREATE INDEX playlist_items_video ON playlist_items (video_id);
CREATE INDEX playlist_items_youtube ON playlist_items (youtube_id);

-- Down Migration

DROP TABLE IF EXISTS playlist_items;
DROP TABLE IF EXISTS playlists;
DROP INDEX IF EXISTS videos_kind;
ALTER TABLE videos DROP COLUMN IF EXISTS kind;
