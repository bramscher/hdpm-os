-- ============================================
-- Referral Partner Portal — Batch 1: per-referrer default fee terms
-- Plan: docs/partners/00-referral-portal-plan.md §5 (Batch 1), §2 (fee model)
--
-- Batch 1 lets an admin set a referrer's DEFAULT fee arrangement ("per referrer,
-- default by type" — plan §2). This is distinct from referral_fee_agreement,
-- which is the per-LEAD snapshot frozen at signing (lead_id NOT NULL, no lead
-- exists yet in Batch 1). This table holds the referrer-level default that a
-- future signing (Batch 3/5) snapshots FROM.
--
-- Writes are gated in app code (lib/referrals/fee-policy.ts) on
-- referral_fee_policy.allowed=true for (partner.type, fee_kind) — a disallowed
-- combination is blocked, which is Batch 1's done-state test.
--
-- Convention: applied manually in the Supabase SQL Editor; idempotent; RLS on.
-- ============================================

CREATE TABLE IF NOT EXISTS referral_partner_terms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  partner_id UUID NOT NULL REFERENCES referral_partner(id) ON DELETE CASCADE,
  fee_kind TEXT NOT NULL,                         -- one_time_bounty | trailing

  -- one_time_bounty config
  bounty_mode TEXT,                               -- fixed | per_door
  bounty_amount NUMERIC,
  bounty_trigger TEXT,                            -- agreement_signed | first_rent (first_rent deferred)

  -- trailing config
  trailing_pct NUMERIC,
  trailing_months INTEGER,

  active BOOLEAN NOT NULL DEFAULT true,
  set_by TEXT NOT NULL,                           -- admin email (lib/agents/actor.ts convention)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_id, fee_kind)                   -- one default per kind per referrer (upsert)
);

CREATE INDEX IF NOT EXISTS idx_referral_partner_terms_partner ON referral_partner_terms(partner_id);

ALTER TABLE referral_partner_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "svc referral_partner_terms" ON referral_partner_terms;
CREATE POLICY "svc referral_partner_terms" ON referral_partner_terms
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Referrer may read their own default terms (SELECT only; admin writes via service role).
DROP POLICY IF EXISTS "referrer reads own terms" ON referral_partner_terms;
CREATE POLICY "referrer reads own terms" ON referral_partner_terms
  FOR SELECT TO authenticated
  USING (partner_id = referral_current_partner_id());

GRANT ALL ON referral_partner_terms TO service_role;
GRANT SELECT ON referral_partner_terms TO authenticated;
