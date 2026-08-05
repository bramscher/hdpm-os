import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildRoutePlans } from '@/lib/route-engine';
import { computeInspectionDueDate } from '@/lib/inspection-candidates';
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
 * Eligible = `candidate_status='eligible'` AND latitude/longitude present.
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

    // Enforce 7-day lead time for tenant notice (matches /api/inspections/routes)
    const minRouteDate = new Date();
    minRouteDate.setDate(minRouteDate.getDate() + 7);
    const minDateStr = minRouteDate.toISOString().split('T')[0];
    if (date_range_start < minDateStr) {
      return NextResponse.json(
        { error: 'Routes must be scheduled at least 7 days in advance to allow time for tenant notices.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Step 1: Load eligible candidates with coordinates.
    // NB: we deliberately do NOT filter on uses_custom_inspection_date — that flag
    // is a web-app-only field the v0 API never populates (always false), so gating
    // on it would exclude every candidate.
    let candQuery = supabase
      .from('inspection_properties')
      .select('id, address_1, address_2, city, state, zip, latitude, longitude, name, owner_name, appfolio_property_id, appfolio_unit_id, last_inspection_date, move_in_date, next_due_date, resident_name, tenant_email, candidate_status')
      .eq('candidate_status', 'eligible')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (candidate_ids && candidate_ids.length > 0) {
      candQuery = candQuery.in('id', candidate_ids);
    }

    const { data: candidates, error: candErr } = await candQuery;
    if (candErr) {
      console.error('[candidates/schedule] load error:', candErr);
      return NextResponse.json({ error: candErr.message }, { status: 500 });
    }
    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ routes: [], scheduled_count: 0, message: 'No eligible candidates with coordinates' });
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
        estimated_duration_minutes: 30,
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
        unit_name: c.address_2,
        city: c.city,
        lat: c.latitude as number,
        lng: c.longitude as number,
        due_date: insp.due_date,
        priority: 'normal',
        service_minutes: 30,
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
      const { data: routePlan, error: planErr } = await supabase
        .from('route_plans')
        .insert({
          route_date: proposed.route_date,
          assigned_to: proposed.assigned_to || session.user?.email || 'unassigned',
          status: 'draft',
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

      const stopsToInsert = proposed.stops.map((stop) => ({
        route_plan_id: routePlan.id,
        inspection_id: stop.inspection_id,
        stop_order: stop.stop_order,
        travel_minutes_from_previous: Math.round(stop.drive_minutes_from_prev || 0),
        service_minutes: Math.round(stop.service_minutes || 30),
      }));

      const { error: stopsErr } = await supabase.from('route_stops').insert(stopsToInsert);
      if (stopsErr) {
        console.error('[candidates/schedule] insert route_stops error:', stopsErr);
        return NextResponse.json({ error: stopsErr.message }, { status: 500 });
      }

      // Update the inspections with route_plan_id + scheduled status + target_date
      const inspIds = proposed.stops.map((s) => s.inspection_id);
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
