import { NextRequest, NextResponse } from 'next/server';
import { loadRoute, notifyRoute } from '@/lib/maintenance/route-server';
import { noStore, requireScheduler } from '@/lib/maintenance/route-http';

/** POST — send a published route to its tech again (Outlook invite updated in place, email, text). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScheduler(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const found = await loadRoute(id);
  if (!found) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  const notified = await notifyRoute(id, found.route, found.contact, guard.session, { calendar: true, calendarEventId: found.plan.calendar_event_id ?? null });
  return NextResponse.json({ notified }, { headers: noStore });
}
