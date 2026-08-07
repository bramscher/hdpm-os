-- ============================================
-- Knowledge Chat: OneDrive/SharePoint document corpus
-- Date: 2026-08-06
--
-- Adds 'onedrive_doc' to the knowledge_chunks corpus list and creates
-- knowledge_sync_state, a per-file bookkeeping table keyed by Graph drive
-- item id. The weekly sync compares each file's Graph eTag against the
-- stored one and only re-downloads/re-embeds files that changed — also how
-- text-less scans ('empty') and unsupported formats are remembered so they
-- aren't re-fetched every run.
--
-- Run manually in the Supabase SQL Editor (same as 20260724).
-- ============================================

ALTER TABLE knowledge_chunks DROP CONSTRAINT IF EXISTS knowledge_chunks_source_type_check;
ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_chunks_source_type_check
  CHECK (source_type IN ('ors_90', 'loom_video', 'policy_doc', 'notion_sop', 'onedrive_doc'));

CREATE TABLE IF NOT EXISTS knowledge_sync_state (
  source_type TEXT NOT NULL,
  source_key TEXT NOT NULL,          -- Graph drive item id (stable across rename/move)
  etag TEXT,
  url TEXT,                          -- webUrl at last sync; chunks' source_url
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('indexed', 'empty', 'too_large', 'unsupported')),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_key)
);

ALTER TABLE knowledge_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to knowledge_sync_state" ON knowledge_sync_state;
CREATE POLICY "Service role full access to knowledge_sync_state" ON knowledge_sync_state
  FOR ALL USING (true) WITH CHECK (true);
