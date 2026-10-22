// HDPM Field iPhone app (field-location-app-plan.md step 2): pure helpers for the device API.
// The app's side of this contract is bramscher/hdpm-field-ios docs/server-contract.md.
import { createHash, randomBytes } from 'node:crypto';
import type { Interval, Point } from '@/lib/field-time/model';
import { localDate, type Clock, type Shift } from '@/lib/timekeeping/model';

export const MAX_POINTS_PER_UPLOAD = 500;
/** Raw fixes are kept this long, then /api/field/cron deletes them. Confirmed segments never hold coordinates. */
export const POINT_RETENTION_DAYS = 30;
/** An upload rebuilds the device day at most this often. */
export const REBUILD_EVERY_MS = 5 * 60_000;

export const newDeviceToken = () => randomBytes(32).toString('base64url');
export const hashDeviceToken = (token: string) => createHash('sha256').update(token).digest('hex');

export type ClockState = 'off' | 'working' | 'onBreak' | 'callout';
export interface ClockSnapshot { state: ClockState; version: number; since: string | null }

/** What the app shows: off, working, on a break, or on a callout (Start callout = an after-hours shift). */
export function clockSnapshot(clock: Pick<Clock, 'version' | 'shift'>): ClockSnapshot {
  const shift = clock.shift;
  if (!shift) return { state: 'off', version: clock.version, since: null };
  const open = shift.breaks.find(b => b.start && !b.end);
  if (open) return { state: 'onBreak', version: clock.version, since: open.start };
  return { state: shift.emergencyAfterHours ? 'callout' : 'working', version: clock.version, since: shift.start };
}

export type ClockAction = 'in' | 'break' | 'resume' | 'out' | 'callout';
const ACTIONS: ClockAction[] = ['in', 'break', 'resume', 'out', 'callout'];

/** The app's clock request → Timekeeping's clock command body. Breaks default to unpaid unless the app says paid. */
export function clockBody(input: unknown): Record<string, unknown> {
  const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const action = ACTIONS.find(a => a === body.action);
  if (!action) throw new Error('Unknown clock action');
  const clockVersion = Number(body.clockVersion);
  if (!Number.isInteger(clockVersion) || clockVersion < 0) throw new Error('Reload the clock and try again');
  if (action === 'callout') return { op: 'clock', action: 'in', callout: true, clockVersion };
  if (action === 'break') return { op: 'clock', action, paid: body.paid === true, clockVersion };
  return { op: 'clock', action, clockVersion };
}

/** Clocked-in time (shift windows) and timed breaks, as epoch-ms intervals. An open shift or break runs to `now`. */
export function workTime(shifts: Shift[], now: number): { windows: Interval[]; breaks: Interval[] } {
  const windows: Interval[] = [], breaks: Interval[] = [];
  for (const s of shifts) {
    if (s.source === 'scheduled') continue; // a placeholder, not time worked
    const start = Date.parse(s.start), end = s.end ? Date.parse(s.end) : now;
    if (!(end > start)) continue;
    windows.push({ start, end });
    for (const b of s.breaks) {
      if (!b.start) continue; // duration-only breaks have no clock time to exclude
      const bs = Date.parse(b.start), be = b.end ? Date.parse(b.end) : now;
      if (be > bs) breaks.push({ start: bs, end: be });
    }
  }
  return { windows, breaks };
}

const inside = (t: number, list: Interval[]) => list.some(i => t >= i.start && t <= i.end);

/** Validate the app's points and keep only those recorded while clocked in and not on a break (the privacy rule, enforced here too). */
export function acceptPoints(input: unknown, time: { windows: Interval[]; breaks: Interval[] }, now: number): { points: Point[]; rejected: number } {
  if (!Array.isArray(input)) throw new Error('Send a list of points');
  if (input.length > MAX_POINTS_PER_UPLOAD) throw new Error(`Send at most ${MAX_POINTS_PER_UPLOAD} points at a time`);
  const points: Point[] = [];
  for (const raw of input) {
    const p = raw as Record<string, unknown>;
    const t = Number(p?.t), lat = Number(p?.lat), lng = Number(p?.lng);
    const acc = p?.acc == null ? null : Number(p.acc);
    const valid = Number.isInteger(t) && t <= now + 60_000 && Number.isFinite(lat) && Math.abs(lat) <= 90
      && Number.isFinite(lng) && Math.abs(lng) <= 180 && (acc === null || (Number.isFinite(acc) && acc >= 0));
    if (valid && inside(t, time.windows) && !inside(t, time.breaks)) points.push({ t, lat, lng, acc });
  }
  return { points, rejected: input.length - points.length };
}

/** Epoch-ms bounds of a Pacific calendar day (handles the DST switch days). */
export function pacificDayBounds(date: string): Interval {
  const startOf = (d: string) => {
    for (const offset of ['-07:00', '-08:00']) {
      const ms = Date.parse(`${d}T00:00:00${offset}`);
      if (localDate(new Date(ms)) === d && localDate(new Date(ms - 1)) !== d) return ms;
    }
    throw new Error(`No Pacific midnight for ${d}`);
  };
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: startOf(date), end: startOf(next) };
}

/** The Pacific dates a set of points falls on, for rebuilding. */
export const pointDates = (points: Point[]) => [...new Set(points.map(p => localDate(new Date(p.t))))].sort();

/** Clip intervals to [start, end), dropping what falls outside. */
export const clip = (list: Interval[], bounds: Interval) =>
  list.map(i => ({ start: Math.max(i.start, bounds.start), end: Math.min(i.end, bounds.end) })).filter(i => i.end > i.start);
