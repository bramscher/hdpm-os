import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { computeAllMetrics } from '@/lib/maintenance/metrics';

export const maxDuration = 300;

/**
 * POST /api/maintenance/cron/metrics
 *
 * Daily cron (6:30 AM PT / 13:30 UTC) snapshotting the agent-OS maintenance
 * metrics into metrics_snapshot (Brief A — docs/agent-os/00-DRAFT-master-plan.md
 * Phase 0). Same pattern as /api/kpi/cron, which keeps owning the
 * leasing/finance KPIs.
 *
 * Query flags:
 * - ?dryRun=1         compute and return values without writing
 * - ?freezeBaseline=1 additionally write the one-time 'baseline_freeze'
 *                     bundle row; refused if one already exists (the baseline
 *                     must predate the agents and stay immutable)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const freezeBaseline = request.nextUrl.searchParams.get('freezeBaseline') === '1';

  console.log(`[Metrics Cron] Starting daily snapshot${dryRun ? ' (dry run)' : ''}...`);
  const { rows, errors: computeErrors } = await computeAllMetrics();

  const results: Record<string, { success: boolean; error?: string }> = {};
  let baselineFrozen: string | null = null;

  if (!dryRun) {
    const supabase = getSupabaseAdmin();
    await Promise.allSettled(
      rows.map(async ({ metric, value }) => {
        try {
          const { error } = await supabase.from('metrics_snapshot').insert({ metric, value });
          if (error) throw new Error(error.message);
          results[metric] = { success: true };
          console.log(`[Metrics Cron] ${metric}: OK`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results[metric] = { success: false, error: msg };
          console.error(`[Metrics Cron] ${metric}: FAILED -`, msg);
        }
      })
    );

    if (freezeBaseline) {
      try {
        const { count, error: countError } = await supabase
          .from('metrics_snapshot')
          .select('*', { count: 'exact', head: true })
          .eq('metric', 'baseline_freeze');
        if (countError) throw new Error(countError.message);
        if ((count ?? 0) > 0) {
          baselineFrozen = 'refused: a baseline_freeze row already exists';
        } else {
          const { error } = await supabase.from('metrics_snapshot').insert({
            metric: 'baseline_freeze',
            value: {
              frozenAt: new Date().toISOString(),
              metrics: Object.fromEntries(rows.map((r) => [r.metric, r.value])),
            },
          });
          if (error) throw new Error(error.message);
          baselineFrozen = 'frozen';
          console.log('[Metrics Cron] Baseline frozen.');
        }
      } catch (err) {
        baselineFrozen = `failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error('[Metrics Cron] Baseline freeze FAILED -', baselineFrozen);
      }
    }
  }

  const succeeded = Object.values(results).filter((r) => r.success).length;
  console.log(
    `[Metrics Cron] Done: ${dryRun ? `${rows.length} computed (dry run)` : `${succeeded}/${rows.length} saved`}`
  );

  return NextResponse.json({
    rows,
    results,
    computeErrors,
    baselineFrozen,
    dryRun,
    succeeded,
    total: rows.length,
  });
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
