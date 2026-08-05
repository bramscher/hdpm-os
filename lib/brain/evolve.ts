/**
 * Brain consolidation — the nightly "dream cycle" (Phase 1, Brief 1C; ports
 * the soul-brain C3 pattern).
 *
 * Stages, in order:
 *  1. Dedup      — collapse near-duplicate live chunks (cosine ≥ 0.95) by
 *                  superseding the lower-ranked one (retrieval hides it).
 *  2. Contradict — LLM pass over the "same-topic band" (0.78 ≤ cos < 0.95,
 *                  statement kinds, different source docs), bounded to
 *                  MAX_LLM_PAIRS per run, one batched Claude call →
 *                  brain_contradiction rows.
 *  3. Clarify    — every new contradiction gets a human-facing question in
 *                  brain_clarification (surfaced on /agents).
 *  4. Decay      — salience drifts toward DECAY_FLOOR for chunks unseen for
 *                  30+ days (human corrections never decay).
 *
 * The run report is written to brain_ingest_log (source 'evolve') so runs
 * are auditable and the next run can find its watermark.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const DUPE_THRESHOLD = 0.95;
export const TOPIC_BAND_MIN = 0.78;
export const MAX_LLM_PAIRS = 15; // bounded LLM cost per nightly run
export const DECAY_AFTER_DAYS = 30;
export const DECAY_FACTOR = 0.98;
export const DECAY_FLOOR = 0.5;
/** Above this many live chunks, pairwise scan is bounded to recent chunks. */
export const FULL_SCAN_MAX = 2000;

/** Statement-like kinds worth checking for contradictions. */
const STATEMENT_KINDS = new Set(['fact', 'human_correction', 'summary']);

/** Higher survives a dedup collapse. */
const KIND_RANK: Record<string, number> = {
  human_correction: 5,
  fact: 4,
  summary: 3,
  inference: 2,
  agent_output: 1,
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export interface EvolveChunk {
  id: string;
  kind: string;
  content: string;
  source_key: string | null;
  salience: number;
  created_at: string;
  last_seen_at: string;
  embedding: number[] | null;
}

/** PostgREST returns pgvector columns as a '[0.1,0.2,…]' string. */
export function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw !== 'string' || !raw.startsWith('[')) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as number[]) : null;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Doc identity for "same source document" checks ('docs/x.md#3' → 'docs/x.md'). */
export function sourceDoc(sourceKey: string | null): string | null {
  if (!sourceKey) return null;
  const hash = sourceKey.indexOf('#');
  return hash === -1 ? sourceKey : sourceKey.slice(0, hash);
}

/** Returns [survivor, superseded] for a near-duplicate pair. */
export function pickSurvivor(a: EvolveChunk, b: EvolveChunk): [EvolveChunk, EvolveChunk] {
  const ra = KIND_RANK[a.kind] ?? 0;
  const rb = KIND_RANK[b.kind] ?? 0;
  if (ra !== rb) return ra > rb ? [a, b] : [b, a];
  if (a.salience !== b.salience) return a.salience > b.salience ? [a, b] : [b, a];
  // Same rank and salience: keep the newer record.
  return a.created_at >= b.created_at ? [a, b] : [b, a];
}

export interface ScoredPair {
  a: EvolveChunk;
  b: EvolveChunk;
  sim: number;
}

/**
 * One O(left × all) pass produces both stage inputs: dupe pairs (≥ 0.95) and
 * contradiction candidates (same-topic band, statement kinds, different
 * source docs). `leftIds` bounds the scan for incremental runs.
 */
export function scanPairs(
  chunks: EvolveChunk[],
  leftIds?: Set<string>
): { dupes: ScoredPair[]; candidates: ScoredPair[] } {
  const dupes: ScoredPair[] = [];
  const candidates: ScoredPair[] = [];
  const seen = new Set<string>();
  const withEmb = chunks.filter((c) => c.embedding && c.embedding.length > 0);

  for (let i = 0; i < withEmb.length; i++) {
    const a = withEmb[i];
    if (leftIds && !leftIds.has(a.id)) continue;
    for (let j = 0; j < withEmb.length; j++) {
      if (i === j) continue;
      const b = withEmb[j];
      const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (seen.has(key)) continue;
      const sim = cosine(a.embedding as number[], b.embedding as number[]);
      if (sim >= DUPE_THRESHOLD) {
        seen.add(key);
        dupes.push({ a, b, sim });
      } else if (
        sim >= TOPIC_BAND_MIN &&
        STATEMENT_KINDS.has(a.kind) &&
        STATEMENT_KINDS.has(b.kind) &&
        (sourceDoc(a.source_key) === null ||
          sourceDoc(a.source_key) !== sourceDoc(b.source_key))
      ) {
        seen.add(key);
        candidates.push({ a, b, sim });
      }
    }
  }
  candidates.sort((x, y) => y.sim - x.sim);
  return { dupes, candidates };
}

export interface PairVerdict {
  index: number;
  contradicts: boolean;
  note?: string;
  question?: string;
}

/** Tolerant parse of the LLM's JSON verdict array (strips code fences). */
export function parseVerdicts(text: string, pairCount: number): PairVerdict[] {
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (v): v is PairVerdict =>
          typeof v === 'object' &&
          v !== null &&
          typeof v.index === 'number' &&
          v.index >= 0 &&
          v.index < pairCount &&
          typeof v.contradicts === 'boolean'
      )
      .map((v) => ({
        index: v.index,
        contradicts: v.contradicts,
        note: typeof v.note === 'string' ? v.note.slice(0, 500) : undefined,
        question: typeof v.question === 'string' ? v.question.slice(0, 500) : undefined,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// LLM contradiction check (one batched call)
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY is not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

async function judgePairs(pairs: ScoredPair[]): Promise<PairVerdict[]> {
  if (pairs.length === 0) return [];
  const blocks = pairs
    .map(
      (p, i) =>
        `PAIR ${i}\nA: ${p.a.content.slice(0, 700)}\nB: ${p.b.content.slice(0, 700)}`
    )
    .join('\n\n');

  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-5',
    thinking: { type: 'disabled' },
    max_tokens: 1500,
    system: `You audit a property-management company's institutional memory for
contradictions. For each pair of memory excerpts, decide whether they make
INCOMPATIBLE factual claims about the same thing (different numbers for the
same fee, opposite decisions on the same question, conflicting owners for the
same responsibility). Overlap, restatement, different topics, or one being
more detailed than the other is NOT a contradiction.

Reply with ONLY a JSON array, one object per pair:
[{"index": 0, "contradicts": false},
 {"index": 1, "contradicts": true, "note": "<one-line: what conflicts>",
  "question": "<one direct question a human could answer to resolve it>"}]`,
    messages: [{ role: 'user', content: blocks }],
  });

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
  return parseVerdicts(text, pairs.length);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface EvolveReport {
  scanned: number;
  incremental: boolean;
  dupePairs: number;
  collapsed: number;
  contradictionCandidates: number;
  llmChecked: number;
  contradictionsNew: number;
  clarificationsNew: number;
  salienceDecayed: number;
  dryRun: boolean;
  ms: number;
}

async function fetchLiveChunks(): Promise<EvolveChunk[]> {
  const supabase = getSupabaseAdmin();
  const out: EvolveChunk[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('brain_chunk')
      .select('id, kind, content, source_key, salience, created_at, last_seen_at, embedding')
      .eq('org_id', 'hdpm')
      .is('superseded_by', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`brain_chunk fetch failed: ${error.message}`);
    for (const row of data ?? []) {
      out.push({ ...row, embedding: parseEmbedding(row.embedding) } as EvolveChunk);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Timestamp of the last completed evolve run (watermark for incremental scans). */
async function lastEvolveAt(): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('brain_ingest_log')
    .select('at')
    .eq('source', 'evolve')
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.at ?? null;
}

export async function evolve(opts: { dryRun?: boolean } = {}): Promise<EvolveReport> {
  const started = Date.now();
  const dryRun = opts.dryRun ?? false;
  const supabase = getSupabaseAdmin();

  const chunks = await fetchLiveChunks();

  // Bound the pairwise scan on large corpora: only chunks new since the last
  // run get compared against everything (a full rescan still happens whenever
  // the corpus is small).
  let leftIds: Set<string> | undefined;
  let incremental = false;
  if (chunks.length > FULL_SCAN_MAX) {
    const watermark = await lastEvolveAt();
    if (watermark) {
      leftIds = new Set(chunks.filter((c) => c.created_at > watermark).map((c) => c.id));
      incremental = true;
    }
  }

  const { dupes, candidates } = scanPairs(chunks, leftIds);

  // --- Stage 1: dedup via supersede -------------------------------------
  let collapsed = 0;
  const gone = new Set<string>();
  for (const pair of dupes) {
    if (gone.has(pair.a.id) || gone.has(pair.b.id)) continue; // chains: first collapse wins
    const [survivor, loser] = pickSurvivor(pair.a, pair.b);
    gone.add(loser.id);
    if (dryRun) {
      collapsed++;
      continue;
    }
    const { error } = await supabase
      .from('brain_chunk')
      .update({ superseded_by: survivor.id })
      .eq('id', loser.id)
      .is('superseded_by', null);
    if (!error) collapsed++;
    else console.error('[brain evolve] supersede failed:', error.message);
  }

  // --- Stage 2: contradiction flagging (bounded LLM) ---------------------
  // Skip pairs already flagged (any status) and pairs touched by dedup.
  const fresh = candidates.filter((p) => !gone.has(p.a.id) && !gone.has(p.b.id));
  let toCheck: ScoredPair[] = [];
  if (fresh.length > 0) {
    const ids = [...new Set(fresh.flatMap((p) => [p.a.id, p.b.id]))];
    const { data: existing } = await supabase
      .from('brain_contradiction')
      .select('chunk_a, chunk_b')
      .in('chunk_a', ids);
    const flagged = new Set(
      (existing ?? []).map((r) =>
        r.chunk_a < r.chunk_b ? `${r.chunk_a}:${r.chunk_b}` : `${r.chunk_b}:${r.chunk_a}`
      )
    );
    toCheck = fresh
      .filter((p) => {
        const key = p.a.id < p.b.id ? `${p.a.id}:${p.b.id}` : `${p.b.id}:${p.a.id}`;
        return !flagged.has(key);
      })
      .slice(0, MAX_LLM_PAIRS);
  }

  let contradictionsNew = 0;
  let clarificationsNew = 0;
  let verdicts: PairVerdict[] = [];
  if (toCheck.length > 0 && !dryRun) {
    try {
      verdicts = await judgePairs(toCheck);
    } catch (err) {
      console.error('[brain evolve] contradiction LLM call failed:', err);
    }
    for (const v of verdicts) {
      const pair = toCheck[v.index];
      if (!v.contradicts) {
        // Record the cleared pair as 'dismissed' so tomorrow's run advances
        // to the next band pairs instead of re-checking these forever.
        const [a0, b0] = pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a];
        await supabase
          .from('brain_contradiction')
          .upsert(
            {
              chunk_a: a0.id,
              chunk_b: b0.id,
              status: 'dismissed',
              note: 'auto-checked by evolve: no contradiction',
            },
            { onConflict: 'chunk_a,chunk_b', ignoreDuplicates: true }
          );
        continue;
      }
      const [a, b] = pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a];
      const { data: row, error } = await supabase
        .from('brain_contradiction')
        .insert({ chunk_a: a.id, chunk_b: b.id, note: v.note ?? null })
        .select('id')
        .single();
      if (error) {
        if (!error.message.includes('duplicate')) {
          console.error('[brain evolve] contradiction insert failed:', error.message);
        }
        continue;
      }
      contradictionsNew++;
      const question =
        v.question ??
        `Two memory entries conflict (${v.note ?? 'see contradiction record'}). Which is correct?`;
      const { error: cErr } = await supabase.from('brain_clarification').insert({
        question,
        context_ref: `contradiction:${row.id}`,
      });
      if (!cErr) clarificationsNew++;
      else console.error('[brain evolve] clarification insert failed:', cErr.message);
    }
  }

  // --- Stage 3: salience decay ------------------------------------------
  const cutoff = new Date(Date.now() - DECAY_AFTER_DAYS * 24 * 3600 * 1000).toISOString();
  const stale = chunks.filter(
    (c) =>
      !gone.has(c.id) &&
      c.kind !== 'human_correction' &&
      c.last_seen_at < cutoff &&
      c.salience > DECAY_FLOOR
  );
  let salienceDecayed = 0;
  for (const c of stale) {
    const next = Math.max(DECAY_FLOOR, Math.round(c.salience * DECAY_FACTOR * 10000) / 10000);
    if (next >= c.salience) continue;
    if (dryRun) {
      salienceDecayed++;
      continue;
    }
    const { error } = await supabase
      .from('brain_chunk')
      .update({ salience: next })
      .eq('id', c.id);
    if (!error) salienceDecayed++;
  }

  const report: EvolveReport = {
    scanned: chunks.length,
    incremental,
    dupePairs: dupes.length,
    collapsed,
    contradictionCandidates: fresh.length,
    llmChecked: toCheck.length,
    contradictionsNew,
    clarificationsNew,
    salienceDecayed,
    dryRun,
    ms: Date.now() - started,
  };

  if (!dryRun) {
    await supabase.from('brain_ingest_log').insert({
      source: 'evolve',
      ref: 'nightly',
      action: 'update',
      reason: JSON.stringify(report).slice(0, 500),
    });
  }
  console.log('[brain evolve]', JSON.stringify(report));
  return report;
}
