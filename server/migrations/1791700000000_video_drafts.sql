-- Videos that were never on YouTube (MBJ-818): the Library Uploader sends files from the "Not on YouTube" folder as
-- new site-only videos. They arrive as drafts (hidden from everyone but Studio) until JimBob titles and publishes
-- them. A site-only upload has no YouTube id.

-- Up Migration

ALTER TABLE videos ADD COLUMN draft BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX videos_drafts ON videos (id) WHERE draft;
ALTER TABLE library_uploads ALTER COLUMN youtube_id DROP NOT NULL;
-- When the file was made (its date on JimBob's PC): the draft's date, so old recordings sort where they belong.
ALTER TABLE library_uploads ADD COLUMN recorded_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE library_uploads DROP COLUMN IF EXISTS recorded_at;
DELETE FROM library_uploads WHERE youtube_id IS NULL;
ALTER TABLE library_uploads ALTER COLUMN youtube_id SET NOT NULL;
DROP INDEX IF EXISTS videos_drafts;
ALTER TABLE videos DROP COLUMN IF EXISTS draft;
