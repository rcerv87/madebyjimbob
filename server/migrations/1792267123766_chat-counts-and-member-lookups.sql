-- Ready for the full library (2026-10-17): looking chat and comments up by member uses an index, and each video's
-- chat count is kept instead of counted on every request.

-- Up Migration

-- Studio → Members, profiles, renames, data export and account deletion find chat and comments by member.
CREATE INDEX IF NOT EXISTS chat_messages_user ON chat_messages (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_user ON comments (user_id) WHERE user_id IS NOT NULL;

-- A video's visible (not hidden) chat messages = videos.chat_count + the sum of its rows in chat_count_deltas.
-- Changes to chat_messages add a small +n/-n row to chat_count_deltas (plain inserts, no lock on the video), and a job
-- in the server folds them into videos.chat_count every 30 seconds (chat_count_fold()). Updating videos.chat_count on
-- every message instead made 50 people chatting on one video wait in line for its row (p95 over 2 s in the scale
-- test). No foreign key on the deltas: when a video is deleted its chat goes with it, and those last deltas name a
-- video that's already gone (the fold just drops them).
ALTER TABLE videos ADD COLUMN IF NOT EXISTS chat_count INTEGER NOT NULL DEFAULT 0;
UPDATE videos v SET chat_count = c.n
  FROM (SELECT video_id, count(*)::int AS n FROM chat_messages WHERE NOT hidden GROUP BY video_id) c
  WHERE c.video_id = v.id;

CREATE TABLE IF NOT EXISTS chat_count_deltas (
  video_id BIGINT NOT NULL,
  delta    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_count_deltas_video ON chat_count_deltas (video_id);

-- Statement-level, so an import of 500 messages adds one row, not 500. Postgres allows transition tables only on
-- single-event triggers without a column list, hence three triggers.
CREATE OR REPLACE FUNCTION chat_count_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chat_count_deltas (video_id, delta)
    SELECT video_id, count(*) FROM new_rows WHERE NOT hidden GROUP BY video_id;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION chat_count_after_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chat_count_deltas (video_id, delta)
    SELECT video_id, -count(*) FROM old_rows WHERE NOT hidden GROUP BY video_id;
  RETURN NULL;
END $$;

-- Only hiding, unhiding, or moving a message to another video changes a count.
CREATE OR REPLACE FUNCTION chat_count_after_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chat_count_deltas (video_id, delta)
    SELECT video_id, sum(n) FROM (
      SELECT o.video_id, -1 AS n FROM old_rows o JOIN new_rows w ON w.id = o.id
        WHERE NOT o.hidden AND (w.hidden OR w.video_id <> o.video_id)
      UNION ALL
      SELECT w.video_id, 1 AS n FROM old_rows o JOIN new_rows w ON w.id = o.id
        WHERE NOT w.hidden AND (o.hidden OR w.video_id <> o.video_id)
    ) changes GROUP BY video_id HAVING sum(n) <> 0;
  RETURN NULL;
END $$;

CREATE TRIGGER chat_count_insert AFTER INSERT ON chat_messages
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION chat_count_after_insert();
CREATE TRIGGER chat_count_delete AFTER DELETE ON chat_messages
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION chat_count_after_delete();
CREATE TRIGGER chat_count_update AFTER UPDATE ON chat_messages
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION chat_count_after_update();

-- Moves the pending deltas into videos.chat_count in one statement (readers see before or after, never half), videos
-- in id order. Returns how many delta rows it folded.
CREATE OR REPLACE FUNCTION chat_count_fold() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE folded integer;
BEGIN
  WITH taken AS (DELETE FROM chat_count_deltas RETURNING video_id, delta),
    sums AS (SELECT video_id, sum(delta)::int AS n, count(*)::int AS rows FROM taken GROUP BY video_id),
    applied AS (
      UPDATE videos v SET chat_count = v.chat_count + s.n FROM sums s WHERE v.id = s.video_id AND s.n <> 0
    )
  SELECT COALESCE(sum(rows), 0) INTO folded FROM sums;
  RETURN folded;
END $$;

-- Down Migration

DROP TRIGGER IF EXISTS chat_count_update ON chat_messages;
DROP TRIGGER IF EXISTS chat_count_delete ON chat_messages;
DROP TRIGGER IF EXISTS chat_count_insert ON chat_messages;
DROP FUNCTION IF EXISTS chat_count_fold();
DROP FUNCTION IF EXISTS chat_count_after_update();
DROP FUNCTION IF EXISTS chat_count_after_delete();
DROP FUNCTION IF EXISTS chat_count_after_insert();
DROP TABLE IF EXISTS chat_count_deltas;
ALTER TABLE videos DROP COLUMN IF EXISTS chat_count;
DROP INDEX IF EXISTS comments_user;
DROP INDEX IF EXISTS chat_messages_user;
