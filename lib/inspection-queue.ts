import type { SupabaseClient } from '@supabase/supabase-js';
import { findHouseholdSource, type HouseholdProperty } from '@/lib/inspection-route-households';

export interface QueueProperty extends HouseholdProperty {
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
  route_stops?: { route_plans: { id?: string; route_date: string; status: string } | null }[];
}

export function inspectionToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
export function shiftInspectionDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** A read-only operational view: historical records remain available unchanged. */
export function actionableInspections(rows: QueueInspection[], properties: QueueProperty[], today: string, horizonDays = 45): QueueInspection[] {
  const horizon = shiftInspectionDate(today, horizonDays);
  const prepared = rows.flatMap(row => {
    if (['completed', 'canceled', 'cancelled', 'skipped'].includes(row.status)) return [];
    const source = row.inspection_properties
      ? findHouseholdSource(row.inspection_properties, properties, row.resident_name) as QueueProperty | null
      : null;
    const routine = ['routine', 'biannual'].includes(row.inspection_type || '');
    const routes = (row.route_stops || []).map(s => s.route_plans).filter(r => r && !['completed', 'canceled', 'cancelled'].includes(r.status));
    const linkedRoute = routes.find(r => r!.id === row.route_plan_id);
    const target = linkedRoute?.route_date || routes.map(r => r!.route_date).sort().at(-1) || row.target_date || null;
    const scheduled = ['scheduled', 'planned', 'dispatched', 'in_progress'].includes(row.status) || routes.length > 0;
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
        const { data, error } = await supabase.from('inspections').select('*,inspection_properties(*),route_stops(route_plans(id,route_date,status))').order('id').range(from, from + 999);
        if (error) throw new Error(error.message);
        all.push(...(data || []));
        if ((data || []).length < 1000) return all;
      }
    })(),
    (async () => {
      const all: QueueProperty[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('inspection_properties').select('id,name,address_1,address_2,city,zip,appfolio_unit_id,resident_name,financially_responsible_occupants,last_inspection_date,next_due_date,candidate_status,local_skip_reason,move_in_date').not('appfolio_unit_id', 'is', null).order('id').range(from, from + 999);
        if (error) throw new Error(error.message);
        all.push(...(data || []));
        if ((data || []).length < 1000) return all;
      }
    })(),
  ]);
  return { rows, properties };
}
