-- ============================================
-- Migration: Maintenance OS — digest recipient opt-in
-- Date: 2026-07-02
-- Run this in the Supabase SQL Editor
--
-- Admin-managed mapping of accountable owner (the 7 named people from the
-- ops plan) → email + opt-in flag for the daily tripwire digests. Replaces
-- the MAINT_DIGEST_RECIPIENTS env var (which remains a fallback).
-- ============================================

CREATE TABLE IF NOT EXISTS maint_digest_recipient (
  person TEXT PRIMARY KEY,
  email TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the fixed owner roster (01-product-brief.md §People); admin fills in
-- emails + enables from the Exceptions view.
INSERT INTO maint_digest_recipient (person) VALUES
  ('Cheryl'), ('Brody'), ('Alberto'), ('Bryce'), ('Penny'), ('Jen'), ('Craig')
ON CONFLICT (person) DO NOTHING;

ALTER TABLE maint_digest_recipient ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to maint_digest_recipient" ON maint_digest_recipient;
CREATE POLICY "Service role full access to maint_digest_recipient" ON maint_digest_recipient
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON maint_digest_recipient TO service_role;
