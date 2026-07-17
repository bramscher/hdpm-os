-- Migration: Mirror AppFolio's Recurring flag on work orders
-- Date: 2026-07-17
-- Description:
--   AppFolio auto-creates recurring work orders weeks in advance; they were
--   flooding the board/tripwires as future NEW work. The v0 API exposes a
--   Recurring boolean we never captured. Mirror it so recurring WOs can be
--   hidden until the calendar week their scheduled date falls in.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS appfolio_recurring BOOLEAN NOT NULL DEFAULT false;
