-- ============================================
-- Migration: store the AppFolio deep link on work_orders
-- Date: 2026-07-03
-- Run this in the Supabase SQL Editor
--
-- The v0 API returns a `Link` field per work order — a direct URL to the WO
-- page in the AppFolio web app. The dashboard uses it as the jump-off point:
-- anything AppFolio owns (status, scheduling, vendor assignment) is edited
-- THERE; this app only edits its own overlay (owner, next-action date,
-- priority class, closure gate).
-- ============================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS appfolio_link TEXT;
