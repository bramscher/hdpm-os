/**
 * Watchers — HABU primitive 3 support (§5). The generalized tripwire engine.
 *
 * Per-org rules scan open jackets and flag exceptions. The tripwire *engine*
 * pattern is generalized here; the RULES are org config (watcher_rule rows,
 * migration 0006). HDPM's 12 tripwires become the first watcher set, as tenant
 * data — not core. Watcher hits drive jacket attention (§4), the Brief (§6),
 * and the escalation ladder (§3).
 *
 * Pure/DB-free: the tenant produces a WatcherSubject snapshot per open jacket;
 * the engine evaluates rules against it.
 */

export type WatcherKind = 'aged' | 'recurring' | 'no_owner' | 'waiting_external';
export type WatcherSeverity = 'soon' | 'now';

export interface WatcherRule {
  id: string;
  org_id: string;
  name: string;
  kind: WatcherKind;
  params: Record<string, unknown>;
  severity: WatcherSeverity;
  active: boolean;
}

/** Normalized snapshot of one open jacket for watcher evaluation. */
export interface WatcherSubject {
  jacket_id: string;
  current_seat_id: string | null; // null → no_owner
  age_days: number; // for 'aged'
  waiting_external_days: number | null; // active step's external-wait age, or null
  episode_dates: string[]; // YYYY-MM-DD dates the exception fired (for 'recurring')
}

export interface WatcherHit {
  rule_id: string;
  jacket_id: string;
  severity: WatcherSeverity;
  detail: string;
}

/** Episode gap: runs of days ≤ this many apart count as ONE episode (weekends don't split). */
export const EPISODE_GAP_DAYS = 3;

/**
 * Episodes in a set of dates: runs of near-consecutive days (gap ≤
 * EPISODE_GAP_DAYS). A persistent daily exception is ONE episode; flag → clear
 * → flag is two. Ported verbatim-in-spirit from hdpm-os escalation.countEpisodes.
 */
export function countEpisodes(dates: string[], gapDays = EPISODE_GAP_DAYS): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let episodes = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (new Date(`${sorted[i]}T12:00:00Z`).getTime() - new Date(`${sorted[i - 1]}T12:00:00Z`).getTime()) /
      86_400_000;
    if (gap > gapDays) episodes++;
  }
  return episodes;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Evaluate one rule against one subject; null if it doesn't fire. */
export function evaluateRule(rule: WatcherRule, s: WatcherSubject): WatcherHit | null {
  if (!rule.active) return null;
  let fired: string | null = null;
  switch (rule.kind) {
    case 'aged': {
      const days = num(rule.params.days, 21);
      if (s.age_days >= days) fired = `aged ${s.age_days}d (≥ ${days})`;
      break;
    }
    case 'recurring': {
      const episodes = num(rule.params.episodes, 3);
      const count = countEpisodes(s.episode_dates);
      if (count >= episodes) fired = `recurring — ${count}× episodes (≥ ${episodes})`;
      break;
    }
    case 'no_owner': {
      if (s.current_seat_id === null) fired = 'no seat holds this jacket';
      break;
    }
    case 'waiting_external': {
      const days = num(rule.params.days, 3);
      if (s.waiting_external_days !== null && s.waiting_external_days >= days) {
        fired = `waiting on external ${s.waiting_external_days}d (≥ ${days})`;
      }
      break;
    }
  }
  return fired
    ? { rule_id: rule.id, jacket_id: s.jacket_id, severity: rule.severity, detail: `${rule.name}: ${fired}` }
    : null;
}

/** Evaluate all rules against all subjects. Returns every hit. */
export function evaluateWatchers(rules: WatcherRule[], subjects: WatcherSubject[]): WatcherHit[] {
  const hits: WatcherHit[] = [];
  for (const s of subjects) {
    for (const rule of rules) {
      const hit = evaluateRule(rule, s);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

/** Reduce a jacket's hits to the deriveAttention watcher signal ({now, soon}). */
export function watcherSignal(hits: WatcherHit[]): { now: boolean; soon: boolean } {
  return {
    now: hits.some((h) => h.severity === 'now'),
    soon: hits.some((h) => h.severity === 'soon'),
  };
}
