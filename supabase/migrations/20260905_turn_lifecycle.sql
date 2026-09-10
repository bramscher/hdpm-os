-- Turn Estimator — Slice 1: turn lifecycle status machine.
--
-- Adds the spec's controlled 15-state (+ exception) lifecycle to unit_turn as a
-- NEW column, alongside the legacy 3-state status (active/ready/closed) which the
-- turnover board + tripwires keep reading. lifecycle_status is the source of
-- truth; legacy status is derived from it (see deriveLegacyStatus). An append-
-- only turn_status_event trail records every transition (for vacant-days and
-- time-in-status metrics).
--
-- Apply manually in Supabase. Idempotent. Requires 20260904 (Slice 0).

-- Append-only guard (redefined here so this migration is self-contained).
CREATE OR REPLACE FUNCTION te_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'table is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ── unit_turn.lifecycle_status ───────────────────────────────────────────────

ALTER TABLE unit_turn
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'NOTICE_RECEIVED';

-- Constrain to the known set (drop+add so re-runs stay idempotent).
ALTER TABLE unit_turn DROP CONSTRAINT IF EXISTS chk_unit_turn_lifecycle_status;
ALTER TABLE unit_turn ADD CONSTRAINT chk_unit_turn_lifecycle_status CHECK (
  lifecycle_status IN (
    'NOTICE_RECEIVED','INSPECTION_SCHEDULED','INSPECTED','SCOPE_DRAFT','ESTIMATE_READY',
    'APPROVAL_PENDING','APPROVED','SCHEDULED','IN_PROGRESS','QC_PENDING','TURN_READY',
    'INVOICE_REVIEW','INVOICED','POSTED','CLOSED',
    'ON_HOLD_OWNER','ON_HOLD_PARTS','ON_HOLD_VENDOR','CHANGE_ORDER_PENDING','DISPUTED','CANCELLED'
  )
);

-- Backfill existing rows from the legacy status (all rows currently sit at the
-- column default). closed→CLOSED, ready→TURN_READY, active→IN_PROGRESS.
UPDATE unit_turn SET lifecycle_status = CASE status
  WHEN 'closed' THEN 'CLOSED'
  WHEN 'ready'  THEN 'TURN_READY'
  ELSE 'IN_PROGRESS'
END
WHERE lifecycle_status = 'NOTICE_RECEIVED';  -- i.e. rows that just took the default

CREATE INDEX IF NOT EXISTS idx_unit_turn_lifecycle ON unit_turn(lifecycle_status)
  WHERE lifecycle_status NOT IN ('CLOSED','CANCELLED');

-- ── turn_status_event (append-only transition history) ───────────────────────

CREATE TABLE IF NOT EXISTS turn_status_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_turn_id UUID NOT NULL REFERENCES unit_turn(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_turn_status_event_turn
  ON turn_status_event(unit_turn_id, created_at);

DROP TRIGGER IF EXISTS trg_turn_status_event_append_only ON turn_status_event;
CREATE TRIGGER trg_turn_status_event_append_only
  BEFORE UPDATE OR DELETE ON turn_status_event
  FOR EACH ROW EXECUTE FUNCTION te_append_only();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE turn_status_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to turn_status_event" ON turn_status_event;
CREATE POLICY "Service role full access to turn_status_event" ON turn_status_event
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON turn_status_event TO service_role;

NOTIFY pgrst, 'reload schema';
