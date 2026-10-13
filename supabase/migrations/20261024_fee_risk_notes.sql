-- ============================================
-- Fee change risk notes (Fee Management + Knowledge Capture)
-- Date: 2026-10-24
-- Run this migration manually in the Supabase SQL Editor. Idempotent.
--
-- Matt's and Penny's own notes on the owners the fee change puts most at
-- risk (Large-owner exposure and Most at risk). One note per owner set per
-- person. Fee campaign only: not ingested into the brain.
-- ============================================

CREATE TABLE IF NOT EXISTS fee_risk_note (
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  owner_set_key TEXT NOT NULL,
  author_email TEXT NOT NULL,
  owner_name TEXT,
  note TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, owner_set_key, author_email)
);

ALTER TABLE fee_risk_note ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to fee_risk_note" ON fee_risk_note;
CREATE POLICY "Service role full access to fee_risk_note" ON fee_risk_note FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON fee_risk_note FROM anon, authenticated;
GRANT ALL ON fee_risk_note TO service_role;

NOTIFY pgrst, 'reload schema';
