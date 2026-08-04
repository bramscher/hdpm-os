import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { isOnTrack } from '@/lib/eos/scorecard';
import type { ScorecardMetric } from '@/lib/eos/types';

/**
 * POST /api/eos/scorecard/entry — manual scorecard entry from the screen
 * (Brief 2B). Staff session required (middleware covers /api/eos except
 * /api/eos/cron; this is defense-in-depth). Manual entries override auto
 * rows and are never clobbered by the Friday cron.
 *
 * Body: { metricId: string, weekStart: 'YYYY-MM-DD', value: number }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { metricId?: unknown; weekStart?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const metricId = typeof body.metricId === 'string' ? body.metricId : '';
  const weekStart = typeof body.weekStart === 'string' ? body.weekStart : '';
  const value = typeof body.value === 'number' && Number.isFinite(body.value) ? body.value : null;
  if (!metricId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || value === null) {
    return NextResponse.json(
      { error: 'metricId, weekStart (YYYY-MM-DD), and numeric value are required' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: metric, error: mErr } = await supabase
    .from('scorecard_metric')
    .select('*')
    .eq('id', metricId)
    .maybeSingle();
  if (mErr || !metric) {
    return NextResponse.json({ error: 'Unknown metric' }, { status: 404 });
  }
  const m = metric as ScorecardMetric;
  const onTrack = isOnTrack(m.goal_op, m.goal_value, value);

  const { error } = await supabase.from('scorecard_entry').upsert(
    {
      metric_id: metricId,
      week_start: weekStart,
      value,
      on_track: onTrack,
      source: 'manual',
      entered_by: session.actor,
    },
    { onConflict: 'metric_id,week_start' }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAudit('scorecard_entry', `${metricId}:${weekStart}`, 'manual_entry', session.actor, {
    metric: m.name,
    value,
    on_track: onTrack,
  });
  return NextResponse.json({ ok: true, on_track: onTrack });
}
