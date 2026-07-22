-- ============================================
-- Invoice reconciliation: AppFolio HDMS bill snapshot
-- ============================================
-- Every HDMS invoice should be entered as a vendor bill in AppFolio (vendor
-- "High Desert Maintenance Services - Division of HDPM"). This table mirrors
-- those bills so the app can show the AppFolio-billed amount next to each
-- HDMS invoice and flag revenue that was never billed. Bills carry no
-- WorkOrderId in the v0 API; matching keys off Reference (invoice number or
-- WO reference) with a manual-match fallback. Synced incrementally from
-- /bills?filters[LastUpdatedAtFrom] and from the bills webhook topic.

CREATE TABLE IF NOT EXISTS af_bills (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appfolio_bill_id    TEXT NOT NULL UNIQUE,   -- v0 bill Id (upsert key)
  reference           TEXT,                   -- vendor invoice # as entered in AppFolio
  description         TEXT,
  vendor_id           TEXT NOT NULL,
  total_amount        NUMERIC(12,2) NOT NULL,
  invoice_date        DATE,
  due_date            DATE,
  approval_status     TEXT,
  af_last_updated_at  TIMESTAMPTZ,            -- source of the incremental sync checkpoint
  hdms_invoice_id     UUID REFERENCES hdms_invoices(id) ON DELETE SET NULL,
  match_method        TEXT,                   -- reference | wo_reference | description | manual
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_af_bills_invoice ON af_bills (hdms_invoice_id);
CREATE INDEX IF NOT EXISTS idx_af_bills_reference ON af_bills (reference);

ALTER TABLE af_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to af_bills" ON af_bills;
CREATE POLICY "Service role full access to af_bills" ON af_bills FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON af_bills TO service_role;

NOTIFY pgrst, 'reload schema';
