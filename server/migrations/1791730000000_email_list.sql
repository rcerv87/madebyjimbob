-- The owned email list (MBJ-107): members who asked for news (a checkbox at sign-up, a switch in Account settings),
-- with when and where they said yes, plus contacts brought in from elsewhere (the Shopify newsletter list), who
-- have no site account. Studio → Email exports the list; every row carries its own unsubscribe link.

-- Up Migration

ALTER TABLE users
  ADD COLUMN marketing_opt_in_at TIMESTAMPTZ,
  ADD COLUMN marketing_source    TEXT; -- signup | account

CREATE TABLE newsletter_contacts (
  email           TEXT PRIMARY KEY, -- lower case
  name            TEXT,
  source          TEXT NOT NULL,    -- shopify, …
  consented_at    TIMESTAMPTZ,      -- when they said yes there, if the export says
  unsubscribed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS newsletter_contacts;
ALTER TABLE users DROP COLUMN IF EXISTS marketing_source, DROP COLUMN IF EXISTS marketing_opt_in_at;
