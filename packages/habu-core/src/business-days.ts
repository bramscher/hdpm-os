/**
 * Business-day helpers for jacket due-date and watcher date math.
 * Business days = Mon–Fri (no holiday calendar). Extracted into @habu/core
 * from hdpm-os lib/maintenance/business-days.ts (jacket due_rule needs it, §4).
 */

/** True for Mon–Fri. */
export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

/** The next business day strictly after `from` (UTC date math). */
export function nextBusinessDay(from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (!isBusinessDay(d));
  return d;
}

/** Format a Date as a Postgres DATE string (YYYY-MM-DD, UTC). */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Whole business days elapsed between `start` and `end` (end exclusive).
 * businessDaysBetween(Mon, Tue) === 1; weekends contribute 0.
 */
export function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  let count = 0;
  while (d < endDay) {
    if (isBusinessDay(d)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/** Whole calendar days between two timestamps, floored. */
export function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

/**
 * `from` plus N business days (UTC date math). n<=0 returns `from`'s date at
 * midnight UTC. Used by jacket `due_rule` (e.g. 'created+3bd').
 */
export function addBusinessDays(from: Date, n: number): Date {
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < n; i++) d = nextBusinessDay(d);
  return d;
}

/** `from` plus N calendar days (UTC date math). */
export function addCalendarDays(from: Date, n: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
