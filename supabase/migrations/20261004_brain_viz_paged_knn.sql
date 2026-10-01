-- Brain map: make the nightly snapshot fit inside the API statement timeout.
--
-- 20261003's brain_viz_bundle compared every document with every other one in
-- a single statement (quadratic). On production data it hit
-- "canceling statement due to statement timeout". Now:
--   1. brain_viz_refresh_doc_emb() caches each document's averaged embedding in
--      brain_viz_doc_emb (one linear pass, ~0.2s at 5,000 docs locally);
--   2. brain_viz_knn_page() finds exact neighbours for a small page of documents;
--      the cron sizes pages so each call does ~200k vector comparisons (~0.3s),
--      however large the corpus grows;
--   3. brain_viz_docs_edges() returns documents + brain_edge rows without the kNN.
-- The snapshot cron calls them in that order. Additive; brain_viz_bundle stays
-- for ad-hoc use. Restricted chunks/nodes stay excluded.

BEGIN;

CREATE TABLE IF NOT EXISTS brain_viz_doc_emb (
  doc text PRIMARY KEY,
  emb vector(1536) NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE brain_viz_doc_emb ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access to brain_viz_doc_emb" ON brain_viz_doc_emb;
CREATE POLICY "Service role full access to brain_viz_doc_emb" ON brain_viz_doc_emb FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON brain_viz_doc_emb FROM PUBLIC, anon, authenticated;
GRANT ALL ON brain_viz_doc_emb TO service_role;

-- Rebuild the per-document averaged embeddings. Returns the document count.
-- No vector index on purpose: building HNSW took ~3-5s at 5,000 docs, which
-- itself risks the timeout. Exact paged scans are predictable instead.
CREATE OR REPLACE FUNCTION brain_viz_refresh_doc_emb()
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM brain_viz_doc_emb;
  INSERT INTO brain_viz_doc_emb (doc, emb)
  SELECT 'k:' || source_type || ':' || source_title, avg(embedding)
  FROM knowledge_chunks
  WHERE embedding IS NOT NULL AND source_title IS NOT NULL AND source_type IS NOT NULL
  GROUP BY source_type, source_title
  UNION ALL
  SELECT brain_viz_doc_key(c.node_id, c.source_url, c.source_key, c.id), avg(c.embedding)
  FROM brain_chunk c
  LEFT JOIN brain_node n ON n.id = c.node_id
  WHERE c.embedding IS NOT NULL AND c.superseded_by IS NULL AND c.sensitivity <> 'restricted'
    AND (n.id IS NULL OR n.sensitivity <> 'restricted')
  GROUP BY 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Exact top-k neighbours for one page of documents (ordered by doc key).
-- Returns [[src, dst, similarity], ...]. Built with EXECUTE so OFFSET/LIMIT/k are
-- literals and the planner picks a per-row top-N sort.
CREATE OR REPLACE FUNCTION brain_viz_knn_page(k int DEFAULT 3, p_offset int DEFAULT 0, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  EXECUTE format($q$
    SELECT coalesce(jsonb_agg(jsonb_build_array(d.doc, nb.doc, round((1 - nb.dist)::numeric, 3))), '[]'::jsonb)
    FROM (SELECT doc, emb FROM brain_viz_doc_emb ORDER BY doc OFFSET %s LIMIT %s) d
    CROSS JOIN LATERAL (
      SELECT d2.doc, d2.emb <=> d.emb AS dist
      FROM brain_viz_doc_emb d2
      WHERE d2.doc <> d.doc
      ORDER BY d2.emb <=> d.emb
      LIMIT %s
    ) nb
  $q$, greatest(p_offset, 0), least(greatest(p_limit, 1), 1000), least(greatest(k, 1), 10))
  INTO out;
  RETURN out;
END $$;

-- Documents + real brain_edge rows (no kNN).
CREATE OR REPLACE FUNCTION brain_viz_docs_edges()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'docs', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM brain_viz_docs() d), '[]'::jsonb),
    'edges', coalesce((
      SELECT jsonb_agg(jsonb_build_array('b:' || e.src_node_id, 'b:' || e.dst_node_id, e.relation))
      FROM brain_edge e
      JOIN brain_node a ON a.id = e.src_node_id AND a.sensitivity <> 'restricted'
      JOIN brain_node b ON b.id = e.dst_node_id AND b.sensitivity <> 'restricted'
    ), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION brain_viz_refresh_doc_emb(), brain_viz_knn_page(int, int, int), brain_viz_docs_edges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION brain_viz_refresh_doc_emb(), brain_viz_knn_page(int, int, int), brain_viz_docs_edges() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
