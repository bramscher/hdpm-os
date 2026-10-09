/**
 * Guest-card trend shaping for /api/kpi/trends.
 *
 * guest_cards snapshots have used two "week" definitions:
 *   - trailing 7 days: the weekly history rebuilt by
 *     scripts/backfill-kpi-history.ts (every row up to 2026-07-27) and every
 *     daily cron row stamped `window: 'trailing_7d'`
 *   - Monday-reset week-to-date: daily cron rows from 2026-07-28 until the
 *     trailing fix shipped (no `window` field). These sawtooth — near zero on
 *     Monday, building through the week — and read as a collapse in volume.
 *
 * toWeeklyGuestCards collapses the series to one point per Monday-start UTC
 * week so the chart compares like with like. A week-to-date row only stands
 * for its week when captured on Sunday (Mon 00:00 → Sun ~14:00 UTC, ~6.6
 * days); otherwise the latest trailing row that week wins.
 */

export interface GuestCardPoint {
  date: string; // YYYY-MM-DD (UTC capture day)
  value: Record<string, unknown>;
}

const WEEK_TO_DATE_FROM = '2026-07-28';

function isWeekToDate(p: GuestCardPoint): boolean {
  return p.value.window !== 'trailing_7d' && p.date >= WEEK_TO_DATE_FROM;
}

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function weekKey(date: string): string {
  const d = utcDay(date);
  const offset = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function toWeeklyGuestCards<T extends GuestCardPoint>(points: T[]): T[] {
  const byWeek = new Map<string, T[]>();
  for (const p of points) {
    const key = weekKey(p.date);
    const list = byWeek.get(key) ?? [];
    list.push(p);
    byWeek.set(key, list);
  }

  const weekly: T[] = [];
  for (const list of byWeek.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const complete = sorted.filter((p) => !isWeekToDate(p) || utcDay(p.date).getUTCDay() === 0);
    const pool = complete.length ? complete : sorted;
    weekly.push(pool[pool.length - 1]);
  }
  return weekly.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Website tenant leads from the CRM in the 7 days ending on `date` (inclusive),
 * from per-UTC-day counts.
 */
export function websiteLeadsInWeek(date: string, dailyCounts: Map<string, number>): number {
  const end = utcDay(date);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    total += dailyCounts.get(d.toISOString().slice(0, 10)) ?? 0;
  }
  return total;
}
