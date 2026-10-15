-- ============================================
-- Price book: re-key service call, priced flat (not hourly labor)
-- Date: 2026-10-28
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- REKEY_CALL  flat $87: re-key service call, includes 4 tenant keys
-- REKEY_CYL   $10.50 per re-keyed lock cylinder
-- Matches what Brody's Sep–Oct 2026 re-key invoices charged ($87 + $10.50 × cylinders).
-- They were entered as 1-hour labor lines, which counted as fake measured
-- hours in Daily Billing Review; these items carry a non-hourly pricing method.
-- ============================================

INSERT INTO price_book_item (item_code, category, name, owner_description, internal_instructions,
  pricing_method, base_price, uom, markup_pct, markup_eligible, tenant_alloc_eligible,
  skill_trade, effective_from, created_by)
SELECT 'REKEY_CALL', 'handyman', 'Re-key service call', 'Re-key service call, includes 4 tenant keys',
  'Flat price per visit. Add REKEY_CYL for each lock cylinder re-keyed. Not hourly; do not count as labor hours.',
  'flat', 87.00, 'visit', NULL, false, true, NULL, CURRENT_DATE, 'migration:rekey'
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_item WHERE org_id = 'hdpm' AND item_code = 'REKEY_CALL' AND active AND effective_to IS NULL
);

INSERT INTO price_book_item (item_code, category, name, owner_description, internal_instructions,
  pricing_method, base_price, uom, markup_pct, markup_eligible, tenant_alloc_eligible,
  skill_trade, effective_from, created_by)
SELECT 'REKEY_CYL', 'handyman', 'Re-keyed lock cylinder', 'Re-keyed lock cylinder',
  'Price per cylinder re-keyed; set the quantity to the number of cylinders.',
  'per_qty', 10.50, 'cylinder', NULL, false, true, NULL, CURRENT_DATE, 'migration:rekey'
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_item WHERE org_id = 'hdpm' AND item_code = 'REKEY_CYL' AND active AND effective_to IS NULL
);
