-- Migration: Payment appliance_total snapshot column
-- Date: 2026-07-28
-- Description:
--   Appliance line items (10% markup) were added to invoices after the
--   hdms_payments ledger, so their charged amount has been folded into
--   materials_total. Break appliances into their own snapshot column so the
--   Reconcile ledger can show Labor / Materials / Appliances separately and
--   tie out against invoice_total.
--
--   After applying, run `npx tsx scripts/recompute-payment-snapshots.ts` to
--   re-split materials_total/appliance_total on existing payments from their
--   linked invoices' line items.

ALTER TABLE hdms_payments
  ADD COLUMN IF NOT EXISTS appliance_total NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ============================================
-- Verification
-- ============================================
-- SELECT column_name, data_type, column_default FROM information_schema.columns
-- WHERE table_name = 'hdms_payments' AND column_name = 'appliance_total';
