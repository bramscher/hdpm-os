import type { SupabaseClient } from '@supabase/supabase-js';
import { inspectionScheduleError } from './inspection-window';
import { inspectionSchedule } from './route-builder/inspection-schedule';
import { routeArrival } from './route-builder/inspection-time';

export type RescheduleResult =
  | { moved: true; from: string; to: string; renoticed: number }
  | { error: string; status: number };

/**
 * Move a route to a new date and keep everything that hangs off the date in step:
 * the route, its inspections' target_date (what Send Notices reads), and stop
 * arrival times. Tenants already told the old date go back into Send Notices,
 * marked with the date they were told, so they get an updated notice.
 */
export async function rescheduleRoute(
  supabase: SupabaseClient,
  routeId: string,
  newDate: string,
  today?: string,
): Promise<RescheduleResult> {
  const scheduleError = inspectionScheduleError(newDate, newDate, today);
  if (scheduleError) return { error: scheduleError, status: 400 };

  const { data: plan } = await supabase
    .from('route_plans')
    .select('id, route_date, start_time, status')
    .eq('id', routeId)
    .maybeSingle();
  if (!plan) return { error: 'Route plan not found', status: 404 };
  if (plan.route_date === newDate) return { moved: true, from: plan.route_date, to: newDate, renoticed: 0 };
  if (['in_progress', 'completed'].includes(plan.status)) {
    return { error: 'This route has already started; its date can no longer change.', status: 409 };
  }

  const { data: stops, error: stopsError } = await supabase
    .from('route_stops')
    .select('id, inspection_id, stop_order, status, travel_minutes_from_previous, service_minutes')
    .eq('route_plan_id', routeId)
    .order('stop_order', { ascending: true });
  if (stopsError) return { error: stopsError.message, status: 500 };
  if ((stops || []).some((s) => ['in_progress', 'completed'].includes(s.status))) {
    return { error: 'A stop on this route has already started; its date can no longer change.', status: 409 };
  }

  const now = new Date().toISOString();
  const { error: planError } = await supabase.from('route_plans').update({ route_date: newDate, updated_at: now }).eq('id', routeId);
  if (planError) return { error: planError.message, status: 500 };

  const timing = inspectionSchedule(stops || []);
  for (const [index, stop] of (stops || []).entries()) {
    const estimated_arrival = stop.status === 'skipped' ? null : routeArrival(newDate, plan.start_time, timing.visits[index].arrivalMinutes);
    const { error } = await supabase.from('route_stops').update({ estimated_arrival }).eq('id', stop.id);
    if (error) return { error: error.message, status: 500 };
  }

  const inspectionIds = (stops || []).filter((s) => s.status !== 'skipped').map((s) => s.inspection_id);
  let renoticed = 0;
  if (inspectionIds.length > 0) {
    renoticed = await requireNewNotice(supabase, inspectionIds, plan.route_date);
    const { error } = await supabase.from('inspections').update({ target_date: newDate, updated_at: now }).in('id', inspectionIds);
    if (error) return { error: error.message, status: 500 };
  }

  return { moved: true, from: plan.route_date, to: newDate, renoticed };
}

/**
 * Inspections whose tenants were already told a date need a new notice when the
 * date changes (route moved, or rescheduled onto a new route). Remembers the date
 * they were told and puts them back in Send Notices. Call BEFORE overwriting
 * target_date. Returns how many were reset.
 */
export async function requireNewNotice(supabase: SupabaseClient, inspectionIds: string[], fallbackDate?: string | null): Promise<number> {
  if (inspectionIds.length === 0) return 0;
  const noticedQuery = (cols: string) => supabase
    .from('inspections')
    .select(cols)
    .in('id', inspectionIds)
    .not('notice_sent_at', 'is', null);
  let { data: noticedData, error } = await noticedQuery('id, target_date, notice_previous_target_date');
  if (error && /notice_previous_target_date/.test(error.message)) {
    ({ data: noticedData, error } = await noticedQuery('id, target_date'));
  }
  const noticed = (noticedData || []) as unknown as { id: string; target_date: string | null; notice_previous_target_date?: string | null }[];
  if (error) {
    console.error('[reschedule] could not load noticed inspections:', error.message);
    return 0;
  }
  let reset = 0;
  for (const row of noticed) {
    const told = row.notice_previous_target_date || row.target_date || fallbackDate || null;
    let { error: updateError } = await supabase.from('inspections').update({
      notice_previous_target_date: told,
      notice_sent_at: null,
      notice_status: 'pending',
    }).eq('id', row.id);
    if (updateError && /notice_previous_target_date/.test(updateError.message)) {
      // 20261011 not applied yet: still re-queue the notice, just without the old date.
      ({ error: updateError } = await supabase.from('inspections').update({ notice_sent_at: null, notice_status: 'pending' }).eq('id', row.id));
    }
    if (!updateError) reset++;
  }
  return reset;
}
