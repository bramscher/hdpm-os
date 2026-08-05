-- ============================================
-- HDPM-OS Phase 0, Brief C: per-service scoped tokens
-- Date: 2026-08-03
-- Run this migration manually in the Supabase SQL Editor.
--
-- Splits the single shared HDPM_SERVICE_TOKEN into named, scoped, revocable
-- tokens. Plaintext tokens are never stored — only sha256 hashes. Mint with
-- scripts/mint-service-token.mjs, which prints the token once plus the
-- INSERT to run here. The legacy env token keeps working (logged as legacy)
-- until rows exist for each caller and the env var is retired.
--
-- Scopes are coarse route families: 'agents' (/api/agents/*),
-- 'intake' (/api/intake/*). Add scopes as new service surfaces appear.
-- ============================================

CREATE TABLE IF NOT EXISTS service_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,            -- e.g. 'agent-service', 'hdpm-web'
  token_hash TEXT NOT NULL UNIQUE,      -- sha256 hex of the bearer token
  scopes TEXT[] NOT NULL DEFAULT '{}',  -- e.g. '{agents}', '{intake}'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE service_token ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to service_token" ON service_token;
CREATE POLICY "Service role full access to service_token" ON service_token
  FOR ALL USING (true) WITH CHECK (true);
