-- Dashboard config: single-row JSON store for manual inputs that power
-- computed KPIs (internal-vendor flag, KPI targets, loan/GM/owner-draw for
-- the upcoming Section A financials panel). Edited via the dashboard config
-- drawer; read by KPI fetchers. Run manually in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS dashboard_config (
  id text PRIMARY KEY DEFAULT 'singleton',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT dashboard_config_singleton CHECK (id = 'singleton')
);

-- Seed the singleton row so the API can always upsert against it.
INSERT INTO dashboard_config (id, data)
VALUES ('singleton', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
