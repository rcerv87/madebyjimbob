-- Welcome steps (MBJ-115): a new member's short checklist (confirm email, notifications, link YouTube, membership).
-- What's done is worked out from their account; this only remembers that they hid the checklist for good.

-- Up Migration

ALTER TABLE users ADD COLUMN welcome_dismissed_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS welcome_dismissed_at;
