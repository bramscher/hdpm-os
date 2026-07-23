-- ============================================
-- Migration: AppFolio unit page link on unit turns
-- Date: 2026-07-26
-- Run this in the Supabase SQL Editor.
--
-- Lets the Turnover board deep-link each unit straight to its AppFolio page.
-- Filled by the daily Reports-API true-up (unit Link from v0 /units).
--
-- NOTE: plain ASCII, one DDL statement per line, pastes into SQL Editor.
-- ============================================

ALTER TABLE unit_turn
  ADD COLUMN IF NOT EXISTS af_unit_link TEXT;
