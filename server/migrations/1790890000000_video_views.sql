-- Count one view per viewer (MBJ-216): a view counts once per viewer per video per day (UTC). viewer_key is
-- 'u:<user id>' when signed in, 'b:<random browser id>' otherwise, or 'h:<daily hash>' as a last resort (no IPs
-- are stored). Only today's and yesterday's rows are kept; videos.views stays the running total.

-- Up Migration

CREATE TABLE video_views (
  video_id   BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  day        DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  PRIMARY KEY (video_id, viewer_key, day)
);
CREATE INDEX video_views_day ON video_views (day);

-- Down Migration

DROP TABLE IF EXISTS video_views;
