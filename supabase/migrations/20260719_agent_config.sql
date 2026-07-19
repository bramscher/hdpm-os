-- ============================================
-- Agent-OS Brief B: agent_config — the autonomy matrix as data
-- Date: 2026-07-19
-- Run this migration manually in the Supabase SQL Editor.
--
-- One row per (agent, action_type). Changing autonomy is a row update, not a
-- deploy (docs/agent-os/00-DRAFT-master-plan.md Part 2). Levels: L0 observe →
-- L1 draft → L2 act-on-tap → L3 act-then-notify → L4 silent. ceiling_level
-- encodes the Q2 decisions and promotion logic may never propose past it
-- (enforced here by CHECK and in lib/agents/config.ts maxPromotableLevel).
-- The ('*','*') row is the global kill switch: set enabled=false to halt
-- every agent.
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

-- Global kill switch: flip enabled=false on this row to halt all agents.
INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, owner_role, enabled) VALUES
  ('*', '*', 0, 4, 'Craig', true)
ON CONFLICT (agent, action_type) DO NOTHING;

-- The two sanctioned L3-from-day-one exceptions (Part 2 guardrails):
INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role) VALUES
  ('ops_brief',    'send_brief',     3, 4, 3,  'Craig'),   -- self-addressed reporting to Craig/Matt
  ('intake_haven', 'emergency_page', 3, 3, 20, 'Cheryl')   -- false page cheaper than a missed flood
ON CONFLICT (agent, action_type) DO NOTHING;

-- L1/L2 starts for the planned action types, ceilings per Q2
-- (docs/agent-os/01-questions-and-answers.md). These strings are the contract
-- Briefs C+ code against.
INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role) VALUES
  ('morning_card',    'daily_card',     2, 4, 2,   'Cheryl'),  -- internal ops → L4 ceiling
  ('intake_triage',   'triage_wo',      2, 3, 50,  'Cheryl'),  -- L3 target post-promotion
  ('estimate_chaser', 'vendor_chase',   1, 3, 10,  'Cheryl'),  -- vendor comms ceiling L3
  ('estimate_chaser', 'owner_approval', 1, 2, 10,  'Cheryl'),  -- owner-facing hard wall L2
  ('day_close',       'sms_day_close',  2, 3, 5,   'Cheryl'),
  ('invoice_recon',   'propose_match',  1, 2, 50,  'Penny'),   -- invoices L1/L2
  ('inspections',     'tenant_notice',  2, 2, 50,  'Brody'),   -- tenant-facing hard wall L2
  ('vendor_chaser',   'vendor_chase',   1, 3, 10,  'Cheryl'),
  ('email_triage',    'route_email',    1, 4, 100, 'Ashley')
ON CONFLICT (agent, action_type) DO NOTHING;

ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to agent_config" ON agent_config;
CREATE POLICY "Service role full access to agent_config" ON agent_config
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON agent_config TO service_role;

NOTIFY pgrst, 'reload schema';
