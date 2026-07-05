-- ============================================
-- Migration: AI triage proposals (Wave 1 redirect, Session B)
-- Date: 2026-07-05
-- Run this in the Supabase SQL Editor
--
-- Batch AI triage stores PROPOSALS here — nothing is applied to a work order
-- until Cheryl reviews and taps Apply (which goes through the normal workflow
-- write path and its wo_event audit trail). One row per WO; regenerating
-- overwrites only 'pending' rows, so applied/skipped decisions are kept.
-- ============================================

CREATE TABLE IF NOT EXISTS ai_triage_proposal (
  work_order_id UUID PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
  triage JSONB NOT NULL,                -- full AiTriage output (summary, risks, draft message, checklist)
  proposed_priority_class TEXT,
  proposed_next_action_date DATE,
  proposed_owner_name TEXT,
  proposed_stage TEXT,                  -- 'TRIAGED' when the WO was in NEW; NULL = stage unchanged
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','skipped')),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_triage_proposal_status ON ai_triage_proposal(status);

ALTER TABLE ai_triage_proposal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to ai_triage_proposal" ON ai_triage_proposal;
CREATE POLICY "Service role full access to ai_triage_proposal" ON ai_triage_proposal
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON ai_triage_proposal TO service_role;

NOTIFY pgrst, 'reload schema';
