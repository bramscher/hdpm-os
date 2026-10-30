import { getSupabaseAdmin } from '@/lib/supabase';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { inHouseVendorFilter, linkInvoices } from '@/lib/daily-billing/links';
import type { Decision, Issue } from '@/lib/daily-billing/model';
import type { dailyBillingActor } from '@/lib/daily-billing/server';
import { pacificDay, shiftDay } from '@/lib/maintenance-workspace/model';
import { validDate } from '@/lib/timekeeping/model';
import type { HdmsInvoice } from '@/lib/invoices';
import { isFieldReviewer } from './access';
import { assessWorkOrder, fieldBillingIssues, fieldDayTotals, fieldTimeByWorkOrder, type BillingWorkOrder, type FieldDayTotals, type FieldTimeRow } from './billing';
import { computeDay } from './compute';
import { FIELD_CONFIG, RADIUS_BY_KIND } from './config';
import { assigneeOf, candidateWorkOrders, rankCandidates, workOrderDone } from './match';
import { minutesOf, needsInput, workOrderTitle, type Candidate, type CandidateWorkOrder, type InspectionStop, type Place, type PlaceKind, type StoredSegment, type Unit } from './model';
import { pacificDayBounds } from '@/lib/field-app/model';
import { collectionWindows, coreHoursFor } from './windows';
import { sampleBreaks, samplePoints, sampleWindow, validateSampleSpec, type SamplePlace, type SampleSpec } from './sample';

export type FieldActor = Awaited<ReturnType<typeof dailyBillingActor>>;
export type Source = 'device' | 'sample';
/** Pilot techs (field-location-app-plan.md). Other techs appear once they have field days. */
export const FIELD_TECHS = ['Alberto', 'Brody'];

/** Full field days are for an admin, or the tech's own (device) days. Office roles don't count: both techs are "office". */
export const canSeeDay = (actor: FieldActor, technician: string, source: Source) => actor.admin || (source === 'device' && actor.person === technician);

type Query = any; // supabase-js builder; kept loose so filters compose
async function all<T>(table: string, columns: string, filter?: (q: Query) => Query, order = 'id'): Promise<T[]> {
  const db = getSupabaseAdmin();
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    let q: Query = db.from(table).select(columns).order(order);
    if (filter) q = filter(q);
    const { data, error } = await q.range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data as T[]) || []));
    if ((data || []).length < 1000) return rows;
  }
}

interface PlaceRow { id: string; kind: PlaceKind; supplier_id: string | null; name: string; address: string; latitude: number; longitude: number; radius_m: number; active: boolean; version: number; updated_at: string }
interface UnitRow { id: string; appfolio_property_id: string | null; appfolio_unit_id: string | null; name: string | null; address_1: string | null; address_2: string | null; city: string | null; latitude: number; longitude: number; active: boolean }
interface DayRow { id: string; technician: string; work_date: string; source: Source; sample_spec: SampleSpec | null; version: number; built_at: string | null }

const toPlace = (r: PlaceRow): Place => ({ id: r.id, kind: r.kind, name: r.name, supplierId: r.supplier_id, lat: r.latitude, lng: r.longitude, radiusM: r.radius_m, active: r.active });
const toUnit = (r: UnitRow): Unit => ({
  id: r.id, propertyId: r.appfolio_property_id, unitId: r.appfolio_unit_id, name: r.name || '', address: [r.address_1, r.address_2, r.city].filter(Boolean).join(', '),
  lat: r.latitude, lng: r.longitude, active: r.active,
});
const WO_COLUMNS = 'id,wo_number,property_id,unit_id,property_name,description,assigned_to,assigned_tech,status,stage,appfolio_status,created_at,completed_date,scheduled_start,canceled_date';

export const loadPlaceRows = () => all<PlaceRow>('field_place', 'id,kind,supplier_id,name,address,latitude,longitude,radius_m,active,version,updated_at', undefined, 'name');
const loadUnits = async () => (await all<UnitRow>('inspection_properties', 'id,appfolio_property_id,appfolio_unit_id,name,address_1,address_2,city,latitude,longitude,active', q => q.not('latitude', 'is', null).not('longitude', 'is', null))).map(toUnit);
/** In-house work orders that could be a job around `date` (created within the year before). */
async function loadWorkOrders(date: string): Promise<CandidateWorkOrder[]> {
  const cfg = await getDashboardConfig();
  return all<CandidateWorkOrder>('work_orders', WO_COLUMNS, q => q.or(inHouseVendorFilter(cfg.internalVendorIds)).gte('created_at', shiftDay(date, -365)));
}
/** The tech's inspection route stops for the date: route_plans (by staff email) → route_stops → inspections → unit rows. */
async function loadInspectionStops(technician: string, date: string, units: Map<string, Unit>): Promise<InspectionStop[]> {
  const db = getSupabaseAdmin();
  const { data: staff } = await db.from('staff').select('email').eq('person', technician).maybeSingle();
  if (!staff?.email) return [];
  const plans = await all<{ id: string }>('route_plans', 'id', q => q.eq('route_date', date).ilike('assigned_to', staff.email));
  if (!plans.length) return [];
  const stops = await all<{ id: string; inspection_id: string; status: string }>('route_stops', 'id,inspection_id,status', q => q.in('route_plan_id', plans.map(p => p.id)));
  if (!stops.length) return [];
  const inspections = await all<{ id: string; property_id: string }>('inspections', 'id,property_id', q => q.in('id', stops.map(s => s.inspection_id)));
  const unitOf = new Map(inspections.map(i => [i.id, units.get(i.property_id)]));
  return stops.flatMap(s => {
    const u = unitOf.get(s.inspection_id);
    return u ? [{ id: s.id, unitRowId: u.id, propertyId: u.propertyId, unitId: u.unitId, label: u.name || u.address, status: s.status }] : [];
  });
}

/** The tech's published maintenance route for the date (Open Board route builder): its work orders, in stop order. */
async function loadRouteWorkOrderIds(technician: string, date: string): Promise<string[]> {
  const plans = await all<{ id: string }>('maint_route_plan', 'id', q => q.eq('route_date', date).eq('status', 'published').ilike('assigned_tech', technician));
  if (!plans.length) return [];
  const stops = await all<{ work_order_id: string }>('maint_route_stop', 'work_order_id,stop_order', q => q.in('route_plan_id', plans.map(p => p.id)), 'stop_order');
  return [...new Set(stops.map(s => s.work_order_id))];
}
/** Route work orders outside the in-house list (the office can route any work order) still need to be candidates. */
async function withRouteWorkOrders(workOrders: CandidateWorkOrder[], routeIds: string[]) {
  const known = new Set(workOrders.map(w => w.id));
  const extra = routeIds.filter(id => !known.has(id));
  return extra.length ? [...workOrders, ...(await all<CandidateWorkOrder>('work_orders', WO_COLUMNS, q => q.in('id', extra)))] : workOrders;
}

async function loadDayRows(technician: string, date: string) {
  const days = await all<DayRow>('field_day', 'id,technician,work_date,source,sample_spec,version,built_at', q => q.eq('technician', technician).eq('work_date', date));
  const segments = days.length ? await all<StoredSegment>('field_segment', '*', q => q.in('day_id', days.map(d => d.id)), 'started_at') : [];
  return { days, segments };
}

interface DayContext { places: Place[]; units: Unit[]; unitById: Map<string, Unit>; workOrders: CandidateWorkOrder[]; inspectionStops: InspectionStop[]; routeWorkOrderIds: string[] }
async function loadContext(technician: string, date: string): Promise<DayContext> {
  const [placeRows, units, inHouse, routeWorkOrderIds] = await Promise.all([loadPlaceRows(), loadUnits(), loadWorkOrders(date), loadRouteWorkOrderIds(technician, date)]);
  const unitById = new Map(units.map(u => [u.id, u]));
  const workOrders = await withRouteWorkOrders(inHouse, routeWorkOrderIds);
  return { places: placeRows.map(toPlace), units, unitById, workOrders, routeWorkOrderIds, inspectionStops: await loadInspectionStops(technician, date, unitById) };
}
const locator = (ctx: DayContext) => (p: SamplePlace) => {
  if (p.type === 'point') return p;
  const hit = p.type === 'place' ? ctx.places.find(x => x.id === p.id) : ctx.unitById.get(p.id);
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
};

/** Points, windows and breaks for a day: typed sample stops, or the HDPM Field app's points. A device day
 *  covers weekday core hours stretched for overtime, plus any trip after hours (windows.ts); no clock-in. */
async function evidence(technician: string, source: Source, spec: SampleSpec | null, date: string, ctx: DayContext) {
  if (source === 'device') {
    const bounds = pacificDayBounds(date);
    const points = (await all<{ t: string; lat: number; lng: number; acc: number | null }>('field_location_point', 't,lat,lng,acc',
      q => q.eq('person', technician).gte('t', new Date(bounds.start).toISOString()).lt('t', new Date(bounds.end).toISOString()), 't'))
      .map(r => ({ t: Date.parse(r.t), lat: r.lat, lng: r.lng, acc: r.acc }));
    return { windows: collectionWindows(points, bounds, coreHoursFor(date), ctx.places), points, breaks: [] };
  }
  if (!spec) throw new Error('A sample day needs its stops');
  return { windows: [sampleWindow(spec, date)], points: samplePoints(spec, date, locator(ctx)), breaks: sampleBreaks(spec, date) };
}

/** Recompute a day's suggestions from its evidence and save them, keeping confirmed segments. Retries once if the day changed meanwhile. */
export async function rebuildDay(actor: FieldActor, technician: string, date: string, source: Source, specInput?: unknown) {
  if (!actor.admin) throw new Error('FORBIDDEN: only an admin can rebuild a field day');
  return rebuild(actor.email, technician, date, source, specInput);
}

/** The HDPM Field app's rebuild after an upload, as the tech (field_time_apply allows a tech their own device day). */
export const rebuildDeviceDay = (email: string, technician: string, date: string) => rebuild(email, technician, date, 'device');

async function rebuild(actorEmail: string, technician: string, date: string, source: Source, specInput?: unknown) {
  if (!validDate(date) || date > pacificDay()) throw new Error('Choose today or an earlier date');
  if (!FIELD_TECHS.includes(technician)) throw new Error('Choose a technician');
  const ctx = await loadContext(technician, date);
  for (let attempt = 0; ; attempt++) {
    const { days, segments } = await loadDayRows(technician, date);
    const day = days.find(d => d.source === source);
    const spec = source === 'sample' ? validateSampleSpec(specInput ?? day?.sample_spec) : null;
    const confirmed = segments.filter(s => s.day_id === day?.id && s.state === 'confirmed').map(s => ({ start: Date.parse(s.started_at), end: Date.parse(s.ended_at) }));
    const { segments: suggested } = computeDay({ technician, date, ...(await evidence(technician, source, spec, date, ctx)), places: ctx.places, units: ctx.units, workOrders: ctx.workOrders, routeWorkOrderIds: ctx.routeWorkOrderIds, inspectionStops: ctx.inspectionStops, confirmed });
    const { data, error } = await getSupabaseAdmin().rpc('field_time_apply', {
      actor: actorEmail,
      request: { op: 'replace', technician, work_date: date, source, version: day?.version ?? 0, sample_spec: spec, segments: suggested },
    });
    if (!error) return data;
    if (!error.message.includes('CONFLICT') || attempt) throw new Error(error.message);
  }
}

/** The centre of the detected stop under a segment, for "Save as location". Admin only; never stored on segments. */
export async function stopCentre(actor: FieldActor, technician: string, date: string, source: Source, segmentId: string) {
  if (!actor.admin) throw new Error('FORBIDDEN: only an admin can add locations');
  const { days, segments } = await loadDayRows(technician, date);
  const day = days.find(d => d.source === source);
  const segment = segments.find(s => s.id === segmentId && s.day_id === day?.id);
  if (!day || !segment) throw new Error('Segment not found');
  const ctx = await loadContext(technician, date);
  const ev = await evidence(technician, source, day.sample_spec, date, ctx);
  const { stops } = computeDay({ technician, date, ...ev, places: ctx.places, units: ctx.units, workOrders: ctx.workOrders, routeWorkOrderIds: ctx.routeWorkOrderIds, inspectionStops: ctx.inspectionStops });
  const from = Date.parse(segment.started_at), to = Date.parse(segment.ended_at);
  const hit = stops.map(s => ({ s, overlap: Math.min(to, s.stop.end) - Math.max(from, s.stop.start) })).filter(x => x.overlap > 0).sort((a, b) => b.overlap - a.overlap)[0];
  if (!hit) throw new Error('No stop was detected in that segment');
  return { latitude: Math.round(hit.s.stop.lat * 1e6) / 1e6, longitude: Math.round(hit.s.stop.lng * 1e6) / 1e6 };
}

/** Rebuild recent days that still have unconfirmed suggestions (after locations change). */
export async function rematchRecent(actor: FieldActor) {
  if (!actor.admin) throw new Error('FORBIDDEN: only an admin can re-match days');
  const since = shiftDay(pacificDay(), -14);
  const days = await all<DayRow>('field_day', 'id,technician,work_date,source,sample_spec,version,built_at', q => q.gte('work_date', since));
  const open = new Set((await all<{ day_id: string }>('field_segment', 'day_id', q => q.gte('work_date', since).eq('state', 'suggested'), 'day_id')).map(s => s.day_id));
  let rebuilt = 0;
  for (const d of days) if (open.has(d.id)) { await rebuildDay(actor, d.technician, d.work_date, d.source); rebuilt++; }
  return { rebuilt };
}

const label = (c: { wo_number: string | null; property_name: string | null }) => [c.property_name, c.wo_number].filter(Boolean).join(' · ');

/** The field day page payload. Admin, or the tech for their own device day; no coordinates leave the server except an admin's own sample spec. */
export async function loadFieldDay(actor: FieldActor, technician: string, date: string, sourceInput?: string) {
  if (!validDate(date)) throw new Error('Choose a date');
  const { days, segments } = await loadDayRows(technician, date);
  const visible = days.filter(d => canSeeDay(actor, technician, d.source));
  const source: Source = sourceInput === 'sample' || sourceInput === 'device' ? sourceInput : visible.find(d => d.source === 'device') ? 'device' : actor.admin ? 'sample' : 'device';
  if (!canSeeDay(actor, technician, source)) throw new Error('FORBIDDEN: only the tech or an admin can see this day');
  const day = days.find(d => d.source === source) ?? null;
  const placeRows = await loadPlaceRows();
  const placeName = new Map(placeRows.map(p => [p.id, p.name]));
  const routeIds = await loadRouteWorkOrderIds(technician, date);
  const onRoute = new Set(routeIds);
  const workOrders = await withRouteWorkOrders(await loadWorkOrders(date), routeIds);
  const ranked = candidateWorkOrders(workOrders, technician, date, FIELD_CONFIG, onRoute);
  const woById = new Map(workOrders.map(w => [w.id, w]));
  const rows = segments.filter(s => s.day_id === day?.id);
  // Work orders already on the day may be older or outside the candidate window; describe them too.
  const missing = [...new Set(rows.flatMap(s => [...s.allocations.map(a => a.work_order_id), ...(s.candidates as Candidate[]).map(c => c.work_order_id)]))].filter(id => !woById.has(id));
  if (missing.length) for (const w of await all<CandidateWorkOrder>('work_orders', WO_COLUMNS, q => q.in('id', missing))) woById.set(w.id, w);
  // For answer buttons: "43280-2 · Remove TV mount…" over "Weinberger 284 · open, Alberto’s · on the route".
  const describe = (id: string) => {
    const w = woById.get(id);
    if (!w) return { wo_number: null, property_name: null, title: 'Work order', sub: '', name: 'Work order' };
    const who = assigneeOf(w);
    const owner = who === technician ? `${technician}’s` : who ? `${who}’s` : 'unassigned';
    return { wo_number: w.wo_number, property_name: w.property_name, title: workOrderTitle(w.description) || w.wo_number || 'Work order', sub: `${w.property_name || 'Property'} · ${workOrderDone(w) ? 'done' : 'open'}, ${owner}${onRoute.has(id) ? ' · on the route' : ''}`, name: label(w) };
  };
  const totals = fieldDayTotals(rows.map(s => ({ ...s, work_date: date })));
  let sampleOptions = null;
  if (actor.admin) {
    const units = await loadUnits();
    const unitById = new Map(units.map(u => [u.id, u]));
    const byUnit = new Map(units.filter(u => u.unitId).map(u => [u.unitId!, u]));
    const byProperty = new Map<string, Unit>();
    for (const u of units) if (u.propertyId && !byProperty.has(u.propertyId)) byProperty.set(u.propertyId, u);
    const stops = await loadInspectionStops(technician, date, unitById);
    sampleOptions = {
      places: placeRows.filter(p => p.active).map(p => ({ id: p.id, name: p.name, kind: p.kind })),
      workOrders: rankCandidates(ranked.map(r => r.candidate)).slice(0, 150).flatMap(c => {
        const w = workOrders.find(x => x.id === c.work_order_id)!;
        const u = (w.unit_id && byUnit.get(w.unit_id)) || (w.property_id && byProperty.get(w.property_id));
        return u ? [{ id: w.id, label: label(w), unitRowId: u.id }] : [];
      }),
      inspectionStops: stops.map(s => ({ id: s.id, label: s.label, unitRowId: s.unitRowId })),
    };
  }
  return {
    technician, date, source, admin: actor.admin, self: actor.person === technician,
    techs: actor.admin ? FIELD_TECHS : [actor.person],
    sources: visible.map(d => d.source),
    day: day && { id: day.id, source: day.source, version: day.version, built_at: day.built_at, sample_spec: actor.admin ? day.sample_spec : null },
    segments: rows.map(s => ({
      id: s.id, kind: s.kind, started_at: s.started_at, ended_at: s.ended_at, minutes: minutesOf(s), place: s.place_id ? placeName.get(s.place_id) ?? '' : '',
      property_label: s.property_label, inspection_stop_id: s.inspection_stop_id, label: s.label, note: s.note, state: s.state,
      confirmed_by: s.confirmed_by, confirmed_at: s.confirmed_at, needs_input: needsInput(s),
      allocations: s.allocations.map(a => ({ ...a, ...describe(a.work_order_id) })),
      candidates: (s.candidates as Candidate[]).map(c => ({ ...c, ...describe(c.work_order_id) })),
    })),
    summary: totals.get(date) ?? null,
    jobs: rankCandidates(ranked.map(r => r.candidate)).slice(0, 150).map(c => ({ id: c.work_order_id, tier: c.tier, ...describe(c.work_order_id) })),
    sampleOptions,
    // Invoice comparisons are office business: only an admin gets them, never the tech's own view.
    billing: actor.admin ? await dayBilling(date, source, rows, woById) : null,
  };
}

/**
 * "Field time vs billing" for the work orders on one day: each one's confirmed field time (all days, same
 * source) against its live invoices, plus this day's time still waiting for an answer.
 */
async function dayBilling(date: string, source: Source, rows: StoredSegment[], woById: Map<string, CandidateWorkOrder>) {
  const ids = [...new Set(rows.flatMap(s => s.allocations.map(a => a.work_order_id)))];
  if (!ids.length) return [];
  const since = shiftDay(date, -FIELD_CONFIG.lookbackDays);
  const dayIds = new Set((await all<{ id: string }>('field_day', 'id', q => q.eq('source', source).gte('work_date', since))).map(d => d.id));
  const confirmed = (await all<StoredSegment>('field_segment', 'day_id,technician,work_date,kind,started_at,ended_at,allocations,label,state,confirmed_at', q => q.gte('work_date', since).eq('state', 'confirmed'), 'started_at'))
    .filter(r => dayIds.has(r.day_id) && r.allocations.some(a => ids.includes(a.work_order_id)));
  const byWo = fieldTimeByWorkOrder(confirmed);
  const wos = ids.map(id => woById.get(id)).filter((w): w is CandidateWorkOrder => !!w);
  const numbers = wos.map(w => w.wo_number).filter((n): n is string => !!n);
  const [byId, byRef] = await Promise.all([
    all<HdmsInvoice>('hdms_invoices', '*', q => q.in('work_order_id', ids)),
    numbers.length ? all<HdmsInvoice>('hdms_invoices', '*', q => q.in('wo_reference', numbers)) : Promise.resolve([] as HdmsInvoice[]),
  ]);
  const { live, invoiceWo } = linkInvoices([...new Map([...byId, ...byRef].map(i => [i.id, i])).values()], wos);
  const pending = new Map<string, number>();
  for (const s of rows) if (s.state === 'suggested' && (s.kind === 'on_site' || s.kind === 'parts_run'))
    for (const a of s.allocations) pending.set(a.work_order_id, (pending.get(a.work_order_id) || 0) + (minutesOf(s) * a.percent) / 100);
  return ids.map(id => {
    const w = woById.get(id);
    const t = byWo.get(id) ?? { onSiteMin: 0, partsMin: 0, dumpDays: [], days: [], technicians: [], lastConfirmedAt: null };
    const invoices = live.filter(i => invoiceWo.get(i.id) === id);
    const a = assessWorkOrder(t, invoices);
    const anyConfirmed = t.onSiteMin > 0 || t.partsMin > 0 || t.dumpDays.length > 0;
    return {
      work_order_id: id, wo_number: w?.wo_number ?? null, property: w?.property_name ?? 'Work order', title: workOrderTitle(w?.description),
      done: w ? workOrderDone(w) : false, onSite: Math.round(t.onSiteMin), parts: Math.round(t.partsMin), dumpRuns: t.dumpDays.length,
      pending: Math.round(pending.get(id) || 0), expected: a.expectedMin, billedHours: a.billedHours, shortHours: a.shortHours,
      hasDumpCharge: a.hasDumpCharge, verdict: anyConfirmed ? a.verdict : 'waiting',
      invoices: invoices.map(i => ({ id: i.id, code: i.invoice_code })),
    };
  });
}

/** Locations and providers for the Locations page. Business locations, not people: office staff can view them. */
export async function loadLocations(actor: FieldActor) {
  const [places, suppliers] = await Promise.all([
    loadPlaceRows(),
    all<{ id: string; name: string; phone: string | null; email: string | null; account_number: string | null; pro_desk_notes: string; active: boolean; version: number }>('supplier', 'id,name,phone,email,account_number,pro_desk_notes,active,version', undefined, 'name'),
  ]);
  return { admin: actor.admin, office: actor.office, places, suppliers, radiusByKind: RADIUS_BY_KIND };
}

export interface FieldForReview {
  source: Source;
  days: Map<string, Partial<FieldDayTotals>>;
  issues: Issue[];
  noInvoiceNotes: Map<string, string>;
  links: { technician: string; date: string }[];
}
/**
 * Field time for Daily Billing Review. An admin gets every category and the "not fully billed" items. A
 * field reviewer (lib/field-time/access.ts) gets every tech's job and parts minutes and those items, but
 * not drive, inspection or unlabeled time; anyone else gets only their own job and parts minutes. Links go
 * only to field days the person can open. Sample days only when an admin asks for them.
 */
export async function fieldForReview(args: { actor: FieldActor; from: string; to: string; technician: string; sample: boolean; invoices: HdmsInvoice[]; decisions: Decision[]; today: string }): Promise<FieldForReview> {
  const { actor, from, to } = args;
  const source: Source = args.sample && actor.admin ? 'sample' : 'device';
  const reviewer = actor.admin || isFieldReviewer(actor.email);
  const tech = reviewer ? args.technician : actor.person;
  const since = shiftDay(from, -FIELD_CONFIG.lookbackDays);
  const days = await all<DayRow>('field_day', 'id,technician,work_date,source,sample_spec,version,built_at', q => q.eq('source', source).gte('work_date', since));
  const dayIds = new Set(days.map(d => d.id));
  const segments = (await all<StoredSegment>('field_segment', 'day_id,technician,work_date,kind,started_at,ended_at,allocations,label,state,confirmed_at', q => q.gte('work_date', since), 'started_at'))
    .filter(s => dayIds.has(s.day_id));
  const rows: FieldTimeRow[] = segments;
  const inPeriod = rows.filter(r => r.work_date >= from && r.work_date <= to && (!tech || r.technician === tech));
  const totals = fieldDayTotals(inPeriod);
  const shaped = new Map<string, Partial<FieldDayTotals>>();
  for (const [date, t] of totals) shaped.set(date, actor.admin ? t : { date, onSite: t.onSite, parts: t.parts });
  const links = days.filter(d => d.work_date >= from && d.work_date <= to && (!tech || d.technician === tech) && canSeeDay(actor, d.technician, d.source)).map(d => ({ technician: d.technician, date: d.work_date }));
  if (!reviewer) return { source, days: shaped, issues: [], noInvoiceNotes: new Map(), links };
  const woIds = [...new Set(rows.flatMap(r => r.allocations.map(a => a.work_order_id)))];
  const workOrders: BillingWorkOrder[] = [];
  for (let i = 0; i < woIds.length; i += 100) workOrders.push(...(await all<BillingWorkOrder>('work_orders', 'id,wo_number,property_name,completed_date,status,appfolio_status,stage', q => q.in('id', woIds.slice(i, i + 100)))));
  const billingRows = tech ? rows.filter(r => r.technician === tech) : rows;
  const { issues, noInvoiceNotes } = fieldBillingIssues({
    rows: billingRows, from, to, today: args.today, invoices: args.invoices, workOrders, decisions: args.decisions, sample: source === 'sample',
    // The field day where the person can open it; otherwise the invoice.
    hrefFor: (t, d, invoiceId) => canSeeDay(actor, t, source) ? `/maintenance/daily-billing/field?technician=${encodeURIComponent(t)}&date=${d}${source === 'sample' ? '&source=sample' : ''}` : `/maintenance/invoices?tab=invoices&invoice=${invoiceId}`,
  });
  return { source, days: shaped, issues, noInvoiceNotes, links };
}
