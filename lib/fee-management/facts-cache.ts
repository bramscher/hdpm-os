/**
 * Cached AppFolio fee facts (active properties + current owner sets), shared
 * by Fee Management and Knowledge Capture. One snapshot per day in
 * kpi_snapshots; `refresh` forces a re-pull. Owner contact info lives in the
 * payload, so only the latest copy is kept.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFeeFacts } from './appfolio';
import type { FeeFacts } from './model';

const FACTS_KEY = 'fee_management_facts';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function loadFeeFacts(
  db: SupabaseClient,
  opts: { refresh?: boolean } = {}
): Promise<{ facts: FeeFacts; capturedAt: string }> {
  if (!opts.refresh) {
    const { data } = await db
      .from('kpi_snapshots')
      .select('value, captured_at')
      .eq('kpi_name', FACTS_KEY)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && Date.now() - new Date(data.captured_at).getTime() < MAX_AGE_MS) {
      return { facts: data.value as FeeFacts, capturedAt: data.captured_at };
    }
  }
  const facts = await fetchFeeFacts();
  const { data } = await db
    .from('kpi_snapshots')
    .insert({ kpi_name: FACTS_KEY, value: facts })
    .select('captured_at')
    .single();
  if (data) await db.from('kpi_snapshots').delete().eq('kpi_name', FACTS_KEY).lt('captured_at', data.captured_at);
  return { facts, capturedAt: data?.captured_at ?? new Date().toISOString() };
}
