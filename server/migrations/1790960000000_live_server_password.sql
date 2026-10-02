-- Each live server gets its own Owncast admin password (ADR-004). A server started from the saved image briefly runs
-- the previous Owncast; with a fresh password the site can't mistake that one for the new one when applying settings.

-- Up Migration

ALTER TABLE live_servers ADD COLUMN admin_password TEXT;

-- Down Migration

ALTER TABLE live_servers DROP COLUMN IF EXISTS admin_password;
