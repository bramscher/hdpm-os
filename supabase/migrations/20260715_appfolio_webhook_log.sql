-- Migration: AppFolio webhook inspection log
-- Date: 2026-07-15
-- Description:
--   Capture raw AppFolio webhook events for financial topics (bills, journal
--   entries, GL details, charges) so we can see the real shape of an ACH
--   disbursement to HDMS before writing capture logic. The webhook payload only
--   carries {topic, entity_id}; we fetch the full entity by Id and store both.
--   This is a staging/inspection table — the eventual hdms_payments capture maps
--   from here. Safe to truncate once mapping is built.

CREATE TABLE IF NOT EXISTS appfolio_webhook_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topic TEXT NOT NULL,
  entity_id TEXT,
  raw_payload JSONB,      -- the verified webhook body
  entity JSONB,           -- the entity fetched from v0 by Id (null if fetch failed)
  fetch_error TEXT,       -- why the entity fetch failed, if it did
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appfolio_webhook_log_received_at
  ON appfolio_webhook_log(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_appfolio_webhook_log_topic
  ON appfolio_webhook_log(topic);

ALTER TABLE appfolio_webhook_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to webhook log" ON appfolio_webhook_log;
CREATE POLICY "Service role full access to webhook log" ON appfolio_webhook_log
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON appfolio_webhook_log TO service_role;
