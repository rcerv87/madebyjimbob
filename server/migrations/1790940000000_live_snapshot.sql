-- Faster Go Live (ADR-004): the first End stream saves a Hetzner snapshot of the server (Docker and Owncast already
-- installed) before deleting it; later servers start from it. This tracks that snapshot action.

-- Up Migration

ALTER TABLE live_servers ADD COLUMN snapshot_action_id BIGINT;

-- Down Migration

ALTER TABLE live_servers DROP COLUMN IF EXISTS snapshot_action_id;
