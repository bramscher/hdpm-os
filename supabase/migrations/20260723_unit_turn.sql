-- ============================================
-- Migration: unit_turn -- unit-level turnover grouping (Turnover board v2)
-- Date: 2026-07-23
-- Run this in the Supabase SQL Editor.
--
-- The original `turn` table (20260702) keys a turnover to a SINGLE work
-- order, but a real unit turn owns MANY work orders (paint, flooring,
-- clean, punch...). This migration introduces `unit_turn` as the unit-level
-- entity and links work orders to it via work_orders.unit_turn_id.
--
-- The legacy `turn` table is KEPT and still written by the bridge in
-- /api/maintenance/turns/[woId] so tripwire #12 and any existing queries
-- keep working. New code should read/write unit_turn. `turn` is deprecated
-- and can be dropped in a later wave once tripwire #12 reads unit_turn.
--
-- NOTE: plain ASCII, one DDL statement per line, pastes into SQL Editor.
-- ============================================

-- 1. unit_turn -- one row per unit turnover cycle

CREATE TABLE IF NOT EXISTS unit_turn (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id TEXT,
  property_name TEXT NOT NULL,
  unit_id TEXT,
  unit_name TEXT,
  vacated_at DATE NOT NULL,
  target_ready DATE,
  movein_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ready', 'closed')),
  current_blocker TEXT,
  budget NUMERIC,
  actual NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_unit_turn_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_unit_turn_timestamp ON unit_turn;
CREATE TRIGGER trigger_update_unit_turn_timestamp
  BEFORE UPDATE ON unit_turn
  FOR EACH ROW
  EXECUTE FUNCTION update_unit_turn_timestamp();

CREATE INDEX IF NOT EXISTS idx_unit_turn_status ON unit_turn(status) WHERE status != 'closed';

-- 2. work_orders.unit_turn_id -- many WOs per turn

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS unit_turn_id UUID REFERENCES unit_turn(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wo_unit_turn ON work_orders(unit_turn_id) WHERE unit_turn_id IS NOT NULL;

-- 3. Backfill: every legacy per-WO turn row becomes a unit_turn, and its
--    work order is linked. Idempotent (skips WOs already linked).

DO $$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN
    SELECT t.work_order_id, t.vacated_at, t.target_ready, t.current_blocker, t.budget, t.actual,
           wo.property_id AS pid, wo.property_name AS pname, wo.unit_id AS uid, wo.unit_name AS uname
    FROM turn t
    JOIN work_orders wo ON wo.id = t.work_order_id
    WHERE wo.unit_turn_id IS NULL
  LOOP
    INSERT INTO unit_turn (property_id, property_name, unit_id, unit_name, vacated_at, target_ready, current_blocker, budget, actual)
    VALUES (r.pid, r.pname, r.uid, r.uname, r.vacated_at, r.target_ready, r.current_blocker, r.budget, r.actual)
    RETURNING id INTO new_id;
    UPDATE work_orders SET unit_turn_id = new_id, is_turn = true WHERE id = r.work_order_id;
  END LOOP;
END $$;

-- 4. RLS (service-role pattern, same as the rest of Maintenance OS)

ALTER TABLE unit_turn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to unit_turn" ON unit_turn;
CREATE POLICY "Service role full access to unit_turn" ON unit_turn
  FOR ALL USING (true) WITH CHECK (true);
