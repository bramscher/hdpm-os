import { NextResponse } from 'next/server';
import { loadRoutes } from '@/lib/maintenance/route-server';
import { homeRouteSummary } from '@/lib/maintenance/route-summary';
import { noStore, requireViewer } from '@/lib/maintenance/route-http';

/**
 * GET — today's published maintenance routes (Pacific) for the home dashboard, for anyone on staff.
 * Stops, times and addresses only: the door notes stay on /api/maintenance/routes (office and the tech).
 */
export async function GET() {
  const guard = await requireViewer();
  if (!guard.ok) return guard.response;
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  try {
    return NextResponse.json({ date, routes: (await loadRoutes(date)).map(homeRouteSummary) }, { headers: noStore });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
