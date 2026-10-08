-- ============================================
-- Knowledge capture: owner record links
-- Date: 2026-10-15
-- Run this migration manually in the Supabase SQL Editor.
--
-- AppFolio can hold one person as several owner records. Links let Matt,
-- Penny and Craig say how two records relate (lib/knowledge-capture/links.ts):
--   same     — duplicates of one person: owner_id merges into linked_owner_id's profile
--   related  — separate people/entities that belong together (person ↔ trust/LLC, spouses)
--   distinct — a rejected suggestion, so it isn't suggested again
-- Recordings keep their original subject_id; merges resolve at read time, so
-- unlinking restores both profiles exactly.
-- ============================================

CREATE TABLE IF NOT EXISTS kc_owner_link (
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  owner_id TEXT NOT NULL,
  linked_owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('same','related','distinct')),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, owner_id, linked_owner_id),
  CHECK (owner_id <> linked_owner_id)
);

-- A record can be merged into only one profile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kc_owner_link_one_merge
  ON kc_owner_link (org_id, owner_id) WHERE kind = 'same';

ALTER TABLE kc_owner_link ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to kc_owner_link" ON kc_owner_link;
CREATE POLICY "Service role full access to kc_owner_link" ON kc_owner_link
  FOR ALL USING (true) WITH CHECK (true);
