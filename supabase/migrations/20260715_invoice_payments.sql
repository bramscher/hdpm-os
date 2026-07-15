-- Migration: Invoice payment reconciliation
-- Date: 2026-07-15
-- Description:
--   AppFolio pays HDMS out of the Client Trust Account as one lump ACH covering
--   many invoices (e.g. an $18,705.34 ACH written 7/10/2025). This adds a
--   hdms_payments ledger and links each HDMS invoice to the payment that covered
--   it, so a batch can be reconciled against what we billed and paid/outstanding
--   is visible. A payment's totals are snapshotted at record time so the ledger
--   stays stable even if a linked invoice is later edited.

-- Step 1: Payments ledger
CREATE TABLE IF NOT EXISTS hdms_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  paid_on DATE NOT NULL,                       -- the ACH/check date
  amount NUMERIC(12,2) NOT NULL,               -- the ACH total actually received
  reference TEXT,                              -- ACH/check reference number
  method TEXT NOT NULL DEFAULT 'ach',          -- ach | check | other
  memo TEXT,

  -- Snapshot of the linked invoices at record time (audit / stable ledger)
  invoice_count INTEGER NOT NULL DEFAULT 0,
  labor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  materials_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_total NUMERIC(12,2) NOT NULL DEFAULT 0,  -- sum of linked total_amount

  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hdms_payments_paid_on ON hdms_payments(paid_on DESC);

-- Step 2: Link invoices to the payment that covered them.
--   payment_id set = reconciled / paid. Orthogonal to the status enum.
ALTER TABLE hdms_invoices
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES hdms_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hdms_invoices_payment_id
  ON hdms_invoices(payment_id)
  WHERE payment_id IS NOT NULL;

-- Step 3: Auto-update updated_at (reuse the existing invoice timestamp function)
DROP TRIGGER IF EXISTS trigger_update_hdms_payment_timestamp ON hdms_payments;
CREATE TRIGGER trigger_update_hdms_payment_timestamp
  BEFORE UPDATE ON hdms_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_hdms_invoice_timestamp();

-- Step 4: RLS (service role only, mirrors hdms_invoices)
ALTER TABLE hdms_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to payments" ON hdms_payments;
CREATE POLICY "Service role full access to payments" ON hdms_payments
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON hdms_payments TO service_role;

-- ============================================
-- Verification
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'hdms_payments' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'hdms_invoices' AND column_name = 'payment_id';
