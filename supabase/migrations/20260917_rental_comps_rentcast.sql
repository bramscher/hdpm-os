-- Allow actual RentCast rental listings and atomic, repeatable imports.
BEGIN;
ALTER TABLE public.rental_comps DROP CONSTRAINT IF EXISTS rental_comps_data_source_check;
ALTER TABLE public.rental_comps ADD CONSTRAINT rental_comps_data_source_check
  CHECK (data_source IN ('appfolio', 'rentometer', 'rentcast', 'hud_fmr', 'manual'));
-- A full unique index supports PostgREST upserts; multiple NULLs remain allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_comps_external_id_upsert
  ON public.rental_comps (external_id);
COMMIT;
