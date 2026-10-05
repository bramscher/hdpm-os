import { loadInspectionReview } from '@/lib/inspection-review-loader';
import type { ReviewedCandidate } from '@/lib/inspection-review';
export const maxDuration = 120;
import { inspectionScheduleError } from '@/lib/inspection-window';
import { optimizeRouteWithGoogle } from '@/lib/route-directions';
import { inspectionSchedule } from '@/lib/route-builder/inspection-schedule';
import { routeArrival } from '@/lib/route-builder/inspection-time';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildRoutePlans } from '@/lib/route-engine';
import { computeInspectionDueDate } from '@/lib/inspection-candidates';
import { requireNewNotice } from '@/lib/inspection-route-reschedule';
import { postInspectionNoticeCard } from '@/lib/agents/dez/inspection-notice';
import type { GeoInspection } from '@/types/routes';

interface ScheduleRequest {
  date_range_start: string;
  date_range_end: string;
  assigned_to?: string;
  max_stops_per_route?: number;
  candidate_ids?: string[]; // optional manual pick; otherwise use all eligible
}

/**
 * POST /api/inspections/candidates/schedule
 *
 * Materializes eligible candidates into inspections rows, runs the proximity-
 * grouped route engine across the supplied date range, persists route_plans +
 * route_stops, and flips the candidates' candidate_status to 'scheduled'.
 *
 * Schedulable = freshly verified review_group='ready' with coordinates.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as ScheduleRequest;
    const { date_range_start, date_range_end, assigned_to, max_stops_per_route, candidate_ids } = body;

    if (!date_range_start || !date_range_end) {
      return NextResponse.json(
        { error: 'date_range_start and date_range_end are required' },
        { status: 400 }
      );
    }

    const scheduleError = inspectionScheduleError(date_range_start, date_range_end);
    if (scheduleError) return NextResponse.json({ error: scheduleError }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // Use the same reconciled candidates as the dashboard; legacy routes may
    // reference a separate imported property row for an already scheduled unit.
    const review = await loadInspectionReview(supabase, {fresh:true});
    if (review.verification_error) return NextResponse.json({error:review.verification_error}, {status:503});
    const properties = review.candidates;
    if (candidate_ids?.some(id => !properties.some(candidate => candidate.id === id && candidate.review_group === 'ready'))) {
      return NextResponse.json({error:'Some selected units are not ready to schedule. Refresh the reconciliation list.'}, {status:409});
    }
    const candidates = properties.filter((candidate): candidate is ReviewedCandidate & {id: string; latitude: number; longitude: number} =>
      !!candidate.id && candidate.active !== false && candidate.routine_inspections_enabled !== false
      && candidate.review_group === 'ready' && candidate.latitude != null && candidate.longitude != null
      && (!candidate_ids?.length || candidate_ids.includes(candidate.id)));
    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ routes: [], scheduled_count: 0, message: 'No verified ready-to-schedule candidates with coordinates' });
    }

    // Step 2: Create one inspections row per candidate.
    // The due date is anchored to move-in: max(move_in, last_inspection) + 6 months
    // (precomputed as next_due_date during the candidate sync). Resident name and
    // email are carried over so the tenant notice + calendar event can use them.
    //
    // Reuse before insert: the completion cascade pre-creates the next routine
    // inspection ('imported'), so a candidate may already have a pending row —
    // adopt it into this schedule run instead of creating a duplicate.
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const { data: pendingRows } = await supabase
      .from('inspections')
      .select('id, property_id, due_date, priority, status, route_plan_id')
      .in('property_id', candidates.map((c) => c.id))
      .not('status', 'in', '(completed,canceled)');
    const pendingByProperty = new Map(
      (pendingRows ?? []).map((r) => [r.property_id as string, r])
    );

    /** Unrouted queue statuses — safe to adopt into a new route. */
    const ADOPTABLE = new Set(['imported', 'validated', 'queued']);

    const toInsert: Record<string, unknown>[] = [];
    const adopted: { id: string; property_id: string; due_date: string; priority: string; status: string }[] = [];
    let skippedInFlight = 0;
    for (const c of candidates) {
      const existing = pendingByProperty.get(c.id);
      if (existing) {
        if (existing.route_plan_id || !ADOPTABLE.has(existing.status)) {
          // Already attached to an active route — leave it alone entirely.
          skippedInFlight++;
          continue;
        }
        adopted.push(existing as (typeof adopted)[number]);
        continue;
      }
      const dueDate =
        c.next_due_date ||
        computeInspectionDueDate(c.move_in_date ?? null, c.last_inspection_date ?? null) ||
        todayStr;
      toInsert.push({
        property_id: c.id,
        inspection_type: 'routine',
        status: 'queued',
        priority: 'normal',
        priority_score: 50,
        estimated_duration_minutes: 15,
        occupancy_status: 'occupied',
        due_date: dueDate,
        last_inspection_date: c.last_inspection_date ?? null,
        move_in_date: c.move_in_date ?? null,
        resident_name: c.resident_name ?? null,
        notice_email: c.tenant_email ?? null,
        notice_status: c.tenant_email ? 'pending' : 'skipped_no_email',
      });
    }

    // Flip adopted rows into the queue for this run.
    if (adopted.length > 0) {
      await supabase
        .from('inspections')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .in('id', adopted.map((a) => a.id));
    }

    let insertedRows: typeof adopted = [];
    if (toInsert.length > 0) {
      const { data, error: insErr } = await supabase
        .from('inspections')
        .insert(toInsert)
        .select('id, property_id, due_date, priority, status');
      if (insErr || !data) {
        console.error('[candidates/schedule] insert inspections error:', insErr);
        return NextResponse.json({ error: insErr?.message || 'Failed to create inspections' }, { status: 500 });
      }
      insertedRows = data as typeof adopted;
    }

    const insertedInspections = [...insertedRows, ...adopted];
    if (insertedInspections.length === 0) {
      return NextResponse.json({ routes: [], scheduled_count: 0, message: 'Nothing to schedule' });
    }

    // Step 4: Map inserted inspections into GeoInspection records for the route engine
    const candidateById = new Map(candidates.map((c) => [c.id, c]));
    const geoInspections: GeoInspection[] = insertedInspections.map((insp) => {
      const c = candidateById.get(insp.property_id)!;
      const dueDate = insp.due_date ? new Date(insp.due_date) : null;
      const daysOverdue = dueDate
        ? Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      return {
        inspection_id: insp.id,
        property_id: insp.property_id,
        address: `${c.address_1}, ${c.city}, ${c.state} ${c.zip}`,
        unit_name: c.address_2 ?? null,
        city: c.city || 'Unknown',
        lat: c.latitude as number,
        lng: c.longitude as number,
        due_date: insp.due_date,
        priority: 'normal',
        service_minutes: 15,
        days_overdue: daysOverdue,
      };
    });

    // Step 5: Build proposed routes across the date range
    const result = buildRoutePlans(geoInspections, {
      date_range_start,
      date_range_end,
      assigned_to: assigned_to || session.user?.email || 'unassigned',
      max_stops_per_route: max_stops_per_route ?? 10,
    });

    if (result.routes.length === 0) {
      // Rollback: delete only the rows we just created; adopted pre-existing
      // rows go back to their prior status instead of being deleted.
      if (insertedRows.length > 0) {
        await supabase
          .from('inspections')
          .delete()
          .in('id', insertedRows.map((i) => i.id));
      }
      for (const a of adopted) {
        await supabase
          .from('inspections')
          .update({ status: a.status, updated_at: new Date().toISOString() })
          .eq('id', a.id);
      }
      return NextResponse.json({
        routes: [],
        scheduled_count: 0,
        excluded_count: result.excluded.length,
        message: 'No routes produced (all candidates excluded — verify geocoding)',
      });
    }

    // Step 6: Persist route_plans + route_stops, collect scheduled inspection IDs
    const createdRoutes: Array<{ id: string; route_date: string; total_stops: number }> = [];
    const scheduledInspectionIds: string[] = [];
    const scheduledPropertyIds = new Set<string>();

    for (const proposed of result.routes) {
      const optimized = await optimizeRouteWithGoogle(proposed.stops);
      proposed.stops = optimized.stops;
      proposed.total_drive_minutes = optimized.total_drive_minutes;
      const timing = inspectionSchedule(proposed.stops);
      const { data: routePlan, error: planErr } = await supabase
        .from('route_plans')
        .insert({
          route_date: proposed.route_date,
          assigned_to: proposed.assigned_to || session.user?.email || 'unassigned',
          status: 'optimized',
          optimization_method: optimized.source,
          total_drive_minutes: Math.round(proposed.total_drive_minutes || 0),
          total_service_minutes: Math.round(proposed.total_service_minutes || 0),
          total_stops: Math.round(proposed.stop_count || 0),
          notes: proposed.name,
        })
        .select('id, route_date, total_stops')
        .single();

      if (planErr || !routePlan) {
        console.error('[candidates/schedule] insert route_plan error:', planErr);
        return NextResponse.json({ error: planErr?.message || 'Failed to save route plan' }, { status: 500 });
      }

      const stopsToInsert = proposed.stops.map((stop, index) => ({
        route_plan_id: routePlan.id,
        inspection_id: stop.inspection_id,
        stop_order: stop.stop_order,
        estimated_arrival: routeArrival(proposed.route_date, '08:00', timing.visits[index].arrivalMinutes),
        travel_minutes_from_previous: Math.round(stop.drive_minutes_from_prev || 0),
        service_minutes: Math.round(stop.service_minutes || 15),
      }));

      const { error: stopsErr } = await supabase.from('route_stops').insert(stopsToInsert);
      if (stopsErr) {
        console.error('[candidates/schedule] insert route_stops error:', stopsErr);
        return NextResponse.json({ error: stopsErr.message }, { status: 500 });
      }

      // Update the inspections with route_plan_id + scheduled status + target_date
      const inspIds = proposed.stops.map((s) => s.inspection_id);
      await requireNewNotice(supabase, inspIds);
      await supabase
        .from('inspections')
        .update({
          route_plan_id: routePlan.id,
          target_date: proposed.route_date,
          status: 'scheduled',
          assigned_to: proposed.assigned_to || session.user?.email || 'unassigned',
        })
        .in('id', inspIds);

      scheduledInspectionIds.push(...inspIds);
      for (const stop of proposed.stops) {
        scheduledPropertyIds.add(stop.property_id);
      }

      createdRoutes.push({ id: routePlan.id, route_date: routePlan.route_date, total_stops: routePlan.total_stops });
    }

    // Step 7: Flip candidate_status to 'scheduled' for properties whose inspections made it onto a route
    if (scheduledPropertyIds.size > 0) {
      await supabase
        .from('inspection_properties')
        .update({ candidate_status: 'scheduled' })
        .in('id', [...scheduledPropertyIds]);
    }

    // Dez: DM the inspections owner (Brody) a card of the tenant notices these
    // newly-scheduled inspections need, so a human sends them via AppFolio /
    // Realm-X. Human-gated, ships dark behind DEZ_INSPECTION_NOTICES. Awaited but
    // never fatal — a Slack hiccup must not fail the schedule the user just made.
    if (process.env.DEZ_INSPECTION_NOTICES === '1' && scheduledInspectionIds.length > 0) {
      await postInspectionNoticeCard(supabase, scheduledInspectionIds);
    }

    return NextResponse.json({
      routes: createdRoutes,
      scheduled_count: scheduledInspectionIds.length,
      adopted_count: adopted.length,
      skipped_in_flight: skippedInFlight,
      excluded_count: result.excluded.length,
      excluded: result.excluded,
    });
  } catch (error) {
    console.error('[candidates/schedule] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to schedule candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
