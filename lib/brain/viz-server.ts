/**
 * Brain map reads/writes: gather the snapshot inputs (one brain_viz_bundle
 * RPC + citation counts + routine status), build it, store it as
 * brain-viz/snapshot.json, and read it back for /brain.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { buildSnapshot, countCitedChunks, type VizDocRow, type VizInput, type VizSnapshot } from './viz';

export const VIZ_BUCKET = 'brain-viz';
export const VIZ_PATH = 'snapshot.json';
const CITATION_DAYS = 90;

/** True when the error means the brain_viz migration hasn't been applied. */
export const isMissingVizSql = (msg: string) => /brain_viz_bundle|brain_viz_chunk_docs|schema cache|does not exist|Could not find the function/i.test(msg);

async function loadCites(): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - CITATION_DAYS * 86_400_000).toISOString();
  const details: unknown[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase
      .from('dez_activity')
      .select('detail')
      .gte('created_at', since)
      .not('detail->cited', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.warn('[brain-viz] citation read failed:', error.message);
      break;
    }
    details.push(...(data ?? []).map((r) => r.detail));
    if (!data || data.length < 1000) break;
  }
  const chunkCounts = countCitedChunks(details);
  const ids = [...chunkCounts.keys()];
  const cites: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc('brain_viz_chunk_docs', { ids: ids.slice(i, i + 500) });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { chunk_id: string; doc: string }[]) {
      cites[row.doc] = (cites[row.doc] ?? 0) + (chunkCounts.get(row.chunk_id) ?? 0);
    }
  }
  return cites;
}

async function loadRoutineStatus(): Promise<Record<string, string>> {
  const { data, error } = await getSupabaseAdmin()
    .from('routine_run')
    .select('routine_id, status, started_at')
    .gte('started_at', new Date(Date.now() - 35 * 86_400_000).toISOString())
    .order('started_at', { ascending: false })
    .limit(4000);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (!(r.routine_id in out)) out[r.routine_id] = r.status;
  return out;
}

export async function loadVizInput(): Promise<VizInput> {
  const { data, error } = await getSupabaseAdmin().rpc('brain_viz_bundle', { k: 3 });
  if (error) throw new Error(error.message);
  const bundle = (data ?? {}) as { docs?: VizDocRow[]; knn?: VizInput['knn']; edges?: VizInput['edges'] };
  const [cites, routineStatus] = await Promise.all([loadCites(), loadRoutineStatus()]);
  return { docs: bundle.docs ?? [], knn: bundle.knn ?? [], edges: bundle.edges ?? [], cites, routineStatus };
}

export async function writeSnapshot(snapshot: VizSnapshot): Promise<number> {
  const body = JSON.stringify(snapshot);
  const { error } = await getSupabaseAdmin()
    .storage.from(VIZ_BUCKET)
    .upload(VIZ_PATH, new Blob([body], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '60' });
  if (error) throw new Error(`snapshot upload failed: ${error.message}`);
  return body.length;
}

export async function readSnapshot(): Promise<VizSnapshot | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(VIZ_BUCKET).download(VIZ_PATH);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as VizSnapshot;
  } catch {
    return null;
  }
}

export async function runSnapshot(): Promise<{ ok: true; documents: number; nodes: number; edges: number; bytes: number } | { skipped: string }> {
  let input: VizInput;
  try {
    input = await loadVizInput();
  } catch (e) {
    const msg = (e as Error).message;
    if (isMissingVizSql(msg)) return { skipped: 'brain_viz migration not applied' };
    throw e;
  }
  const snapshot = buildSnapshot(input);
  const bytes = await writeSnapshot(snapshot);
  return { ok: true, documents: snapshot.stats.documents, nodes: snapshot.nodes.length, edges: snapshot.edges.length, bytes };
}

/** Map RAG source chunk ids to snapshot doc keys (for lighting up an answer). */
export async function docsForChunks(ids: string[]): Promise<string[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (clean.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('brain_viz_chunk_docs', { ids: clean });
  if (error) return [];
  return [...new Set(((data ?? []) as { doc: string }[]).map((r) => r.doc))];
}
