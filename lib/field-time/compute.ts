import { FIELD_CONFIG, type FieldConfig } from './config';
import { detectPieces } from './detect';
import { candidateWorkOrders, matchStop, type StopMatch } from './match';
import type { Candidate, CandidateWorkOrder, InspectionStop, Interval, Place, Point, Segment, Stop, Unit } from './model';
import { buildTimeline, type MatchedPiece } from './timeline';

export interface DayInput {
  technician: string;
  date: string;
  /** Clocked-in time (device days) or the typed window (sample days). */
  windows: Interval[];
  points: Point[];
  places: Place[];
  units: Unit[];
  /** In-house work orders around the date; candidateWorkOrders narrows them. */
  workOrders: CandidateWorkOrder[];
  inspectionStops: InspectionStop[];
  breaks?: Interval[];
  /** Time already confirmed; suggestions are trimmed around it. */
  confirmed?: Interval[];
  cfg?: FieldConfig;
}
export interface DayResult { segments: Segment[]; stops: { stop: Stop; match: StopMatch }[] }

/** The one function the field day hangs on: location fixes → stops → matches → suggested timeline. */
export function computeDay(input: DayInput): DayResult {
  const cfg = input.cfg ?? FIELD_CONFIG;
  const places = input.places.filter(p => p.active);
  const ranked = candidateWorkOrders(input.workOrders, input.technician, input.date, cfg);
  const byProperty = new Map<string, Candidate[]>();
  for (const r of ranked) if (r.propertyId) byProperty.set(r.propertyId, [...(byProperty.get(r.propertyId) || []), r.candidate]);
  const ctx = { places, units: input.units, candidates: byProperty, inspectionStops: input.inspectionStops, cfg };
  // Runs can be for any of the tech's open jobs: an end-of-day run is usually for tomorrow.
  const openMine = ranked.filter(r => r.open && r.candidate.tier === 1).map(r => r.candidate);
  const stops: DayResult['stops'] = [];
  const segments: Segment[] = [];
  for (const window of [...input.windows].sort((a, b) => a.start - b.start)) {
    const pieces: MatchedPiece[] = detectPieces(input.points, window, places, cfg).map(p => {
      if (p.type !== 'stop') return p;
      const match = matchStop(p.stop, ctx);
      stops.push({ stop: p.stop, match });
      return { ...p, match };
    });
    const dayJobs = pieces.flatMap(p => (p.type === 'stop' && p.match?.kind === 'job' ? p.match.candidates.map(c => ({ ...c, today: true })) : []));
    const seen = new Set<string>();
    const tripCandidates = [...dayJobs, ...openMine].filter(c => !seen.has(c.work_order_id) && !!seen.add(c.work_order_id)).slice(0, 25);
    segments.push(...buildTimeline(pieces, { window, breaks: input.breaks, confirmed: input.confirmed, tripCandidates, cfg }));
  }
  return { segments, stops };
}
