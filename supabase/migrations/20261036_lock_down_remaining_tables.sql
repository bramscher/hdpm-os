-- ============================================
-- Security: the last tables still open to the browser key, for the server only
-- Date: 2026-11-01
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- A scan of the migrations found 17 tables with no row-level security and no
-- revoke (reception_call also has an open policy). With Supabase's default
-- grants, anyone holding the public (publishable) key, which every browser
-- gets, or any signed-in referral partner could read and change them through
-- the Supabase API. Same fix as 20261018_harden_table_grants.sql and
-- 20261031_lock_down_work_orders.sql.
--
-- Nothing outside the server reads these tables: the app uses the
-- service-role key for all of them (the browser key is only used for
-- knowledge-capture storage uploads and the referral portal's
-- referral_partner), and the website (hdpm-web) reads only web_listings and
-- storage, with the service key. So nothing in either app changes.
--
-- For each table that exists this turns RLS on, drops any policy that lets
-- the browser roles in, adds one policy for the service role, and revokes the
-- browser roles' privileges on the table and its id sequences. A table that
-- doesn't exist is skipped.
--
-- Check after (should return no rows): every public table the browser key can
-- still reach without RLS stopping it.
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
--     AND has_table_privilege('anon', c.oid, 'SELECT')
--     AND (NOT c.relrowsecurity OR EXISTS (
--       SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
--         AND p.roles && ARRAY['public', 'anon']::name[]))
--   ORDER BY 1;
-- ============================================

BEGIN;

DO $$
DECLARE
  t text;
  pol text;
  seq text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cached_vacancies', 'dashboard_config', 'haven_conversation', 'import_batches',
    'inspection_audit_log', 'inspection_properties', 'inspections', 'kpi_snapshots',
    'lead_events', 'property_mgmt_status', 'reception_call', 'rent_analyses',
    'route_plans', 'route_stops', 'saved_listings', 'zoom_contact_map', 'zoom_sync_runs'
  ]
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Any policy that lets in everyone, anonymous visitors or signed-in users.
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol, t);
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Service role full access to ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'Service role full access to ' || t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    -- The table's own sequences (serial ids).
    FOR seq IN
      SELECT s.relname FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
      WHERE s.relkind = 'S' AND d.refobjid = format('public.%I', t)::regclass
    LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', seq);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', seq);
    END LOOP;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
