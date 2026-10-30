import { describe, expect, it } from 'vitest';
import { wallTime } from '@/lib/timekeeping/model';
import { pacificDayBounds } from '@/lib/field-app/model';
import type { Point } from '../model';
import { afterHours, collectionWindows, coreHoursFor, mergeIntervals } from '../windows';

// Made-up spots around Redmond, OR, ~3 km apart.
const SHOP = { lat: 44.2726, lng: -121.1739 };
const HOME = { lat: 44.2990, lng: -121.1500 };
const JOB = { lat: 44.2500, lng: -121.2000 };
const at = (date: string, hm: string) => Date.parse(wallTime(date, hm));
/** A fix every 2 minutes at a spot from..to (inclusive). */
function stay(date: string, from: string, to: string, spot: { lat: number; lng: number }): Point[] {
  const out: Point[] = [];
  for (let t = at(date, from); t <= at(date, to); t += 120_000) out.push({ t, lat: spot.lat, lng: spot.lng, acc: 10 });
  return out;
}
/** A straight-line drive with a fix each minute. */
function drive(date: string, from: string, to: string, a: { lat: number; lng: number }, b: { lat: number; lng: number }): Point[] {
  const t0 = at(date, from), t1 = at(date, to), n = Math.max(1, Math.round((t1 - t0) / 60_000));
  return Array.from({ length: n - 1 }, (_, i) => {
    const f = (i + 1) / n;
    return { t: t0 + (t1 - t0) * f, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, acc: 10 };
  });
}
const WED = '2026-10-28', SAT = '2026-10-31';
const fmt = (w: { start: number; end: number }) => [w.start, w.end].map(t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })).join('–');

describe('core hours', () => {
  it('is 8:00–4:30 on weekdays and nothing on weekends', () => {
    expect(coreHoursFor(WED)).toEqual({ start: at(WED, '08:00'), end: at(WED, '16:30') });
    expect(coreHoursFor(SAT)).toBeNull();
    expect(afterHours(at(WED, '17:00'), coreHoursFor(WED))).toBe(true);
    expect(afterHours(at(WED, '12:00'), coreHoursFor(WED))).toBe(false);
    expect(afterHours(at(SAT, '12:00'), null)).toBe(true);
  });
});

describe('collection windows', () => {
  const day = (d: string) => pacificDayBounds(d);

  it('covers core hours with no points (a forgotten phone still has a day to fill in by hand)', () => {
    expect(collectionWindows([], day(WED), coreHoursFor(WED))).toEqual([coreHoursFor(WED)]);
    expect(collectionWindows([], day(SAT), null)).toEqual([]);
  });

  it('stretches core hours for an early start and overtime, ending when the phone settles at the shop', () => {
    const pts = [
      ...stay(WED, '00:00', '07:10', SHOP), ...drive(WED, '07:10', '07:25', SHOP, JOB),
      ...stay(WED, '07:25', '16:40', JOB), ...drive(WED, '16:40', '16:55', JOB, SHOP),
      ...stay(WED, '16:55', '23:58', SHOP),
    ];
    expect(collectionWindows(pts, day(WED), coreHoursFor(WED)).map(fmt)).toEqual(['7:10 AM–4:55 PM']);
  });

  it('adds an after-hours callout from home as its own window, including a long stay on site', () => {
    const pts = [
      ...stay(WED, '00:00', '07:40', SHOP), ...drive(WED, '07:40', '07:55', SHOP, JOB),
      ...stay(WED, '07:55', '16:20', JOB), ...drive(WED, '16:20', '16:35', JOB, HOME),
      ...stay(WED, '16:35', '21:30', HOME), ...drive(WED, '21:30', '21:45', HOME, JOB),
      ...stay(WED, '21:45', '23:30', JOB), ...drive(WED, '23:30', '23:45', JOB, HOME),
      ...stay(WED, '23:45', '23:59', HOME),
    ];
    const w = collectionWindows(pts, day(WED), coreHoursFor(WED)).map(fmt);
    expect(w[0]).toBe('7:40 AM–4:35 PM');
    expect(w[1]).toMatch(/^9:(29|30) PM–11:4\d PM$/);
    expect(w).toHaveLength(2);
  });

  it('records a weekend call and nothing else on a quiet weekend', () => {
    const quiet = stay(SAT, '00:00', '23:58', HOME);
    expect(collectionWindows(quiet, day(SAT), null)).toEqual([]);
    const call = [...stay(SAT, '00:00', '10:00', HOME), ...drive(SAT, '10:00', '10:15', HOME, JOB), ...stay(SAT, '10:15', '11:30', JOB), ...drive(SAT, '11:30', '11:45', JOB, HOME), ...stay(SAT, '11:45', '23:58', HOME)];
    expect(collectionWindows(call, day(SAT), null).map(fmt)).toEqual(['10:00 AM–11:45 AM']);
  });

  it('works with sparse after-hours fixes (light mode: arrivals and departures only)', () => {
    const sparse: Point[] = [
      ...stay(SAT, '00:00', '00:10', HOME), { t: at(SAT, '09:59'), ...HOME, acc: 20 },
      { t: at(SAT, '10:05'), lat: (HOME.lat + JOB.lat) / 2, lng: (HOME.lng + JOB.lng) / 2, acc: 50 },
      { t: at(SAT, '10:14'), ...JOB, acc: 20 }, { t: at(SAT, '11:31'), ...JOB, acc: 20 },
      { t: at(SAT, '11:44'), ...HOME, acc: 20 }, { t: at(SAT, '23:50'), ...HOME, acc: 20 },
    ];
    const w = collectionWindows(sparse, day(SAT), null);
    expect(w).toHaveLength(1);
    expect(w[0].start).toBeLessThanOrEqual(at(SAT, '10:05'));
    expect(w[0].end).toBeGreaterThanOrEqual(at(SAT, '11:31'));
  });

  it('merges overlapping intervals', () => {
    expect(mergeIntervals([{ start: 5, end: 9 }, { start: 1, end: 3 }, { start: 3, end: 6 }])).toEqual([{ start: 1, end: 9 }]);
  });
});
