-- Brain map (workstream D). Read-only helpers for the nightly snapshot
-- (/api/brain/cron/snapshot) plus the private storage bucket it writes to.
-- Additive; no table changes. Until applied, the snapshot cron returns
-- { skipped: 'brain_viz migration not applied' } and /brain shows an empty state.
--
-- A "document" is the unit the map draws:
--   knowledge_chunks → one doc per (source_type, source_title), key 'k:<type>:<title>'
--   brain_chunk      → one doc per node, else per source_url / source_key path, key 'b:<…>'
-- Restricted brain chunks and nodes are excluded here, so they never reach the map.

BEGIN;

CREATE OR REPLACE FUNCTION brain_viz_doc_key(p_node_id uuid, p_source_url text, p_source_key text, p_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'b:' || coalesce(p_node_id::text, nullif(p_source_url, ''), nullif(split_part(coalesce(p_source_key, ''), '#', 1), ''), p_id::text)
$$;

-- One row per document: what it is, where it lives, how big, when it changed.
CREATE OR REPLACE FUNCTION brain_viz_docs()
RETURNS TABLE (
  doc text, origin text, source_type text, domain text, entity_type text,
  title text, url text, chunks int, updated_at timestamptz, excerpt text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    'k:' || k.source_type || ':' || k.source_title,
    'knowledge', k.source_type, NULL, NULL,
    k.source_title,
    (array_agg(k.source_url ORDER BY k.chunk_index NULLS LAST))[1],
    count(*)::int,
    max(coalesce(k.updated_at, k.created_at)),
    left((array_agg(k.content ORDER BY k.chunk_index NULLS LAST))[1], 320)
  FROM knowledge_chunks k
  WHERE k.source_title IS NOT NULL AND k.source_type IS NOT NULL
  GROUP BY k.source_type, k.source_title
  UNION ALL
  SELECT
    brain_viz_doc_key(c.node_id, c.source_url, c.source_key, c.id),
    'brain', 'brain', min(c.domain), min(n.entity_type),
    coalesce(min(n.title), split_part(left((array_agg(c.content ORDER BY c.created_at))[1], 200), E'\n', 1)),
    coalesce(min(n.source_ref), min(c.source_url)),
    count(*)::int,
    max(greatest(c.last_seen_at, c.created_at)),
    left((array_agg(c.content ORDER BY c.created_at))[1], 320)
  FROM brain_chunk c
  LEFT JOIN brain_node n ON n.id = c.node_id
  WHERE c.superseded_by IS NULL
    AND c.sensitivity <> 'restricted'
    AND (n.id IS NULL OR n.sensitivity <> 'restricted')
  GROUP BY 1
$$;

-- Top-k semantic neighbours per document: each doc's chunk embeddings are
-- averaged into one vector, then compared doc-to-doc (not chunk-to-chunk,
-- which would be quadratic in chunks).
CREATE OR REPLACE FUNCTION brain_viz_doc_knn(k int DEFAULT 3)
RETURNS TABLE (src text, dst text, similarity real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH docs AS MATERIALIZED (
    SELECT 'k:' || source_type || ':' || source_title AS doc, avg(embedding) AS emb
    FROM knowledge_chunks
    WHERE embedding IS NOT NULL AND source_title IS NOT NULL AND source_type IS NOT NULL
    GROUP BY source_type, source_title
    UNION ALL
    SELECT brain_viz_doc_key(c.node_id, c.source_url, c.source_key, c.id), avg(c.embedding)
    FROM brain_chunk c
    LEFT JOIN brain_node n ON n.id = c.node_id
    WHERE c.embedding IS NOT NULL AND c.superseded_by IS NULL AND c.sensitivity <> 'restricted'
      AND (n.id IS NULL OR n.sensitivity <> 'restricted')
    GROUP BY 1
  )
  SELECT d.doc, nb.doc, (1 - (d.emb <=> nb.emb))::real
  FROM docs d
  CROSS JOIN LATERAL (
    SELECT d2.doc, d2.emb FROM docs d2 WHERE d2.doc <> d.doc ORDER BY d.emb <=> d2.emb LIMIT k
  ) nb
$$;

-- Map cited chunk ids (dez_activity.detail.cited) back to document keys.
CREATE OR REPLACE FUNCTION brain_viz_chunk_docs(ids uuid[])
RETURNS TABLE (chunk_id uuid, doc text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT id, 'k:' || source_type || ':' || source_title FROM knowledge_chunks WHERE id = ANY(ids) AND source_title IS NOT NULL
  UNION ALL
  SELECT id, brain_viz_doc_key(node_id, source_url, source_key, id) FROM brain_chunk WHERE id = ANY(ids)
$$;

-- Everything the snapshot needs in ONE call, as a single jsonb value: PostgREST
-- caps set-returning RPCs at max-rows (1000), and paging an unordered kNN would
-- recompute it per page. Measured locally: ~3s at 1,800 docs (the kNN is
-- quadratic in documents, not chunks).
CREATE OR REPLACE FUNCTION brain_viz_bundle(k int DEFAULT 3)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'docs', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM brain_viz_docs() d), '[]'::jsonb),
    'knn', coalesce((SELECT jsonb_agg(jsonb_build_array(n.src, n.dst, round(n.similarity::numeric, 3))) FROM brain_viz_doc_knn(k) n), '[]'::jsonb),
    'edges', coalesce((
      SELECT jsonb_agg(jsonb_build_array('b:' || e.src_node_id, 'b:' || e.dst_node_id, e.relation))
      FROM brain_edge e
      JOIN brain_node a ON a.id = e.src_node_id AND a.sensitivity <> 'restricted'
      JOIN brain_node b ON b.id = e.dst_node_id AND b.sensitivity <> 'restricted'
    ), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION brain_viz_doc_key(uuid, text, text, uuid), brain_viz_docs(), brain_viz_doc_knn(int), brain_viz_chunk_docs(uuid[]), brain_viz_bundle(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION brain_viz_doc_key(uuid, text, text, uuid), brain_viz_docs(), brain_viz_doc_knn(int), brain_viz_chunk_docs(uuid[]), brain_viz_bundle(int) TO service_role;

-- Private bucket for snapshot.json (read through /api/brain/viz with a staff session).
INSERT INTO storage.buckets (id, name, public)
VALUES ('brain-viz', 'brain-viz', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
