-- Migration: Inspection tenant-notice dispatch tracking
-- Date: 2026-07-09
-- Description:
--   The tenant inspection notice was an all-or-nothing manual bridge (staff
--   copy-paste into Realm-X, then "mark all sent"). To let ANY sender record
--   results per notice — the manual bridge today, the AppFolio Realm-X MCP once
--   the connector is authenticated, or direct email later — track the channel,
--   attempts, and last error on each inspection. notice_status vocabulary
--   widens to: pending | queued | sent | failed | skipped_no_email.

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS notice_channel         TEXT,         -- manual | realmx_mcp | email
  ADD COLUMN IF NOT EXISTS notice_error           TEXT,         -- last failure reason (status='failed')
  ADD COLUMN IF NOT EXISTS notice_attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_last_attempt_at TIMESTAMPTZ;

-- Dispatch queue: scheduled inspections that have an email and still need a
-- notice (never sent). Covers pending + previously-failed (retry) alike.
CREATE INDEX IF NOT EXISTS idx_inspections_notice_dispatch
  ON inspections (target_date)
  WHERE status = 'scheduled' AND notice_sent_at IS NULL AND notice_email IS NOT NULL;
