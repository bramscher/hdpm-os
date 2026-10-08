-- ============================================
-- Security hardening: browser roles can't reach server-only tables
-- Date: 2026-10-18
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- These tables were created with RLS policies like
--   CREATE POLICY "Service role full access …" FOR ALL USING (true) WITH CHECK (true)
-- with no TO service_role, so the policy applies to EVERY role. Supabase's
-- default grants give anon and authenticated table privileges, so anyone with
-- the public (publishable) key — or any logged-in referral partner, who is an
-- `authenticated` user — could read and write them through PostgREST.
--
-- The app only touches these tables with the service-role key (which bypasses
-- grants and RLS), so revoking browser-role access changes nothing for the app.
-- The referral portal's own referral_* tables (TO authenticated policies) are
-- deliberately NOT in this list. Newer migrations already REVOKE (e.g.
-- 20260920_*, 20260925b_*); this brings the older tables in line.
--
-- Check before/after (rows = exposed tables):
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
--     AND table_name NOT LIKE 'referral%' ORDER BY 1, 2;
-- ============================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- maintenance OS / agents
    'maint_digest_recipient','wo_event','vendor','vendor_assignment','approval','recommendation','turn',
    'ai_triage_proposal','appfolio_webhook_log','hdms_payments','metrics_snapshot','agent_config',
    'agent_proposal','agent_outbox','staff','unit_turn','service_token','dez_activity',
    'hdms_reconcile_selection','turn_status_event',
    -- turn estimator / price book
    'price_book_item','estimate','estimate_version','estimate_line','estimate_approval','turn_estimator_config',
    -- company brain + knowledge base
    'brain_node','brain_chunk','brain_edge','brain_contradiction','brain_clarification','brain_ingest_log',
    'knowledge_chunks','conversations','conversation_messages','knowledge_sync_state',
    -- EOS
    'seat','scorecard_metric','scorecard_entry','issue','todo','meeting','meeting_item','decision','rock',
    'process','audit_event',
    -- knowledge capture
    'kc_recording','kc_profile','kc_owner_link'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- Knowledge Capture audio: enforce limits server-side, not just in the browser
-- (25 MB is the transcription limit; audio only).
UPDATE storage.buckets
SET file_size_limit = 26214400,
    allowed_mime_types = ARRAY['audio/*']
WHERE id = 'knowledge-capture';
