import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseDoorSchedule, parseRaiseFloor, parseWeights } from '@/lib/fee-management/model';

/** PUT { doorSchedule?, raiseFloor?, priorityWeights? } — validated, then upserted. */
export async function PUT(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rows: { org_id: string; key: string; value: unknown; updated_at: string; updated_by: string }[] = [];
  const now = new Date().toISOString();
  if (body.doorSchedule !== undefined) {
    const schedule = parseDoorSchedule(body.doorSchedule);
    if (!schedule) {
      return NextResponse.json(
        { error: 'Door bands must start at 1, run without gaps or overlaps, and have a fee above 0% and a max step above 0' },
        { status: 400 }
      );
    }
    rows.push({ org_id: 'hdpm', key: 'door_schedule', value: schedule, updated_at: now, updated_by: guard.email });
  }
  if (body.raiseFloor !== undefined) {
    const floor = parseRaiseFloor(body.raiseFloor);
    if (!floor) return NextResponse.json({ error: 'Raise floor needs a % threshold (0–100) and a minimum step (0–10 pts)' }, { status: 400 });
    rows.push({ org_id: 'hdpm', key: 'raise_floor', value: floor, updated_at: now, updated_by: guard.email });
  }
  if (body.priorityWeights !== undefined) {
    const weights = parseWeights(body.priorityWeights);
    if (!weights) return NextResponse.json({ error: 'Weights must be non-negative and not all zero' }, { status: 400 });
    rows.push({ org_id: 'hdpm', key: 'priority_weights', value: weights, updated_at: now, updated_by: guard.email });
  }
  if (!rows.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const { error } = await getSupabaseAdmin().from('fee_campaign_config').upsert(rows, { onConflict: 'org_id,key' });
  if (error) {
    console.error('[fee-management] config save failed:', error);
    return NextResponse.json({ error: 'Could not save settings' }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
