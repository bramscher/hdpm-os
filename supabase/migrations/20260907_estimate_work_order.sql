-- Estimate → work-order link + the estimate-drafter agent.
--
-- 1. Estimates can originate from an ad-hoc work order, not only a unit turn.
--    Add a durable link (both nullable — turn-only and ad-hoc estimates leave
--    them null). Mirrors the existing unit_turn_id column on `estimate`.
-- 2. Register the on-demand "estimate_drafter" agent in the autonomy matrix:
--    advisory only (L1 propose; ceiling L2 — it never auto-issues an estimate or
--    moves money). Owned by Cheryl (maintenance coordinator).

ALTER TABLE estimate
  ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wo_number TEXT;

CREATE INDEX IF NOT EXISTS idx_estimate_work_order ON estimate(work_order_id);

INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role)
VALUES ('estimate_drafter', 'draft_estimate', 1, 2, NULL, 'Cheryl')
ON CONFLICT (agent, action_type) DO NOTHING;
