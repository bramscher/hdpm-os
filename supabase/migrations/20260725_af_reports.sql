-- ============================================
-- Migration: Reports API true-up key for unit turns
-- Date: 2026-07-25
-- Run this in the Supabase SQL Editor.
--
-- The AppFolio Reports API v2 (unit_turn_detail.json) exposes AppFolio's own
-- Unit Turn id plus authoritative move-out/move-in dates and billed totals.
-- af_unit_turn_id keys the daily true-up so re-runs update in place.
--
-- NOTE: plain ASCII, one DDL statement per line, pastes into SQL Editor.
-- ============================================

ALTER TABLE unit_turn
  ADD COLUMN IF NOT EXISTS af_unit_turn_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_turn_af_turn_id ON unit_turn(af_unit_turn_id) WHERE af_unit_turn_id IS NOT NULL;
