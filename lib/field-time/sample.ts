import { wallTime } from '@/lib/timekeeping/model';
import type { Interval, Point } from './model';

/** Where a sample stop was: a saved location, a property unit row (work order or inspection stop), or a typed point. */
export type SamplePlace = { type: 'place'; id: string } | { type: 'unit'; id: string } | { type: 'point'; lat: number; lng: number };
export interface SampleStop { arrive: string; depart: string; place: SamplePlace }
/** A hand-entered day: Pacific wall times (HH:MM) for the window, the stops, breaks and phone-off stretches. */
export interface SampleSpec { start: string; end: string; stops: SampleStop[]; breaks?: { start: string; end: string }[]; phoneOff?: { start: string; end: string }[] }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Ids are resolved against loaded rows when points are generated; this only keeps junk out of the spec.
const ID = /^[\w-]{1,64}$/;
const time = (value: unknown, what: string) => {
  if (typeof value !== 'string' || !HHMM.test(value)) throw new Error(`${what}: enter a time like 08:30`);
  return value;
};
const ranges = (list: unknown, what: string, start: string, end: string) =>
  (Array.isArray(list) ? list : []).slice(0, 10).map((r, i) => {
    const s = time(r?.start, `${what} ${i + 1} start`), e = time(r?.end, `${what} ${i + 1} end`);
    if (s >= e || s < start || e > end) throw new Error(`${what} ${i + 1} must fall inside the day`);
    return { start: s, end: e };
  });

/** Parse a sample day from the editor, rejecting anything the pipeline can't use. */
export function validateSampleSpec(value: unknown): SampleSpec {
  const v = value as Partial<SampleSpec> | null;
  const start = time(v?.start, 'Day start'), end = time(v?.end, 'Day end');
  if (start >= end) throw new Error('The day must end after it starts');
  if (!Array.isArray(v?.stops) || !v.stops.length) throw new Error('Add at least one stop');
  if (v.stops.length > 40) throw new Error('A sample day can have at most 40 stops');
  let last = start;
  const stops = v.stops.map((s, i) => {
    const arrive = time(s?.arrive, `Stop ${i + 1} arrival`), depart = time(s?.depart, `Stop ${i + 1} departure`);
    if (arrive >= depart) throw new Error(`Stop ${i + 1}: leave after you arrive`);
    if (arrive < last || depart > end) throw new Error(`Stop ${i + 1} overlaps the previous stop or falls outside the day`);
    last = depart;
    const p = s?.place as SamplePlace | undefined;
    let place: SamplePlace;
    if ((p?.type === 'place' || p?.type === 'unit') && typeof p.id === 'string' && ID.test(p.id)) place = { type: p.type, id: p.id };
    else if (p?.type === 'point' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) place = { type: 'point', lat: p.lat, lng: p.lng };
    else throw new Error(`Stop ${i + 1}: choose where it was`);
    return { arrive, depart, place };
  });
  return { start, end, stops, breaks: ranges(v.breaks, 'Break', start, end), phoneOff: ranges(v.phoneOff, 'Phone-off stretch', start, end) };
}

const at = (date: string, hhmm: string) => Date.parse(wallTime(date, hhmm));
export const sampleWindow = (spec: SampleSpec, date: string): Interval => ({ start: at(date, spec.start), end: at(date, spec.end) });
export const sampleBreaks = (spec: SampleSpec, date: string): Interval[] => (spec.breaks || []).map(b => ({ start: at(date, b.start), end: at(date, b.end) }));

function seeded(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * GPS-like fixes for a sample day: one every 2 minutes at each stop (jittered up to 10 m, deterministic
 * for the date) and interpolated while driving between stops. Phone-off stretches have no fixes.
 */
export function samplePoints(spec: SampleSpec, date: string, locate: (p: SamplePlace) => { lat: number; lng: number } | null): Point[] {
  const rand = seeded(`${date}|${spec.start}|${spec.stops.length}`);
  const step = 2 * 60000;
  const locs = spec.stops.map((s, i) => {
    const loc = locate(s.place);
    if (!loc) throw new Error(`Stop ${i + 1}: that place has no location`);
    return loc;
  });
  const jitter = (loc: { lat: number; lng: number }) => ({
    lat: loc.lat + ((rand() * 2 - 1) * 10) / 111320,
    lng: loc.lng + ((rand() * 2 - 1) * 10) / (111320 * Math.cos((loc.lat * Math.PI) / 180)),
  });
  const points: Point[] = [];
  spec.stops.forEach((s, i) => {
    const from = at(date, s.arrive), to = at(date, s.depart);
    for (let t = from; t < to; t += step) points.push({ t, ...jitter(locs[i]), acc: 10 });
    points.push({ t: to, ...jitter(locs[i]), acc: 10 });
    const next = spec.stops[i + 1];
    if (!next) return;
    const arrive = at(date, next.arrive);
    for (let t = to + step; t < arrive; t += step) {
      const f = (t - to) / (arrive - to);
      points.push({ t, lat: locs[i].lat + (locs[i + 1].lat - locs[i].lat) * f, lng: locs[i].lng + (locs[i + 1].lng - locs[i].lng) * f, acc: 15 });
    }
  });
  const off = (spec.phoneOff || []).map(o => ({ start: at(date, o.start), end: at(date, o.end) }));
  return points.filter(p => !off.some(o => p.t > o.start && p.t < o.end));
}
