import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { deleteRouteCalendarEvent } from '@/lib/maintenance/route-calendar';
import { requireScheduler } from '@/lib/maintenance/route-http';

/**
 * DELETE /api/maintenance/routes/[id] — cancel a published day route.
 * Deletes the plan (stops cascade) and best-effort removes the Outlook event (and with it the tech's invite).
 * The routed WOs keep their stage / next-action date — canceling the route is
 * a display decision, not an un-scheduling of the work.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScheduler(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: plan, error: loadError } = await supabase.from('maint_route_plan').select('id, calendar_event_id').eq('id', id).single();
  if (loadError || !plan) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  let calendarDeleted = false;
  if (plan.calendar_event_id && guard.session.accessToken) calendarDeleted = await deleteRouteCalendarEvent(plan.calendar_event_id, guard.session.accessToken);
  const { error: deleteError } = await supabase.from('maint_route_plan').delete().eq('id', id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ success: true, calendarDeleted });
}
