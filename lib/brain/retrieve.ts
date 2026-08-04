/**
 * Brain retrieval (Phase 1, Brief 1A) — hybrid vector + full-text via the
 * match_brain_chunks RPC (RRF, superseded hidden, salience-weighted).
 *
 * Sensitivity is enforced HERE, explicitly, because the service role
 * bypasses RLS (the soul-brain caveat): callers pass the maximum tier their
 * audience may see; default 'internal'.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { embedText } from './embed';
import type { BrainMatch, Sensitivity } from './types';

const KIND_BOOST: Record<string, number> = {
  human_correction: 1.3,
  fact: 1.15,
  summary: 1.0,
  inference: 0.85,
  agent_output: 0.8,
};

export async function searchBrain(
  query: string,
  opts: { limit?: number; maxSensitivity?: Sensitivity } = {}
): Promise<BrainMatch[]> {
  const { limit = 12, maxSensitivity = 'internal' } = opts;
  const supabase = getSupabaseAdmin();
  const embedding = await embedText(query);

  const { data, error } = await supabase.rpc('match_brain_chunks', {
    query_embedding: embedding,
    query_text: query,
    match_count: limit * 2, // over-fetch, re-rank by kind below
    p_org_id: 'hdpm',
    max_sensitivity: maxSensitivity,
  });
  if (error) {
    console.error('[brain] search failed:', error.message);
    return [];
  }

  const rows = (data ?? []) as BrainMatch[];
  return rows
    .map((r) => ({ ...r, score: r.score * (KIND_BOOST[r.kind] ?? 1.0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
