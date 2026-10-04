-- Paid memberships (MBJ-104, ADR-013): Stripe subscriptions set users.tier. Tiers given by hand (testers, comps) are
-- kept in manual_tier so billing never removes them; tier = the higher of manual_tier and any live subscription.

-- Up Migration

ALTER TABLE users ADD COLUMN stripe_customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN manual_tier TEXT NOT NULL DEFAULT 'free' CHECK (manual_tier IN ('free', 'plus', 'premium'));
UPDATE users SET manual_tier = tier WHERE tier IN ('plus', 'premium');

CREATE TABLE subscriptions (
  id                   TEXT PRIMARY KEY, -- the provider's id (Stripe: sub_…)
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'stripe',
  status               TEXT NOT NULL, -- active, trialing, past_due, canceled, unpaid, incomplete…
  tier                 TEXT NOT NULL CHECK (tier IN ('plus', 'premium')),
  price_id             TEXT,
  billing_interval     TEXT, -- month or year
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user ON subscriptions (user_id);

-- Super chats bought on the site (MBJ-109), any time: paid first; when JimBob is live on the site it's posted to that
-- stream's chat as a paid message (video_id), otherwise it waits in Studio → Super chats (and his stream overlay).
CREATE TABLE superchats (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  video_id        BIGINT REFERENCES videos(id) ON DELETE SET NULL,
  amount_cents    INT NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL DEFAULT 'usd',
  message         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'expired')),
  checkout_id     TEXT UNIQUE,
  chat_message_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);
CREATE INDEX superchats_paid ON superchats (paid_at DESC) WHERE status = 'paid';

-- Webhook events already handled (providers resend; each is applied once).
CREATE TABLE payment_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS superchats;
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE users DROP COLUMN IF EXISTS manual_tier;
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
