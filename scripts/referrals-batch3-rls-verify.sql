-- ============================================
-- Batch 3 verification — referrer lead-INSERT RLS
-- Run in the Supabase SQL Editor AFTER applying 20260828d_referral_lead_submit_rls.sql.
--
-- Transactional; ROLLBACKs at the end (leaves no data). Proves the new INSERT
-- policy on referral_lead: a logged-in referrer may insert leads ONLY for
-- themselves and ONLY as source='referral'. A FAIL raises and aborts.
-- ============================================

BEGIN;

-- Two referrers with linked auth users.
INSERT INTO referral_partner (id, auth_user_id, type, status, display_name, referral_code)
VALUES
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'owner', 'active', 'Lead RLS A', 'LEADRLS-A'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000bb', 'agent', 'active', 'Lead RLS B', 'LEADRLS-B');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa"}', true);

DO $$
BEGIN
  -- 1. Allowed: own partner_id + source='referral'.
  BEGIN
    INSERT INTO referral_lead (partner_id, source, stage, prospect_name)
    VALUES ('30000000-0000-0000-0000-00000000000a', 'referral', 'submitted', 'Own Referral Lead');
    RAISE NOTICE 'PASS: referrer A inserted its own referral lead.';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FAIL: referrer A could NOT insert its own referral lead (%).', SQLERRM;
  END;

  -- 2. Blocked: inserting under ANOTHER partner's id.
  BEGIN
    INSERT INTO referral_lead (partner_id, source, stage, prospect_name)
    VALUES ('30000000-0000-0000-0000-00000000000b', 'referral', 'submitted', 'Cross-tenant Lead');
    RAISE EXCEPTION 'FAIL: referrer A inserted a lead under referrer B (RLS breach).';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'PASS: cross-partner insert blocked.';
    WHEN others THEN
      IF SQLERRM LIKE '%row-level security%' OR SQLERRM LIKE '%violates%' THEN RAISE NOTICE 'PASS: cross-partner insert blocked (%).', SQLERRM;
      ELSE RAISE; END IF;
  END;

  -- 3. Blocked: inserting as source='organic' (reserved for the service path).
  BEGIN
    INSERT INTO referral_lead (partner_id, source, stage, prospect_name)
    VALUES ('30000000-0000-0000-0000-00000000000a', 'organic', 'submitted', 'Sneaky Organic');
    RAISE EXCEPTION 'FAIL: referrer A inserted an organic lead (should be referral-only).';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'PASS: organic insert blocked.';
    WHEN others THEN
      IF SQLERRM LIKE '%row-level security%' OR SQLERRM LIKE '%violates%' THEN RAISE NOTICE 'PASS: organic insert blocked (%).', SQLERRM;
      ELSE RAISE; END IF;
  END;
END $$;

RESET ROLE;

SELECT 'ALL BATCH 3 RLS CHECKS PASSED — referrer can insert only its own referral leads (rolled back)' AS verify_result;

ROLLBACK;
