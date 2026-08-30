-- ============================================
-- Dez — dez_activity: the agentic-surface visibility log
-- Date: 2026-08-30
-- Run this migration manually in the Supabase SQL Editor.
--
-- One row per Dez interaction so the agentic surface is legible, not invisible:
-- every question answered (with the lane/scope that handled it), every routine
-- run, and — once scoped subagent tools land — every subagent/verb spin-up.
-- Powers both the #dez-activity Slack feed and the "Dez Activity" panel on
-- /agents. Writes are best-effort (never block an answer), so this table is not
-- load-bearing; it is a record.
-- ============================================

CREATE TABLE IF NOT EXISTS dez_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,                  -- question | routine | subagent | verb
  surface TEXT,                        -- dm | channel | cron
  scope TEXT,                          -- maintenance | leasing | accounting | general
  actor_person TEXT,                   -- staff.person (NULL for cron/system)
  actor_slack_id TEXT,
  summary TEXT NOT NULL,               -- one-line, human-readable
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_channel TEXT                  -- Slack channel/DM id the interaction came from
);

CREATE INDEX IF NOT EXISTS idx_dez_activity_created
  ON dez_activity (created_at DESC);

ALTER TABLE dez_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to dez_activity" ON dez_activity;
CREATE POLICY "Service role full access to dez_activity" ON dez_activity
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON dez_activity TO service_role;

NOTIFY pgrst, 'reload schema';
