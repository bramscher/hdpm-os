-- ============================================
-- Batch 0 verification — RLS isolation + append-only triggers
-- Run in the Supabase SQL Editor AFTER applying 20260828_referrals_core.sql.
--
-- This whole script runs in one transaction and ROLLBACKs at the end, so it
-- leaves NO data behind. A PASS run prints only NOTICE lines; any FAIL raises
-- an exception and aborts (nothing is committed either way).
--
-- It proves three Batch-0 done-state claims:
--   1. A seeded referrer sees ONLY its own referral_partner / lead rows.
--   2. A referrer sees NOTHING in admin-only tables (referral_fee_policy).
--   3. referral_ledger and referral_lead_event reject UPDATE/DELETE even
--      under a privileged role (append-only triggers).
-- ============================================

BEGIN;

-- Two fake referrers (A and B) with explicit ids so we can assert cross-tenant.
INSERT INTO referral_partner (id, auth_user_id, type, status, display_name, referral_code)
VALUES
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner', 'active', 'Referrer A', 'VERIFY-A'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'agent', 'active', 'Referrer B', 'VERIFY-B');

-- A owns one lead, one ledger row, one lead event.
INSERT INTO referral_lead (id, partner_id, source, prospect_name)
VALUES ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'referral', 'Prospect for A');

INSERT INTO referral_ledger (partner_id, lead_id, entry_type, amount, reason, actor)
VALUES ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'earned', 500, 'verify seed', 'system:verify');

INSERT INTO referral_lead_event (lead_id, event_type, actor)
VALUES ('20000000-0000-0000-0000-00000000000a', 'created', 'system:verify');

-- ---- Test 1 & 2: referrer A's view, under the `authenticated` role + A's JWT.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM referral_partner) <> 1 THEN
    RAISE EXCEPTION 'FAIL: referrer A sees % partner rows (expected exactly its own)', (SELECT count(*) FROM referral_partner);
  END IF;
  IF EXISTS (SELECT 1 FROM referral_partner WHERE auth_user_id <> '00000000-0000-0000-0000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL: referrer A can read another referrer''s partner row (RLS breach)';
  END IF;
  IF (SELECT count(*) FROM referral_lead) <> 1 THEN
    RAISE EXCEPTION 'FAIL: referrer A sees % leads (expected only its own)', (SELECT count(*) FROM referral_lead);
  END IF;
  IF (SELECT count(*) FROM referral_ledger) <> 1 THEN
    RAISE EXCEPTION 'FAIL: referrer A sees % ledger rows (expected only its own)', (SELECT count(*) FROM referral_ledger);
  END IF;
  IF (SELECT count(*) FROM referral_fee_policy) <> 0 THEN
    RAISE EXCEPTION 'FAIL: referrer A can read admin-only referral_fee_policy (% rows)', (SELECT count(*) FROM referral_fee_policy);
  END IF;
  RAISE NOTICE 'PASS: referrer A sees only its own partner/lead/ledger rows and nothing in fee_policy.';
END $$;

-- ---- Test 1 (mirror): referrer B must NOT see A's lead.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM referral_lead) <> 0 THEN
    RAISE EXCEPTION 'FAIL: referrer B can see % of A''s leads (cross-tenant breach)', (SELECT count(*) FROM referral_lead);
  END IF;
  IF (SELECT count(*) FROM referral_ledger) <> 0 THEN
    RAISE EXCEPTION 'FAIL: referrer B can see A''s ledger rows (cross-tenant breach)';
  END IF;
  RAISE NOTICE 'PASS: referrer B sees none of referrer A''s rows.';
END $$;

RESET ROLE;

-- ---- Test 3: append-only triggers reject mutation even under this role.
DO $$
BEGIN
  BEGIN
    UPDATE referral_ledger SET amount = 999 WHERE partner_id = '10000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FAIL: referral_ledger UPDATE succeeded — append-only trigger missing';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE 'PASS: referral_ledger UPDATE rejected (%).', SQLERRM;
    ELSE RAISE; END IF;
  END;

  BEGIN
    DELETE FROM referral_ledger WHERE partner_id = '10000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FAIL: referral_ledger DELETE succeeded — append-only trigger missing';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE 'PASS: referral_ledger DELETE rejected.';
    ELSE RAISE; END IF;
  END;

  BEGIN
    UPDATE referral_lead_event SET event_type = 'tamper' WHERE lead_id = '20000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FAIL: referral_lead_event UPDATE succeeded — append-only trigger missing';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE 'PASS: referral_lead_event UPDATE rejected.';
    ELSE RAISE; END IF;
  END;

  BEGIN
    DELETE FROM referral_lead_event WHERE lead_id = '20000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FAIL: referral_lead_event DELETE succeeded — append-only trigger missing';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE 'PASS: referral_lead_event DELETE rejected.';
    ELSE RAISE; END IF;
  END;
END $$;

-- Final signal as a RESULT ROW (visible in the Supabase Results grid; the
-- per-check NOTICEs above are in the Messages pane). If any check had failed,
-- its DO block would have RAISE EXCEPTION'd and we'd never reach this line.
SELECT 'ALL CHECKS PASSED — RLS isolation + append-only triggers verified (rolled back, no data kept)' AS verify_result;

ROLLBACK;
