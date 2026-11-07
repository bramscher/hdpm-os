// Field time: where a tech's paid day went, built from location evidence.
// Step 1 builds days from hand-entered samples; step 2's iPhone app supplies real points.

export type PlaceKind = 'store' | 'dump' | 'shop' | 'other';
/** A named stop location that isn't an AppFolio property (field_place). */
export interface Place { id: string; kind: PlaceKind; name: string; supplierId: string | null; lat: number; lng: number; radiusM: number; active: boolean }
/** One inspection_properties row (an AppFolio unit) with coordinates. */
export interface Unit { id: string; propertyId: string | null; unitId: string | null; name: string; address: string; lat: number; lng: number; active: boolean }
/** An in-house work order that could be the job at a stop. */
export interface CandidateWorkOrder {
  id: string; wo_number: string | null; property_id: string | null; unit_id: string | null; property_name: string | null;
  assigned_to: string | null; assigned_tech: string | null; status: string | null; stage: string | null; appfolio_status: string | null;
  created_at: string | null; completed_date: string | null; scheduled_start: string | null; canceled_date: string | null;
  description?: string | null;
}
/** A stop on the tech's inspection route for the day (route_stops), resolved to its unit row. */
export interface InspectionStop { id: string; unitRowId: string; propertyId: string | null; unitId: string | null; label: string; status: string }

/** A location fix. `t` is epoch milliseconds; `acc` is horizontal accuracy in metres. */
export interface Point { t: number; lat: number; lng: number; acc?: number | null }
export interface Interval { start: number; end: number }
/** A place the tech stayed, detected from fixes. */
export interface Stop extends Interval { lat: number; lng: number; count: number }

export type SegmentKind = 'on_site' | 'inspection' | 'parts_run' | 'dump_run' | 'shop' | 'drive' | 'stop' | 'no_data' | 'break';
export type SegmentLabel = 'general' | 'personal' | 'estimate' | 'other_work' | 'phone_off';
export const SEGMENT_KINDS: SegmentKind[] = ['on_site', 'inspection', 'parts_run', 'dump_run', 'shop', 'drive', 'stop', 'no_data', 'break'];
export const SEGMENT_LABELS: SegmentLabel[] = ['general', 'personal', 'estimate', 'other_work', 'phone_off'];
export interface Allocation { work_order_id: string; percent: number }
/**
 * A work order offered for a segment. tier 1 = assigned to this tech, 2 = unassigned, 3 = other tech.
 * `onRoute`: on the tech's published route for the day (the office's schedule), present only when true.
 */
export interface Candidate { work_order_id: string; wo_number: string | null; property_name: string | null; tier: number; today: boolean; onRoute?: boolean }

/** A timeline segment as the builder produces it (always a suggestion). Never carries coordinates. */
export interface Segment {
  kind: SegmentKind; started_at: string; ended_at: string;
  place_id: string | null; appfolio_property_id: string | null; appfolio_unit_id: string | null; property_label: string;
  inspection_stop_id: string | null; allocations: Allocation[]; label: SegmentLabel | null; candidates: Candidate[];
}
/** A segment as stored in field_segment. */
export interface StoredSegment extends Segment {
  id: string; day_id: string; technician: string; work_date: string; state: 'suggested' | 'confirmed';
  note: string; suggestion: unknown; confirmed_by: string | null; confirmed_at: string | null;
  /** Added by hand (forgot the phone): confirmed recollection, not GPS evidence. */
  manual?: boolean;
}

/**
 * A work order's task in a few words, for answer buttons: the first real line of its AppFolio description.
 * "Owner Expense - " / "Tenant Expense - " prefixes and a bare "Unit Turn Maintenance" line are skipped.
 * Longer than `max` characters, it is cut at a word and ends with "…".
 */
export function workOrderTitle(description: string | null | undefined, max = 48): string {
  const lines = (description || '').split(/\r?\n/).map(l => l.replace(/^(owner|tenant)\s+expense\s*[-–:]\s*/i, '').trim()).filter(Boolean);
  const line = lines.find(l => !/^unit turn maintenance$/i.test(l)) || lines[0] || '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1), space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,;:(-]+$/, '')}…`;
}

export const minutesOf = (s: { started_at: string; ended_at: string }) => Math.max(0, Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000));
/** True when a segment still needs the tech or office to say what it was. */
export function needsInput(s: Pick<Segment, 'kind' | 'allocations' | 'label'>): boolean {
  if (s.kind === 'on_site') return !s.allocations.length;
  if (s.kind === 'parts_run' || s.kind === 'dump_run') return !s.allocations.length && s.label !== 'general';
  if (s.kind === 'stop' || s.kind === 'no_data') return !s.label;
  return false;
}
