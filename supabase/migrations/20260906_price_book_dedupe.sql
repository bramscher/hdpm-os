-- Turn Estimator — fix: dedupe price_book_item + enforce one current price/item.
--
-- The Slice 0 seed used `ON CONFLICT DO NOTHING` but price_book_item had no
-- unique constraint to conflict on (effective-dating means many rows per code
-- OVER TIME are legal). So re-running the seed inserted full duplicate sets.
-- This removes the duplicate CURRENT rows and adds a partial unique index that
-- allows at most ONE open/active row per (org_id, item_code) — historical
-- (closed / retired) rows are unaffected, so reprice/retire still work.
--
-- Apply manually in Supabase. Idempotent.

-- 1. Delete duplicate CURRENT rows (effective_to IS NULL AND active), keeping the
--    earliest (lowest id) per (org_id, item_code). Skips any row referenced by an
--    estimate_line (the FK would block it — those are the ones to keep anyway).
DELETE FROM price_book_item a
USING price_book_item b
WHERE a.org_id = b.org_id
  AND a.item_code = b.item_code
  AND a.effective_to IS NULL AND b.effective_to IS NULL
  AND a.active AND b.active
  AND a.id > b.id
  AND NOT EXISTS (SELECT 1 FROM estimate_line el WHERE el.price_book_item_id = a.id);

-- 2. Enforce one current price per item going forward.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_book_item_current
  ON price_book_item (org_id, item_code)
  WHERE effective_to IS NULL AND active;

NOTIFY pgrst, 'reload schema';
