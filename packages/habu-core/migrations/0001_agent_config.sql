-- ============================================
-- @habu/core 0001 — agent_config: the autonomy matrix as data
-- Ported from hdpm-os 20260719_agent_config.sql, MINUS HDPM seed rows.
--
-- One row per (agent, action_type). Changing autonomy is a row update, not a
-- deploy. Levels: L0 observe → L1 draft → L2 act-on-tap → L3 act-then-notify
-- → L4 silent. ceiling_level caps promotion (enforced by CHECK and by
-- lib/agents/config maxPromotableLevel). The ('*','*') row is the global kill
-- switch: set enabled=false to halt every agent. Tenants seed their own
-- per-agent rows.
-- ============================================

CREATE TABLE IF NOT EXISTS agent_config (
  agent TEXT NOT NULL,
  action_type TEXT NOT NULL,
  autonomy_level SMALLINT NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 0 AND 4),
  ceiling_level  SMALLINT NOT NULL DEFAULT 2 CHECK (ceiling_level BETWEEN 0 AND 4),
  max_per_day INT,
  quiet_hours TEXT,                    -- e.g. '21:00-07:00'; NULL = none
  owner_role TEXT,                     -- accountable human (staff.person)
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent, action_type),
  CONSTRAINT chk_level_within_ceiling CHECK (autonomy_level <= ceiling_level)
);

-- Global kill switch (generic infra, not tenant seed): flip enabled=false to
-- halt all agents. owner_role left NULL — tenants assign the accountable seat.
INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, enabled) VALUES
  ('*', '*', 0, 4, true)
ON CONFLICT (agent, action_type) DO NOTHING;

ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to agent_config" ON agent_config;
CREATE POLICY "Service role full access to agent_config" ON agent_config
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON agent_config TO service_role;

NOTIFY pgrst, 'reload schema';
