-- ============================================
-- Migration: mirror AppFolio's LastUpdatedAt on work_orders
-- Date: 2026-07-05 (Wave 1 redirect, Session A)
-- Run this in the Supabase SQL Editor
--
-- Seed clock for estimate-stuck detection (tripwire #11 extension): WOs
-- sitting in "Estimate Requested" / "Estimated" are rarely touched, so
-- AppFolio's last-update time approximates when they entered the status.
-- Going forward the sync records exact status-change events; this column
-- covers the existing backlog.
-- ============================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS appfolio_last_updated_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
