import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadDashboard } from '@/lib/turnover/server';
import { todayPacific, type TurnView } from '@/lib/turnover/model';

const VIEWS: TurnView[] = ['active', 'not_yet_ready', 'completed', 'all'];

/** GET /api/turnover-tracker?view=active|not_yet_ready|completed|all — the dashboard. */
export async function GET(request: NextRequest) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) return guard.response;
  const v = request.nextUrl.searchParams.get('view') as TurnView | null;
  try {
    return NextResponse.json(await loadDashboard(getSupabaseAdmin(), v && VIEWS.includes(v) ? v : 'active', todayPacific()));
  } catch (err) {
    console.error('[turnover-tracker] dashboard failed:', err);
    return NextResponse.json({ error: 'Could not load unit turns' }, { status: 500 });
  }
}
