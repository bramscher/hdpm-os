-- Agent-OS Phase 0 (Brief A): metrics_snapshot — daily maintenance/agent KPI
-- capture + one-time baseline freeze.
-- Run this migration manually in the Supabase SQL editor.
--
-- Same shape as kpi_snapshots (20260407), which keeps snapshotting the
-- leasing/finance KPIs; this table is the agent-layer spine copy of that
-- pattern (docs/agent-os/00-DRAFT-master-plan.md Part 2) and later holds
-- agent-performance metrics. One row per metric per daily run; value is
-- jsonb keyed by whatever each metric needs. A single metric='baseline_freeze'
-- bundle row is written once, before any agent ships — the baseline must
-- predate the agents (Part 5).

CREATE TABLE IF NOT EXISTS metrics_snapshot (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  metric text NOT NULL,
  value jsonb NOT NULL,
  captured_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrics_snapshot_metric_time
  ON metrics_snapshot (metric, captured_at DESC);

ALTER TABLE metrics_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to metrics_snapshot" ON metrics_snapshot;
CREATE POLICY "Service role full access to metrics_snapshot" ON metrics_snapshot
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON metrics_snapshot TO service_role;
