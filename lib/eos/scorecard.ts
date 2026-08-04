/**
 * Scorecard — pure logic (Phase 2, Brief 2B). Week math, snapshot value
 * extraction, goal evaluation, off-track streaks. DB-free; orchestration
 * lives in scorecard-run.ts.
 */

import type { GoalOp } from './types';

/**
 * Monday (YYYY-MM-DD) of the week containing `d`, in Pacific time.
 * Computed on a UTC-noon anchor so DST transitions can't shift the day.
 */
export function weekStartPacific(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday'); // 'Mon'…'Sun'
  const dayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  const anchor = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - Math.max(dayIndex, 0));
  return anchor.toISOString().slice(0, 10);
}

/** The Monday N weeks before a given Monday. */
export function weeksBefore(weekStart: string, n: number): string {
  const anchor = new Date(`${weekStart}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - n * 7);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Pull a numeric value out of a metrics_snapshot value map by source_ref
 * ('<metric>.<field>', e.g. 'open_exceptions.total').
 */
export function extractMetricValue(
  metrics: Map<string, { value: Record<string, unknown> }>,
  sourceRef: string
): number | null {
  const dot = sourceRef.indexOf('.');
  if (dot === -1) return null;
  const metric = sourceRef.slice(0, dot);
  const field = sourceRef.slice(dot + 1);
  const v = metrics.get(metric)?.value?.[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function isOnTrack(
  goalOp: GoalOp,
  goalValue: number | null,
  value: number | null
): boolean | null {
  if (value === null || goalValue === null) return null;
  return goalOp === 'gte' ? value >= goalValue : value <= goalValue;
}

/**
 * Consecutive off-track weeks counting back from the most recent entry.
 * `entries` must be sorted week_start DESC; null on_track breaks the streak.
 */
export function offTrackStreak(entries: { on_track: boolean | null }[]): number {
  let streak = 0;
  for (const e of entries) {
    if (e.on_track === false) streak++;
    else break;
  }
  return streak;
}
