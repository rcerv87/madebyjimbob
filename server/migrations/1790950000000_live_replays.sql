-- Live rewind and instant replay (MBJ-310): a finished owned-live stream becomes a video that plays from its
-- recording in R2 (HLS) instead of Cloudflare Stream.

-- Up Migration

ALTER TABLE videos ADD COLUMN hls_url TEXT, ADD COLUMN live_recording_id TEXT UNIQUE;

-- Down Migration

ALTER TABLE videos DROP COLUMN IF EXISTS live_recording_id, DROP COLUMN IF EXISTS hls_url;
