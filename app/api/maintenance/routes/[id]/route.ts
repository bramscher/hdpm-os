import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { deleteRouteCalendarEvent } from '@/lib/maintenance/route-calendar';

/**
 * DELETE /api/maintenance/routes/[id] — cancel a published day route.
 * Deletes the plan (stops cascade) and best-effort removes the Outlook event.
 * The routed WOs keep their stage / next-action date — canceling the route is
 * a display decision, not an un-scheduling of the work.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !email.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: plan, error: loadError } = await supabase
    .from('maint_route_plan')
    .select('id, calendar_event_id')
    .eq('id', id)
    .single();
  if (loadError || !plan) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }

  let calendarDeleted = false;
  const accessToken = (session as { accessToken?: string }).accessToken;
  if (plan.calendar_event_id && accessToken) {
    calendarDeleted = await deleteRouteCalendarEvent(plan.calendar_event_id, accessToken);
  }

  const { error: deleteError } = await supabase.from('maint_route_plan').delete().eq('id', id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, calendarDeleted });
}
