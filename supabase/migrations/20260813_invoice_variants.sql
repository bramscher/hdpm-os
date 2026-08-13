-- ============================================
-- HDMS invoice duplicates ("variants").
-- Apply manually in the Supabase SQL Editor (per supabase/migrations/README.md).
-- Idempotent.
--
-- A "duplicate" reuses the SOURCE invoice's number and adds a suffix:
-- HDMS-INV-000041 -> HDMS-INV-000041-1 -> ...-2. `variant_suffix` is NULL for the
-- original and 1,2,... for each duplicate; `duplicated_from_id` links back to the
-- source (mirrors the credits_invoice_id pattern). Because a base number can now
-- appear on several rows, uniqueness moves from invoice_number alone to
-- (invoice_number, variant_suffix).
-- ============================================

-- 1. Variant columns.
ALTER TABLE hdms_invoices
  ADD COLUMN IF NOT EXISTS variant_suffix INTEGER;  -- NULL = original; 1,2,... = duplicate

ALTER TABLE hdms_invoices
  ADD COLUMN IF NOT EXISTS duplicated_from_id UUID
    REFERENCES hdms_invoices(id) ON DELETE SET NULL;

-- 2. Move uniqueness off invoice_number alone. Drop the auto-named single-column
--    UNIQUE constraint (whatever it's called) so a base number can carry variants,
--    then enforce uniqueness on (invoice_number, variant_suffix) — treating the
--    original's NULL as 0 so it can't collide with itself.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'hdms_invoices'::regclass
    AND contype = 'u'
    AND conkey = (
      SELECT array_agg(attnum)
      FROM pg_attribute
      WHERE attrelid = 'hdms_invoices'::regclass AND attname = 'invoice_number'
    );
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE hdms_invoices DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hdms_invoices_number_variant
  ON hdms_invoices (invoice_number, COALESCE(variant_suffix, 0));

-- 3. Re-derive invoice_code to append the variant suffix (…-1), preserving the
--    credit (HDMS-CR) vs invoice (HDMS-INV) prefix from 20260812_invoice_credits.
ALTER TABLE hdms_invoices DROP COLUMN IF EXISTS invoice_code;
ALTER TABLE hdms_invoices
  ADD COLUMN invoice_code TEXT GENERATED ALWAYS AS (
    'HDMS-' || CASE WHEN doc_type = 'credit' THEN 'CR-' ELSE 'INV-' END
      || LPAD(invoice_number::text, 6, '0')
      || CASE WHEN variant_suffix IS NOT NULL THEN '-' || variant_suffix ELSE '' END
  ) STORED;

NOTIFY pgrst, 'reload schema';
