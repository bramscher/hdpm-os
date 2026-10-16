-- ============================================
-- Security: work_orders (and the other setup-script tables) for the server only
-- Date: 2026-10-31
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- work_orders, hdms_invoices, rental_comps and market_baselines were created
-- by the old setup scripts (scripts/create-work-orders.sql,
-- create-hdms-invoices.sql, create-rental-comps.sql), not by a migration, with
-- a policy meant for the server key:
--   CREATE POLICY "Service role full access to …" FOR ALL USING (true) WITH CHECK (true)
-- It has no TO service_role, so it applies to EVERY role. With Supabase's
-- default grants, anyone holding the public (publishable) key, which every
-- browser gets, or any signed-in referral partner could read and change these
-- tables through the Supabase API. 20261018_harden_table_grants.sql fixed the
-- same mistake on tables created by migrations; these four were missed.
--
-- The app reads and writes these tables only with the service-role key, which
-- bypasses grants and RLS, so nothing in the app changes. For each table this
-- keeps RLS on, limits the policy to the service role, drops any other policy
-- that lets the browser roles in, and revokes their privileges (and on the
-- invoice-number sequence).
--
-- Check after (should return no rows):
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
--     AND table_name IN ('work_orders', 'hdms_invoices', 'rental_comps', 'market_baselines');
-- ============================================

BEGIN;

DO $$
DECLARE
  t text;
  service_policy text;
  pol text;
BEGIN
  FOR t, service_policy IN
    SELECT * FROM (VALUES
      ('work_orders',      'Service role full access to work_orders'),
      ('hdms_invoices',    'Service role full access to invoices'),
      ('rental_comps',     'Service role full access to rental_comps'),
      ('market_baselines', 'Service role full access to market_baselines')
    ) AS v(t, service_policy)
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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', service_policy, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', service_policy, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;

  IF to_regclass('public.hdms_invoice_number_seq') IS NOT NULL THEN
    REVOKE ALL ON SEQUENCE public.hdms_invoice_number_seq FROM PUBLIC, anon, authenticated;
    GRANT USAGE, SELECT ON SEQUENCE public.hdms_invoice_number_seq TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
