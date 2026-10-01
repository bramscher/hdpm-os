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
export const isMissingVizSql = (msg: string) => /schema cache|does not exist|Could not find the function/i.test(msg);

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

/** Each kNN call does about this many vector comparisons, so it stays well under the statement timeout. */
const COMPARISONS_PER_CALL = 200_000;
/** Stop paging neighbours after this long and ship what we have (route maxDuration is 300s). */
const KNN_BUDGET_MS = 200_000;

/** Documents per kNN call for a corpus of `docCount` documents. */
export function knnPageSize(docCount: number): number {
  return Math.min(1000, Math.max(5, Math.floor(COMPARISONS_PER_CALL / Math.max(docCount, 1))));
}

export interface VizLoadTimings {
  refreshMs: number;
  docsMs: number;
  knnMs: number;
  knnCalls: number;
  knnComplete: boolean;
}

export async function loadVizInput(): Promise<{ input: VizInput; timings: VizLoadTimings }> {
  const supabase = getSupabaseAdmin();
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };

  let t = Date.now();
  const docCount = await rpc<number>('brain_viz_refresh_doc_emb');
  const refreshMs = Date.now() - t;

  t = Date.now();
  const bundle = await rpc<{ docs?: VizDocRow[]; edges?: VizInput['edges'] }>('brain_viz_docs_edges');
  const docsMs = Date.now() - t;

  t = Date.now();
  const knn: VizInput['knn'] = [];
  const size = knnPageSize(docCount);
  let calls = 0;
  let knnComplete = true;
  for (let offset = 0; offset < docCount; offset += size) {
    if (Date.now() - t > KNN_BUDGET_MS) {
      knnComplete = false;
      console.warn(`[brain-viz] neighbour paging stopped at ${offset}/${docCount} docs (time budget)`);
      break;
    }
    knn.push(...((await rpc<VizInput['knn']>('brain_viz_knn_page', { k: 3, p_offset: offset, p_limit: size })) ?? []));
    calls++;
  }
  const knnMs = Date.now() - t;

  const [cites, routineStatus] = await Promise.all([loadCites(), loadRoutineStatus()]);
  return {
    input: { docs: bundle?.docs ?? [], knn, edges: bundle?.edges ?? [], cites, routineStatus },
    timings: { refreshMs, docsMs, knnMs, knnCalls: calls, knnComplete },
  };
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

export async function runSnapshot(): Promise<
  | { ok: true; documents: number; nodes: number; edges: number; bytes: number; knnComplete: boolean; timings: VizLoadTimings }
  | { skipped: string }
> {
  let loaded: Awaited<ReturnType<typeof loadVizInput>>;
  try {
    loaded = await loadVizInput();
  } catch (e) {
    const msg = (e as Error).message;
    if (isMissingVizSql(msg)) return { skipped: `brain_viz migration not applied (${msg})` };
    throw e;
  }
  const snapshot = buildSnapshot(loaded.input);
  const bytes = await writeSnapshot(snapshot);
  console.log('[brain-viz] snapshot written', JSON.stringify({ documents: snapshot.stats.documents, bytes, ...loaded.timings }));
  return {
    ok: true,
    documents: snapshot.stats.documents,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    bytes,
    knnComplete: loaded.timings.knnComplete,
    timings: loaded.timings,
  };
}

/** Map RAG source chunk ids to snapshot doc keys (for lighting up an answer). */
export async function docsForChunks(ids: string[]): Promise<string[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (clean.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('brain_viz_chunk_docs', { ids: clean });
  if (error) return [];
  return [...new Set(((data ?? []) as { doc: string }[]).map((r) => r.doc))];
}
