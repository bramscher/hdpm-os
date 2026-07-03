-- ============================================
-- Migration: store AppFolio's own CreatedAt on work_orders
-- Date: 2026-07-03
-- Run this in the Supabase SQL Editor
--
-- work_orders.created_at is when the row landed in OUR database — wrong for
-- age math after catch-up syncs insert years-old history (the wide 2026-07-03
-- sync made 2024 emergencies look "created this week" on the Monday Review).
-- appfolio_created_at is the mirror of AppFolio's CreatedAt; all age/aging/P1
-- calculations use COALESCE(appfolio_created_at, created_at).
-- ============================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS appfolio_created_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
