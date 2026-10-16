import { NextRequest, NextResponse } from 'next/server';
import { loadRoutes, publishRoute, routeActor, validatePublish } from '@/lib/maintenance/route-server';
import { noStore, requireScheduler, requireViewer } from '@/lib/maintenance/route-http';

/**
 * Published day routes for the in-house crew. Brody (or any scheduler) publishes a tech's day from the
 * Open Board route builder; the tech gets it by Outlook invite, email, text (mobile on file) and My Day.
 *
 * POST — publish or replace a tech's day: one route per tech per day, times recomputed on the server
 * from the start time, door notes snapshotted, work orders scheduled through the audited workflow,
 * then the tech is told. Sending never blocks saving; the response says what went out.
 *
 * GET ?date=YYYY-MM-DD[&tech=Name] — routes for a day (default today, Pacific). Schedulers see every
 * route; anyone else sees only their own.
 */
const todayPacific = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export async function POST(request: NextRequest) {
  const guard = await requireScheduler(request);
  if (!guard.ok) return guard.response;
  try {
    const input = validatePublish(await request.json());
    return NextResponse.json(await publishRoute(input, guard.session), { headers: noStore });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const guard = await requireViewer();
  if (!guard.ok) return guard.response;
  const date = request.nextUrl.searchParams.get('date') ?? todayPacific();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    const actor = await routeActor(guard.email);
    const requested = request.nextUrl.searchParams.get('tech') || undefined;
    const tech = actor.office ? requested : actor.person || '-';
    return NextResponse.json({ date, routes: await loadRoutes(date, tech) }, { headers: noStore });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
