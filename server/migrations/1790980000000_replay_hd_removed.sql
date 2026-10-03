-- Older live replays keep 720p and below (JimBob, 2026-10-03; MBJ-312): when the full-HD quality was removed from R2.

-- Up Migration

ALTER TABLE videos ADD COLUMN hd_removed_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE videos DROP COLUMN IF EXISTS hd_removed_at;
