-- ============================================
-- Fix up the unit-turn template versions published by 20261017_dump_run_price_book
-- Date: 2026-10-19
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- That migration appended Dump run + Dump fee but kept the old
-- "Dump fees" (MATERIALS_CP, marked up) line, so a dump could be charged
-- twice. For the versions it created (created_by = 'migration:dump-run'):
--   * drop the old "Dump fees" materials line
--   * place Dump run + Dump fee right after Haul-away (end if no haul-away)
--   * leave the fee's cost blank: the Price Book default ($10) fills it,
--     so changing the default in the Price Book flows through.
-- Only those migration-created versions are touched; anything a person
-- published afterwards is left alone.
-- ============================================

UPDATE estimate_template t
SET entries = (
  WITH base AS (
    SELECT e, ord::numeric AS o
    FROM jsonb_array_elements(t.entries) WITH ORDINALITY AS a(e, ord)
    WHERE coalesce(e->>'item_code', '') NOT IN ('DUMP_RUN', 'DUMP_FEE')
      AND NOT (e->>'item_code' = 'MATERIALS_CP' AND e->>'description' = 'Dump fees')
  ),
  anchor AS (
    SELECT coalesce(min(o) FILTER (WHERE e->>'item_code' = 'HAUL_LOAD'), max(o), 0) AS a FROM base
  ),
  dump(e, off) AS (
    VALUES
      ('{"item_code":"DUMP_RUN","description":"Dump run","qty":"1","minutes":"60","material_cost":"","room":"","included":false}'::jsonb, 0.1),
      ('{"item_code":"DUMP_FEE","description":"Dump fee","qty":"1","minutes":"","material_cost":"","room":"","included":false}'::jsonb, 0.2)
  )
  SELECT jsonb_agg(x.e ORDER BY x.o)
  FROM (
    SELECT e, o FROM base
    UNION ALL
    SELECT d.e, (SELECT a FROM anchor) + d.off FROM dump d
  ) x
)
WHERE t.created_by = 'migration:dump-run';
