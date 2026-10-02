-- Owned live (ADR-004): Go Live in Studio creates an Owncast server on Hetzner and deletes it after the stream.
-- live_settings holds what stays the same between streams (the fixed IP OBS points at, the stream key);
-- live_servers is one row per server created, so cost and hours can be shown and leftovers cleaned up.

-- Up Migration

CREATE TABLE live_settings (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  primary_ip_id   BIGINT,   -- Hetzner Primary IP kept between streams
  ip              TEXT,
  stream_key      TEXT NOT NULL,
  admin_password  TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE live_servers (
  id              BIGSERIAL PRIMARY KEY,
  hetzner_id      BIGINT,
  status          TEXT NOT NULL DEFAULT 'starting'
                  CHECK (status IN ('starting', 'ready', 'stopping', 'stopped', 'failed')),
  server_type     TEXT NOT NULL,
  ip              TEXT,
  error           TEXT,
  started_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  stop_reason     TEXT,     -- ended | idle | cap | sweep | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at        TIMESTAMPTZ,
  last_online_at  TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);
CREATE INDEX live_servers_active ON live_servers (created_at DESC) WHERE status IN ('starting', 'ready', 'stopping');

-- Down Migration

DROP TABLE IF EXISTS live_servers;
DROP TABLE IF EXISTS live_settings;
