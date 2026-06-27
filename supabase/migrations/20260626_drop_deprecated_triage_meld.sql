-- Migration: Drop deprecated Backlog Triage and Property Meld columns
-- Date: 2026-06-26
-- Description: The Backlog Triage feature and the Property Meld integration have
--   been removed from the app. This drops their now-unused columns and indexes.
--   The work_orders, inspections, and inspection_properties tables themselves are
--   retained — only the feature-specific columns are removed.

-- ── Backlog Triage columns on work_orders ──
ALTER TABLE work_orders
  DROP COLUMN IF EXISTS triage_recommendation,
  DROP COLUMN IF EXISTS triage_reason,
  DROP COLUMN IF EXISTS triage_reviewed_at,
  DROP COLUMN IF EXISTS triage_action_taken,
  DROP COLUMN IF EXISTS triage_was_overridden,
  DROP COLUMN IF EXISTS triage_scored_by;

-- ── Property Meld notice-automation columns on inspections ──
DROP INDEX IF EXISTS idx_inspections_notice_pending;

ALTER TABLE inspections
  DROP COLUMN IF EXISTS notice_meld_id,
  DROP COLUMN IF EXISTS notice_7d_sent_at,
  DROP COLUMN IF EXISTS notice_24h_sent_at,
  DROP COLUMN IF EXISTS notice_2h_sent_at,
  DROP COLUMN IF EXISTS meld_id;

-- ── Property Meld linkage columns on inspection_properties ──
DROP INDEX IF EXISTS idx_inspection_properties_pm_ids;

ALTER TABLE inspection_properties
  DROP COLUMN IF EXISTS pm_property_id,
  DROP COLUMN IF EXISTS pm_unit_id,
  DROP COLUMN IF EXISTS source;
