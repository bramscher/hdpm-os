import { cleanPoints, detectStops, distanceM } from './detect';
import { FIELD_CONFIG, type FieldConfig } from './config';
import type { Interval, Place, Point } from './model';
import { wallTime } from '@/lib/timekeeping/model';

const MIN = 60000;

/**
 * The parts of a day the field day covers, from the phone's own points (Craig, 2026-10-30: company
 * phones record whenever they're on; no clock-in). The phone is off duty during a long stop
 * (`anchorStopMin`) at a base: the shop, or where it starts or ends the day (home with the on-call
 * phone). A long stop anywhere else, like two hours at a property on a callout, is work.
 *
 * - Weekdays: core hours (8:00–4:30) stretched to the trip that runs into them, so an early start or
 *   overtime counts until the phone settles at a long stop.
 * - Any other time: each trip away from a long stop (the drive, the job, the drive back) is its own
 *   window, so an after-hours call shows up without anyone pressing a button.
 */
export function collectionWindows(points: Point[], day: Interval, coreHours: Interval | null, places: Place[] = [], cfg: FieldConfig = FIELD_CONFIG): Interval[] {
  const inDay = cleanPoints(points.filter(p => p.t >= day.start && p.t < day.end), cfg);
  if (!inDay.length) return coreHours ? [coreHours] : [];
  const first = inDay[0].t, last = inDay[inDay.length - 1].t;
  const bases = [inDay[0], inDay[inDay.length - 1], ...places.filter(p => p.active && p.kind === 'shop')];
  const anchors = detectStops(inDay, places, cfg)
    // A stop that opens or closes the day is cut short by midnight, so it counts at any length.
    .filter(s => (s.end - s.start >= cfg.anchorStopMin * MIN || s.start === first || s.end === last) && bases.some(b => distanceM(b, s) <= cfg.stationaryGapM));
  // Away = time not at a long stop, from the first fix to the last.
  const away: Interval[] = [];
  let cursor = first;
  for (const a of anchors) {
    if (a.start > cursor) away.push({ start: cursor, end: a.start });
    cursor = Math.max(cursor, a.end);
  }
  if (last > cursor) away.push({ start: cursor, end: last });
  const windows = [...(coreHours ? [coreHours] : []), ...away.filter(w => w.end - w.start >= cfg.minTripMin * MIN)];
  return mergeIntervals(windows);
}

/** Overlapping or touching intervals become one, sorted. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const i of [...list].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    if (prev && i.start <= prev.end) prev.end = Math.max(prev.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** True when a moment falls outside weekday core hours: the review flags these as after-hours. */
export const afterHours = (t: number, coreHours: Interval | null) => !coreHours || t < coreHours.start || t >= coreHours.end;

/** Weekday core hours for a Pacific date, or null on a weekend. */
export function coreHoursFor(date: string, cfg: FieldConfig = FIELD_CONFIG): Interval | null {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!cfg.coreDays.includes(weekday)) return null;
  return { start: Date.parse(wallTime(date, cfg.coreStart)), end: Date.parse(wallTime(date, cfg.coreEnd)) };
}
