import { NextRequest, NextResponse } from 'next/server';
import { canaryProblem, CANARY_TENANT } from '@/lib/agents/dez/operator';
import { alertOperatorFailure } from '@/lib/agents/dez/operator-alert';
import { isCronRequest, withCronRun } from '@/lib/cron/run';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/agents/cron/operator-canary-watch
 *
 * Runs 20 minutes after the weekly operator canary and DMs Craig if it never
 * started or never finished. A canary killed mid-way can't send its own alert.
 * Skips when the operator isn't configured, same as the canary.
 */
async function handleGET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DEZ_OPERATOR_URL) {
    return NextResponse.json({ ok: true, skipped: 'DEZ_OPERATOR_URL unset' });
  }

  // The raw row: loadRuns relabels old 'running' runs as 'error' and hides read errors.
  const { data, error } = await getSupabaseAdmin()
    .from('routine_run')
    .select('status, started_at')
    .eq('routine_id', 'operator_canary')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });

  const problem = canaryProblem(data);
  if (!problem) return NextResponse.json({ ok: true });

  await alertOperatorFailure({
    context: 'canary_stuck',
    template: 'deposit-to-hold',
    tenantQuery: CANARY_TENANT,
    error: problem,
  });
  return NextResponse.json({ ok: false, error: problem }, { status: 200 });
}

export const GET = withCronRun(handleGET);
