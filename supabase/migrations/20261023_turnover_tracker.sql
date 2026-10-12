-- ============================================
-- Unit Turnover Tracker (Brody's PRD, 2026-10-09) — test build
-- Date: 2026-10-23
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- Plain ASCII, one DDL statement per line. Nothing here is written back to
-- AppFolio. Spec + decisions: docs/turnover-tracker/01-gap-analysis.md.
--
--   unit_turn.coordinator      turn coordinator (staff.person), default Brody
--   unit_turn_check            the manual checkboxes of the 7 categories
--   turn_activity              notes + activity feed per turn
--   work_orders.turn_status*   a hand-set tracker status that holds until
--                              AppFolio's own status changes ("latest wins")
--   work_orders.turn_snoozed_until  reminder snooze (used by the task build)
-- ============================================

-- 1. Coordinator on each turn
ALTER TABLE unit_turn ADD COLUMN IF NOT EXISTS coordinator TEXT DEFAULT 'Brody';
UPDATE unit_turn SET coordinator = 'Brody' WHERE coordinator IS NULL;

-- 2. Manual checklist items (one row per turn + item; value = lockbox #, showing date, video link)
CREATE TABLE IF NOT EXISTS unit_turn_check (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_turn_id UUID NOT NULL REFERENCES unit_turn(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  checked BOOLEAN NOT NULL DEFAULT false,
  value TEXT,
  checked_at TIMESTAMPTZ,
  checked_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_turn_check_item ON unit_turn_check(unit_turn_id, item_key);

-- 3. Notes and activity per turn (append-only)
CREATE TABLE IF NOT EXISTS turn_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_turn_id UUID NOT NULL REFERENCES unit_turn(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note','check','wo_status','complete','reopen','coordinator')),
  body TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_turn_activity_turn ON turn_activity(unit_turn_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_turn_activity_append_only ON turn_activity;
CREATE TRIGGER trg_turn_activity_append_only BEFORE UPDATE OR DELETE ON turn_activity FOR EACH ROW EXECUTE FUNCTION te_append_only();

-- 4. Tracker status on work orders. turn_status_af_basis = the AppFolio status
--    when the hand-set status was chosen; once AppFolio moves off it, AppFolio wins.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS turn_status TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS turn_status_af_basis TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS turn_status_by TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS turn_status_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS turn_snoozed_until DATE;

-- 5. RLS + grants (service-role pattern, as the rest of Maintenance OS)
ALTER TABLE unit_turn_check ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to unit_turn_check" ON unit_turn_check;
CREATE POLICY "Service role full access to unit_turn_check" ON unit_turn_check FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE turn_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to turn_activity" ON turn_activity;
CREATE POLICY "Service role full access to turn_activity" ON turn_activity FOR ALL USING (true) WITH CHECK (true);
REVOKE ALL ON unit_turn_check FROM anon, authenticated;
REVOKE ALL ON turn_activity FROM anon, authenticated;
GRANT ALL ON unit_turn_check TO service_role;
GRANT ALL ON turn_activity TO service_role;

NOTIFY pgrst, 'reload schema';
