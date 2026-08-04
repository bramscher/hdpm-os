-- Run in the Supabase SQL editor. Copies the live DDL of the RAG-core
-- functions (and the real index definitions) so they can be pasted into
-- supabase/migrations/20260803_rag_core_baseline.sql. Read-only.

SELECT pg_get_functiondef(p.oid) || ';' AS ddl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'match_knowledge_chunks',
    'search_knowledge_fulltext',
    'search_knowledge_phrase',
    'search_knowledge_substring',
    'search_knowledge_text',
    'get_knowledge_stats'
  )
ORDER BY p.proname;

-- Real index definitions on the RAG tables (compare with the reconstructed
-- ones in the baseline migration; replace if names/methods differ):
SELECT indexdef || ';' AS ddl
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('knowledge_chunks', 'conversations', 'conversation_messages')
ORDER BY tablename, indexname;
