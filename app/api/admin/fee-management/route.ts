import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadFeeInputs } from '@/lib/fee-management/inputs';
import { loadRiskNotes } from '@/lib/fee-management/risk-notes';

export const maxDuration = 120;

/**
 * GET /api/admin/fee-management[?refresh=1]
 * AppFolio facts (cached daily in kpi_snapshots; ?refresh=1 re-pulls) plus
 * the app-owned config, agreement overrides, campaign rows and fee change
 * risk notes.
 */
export async function GET(request: NextRequest) {
  const guard = await requireSection('fee_management');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  try {
    const [inputs, riskNotes] = await Promise.all([loadFeeInputs(db, { refresh }), loadRiskNotes(db)]);
    return NextResponse.json({ ...inputs, riskNotes, me: guard.email });
  } catch (err) {
    if (err instanceof Error && err.message === 'appfolio') {
      return NextResponse.json({ error: 'Could not load AppFolio data. Try again in a minute.' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Could not load fee management tables' }, { status: 503 });
  }
}
