/**
 * Week-grid math for /agents/routines. Pure (no DB) so it unit-tests. Crons
 * fire on UTC; the grid is drawn in Pacific time, Monday to Sunday.
 */

import { ROUTINES, cadence, occurrences, type Routine } from './registry';

export const TZ = 'America/Los_Angeles';

export interface PacificParts {
  /** 0 = Monday … 6 = Sunday */
  day: number;
  hour: number;
  minute: number;
  /** YYYY-MM-DD in Pacific */
  date: string;
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function pacific(d: Date): PacificParts {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: DAYS.indexOf(p.weekday), hour: Number(p.hour), minute: Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

/** Pacific calendar dates (YYYY-MM-DD) of the Monday–Sunday week containing `now`. */
export function weekDates(now: Date): string[] {
  const { day } = pacific(now);
  // Noon UTC steps keep us clear of DST edges when walking day by day.
  const base = new Date(`${pacific(now).date}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + (i - day) * 86_400_000).toISOString().slice(0, 10));
}

export interface GridBlock {
  routineId: string;
  day: number;
  hour: number;
  minute: number;
  at: string; // ISO UTC
}

/**
 * Scheduled firings for the Pacific week containing `now`. Continuous
 * routines (every 15 min / hourly) are left out; the page draws them as one
 * band each.
 */
export function weekBlocks(now: Date, routines: Routine[] = ROUTINES): GridBlock[] {
  const dates = weekDates(now);
  const from = new Date(`${dates[0]}T00:00:00Z`).getTime() - 86_400_000;
  const to = new Date(`${dates[6]}T00:00:00Z`).getTime() + 2 * 86_400_000;
  const blocks: GridBlock[] = [];
  for (const r of routines) {
    if (cadence(r.schedule) === 'continuous') continue;
    for (const at of occurrences(r.schedule, new Date(from), new Date(to))) {
      const p = pacific(at);
      const day = dates.indexOf(p.date);
      if (day < 0) continue;
      blocks.push({ routineId: r.id, day, hour: p.hour, minute: p.minute, at: at.toISOString() });
    }
  }
  return blocks.sort((a, b) => a.at.localeCompare(b.at) || a.routineId.localeCompare(b.routineId));
}

export type RunColor = 'ok' | 'warn' | 'error' | 'never' | 'running';

/** Calendar colour from a routine's last run status. */
export function runColor(status: string | null | undefined): RunColor {
  switch (status) {
    case 'ok': return 'ok';
    case 'halted':
    case 'skipped': return 'warn';
    case 'error': return 'error';
    case 'running': return 'running';
    default: return 'never';
  }
}

/** Plain-English Pacific time of day, e.g. "6:45 AM". */
export function timeLabel(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
