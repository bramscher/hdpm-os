-- Migration: Payment capture (payee + source, AppFolio import slot)
-- Date: 2026-07-15
-- Description:
--   Decouple capturing an ACH payment from reconciling invoices against it.
--   A payment can now be captured "open" (no invoices yet), tagged with its
--   payee (default High Desert Maintenance Services) and source (manual today,
--   'appfolio' once the Reports API check-register import lands). appfolio_id
--   reserves a dedup key for that future import.

ALTER TABLE hdms_payments
  ADD COLUMN IF NOT EXISTS payee TEXT NOT NULL DEFAULT 'High Desert Maintenance Services',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',   -- manual | appfolio
  ADD COLUMN IF NOT EXISTS appfolio_id TEXT;                         -- check-register entry id (import dedup)

-- One row per imported AppFolio disbursement (manual rows keep appfolio_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hdms_payments_appfolio_id
  ON hdms_payments(appfolio_id)
  WHERE appfolio_id IS NOT NULL;

-- ============================================
-- Verification
-- ============================================
-- SELECT column_name, data_type, column_default FROM information_schema.columns
-- WHERE table_name = 'hdms_payments' AND column_name IN ('payee','source','appfolio_id');
