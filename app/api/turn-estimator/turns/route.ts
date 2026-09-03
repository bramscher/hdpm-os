import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession, requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createTurnRecord } from '@/lib/turn-estimator/turns';

/** GET /api/turn-estimator/turns — list turns (open first). Any company user. */
export async function GET(_request: NextRequest) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('unit_turn')
    .select('id, property_name, unit_name, vacated_at, target_ready, lifecycle_status, status, current_blocker')
    .order('vacated_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ turns: data ?? [] });
}

/** POST /api/turn-estimator/turns — create a turn record. maintenance/pm/admin. */
export async function POST(request: NextRequest) {
  const guard = await requireRole('maintenance', 'pm', 'admin');
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.property_name || !body.vacated_at) {
    return NextResponse.json({ error: 'property_name and vacated_at required' }, { status: 400 });
  }
  try {
    const turn = await createTurnRecord(body as never, guard.email);
    return NextResponse.json({ turn });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
