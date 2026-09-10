import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { computeDashboard, loadDashboardInputs } from '@/lib/maintenance/dashboard';

/**
 * GET /api/maintenance/dashboard
 *
 * The at-a-glance maintenance payload: open work orders by AppFolio step with
 * time-in-step vs. typical duration, the estimate lane (incl. owner-gated and
 * chase stats), the waiting pocket, unit turns by lifecycle state, and today's
 * attention list. Every tile carries the ids behind it so the board can drill.
 * Aggregation is server-side (lib/maintenance/dashboard.ts) and pure.
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const inputs = await loadDashboardInputs(now);
    return NextResponse.json(computeDashboard(inputs, now));
  } catch (error) {
    console.error('[Maintenance] Dashboard error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load the dashboard' },
      { status: 500 }
    );
  }
}
