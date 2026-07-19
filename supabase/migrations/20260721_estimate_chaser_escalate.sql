-- ============================================
-- Agent-OS Brief D: estimate_chaser 'escalate' action_type.
--
-- Interim Craig escalation (Slack DM digest of 3x-chased / >45d items)
-- until Brief E's Ops Brief exists to absorb the roll-up. L3 from day one
-- under the master plan's self-addressed-internal-reporting exception —
-- the same basis as ops_brief/send_brief. max_per_day 1: at most one
-- digest DM per day. Ceiling 4 (internal ops).
--
-- Run manually in the Supabase SQL Editor.
-- ============================================

INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role) VALUES
  ('estimate_chaser', 'escalate', 3, 4, 1, 'Craig')
ON CONFLICT (agent, action_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
