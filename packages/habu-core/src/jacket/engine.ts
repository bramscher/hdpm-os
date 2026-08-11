/**
 * Jacket engine — pure logic (§4). No DB, no I/O. The persistence wrapper
 * (PR-A8) calls these and writes rows + audit_event.
 *
 * The engine IS the workflow engine: completing the active step routes the
 * jacket to the next step's seat (§4 rule 1). There is no separate workflow
 * engine. Parallel tracks (Appendix A.1 move-out) advance independently; the
 * jacket's location is the lead active step's seat.
 */

import { addBusinessDays, addCalendarDays, toDateString } from '../business-days';
import type {
  Jacket,
  JacketAttention,
  JacketStep,
  JacketTemplate,
  StepState,
  TemplateStep,
} from './types';

const MAIN_TRACK = 'main';
const trackOf = (s: { track: string | null }): string => s.track ?? MAIN_TRACK;
const TERMINAL: StepState[] = ['done', 'skipped'];
const isTerminal = (s: JacketStep): boolean => TERMINAL.includes(s.state);

/**
 * Resolve a `due_rule` to a YYYY-MM-DD date, or null if unset/unknown.
 * Grammar: `<anchor>+<n><unit>` — unit `bd` = business days, `d` = calendar.
 * Anchors are supplied by the caller (e.g. { created: <jacket created_at> }).
 * Examples: 'created+3bd', 'created+14d'. A bare anchor ('created') = that date.
 */
export function resolveDueRule(rule: string | null, anchors: Record<string, Date>): string | null {
  if (!rule) return null;
  const m = /^([a-z_]+)(?:\s*\+\s*(\d+)\s*(bd|d))?$/i.exec(rule.trim());
  if (!m) return null;
  const anchor = anchors[m[1]];
  if (!anchor) return null;
  if (!m[2]) return toDateString(anchor);
  const n = parseInt(m[2], 10);
  const out = m[3].toLowerCase() === 'bd' ? addBusinessDays(anchor, n) : addCalendarDays(anchor, n);
  return toDateString(out);
}

/**
 * Build the step rows for a new jacket from its template. The first non-terminal
 * step of EACH track starts 'active' (parallel tracks all begin at once; a
 * single-track/linear template starts exactly one step — §4 rule 1). due_on is
 * computed from each step's due_rule against `anchors`.
 *
 * `resolveSeat` maps a template step's seat_role to a seat id (null if unfilled).
 * `newId` mints step ids (kept injectable — the engine takes no ambient clock/rng).
 */
export function instantiateSteps(
  template: JacketTemplate,
  opts: {
    jacketId: string;
    anchors: Record<string, Date>;
    resolveSeat: (role: string | null | undefined) => string | null;
    newId: (ordinal: number) => string;
  }
): JacketStep[] {
  const steps: JacketStep[] = template.steps.map((def: TemplateStep, i) => ({
    id: opts.newId(i),
    jacket_id: opts.jacketId,
    ordinal: i,
    track: def.track ?? null,
    label: def.label,
    seat_id: opts.resolveSeat(def.seat_role),
    requires: def.requires ?? 'tap',
    external_match: def.external_match ?? null,
    due_rule: def.due_rule ?? null,
    due_on: resolveDueRule(def.due_rule ?? null, opts.anchors),
    state: 'pending' as StepState,
    done_at: null,
    done_by: null,
  }));
  // Activate the first pending step of each track.
  const activatedTrack = new Set<string>();
  for (const s of steps) {
    const t = trackOf(s);
    if (!activatedTrack.has(t)) {
      s.state = 'active';
      activatedTrack.add(t);
    }
  }
  return steps;
}

/** All currently-active steps, lead (lowest ordinal) first. */
export function activeSteps(steps: JacketStep[]): JacketStep[] {
  return steps.filter((s) => s.state === 'active').sort((a, b) => a.ordinal - b.ordinal);
}

/** The lead active step = the jacket's location. Null when nothing is active. */
export function leadStep(steps: JacketStep[]): JacketStep | null {
  return activeSteps(steps)[0] ?? null;
}

/** current_seat_id = the lead active step's seat. */
export function currentSeatId(steps: JacketStep[]): string | null {
  return leadStep(steps)?.seat_id ?? null;
}

/** Every non-terminal step is done or skipped → the jacket is complete. */
export function isJacketComplete(steps: JacketStep[]): boolean {
  return steps.length > 0 && steps.every(isTerminal);
}

export interface AdvanceResult {
  steps: JacketStep[];
  /** The step activated in the same track by this completion, if any. */
  activatedStepId: string | null;
  current_seat_id: string | null;
  jacket_done: boolean;
}

/**
 * Complete (or skip) a step and route the jacket forward (§4 rule 1). Marks the
 * step terminal, then activates the next pending step IN THE SAME TRACK. Returns
 * a NEW steps array (no mutation of the input) plus the recomputed jacket
 * location and done-ness. Idempotent: completing an already-terminal step is a
 * no-op that still reports current location.
 */
export function advanceStep(
  steps: JacketStep[],
  stepId: string,
  opts: { actor: string; at: string; outcome?: 'done' | 'skipped' }
): AdvanceResult {
  const outcome = opts.outcome ?? 'done';
  const next = steps.map((s) => ({ ...s }));
  const target = next.find((s) => s.id === stepId);
  let activatedStepId: string | null = null;

  if (target && !isTerminal(target)) {
    target.state = outcome;
    target.done_at = opts.at;
    target.done_by = opts.actor;

    // Activate the next pending step in the same track (ordinal order).
    const track = trackOf(target);
    const candidate = next
      .filter((s) => trackOf(s) === track && s.state === 'pending' && s.ordinal > target.ordinal)
      .sort((a, b) => a.ordinal - b.ordinal)[0];
    if (candidate) {
      candidate.state = 'active';
      activatedStepId = candidate.id;
    }
  }

  return {
    steps: next,
    activatedStepId,
    current_seat_id: currentSeatId(next),
    jacket_done: isJacketComplete(next),
  };
}

/**
 * Derive the card's attention dot (§4 rule 2, A.0-adjusted). Color stays the
 * process identity; THIS is the derived "🔴 needs you" signal.
 *
 *   now  — any non-terminal step blocked, or overdue (due_on < today), or a
 *          'now'-severity watcher hit.
 *   soon — any active step waiting on an external event, or due within
 *          `soonWindowDays` (default 2), or a 'soon'-severity watcher hit.
 *   none — otherwise.
 */
export function deriveAttention(
  steps: JacketStep[],
  opts: { today: string; watcher?: { now?: boolean; soon?: boolean }; soonWindowDays?: number }
): JacketAttention {
  const soonWindow = opts.soonWindowDays ?? 2;
  const today = opts.today;
  let soon = false;

  if (opts.watcher?.now) return 'now';

  const soonCutoff = toDateString(addCalendarDays(new Date(`${today}T00:00:00Z`), soonWindow));

  for (const s of steps) {
    if (isTerminal(s)) continue;
    if (s.state === 'blocked') return 'now';
    if (s.due_on && s.due_on < today) return 'now'; // overdue
    if (s.state === 'active' && s.requires === 'external_event') soon = true;
    if (s.due_on && s.due_on <= soonCutoff) soon = true; // due soon (not yet overdue)
  }
  if (opts.watcher?.soon) soon = true;
  return soon ? 'soon' : 'none';
}

/** Convenience: apply engine-derived fields onto a jacket record (pure). */
export function projectJacket(
  jacket: Jacket,
  steps: JacketStep[],
  opts: { today: string; watcher?: { now?: boolean; soon?: boolean } }
): Jacket {
  const done = isJacketComplete(steps);
  return {
    ...jacket,
    current_seat_id: currentSeatId(steps),
    attention: deriveAttention(steps, opts),
    status: done ? 'done' : jacket.status,
  };
}
