-- ============================================
-- Referral Partner Portal — Batch 2: referrer onboarding (invite + docs)
-- Plan: docs/partners/00-referral-portal-plan.md §5 (Batch 2), §3 (routes)
--
-- Batch 2 stands up the referrer side: magic-link (passwordless) login via
-- Supabase Auth, an admin-generated invite link (no email dependency), agreement
-- acceptance, and W-9 + structured TIN capture (encrypted via lib/referrals/
-- crypto.ts). This migration adds the invite tokens, agreement metadata, and the
-- private document bucket. Auth users themselves live in Supabase's `auth`
-- schema (managed by Supabase Auth), linked via referral_partner.auth_user_id.
--
-- Convention: applied manually in the Supabase SQL Editor; idempotent; RLS on.
-- ============================================

-- ============================================
-- 1. referral_invite — an admin-minted, single-use onboarding token.
--    The invite link (/partners/invite/<token>) authorizes the pre-auth accept
--    flow. Service-role only: the accept page validates the token server-side
--    (referrer is not logged in yet), so no `authenticated` policy is needed.
-- ============================================

CREATE TABLE IF NOT EXISTS referral_invite (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  partner_id UUID NOT NULL REFERENCES referral_partner(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,                      -- opaque, high-entropy (lib/referrals/invites.ts)
  email TEXT NOT NULL,                             -- the address this invite is for
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,                         -- set when the referrer completes accept
  created_by TEXT NOT NULL,                        -- admin email
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_invite_partner ON referral_invite(partner_id, created_at DESC);

ALTER TABLE referral_invite ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "svc referral_invite" ON referral_invite;
CREATE POLICY "svc referral_invite" ON referral_invite
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON referral_invite TO service_role;
-- No `authenticated` policy: the token IS the authorization, checked server-side.

-- ============================================
-- 2. referral_partner — agreement acceptance metadata (audit of the click-sign).
--    agreement_accepted_at / agreement_doc_path already exist (Batch 0).
-- ============================================

ALTER TABLE referral_partner
  ADD COLUMN IF NOT EXISTS agreement_version TEXT,
  ADD COLUMN IF NOT EXISTS agreement_accepted_ip TEXT,
  ADD COLUMN IF NOT EXISTS agreement_text_sha256 TEXT;   -- hash of the exact text accepted

-- ============================================
-- 3. Private document bucket for W-9 PDFs. Accessed ONLY via the service role
--    in lib/referrals/storage.ts (referrers never touch storage directly), so
--    no per-user storage policies are needed — the bucket is not public.
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('referral-docs', 'referral-docs', false)
ON CONFLICT (id) DO NOTHING;
