-- Migration: Haven conversation ↔ AppFolio lead identity join
-- Date: 2026-07-27
-- Description: The same prospect exists as an AppFolio lead (guest card) and
-- a Haven conversation, linked only by email/phone. The daily Haven sync
-- matches them and stores the AppFolio linkage here: deep links for staff
-- ("Open in AppFolio"), the property UUID for per-property demand views, and
-- the lead status for conversion attribution.

ALTER TABLE haven_conversation
  ADD COLUMN IF NOT EXISTS appfolio_lead_id     TEXT,
  ADD COLUMN IF NOT EXISTS appfolio_lead_link   TEXT,
  ADD COLUMN IF NOT EXISTS appfolio_property_id TEXT,
  ADD COLUMN IF NOT EXISTS af_lead_status       TEXT,
  ADD COLUMN IF NOT EXISTS af_matched_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_haven_conversation_af_lead
  ON haven_conversation (appfolio_lead_id)
  WHERE appfolio_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_haven_conversation_af_property
  ON haven_conversation (appfolio_property_id)
  WHERE appfolio_property_id IS NOT NULL;
