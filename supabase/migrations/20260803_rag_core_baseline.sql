-- ============================================
-- HDPM-OS Phase 0, Brief C: RAG-core schema baseline
-- Date: 2026-08-03
--
-- The knowledge chat's tables predate this migrations folder (created by
-- hand before 2026-03). This baseline captures them so a fresh
-- `supabase db reset` reproduces the schema. Everything here is idempotent
-- and is a NO-OP against the live database.
--
-- Column definitions were captured from the LIVE database on 2026-08-03 via
-- the PostgREST OpenAPI schema (exact names/types/defaults). Index
-- definitions are reconstructed (marked below). Function bodies could not
-- be introspected remotely — run scripts/sql/dump-rag-core-functions.sql in
-- the SQL editor once and paste its output over the placeholder section at
-- the bottom, then delete this paragraph.
-- ============================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge base chunks (ORS 90, Notion SOPs, Loom, policy docs)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  source_type TEXT,
  source_title TEXT,
  source_url TEXT,
  source_section TEXT,
  chunk_index INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  embedding vector(1536),
  fts TSVECTOR
);

-- Team-shared chat conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT,
  user_name TEXT,
  title TEXT DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT,
  content TEXT,
  sources JSONB,
  attachment JSONB,
  sender_name TEXT,
  sender_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes (RECONSTRUCTED — names may differ from live; harmless duplicates
-- are avoided by IF NOT EXISTS, but verify against the dump script output).
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts
  ON knowledge_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_type
  ON knowledge_chunks (source_type);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
  ON conversation_messages (conversation_id, created_at);

-- RLS per convention (service-role policy; app uses the service key).
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "Service role full access to knowledge_chunks" ON knowledge_chunks
  FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to conversations" ON conversations;
CREATE POLICY "Service role full access to conversations" ON conversations
  FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to conversation_messages" ON conversation_messages;
CREATE POLICY "Service role full access to conversation_messages" ON conversation_messages
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- FUNCTIONS — PLACEHOLDER (do not guess bodies; paste from live)
--
-- Live signatures + return shapes (captured 2026-08-03):
--   match_knowledge_chunks(query_embedding vector, match_threshold float8,
--     match_count int, filter_source_type text)
--   search_knowledge_fulltext(search_query text, max_results int)
--     -> (id, content, source_type, source_title, source_url, source_section, rank)
--   search_knowledge_phrase(search_phrase text, max_results int)
--   search_knowledge_substring(search_text text, max_results int)
--   search_knowledge_text(search_query text, max_results int)
--   get_knowledge_stats() -> (source_type, chunk_count, avg_content_length)
--
-- ACTION (once): run scripts/sql/dump-rag-core-functions.sql in the Supabase
-- SQL editor and paste the CREATE OR REPLACE FUNCTION statements it returns
-- below this line.
-- ============================================
