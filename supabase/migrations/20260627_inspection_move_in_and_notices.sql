-- Migration: Move-in-anchored inspection cadence + notice tracking
-- Date: 2026-06-27
-- Description: The inspection scheduler now anchors its 6-month cadence to each
--   occupied unit's current tenant move-in date (sourced from AppFolio), resetting
--   on every new tenant. Tenant notices are sent through AppFolio (Realm-X) so they
--   are logged in AppFolio; this adds the supporting cadence + notice-tracking columns.
--
-- Depends on: 20260520_inspection_candidate_columns.sql (appfolio_* / candidate_status).

-- ── inspection_properties: cadence anchors + tenant contact for notices ──
ALTER TABLE inspection_properties
  ADD COLUMN IF NOT EXISTS move_in_date   DATE,   -- current tenant move-in (AppFolio MoveInOn)
  ADD COLUMN IF NOT EXISTS next_due_date  DATE,   -- computed: max(move_in, last_inspection) + 6 months
  ADD COLUMN IF NOT EXISTS resident_name  TEXT,   -- current resident (for the notice)
  ADD COLUMN IF NOT EXISTS tenant_email   TEXT;   -- where the notice is sent

CREATE INDEX IF NOT EXISTS idx_inspection_properties_next_due
  ON inspection_properties (next_due_date);

-- ── inspections: per-inspection snapshot + notice tracking ──
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS move_in_date      DATE,         -- snapshot of the anchoring move-in
  ADD COLUMN IF NOT EXISTS notice_email      TEXT,         -- tenant email for the notice
  ADD COLUMN IF NOT EXISTS notice_status     TEXT,         -- pending | sent | skipped_no_email
  ADD COLUMN IF NOT EXISTS notice_sent_at    TIMESTAMPTZ,  -- when the notice was sent (in AppFolio)
  ADD COLUMN IF NOT EXISTS notice_message_id TEXT;         -- optional external/audit id

-- Pending notices to send: scheduled inspections with a target date and no notice yet.
CREATE INDEX IF NOT EXISTS idx_inspections_notice_pending
  ON inspections (target_date)
  WHERE status = 'scheduled' AND notice_sent_at IS NULL;
