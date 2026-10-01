-- Public profiles (MBJ-116): what a member shares on /@username. Comments always show; chat messages only if they
-- turn it on; search engines only see the page if they allow it (and the site allows indexing).

-- Up Migration

ALTER TABLE users
  ADD COLUMN profile_show_chat BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN profile_indexable BOOLEAN NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS profile_indexable, DROP COLUMN IF EXISTS profile_show_chat;
