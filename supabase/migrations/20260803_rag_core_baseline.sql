-- ============================================
-- HDPM-OS Phase 0, Brief C: RAG-core schema baseline
-- Date: 2026-08-03
--
-- The knowledge chat's tables predate this migrations folder (created by
-- hand before 2026-03). This baseline captures them so a fresh
-- `supabase db reset` reproduces the schema. Everything here is idempotent
-- and is a NO-OP against the live database.
--
-- Column definitions captured from the LIVE database 2026-08-03 via the
-- PostgREST OpenAPI schema (exact names/types/defaults). Index and function
-- definitions captured from the LIVE database 2026-08-04 via
-- scripts/sql/dump-rag-core-functions.sql (pg_indexes + pg_get_functiondef).
-- This file is a complete, faithful record — do not run against prod
-- (harmless, but unnecessary); it exists so a fresh environment reproduces
-- the schema.
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

-- Indexes — captured from the LIVE database 2026-08-04 (pg_indexes dump).
-- Primary-key indexes are created by the PRIMARY KEY constraints above.
-- Observation: live knowledge_chunks has NO vector index on embedding —
-- semantic search runs exact scan, which at the current corpus size (~330
-- chunks) is fine and gives perfect recall. Revisit (HNSW) only if the
-- corpus grows into the tens of thousands.
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id
  ON conversation_messages USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at
  ON conversation_messages USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
  ON conversations USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_email
  ON conversations USING btree (user_email);
CREATE INDEX IF NOT EXISTS idx_created_at
  ON knowledge_chunks USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_source_section
  ON knowledge_chunks USING btree (source_section);
CREATE INDEX IF NOT EXISTS idx_source_type
  ON knowledge_chunks USING btree (source_type);
CREATE INDEX IF NOT EXISTS knowledge_chunks_fts_idx
  ON knowledge_chunks USING gin (fts);

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
-- FUNCTIONS — captured from the LIVE database 2026-08-04
-- (pg_get_functiondef dump via scripts/sql/dump-rag-core-functions.sql).
--
-- Note: match_knowledge_chunks exists in TWO overloads. The 3-argument
-- form (threshold, count) is a legacy leftover — the app calls the
-- 4-argument form (match_threshold, match_count, filter_source_type) in
-- lib/supabase.ts. Both are recorded faithfully; dropping the legacy
-- overload is a candidate cleanup (verify no callers, then
-- DROP FUNCTION public.match_knowledge_chunks(vector, double precision, integer)).
-- ============================================

CREATE OR REPLACE FUNCTION public.get_knowledge_stats()
 RETURNS TABLE(source_type text, chunk_count bigint, avg_content_length numeric)
 LANGUAGE sql
AS $function$
  SELECT 
    source_type,
    COUNT(*) as chunk_count,
    AVG(LENGTH(content)) as avg_content_length
  FROM knowledge_chunks
  GROUP BY source_type
  ORDER BY source_type;
$function$
;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(query_embedding vector, threshold double precision, count integer)
 RETURNS TABLE(id uuid, content text, source_type text, source_title text, source_url text, source_section text, similarity double precision)
 LANGUAGE plpgsql
AS $function$
begin
  return query
  select
    kc.id,
    kc.content,
    kc.source_type,
    kc.source_title,
    kc.source_url,
    kc.source_section,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where 1 - (kc.embedding <=> query_embedding) > threshold
  order by kc.embedding <=> query_embedding
  limit count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(query_embedding vector, match_threshold double precision DEFAULT 0.7, match_count integer DEFAULT 5, filter_source_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, content text, source_type text, source_title text, source_url text, source_section text, chunk_index integer, similarity double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    knowledge_chunks.id,
    knowledge_chunks.content,
    knowledge_chunks.source_type,
    knowledge_chunks.source_title,
    knowledge_chunks.source_url,
    knowledge_chunks.source_section,
    knowledge_chunks.chunk_index,
    1 - (knowledge_chunks.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks
  WHERE 
    (filter_source_type IS NULL OR knowledge_chunks.source_type = filter_source_type)
    AND 1 - (knowledge_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY knowledge_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_knowledge_fulltext(search_query text, max_results integer DEFAULT 15)
 RETURNS TABLE(id uuid, content text, source_type text, source_title text, source_url text, source_section text, rank real)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.content,
    kc.source_type,
    kc.source_title,
    kc.source_url,
    kc.source_section,
    ts_rank(kc.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM knowledge_chunks kc
  WHERE kc.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT max_results;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_knowledge_phrase(search_phrase text, max_results integer DEFAULT 15)
 RETURNS TABLE(id uuid, content text, source_type text, source_title text, source_url text, source_section text, rank real)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.content,
    kc.source_type,
    kc.source_title,
    kc.source_url,
    kc.source_section,
    ts_rank(kc.fts, phraseto_tsquery('english', search_phrase)) AS rank
  FROM knowledge_chunks kc
  WHERE kc.fts @@ phraseto_tsquery('english', search_phrase)
  ORDER BY rank DESC
  LIMIT max_results;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_knowledge_substring(search_text text, max_results integer DEFAULT 15)
 RETURNS TABLE(id uuid, content text, source_type text, source_title text, source_url text, source_section text, rank real)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.content,
    kc.source_type,
    kc.source_title,
    kc.source_url,
    kc.source_section,
    1.0::real AS rank
  FROM knowledge_chunks kc
  WHERE kc.content ILIKE '%' || search_text || '%'
  ORDER BY kc.source_section ASC NULLS LAST
  LIMIT max_results;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_knowledge_text(search_query text, max_results integer DEFAULT 10)
 RETURNS TABLE(id uuid, content text, source_type text, source_title text, source_url text)
 LANGUAGE sql
AS $function$
  SELECT 
    id,
    content,
    source_type,
    source_title,
    source_url
  FROM knowledge_chunks
  WHERE content ILIKE '%' || search_query || '%'
  LIMIT max_results;
$function$
;
