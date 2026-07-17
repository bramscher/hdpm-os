import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { routeWorkflowPatch } from '@/lib/maintenance/route-publish';
import { updateWorkOrderWorkflow, WorkflowValidationError } from '@/lib/maintenance/workflow-db';
import { createRouteCalendarEvent, type RouteCalendarStop } from '@/lib/maintenance/route-calendar';
import type { RouteWorkflowState } from '@/lib/maintenance/route-publish';

/**
 * Published day routes for the in-house HDMS crew.
 *
 * POST — publish the optimize result as the day's route: persist plan + stops,
 * move each routed WO onto the schedule through updateWorkOrderWorkflow
 * (audited; stage advances only where the workflow graph allows — see
 * lib/maintenance/route-publish.ts), and optionally create the Outlook
 * calendar event (inspection-route pattern). Publish succeeds even when the
 * calendar step can't run (no Graph token) — the response says so.
 *
 * GET ?date=YYYY-MM-DD — the published route(s) for a day (default today,
 * Pacific) with per-stop WO summaries; feeds the home-dashboard card and the
 * board's Route view.
 */

const todayPacific = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

async function requireSession() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !email.endsWith('@highdesertpm.com')) return null;
  return {
    email,
    actor: session?.user?.name || email,
    accessToken: (session as { accessToken?: string }).accessToken ?? null,
  };
}

interface PublishStop {
  work_order_id: string;
  wo_number: string | null;
  description: string;
  property_name: string;
  unit_name: string | null;
  address: string;
  lat: number;
  lng: number;
  stop_order: number;
  drive_minutes_from_prev: number;
  service_minutes: number;
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    routeDate?: string;
    assignedTech?: string;
    stops?: PublishStop[];
    polyline?: string | null;
    totalDriveMinutes?: number;
    totalServiceMinutes?: number;
    createCalendarEvent?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const routeDate = body.routeDate ?? '';
  const assignedTech = (body.assignedTech ?? '').trim();
  const stops = Array.isArray(body.stops) ? body.stops : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) {
    return NextResponse.json({ error: 'routeDate must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!assignedTech) {
    return NextResponse.json({ error: 'assignedTech is required' }, { status: 400 });
  }
  if (stops.length === 0) {
    return NextResponse.json({ error: 'At least one stop is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const totalDrive = Math.round(body.totalDriveMinutes ?? 0);
  const totalService = Math.round(
    body.totalServiceMinutes ?? stops.reduce((n, s) => n + (s.service_minutes || 0), 0)
  );

  const { data: plan, error: planError } = await supabase
    .from('maint_route_plan')
    .insert({
      route_date: routeDate,
      assigned_tech: assignedTech,
      status: 'published',
      total_drive_minutes: totalDrive,
      total_service_minutes: totalService,
      stop_count: stops.length,
      polyline: body.polyline ?? null,
      created_by: session.actor,
    })
    .select('*')
    .single();

  if (planError || !plan) {
    return NextResponse.json({ error: planError?.message ?? 'Failed to save route' }, { status: 500 });
  }

  const { error: stopsError } = await supabase.from('maint_route_stop').insert(
    stops.map((s, i) => ({
      route_plan_id: plan.id,
      work_order_id: s.work_order_id,
      stop_order: s.stop_order || i + 1,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      drive_minutes_from_prev: Math.round(s.drive_minutes_from_prev || 0),
      service_minutes: Math.round(s.service_minutes || 45),
    }))
  );
  if (stopsError) {
    await supabase.from('maint_route_plan').delete().eq('id', plan.id);
    return NextResponse.json({ error: stopsError.message }, { status: 500 });
  }

  // ── Schedule each routed WO (audited; per-WO failures don't sink the publish) ──
  const { data: wos } = await supabase
    .from('work_orders')
    .select('id, stage, owner_name, priority_class, assigned_tech, vendor_id, vendor_name')
    .in('id', stops.map((s) => s.work_order_id));

  const scheduled: string[] = [];
  const dated: string[] = [];
  const skipped: { work_order_id: string; error: string }[] = [];
  for (const wo of (wos ?? []) as (RouteWorkflowState & { id: string })[]) {
    const patch = routeWorkflowPatch(wo, routeDate, assignedTech);
    try {
      await updateWorkOrderWorkflow(wo.id, patch, session.actor);
      (patch.stage === 'SCHEDULED' ? scheduled : dated).push(wo.id);
    } catch (e) {
      const msg = e instanceof WorkflowValidationError ? e.message : 'update failed';
      skipped.push({ work_order_id: wo.id, error: msg });
    }
  }

  // ── Outlook calendar event (optional, non-fatal) ──
  let calendar: { created: boolean; skippedReason?: string; webLink?: string | null; dryRun?: boolean } = {
    created: false,
    skippedReason: 'not requested',
  };
  if (body.createCalendarEvent) {
    if (!session.accessToken) {
      calendar = {
        created: false,
        skippedReason: 'No Microsoft access token. Sign out and back in to grant calendar permissions.',
      };
    } else {
      const calStops: RouteCalendarStop[] = stops.map((s) => ({
        stop_order: s.stop_order,
        wo_number: s.wo_number,
        description: s.description,
        property_name: s.property_name,
        unit_name: s.unit_name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        drive_minutes_from_prev: s.drive_minutes_from_prev,
        service_minutes: s.service_minutes,
      }));
      const result = await createRouteCalendarEvent(
        {
          routeDate,
          assignedTech,
          totalDriveMinutes: totalDrive,
          totalServiceMinutes: totalService,
          stops: calStops,
        },
        session.accessToken
      );
      if (result.created) {
        await supabase
          .from('maint_route_plan')
          .update({ calendar_event_id: result.eventId })
          .eq('id', plan.id);
        calendar = { created: true, webLink: result.webLink };
      } else if ('dryRun' in result && result.dryRun) {
        calendar = { created: false, dryRun: true, skippedReason: 'dry run' };
      } else {
        calendar = { created: false, skippedReason: (result as { error: string }).error };
      }
    }
  }

  return NextResponse.json({ plan, scheduled, dated, skipped, calendar });
}

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = request.nextUrl.searchParams.get('date') ?? todayPacific();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: plans, error } = await supabase
    .from('maint_route_plan')
    .select('*')
    .eq('route_date', date)
    .eq('status', 'published')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const planIds = (plans ?? []).map((p) => p.id);
  let stops: Record<string, unknown>[] = [];
  if (planIds.length > 0) {
    const { data: stopRows, error: stopsError } = await supabase
      .from('maint_route_stop')
      .select('*, work_orders (wo_number, description, property_name, unit_name, stage)')
      .in('route_plan_id', planIds)
      .order('stop_order', { ascending: true });
    if (stopsError) return NextResponse.json({ error: stopsError.message }, { status: 500 });
    stops = stopRows ?? [];
  }

  return NextResponse.json({
    date,
    routes: (plans ?? []).map((p) => ({
      ...p,
      stops: stops.filter((s) => s.route_plan_id === p.id),
    })),
  });
}
