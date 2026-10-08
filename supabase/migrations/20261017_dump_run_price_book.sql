-- ============================================
-- Price book: dump run + dump fee, added to the unit turn templates
-- Date: 2026-10-17
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- DUMP_RUN  hourly $95/hr, 1 hour by default (hours editable on the line)
-- DUMP_FEE  cost-plus, 0% markup, so the owner pays exactly the dump receipt;
--           base_price = the default cost a new line starts with ($10),
--           editable on each estimate and in the Price Book.
-- Saved (non-archived) templates named like "unit turn" get a new version
-- with both lines appended; the built-in "Standard unit turn" is updated in
-- code (lib/turn-estimator/templates.ts).
-- ============================================

INSERT INTO price_book_item (item_code, category, name, owner_description, internal_instructions,
  pricing_method, base_price, standard_minutes, uom, markup_pct, markup_eligible, tenant_alloc_eligible,
  skill_trade, effective_from, created_by)
SELECT 'DUMP_RUN', 'disposal', 'Dump run', 'Dump run: load, haul and unload debris at the transfer station',
  'Labor for the trip to the dump. Default 1 hour; adjust hours on the line. Bill the dump receipt separately as DUMP_FEE.',
  'hourly', 95.00, 60, 'hour', NULL, false, true, 'handyman', CURRENT_DATE, 'migration:dump-run'
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_item WHERE org_id = 'hdpm' AND item_code = 'DUMP_RUN' AND active AND effective_to IS NULL
);

INSERT INTO price_book_item (item_code, category, name, owner_description, internal_instructions,
  pricing_method, base_price, uom, markup_pct, markup_eligible, tenant_alloc_eligible,
  skill_trade, effective_from, created_by)
SELECT 'DUMP_FEE', 'disposal', 'Dump fee', 'Transfer station / dump fee',
  'Enter the actual dump receipt amount on the line (starts at the default cost). Billed at cost, no markup.',
  'cost_plus', 10.00, 'each', 0, true, true, NULL, CURRENT_DATE, 'migration:dump-run'
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_item WHERE org_id = 'hdpm' AND item_code = 'DUMP_FEE' AND active AND effective_to IS NULL
);

-- New version of each saved unit-turn template that doesn't already have a dump run.
WITH latest AS (
  SELECT DISTINCT ON (family_id) *
  FROM estimate_template
  ORDER BY family_id, version DESC
), published AS (
  INSERT INTO estimate_template (name, entries, family_id, version, created_by)
  SELECT name,
    entries || '[
      {"item_code":"DUMP_RUN","description":"Dump run","qty":"1","minutes":"60","material_cost":"","room":"","included":false},
      {"item_code":"DUMP_FEE","description":"Dump fee","qty":"1","minutes":"","material_cost":"10","room":"","included":false}
    ]'::jsonb,
    family_id, version + 1, 'migration:dump-run'
  FROM latest
  WHERE NOT archived
    AND name ILIKE '%unit turn%'
    AND NOT entries @> '[{"item_code":"DUMP_RUN"}]'::jsonb
  RETURNING to_jsonb(estimate_template.*) AS row
)
INSERT INTO maintenance_workspace_audit (actor, op, details)
SELECT 'migration:dump-run', 'template_publish', row FROM published;
