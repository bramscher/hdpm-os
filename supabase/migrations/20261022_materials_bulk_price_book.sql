-- ============================================
-- Price book: bulk materials estimate (one line, not itemized)
-- Date: 2026-10-22
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- MATERIALS_BULK  cost-plus, qty fixed at 1. The tech lists the materials and
--                 supplies in the line's (multi-line) description and enters
--                 one best-guess total cost. Same 25% markup as MATERIALS_CP;
--                 change it in the Price Book. base_price 0 = new lines start
--                 at $0.00.
-- New blank estimates start with Maintenance labor + this line
-- (components/turn-estimator/EstimateBuilder.tsx).
-- ============================================

INSERT INTO price_book_item (item_code, category, name, owner_description, internal_instructions,
  pricing_method, base_price, uom, markup_pct, markup_eligible, tenant_alloc_eligible,
  skill_trade, effective_from, created_by)
SELECT 'MATERIALS_BULK', 'materials', 'Materials and supplies (bulk estimate)',
  'Materials and supplies (estimated)',
  'List the materials and supplies in the description and enter one best-guess total cost. Not itemized; marked up like Materials.',
  'cost_plus', 0.00, 'lot', 25, true, true, NULL, CURRENT_DATE, 'migration:materials-bulk'
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_item WHERE org_id = 'hdpm' AND item_code = 'MATERIALS_BULK' AND active AND effective_to IS NULL
);
