/**
 * metrics_snapshot readers — the delta layer Brief A never needed and
 * Brief E (Ops Brief) does. Query shape mirrors app/api/kpi/snapshots
 * (latest row per metric before a cutoff). One tiny query per metric is
 * fine at Ops Brief cadence (2 runs/day).
 */

import { getSupabaseAdmin } from '@/lib/supabase';

export interface MetricPoint {
  value: Record<string, unknown>;
  captured_at: string;
}

export type MetricMap = Map<string, MetricPoint>;

async function latestBefore(metric: string, before?: Date): Promise<MetricPoint | null> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('metrics_snapshot')
    .select('value, captured_at')
    .eq('metric', metric)
    .order('captured_at', { ascending: false })
    .limit(1);
  if (before) query = query.lt('captured_at', before.toISOString());
  const { data, error } = await query;
  if (error) {
    console.error(`[Agents] metrics_snapshot read failed (${metric}):`, error.message);
    return null;
  }
  const row = data?.[0];
  return row ? { value: row.value as Record<string, unknown>, captured_at: row.captured_at } : null;
}

/** Latest capture per metric. Missing metrics are absent from the map. */
export async function readLatestMetrics(names: string[]): Promise<MetricMap> {
  const out: MetricMap = new Map();
  for (const name of names) {
    const point = await latestBefore(name);
    if (point) out.set(name, point);
  }
  return out;
}

/** Latest capture per metric strictly BEFORE a cutoff — "as of yesterday". */
export async function readMetricsAsOf(names: string[], before: Date): Promise<MetricMap> {
  const out: MetricMap = new Map();
  for (const name of names) {
    const point = await latestBefore(name, before);
    if (point) out.set(name, point);
  }
  return out;
}

/** The one-time pre-agent baseline bundle (metric='baseline_freeze'). */
export async function readBaselineFreeze(): Promise<Record<
  string,
  Record<string, unknown>
> | null> {
  const point = await latestBefore('baseline_freeze');
  if (!point) return null;
  const metrics = (point.value as { metrics?: Record<string, Record<string, unknown>> }).metrics;
  return metrics ?? null;
}
