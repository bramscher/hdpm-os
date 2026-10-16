import { normalizeTechnician } from '@/lib/invoices';
import { shiftDay } from '@/lib/maintenance-workspace/model';
import { localDate } from '@/lib/timekeeping/model';
import { FIELD_CONFIG, type FieldConfig } from './config';
import { distanceM } from './detect';
import type { Candidate, CandidateWorkOrder, InspectionStop, Place, Unit } from './model';

type Status = Pick<CandidateWorkOrder, 'completed_date' | 'status' | 'appfolio_status' | 'stage'>;
/** Same "done" rule Daily Billing Review uses for completed work. */
export function workOrderDone(w: Status): boolean {
  return !!w.completed_date || w.status === 'done' || ['completed', 'complete', 'work completed', 'closed'].includes((w.appfolio_status || '').toLowerCase()) || ['VERIFY', 'CLOSED'].includes(w.stage || '');
}
const canceled = (w: CandidateWorkOrder) => !!w.canceled_date || /cancel/i.test(w.appfolio_status || '');
const pacific = (iso: string | null) => (iso ? localDate(new Date(iso)) : null);
export const assigneeOf = (w: Pick<CandidateWorkOrder, 'assigned_tech' | 'assigned_to'>) => normalizeTechnician(w.assigned_tech) || normalizeTechnician(w.assigned_to) || '';

export interface RankedWorkOrder { candidate: Candidate; propertyId: string | null; open: boolean }
/**
 * Work orders that could be the job on `date`: in-house (the caller filters), not canceled, created by
 * that day, and either still open or completed shortly before or after it. Tier 1 is assigned to this
 * tech, 2 unassigned, 3 the other tech; work scheduled, created or completed that day is marked `today`.
 */
export function candidateWorkOrders(workOrders: CandidateWorkOrder[], technician: string, date: string, cfg: FieldConfig = FIELD_CONFIG): RankedWorkOrder[] {
  const lo = shiftDay(date, -cfg.candidateDaysBefore), hi = shiftDay(date, cfg.candidateDaysAfter);
  return workOrders
    .filter(w => !canceled(w) && (!w.created_at || pacific(w.created_at)! <= date))
    .filter(w => (w.completed_date ? w.completed_date.slice(0, 10) >= lo && w.completed_date.slice(0, 10) <= hi : !workOrderDone(w)))
    .map(w => {
      const who = assigneeOf(w);
      const today = w.completed_date?.slice(0, 10) === date || pacific(w.scheduled_start) === date || pacific(w.created_at) === date;
      return {
        candidate: { work_order_id: w.id, wo_number: w.wo_number, property_name: w.property_name, tier: who === technician ? 1 : who ? 3 : 2, today },
        propertyId: w.property_id,
        open: !workOrderDone(w),
      };
    });
}

export const rankCandidates = (list: Candidate[]) =>
  [...list].sort((a, b) => a.tier - b.tier || Number(b.today) - Number(a.today) || (a.wo_number || '').localeCompare(b.wo_number || ''));

/**
 * The one candidate clearly ahead of the rest, or null when the tech has to pick. Two of the tech's own
 * jobs at one property is common (two invoices the same day), so `today` only orders the list: guessing
 * between them would bill the wrong owner without anyone noticing.
 */
export function suggestCandidate(list: Candidate[]): Candidate | null {
  if (!list.length) return null;
  const best = Math.min(...list.map(c => c.tier));
  const top = list.filter(c => c.tier === best);
  return top.length === 1 ? top[0] : null;
}

export interface MatchContext {
  places: Place[];
  units: Unit[];
  /** Candidate work orders keyed by AppFolio property id. */
  candidates: Map<string, Candidate[]>;
  inspectionStops: InspectionStop[];
  cfg?: FieldConfig;
}
export type StopMatch =
  | { kind: 'place'; place: Place }
  | { kind: 'job'; propertyId: string; unitId: string | null; label: string; candidates: Candidate[]; suggested: Candidate | null }
  | { kind: 'inspection'; stop: InspectionStop; propertyId: string | null; unitId: string | null; label: string; candidates: Candidate[] }
  | { kind: 'property'; propertyId: string | null; unitId: string | null; label: string }
  | { kind: 'unknown' };

const unitLabel = (u: Unit) => u.name || u.address;

/**
 * What a stop was, in priority order: a known location (store, dump, shop) within its radius; a property
 * with candidate work orders (normal radius, then the rural one); the tech's inspection stop for the day;
 * any other property ("visit, no work order"); otherwise unknown. Starting from work orders rather than
 * the nearest property keeps a neighbouring duplex from winning.
 */
export function matchStop(stop: { lat: number; lng: number }, ctx: MatchContext): StopMatch {
  const cfg = ctx.cfg ?? FIELD_CONFIG;
  const place = ctx.places
    .filter(p => p.active)
    .map(p => ({ p, d: distanceM(p, stop) }))
    .filter(x => x.d <= x.p.radiusM)
    .sort((a, b) => a.d - b.d)[0];
  if (place) return { kind: 'place', place: place.p };
  const near = ctx.units
    .map(u => ({ u, d: distanceM(u, stop) }))
    .filter(x => x.d <= cfg.ruralRadiusM)
    .sort((a, b) => a.d - b.d);
  const withWork = (limit: number) => near.filter(x => x.u.active && x.d <= limit && !!x.u.propertyId && ctx.candidates.has(x.u.propertyId));
  const work = withWork(cfg.propertyRadiusM).length ? withWork(cfg.propertyRadiusM) : withWork(cfg.ruralRadiusM);
  const inspection = ctx.inspectionStops
    .map(s => ({ s, x: near.find(n => n.u.id === s.unitRowId) }))
    .filter(v => v.x && v.x.d <= cfg.propertyRadiusM)
    .sort((a, b) => a.x!.d - b.x!.d)[0];
  if (work.length) {
    const nearest = work[0];
    const propertyIds = [...new Set(work.filter(x => x.d <= nearest.d + cfg.ambiguityM).map(x => x.u.propertyId!))];
    const candidates = rankCandidates(propertyIds.flatMap(id => ctx.candidates.get(id) || []));
    const suggested = suggestCandidate(candidates);
    // On an inspection route, a work order wins only when it's this tech's own.
    if (inspection && suggested?.tier !== 1) return { kind: 'inspection', stop: inspection.s, propertyId: inspection.s.propertyId, unitId: inspection.s.unitId, label: inspection.s.label, candidates };
    return { kind: 'job', propertyId: nearest.u.propertyId!, unitId: nearest.u.unitId, label: unitLabel(nearest.u), candidates, suggested };
  }
  if (inspection) return { kind: 'inspection', stop: inspection.s, propertyId: inspection.s.propertyId, unitId: inspection.s.unitId, label: inspection.s.label, candidates: [] };
  const visited = near.find(x => x.u.active && x.d <= cfg.propertyRadiusM);
  if (visited) return { kind: 'property', propertyId: visited.u.propertyId, unitId: visited.u.unitId, label: unitLabel(visited.u) };
  return { kind: 'unknown' };
}
