/**
 * Maintenance Dashboard — the ONE threshold table.
 *
 * Every "N over" pill on the dashboard, and (later) every Slack reminder,
 * reads the same rule so the number a person sees and the nudge they get can
 * never disagree. Rules align with the tripwires where one exists (#2, #8,
 * #11); the rest fill gaps the tripwires never covered (assigned-but-never-
 * scheduled, visit date passed, waiting too long, turn behind target).
 *
 * Pure — no I/O. Business days = Mon–Fri, no holiday calendar (same as
 * business-days.ts).
 */

import { businessDaysBetween, daysBetween } from './business-days';

export type ThresholdRule =
  /** Too long since the step was entered. */
  | { kind: 'age'; unit: 'business' | 'calendar'; maxDays: number }
  /** A planned date is already in the past while the item is still open. */
  | { kind: 'date_past'; field: 'scheduled_start' | 'target_ready' }
  /** Delegated to an existing tripwire (count comes from the tripwire run). */
  | { kind: 'tripwire'; tripwire: 8 };

export const DASHBOARD_THRESHOLDS = {
  /** AppFolio "New" — nobody has picked it up. Aligns with tripwire #2. */
  new: { kind: 'age', unit: 'business', maxDays: 1 },
  /** "Assigned" with no scheduled visit — the 144-WO coordination pool. */
  assigned: { kind: 'age', unit: 'business', maxDays: 5 },
  /** "Scheduled" but the visit date has passed and the WO is still open. */
  scheduled: { kind: 'date_past', field: 'scheduled_start' },
  /** Vendor bid outstanding. Aligns with tripwire #11. */
  estimate_requested: { kind: 'age', unit: 'business', maxDays: 3 },
  /** Bid in hand, decision pending. */
  estimated: { kind: 'age', unit: 'business', maxDays: 3 },
  /** In-app owner approval requested and undecided. */
  owner_approval: { kind: 'age', unit: 'business', maxDays: 3 },
  /** Parked on a wait reason. Matches the red days-pill (>5). */
  waiting: { kind: 'age', unit: 'calendar', maxDays: 5 },
  /** AppFolio "Work Completed" but not yet Completed/closed — bill it or close it. */
  work_completed: { kind: 'age', unit: 'calendar', maxDays: 5 },
  /** Verified but unbilled — delegated to tripwire #8's count. */
  completed: { kind: 'tripwire', tripwire: 8 },
  /** Turn past its target-ready date and not yet ready. */
  turn: { kind: 'date_past', field: 'target_ready' },
} as const satisfies Record<string, ThresholdRule>;

export type ThresholdKey = keyof typeof DASHBOARD_THRESHOLDS;

/** Human phrasing of a rule, for tooltips and (later) the "why" line. */
export function describeThreshold(rule: ThresholdRule): string {
  switch (rule.kind) {
    case 'age':
      return `more than ${rule.maxDays} ${rule.unit === 'business' ? 'business ' : ''}day${rule.maxDays === 1 ? '' : 's'} in this step`;
    case 'date_past':
      return rule.field === 'scheduled_start'
        ? 'scheduled visit date has passed'
        : 'target-ready date has passed';
    case 'tripwire':
      return `tripwire #${rule.tripwire}`;
  }
}

/**
 * Is this item over its threshold?
 *  - `since`: when the item entered its current step (age rules).
 *  - `row`: the dated fields a date_past rule reads (DATE or ISO strings).
 * Tripwire-delegated rules always return false here — their count is taken
 * from the tripwire run, not recomputed.
 */
export function isOverThreshold(
  rule: ThresholdRule,
  since: Date,
  now: Date,
  row: { scheduled_start?: string | null; target_ready?: string | null } = {}
): boolean {
  switch (rule.kind) {
    case 'age': {
      const age =
        rule.unit === 'business' ? businessDaysBetween(since, now) : daysBetween(since, now);
      return age > rule.maxDays;
    }
    case 'date_past': {
      const value = row[rule.field];
      if (!value) return false;
      // DATE columns arrive as 'YYYY-MM-DD'; compare on the calendar day so a
      // visit scheduled for today is not "past" until tomorrow.
      const today = now.toISOString().slice(0, 10);
      return value.slice(0, 10) < today;
    }
    case 'tripwire':
      return false;
  }
}
