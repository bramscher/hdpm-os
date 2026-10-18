import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchWorkOrderDetails } from '@/lib/appfolio';
import { canIssueInvoices } from '@/lib/invoice-permissions';
import { sendEmail } from '@/lib/agents/channels/email';
import { dispatchOutbox, enqueueOutbox } from '@/lib/agents/outbox';
import { isZoomSmsConfigured } from '@/lib/zoom-phone';
import { workOrderTitle } from '@/lib/field-time/model';
import { routeWorkflowPatch, type RouteWorkflowState } from './route-publish';
import { updateWorkOrderWorkflow, WorkflowValidationError } from './workflow-db';
import { createRouteCalendarEvent } from './route-calendar';
import { HHMM, dayRouteEmail, dayRouteText, scheduleStops, type DayRoute, type RouteLinks, type RouteStopInput, type ScheduledStop, type StopDetails } from './route-day';

/** Who is asking: office staff schedule and see every route; anyone else sees only their own. */
export async function routeActor(email: string) {
  const { data } = await getSupabaseAdmin().from('staff').select('person,email,access_role').ilike('email', email).eq('active', true).maybeSingle();
  return { person: (data?.person as string | undefined) ?? '', office: canIssueInvoices(data?.access_role as string | undefined) };
}

export interface PublishStopInput { work_order_id: string; stop_order: number; address: string; lat: number | null; lng: number | null; drive_minutes_from_prev: number; service_minutes: number }
export interface PublishInput {
  routeDate: string; assignedTech: string; startTime: string; notes: string; stops: PublishStopInput[];
  polyline: string | null; createCalendarEvent: boolean;
}
export interface Session { email: string; actor: string; accessToken: string | null; baseUrl: string }
export interface ChannelOutcome { channel: 'outlook' | 'email' | 'text' | 'my_day'; ok: boolean; detail: string }

const WO_COLUMNS = 'id,appfolio_id,wo_number,property_name,unit_name,description,priority,permission_to_enter,stage,owner_name,priority_class,assigned_tech,vendor_id,vendor_name';
/** How much of the work order's task line the tech gets on the route. */
const TASK_CHARS = 120;
const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : fallback);
const oneLine = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Check and normalise what the route builder sends; the server recomputes all times. */
export function validatePublish(body: Record<string, unknown>): PublishInput {
  const routeDate = String(body.routeDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) throw new Error('Choose the route date');
  const assignedTech = String(body.assignedTech || '').trim();
  if (!assignedTech) throw new Error('Choose the technician');
  const startTime = HHMM.test(String(body.startTime || '')) ? String(body.startTime) : '08:00';
  const raw = Array.isArray(body.stops) ? (body.stops as Record<string, unknown>[]) : [];
  if (!raw.length) throw new Error('Add at least one stop');
  if (raw.length > 40) throw new Error('A day route can have at most 40 stops');
  const seen = new Set<string>();
  const stops = raw.map((s, i) => {
    const id = String(s.work_order_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || seen.has(id)) throw new Error('Each stop needs a different work order');
    seen.add(id);
    const address = oneLine(s.address, 300);
    if (!address) throw new Error(`Stop ${i + 1} has no address`);
    const lat = Number(s.lat), lng = Number(s.lng);
    return {
      work_order_id: id, stop_order: i + 1, address,
      lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
      drive_minutes_from_prev: clamp(s.drive_minutes_from_prev, 0, 240, 0), service_minutes: clamp(s.service_minutes, 5, 600, 45),
    };
  });
  return { routeDate, assignedTech, startTime, notes: oneLine(body.notes, 600), stops, polyline: typeof body.polyline === 'string' ? body.polyline : null, createCalendarEvent: body.createCalendarEvent !== false };
}

/** What the tech needs at the door: from the work order, plus AppFolio's entry instructions when they can be fetched. */
async function snapshotDetails(wo: Record<string, unknown>): Promise<StopDetails> {
  const details: StopDetails = {
    task: workOrderTitle(wo.description as string, TASK_CHARS) || undefined,
    description: oneLine(wo.description, 400) || undefined,
    priority: (wo.priority as string) || null,
    permission_to_enter: wo.permission_to_enter == null ? null : wo.permission_to_enter === true || wo.permission_to_enter === 'true' || wo.permission_to_enter === 'yes' ? 'Yes' : 'No',
  };
  if (wo.appfolio_id) {
    const af = await fetchWorkOrderDetails(String(wo.appfolio_id)).catch(() => null);
    if (af) Object.assign(details, { entry_instructions: oneLine(af.EntryInstructions, 300) || null, tenant_remarks: oneLine(af.TenantRemarks, 300) || null, preferred_times: oneLine(af.PreferredTimes, 160) || null });
  }
  return details;
}

/**
 * Publish a tech's day: one route per tech per day (publishing again replaces it), times from the
 * start time, door notes snapshotted, work orders scheduled through the audited workflow, then the
 * tech is told by Outlook, email and (when their mobile is on file) text. Sending never blocks saving.
 */
export async function publishRoute(input: PublishInput, session: Session) {
  const db = getSupabaseAdmin();
  const { data: tech } = await db.from('staff').select('person,name,email,phone').eq('person', input.assignedTech).eq('active', true).maybeSingle();
  if (!tech) throw new Error('Choose an active technician');
  const { data: wos, error: woError } = await db.from('work_orders').select(WO_COLUMNS).in('id', input.stops.map(s => s.work_order_id));
  if (woError) throw new Error(woError.message);
  const woById = new Map((wos || []).map(w => [w.id as string, w as Record<string, unknown>]));
  const missing = input.stops.filter(s => !woById.has(s.work_order_id));
  if (missing.length) throw new Error('A work order on this route no longer exists. Re-optimize and try again.');
  const details = await Promise.all(input.stops.map(s => snapshotDetails(woById.get(s.work_order_id)!)));

  const stopInputs: RouteStopInput[] = input.stops.map((s, i) => {
    const wo = woById.get(s.work_order_id)!;
    return { ...s, wo_number: (wo.wo_number as string) ?? null, property_name: (wo.property_name as string) || 'Property', unit_name: (wo.unit_name as string) ?? null, details: details[i] };
  });
  const { stops: scheduled, finish } = scheduleStops(input.routeDate, input.startTime, stopInputs);
  const totals = { total_drive_minutes: scheduled.reduce((n, s) => n + s.drive_minutes_from_prev, 0), total_service_minutes: scheduled.reduce((n, s) => n + s.service_minutes, 0), stop_count: scheduled.length };

  // Replace this tech's route for the day if there is one (the unique index keeps it to one).
  // Otherwise a Dispatch draft for the day becomes the published route (same plan id).
  const { data: existing } = await db.from('maint_route_plan').select('id,calendar_event_id').eq('route_date', input.routeDate).ilike('assigned_tech', input.assignedTech).eq('status', 'published').maybeSingle();
  const { data: draft } = existing ? { data: null } : await db.from('maint_route_plan').select('id').eq('route_date', input.routeDate).ilike('assigned_tech', input.assignedTech).eq('status', 'draft').maybeSingle();
  const row = { route_date: input.routeDate, assigned_tech: tech.person, status: 'published', start_time: input.startTime, notes: input.notes, polyline: input.polyline, ...totals, updated_at: new Date().toISOString() };
  let planId: string;
  const reuse = existing ?? draft;
  if (reuse) {
    const { error } = await db.from('maint_route_plan').update(row).eq('id', reuse.id);
    if (error) throw new Error(error.message);
    await db.from('maint_route_stop').delete().eq('route_plan_id', reuse.id);
    planId = reuse.id;
  } else {
    const { data: plan, error } = await db.from('maint_route_plan').insert({ ...row, created_by: session.actor }).select('id').single();
    if (error || !plan) throw new Error(error?.message?.includes('duplicate') ? 'Another route for this tech and day was just saved. Reload and try again.' : error?.message || 'Could not save the route');
    planId = plan.id;
  }
  const { error: stopsError } = await db.from('maint_route_stop').insert(scheduled.map(s => ({
    route_plan_id: planId, work_order_id: s.work_order_id, stop_order: s.stop_order, address: s.address, lat: s.lat, lng: s.lng,
    drive_minutes_from_prev: s.drive_minutes_from_prev, service_minutes: s.service_minutes, estimated_arrival: s.arrival, estimated_departure: s.departure, details: s.details ?? {},
  })));
  if (stopsError) {
    if (draft) await db.from('maint_route_plan').update({ status: 'draft' }).eq('id', planId);
    else if (!existing) await db.from('maint_route_plan').delete().eq('id', planId);
    throw new Error(stopsError.message);
  }

  // Schedule each work order (audited; one failure doesn't sink the publish).
  const scheduledIds: string[] = [], dated: string[] = [], skipped: { work_order_id: string; error: string }[] = [];
  for (const wo of (wos || []) as unknown as (RouteWorkflowState & { id: string })[]) {
    const patch = routeWorkflowPatch(wo, input.routeDate, tech.person);
    try {
      await updateWorkOrderWorkflow(wo.id, patch, session.actor);
      (patch.stage === 'SCHEDULED' ? scheduledIds : dated).push(wo.id);
    } catch (e) {
      skipped.push({ work_order_id: wo.id, error: e instanceof WorkflowValidationError ? e.message : 'update failed' });
    }
  }

  const route: DayRoute = { routeDate: input.routeDate, tech: tech.person, startTime: input.startTime, stops: scheduled, finish, notes: input.notes, updated: !!existing };
  const outcomes = await notifyRoute(planId, route, { email: tech.email, phone: tech.phone }, session, { calendar: input.createCalendarEvent, calendarEventId: existing?.calendar_event_id ?? null });
  return { planId, updated: !!existing, scheduled: scheduledIds, dated, skipped, notified: outcomes };
}

export const routeLinks = (baseUrl: string, planId: string, routeDate: string): RouteLinks => ({
  myDay: `${baseUrl}/maintenance/field?date=${routeDate}`,
  daySheet: `${baseUrl}/api/maintenance/routes/${planId}/day-sheet`,
});

/** Tell the tech: Outlook invite (created or updated in place), email, and a text when their mobile is on file. Logged on the plan. */
export async function notifyRoute(
  planId: string, route: DayRoute, contact: { email: string | null; phone: string | null }, session: Session,
  opts: { calendar: boolean; calendarEventId: string | null },
): Promise<ChannelOutcome[]> {
  const db = getSupabaseAdmin();
  const links = routeLinks(session.baseUrl, planId, route.routeDate);
  const mail = dayRouteEmail(route, links);
  const outcomes: ChannelOutcome[] = [{ channel: 'my_day', ok: true, detail: 'On My Day in the Field app' }];

  if (!opts.calendar) outcomes.push({ channel: 'outlook', ok: false, detail: 'Not requested' });
  else if (!session.accessToken) outcomes.push({ channel: 'outlook', ok: false, detail: 'No Microsoft sign-in token. Sign out and back in, then re-send.' });
  else {
    try {
      const result = await createRouteCalendarEvent({
        routeDate: route.routeDate, assignedTech: route.tech, startTime: route.startTime, finish: route.finish, techEmail: contact.email, html: mail.html,
        totalDriveMinutes: route.stops.reduce((n, s) => n + s.drive_minutes_from_prev, 0), totalServiceMinutes: route.stops.reduce((n, s) => n + s.service_minutes, 0),
        stops: route.stops.map(s => ({ stop_order: s.stop_order, wo_number: s.wo_number, description: s.details?.task || '', property_name: s.property_name, unit_name: s.unit_name, address: s.address, lat: s.lat, lng: s.lng, drive_minutes_from_prev: s.drive_minutes_from_prev, service_minutes: s.service_minutes })),
      }, session.accessToken, opts.calendarEventId);
      if (result.created) {
        await db.from('maint_route_plan').update({ calendar_event_id: result.eventId }).eq('id', planId);
        outcomes.push({ channel: 'outlook', ok: true, detail: contact.email ? `Invite on ${route.tech}’s calendar` : 'On the Operations calendar' });
      } else outcomes.push({ channel: 'outlook', ok: false, detail: 'dryRun' in result && result.dryRun ? 'Dry run: no invite sent' : (result as { error: string }).error });
    } catch (e) { outcomes.push({ channel: 'outlook', ok: false, detail: (e as Error).message }); }
  }

  if (!contact.email) outcomes.push({ channel: 'email', ok: false, detail: `No email on file for ${route.tech}` });
  else {
    const sent = await sendEmail({ to: contact.email, subject: mail.subject, html: mail.html, text: mail.text }).catch(e => ({ status: 'failed' as const, error: (e as Error).message }));
    outcomes.push({ channel: 'email', ok: sent.status === 'sent', detail: sent.status === 'sent' ? `Emailed ${contact.email}` : sent.status === 'skipped' ? 'Email is not set up (no Resend key)' : `Email failed: ${'error' in sent ? sent.error : ''}` });
  }

  if (!contact.phone) outcomes.push({ channel: 'text', ok: false, detail: `No mobile on file for ${route.tech} (add it in User settings)` });
  else if (!isZoomSmsConfigured()) outcomes.push({ channel: 'text', ok: false, detail: 'Texting is not set up' });
  else {
    try {
      await enqueueOutbox({ channel: 'sms_zoom', recipient_person: route.tech, recipient_address: contact.phone, body: dayRouteText(route, links), payload: { kind: 'maint_route', plan_id: planId } });
      const run = await dispatchOutbox({ channel: 'sms_zoom', limit: 5 });
      outcomes.push({ channel: 'text', ok: run.sent > 0, detail: run.sent > 0 ? `Texted ${route.tech} from the office line` : run.halted ? `Text held: ${run.halted}` : 'Text queued; it will retry' });
    } catch (e) { outcomes.push({ channel: 'text', ok: false, detail: (e as Error).message }); }
  }

  const now = new Date().toISOString();
  const { data: plan } = await db.from('maint_route_plan').select('notify_log').eq('id', planId).maybeSingle();
  const log = [...(Array.isArray(plan?.notify_log) ? plan!.notify_log : []), { at: now, by: session.email, outcomes }].slice(-20);
  await db.from('maint_route_plan').update({ notified_at: now, notify_log: log }).eq('id', planId);
  return outcomes;
}

type StopRow = { id: string; route_plan_id: string; work_order_id: string; stop_order: number; address: string; lat: number | null; lng: number | null; drive_minutes_from_prev: number; service_minutes: number; estimated_arrival: string | null; estimated_departure: string | null; details: StopDetails | null; work_orders: { wo_number: string | null; property_name: string | null; unit_name: string | null; stage: string | null; description: string | null } | null };

/** Published routes for a day (optionally one tech), each with its stops, times and door notes. */
export async function loadRoutes(date: string, tech?: string) {
  const db = getSupabaseAdmin();
  let q = db.from('maint_route_plan').select('*').eq('route_date', date).eq('status', 'published').order('created_at');
  if (tech) q = q.ilike('assigned_tech', tech);
  const { data: plans, error } = await q;
  if (error) throw new Error(error.message);
  if (!plans?.length) return [];
  const { data: stops, error: stopsError } = await db.from('maint_route_stop')
    .select('*, work_orders (wo_number, property_name, unit_name, stage, description)')
    .in('route_plan_id', plans.map(p => p.id)).order('stop_order');
  if (stopsError) throw new Error(stopsError.message);
  return plans.map(p => {
    const rows = ((stops || []) as StopRow[]).filter(s => s.route_plan_id === p.id);
    const route = toDayRoute(p, rows);
    return { ...p, finish: route.finish, stops: rows.map((s, i) => ({ ...s, arrival: route.stops[i].arrival, departure: route.stops[i].departure })) };
  });
}

/** A stored plan and its stops as the day the tech receives (times recomputed when a stop has none). */
export function toDayRoute(plan: { route_date: string; assigned_tech: string | null; start_time?: string | null; notes?: string | null }, rows: StopRow[]): DayRoute {
  const startTime = (plan.start_time || '08:00').slice(0, 5);
  const inputs: RouteStopInput[] = rows.map(s => ({
    stop_order: s.stop_order, work_order_id: s.work_order_id, wo_number: s.work_orders?.wo_number ?? null, property_name: s.work_orders?.property_name || 'Property', unit_name: s.work_orders?.unit_name ?? null,
    address: s.address, lat: s.lat, lng: s.lng, drive_minutes_from_prev: s.drive_minutes_from_prev, service_minutes: s.service_minutes,
    details: s.details && Object.keys(s.details).length ? s.details : { task: workOrderTitle(s.work_orders?.description, TASK_CHARS) || undefined },
  }));
  const { stops, finish } = scheduleStops(plan.route_date, startTime, inputs);
  const withStored: ScheduledStop[] = stops.map((s, i) => ({ ...s, arrival: rows[i].estimated_arrival || s.arrival, departure: rows[i].estimated_departure || s.departure }));
  return { routeDate: plan.route_date, tech: plan.assigned_tech || '', startTime, stops: withStored, finish, notes: plan.notes || '' };
}

/** One plan with its stops and the tech's contact details, for the day sheet and re-sending. */
export async function loadRoute(id: string) {
  const db = getSupabaseAdmin();
  const { data: plan } = await db.from('maint_route_plan').select('*').eq('id', id).maybeSingle();
  if (!plan || plan.status !== 'published') return null;
  const { data: rows } = await db.from('maint_route_stop').select('*, work_orders (wo_number, property_name, unit_name, stage, description)').eq('route_plan_id', id).order('stop_order');
  const { data: tech } = await db.from('staff').select('person,email,phone').ilike('person', plan.assigned_tech || '').maybeSingle();
  return { plan, route: toDayRoute(plan, (rows || []) as StopRow[]), contact: { email: (tech?.email as string) ?? null, phone: (tech?.phone as string) ?? null } };
}
