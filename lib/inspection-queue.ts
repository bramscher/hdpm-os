import { inspectionToday, shiftInspectionDate, INSPECTION_HORIZON_DAYS } from './inspection-window';
export { inspectionToday, shiftInspectionDate } from './inspection-window';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findHouseholdSource, type HouseholdProperty } from '@/lib/inspection-route-households';

export interface QueueProperty extends HouseholdProperty {
  active?: boolean | null;
  routine_inspections_enabled?: boolean | null;
  last_inspection_date?: string | null;
  next_due_date?: string | null;
  candidate_status?: string | null;
  local_skip_reason?: string | null;
  move_in_date?: string | null;
}
export interface QueueInspection {
  id: string;
  property_id: string;
  status: string;
  inspection_type: string | null;
  due_date: string | null;
  target_date: string | null;
  assigned_to: string | null;
  resident_name: string | null;
  completed_at?: string | null;
  route_plan_id?: string | null;
  inspection_properties: QueueProperty | null;
  stored_status?: string;
  scheduled_route_id?: string | null;
  route_stops?: { status?: string; actual_arrival?: string | null; route_plans: { id?: string; route_date: string; status: string } | null }[];
}

export function routineInspectionsEnabled(row: QueueInspection, properties: QueueProperty[]): boolean {
  const source = row.inspection_properties ? findHouseholdSource(row.inspection_properties, properties, row.resident_name) as QueueProperty | null : null;
  return row.inspection_properties?.routine_inspections_enabled !== false && source?.routine_inspections_enabled !== false;
}

export function inspectionExcluded(row: QueueInspection, properties: QueueProperty[]): boolean {
  const source = row.inspection_properties ? findHouseholdSource(row.inspection_properties, properties, row.resident_name) as QueueProperty | null : null;
  return row.inspection_properties?.active === false || source?.active === false ||
    (['routine', 'biannual'].includes(row.inspection_type || '') && !routineInspectionsEnabled(row, properties));
}

/** Status is derived from the appointment and actual work, never an import label. */
export function inspectionWorkflow(row: QueueInspection, today: string): QueueInspection {
  if (['canceled', 'cancelled', 'skipped'].includes(row.status)) return row;
  const completedDate = row.completed_at ? inspectionToday(new Date(row.completed_at)) : null;
  const stops = (row.route_stops || []).filter(stop => stop.route_plans?.route_date
    && !['completed', 'canceled', 'cancelled'].includes(stop.route_plans.status)
    && !['completed', 'skipped'].includes(stop.status || '')
    // A reused record may contain an earlier completion. Only an explicitly
    // unfinished appointment after that completion represents new work.
    && (row.status !== 'completed' || (completedDate
      && stop.route_plans.route_date >= today && stop.route_plans.route_date > completedDate
      && ['pending', 'in_progress'].includes(stop.status || ''))));
  if (row.status === 'completed' && !stops.length) return row;
  const stop = stops.find(s => s.route_plans!.id === row.route_plan_id)
    || stops.sort((a, b) => b.route_plans!.route_date.localeCompare(a.route_plans!.route_date))[0];
  const route = stop?.route_plans;
  const workingToday = route?.route_date === today && stop?.status === 'in_progress'
    && !!stop.actual_arrival && inspectionToday(new Date(stop.actual_arrival)) === today;
  return { ...row, stored_status: row.stored_status || row.status,
    status: workingToday ? 'in_progress' : route ? (route.route_date < today ? 'needs_review' : 'scheduled') : 'queued',
    target_date: route?.route_date || null, scheduled_route_id: route?.id || null };
}

/** A read-only operational view: historical records remain available unchanged. */
export function actionableInspections(rows: QueueInspection[], properties: QueueProperty[], today: string, horizonDays = INSPECTION_HORIZON_DAYS): QueueInspection[] {
  const horizon = shiftInspectionDate(today, horizonDays);
  const prepared = rows.map(row => inspectionWorkflow(row, today)).flatMap(row => {
    if (['completed', 'canceled', 'cancelled', 'skipped'].includes(row.status)) return [];
    const source = row.inspection_properties
      ? findHouseholdSource(row.inspection_properties, properties, row.resident_name) as QueueProperty | null
      : null;
    if (inspectionExcluded(row, properties)) return [];
    const routine = ['routine', 'biannual'].includes(row.inspection_type || '');
    const target = row.target_date;
    const scheduled = ['scheduled', 'in_progress', 'needs_review'].includes(row.status);
    // A later completed visit supersedes an old missed appointment, but never
    // hide a future appointment or an inspection currently being performed.
    if (routine && scheduled && row.status !== 'in_progress' && target && target < today && source?.last_inspection_date && source.last_inspection_date >= target) return [];
    if (!scheduled && routine && (source?.candidate_status === 'dismissed' || source?.local_skip_reason === 'Vacant — no active tenant')) return [];
    let due = row.due_date;
    if (!scheduled && routine && source?.next_due_date && (!due || source.next_due_date > due)) due = source.next_due_date;
    if (!scheduled && due && due > horizon) return [];
    const property = source ? { ...row.inspection_properties, last_inspection_date: source.last_inspection_date, move_in_date: source.move_in_date } : row.inspection_properties;
    return [{ row: { ...row, due_date: due, target_date: target, inspection_properties: property }, scheduled, routine, key: source?.appfolio_unit_id || row.property_id }];
  });
  // Keep all real appointments; show only one unscheduled routine task per unit.
  const scheduledUnits = new Map<string, string>();
  for (const p of prepared.filter(p => p.scheduled && p.routine)) {
    const date = p.row.target_date || p.row.due_date || today;
    if (date > (scheduledUnits.get(p.key) || '')) scheduledUnits.set(p.key, date);
  }
  const seen = new Set<string>();
  return prepared.sort((a, b) => (a.row.due_date || '9999').localeCompare(b.row.due_date || '9999') || a.row.id.localeCompare(b.row.id)).filter(p => {
    if (p.scheduled || !p.routine) return true;
    const appointment = scheduledUnits.get(p.key);
    const cycle = `${p.key}|${p.row.due_date || ''}`;
    if ((appointment && (!p.row.due_date || p.row.due_date <= appointment)) || seen.has(cycle)) return false;
    seen.add(cycle);
    return true;
  }).map(p => p.row);
}

export async function loadInspectionQueue(supabase: SupabaseClient): Promise<{ rows: QueueInspection[]; properties: QueueProperty[] }> {
  const [rows, properties] = await Promise.all([
    (async () => {
      const all: QueueInspection[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('inspections').select('*,inspection_properties(*),route_stops(status,actual_arrival,route_plans(id,route_date,status))').order('id').range(from, from + 999);
        if (error) throw new Error(error.message);
        all.push(...(data || []));
        if ((data || []).length < 1000) return all;
      }
    })(),
    (async () => {
      const all: QueueProperty[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('inspection_properties').select('id,active,routine_inspections_enabled,name,address_1,address_2,city,zip,appfolio_unit_id,resident_name,financially_responsible_occupants,last_inspection_date,next_due_date,candidate_status,local_skip_reason,move_in_date').not('appfolio_unit_id', 'is', null).order('id').range(from, from + 999);
        if (error) throw new Error(error.message);
        all.push(...(data || []));
        if ((data || []).length < 1000) return all;
      }
    })(),
  ]);
  return { rows, properties };
}
