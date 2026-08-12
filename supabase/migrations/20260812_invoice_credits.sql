-- ============================================
-- HDMS credit documents (credit memos).
-- Apply manually in the Supabase SQL Editor (per supabase/migrations/README.md).
-- Idempotent.
--
-- A credit is a NEGATIVE-amount document on the same hdms_invoices spine, so it
-- nets automatically through every aggregate / payment snapshot. `doc_type`
-- discriminates it from a normal invoice; it flows through the same
-- draft -> generated -> attached lifecycle (create -> PDF -> uploaded to AppFolio).
-- Optional `credits_invoice_id` links a credit back to the invoice it corrects
-- (standalone credits leave it NULL).
-- ============================================

-- 1. Discriminator + optional back-link.
ALTER TABLE hdms_invoices
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'invoice'
    CHECK (doc_type IN ('invoice', 'credit'));

ALTER TABLE hdms_invoices
  ADD COLUMN IF NOT EXISTS credits_invoice_id UUID
    REFERENCES hdms_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hdms_invoices_doc_type ON hdms_invoices(doc_type);

-- 2. Re-derive the generated code column so credits read HDMS-CR-000042 while
--    invoices stay HDMS-INV-000041 (both draw from the shared number sequence,
--    so numbers remain unique across the two). No DB view depends on this column.
ALTER TABLE hdms_invoices DROP COLUMN IF EXISTS invoice_code;
ALTER TABLE hdms_invoices
  ADD COLUMN invoice_code TEXT GENERATED ALWAYS AS (
    'HDMS-' || CASE WHEN doc_type = 'credit' THEN 'CR-' ELSE 'INV-' END
      || LPAD(invoice_number::text, 6, '0')
  ) STORED;

NOTIFY pgrst, 'reload schema';
