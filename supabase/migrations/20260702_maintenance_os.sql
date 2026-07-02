-- ============================================
-- Migration: Maintenance OS — Wave 1 schema
-- Date: 2026-07-02
-- Run this in the Supabase SQL Editor
--
-- Extends work_orders with the 8-stage workflow (docs/maintenance-os/02-functional-spec.md)
-- and adds: wo_event (append-only audit), vendor, vendor_assignment, approval,
-- recommendation, turn. AppFolio remains the system of record — the mirror columns
-- (appfolio_id … synced_at) are still owned by the sync; the new workflow columns
-- are owned by this app and are NEVER touched by the sync upsert.
-- ============================================

-- ============================================
-- 1. Extend work_orders with workflow columns
-- ============================================

ALTER TABLE work_orders
  -- Codify schema drift: vendor_name was added ad hoc in the SQL editor.
  ADD COLUMN IF NOT EXISTS vendor_name TEXT,

  -- 8-stage lifecycle. `stage` is OUR source of truth for workflow;
  -- `status`/`appfolio_status` remain the AppFolio mirror.
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS waiting_reason TEXT,

  -- Two invariants: every open WO has ONE named owner and a next-action date.
  ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT 'Cheryl',
  ADD COLUMN IF NOT EXISTS next_action_date DATE,

  -- P1–P4, separate from AppFolio's free-text `priority`.
  ADD COLUMN IF NOT EXISTS priority_class TEXT,

  ADD COLUMN IF NOT EXISTS assigned_tech TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'appfolio',
  ADD COLUMN IF NOT EXISTS is_turn BOOLEAN NOT NULL DEFAULT false,

  -- VERIFY stage bookkeeping (closure gate condition 1)
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,

  -- Closure gate condition 4 (manual until Haven.AI integration)
  ADD COLUMN IF NOT EXISTS tenant_ping_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_ping_sent_at TIMESTAMPTZ,

  -- Closure gate condition 6, tri-state: NULL = not applicable,
  -- false = applicable and blocks CLOSED, true = scheduled.
  ADD COLUMN IF NOT EXISTS preventive_scheduled BOOLEAN,

  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,

  -- "Why it's old" — written reason surfaced on the Aging view.
  ADD COLUMN IF NOT EXISTS aging_reason TEXT;

-- ============================================
-- 2. Backfill stage from the AppFolio mirror (one-time)
-- ============================================

-- Closed in AppFolio → CLOSED (predates the closure gate; grandfathered).
UPDATE work_orders
SET stage = 'CLOSED',
    closed_at = COALESCE(completed_date, canceled_date, updated_at)
WHERE status = 'closed' AND stage = 'NEW';

-- "done" (work done, not yet closed) → VERIFY.
UPDATE work_orders
SET stage = 'VERIFY'
WHERE status = 'done' AND stage = 'NEW';

-- Open with a scheduled date → SCHEDULED. Everything else stays NEW
-- (Cheryl's one-time triage pass — adoption day 1).
UPDATE work_orders
SET stage = 'SCHEDULED'
WHERE status = 'open' AND scheduled_start IS NOT NULL AND stage = 'NEW';

-- Every open WO gets a next-action date (tripwire #3 drives real dates).
UPDATE work_orders
SET next_action_date = CURRENT_DATE + 1
WHERE stage != 'CLOSED' AND next_action_date IS NULL;

-- Seed P1–P4 from AppFolio free-text priority where recognizable.
UPDATE work_orders
SET priority_class = CASE
  WHEN lower(priority) IN ('urgent', 'emergency') THEN 'P1'
  WHEN lower(priority) = 'high' THEN 'P2'
  WHEN lower(priority) IN ('medium', 'normal') THEN 'P3'
  WHEN lower(priority) = 'low' THEN 'P4'
  ELSE NULL
END
WHERE priority_class IS NULL AND priority IS NOT NULL;

-- ============================================
-- 3. Constraints (after backfill)
-- ============================================

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_stage_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_stage_check
  CHECK (stage IN ('NEW','TRIAGED','SCHEDULED','IN_PROGRESS','WAITING_ON','VERIFY','BILL','CLOSED'));

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_waiting_reason_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_waiting_reason_check
  CHECK (waiting_reason IS NULL OR waiting_reason IN ('TENANT','VENDOR','PARTS','OWNER','WEATHER','INTERNAL'));

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_priority_class_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_priority_class_check
  CHECK (priority_class IS NULL OR priority_class IN ('P1','P2','P3','P4'));

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_origin_check;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_origin_check
  CHECK (origin IN ('appfolio','haven','inspection','turn','owner','staff','preventive'));

-- Hard invariants (02-functional-spec.md §2). Soft rules (priority after TRIAGED,
-- vendor/tech from SCHEDULED) are app-layer only — DB constraints would break
-- sync-driven auto-advance to VERIFY.
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS waiting_needs_reason;
ALTER TABLE work_orders ADD CONSTRAINT waiting_needs_reason
  CHECK (stage != 'WAITING_ON' OR waiting_reason IS NOT NULL);

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS open_needs_owner;
ALTER TABLE work_orders ADD CONSTRAINT open_needs_owner
  CHECK (stage = 'CLOSED' OR owner_name IS NOT NULL);

-- Indexes for the board / tripwire queries
CREATE INDEX IF NOT EXISTS idx_work_orders_stage ON work_orders(stage);
CREATE INDEX IF NOT EXISTS idx_work_orders_next_action_date ON work_orders(next_action_date);
CREATE INDEX IF NOT EXISTS idx_work_orders_owner_name ON work_orders(owner_name);
CREATE INDEX IF NOT EXISTS idx_work_orders_is_turn ON work_orders(is_turn) WHERE is_turn;
CREATE INDEX IF NOT EXISTS idx_work_orders_verified_at ON work_orders(verified_at)
  WHERE stage IN ('VERIFY','BILL');

-- ============================================
-- 4. wo_event — append-only audit trail
--    (every workflow change is an event; nothing overwritten silently)
-- ============================================

CREATE TABLE IF NOT EXISTS wo_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  -- created | stage_change | assign | schedule | note | photo | scope_change
  -- | approval_request | approval_decision | failed_access | recommendation
  -- | tenant_ping | tenant_reply | invoice | exception | sync_update
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,   -- user email/name, or 'system:sync' / 'system:tripwire-4'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_event_wo ON wo_event(work_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_event_type ON wo_event(event_type, created_at DESC);

-- Real append-only enforcement (even under the service role).
CREATE OR REPLACE FUNCTION wo_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'wo_event is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_wo_event_append_only ON wo_event;
CREATE TRIGGER trigger_wo_event_append_only
  BEFORE UPDATE OR DELETE ON wo_event
  FOR EACH ROW
  EXECUTE FUNCTION wo_event_append_only();

-- ============================================
-- 5. vendor — profiles (manual seed by Cheryl; sync only maintains
--    appfolio_vendor_id + name)
-- ============================================

CREATE TABLE IF NOT EXISTS vendor (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appfolio_vendor_id TEXT UNIQUE,           -- bridge to work_orders.vendor_id (TEXT)
  name TEXT NOT NULL,
  trades TEXT[],
  service_area TEXT,
  license_number TEXT,
  license_expiry DATE,
  license_required_trades TEXT[],
  insurance_carrier TEXT,
  insurance_expiry DATE,
  w9_on_file BOOLEAN NOT NULL DEFAULT false,
  hourly_rate NUMERIC,
  minimum_charge NUMERIC,
  emergency_available BOOLEAN NOT NULL DEFAULT false,
  preferred BOOLEAN NOT NULL DEFAULT false,
  demoted BOOLEAN NOT NULL DEFAULT false,   -- Monday-review manual override: forces bottom rank
  property_restrictions TEXT[],             -- properties this vendor may NOT serve
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_appfolio_id ON vendor(appfolio_vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_active ON vendor(active) WHERE active;

CREATE OR REPLACE FUNCTION update_vendor_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_vendor_timestamp ON vendor;
CREATE TRIGGER trigger_update_vendor_timestamp
  BEFORE UPDATE ON vendor
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_timestamp();

-- ============================================
-- 6. vendor_assignment — acceptance/performance tracking (tripwire #4,
--    vendor ranking inputs). accepted_at is set manually in Wave 1;
--    magic-link acceptance is Wave 2.
-- ============================================

CREATE TABLE IF NOT EXISTS vendor_assignment (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendor(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  callback BOOLEAN NOT NULL DEFAULT false,  -- rework on same issue
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_assignment_wo ON vendor_assignment(work_order_id);
CREATE INDEX IF NOT EXISTS idx_vendor_assignment_vendor ON vendor_assignment(vendor_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_assignment_unaccepted ON vendor_assignment(sent_at)
  WHERE accepted_at IS NULL AND declined_at IS NULL;

-- ============================================
-- 7. approval — owner/PM approvals (tripwires #6, #11)
-- ============================================

CREATE TABLE IF NOT EXISTS approval (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('OWNER','PM')),
  requested_of TEXT NOT NULL,
  estimate NUMERIC,
  photos JSONB,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decision TEXT CHECK (decision IN ('APPROVED','DECLINED')),
  approved_amount NUMERIC,
  conditions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_wo ON approval(work_order_id);
CREATE INDEX IF NOT EXISTS idx_approval_pending ON approval(requested_at)
  WHERE decided_at IS NULL;

-- ============================================
-- 8. recommendation — field follow-ups (tripwire #10):
--    each becomes a WO or is dismissed in writing within 3 days
-- ============================================

CREATE TABLE IF NOT EXISTS recommendation (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  tech TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_wo_id UUID REFERENCES work_orders(id),  -- became a WO, or…
  dismissed_reason TEXT                            -- …dismissed in writing
);

CREATE INDEX IF NOT EXISTS idx_recommendation_wo ON recommendation(work_order_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_open ON recommendation(created_at)
  WHERE resolved_wo_id IS NULL AND dismissed_reason IS NULL;

-- ============================================
-- 9. turn — turnover board data (tripwire #12)
-- ============================================

CREATE TABLE IF NOT EXISTS turn (
  work_order_id UUID PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
  vacated_at DATE NOT NULL,
  target_ready DATE,
  current_blocker TEXT,
  budget NUMERIC,
  actual NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_turn_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_turn_timestamp ON turn;
CREATE TRIGGER trigger_update_turn_timestamp
  BEFORE UPDATE ON turn
  FOR EACH ROW
  EXECUTE FUNCTION update_turn_timestamp();

-- ============================================
-- 10. RLS (service-role pattern, same as work_orders).
--     Vendor/tech-scoped RLS is deferred to Wave 2 — all Wave 1 access
--     is session-gated staff through the service-role client.
-- ============================================

ALTER TABLE wo_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE turn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to wo_event" ON wo_event;
CREATE POLICY "Service role full access to wo_event" ON wo_event
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to vendor" ON vendor;
CREATE POLICY "Service role full access to vendor" ON vendor
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to vendor_assignment" ON vendor_assignment;
CREATE POLICY "Service role full access to vendor_assignment" ON vendor_assignment
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to approval" ON approval;
CREATE POLICY "Service role full access to approval" ON approval
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to recommendation" ON recommendation;
CREATE POLICY "Service role full access to recommendation" ON recommendation
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to turn" ON turn;
CREATE POLICY "Service role full access to turn" ON turn
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON wo_event, vendor, vendor_assignment, approval, recommendation, turn TO service_role;

-- ============================================
-- Verification queries (run after):
--   SELECT stage, count(*) FROM work_orders GROUP BY 1 ORDER BY 1;
--   UPDATE wo_event SET actor = 'x' WHERE false;  -- table exists; any real UPDATE raises
--   SELECT count(*) FROM work_orders WHERE stage != 'CLOSED' AND next_action_date IS NULL; -- 0
-- ============================================
