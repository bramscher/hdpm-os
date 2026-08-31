-- ============================================
-- Dez operator — agent_config seed for the AppFolio operator worker
-- Date: 2026-08-31
-- Run this migration manually in the Supabase SQL Editor.
--
-- Registers the dez_operator / form_merge action on the autonomy ladder so the
-- /agents page can show + gate it. Seeded OFF and clamped:
--   autonomy_level 0  → observe only (Dez won't call the worker until raised to ≥1)
--   ceiling_level  2  → owner/tenant-facing hard wall (form goes to a tenant for
--                       signature) — this action can NEVER go autonomous
--   enabled        false → feature off until explicitly turned on
-- Turning it on is a deliberate act on /agents AFTER the AppFolio ToS answer.
-- ============================================

INSERT INTO agent_config (agent, action_type, autonomy_level, ceiling_level, max_per_day, owner_role, enabled)
VALUES ('dez_operator', 'form_merge', 0, 2, 10, 'craig', false)
ON CONFLICT (agent, action_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
