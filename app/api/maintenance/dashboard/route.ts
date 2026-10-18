import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { computeDashboard, filterDashboardInputs, loadDashboardInputs } from '@/lib/maintenance/dashboard';
import { parseRecurringFilter } from '@/lib/maintenance/recurring';

/**
 * GET /api/maintenance/dashboard
 *
 * The at-a-glance maintenance payload: open work orders by AppFolio step with
 * time-in-step vs. typical duration, the estimate lane (incl. owner-gated and
 * chase stats), the waiting pocket, unit turns by lifecycle state, and today's
 * attention list. Every tile carries the ids behind it so the board can drill.
 * Aggregation is server-side (lib/maintenance/dashboard.ts) and pure.
 * ?recurring=hide|only applies the board's recurring filter.
 */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const inputs = await loadDashboardInputs(now);
    const recurring = parseRecurringFilter(request.nextUrl.searchParams.get('recurring'));
    return NextResponse.json(computeDashboard(filterDashboardInputs(inputs, recurring), now));
  } catch (error) {
    console.error('[Maintenance] Dashboard error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load the dashboard' },
      { status: 500 }
    );
  }
}
