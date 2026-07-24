-- ============================================
-- HDPM Knowledge Chat: allow the notion_sop corpus
-- Date: 2026-07-24
-- Run this migration manually in the Supabase SQL Editor.
--
-- knowledge_chunks.source_type was checked against the original corpus list
-- (ors_90 / loom_video / policy_doc). The Knowledge Chat now also ingests
-- every Notion SOP (Process Documentation Hub) as source_type 'notion_sop',
-- with source_url pointing at the live Notion page for citations.
-- ============================================

ALTER TABLE knowledge_chunks DROP CONSTRAINT IF EXISTS knowledge_chunks_source_type_check;
ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_chunks_source_type_check
  CHECK (source_type IN ('ors_90', 'loom_video', 'policy_doc', 'notion_sop'));

NOTIFY pgrst, 'reload schema';
