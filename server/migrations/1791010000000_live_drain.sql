-- End stream waits for the recorder to finish uploading before the server is deleted (2026-10-04: the end of the
-- smallest quality and the audio was lost). This is when End stream was pressed, for the wait's time limit.

-- Up Migration

ALTER TABLE live_servers ADD COLUMN IF NOT EXISTS stop_requested_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE live_servers DROP COLUMN IF EXISTS stop_requested_at;
