-- Migration: Property management status for the portfolio map
-- Date: 2026-07-27
-- Description: One row per AppFolio property tracking the management
-- relationship: active (green), offboarding (yellow — owner on the way out),
-- lost (red — listing lost). Properties with no row default to active.
-- Set from the /properties/map UI; AppFolio has no field for this.

CREATE TABLE IF NOT EXISTS property_mgmt_status (
  appfolio_property_id TEXT PRIMARY KEY,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'offboarding', 'lost')),
  note                 TEXT,
  updated_by           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_mgmt_status_status
  ON property_mgmt_status (status)
  WHERE status <> 'active';
