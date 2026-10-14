-- ============================================
-- Work order invoices and bills from AppFolio (Reports API)
-- Date: 2026-10-26
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- One row per AppFolio work order number, refreshed by
-- /api/maintenance/cron/af-billing from two reports:
--   work_order.vendor_portal_invoices  invoices uploaded to the work order
--   bill_detail lines with work_order   bills entered against it ($ paid/unpaid)
-- The files themselves aren't available through the API.
-- ============================================

CREATE TABLE IF NOT EXISTS wo_af_billing (
  wo_number TEXT PRIMARY KEY,               -- matches work_orders.wo_number
  af_work_order_id BIGINT,                  -- Reports API work_order_id
  invoice_count INT NOT NULL DEFAULT 0,     -- vendor_portal_invoices
  bill_lines INT NOT NULL DEFAULT 0,
  billed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  unpaid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_bill_date DATE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wo_af_billing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to wo_af_billing" ON wo_af_billing;
CREATE POLICY "Service role full access to wo_af_billing" ON wo_af_billing FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON wo_af_billing FROM anon, authenticated;
GRANT ALL ON wo_af_billing TO service_role;

NOTIFY pgrst, 'reload schema';
