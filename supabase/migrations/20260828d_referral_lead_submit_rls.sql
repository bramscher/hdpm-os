-- ============================================
-- Referral Partner Portal — Batch 3: referrer lead submission RLS
-- Plan: docs/partners/00-referral-portal-plan.md §5 (Batch 3), §3 (routes)
--
-- Batch 0 gave referrers SELECT-only on referral_lead. Batch 3 lets a referrer
-- INSERT their OWN leads from the portal (the RLS path — /api/partners/leads).
-- The WITH CHECK pins the row to the caller's partner and source='referral', so
-- a referrer can never plant a lead under another partner or as 'organic'.
--
-- Stage/dedupe/event writes remain service-role (admin path): a referrer submits
-- a lead but does not move it through the pipeline. referral_lead_event stays
-- append-only + service-role (no referrer INSERT), so the 'created' event and
-- dedupe are written by lib/referrals/leads.ts after the RLS insert.
--
-- Convention: applied manually in the Supabase SQL Editor; idempotent.
-- ============================================

DROP POLICY IF EXISTS "referrer inserts own leads" ON referral_lead;
CREATE POLICY "referrer inserts own leads" ON referral_lead
  FOR INSERT TO authenticated
  WITH CHECK (
    partner_id = referral_current_partner_id()
    AND source = 'referral'
  );

GRANT INSERT ON referral_lead TO authenticated;
