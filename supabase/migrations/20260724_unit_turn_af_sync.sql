-- ============================================
-- Migration: unit turn AppFolio sync keys
-- Date: 2026-07-24
-- Run this in the Supabase SQL Editor.
--
-- WOs created from AppFolio's Unit Turn Board carry UnitTurnCategory (the
-- turn phase) and share one ServiceRequestId per turn. Mirroring both lets
-- the sync auto-create unit_turn rows and auto-link their work orders.
-- unit_turn.af_service_request_id is the join key (NULL for manual turns).
--
-- NOTE: plain ASCII, one DDL statement per line, pastes into SQL Editor.
-- ============================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS unit_turn_category TEXT;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS af_service_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wo_af_service_request ON work_orders(af_service_request_id) WHERE af_service_request_id IS NOT NULL;

ALTER TABLE unit_turn
  ADD COLUMN IF NOT EXISTS af_service_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_turn_af_service_request ON unit_turn(af_service_request_id) WHERE af_service_request_id IS NOT NULL;
