-- ============================================
-- HDPM-OS Phase 1, Brief 1A: company brain core
-- Date: 2026-08-03
-- Run this migration manually in the Supabase SQL Editor.
--
-- Institutional-memory store per docs/hdpm-os/04-gbrain-company-brain.md:
-- entity stub nodes pointing at systems of record, knowledge chunks with
-- kind/author/sensitivity provenance and supersede chains, typed edges,
-- contradiction + clarification queues, ingest log. Retrieval is hybrid
-- (pgvector cosine + full-text, reciprocal-rank fusion) via
-- match_brain_chunks. Tables are brain_-prefixed in public (not a separate
-- schema) so no PostgREST exposure config is needed.
--
-- Embeddings: text-embedding-3-small (1536) — same model as knowledge_chunks.
-- ============================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Entity stub nodes: summaries + pointers into systems of record.
CREATE TABLE IF NOT EXISTS brain_node (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'employee','owner','prospect','tenant','applicant','vendor','property',
    'unit','lease','work_order','inspection','incident','communication',
    'meeting','issue','decision','commitment','rock','metric','process',
    'policy','project'
  )),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_md TEXT,
  source_system TEXT,          -- 'appfolio' | 'hdpm-os' | 'notion' | 'm365' | ...
  source_ref TEXT,             -- id/url in the system of record
  sensitivity TEXT NOT NULL DEFAULT 'internal'
    CHECK (sensitivity IN ('public','internal','restricted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

-- Knowledge chunks — the retrievable memory.
CREATE TABLE IF NOT EXISTS brain_chunk (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  node_id UUID REFERENCES brain_node(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'summary'
    CHECK (kind IN ('fact','summary','inference','agent_output','human_correction')),
  domain TEXT NOT NULL DEFAULT 'ops' CHECK (domain IN ('ops','company','market')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,               -- md5 of content, for idempotent re-ingest
  source_key TEXT,                          -- stable ingest identity (path#chunkN, table:id)
  source_table TEXT,
  source_id TEXT,
  source_url TEXT,                          -- citation target (repo path, SoR link)
  author TEXT NOT NULL DEFAULT 'system',    -- 'human:<email>' | 'agent:<name>' | 'system'
  sensitivity TEXT NOT NULL DEFAULT 'internal'
    CHECK (sensitivity IN ('public','internal','restricted')),
  salience REAL NOT NULL DEFAULT 1.0,
  confidence REAL,
  embedding vector(1536),
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  superseded_by UUID REFERENCES brain_chunk(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_chunk_source_key
  ON brain_chunk (org_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brain_chunk_embedding
  ON brain_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_brain_chunk_fts ON brain_chunk USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_brain_chunk_kind ON brain_chunk (org_id, kind)
  WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_brain_node_type ON brain_node (org_id, entity_type);

-- Typed relationships between entities.
CREATE TABLE IF NOT EXISTS brain_edge (
  src_node_id UUID NOT NULL REFERENCES brain_node(id) ON DELETE CASCADE,
  dst_node_id UUID NOT NULL REFERENCES brain_node(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN (
    'owns','manages','assigned_to','tenant_at','applicant_for','vendor_for',
    'works_on','responsible_for','discussed_in','decided_in','governed_by',
    'violates','blocked_by','depends_on','committed_by','measured_by',
    'supersedes','related_to'
  )),
  weight REAL NOT NULL DEFAULT 1.0,
  evidence_chunk_id UUID REFERENCES brain_chunk(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (src_node_id, dst_node_id, relation)
);

CREATE TABLE IF NOT EXISTS brain_contradiction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  chunk_a UUID NOT NULL REFERENCES brain_chunk(id) ON DELETE CASCADE,
  chunk_b UUID NOT NULL REFERENCES brain_chunk(id) ON DELETE CASCADE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution_chunk_id UUID REFERENCES brain_chunk(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chunk_a, chunk_b)
);

-- Human-in-the-loop: the brain asks when it is unsure (soul-brain C3.5).
CREATE TABLE IF NOT EXISTS brain_clarification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  question TEXT NOT NULL,
  context_ref TEXT,                        -- contradiction id, chunk id, topic
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed')),
  answered_by TEXT,
  answer_chunk_id UUID REFERENCES brain_chunk(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brain_ingest_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hdpm',
  source TEXT NOT NULL,                    -- 'seed-docs' | 'decision' | 'meeting' | ...
  ref TEXT,                                -- source_key / path
  action TEXT NOT NULL CHECK (action IN ('add','update','skip','redact','error')),
  reason TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS per convention (service-role policy; app scopes org_id explicitly).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['brain_node','brain_chunk','brain_edge',
    'brain_contradiction','brain_clarification','brain_ingest_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access to %s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "Service role full access to %s" ON %I FOR ALL USING (true) WITH CHECK (true)',
      t, t);
  END LOOP;
END $$;

-- Hybrid retrieval: vector + full-text with reciprocal-rank fusion.
-- Not SECURITY DEFINER (soul-brain caveat); superseded rows hidden;
-- sensitivity filtering is the caller's job (service role scopes explicitly).
CREATE OR REPLACE FUNCTION match_brain_chunks(
  query_embedding vector(1536),
  query_text TEXT,
  match_count INT DEFAULT 12,
  p_org_id TEXT DEFAULT 'hdpm',
  max_sensitivity TEXT DEFAULT 'internal'  -- 'public' | 'internal' | 'restricted'
)
RETURNS TABLE (
  id UUID,
  node_id UUID,
  kind TEXT,
  domain TEXT,
  content TEXT,
  source_url TEXT,
  source_table TEXT,
  source_id TEXT,
  author TEXT,
  sensitivity TEXT,
  salience REAL,
  score DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  WITH allowed AS (
    SELECT CASE max_sensitivity
      WHEN 'public' THEN ARRAY['public']
      WHEN 'internal' THEN ARRAY['public','internal']
      ELSE ARRAY['public','internal','restricted']
    END AS levels
  ),
  vec AS (
    SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS r
    FROM brain_chunk c, allowed a
    WHERE c.org_id = p_org_id AND c.superseded_by IS NULL
      AND c.embedding IS NOT NULL AND c.sensitivity = ANY(a.levels)
    ORDER BY c.embedding <=> query_embedding
    LIMIT GREATEST(match_count * 4, 40)
  ),
  txt AS (
    SELECT c.id, ROW_NUMBER() OVER (
      ORDER BY ts_rank(c.fts, websearch_to_tsquery('english', query_text)) DESC
    ) AS r
    FROM brain_chunk c, allowed a
    WHERE c.org_id = p_org_id AND c.superseded_by IS NULL
      AND c.sensitivity = ANY(a.levels)
      AND c.fts @@ websearch_to_tsquery('english', query_text)
    LIMIT GREATEST(match_count * 4, 40)
  ),
  fused AS (
    SELECT COALESCE(v.id, t.id) AS id,
           COALESCE(1.0 / (60 + v.r), 0) + COALESCE(1.0 / (60 + t.r), 0) AS rrf
    FROM vec v FULL OUTER JOIN txt t ON v.id = t.id
  )
  SELECT c.id, c.node_id, c.kind, c.domain, c.content, c.source_url,
         c.source_table, c.source_id, c.author, c.sensitivity, c.salience,
         (f.rrf * c.salience)::DOUBLE PRECISION AS score
  FROM fused f
  JOIN brain_chunk c ON c.id = f.id
  ORDER BY f.rrf * c.salience DESC
  LIMIT match_count;
$$;
