import { FIELD_CONFIG, type FieldConfig } from './config';
import type { Piece } from './detect';
import type { StopMatch } from './match';
import type { Allocation, Candidate, Interval, Segment, SegmentKind, SegmentLabel } from './model';

const MIN = 60000;
export type MatchedPiece = Piece & { match?: StopMatch };
type DraftKind = SegmentKind | 'store_stop' | 'dump_stop';
interface Draft extends Interval {
  kind: DraftKind; key: string; place_id: string | null; appfolio_property_id: string | null; appfolio_unit_id: string | null;
  property_label: string; inspection_stop_id: string | null; allocations: Allocation[]; label: SegmentLabel | null; candidates: Candidate[];
}

function draftFor(piece: MatchedPiece): Draft {
  const base = { start: piece.start, end: piece.end, place_id: null, appfolio_property_id: null, appfolio_unit_id: null, property_label: '', inspection_stop_id: null, allocations: [], label: null, candidates: [] };
  if (piece.type !== 'stop') return { ...base, kind: piece.type, key: piece.type };
  const m: StopMatch = piece.match ?? { kind: 'unknown' };
  switch (m.kind) {
    case 'place': {
      const kind: DraftKind = m.place.kind === 'store' ? 'store_stop' : m.place.kind === 'dump' ? 'dump_stop' : m.place.kind === 'shop' ? 'shop' : 'stop';
      return { ...base, kind, key: `place:${m.place.id}`, place_id: m.place.id, property_label: m.place.name };
    }
    case 'job':
      return { ...base, kind: 'on_site', key: `job:${m.propertyId}`, appfolio_property_id: m.propertyId, appfolio_unit_id: m.unitId, property_label: m.label, candidates: m.candidates, allocations: m.suggested ? [{ work_order_id: m.suggested.work_order_id, percent: 100 }] : [] };
    case 'inspection':
      return { ...base, kind: 'inspection', key: `inspection:${m.stop.id}`, appfolio_property_id: m.propertyId, appfolio_unit_id: m.unitId, property_label: m.label, inspection_stop_id: m.stop.id, candidates: m.candidates };
    case 'property':
      return { ...base, kind: 'stop', key: `property:${m.propertyId}`, appfolio_property_id: m.propertyId, appfolio_unit_id: m.unitId, property_label: `${m.label} (no work order)` };
    default:
      return { ...base, kind: 'stop', key: 'unknown', property_label: 'Unknown location' };
  }
}

const isStop = (d: Draft) => d.kind !== 'drive' && d.kind !== 'no_data' && d.kind !== 'break';
const tripKind = (d: Draft | undefined): SegmentKind | null => (d?.kind === 'store_stop' ? 'parts_run' : d?.kind === 'dump_stop' ? 'dump_run' : null);

/** Back-to-back visits to the same place, or split by a short drive (walking between buildings), are one visit. */
function mergeRepeats(drafts: Draft[], cfg: FieldConfig): Draft[] {
  const out: Draft[] = [];
  for (const d of drafts) {
    const prev = out[out.length - 1], before = out[out.length - 2];
    if (isStop(d) && d.key !== 'unknown' && prev?.key === d.key) { prev.end = d.end; continue; }
    if (isStop(d) && d.key !== 'unknown' && prev?.kind === 'drive' && before?.key === d.key && prev.end - prev.start < cfg.mergeGapMin * MIN) {
      out.pop();
      before.end = d.end;
      continue;
    }
    out.push({ ...d });
  }
  return out;
}

/**
 * A parts or dump run is the drive there, the store or dump stop(s), and the drive out. Chained stops
 * of the same kind (Lowe's, then Home Depot) are one run; a change of kind starts a new run, and each
 * drive belongs to the run it leads into.
 */
function groupTrips(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const kind = tripKind(d);
    if (!kind) { out.push(d); continue; }
    const names = [d.property_label];
    let j = i;
    while (drafts[j + 1]?.kind === 'drive' && tripKind(drafts[j + 2]) === kind) { j += 2; names.push(drafts[j].property_label); }
    let start = d.start, end = drafts[j].end;
    if (out[out.length - 1]?.kind === 'drive') start = out.pop()!.start;
    if (drafts[j + 1]?.kind === 'drive' && !tripKind(drafts[j + 2])) { end = drafts[j + 1].end; j += 1; }
    out.push({ ...d, kind, start, end, key: `${kind}:${d.place_id}`, property_label: [...new Set(names)].join(' → ') });
    i = j;
  }
  return out;
}

/** Only A → store → A pre-fills the job (100% to A). Any other run waits for the tech to tick the jobs. */
function suggestTripJobs(drafts: Draft[], tripCandidates: Candidate[]) {
  const job = (d?: Draft) => (d?.kind === 'on_site' && d.allocations.length === 1 ? d.allocations[0].work_order_id : null);
  drafts.forEach((d, i) => {
    if (d.kind !== 'parts_run' && d.kind !== 'dump_run') return;
    d.candidates = tripCandidates;
    const prev = drafts.slice(0, i).reverse().find(isStop), next = drafts.slice(i + 1).find(isStop);
    const a = job(prev);
    if (a && a === job(next)) d.allocations = [{ work_order_id: a, percent: 100 }];
  });
}

/** Remove `cut` from the drafts, keeping leftover pieces at least `keepMs` long. */
function carve(drafts: Draft[], cut: Interval, keepMs: number): Draft[] {
  const out: Draft[] = [];
  for (const d of drafts) {
    if (d.end <= cut.start || d.start >= cut.end) { out.push(d); continue; }
    if (d.start < cut.start && cut.start - d.start >= keepMs) out.push({ ...d, end: cut.start });
    if (d.end > cut.end && d.end - cut.end >= keepMs) out.push({ ...d, start: cut.end });
  }
  return out;
}

export interface TimelineOptions { window: Interval; breaks?: Interval[]; confirmed?: Interval[]; tripCandidates?: Candidate[]; cfg?: FieldConfig }

/**
 * Suggested segments for one window. Timed breaks become `break` segments; time already confirmed is
 * left alone (suggestions are trimmed around it and slivers dropped), so a rebuild never overrides the tech.
 */
export function buildTimeline(pieces: MatchedPiece[], opts: TimelineOptions): Segment[] {
  const cfg = opts.cfg ?? FIELD_CONFIG;
  let drafts = groupTrips(mergeRepeats(pieces.map(draftFor), cfg));
  suggestTripJobs(drafts, opts.tripCandidates ?? []);
  for (const b of opts.breaks ?? []) {
    const cut = { start: Math.max(b.start, opts.window.start), end: Math.min(b.end, opts.window.end) };
    if (cut.end - cut.start < MIN) continue;
    drafts = carve(drafts, cut, MIN);
    drafts.push({ ...cut, kind: 'break', key: 'break', place_id: null, appfolio_property_id: null, appfolio_unit_id: null, property_label: '', inspection_stop_id: null, allocations: [], label: null, candidates: [] });
  }
  for (const c of opts.confirmed ?? []) drafts = carve(drafts, c, cfg.trimLeftoverMin * MIN);
  return drafts
    .filter(d => d.end - d.start >= 1000)
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, key: _key, ...d }) => ({ ...d, kind: d.kind as SegmentKind, started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString() }));
}
