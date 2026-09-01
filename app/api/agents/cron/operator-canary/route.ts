import { NextRequest, NextResponse } from 'next/server';
import { callOperator } from '@/lib/agents/dez/operator';
import { alertOperatorFailure } from '@/lib/agents/dez/operator-alert';
import { logDezActivity } from '@/lib/agents/dez/activity';

export const maxDuration = 120;

/**
 * GET/POST /api/agents/cron/operator-canary
 *
 * Weekly self-test of the AppFolio operator flow: runs the deposit-to-hold merge
 * in `prepare` mode (nothing is sent) against a known test tenant and DMs Craig
 * if it breaks — so an AppFolio UI change that breaks a selector is caught here,
 * not by a staff member mid-task.
 *
 * Only alarms on a REAL flow failure. If the operator is intentionally off
 * (URL unset / worker disabled / unreachable) it skips quietly — those are
 * deliberate states, not drift.
 */
const CANARY_TENANT = process.env.DEZ_OPERATOR_CANARY_TENANT || 'Bryce Bramscher';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.DEZ_OPERATOR_URL;
  if (!url) {
    return NextResponse.json({ ok: true, skipped: 'DEZ_OPERATOR_URL unset' });
  }

  // Skip quietly if the worker is intentionally disabled or not reachable —
  // those are deliberate off-states, not selector drift.
  try {
    const h = await fetch(`${url.replace(/\/$/, '')}/healthz`, {
      signal: AbortSignal.timeout(10_000),
    });
    const health = (await h.json()) as { enabled?: boolean };
    if (!health?.enabled) {
      return NextResponse.json({ ok: true, skipped: 'operator disabled' });
    }
  } catch {
    return NextResponse.json({ ok: true, skipped: 'worker unreachable (likely paused)' });
  }

  console.log('[Dez] operator canary — preparing deposit-to-hold for', CANARY_TENANT);
  const result = await callOperator({
    template: 'deposit-to-hold',
    tenantQuery: CANARY_TENANT,
    mode: 'prepare',
    requestId: 'canary',
  });

  if (!result || result.status !== 'prepared') {
    const error = result?.error ?? 'no response from operator worker';
    await alertOperatorFailure({
      context: 'canary',
      template: 'deposit-to-hold',
      tenantQuery: CANARY_TENANT,
      error,
    });
    return NextResponse.json({ ok: false, error }, { status: 200 });
  }

  await logDezActivity({
    kind: 'routine',
    surface: 'cron',
    scope: 'operator',
    summary: `canary OK — deposit-to-hold prepares for ${CANARY_TENANT}`,
    detail: { steps: result.steps ?? [] },
  });
  return NextResponse.json({ ok: true, steps: result.steps ?? [] });
}

// Vercel Cron sends GET.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
