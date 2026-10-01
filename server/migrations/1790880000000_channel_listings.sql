-- Pick videos from the channel to import (MBJ-706). channel_listings: requests to list a YouTube channel's videos,
-- done by the server with a YouTube Data API key, or by the import helper on Ruben's PC (yt-dlp) without one.
-- channel_videos: the latest list for each channel, which Studio filters and pages.

-- Up Migration

CREATE TABLE channel_listings (
  id           BIGSERIAL PRIMARY KEY,
  channel_key  TEXT NOT NULL, -- '@handle' (lower case) or a UC… channel id
  channel_url  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  source       TEXT NOT NULL CHECK (source IN ('api', 'helper')),
  video_count  INT,
  error        TEXT,
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX channel_listings_channel ON channel_listings (channel_key, created_at DESC);
CREATE INDEX channel_listings_queue ON channel_listings (id) WHERE status = 'queued';

CREATE TABLE channel_videos (
  channel_key  TEXT NOT NULL,
  youtube_id   TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'live', 'short')),
  published_at TIMESTAMPTZ, -- exact with the API; approximate ("3 weeks ago") from the helper
  duration_s   INT,
  availability TEXT,        -- YouTube's: public, unlisted, subscriber_only (members), needs_auth, …
  position     INT NOT NULL DEFAULT 0, -- order on the channel tab, newest first, when dates are missing
  listed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_key, youtube_id)
);
CREATE INDEX channel_videos_order ON channel_videos (channel_key, published_at DESC NULLS LAST, position);

-- Down Migration

DROP TABLE IF EXISTS channel_videos;
DROP TABLE IF EXISTS channel_listings;
